import { createServiceClient } from "./supabase.server";
import { normalizeShopDomain } from "./format";
import db from "../db.server";

type CustomerPayload = {
  shop_id?: number;
  shop_domain?: string;
  customer?: {
    id?: number;
    email?: string | null;
    phone?: string | null;
  };
  orders_requested?: number[];
  orders_to_redact?: number[];
  data_request?: { id?: number };
};

/**
 * Requisly stores a read-only Shopify Orders cache for Report Builder when
 * read_orders is granted. Data model is otherwise workspace → suppliers (B2B)
 * → POs / receipts / catalog. Compliance handlers search by customer email/id
 * and always persist an audit row.
 */

async function logComplianceEvent(opts: {
  shopDomain: string;
  topic: string;
  payload: unknown;
  result: Record<string, unknown>;
}) {
  const supabase = createServiceClient();
  const { error } = await supabase.from("compliance_events").insert({
    shop_domain: opts.shopDomain,
    topic: opts.topic,
    payload: opts.payload ?? {},
    result: opts.result,
  });
  if (error) {
    // Table may not exist yet in a fresh env — still throw so deploy/migration is noticed.
    console.error("compliance_events insert failed:", error.message);
    throw new Error(error.message);
  }
}

async function findWorkspaceId(shopDomain: string): Promise<string | null> {
  const domain = normalizeShopDomain(shopDomain) || shopDomain.trim().toLowerCase();
  if (!domain) return null;
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("workspaces")
    .select("id")
    .eq("shopify_domain", domain)
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * customers/data_request — compile any stored data tied to this Shopify customer.
 * Includes synced Orders cache rows (Report Builder) when present.
 */
export async function handleCustomersDataRequest(
  shop: string,
  payload: CustomerPayload,
): Promise<Record<string, unknown>> {
  const email = payload.customer?.email?.trim().toLowerCase() || null;
  const phone = payload.customer?.phone?.trim() || null;
  const customerId = payload.customer?.id != null ? String(payload.customer.id) : null;
  const workspaceId = await findWorkspaceId(shop);
  const supabase = createServiceClient();

  const matches: Record<string, unknown> = {
    shopify_customer_id: payload.customer?.id ?? null,
    email,
    phone,
    orders_requested: payload.orders_requested ?? [],
    note:
      "Requisly stores a read-only Orders cache for Report Builder when read_orders is granted. Supplier/contact emails are B2B merchant data, not storefront customers.",
    notification_log: [] as unknown[],
    shopify_orders: [] as unknown[],
    shopify_order_line_items: [] as unknown[],
  };

  if (workspaceId && email) {
    const { data: logs } = await supabase
      .from("notification_log")
      .select("id, rule_type, recipient_email, sent_at, po_id")
      .eq("workspace_id", workspaceId)
      .ilike("recipient_email", email);
    matches.notification_log = logs ?? [];
  }

  if (workspaceId && (email || customerId)) {
    let ordersQ = supabase
      .from("shopify_orders")
      .select(
        "id, shopify_order_id, order_name, processed_at, total_price, customer_email, customer_shopify_id",
      )
      .eq("workspace_id", workspaceId);
    if (email && customerId) {
      ordersQ = ordersQ.or(
        `customer_email.eq.${email},customer_shopify_id.eq.${customerId}`,
      );
    } else if (email) {
      ordersQ = ordersQ.eq("customer_email", email);
    } else if (customerId) {
      ordersQ = ordersQ.eq("customer_shopify_id", customerId);
    }
    const { data: orders } = await ordersQ.limit(200);
    matches.shopify_orders = orders ?? [];
    const orderIds = (orders ?? []).map((o) => o.id);
    if (orderIds.length) {
      const { data: lines } = await supabase
        .from("shopify_order_line_items")
        .select(
          "id, order_id, title, sku, quantity, unit_price, shopify_line_item_id",
        )
        .eq("workspace_id", workspaceId)
        .in("order_id", orderIds);
      matches.shopify_order_line_items = lines ?? [];
    }
  }

  const held =
    (Array.isArray(matches.notification_log) &&
      (matches.notification_log as unknown[]).length > 0) ||
    (Array.isArray(matches.shopify_orders) &&
      (matches.shopify_orders as unknown[]).length > 0);

  const result = {
    action: "compiled",
    customer_data_held: held,
    data: matches,
  };

  await logComplianceEvent({
    shopDomain: shop,
    topic: "customers/data_request",
    payload,
    result,
  });

  return result;
}

/**
 * customers/redact — delete any rows that match the Shopify customer email/phone/id.
 * Deletes Orders cache rows for that customer. Does not delete suppliers (B2B), POs, or catalog.
 */
export async function handleCustomersRedact(
  shop: string,
  payload: CustomerPayload,
): Promise<Record<string, unknown>> {
  const email = payload.customer?.email?.trim().toLowerCase() || null;
  const customerId = payload.customer?.id != null ? String(payload.customer.id) : null;
  const workspaceId = await findWorkspaceId(shop);
  const supabase = createServiceClient();
  let deletedNotifications = 0;
  let deletedOrders = 0;

  if (workspaceId && email) {
    const { data, error } = await supabase
      .from("notification_log")
      .delete()
      .eq("workspace_id", workspaceId)
      .ilike("recipient_email", email)
      .select("id");
    if (error) throw new Error(error.message);
    deletedNotifications = data?.length ?? 0;
  }

  if (workspaceId && (email || customerId)) {
    let q = supabase
      .from("shopify_orders")
      .delete()
      .eq("workspace_id", workspaceId)
      .select("id");
    if (email && customerId) {
      q = q.or(
        `customer_email.eq.${email},customer_shopify_id.eq.${customerId}`,
      );
    } else if (email) {
      q = q.eq("customer_email", email);
    } else if (customerId) {
      q = q.eq("customer_shopify_id", customerId);
    }
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    deletedOrders = data?.length ?? 0;
    // Line items cascade via FK on order delete.
  }

  const result = {
    action: "redacted",
    deleted_notification_log_rows: deletedNotifications,
    deleted_shopify_orders: deletedOrders,
    shopify_customer_id: payload.customer?.id ?? null,
    orders_to_redact: payload.orders_to_redact ?? [],
    note:
      "Orders cache rows for this customer were removed when present. Supplier records are retained (not storefront customers).",
  };

  await logComplianceEvent({
    shopDomain: shop,
    topic: "customers/redact",
    payload,
    result,
  });

  return result;
}

/**
 * app/uninstalled — revoke offline token + sessions, keep the workspace so a
 * reinstall reclaims the same shopify_domain row (POs/catalog intact).
 *
 * shop/redact — hard-delete the workspace and cascaded data (GDPR deadline).
 *
 * Prod check: local isolation QA never saw Shopify deliver app/uninstalled to the
 * Cloudflare tunnel; soft-uninstall was exercised by calling this function directly.
 * After production deploy, uninstall a real/dev store and confirm a compliance_events
 * row lands with action=revoked (see webhooks.app.uninstalled.tsx).
 */
export async function purgeShopData(
  shop: string,
  topic: "shop/redact" | "app/uninstalled",
  payload: unknown = {},
): Promise<Record<string, unknown>> {
  const domain = normalizeShopDomain(shop) || shop.trim().toLowerCase();
  const supabase = createServiceClient();

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("shopify_domain", domain)
    .maybeSingle();

  let deletedDocuments = 0;
  let deletedWorkspace = false;
  let credentialsRevoked = false;

  if (topic === "app/uninstalled") {
    if (workspace?.id) {
      const { error: credErr } = await supabase
        .from("workspace_shopify_credentials")
        .delete()
        .eq("workspace_id", workspace.id);
      if (credErr) throw new Error(credErr.message);
      credentialsRevoked = true;
    }
  } else if (workspace?.id) {
    const { data: docs } = await supabase
      .from("po_documents")
      .select("file_path")
      .eq("workspace_id", workspace.id);

    const paths = (docs ?? [])
      .map((d) => d.file_path)
      .filter((p): p is string => Boolean(p));
    if (paths.length) {
      const { error: storageErr } = await supabase.storage
        .from("po-documents")
        .remove(paths);
      if (storageErr) {
        console.error("po-documents storage cleanup:", storageErr.message);
      }
      deletedDocuments = paths.length;
    }

    const { error: delErr } = await supabase
      .from("workspaces")
      .delete()
      .eq("id", workspace.id);
    if (delErr) throw new Error(delErr.message);
    deletedWorkspace = true;
  }

  const sessionDelete = await db.session.deleteMany({ where: { shop: domain } });
  // Also try raw shop string variants Shopify may send
  if (shop !== domain) {
    await db.session.deleteMany({ where: { shop } });
  }

  const result = {
    action: topic === "app/uninstalled" ? "revoked" : "purged",
    shop_domain: domain,
    workspace_deleted: deletedWorkspace,
    credentials_revoked: credentialsRevoked,
    storage_files_removed: deletedDocuments,
    sessions_deleted: sessionDelete.count,
  };

  // Log after purge when possible; if workspace gone, still try insert (no FK).
  try {
    await logComplianceEvent({
      shopDomain: domain,
      topic,
      payload,
      result,
    });
  } catch (err) {
    console.error("compliance log after purge:", err);
  }

  return result;
}
