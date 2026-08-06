import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  NotificationRule,
  NotificationRuleType,
  PendingNotification,
} from "@/lib/notifications/types";

function appBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "http://localhost:3001"
  );
}

function poUrl(poId: string) {
  return `${appBaseUrl()}/purchase-orders/${poId}`;
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
    .select("rule_type, po_id, recipient_email")
    .eq("workspace_id", workspaceId);

  if (logError) throw new Error(logError.message);

  const sentKeys = new Set(
    (alreadySent ?? []).map(
      (row) => `${row.rule_type}:${row.po_id ?? ""}:${row.recipient_email}`,
    ),
  );

  const pending: PendingNotification[] = [];

  for (const rule of enabled) {
    const candidates = await candidatesForRule(admin, workspaceId, rule);
    for (const candidate of candidates) {
      for (const email of recipients) {
        const key = `${rule.rule_type}:${candidate.po_id}:${email}`;
        if (sentKeys.has(key)) continue;
        pending.push({
          workspace_id: workspaceId,
          rule_type: rule.rule_type,
          po_id: candidate.po_id,
          po_number: candidate.po_number,
          recipient_email: email,
          subject: candidate.subject,
          body: candidate.body,
        });
      }
    }
  }

  return pending;
}

async function candidatesForRule(
  admin: SupabaseClient,
  workspaceId: string,
  rule: NotificationRule,
): Promise<Array<{ po_id: string; po_number: string; subject: string; body: string }>> {
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
      // Requires Shopify inventory sync (Milestone 4). No-op until levels are cached.
      return [];
    }

    default:
      return [];
  }
}
