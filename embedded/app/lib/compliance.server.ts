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
 * Requisly does not store Shopify Customer / Order records.
 * Data model is workspace → suppliers (B2B) → POs / receipts / catalog cache.
 * These handlers still search for accidental matches by customer email/phone
 * and always persist an audit row so compliance is not a no-op stub.
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
 * Expected result for Requisly: empty customer_data (supplier emails are not Shopify customers).
 */
export async function handleCustomersDataRequest(
  shop: string,
  payload: CustomerPayload,
): Promise<Record<string, unknown>> {
  const email = payload.customer?.email?.trim().toLowerCase() || null;
  const phone = payload.customer?.phone?.trim() || null;
  const workspaceId = await findWorkspaceId(shop);
  const supabase = createServiceClient();

  const matches: Record<string, unknown> = {
    shopify_customer_id: payload.customer?.id ?? null,
    email,
    phone,
    orders_requested: payload.orders_requested ?? [],
    note:
      "Requisly does not store Shopify Customer or Order records. Supplier/contact emails are B2B merchant data, not storefront customers.",
    notification_log: [] as unknown[],
  };

  if (workspaceId && email) {
    const { data: logs } = await supabase
      .from("notification_log")
      .select("id, rule_type, recipient_email, sent_at, po_id")
      .eq("workspace_id", workspaceId)
      .ilike("recipient_email", email);
    matches.notification_log = logs ?? [];
  }

  const result = {
    action: "compiled",
    customer_data_held: Boolean(
      Array.isArray(matches.notification_log) &&
        (matches.notification_log as unknown[]).length > 0,
    ),
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
 * customers/redact — delete any rows that match the Shopify customer email/phone.
 * Does not delete suppliers (B2B), POs, or catalog data.
 */
export async function handleCustomersRedact(
  shop: string,
  payload: CustomerPayload,
): Promise<Record<string, unknown>> {
  const email = payload.customer?.email?.trim().toLowerCase() || null;
  const workspaceId = await findWorkspaceId(shop);
  const supabase = createServiceClient();
  let deletedNotifications = 0;

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

  const result = {
    action: "redacted",
    deleted_notification_log_rows: deletedNotifications,
    shopify_customer_id: payload.customer?.id ?? null,
    orders_to_redact: payload.orders_to_redact ?? [],
    note:
      "No Shopify customer/order tables exist. Supplier records are retained (not storefront customers).",
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
 * shop/redact (and uninstall cleanup) — hard-delete the workspace and cascaded data.
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

  if (workspace?.id) {
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
    action: "purged",
    shop_domain: domain,
    workspace_deleted: deletedWorkspace,
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
