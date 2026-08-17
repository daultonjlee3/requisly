/**
 * Read-only Shopify Orders sync for Report Builder.
 * Requires read_orders scope — callers must handle re-auth when missing.
 */
import { createServiceClient } from "./supabase.server";
import { gidToNumericId } from "./format";
import { startTimer } from "./timing.server";

type GraphqlAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type OrdersSyncCounts = {
  orders: number;
  lineItems: number;
  skippedMissingScope: boolean;
};

const ORDERS_QUERY = `#graphql
  query RequislyOrders($cursor: String) {
    orders(first: 50, after: $cursor, sortKey: PROCESSED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        processedAt
        test
        tags
        note
        totalPriceSet { shopMoney { amount currencyCode } }
        email
        customer { id }
        lineItems(first: 50) {
          nodes {
            id
            title
            sku
            quantity
            originalUnitPriceSet { shopMoney { amount } }
            variant { id }
          }
        }
      }
    }
  }
`;

export function sessionHasOrdersScope(scope: string | null | undefined): boolean {
  if (!scope) return false;
  const parts = scope.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  return parts.includes("read_orders");
}

/**
 * Live granted scopes from Shopify (more reliable than stale session.scope
 * after optional-scope grants / managed-install updates).
 */
export async function appInstallationHasOrdersScope(
  admin: GraphqlAdmin,
): Promise<boolean> {
  try {
    const res = await admin.graphql(
      `#graphql
      query RequislyAppScopes {
        currentAppInstallation {
          accessScopes { handle }
        }
      }`,
    );
    const json = (await res.json()) as {
      data?: {
        currentAppInstallation?: { accessScopes?: { handle: string }[] };
      };
    };
    const handles =
      json.data?.currentAppInstallation?.accessScopes?.map((s) => s.handle) ??
      [];
    return handles.includes("read_orders");
  } catch {
    return false;
  }
}

export async function syncShopifyOrdersGraphql(opts: {
  admin: GraphqlAdmin;
  workspaceId: string;
  /** Max pages (50 orders each). Default 4 = ~200 recent orders. */
  maxPages?: number;
}): Promise<OrdersSyncCounts> {
  const timer = startTimer("syncShopifyOrdersGraphql");
  const supabase = createServiceClient();
  const maxPages = opts.maxPages ?? 4;

  let cursor: string | null = null;
  let orderCount = 0;
  let lineCount = 0;

  const { data: variants } = await supabase
    .from("product_variants")
    .select("id, shopify_variant_id")
    .eq("workspace_id", opts.workspaceId);
  const variantByShopify = new Map(
    (variants ?? [])
      .filter((v) => v.shopify_variant_id)
      .map((v) => [String(v.shopify_variant_id), v.id as string]),
  );

  for (let page = 0; page < maxPages; page++) {
    const response = await opts.admin.graphql(ORDERS_QUERY, {
      variables: { cursor },
    });
    const json = (await response.json()) as {
      data?: {
        orders?: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: Array<{
            id: string;
            name: string | null;
            processedAt: string | null;
            test?: boolean | null;
            tags?: string[] | null;
            note?: string | null;
            totalPriceSet?: { shopMoney?: { amount?: string; currencyCode?: string } };
            email?: string | null;
            customer?: { id?: string | null } | null;
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
    };

    if (json.errors?.length) {
      const msg = json.errors.map((e) => e.message).join("; ");
      const ordersDenied = json.errors.some((e) =>
        /ACCESS_DENIED|not approved|read_orders|protected customer data/i.test(e.message),
      );
      // Customer-field PCD denial can error while orders still return.
      // Only abort the whole sync when the orders connection itself is missing.
      if (ordersDenied && !json.data?.orders) {
        timer.end({ skippedMissingScope: true });
        return { orders: 0, lineItems: 0, skippedMissingScope: true };
      }
      if (!json.data?.orders) {
        throw new Error(msg);
      }
    }

    const conn = json.data?.orders;
    if (!conn) break;

    for (const order of conn.nodes) {
      const shopifyOrderId = gidToNumericId(order.id) || order.id;
      const total = Number(order.totalPriceSet?.shopMoney?.amount ?? 0);
      const tags = order.tags ?? [];
      const isSynthetic =
        tags.includes("requisly_synthetic_test") ||
        Boolean(order.test) ||
        (order.note ?? "").includes("[REQUISLY_SYNTHETIC_TEST]");
      // Order.email is PCD (no read_customers). customer.id needs
      // read_customers — store when Shopify returns it, otherwise null.
      // Never persist name, phone, or address.
      const customerShopifyId = order.customer?.id
        ? gidToNumericId(order.customer.id) || String(order.customer.id)
        : null;
      const customerEmail = order.email?.trim().toLowerCase() || null;
      const { data: upserted, error } = await supabase
        .from("shopify_orders")
        .upsert(
          {
            workspace_id: opts.workspaceId,
            shopify_order_id: shopifyOrderId,
            order_name: order.name,
            processed_at: order.processedAt,
            currency: order.totalPriceSet?.shopMoney?.currencyCode ?? "USD",
            total_price: Number.isFinite(total) ? total : 0,
            customer_shopify_id: customerShopifyId,
            customer_email: customerEmail,
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

      for (const line of order.lineItems?.nodes ?? []) {
        const shopifyVariantId = line.variant?.id
          ? gidToNumericId(line.variant.id) || line.variant.id
          : null;
        const unit = Number(line.originalUnitPriceSet?.shopMoney?.amount ?? 0);
        const { error: lineErr } = await supabase
          .from("shopify_order_line_items")
          .upsert(
            {
              workspace_id: opts.workspaceId,
              order_id: upserted.id,
              shopify_line_item_id: gidToNumericId(line.id) || line.id,
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

  await supabase
    .from("workspaces")
    .update({ orders_synced_at: new Date().toISOString() })
    .eq("id", opts.workspaceId);

  timer.end({ orders: orderCount, lineItems: lineCount });
  return { orders: orderCount, lineItems: lineCount, skippedMissingScope: false };
}
