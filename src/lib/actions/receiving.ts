"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ReceiptCondition } from "@/lib/types";
import { createAdminClient } from "@/lib/supabase/admin";
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

  // Apply good-qty receipts to local inventory_levels + Shopify (PO location).
  await applyInventoryForReceipt({
    supabase,
    workspaceId: profile.workspace_id,
    poId,
    receiptLines: activeLines,
  });

  revalidatePath(`/purchase-orders/${poId}`);
  revalidatePath(`/purchase-orders/${poId}/receive`);
  revalidatePath("/products");
  revalidatePath("/");
  redirect(`/purchase-orders/${poId}`);
}

async function applyInventoryForReceipt(opts: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  workspaceId: string;
  poId: string;
  receiptLines: ReceiptLineInput[];
}) {
  const { supabase, workspaceId, poId, receiptLines } = opts;

  const goodLines = receiptLines.filter(
    (l) => l.condition === "good" && l.qty_received > 0,
  );
  if (!goodLines.length) return;

  const { data: po } = await supabase
    .from("purchase_orders")
    .select("id, location_id, locations(id, shopify_location_id)")
    .eq("id", poId)
    .maybeSingle();
  if (!po?.location_id) return;

  const location = po.locations as unknown as {
    id: string;
    shopify_location_id: string | null;
  } | null;

  const lineIds = goodLines.map((l) => l.po_line_item_id);
  const { data: poLines } = await supabase
    .from("po_line_items")
    .select("id, sku, description")
    .in("id", lineIds);

  // Match line → variant via supplier_products.sku or product_variants.sku
  const { data: variants } = await supabase
    .from("product_variants")
    .select("id, sku, shopify_inventory_item_id")
    .eq("workspace_id", workspaceId);

  const variantBySku = new Map(
    (variants ?? [])
      .filter((v) => v.sku)
      .map((v) => [v.sku!.toLowerCase(), v] as const),
  );

  // Token is service-role only — never select it with the user client.
  const admin = createAdminClient();
  const { data: workspace } = await admin
    .from("workspaces")
    .select("shopify_domain")
    .eq("id", workspaceId)
    .maybeSingle();
  const { data: creds } = await admin
    .from("workspace_shopify_credentials")
    .select("access_token")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  for (const line of goodLines) {
    const poLine = (poLines ?? []).find((p) => p.id === line.po_line_item_id);
    const sku = poLine?.sku?.trim().toLowerCase();
    if (!sku) continue;
    const variant = variantBySku.get(sku);
    if (!variant) continue;

    const { data: existing } = await supabase
      .from("inventory_levels")
      .select("id, on_hand")
      .eq("product_variant_id", variant.id)
      .eq("location_id", po.location_id)
      .maybeSingle();

    const nextOnHand = (existing?.on_hand ?? 0) + line.qty_received;
    if (existing) {
      await supabase
        .from("inventory_levels")
        .update({
          on_hand: nextOnHand,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    } else {
      await supabase.from("inventory_levels").insert({
        workspace_id: workspaceId,
        product_variant_id: variant.id,
        location_id: po.location_id,
        on_hand: nextOnHand,
      });
    }

    // Push available adjustment to Shopify when connected + mapped.
    if (
      workspace?.shopify_domain &&
      creds?.access_token &&
      location?.shopify_location_id &&
      variant.shopify_inventory_item_id
    ) {
      try {
        await fetch(
          `https://${workspace.shopify_domain}/admin/api/2025-01/inventory_levels/adjust.json`,
          {
            method: "POST",
            headers: {
              "X-Shopify-Access-Token": creds.access_token,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              location_id: Number(location.shopify_location_id),
              inventory_item_id: Number(variant.shopify_inventory_item_id),
              available_adjustment: line.qty_received,
            }),
          },
        );
      } catch {
        // Local cache already updated; Shopify errors shouldn't block receiving.
      }
    }
  }
}
