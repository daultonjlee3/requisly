import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  NotificationRule,
  NotificationRuleType,
  PendingNotification,
} from "@/lib/notifications/types";
import { listLowStockVariants } from "@/lib/notifications/low-stock";

/** Merchant deep links live on the embedded Shopify app host. */
function merchantAppBaseUrl() {
  return (
    process.env.EMBEDDED_APP_URL?.replace(/\/$/, "") ||
    process.env.SHOPIFY_APP_URL?.replace(/\/$/, "") ||
    "https://app.requisly.com"
  );
}

function poUrl(poId: string) {
  return `${merchantAppBaseUrl()}/app/purchase-orders/${poId}`;
}

function productsUrl() {
  return `${merchantAppBaseUrl()}/app/products`;
}

function supplierUrl(supplierId: string) {
  return `${merchantAppBaseUrl()}/app/suppliers/${supplierId}?tab=contracts`;
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowUTC() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function daysAgoISO(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function dedupeKey(opts: {
  ruleType: string;
  poId?: string | null;
  dedupeKey?: string | null;
  email: string;
}) {
  const entity = opts.dedupeKey ?? opts.poId ?? "";
  return `${opts.ruleType}:${entity}:${opts.email}`;
}

export async function evaluateWorkspaceNotifications(
  admin: SupabaseClient,
  workspaceId: string,
  rules: NotificationRule[],
): Promise<PendingNotification[]> {
  const enabled = rules.filter((r) => r.enabled);
  if (!enabled.length) return [];

  const { data: owners, error: ownerError } = await admin
    .from("profiles")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("role", "owner");

  if (ownerError) throw new Error(ownerError.message);

  const ownerIds = (owners ?? []).map((o) => o.id);
  if (!ownerIds.length) return [];

  const recipients: string[] = [];
  for (const id of ownerIds) {
    const { data: userData, error } = await admin.auth.admin.getUserById(id);
    if (error || !userData.user?.email) continue;
    recipients.push(userData.user.email);
  }
  if (!recipients.length) return [];

  const { data: alreadySent, error: logError } = await admin
    .from("notification_log")
    .select("rule_type, po_id, dedupe_key, recipient_email")
    .eq("workspace_id", workspaceId);

  if (logError) throw new Error(logError.message);

  const sentKeys = new Set(
    (alreadySent ?? []).map((row) =>
      dedupeKey({
        ruleType: row.rule_type,
        poId: row.po_id,
        dedupeKey: row.dedupe_key,
        email: row.recipient_email,
      }),
    ),
  );

  const pending: PendingNotification[] = [];

  for (const rule of enabled) {
    const candidates = await candidatesForRule(admin, workspaceId, rule);
    for (const candidate of candidates) {
      for (const email of recipients) {
        const key = dedupeKey({
          ruleType: rule.rule_type,
          poId: candidate.po_id,
          dedupeKey: candidate.dedupe_key,
          email,
        });
        if (sentKeys.has(key)) continue;
        pending.push({
          workspace_id: workspaceId,
          rule_type: rule.rule_type,
          po_id: candidate.po_id,
          po_number: candidate.po_number,
          dedupe_key: candidate.dedupe_key ?? null,
          recipient_email: email,
          subject: candidate.subject,
          body: candidate.body,
        });
      }
    }
  }

  return pending;
}

type Candidate = {
  po_id: string | null;
  po_number: string;
  dedupe_key?: string | null;
  subject: string;
  body: string;
};

async function candidatesForRule(
  admin: SupabaseClient,
  workspaceId: string,
  rule: NotificationRule,
): Promise<Candidate[]> {
  switch (rule.rule_type as NotificationRuleType) {
    case "po_not_confirmed": {
      const days = rule.threshold_value ?? 2;
      const cutoff = daysAgoISO(days);

      const { data: sentEvents, error } = await admin
        .from("po_timeline_events")
        .select("po_id, occurred_at, purchase_orders!inner(id, po_number, status, workspace_id)")
        .eq("event_type", "sent")
        .lte("occurred_at", cutoff);

      if (error) throw new Error(error.message);

      return (sentEvents ?? [])
        .map((event) => {
          const po = event.purchase_orders as unknown as {
            id: string;
            po_number: string;
            status: string;
            workspace_id: string;
          };
          return { event, po };
        })
        .filter(
          ({ po }) =>
            po.workspace_id === workspaceId &&
            (po.status === "sent" || po.status === "viewed"),
        )
        .map(({ po }) => ({
          po_id: po.id,
          po_number: po.po_number,
          subject: `${po.po_number} still waiting for confirmation`,
          body: `${po.po_number} was sent more than ${days} day${days === 1 ? "" : "s"} ago and the supplier has not confirmed it yet.\n\nOpen the PO: ${poUrl(po.id)}`,
        }));
    }

    case "shipment_delayed": {
      const today = todayUTC();
      const { data: pos, error } = await admin
        .from("purchase_orders")
        .select("id, po_number, status, estimated_arrival_date")
        .eq("workspace_id", workspaceId)
        .in("status", ["shipped", "in_transit"])
        .lt("estimated_arrival_date", today)
        .not("estimated_arrival_date", "is", null);

      if (error) throw new Error(error.message);

      return (pos ?? []).map((po) => ({
        po_id: po.id,
        po_number: po.po_number,
        subject: `${po.po_number} shipment is delayed`,
        body: `${po.po_number} was expected by ${po.estimated_arrival_date} and has not been received yet.\n\nOpen the PO: ${poUrl(po.id)}`,
      }));
    }

    case "arriving_soon": {
      const target = tomorrowUTC();
      const { data: pos, error } = await admin
        .from("purchase_orders")
        .select("id, po_number, estimated_arrival_date")
        .eq("workspace_id", workspaceId)
        .in("status", ["shipped", "in_transit", "confirmed", "production"])
        .eq("estimated_arrival_date", target);

      if (error) throw new Error(error.message);

      return (pos ?? []).map((po) => ({
        po_id: po.id,
        po_number: po.po_number,
        subject: `${po.po_number} arrives tomorrow`,
        body: `${po.po_number} has an estimated arrival date of tomorrow (${po.estimated_arrival_date}).\n\nOpen the PO: ${poUrl(po.id)}`,
      }));
    }

    case "inventory_low": {
      const { variants } = await listLowStockVariants(admin, workspaceId, {
        ruleThreshold: rule.threshold_value,
      });

      return variants.map((v) => {
        const label = v.sku ? `${v.title} (${v.sku})` : v.title;
        return {
          po_id: null,
          po_number: label,
          dedupe_key: `inventory_low:${v.productVariantId}`,
          subject: `Low stock: ${label}`,
          body: [
            `${label} is at or below its reorder point.`,
            `On hand: ${v.onHand} (threshold: ${v.threshold}).`,
            "",
            `Review products: ${productsUrl()}`,
            "Open Requisly in Shopify Admin → Products or New PO to restock.",
          ].join("\n"),
        };
      });
    }

    case "contract_renewal": {
      const lead = rule.threshold_value ?? 30;
      const today = todayUTC();
      const [y, m, d] = today.split("-").map(Number);
      const horizon = new Date(Date.UTC(y, m - 1, d + lead))
        .toISOString()
        .slice(0, 10);

      const { data: contracts, error } = await admin
        .from("supplier_contracts")
        .select("id, title, renewal_date, supplier_id, suppliers(name)")
        .eq("workspace_id", workspaceId)
        .not("renewal_date", "is", null)
        .gte("renewal_date", today)
        .lte("renewal_date", horizon);

      if (error) throw new Error(error.message);

      return (contracts ?? []).map((row) => {
        const supplier = row.suppliers as unknown as { name: string } | null;
        const supplierName = supplier?.name ?? "Supplier";
        const days =
          Math.round(
            (Date.parse(`${row.renewal_date}T00:00:00Z`) -
              Date.parse(`${today}T00:00:00Z`)) /
              86_400_000,
          );
        const when =
          days <= 0
            ? "today"
            : days === 1
              ? "tomorrow"
              : `in ${days} days`;
        return {
          po_id: null,
          po_number: row.title,
          dedupe_key: `contract_renewal:${row.id}:${row.renewal_date}`,
          subject: `${supplierName} contract renews ${when}`,
          body: [
            `${row.title} with ${supplierName} renews ${when} (${row.renewal_date}).`,
            "This is a reminder only — Requisly does not auto-renew or auto-send.",
            "",
            `Open contracts: ${supplierUrl(row.supplier_id)}`,
          ].join("\n"),
        };
      });
    }

    default:
      return [];
  }
}
