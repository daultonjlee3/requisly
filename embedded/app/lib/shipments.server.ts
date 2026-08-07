import { createServiceClient } from "./supabase.server";
import { relativeTime, shortDate } from "./format";

export type PoShipmentLine = {
  poLineItemId: string;
  description: string;
  qty: number;
};

export type PoShipment = {
  id: string;
  trackingNumber: string | null;
  carrier: string | null;
  estimatedArrivalDate: string;
  estimatedArrivalRaw: string;
  shippedAtLabel: string;
  note: string | null;
  createdBy: string;
  lines: PoShipmentLine[];
};

export async function listPoShipments(
  workspaceId: string,
  poId: string,
): Promise<PoShipment[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("po_shipments")
    .select(
      "id, tracking_number, carrier, estimated_arrival_date, shipped_at, note, created_by, po_shipment_lines(qty, po_line_item_id, po_line_items(description))",
    )
    .eq("workspace_id", workspaceId)
    .eq("po_id", poId)
    .order("shipped_at", { ascending: false });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const lines = (row.po_shipment_lines ?? []) as unknown as Array<{
      qty: number;
      po_line_item_id: string;
      po_line_items:
        | { description: string }
        | { description: string }[]
        | null;
    }>;
    return {
      id: row.id,
      trackingNumber: row.tracking_number,
      carrier: row.carrier,
      estimatedArrivalDate: shortDate(row.estimated_arrival_date),
      estimatedArrivalRaw: row.estimated_arrival_date ?? "",
      shippedAtLabel: relativeTime(row.shipped_at),
      note: row.note,
      createdBy: row.created_by,
      lines: lines.map((l) => {
        const product = Array.isArray(l.po_line_items)
          ? l.po_line_items[0]
          : l.po_line_items;
        return {
          poLineItemId: l.po_line_item_id,
          description: product?.description ?? "Line",
          qty: Number(l.qty) || 0,
        };
      }),
    };
  });
}

export async function addMerchantShipment(opts: {
  workspaceId: string;
  poId: string;
  trackingNumber?: string | null;
  carrier?: string | null;
  estimatedArrivalDate?: string | null;
  note?: string | null;
  lines?: Array<{ poLineItemId: string; qty: number }>;
}): Promise<{ id: string }> {
  const supabase = createServiceClient();
  const { data: po, error } = await supabase
    .from("purchase_orders")
    .select("id, status")
    .eq("id", opts.poId)
    .eq("workspace_id", opts.workspaceId)
    .maybeSingle();
  if (error || !po) throw new Error(error?.message ?? "PO not found");
  if (["draft", "rejected", "closed", "received"].includes(po.status)) {
    throw new Error("Cannot add a shipment in the current PO status");
  }

  const { data: shipment, error: insertErr } = await supabase
    .from("po_shipments")
    .insert({
      workspace_id: opts.workspaceId,
      po_id: opts.poId,
      tracking_number: opts.trackingNumber?.trim() || null,
      carrier: opts.carrier?.trim() || null,
      estimated_arrival_date: opts.estimatedArrivalDate || null,
      note: opts.note?.trim() || null,
      created_by: "merchant",
    })
    .select("id")
    .single();
  if (insertErr) throw new Error(insertErr.message);

  const lines = (opts.lines ?? []).filter((l) => l.qty > 0);
  if (lines.length) {
    const { error: lineErr } = await supabase.from("po_shipment_lines").insert(
      lines.map((l) => ({
        shipment_id: shipment.id,
        po_line_item_id: l.poLineItemId,
        qty: l.qty,
      })),
    );
    if (lineErr) throw new Error(lineErr.message);
  }

  const nextStatus = ["partially_received", "received", "closed"].includes(
    po.status,
  )
    ? po.status
    : "shipped";

  const patch: Record<string, unknown> = {
    status: nextStatus,
    updated_at: new Date().toISOString(),
  };
  if (opts.estimatedArrivalDate) {
    patch.estimated_arrival_date = opts.estimatedArrivalDate;
  }

  const { error: updateErr } = await supabase
    .from("purchase_orders")
    .update(patch)
    .eq("id", opts.poId)
    .eq("workspace_id", opts.workspaceId);
  if (updateErr) throw new Error(updateErr.message);

  await supabase.from("po_timeline_events").insert({
    po_id: opts.poId,
    event_type: "shipped",
    actor: "merchant",
    metadata: {
      tracking_number: opts.trackingNumber?.trim() || null,
      carrier: opts.carrier?.trim() || null,
      estimated_arrival_date: opts.estimatedArrivalDate || null,
      shipment_id: shipment.id,
      source: "merchant_add_shipment",
    },
  });

  return { id: shipment.id };
}
