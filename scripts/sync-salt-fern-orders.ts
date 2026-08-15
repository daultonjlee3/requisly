/**
 * One-shot: verify read_orders on Salt & Fern, sync Orders into Supabase.
 * Token loaded from local SQLite Session (never printed).
 *
 *   npx tsx --env-file=embedded/.env scripts/sync-salt-fern-orders.ts
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const SHOP = "requisly.myshopify.com";
const WORKSPACE_ID = "eb7e12e6-4572-466a-8424-71cc515502cd";
const API_VERSION = "2025-10";

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

function readSqliteSession(shop: string): { scope: string | null; accessToken: string } {
  const dbPath = resolve(process.cwd(), "embedded/prisma/dev.sqlite");
  if (!existsSync(dbPath)) throw new Error(`Missing ${dbPath}`);
  const py = `
import sqlite3, json
c = sqlite3.connect(r${JSON.stringify(dbPath)})
row = c.execute(
  "SELECT scope, accessToken FROM Session WHERE shop = ? LIMIT 1",
  (${JSON.stringify(shop)},)
).fetchone()
if not row:
  raise SystemExit("NO_SESSION")
print(json.dumps({"scope": row[0], "accessToken": row[1]}))
`;
  const out = execFileSync("python", ["-c", py], { encoding: "utf8" }).trim();
  if (out === "NO_SESSION") throw new Error(`No SQLite session for ${shop}`);
  return JSON.parse(out) as { scope: string | null; accessToken: string };
}

async function shopifyGraphql<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(
    `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
    },
  );
  const json = (await res.json()) as T & {
    errors?: Array<{ message: string }>;
  };
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  }
  return json;
}

function gidToNumericId(gid: string): string {
  const parts = gid.split("/");
  return parts[parts.length - 1] || gid;
}

async function main() {
  loadEnvFiles();

  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
  }

  const session = readSqliteSession(SHOP);
  const storedScopes = (session.scope ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  console.log("=== 1) Scope check (Salt & Fern / requisly.myshopify.com) ===");
  console.log("stored_session_scope:", storedScopes.join(",") || "(empty)");
  console.log("stored_has_read_orders:", storedScopes.includes("read_orders"));

  const scopesJson = await shopifyGraphql<{
    data?: {
      currentAppInstallation?: { accessScopes?: Array<{ handle: string }> };
    };
    errors?: Array<{ message: string }>;
  }>(
    session.accessToken,
    `query {
      currentAppInstallation {
        accessScopes { handle }
      }
    }`,
  );

  if (scopesJson.errors?.length) {
    console.log("live_scopes_errors:", scopesJson.errors.map((e) => e.message));
  }

  const liveHandles =
    scopesJson.data?.currentAppInstallation?.accessScopes?.map((s) => s.handle) ??
    [];
  console.log("live_installation_scopes:", liveHandles.sort().join(",") || "(none)");
  console.log("live_has_read_orders:", liveHandles.includes("read_orders"));

  if (!liveHandles.includes("read_orders")) {
    console.log("");
    console.log("BLOCKED: read_orders is NOT granted on the live installation.");
    console.log(
      "Re-consent needed via Reports banner (shopify.scopes.request) or:",
    );
    console.log(
      `https://admin.shopify.com/store/requisly/oauth/install?client_id=${process.env.SHOPIFY_API_KEY || "YOUR_CLIENT_ID"}&optional_scopes=read_orders`,
    );
    process.exitCode = 2;
    return;
  }

  console.log("");
  console.log("=== Shopify Admin order count (live GraphQL) ===");
  const countJson = await shopifyGraphql<{
    data?: { ordersCount?: { count?: number } };
    errors?: Array<{ message: string }>;
  }>(session.accessToken, `query { ordersCount { count } }`);
  if (countJson.errors?.length) {
    console.log("ordersCount_errors:", countJson.errors.map((e) => e.message));
  }
  const adminOrderCount = countJson.data?.ordersCount?.count ?? null;
  console.log("shopify_ordersCount:", adminOrderCount);

  const sampleJson = await shopifyGraphql<{
    data?: {
      orders?: {
        nodes: Array<{
          id: string;
          name: string | null;
          processedAt: string | null;
          totalPriceSet?: { shopMoney?: { amount?: string; currencyCode?: string } };
        }>;
        pageInfo: { hasNextPage: boolean };
      };
    };
    errors?: Array<{ message: string }>;
  }>(
    session.accessToken,
    `query {
      orders(first: 10, sortKey: PROCESSED_AT, reverse: true) {
        pageInfo { hasNextPage }
        nodes {
          id name processedAt
          totalPriceSet { shopMoney { amount currencyCode } }
        }
      }
    }`,
  );
  if (sampleJson.errors?.length) {
    console.log("sample_errors:", sampleJson.errors.map((e) => e.message));
    process.exitCode = 3;
    return;
  }
  const sample = sampleJson.data?.orders?.nodes ?? [];
  console.log(
    "sample_recent_orders:",
    sample.map((o) => `${o.name}@${o.processedAt?.slice(0, 10)}`).join(" | "),
  );

  console.log("");
  console.log("=== 2) Sync into shopify_orders ===");
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
    const pageJson = await shopifyGraphql<{
      data?: {
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
      errors?: Array<{ message: string }>;
    }>(
      session.accessToken,
      `query ($cursor: String) {
        orders(first: 50, after: $cursor, sortKey: PROCESSED_AT, reverse: true) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id name processedAt
            totalPriceSet { shopMoney { amount currencyCode } }
            customer { id email }
            lineItems(first: 50) {
              nodes {
                id title sku quantity
                originalUnitPriceSet { shopMoney { amount } }
                variant { id }
              }
            }
          }
        }
      }`,
      { cursor },
    );

    if (pageJson.errors?.length) {
      throw new Error(pageJson.errors.map((e) => e.message).join("; "));
    }
    const conn = pageJson.data?.orders;
    if (!conn) break;

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

  console.log("sync_upserted_orders:", orderCount);
  console.log("sync_upserted_line_items:", lineCount);
  console.log("orders_synced_at:", syncedAt);

  console.log("");
  console.log("=== 3) DB verification ===");
  const { count: dbOrders } = await supabase
    .from("shopify_orders")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", WORKSPACE_ID);
  const { count: dbLines } = await supabase
    .from("shopify_order_line_items")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", WORKSPACE_ID);

  const { data: dbSample } = await supabase
    .from("shopify_orders")
    .select("order_name, processed_at, total_price, currency")
    .eq("workspace_id", WORKSPACE_ID)
    .order("processed_at", { ascending: false })
    .limit(10);

  const { data: ws } = await supabase
    .from("workspaces")
    .select("name, orders_synced_at")
    .eq("id", WORKSPACE_ID)
    .single();

  console.log("db_order_count:", dbOrders);
  console.log("db_line_item_count:", dbLines);
  console.log("db_workspace:", ws?.name);
  console.log("db_orders_synced_at:", ws?.orders_synced_at);
  console.log(
    "db_recent:",
    (dbSample ?? [])
      .map(
        (o) =>
          `${o.order_name} $${o.total_price} ${String(o.processed_at).slice(0, 10)}`,
      )
      .join(" | "),
  );
  console.log("admin_ordersCount_vs_db:", {
    shopify_ordersCount: adminOrderCount,
    db_order_count: dbOrders,
    sync_pages_pulled: orderCount,
  });
  console.log("DONE");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
