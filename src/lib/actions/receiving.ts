"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ReceiptCondition } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/workspace";

type ReceiptLineInput = {
  po_line_item_id: string;
  qty_received: number;
  condition: ReceiptCondition;
  reason_note?: string;
};

export async function completeReceiving(poId: string, formData: FormData) {
  const { profile } = await getSessionContext();
  if (!profile) throw new Error("Not authenticated");

  const note = String(formData.get("note") ?? "").trim() || null;
  const lines = JSON.parse(
    String(formData.get("lines_json") ?? "[]"),
  ) as ReceiptLineInput[];

  const activeLines = lines.filter((l) => l.qty_received > 0);
  if (!activeLines.length) throw new Error("Enter at least one received quantity");

  for (const line of activeLines) {
    if (line.condition !== "good" && !String(line.reason_note ?? "").trim()) {
      // reason codes are mandatory for non-good conditions
      if (!["damaged", "wrong_item", "backorder"].includes(line.condition)) {
        throw new Error("Invalid condition");
      }
    }
  }

  const supabase = await createClient();

  const { data: poLines, error: linesError } = await supabase
    .from("po_line_items")
    .select("id, qty")
    .eq("po_id", poId);
  if (linesError) throw new Error(linesError.message);

  const { data: priorReceipts, error: priorError } = await supabase
    .from("receipts")
    .select("id, receipt_line_items(po_line_item_id, qty_received)")
    .eq("po_id", poId);
  if (priorError) throw new Error(priorError.message);

  const receivedSoFar = new Map<string, number>();
  for (const receipt of priorReceipts ?? []) {
    const items = (receipt.receipt_line_items ?? []) as Array<{
      po_line_item_id: string;
      qty_received: number;
    }>;
    for (const item of items) {
      receivedSoFar.set(
        item.po_line_item_id,
        (receivedSoFar.get(item.po_line_item_id) ?? 0) + item.qty_received,
      );
    }
  }

  const { data: receipt, error: receiptError } = await supabase
    .from("receipts")
    .insert({
      po_id: poId,
      workspace_id: profile.workspace_id,
      received_by: profile.id,
      note,
    })
    .select("id")
    .single();
  if (receiptError) throw new Error(receiptError.message);

  const { error: rliError } = await supabase.from("receipt_line_items").insert(
    activeLines.map((line) => ({
      receipt_id: receipt.id,
      po_line_item_id: line.po_line_item_id,
      qty_received: line.qty_received,
      condition: line.condition,
      reason_note:
        line.condition === "good"
          ? null
          : String(line.reason_note ?? line.condition).trim(),
    })),
  );
  if (rliError) throw new Error(rliError.message);

  for (const line of activeLines) {
    receivedSoFar.set(
      line.po_line_item_id,
      (receivedSoFar.get(line.po_line_item_id) ?? 0) + line.qty_received,
    );
  }

  const fullyReceived = (poLines ?? []).every(
    (line) => (receivedSoFar.get(line.id) ?? 0) >= line.qty,
  );
  const anyReceived = (poLines ?? []).some(
    (line) => (receivedSoFar.get(line.id) ?? 0) > 0,
  );

  let nextStatus: "partially_received" | "received" | "closed" =
    "partially_received";
  if (fullyReceived) {
    nextStatus = "closed";
  } else if (!anyReceived) {
    throw new Error("Nothing received");
  }

  const { error: statusError } = await supabase
    .from("purchase_orders")
    .update({ status: nextStatus })
    .eq("id", poId);
  if (statusError) throw new Error(statusError.message);

  if (fullyReceived) {
    // Auto-close path: record received then closed when qty is fully met
    await supabase.from("po_timeline_events").insert([
      {
        po_id: poId,
        event_type: "received",
        actor: "merchant",
        metadata: { receipt_id: receipt.id },
      },
      {
        po_id: poId,
        event_type: "closed",
        actor: "system",
        metadata: { reason: "full_receipt", receipt_id: receipt.id },
      },
    ]);
  } else {
    await supabase.from("po_timeline_events").insert({
      po_id: poId,
      event_type: "partially_received",
      actor: "merchant",
      metadata: { receipt_id: receipt.id },
    });
  }

  // Shopify inventory write-back deferred until Milestone 4 OAuth is live.
  revalidatePath(`/purchase-orders/${poId}`);
  revalidatePath(`/purchase-orders/${poId}/receive`);
  revalidatePath("/");
  redirect(`/purchase-orders/${poId}`);
}
