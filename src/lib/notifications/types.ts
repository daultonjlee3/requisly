export type NotificationRuleType =
  | "po_not_confirmed"
  | "shipment_delayed"
  | "arriving_soon"
  | "inventory_low";

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
  po_id: string;
  po_number: string;
  recipient_email: string;
  subject: string;
  body: string;
};
