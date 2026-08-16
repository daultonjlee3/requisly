export type NotificationRuleType =
  | "po_not_confirmed"
  | "shipment_delayed"
  | "arriving_soon"
  | "inventory_low"
  | "inbound_reply_unparsed";

export type NotificationRule = {
  id: string;
  workspace_id: string;
  rule_type: NotificationRuleType;
  enabled: boolean;
  threshold_value: number | null;
};

export type PendingNotification = {
  workspace_id: string;
  rule_type: NotificationRuleType;
  /** PO-scoped rules set this; inventory_low leaves null (FK to purchase_orders). */
  po_id: string | null;
  /** Display label — PO number or product title/SKU. */
  po_number: string;
  /** Non-PO dedup id, e.g. inventory_low:<variant_uuid>. */
  dedupe_key?: string | null;
  recipient_email: string;
  subject: string;
  body: string;
};
