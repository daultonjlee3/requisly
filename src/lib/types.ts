export type PoStatus =
  | "draft"
  | "sent"
  | "viewed"
  | "confirmed"
  | "production"
  | "shipped"
  | "in_transit"
  | "partially_received"
  | "received"
  | "closed"
  | "rejected"
  | "cancelled";

export type LineItemProposal = {
  id: string;
  po_line_item_id: string;
  proposed_qty: number | null;
  proposed_unit_cost: number | null;
  note: string | null;
  status: "pending" | "accepted" | "rejected";
  proposed_by: string;
  created_at: string;
  resolved_at: string | null;
};

export type ReceiptCondition = "good" | "damaged" | "wrong_item" | "backorder";

export type Supplier = {
  id: string;
  workspace_id: string;
  name: string;
  email: string;
  phone: string | null;
  contact_name: string | null;
  payment_terms: string | null;
  currency: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Location = {
  id: string;
  workspace_id: string;
  name: string;
  is_primary: boolean;
};

export type PurchaseOrder = {
  id: string;
  workspace_id: string;
  po_number: string;
  supplier_id: string;
  location_id: string | null;
  status: PoStatus;
  currency: string | null;
  notes: string | null;
  subtotal: number;
  total: number;
  requested_ship_date: string | null;
  confirmed_ship_date: string | null;
  estimated_arrival_date: string | null;
  duplicated_from_po_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PoLineItem = {
  id: string;
  po_id: string;
  description: string;
  sku: string | null;
  is_free_text: boolean;
  qty: number;
  unit_cost: number;
  line_total: number;
  sort_order: number;
};

export type TimelineEvent = {
  id: string;
  po_id: string;
  event_type: PoStatus;
  actor: string;
  occurred_at: string;
  metadata: Record<string, unknown> | null;
};
