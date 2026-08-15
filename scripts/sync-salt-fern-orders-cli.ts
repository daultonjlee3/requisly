/**
 * Sync Salt & Fern Orders using Shopify CLI auth (app execute), not SQLite tokens.
 *
 *   npx tsx --env-file=embedded/.env scripts/sync-salt-fern-orders-cli.ts
 */
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SHOP = "requisly.myshopify.com";
const WORKSPACE_ID = "eb7e12e6-4572-466a-8424-71cc515502cd";
const EMBEDDED = resolve(process.cwd(), "embedded");
const TMP = resolve(process.cwd(), "tmp");
const QUERY_FILE = resolve(TMP, "orders-page.graphql");

function loadEnvFiles() {
  for (const rel of ["embedded/.env", ".env.local", ".env"]) {
    const p = resolve(process.cwd(), rel);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m || process.env[m[1]]) continue;
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

function gidToNumericId(gid: string): string {
  const parts = gid.split("/");
  return parts[parts.length - 1] || gid;
}

function cliExecute(opts: {
  queryFile: string;
  outputFile: string;
  variables?: Record<string, unknown>;
}) {
  const args = [
    "shopify",
    "app",
    "execute",
    "-s",
    SHOP,
    "--query-file",
    opts.queryFile,
    "--output-file",
    opts.outputFile,
  ];
  if (opts.variables && opts.variables.cursor != null) {
    const varFile = resolve(TMP, "orders-vars.json");
    writeFileSync(varFile, JSON.stringify(opts.variables));
    args.push("--variable-file", varFile);
  }
  execFileSync("npx", args, {
    cwd: EMBEDDED,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });
  return JSON.parse(readFileSync(opts.outputFile, "utf8")) as {
    orders?: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: Array<{
        id: string;
        name: string | null;
        processedAt: string | null;
        totalPriceSet?: {
          shopMoney?: { amount?: string; currencyCode?: string };
        };
        customer?: { id?: string; email?: string | null } | null;
        lineItems?: {
          nodes: Array<{
            id: string;
            title: string;
            sku: string | null;
            quantity: number;
            originalUnitPriceSet?: { shopMoney?: { amount?: string } };
            variant?: { id?: string } | null;
          }>;
        };
      }>;
    };
  };
}

async function main() {
  loadEnvFiles();
  mkdirSync(TMP, { recursive: true });

  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
  }

  // Scope probe
  const scopesOut = resolve(TMP, "salt-fern-scopes-sync.json");
  writeFileSync(
    resolve(TMP, "scopes.graphql"),
    "query { currentAppInstallation { accessScopes { handle } } }\n",
  );
  execFileSync(
    "npx",
    [
      "shopify",
      "app",
      "execute",
      "-s",
      SHOP,
      "--query-file",
      resolve(TMP, "scopes.graphql"),
      "--output-file",
      scopesOut,
    ],
    { cwd: EMBEDDED, encoding: "utf8", shell: true },
  );
  const scopes = JSON.parse(readFileSync(scopesOut, "utf8")) as {
    currentAppInstallation?: { accessScopes?: Array<{ handle: string }> };
  };
  const handles =
    scopes.currentAppInstallation?.accessScopes?.map((s) => s.handle) ?? [];
  console.log("live_scopes:", handles.sort().join(","));
  console.log("live_has_read_orders:", handles.includes("read_orders"));
  if (!handles.includes("read_orders")) {
    throw new Error("read_orders not granted — cannot sync");
  }

  // Count probe
  writeFileSync(
    resolve(TMP, "orders-count.graphql"),
    "query { ordersCount { count } }\n",
  );
  const countOut = resolve(TMP, "salt-fern-orders-count.json");
  execFileSync(
    "npx",
    [
      "shopify",
      "app",
      "execute",
      "-s",
      SHOP,
      "--query-file",
      resolve(TMP, "orders-count.graphql"),
      "--output-file",
      countOut,
    ],
    { cwd: EMBEDDED, encoding: "utf8", shell: true },
  );
  const countJson = JSON.parse(readFileSync(countOut, "utf8")) as {
    ordersCount?: { count?: number };
  };
  console.log("shopify_ordersCount:", countJson.ordersCount?.count ?? null);

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: variants } = await supabase
    .from("product_variants")
    .select("id, shopify_variant_id")
    .eq("workspace_id", WORKSPACE_ID);
  const variantByShopify = new Map(
    (variants ?? [])
      .filter((v) => v.shopify_variant_id)
      .map((v) => [String(v.shopify_variant_id), v.id as string]),
  );

  let cursor: string | null = null;
  let orderCount = 0;
  let lineCount = 0;
  const maxPages = 20;

  for (let page = 0; page < maxPages; page++) {
    const outFile = resolve(TMP, `orders-page-${page}.json`);
    const pageData = cliExecute({
      queryFile: QUERY_FILE,
      outputFile: outFile,
      variables: cursor ? { cursor } : undefined,
    });
    const conn = pageData.orders;
    if (!conn) break;
    console.log(`page_${page}_nodes:`, conn.nodes.length);

    for (const order of conn.nodes) {
      const shopifyOrderId = gidToNumericId(order.id);
      const total = Number(order.totalPriceSet?.shopMoney?.amount ?? 0);
      const { data: upserted, error } = await supabase
        .from("shopify_orders")
        .upsert(
          {
            workspace_id: WORKSPACE_ID,
            shopify_order_id: shopifyOrderId,
            order_name: order.name,
            processed_at: order.processedAt,
            currency: order.totalPriceSet?.shopMoney?.currencyCode ?? "USD",
            total_price: Number.isFinite(total) ? total : 0,
            customer_shopify_id: order.customer?.id
              ? gidToNumericId(order.customer.id)
              : null,
            customer_email: order.customer?.email?.trim().toLowerCase() || null,
            synced_at: new Date().toISOString(),
          },
          { onConflict: "workspace_id,shopify_order_id" },
        )
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      orderCount += 1;

      for (const line of order.lineItems?.nodes ?? []) {
        const shopifyVariantId = line.variant?.id
          ? gidToNumericId(line.variant.id)
          : null;
        const unit = Number(line.originalUnitPriceSet?.shopMoney?.amount ?? 0);
        const { error: lineErr } = await supabase
          .from("shopify_order_line_items")
          .upsert(
            {
              workspace_id: WORKSPACE_ID,
              order_id: upserted.id,
              shopify_line_item_id: gidToNumericId(line.id),
              shopify_variant_id: shopifyVariantId,
              product_variant_id: shopifyVariantId
                ? variantByShopify.get(shopifyVariantId) ?? null
                : null,
              title: line.title,
              sku: line.sku,
              quantity: line.quantity ?? 0,
              unit_price: Number.isFinite(unit) ? unit : 0,
            },
            { onConflict: "workspace_id,shopify_line_item_id" },
          );
        if (lineErr) throw new Error(lineErr.message);
        lineCount += 1;
      }
    }

    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }

  const syncedAt = new Date().toISOString();
  const { error: stampErr } = await supabase
    .from("workspaces")
    .update({ orders_synced_at: syncedAt })
    .eq("id", WORKSPACE_ID);
  if (stampErr) throw new Error(stampErr.message);

  const { count: dbOrders } = await supabase
    .from("shopify_orders")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", WORKSPACE_ID);
  const { count: dbLines } = await supabase
    .from("shopify_order_line_items")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", WORKSPACE_ID);
  const { data: ws } = await supabase
    .from("workspaces")
    .select("name, shopify_domain, orders_synced_at")
    .eq("id", WORKSPACE_ID)
    .single();

  console.log(
    JSON.stringify(
      {
        workspace: ws,
        shopify_ordersCount: countJson.ordersCount?.count ?? null,
        sync_upserted_orders: orderCount,
        sync_upserted_line_items: lineCount,
        db_order_count: dbOrders,
        db_line_item_count: dbLines,
        match:
          (countJson.ordersCount?.count ?? null) === (dbOrders ?? null) &&
          (dbOrders ?? 0) === orderCount,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
