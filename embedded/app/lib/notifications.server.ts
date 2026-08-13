import { createServiceClient } from "./supabase.server";
import { relativeTime } from "./format";

export type NotificationRuleType =
  | "po_not_confirmed"
  | "shipment_delayed"
  | "arriving_soon"
  | "inventory_low";

export const RULE_COPY: Record<
  NotificationRuleType,
  { title: string; description: string; thresholdLabel?: string }
> = {
  po_not_confirmed: {
    title: "PO not confirmed",
    description:
      "Email when a PO stays at Sent/Viewed longer than the threshold.",
    thresholdLabel: "Days since sent",
  },
  shipment_delayed: {
    title: "Shipment delayed",
    description:
      "Email when estimated arrival has passed and the PO is still shipped or in transit.",
  },
  arriving_soon: {
    title: "Arriving tomorrow",
    description: "Email when estimated arrival date is tomorrow.",
  },
  inventory_low: {
    title: "Inventory low",
    description:
      "Email when synced on-hand inventory is at or below the reorder point (per-product threshold when set, otherwise this workspace default).",
    thresholdLabel: "Default on-hand threshold",
  },
};

export type NotificationSettings = {
  rules: Array<{
    id: string;
    ruleType: NotificationRuleType;
    title: string;
    description: string;
    thresholdLabel?: string;
    enabled: boolean;
    thresholdValue: string;
  }>;
  log: Array<{
    id: string;
    ruleTitle: string;
    poNumber: string;
    recipient: string;
    sentAt: string;
  }>;
};

export async function loadNotificationSettings(
  workspaceId: string,
): Promise<NotificationSettings> {
  const supabase = createServiceClient();
  const [{ data: rules, error }, { data: log, error: logErr }] =
    await Promise.all([
      supabase
        .from("notification_rules")
        .select("id, rule_type, enabled, threshold_value")
        .eq("workspace_id", workspaceId)
        .order("rule_type"),
      supabase
        .from("notification_log")
        .select(
          "id, rule_type, po_id, dedupe_key, sent_at, recipient_email, purchase_orders(po_number)",
        )
        .eq("workspace_id", workspaceId)
        .order("sent_at", { ascending: false })
        .limit(10),
    ]);
  if (error) throw new Error(error.message);
  if (logErr) throw new Error(logErr.message);

  return {
    rules: (rules ?? []).map((rule) => {
      const type = rule.rule_type as NotificationRuleType;
      const copy = RULE_COPY[type] ?? {
        title: rule.rule_type,
        description: "",
      };
      return {
        id: rule.id,
        ruleType: type,
        title: copy.title,
        description: copy.description,
        thresholdLabel: copy.thresholdLabel,
        enabled: Boolean(rule.enabled),
        thresholdValue:
          rule.threshold_value != null ? String(rule.threshold_value) : "",
      };
    }),
    log: (log ?? []).map((row) => {
      const po = row.purchase_orders as unknown as {
        po_number: string;
      } | null;
      const type = row.rule_type as NotificationRuleType;
      const dedupe = (row as { dedupe_key?: string | null }).dedupe_key;
      return {
        id: row.id,
        ruleTitle: RULE_COPY[type]?.title ?? row.rule_type,
        poNumber:
          po?.po_number ??
          (type === "inventory_low" || dedupe?.startsWith("inventory_low:")
            ? "Low-stock SKU"
            : "—"),
        recipient: row.recipient_email ?? "—",
        sentAt: relativeTime(row.sent_at),
      };
    }),
  };
}

export async function updateNotificationRule(
  workspaceId: string,
  ruleId: string,
  formData: FormData,
): Promise<void> {
  const enabled =
    formData.get("enabled") === "on" || formData.get("enabled") === "true";
  const thresholdRaw = String(formData.get("threshold_value") ?? "").trim();
  const threshold_value = thresholdRaw === "" ? null : Number(thresholdRaw);

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("notification_rules")
    .update({
      enabled,
      threshold_value: Number.isFinite(threshold_value as number)
        ? threshold_value
        : null,
    })
    .eq("id", ruleId)
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
}
