"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomToken } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/workspace";

type LineInput = {
  description: string;
  sku: string;
  qty: number;
  unit_cost: number;
  is_free_text: boolean;
};

export async function createPurchaseOrder(formData: FormData) {
  const { user, profile } = await getSessionContext();
  if (!user || !profile) throw new Error("Not authenticated");

  const supplierId = String(formData.get("supplier_id") ?? "");
  const locationId = String(formData.get("location_id") ?? "") || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const requestedShipDate =
    String(formData.get("requested_ship_date") ?? "").trim() || null;
  const lines = parseLines(formData);

  if (!supplierId) throw new Error("Supplier is required");
  if (!lines.length) throw new Error("Add at least one line item");

  const subtotal = lines.reduce((sum, l) => sum + l.qty * l.unit_cost, 0);
  const supabase = await createClient();

  const { data: poNumber, error: numError } = await supabase.rpc(
    "next_po_number",
    { p_workspace_id: profile.workspace_id },
  );
  if (numError) throw new Error(numError.message);

  const { data: po, error } = await supabase
    .from("purchase_orders")
    .insert({
      workspace_id: profile.workspace_id,
      po_number: poNumber as string,
      supplier_id: supplierId,
      location_id: locationId,
      status: "draft",
      notes,
      requested_ship_date: requestedShipDate,
      subtotal,
      total: subtotal,
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  const { error: lineError } = await supabase.from("po_line_items").insert(
    lines.map((line, index) => ({
      po_id: po.id,
      description: line.description,
      sku: line.sku || null,
      is_free_text: line.is_free_text,
      qty: line.qty,
      unit_cost: line.unit_cost,
      line_total: Number((line.qty * line.unit_cost).toFixed(2)),
      sort_order: index,
    })),
  );
  if (lineError) throw new Error(lineError.message);

  const { error: eventError } = await supabase.from("po_timeline_events").insert({
    po_id: po.id,
    event_type: "draft",
    actor: "merchant",
    metadata: { source: "create" },
  });
  if (eventError) throw new Error(eventError.message);

  revalidatePath("/purchase-orders");
  revalidatePath("/");
  redirect(`/purchase-orders/${po.id}`);
}

export async function sendPurchaseOrder(poId: string) {
  const { profile } = await getSessionContext();
  if (!profile) throw new Error("Not authenticated");

  const supabase = await createClient();
  const { data: po, error } = await supabase
    .from("purchase_orders")
    .select("id, status, workspace_id")
    .eq("id", poId)
    .single();

  if (error || !po) throw new Error(error?.message ?? "PO not found");
  if (po.status !== "draft" && po.status !== "sent") {
    throw new Error("Only draft POs can be sent");
  }

  let token: string | null = null;
  const { data: existing } = await supabase
    .from("supplier_link_tokens")
    .select("token")
    .eq("po_id", poId)
    .maybeSingle();

  if (existing?.token) {
    token = existing.token;
  } else {
    token = randomToken(24);
    const { error: tokenError } = await supabase
      .from("supplier_link_tokens")
      .insert({ po_id: poId, token });
    if (tokenError) throw new Error(tokenError.message);
  }

  if (po.status === "draft") {
    const { error: updateError } = await supabase
      .from("purchase_orders")
      .update({ status: "sent" })
      .eq("id", poId);
    if (updateError) throw new Error(updateError.message);

    const { error: eventError } = await supabase.from("po_timeline_events").insert({
      po_id: poId,
      event_type: "sent",
      actor: "merchant",
      metadata: { channel: "supplier_link" },
    });
    if (eventError) throw new Error(eventError.message);
  }

  revalidatePath(`/purchase-orders/${poId}`);
  revalidatePath("/purchase-orders");
  revalidatePath("/");
  return token!;
}

export async function duplicatePurchaseOrder(poId: string) {
  const { user, profile } = await getSessionContext();
  if (!user || !profile) throw new Error("Not authenticated");

  const supabase = await createClient();
  const { data: source, error } = await supabase
    .from("purchase_orders")
    .select("*, po_line_items(*)")
    .eq("id", poId)
    .single();

  if (error || !source) throw new Error(error?.message ?? "PO not found");

  const { data: poNumber, error: numError } = await supabase.rpc(
    "next_po_number",
    { p_workspace_id: profile.workspace_id },
  );
  if (numError) throw new Error(numError.message);

  const { data: po, error: insertError } = await supabase
    .from("purchase_orders")
    .insert({
      workspace_id: profile.workspace_id,
      po_number: poNumber as string,
      supplier_id: source.supplier_id,
      location_id: source.location_id,
      status: "draft",
      notes: source.notes,
      requested_ship_date: source.requested_ship_date,
      subtotal: source.subtotal,
      total: source.total,
      duplicated_from_po_id: source.id,
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (insertError) throw new Error(insertError.message);

  const lines = (source.po_line_items ?? []) as Array<{
    description: string;
    sku: string | null;
    is_free_text: boolean;
    qty: number;
    unit_cost: number;
    line_total: number;
    sort_order: number;
  }>;

  if (lines.length) {
    const { error: lineError } = await supabase.from("po_line_items").insert(
      lines.map((line) => ({
        po_id: po.id,
        description: line.description,
        sku: line.sku,
        is_free_text: line.is_free_text,
        qty: line.qty,
        unit_cost: line.unit_cost,
        line_total: line.line_total,
        sort_order: line.sort_order,
      })),
    );
    if (lineError) throw new Error(lineError.message);
  }

  await supabase.from("po_timeline_events").insert({
    po_id: po.id,
    event_type: "draft",
    actor: "merchant",
    metadata: { duplicated_from: source.po_number },
  });

  revalidatePath("/purchase-orders");
  redirect(`/purchase-orders/${po.id}`);
}

export async function closePurchaseOrder(poId: string) {
  const { profile } = await getSessionContext();
  if (!profile) throw new Error("Not authenticated");

  const supabase = await createClient();
  const { data: po, error } = await supabase
    .from("purchase_orders")
    .select("status")
    .eq("id", poId)
    .single();

  if (error || !po) throw new Error(error?.message ?? "PO not found");
  if (po.status !== "partially_received") {
    throw new Error("Manual close is only available from Partially Received");
  }

  const { error: updateError } = await supabase
    .from("purchase_orders")
    .update({ status: "closed" })
    .eq("id", poId);
  if (updateError) throw new Error(updateError.message);

  await supabase.from("po_timeline_events").insert({
    po_id: poId,
    event_type: "closed",
    actor: "merchant",
    metadata: { reason: "manual_shortfall_close" },
  });

  revalidatePath(`/purchase-orders/${poId}`);
  revalidatePath("/");
  redirect(`/purchase-orders/${poId}`);
}

function parseLines(formData: FormData): LineInput[] {
  const raw = String(formData.get("lines_json") ?? "[]");
  const parsed = JSON.parse(raw) as LineInput[];
  return parsed
    .map((line) => ({
      description: String(line.description ?? "").trim(),
      sku: String(line.sku ?? "").trim(),
      qty: Number(line.qty),
      unit_cost: Number(line.unit_cost),
      is_free_text: Boolean(line.is_free_text ?? true),
    }))
    .filter((line) => line.description && line.qty > 0);
}
