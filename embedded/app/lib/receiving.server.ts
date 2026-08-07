import { createServiceClient } from "./supabase.server";
import type { PoStatus } from "./po-status";
import type {
  ReceiptCondition,
  ReceiveFormData,
} from "./po-types";

export type { ReceiptCondition, ReceiveFormData, ReceiveLine } from "./po-types";

type ReceiptLineInput = {
  po_line_item_id: string;
  qty_received: number;
  condition: ReceiptCondition;
  reason_note?: string;
};

type GraphqlAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

const RECEIVABLE: PoStatus[] = [
  "shipped",
  "in_transit",
  "partially_received",
];

export async function loadReceiveForm(
  workspaceId: string,
  poId: string,
): Promise<ReceiveFormData | null> {
  const supabase = createServiceClient();

  const { data: po, error } = await supabase
    .from("purchase_orders")
    .select(
      "id, po_number, status, suppliers(name), locations(name), po_line_items(id, description, qty, sort_order)",
    )
    .eq("id", poId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!po) return null;

  const { data: receipts, error: receiptErr } = await supabase
    .from("receipts")
    .select("receipt_line_items(po_line_item_id, qty_received)")
    .eq("po_id", poId)
    .eq("workspace_id", workspaceId);
  if (receiptErr) throw new Error(receiptErr.message);

  const already = new Map<string, number>();
  for (const receipt of receipts ?? []) {
    const items = (receipt.receipt_line_items ?? []) as Array<{
      po_line_item_id: string;
      qty_received: number;
    }>;
    for (const item of items) {
      already.set(
        item.po_line_item_id,
        (already.get(item.po_line_item_id) ?? 0) + item.qty_received,
      );
    }
  }

  const supplier = po.suppliers as unknown as { name: string } | null;
  const location = po.locations as unknown as { name: string } | null;
  const lines = (
    (po.po_line_items ?? []) as Array<{
      id: string;
      description: string;
      qty: number;
      sort_order: number;
    }>
  )
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((line) => {
      const alreadyReceived = already.get(line.id) ?? 0;
      return {
        id: line.id,
        description: line.description,
        qty: line.qty,
        alreadyReceived,
        remaining: Math.max(line.qty - alreadyReceived, 0),
      };
    });

  return {
    poId: po.id,
    poNumber: po.po_number,
    supplierName: supplier?.name ?? "—",
    locationName: location?.name ?? "Primary",
    status: po.status as PoStatus,
    lines,
  };
}

export async function completeReceiving(opts: {
  workspaceId: string;
  poId: string;
  note: string | null;
  lines: ReceiptLineInput[];
  admin?: GraphqlAdmin;
}): Promise<{ nextStatus: PoStatus }> {
  const { workspaceId, poId, note, lines, admin } = opts;
  const supabase = createServiceClient();

  const { data: po, error: poErr } = await supabase
    .from("purchase_orders")
    .select("id, status, location_id")
    .eq("id", poId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (poErr) throw new Error(poErr.message);
  if (!po) throw new Error("Purchase order not found");
  if (!RECEIVABLE.includes(po.status as PoStatus)) {
    throw new Error("This PO is not ready to receive");
  }

  const activeLines = lines.filter((l) => l.qty_received > 0);
  if (!activeLines.length) {
    throw new Error("Enter at least one received quantity");
  }

  for (const line of activeLines) {
    if (
      !["good", "damaged", "wrong_item", "backorder"].includes(line.condition)
    ) {
      throw new Error("Invalid condition");
    }
    if (
      line.condition !== "good" &&
      !String(line.reason_note ?? "").trim()
    ) {
      throw new Error("Reason note is required for non-good conditions");
    }
  }

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
      workspace_id: workspaceId,
      received_by: null,
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
  if (!anyReceived) throw new Error("Nothing received");

  const nextStatus: PoStatus = fullyReceived ? "closed" : "partially_received";

  const { error: statusError } = await supabase
    .from("purchase_orders")
    .update({ status: nextStatus })
    .eq("id", poId);
  if (statusError) throw new Error(statusError.message);

  if (fullyReceived) {
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

  await applyInventoryForReceipt({
    workspaceId,
    poId,
    receiptLines: activeLines,
    admin,
  });

  return { nextStatus };
}

export async function closePurchaseOrder(opts: {
  workspaceId: string;
  poId: string;
}): Promise<void> {
  const supabase = createServiceClient();
  const { data: po, error } = await supabase
    .from("purchase_orders")
    .select("status")
    .eq("id", opts.poId)
    .eq("workspace_id", opts.workspaceId)
    .maybeSingle();
  if (error || !po) throw new Error(error?.message ?? "PO not found");
  if (po.status !== "partially_received") {
    throw new Error("Manual close is only available from Partially Received");
  }

  const { error: updateError } = await supabase
    .from("purchase_orders")
    .update({ status: "closed" })
    .eq("id", opts.poId);
  if (updateError) throw new Error(updateError.message);

  await supabase.from("po_timeline_events").insert({
    po_id: opts.poId,
    event_type: "closed",
    actor: "merchant",
    metadata: { reason: "manual_shortfall_close" },
  });
}

async function applyInventoryForReceipt(opts: {
  workspaceId: string;
  poId: string;
  receiptLines: ReceiptLineInput[];
  admin?: GraphqlAdmin;
}) {
  const { workspaceId, poId, receiptLines, admin } = opts;
  const supabase = createServiceClient();

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

  const { data: variants } = await supabase
    .from("product_variants")
    .select("id, sku, shopify_inventory_item_id")
    .eq("workspace_id", workspaceId);

  const variantBySku = new Map(
    (variants ?? [])
      .filter((v) => v.sku)
      .map((v) => [v.sku!.toLowerCase(), v] as const),
  );

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

    if (
      admin &&
      location?.shopify_location_id &&
      variant.shopify_inventory_item_id
    ) {
      try {
        await admin.graphql(
          `#graphql
            mutation RequislyInventoryAdjust($input: InventoryAdjustQuantitiesInput!) {
              inventoryAdjustQuantities(input: $input) {
                userErrors { field message }
              }
            }`,
          {
            variables: {
              input: {
                reason: "received",
                name: "available",
                changes: [
                  {
                    delta: line.qty_received,
                    inventoryItemId: `gid://shopify/InventoryItem/${variant.shopify_inventory_item_id}`,
                    locationId: `gid://shopify/Location/${location.shopify_location_id}`,
                  },
                ],
              },
            },
          },
        );
      } catch {
        // Local cache already updated; Shopify errors shouldn't block receiving.
      }
    }
  }
}
