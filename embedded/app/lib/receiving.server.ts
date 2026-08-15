import { createServiceClient } from "./supabase.server";
import { sanitizeSearch } from "./list-table";
import type { PoStatus } from "./po-status";
import type {
  CorrectReceiptFormData,
  ReceiptCondition,
  ReceiveFormData,
} from "./po-types";

export type {
  CorrectReceiptFormData,
  ReceiptCondition,
  ReceiveFormData,
  ReceiveLine,
} from "./po-types";

type ReceiptLineInput = {
  po_line_item_id: string;
  qty_received: number;
  condition: ReceiptCondition;
  reason_note?: string;
};

type InventoryDeltaLine = {
  po_line_item_id: string;
  /** Signed Shopify / local inventory change (good units only). */
  delta: number;
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

/** Units that previously hit (or will hit) inventory — good condition only. */
function inventoryEffectiveQty(
  qty: number,
  condition: ReceiptCondition,
): number {
  return condition === "good" ? Math.max(0, qty) : 0;
}

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

export async function loadReceiptCorrectionForm(
  workspaceId: string,
  poId: string,
  receiptId: string,
): Promise<CorrectReceiptFormData | null> {
  const supabase = createServiceClient();

  const { data: receipt, error } = await supabase
    .from("receipts")
    .select(
      "id, note, created_at, po_id, workspace_id, purchase_orders(id, po_number, suppliers(name), locations(name)), receipt_line_items(id, po_line_item_id, qty_received, condition, reason_note, po_line_items(id, description, qty, sort_order))",
    )
    .eq("id", receiptId)
    .eq("workspace_id", workspaceId)
    .eq("po_id", poId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!receipt) return null;

  const po = receipt.purchase_orders as unknown as {
    id: string;
    po_number: string;
    suppliers: { name: string } | null;
    locations: { name: string } | null;
  } | null;

  const lines = (
    (receipt.receipt_line_items ?? []) as Array<{
      id: string;
      po_line_item_id: string;
      qty_received: number;
      condition: ReceiptCondition;
      reason_note: string | null;
      po_line_items: {
        id: string;
        description: string;
        qty: number;
        sort_order: number;
      } | null;
    }>
  )
    .slice()
    .sort(
      (a, b) =>
        (a.po_line_items?.sort_order ?? 0) - (b.po_line_items?.sort_order ?? 0),
    )
    .map((line) => ({
      id: line.id,
      poLineItemId: line.po_line_item_id,
      description: line.po_line_items?.description ?? "Line item",
      orderedQty: line.po_line_items?.qty ?? 0,
      qtyReceived: line.qty_received,
      condition: line.condition,
      reasonNote: line.reason_note,
    }));

  return {
    receiptId: receipt.id,
    poId: receipt.po_id,
    poNumber: po?.po_number ?? "PO",
    supplierName: po?.suppliers?.name ?? "—",
    locationName: po?.locations?.name ?? "Primary",
    note: receipt.note,
    createdAt: receipt.created_at,
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

  const nextStatus = await recomputePoReceiveStatus({
    supabase,
    poId,
    poLines: poLines ?? [],
    receivedSoFar,
    receiptId: receipt.id,
    mode: "receive",
  });

  await applyInventoryDeltas({
    workspaceId,
    poId,
    deltas: activeLines.map((line) => ({
      po_line_item_id: line.po_line_item_id,
      delta: inventoryEffectiveQty(line.qty_received, line.condition),
    })),
    admin,
  });

  return { nextStatus };
}

/**
 * Edit a submitted receipt. Inventory write-back uses (new good qty − old good qty)
 * so corrections never double-count or leave stale Shopify stock.
 */
export async function correctReceipt(opts: {
  workspaceId: string;
  poId: string;
  receiptId: string;
  note: string | null;
  lines: Array<{
    receipt_line_item_id: string;
    qty_received: number;
    condition: ReceiptCondition;
    reason_note?: string;
  }>;
  admin?: GraphqlAdmin;
}): Promise<{ nextStatus: PoStatus }> {
  const { workspaceId, poId, receiptId, note, lines, admin } = opts;
  const supabase = createServiceClient();

  const { data: receipt, error: receiptErr } = await supabase
    .from("receipts")
    .select(
      "id, po_id, workspace_id, receipt_line_items(id, po_line_item_id, qty_received, condition)",
    )
    .eq("id", receiptId)
    .eq("workspace_id", workspaceId)
    .eq("po_id", poId)
    .maybeSingle();
  if (receiptErr) throw new Error(receiptErr.message);
  if (!receipt) throw new Error("Receipt not found");

  const { data: po, error: poErr } = await supabase
    .from("purchase_orders")
    .select("id, status")
    .eq("id", poId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (poErr) throw new Error(poErr.message);
  if (!po) throw new Error("Purchase order not found");
  if (["draft", "cancelled", "rejected"].includes(po.status as string)) {
    throw new Error("This purchase order cannot have receipt corrections");
  }

  const existingById = new Map(
    (
      (receipt.receipt_line_items ?? []) as Array<{
        id: string;
        po_line_item_id: string;
        qty_received: number;
        condition: ReceiptCondition;
      }>
    ).map((row) => [row.id, row]),
  );

  if (!lines.length) throw new Error("No receipt lines to update");

  const deltas: InventoryDeltaLine[] = [];
  const changes: Array<{
    receipt_line_item_id: string;
    from_qty: number;
    to_qty: number;
    from_condition: ReceiptCondition;
    to_condition: ReceiptCondition;
    inventory_delta: number;
  }> = [];

  for (const line of lines) {
    const existing = existingById.get(line.receipt_line_item_id);
    if (!existing) throw new Error("Receipt line not found on this receipt");
    if (line.qty_received < 0) throw new Error("Quantity cannot be negative");
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

    const oldEffective = inventoryEffectiveQty(
      existing.qty_received,
      existing.condition,
    );
    const newEffective = inventoryEffectiveQty(
      line.qty_received,
      line.condition,
    );
    const inventoryDelta = newEffective - oldEffective;

    deltas.push({
      po_line_item_id: existing.po_line_item_id,
      delta: inventoryDelta,
    });
    changes.push({
      receipt_line_item_id: line.receipt_line_item_id,
      from_qty: existing.qty_received,
      to_qty: line.qty_received,
      from_condition: existing.condition,
      to_condition: line.condition,
      inventory_delta: inventoryDelta,
    });

    const { error: updateErr } = await supabase
      .from("receipt_line_items")
      .update({
        qty_received: line.qty_received,
        condition: line.condition,
        reason_note:
          line.condition === "good"
            ? null
            : String(line.reason_note ?? line.condition).trim(),
      })
      .eq("id", line.receipt_line_item_id)
      .eq("receipt_id", receiptId);
    if (updateErr) throw new Error(updateErr.message);
  }

  const { error: noteErr } = await supabase
    .from("receipts")
    .update({ note })
    .eq("id", receiptId);
  if (noteErr) throw new Error(noteErr.message);

  const { data: poLines, error: linesError } = await supabase
    .from("po_line_items")
    .select("id, qty")
    .eq("po_id", poId);
  if (linesError) throw new Error(linesError.message);

  const { data: allReceipts, error: allErr } = await supabase
    .from("receipts")
    .select("id, receipt_line_items(po_line_item_id, qty_received)")
    .eq("po_id", poId)
    .eq("workspace_id", workspaceId);
  if (allErr) throw new Error(allErr.message);

  const receivedSoFar = new Map<string, number>();
  for (const row of allReceipts ?? []) {
    const items = (row.receipt_line_items ?? []) as Array<{
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

  const nextStatus = await recomputePoReceiveStatus({
    supabase,
    poId,
    poLines: poLines ?? [],
    receivedSoFar,
    receiptId,
    mode: "correction",
    previousStatus: po.status as PoStatus,
    correctionChanges: changes,
  });

  await applyInventoryDeltas({
    workspaceId,
    poId,
    deltas,
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

async function recomputePoReceiveStatus(opts: {
  supabase: ReturnType<typeof createServiceClient>;
  poId: string;
  poLines: Array<{ id: string; qty: number }>;
  receivedSoFar: Map<string, number>;
  receiptId: string;
  mode: "receive" | "correction";
  previousStatus?: PoStatus;
  correctionChanges?: Array<{
    from_qty: number;
    to_qty: number;
    inventory_delta: number;
  }>;
}): Promise<PoStatus> {
  const {
    supabase,
    poId,
    poLines,
    receivedSoFar,
    receiptId,
    mode,
    previousStatus,
    correctionChanges,
  } = opts;

  const fullyReceived = poLines.every(
    (line) => (receivedSoFar.get(line.id) ?? 0) >= line.qty,
  );
  const anyReceived = poLines.some(
    (line) => (receivedSoFar.get(line.id) ?? 0) > 0,
  );

  let nextStatus: PoStatus;
  if (fullyReceived) {
    nextStatus = "closed";
  } else if (anyReceived) {
    nextStatus = "partially_received";
  } else {
    // All quantities corrected to zero — reopen to shipped so receiving can resume.
    nextStatus = "shipped";
  }

  const { error: statusError } = await supabase
    .from("purchase_orders")
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq("id", poId);
  if (statusError) throw new Error(statusError.message);

  if (mode === "receive") {
    if (fullyReceived) {
      await supabase.from("po_timeline_events").insert([
        {
          po_id: poId,
          event_type: "received",
          actor: "merchant",
          metadata: { receipt_id: receiptId },
        },
        {
          po_id: poId,
          event_type: "closed",
          actor: "system",
          metadata: { reason: "full_receipt", receipt_id: receiptId },
        },
      ]);
    } else {
      await supabase.from("po_timeline_events").insert({
        po_id: poId,
        event_type: "partially_received",
        actor: "merchant",
        metadata: { receipt_id: receiptId },
      });
    }
    return nextStatus;
  }

  const qtyChanges = (correctionChanges ?? []).filter(
    (c) => c.from_qty !== c.to_qty || c.inventory_delta !== 0,
  );
  const summary =
    qtyChanges.length === 0
      ? "Receipt corrected (condition/note only)"
      : `Receipt corrected · ${qtyChanges
          .map((c) => `${c.from_qty}→${c.to_qty}`)
          .join(", ")}`;

  await supabase.from("po_timeline_events").insert({
    po_id: poId,
    event_type: nextStatus === "shipped" ? "shipped" : nextStatus,
    actor: "merchant",
    metadata: {
      reason: "receipt_correction",
      receipt_id: receiptId,
      previous_status: previousStatus ?? null,
      summary,
      changes: correctionChanges ?? [],
    },
  });

  return nextStatus;
}

async function applyInventoryDeltas(opts: {
  workspaceId: string;
  poId: string;
  deltas: InventoryDeltaLine[];
  admin?: GraphqlAdmin;
}) {
  const { workspaceId, poId, deltas, admin } = opts;
  const supabase = createServiceClient();

  const active = deltas.filter((d) => d.delta !== 0);
  if (!active.length) return;

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

  const lineIds = active.map((l) => l.po_line_item_id);
  const { data: poLines } = await supabase
    .from("po_line_items")
    .select("id, sku, description, is_free_text")
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

  for (const line of active) {
    const poLine = (poLines ?? []).find((p) => p.id === line.po_line_item_id);
    if (!poLine || poLine.is_free_text) continue;

    const sku = poLine.sku?.trim().toLowerCase();
    if (!sku) continue;
    const variant = variantBySku.get(sku);
    if (!variant) continue;

    const { data: existing } = await supabase
      .from("inventory_levels")
      .select("id, on_hand")
      .eq("product_variant_id", variant.id)
      .eq("location_id", po.location_id)
      .maybeSingle();

    const nextOnHand = (existing?.on_hand ?? 0) + line.delta;
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
                reason: line.delta >= 0 ? "received" : "correction",
                name: "available",
                changes: [
                  {
                    delta: line.delta,
                    inventoryItemId: `gid://shopify/InventoryItem/${variant.shopify_inventory_item_id}`,
                    locationId: `gid://shopify/Location/${location.shopify_location_id}`,
                  },
                ],
              },
            },
          },
        );
      } catch {
        // Local cache already updated; Shopify errors shouldn't block correction.
      }
    }
  }
}

export type ReceiptListItem = {
  receiptId: string;
  receivedAt: string;
  poNumber: string;
  supplier: string;
  sku: string;
  description: string;
  qtyReceived: number;
  condition: ReceiptCondition;
  reasonNote: string | null;
};

/**
 * Flattened receipt lines for Report Builder listings.
 * Reuses the same receipts + line-item + PO/supplier joins as correction load.
 */
export async function listReceiptLinesForReport(
  workspaceId: string,
  filters?: {
    condition?: ReceiptCondition | null;
    supplierQ?: string | null;
    dateFrom?: string | null;
    dateTo?: string | null;
    cap?: number;
  },
): Promise<{ rows: ReceiptListItem[]; total: number }> {
  const supabase = createServiceClient();
  const cap = Math.min(5000, Math.max(1, filters?.cap ?? 500));
  const supplierQ = sanitizeSearch(filters?.supplierQ);

  let query = supabase
    .from("receipts")
    .select(
      "id, created_at, po_id, purchase_orders(po_number, supplier_id, suppliers(name)), receipt_line_items(id, qty_received, condition, reason_note, po_line_items(description, sku))",
      { count: "exact" },
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (filters?.dateFrom) {
    query = query.gte("created_at", `${filters.dateFrom}T00:00:00.000Z`);
  }
  if (filters?.dateTo) {
    const end = new Date(`${filters.dateTo}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    query = query.lt("created_at", end.toISOString());
  }
  if (supplierQ) {
    const { data: named, error: nameErr } = await supabase
      .from("suppliers")
      .select("id")
      .eq("workspace_id", workspaceId)
      .ilike("name", `%${supplierQ}%`);
    if (nameErr) throw new Error(nameErr.message);
    const supplierIds = (named ?? []).map((s) => s.id);
    if (!supplierIds.length) return { rows: [], total: 0 };
    const { data: pos, error: poErr } = await supabase
      .from("purchase_orders")
      .select("id")
      .eq("workspace_id", workspaceId)
      .in("supplier_id", supplierIds);
    if (poErr) throw new Error(poErr.message);
    const poIds = (pos ?? []).map((p) => p.id);
    if (!poIds.length) return { rows: [], total: 0 };
    query = query.in("po_id", poIds);
  }

  const { data, error, count } = await query.range(0, cap - 1);
  if (error) throw new Error(error.message);

  const rows: ReceiptListItem[] = [];
  for (const receipt of data ?? []) {
    const po = receipt.purchase_orders as unknown as {
      po_number: string;
      suppliers: { name: string } | null;
    } | null;
    const lines = (receipt.receipt_line_items ?? []) as Array<{
      qty_received: number;
      condition: ReceiptCondition;
      reason_note: string | null;
      po_line_items: { description?: string; sku?: string | null } | null;
    }>;
    for (const line of lines) {
      if (filters?.condition && line.condition !== filters.condition) continue;
      rows.push({
        receiptId: receipt.id as string,
        receivedAt: (receipt.created_at as string) ?? "",
        poNumber: po?.po_number ?? "PO",
        supplier: po?.suppliers?.name ?? "Supplier",
        sku: line.po_line_items?.sku ?? "",
        description: line.po_line_items?.description ?? "Line item",
        qtyReceived: Number(line.qty_received) || 0,
        condition: line.condition,
        reasonNote: line.reason_note,
      });
    }
  }
  return { rows, total: count ?? rows.length };
}
