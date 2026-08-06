import type { NotificationRuleType } from "@/lib/notifications/types";

export const RULE_COPY: Record<
  NotificationRuleType,
  { title: string; description: string; thresholdLabel?: string }
> = {
  po_not_confirmed: {
    title: "PO not confirmed",
    description:
      "Email the merchant when a PO stays at Sent/Viewed longer than the threshold.",
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
      "Requires Shopify inventory sync (not wired yet). Rule is saved but will not send until levels are available.",
  },
};
