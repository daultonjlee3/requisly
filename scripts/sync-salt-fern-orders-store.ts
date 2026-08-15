/**
 * Sync Salt & Fern orders using Shopify *store* auth (online token).
 * App offline token cannot read Order fields until Protected Customer Data is approved.
 *
 * Marks tags/is_synthetic_test from Shopify order tags/notes.
 *
 *   npx tsx --env-file=embedded/.env scripts/sync-salt-fern-orders-store.ts
 */
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SHOP = "requisly.myshopify.com";
const WORKSPACE_ID = "eb7e12e6-4572-466a-8424-71cc515502cd";
const EMBEDDED = resolve(process.cwd(), "embedded");
const TMP = resolve(process.cwd(), "tmp");
const SYNTHETIC_TAG = "requisly_synthetic_test";

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

function stripBom(path: string) {
  const b = readFileSync(path);
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
    writeFileSync(path, b.subarray(3));
  }
}

async function main() {
  loadEnvFiles();
  mkdirSync(TMP, { recursive: true });
  const queryFile = resolve(TMP, "list-orders-full.graphql");
  const outFile = resolve(TMP, "list-orders-full.json");
  const countFile = resolve(TMP, "orders-count-now.json");
  stripBom(queryFile);

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
      countFile,
    ],
    { cwd: EMBEDDED, encoding: "utf8", shell: true, stdio: "pipe" },
  );
  const adminCount = (
    JSON.parse(readFileSync(countFile, "utf8")) as {
      ordersCount?: { count?: number };
    }
  ).ordersCount?.count;
  console.log("shopify_ordersCount:", adminCount);

  execFileSync(
    "npx",
    [
      "shopify",
      "store",
      "execute",
      "-s",
      SHOP,
      "--query-file",
      queryFile,
      "--output-file",
      outFile,
    ],
    { cwd: EMBEDDED, encoding: "utf8", shell: true, stdio: "pipe" },
  );

  const payload = JSON.parse(readFileSync(outFile, "utf8")) as {
    orders?: {
      nodes: Array<{
        id: string;
        name: string | null;
        processedAt: string | null;
        test?: boolean;
        tags?: string[];
        note?: string | null;
        totalPriceSet?: { shopMoney?: { amount?: string; currencyCode?: string } };
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

  const nodes = payload.orders?.nodes ?? [];
  console.log("store_token_orders_pulled:", nodes.length);

  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
  }
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

  let orderCount = 0;
  let lineCount = 0;
  let syntheticCount = 0;
  const sample: string[] = [];

  for (const order of nodes) {
    const tags = order.tags ?? [];
    const isSynthetic =
      tags.includes(SYNTHETIC_TAG) ||
      Boolean(order.test) ||
      (order.note ?? "").includes("[REQUISLY_SYNTHETIC_TEST]");
    if (isSynthetic) syntheticCount += 1;

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
          tags,
          note: order.note ?? null,
          is_synthetic_test: isSynthetic,
          synced_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id,shopify_order_id" },
      )
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    orderCount += 1;
    sample.push(
      `${order.name} $${total} ${order.processedAt?.slice(0, 10)} synthetic=${isSynthetic}`,
    );

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

  const syncedAt = new Date().toISOString();
  await supabase
    .from("workspaces")
    .update({ orders_synced_at: syncedAt })
    .eq("id", WORKSPACE_ID);

  const { count: dbOrders } = await supabase
    .from("shopify_orders")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", WORKSPACE_ID);
  const { count: dbLines } = await supabase
    .from("shopify_order_line_items")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", WORKSPACE_ID);
  const { count: dbSynthetic } = await supabase
    .from("shopify_orders")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", WORKSPACE_ID)
    .eq("is_synthetic_test", true);

  console.log(
    JSON.stringify(
      {
        warning:
          "SYNTHETIC TEST ORDERS — confirms mechanism only, NOT real customer-driven velocity",
        shopify_ordersCount: adminCount,
        store_pulled: nodes.length,
        sync_upserted_orders: orderCount,
        sync_upserted_line_items: lineCount,
        sync_synthetic_flagged: syntheticCount,
        db_order_count: dbOrders,
        db_line_item_count: dbLines,
        db_synthetic_count: dbSynthetic,
        orders_synced_at: syncedAt,
        match_admin_vs_db: adminCount === dbOrders,
        sample,
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
