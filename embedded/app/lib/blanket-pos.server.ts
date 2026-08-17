import { createServiceClient } from "./supabase.server";
import { money, shortDate } from "./format";
import {
  resolveListWindow,
  sanitizeSearch,
  type ListPageOpts,
  type ListPageResult,
} from "./list-table";
import {
  canDrawDown,
  committedLabel,
  effectiveStatus,
  nextRemainingOnCommitChange,
  parseOptionalAmount,
  periodLabel,
  remainingLabel,
  remainingProgress,
  statusLabel,
  statusTone,
  utcToday,
  type BlanketEffectiveStatus,
  type BlanketPickerOption,
  type BlanketStoredStatus,
} from "./blanket-po";

export type BlanketListItem = {
  id: string;
  supplierId: string;
  supplierName: string;
  blanketNumber: string;
  title: string;
  periodLabel: string;
  remainingLabel: string;
  committedLabel: string;
  status: BlanketEffectiveStatus;
  statusLabel: string;
  statusTone: ReturnType<typeof statusTone>;
  progress: number;
  notes: string | null;
  startDate: string | null;
  endDate: string | null;
  committedQty: number | null;
  committedValue: number | null;
  remainingQty: number | null;
  remainingValue: number | null;
};

export type BlanketDrawdownRow = {
  id: string;
  poId: string;
  poNumber: string;
  poStatus: string;
  qtyDrawn: number;
  valueDrawn: number;
  qtyLabel: string;
  valueLabel: string;
  remainingAfterLabel: string;
  reversed: boolean;
  createdLabel: string;
};

export type BlanketDetail = BlanketListItem & {
  storedStatus: BlanketStoredStatus;
  notes: string | null;
  drawdowns: BlanketDrawdownRow[];
};

type BlanketRow = {
  id: string;
  workspace_id: string;
  supplier_id: string;
  blanket_number: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  committed_qty: number | string | null;
  committed_value: number | string | null;
  remaining_qty: number | string | null;
  remaining_value: number | string | null;
  status: string;
  notes: string | null;
  suppliers?: { name: string } | { name: string }[] | null;
};

function numOrNull(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function supplierNameOf(row: BlanketRow): string {
  const s = row.suppliers;
  if (Array.isArray(s)) return s[0]?.name ?? "—";
  return s?.name ?? "—";
}

function mapListItem(row: BlanketRow, today: string): BlanketListItem {
  const committedQty = numOrNull(row.committed_qty);
  const committedValue = numOrNull(row.committed_value);
  const remainingQty = numOrNull(row.remaining_qty);
  const remainingValue = numOrNull(row.remaining_value);
  const stored = row.status === "closed" ? "closed" : "active";
  const status = effectiveStatus(
    {
      status: stored,
      startDate: row.start_date,
      endDate: row.end_date,
    },
    today,
  );
  return {
    id: row.id,
    supplierId: row.supplier_id,
    supplierName: supplierNameOf(row),
    blanketNumber: row.blanket_number,
    title: row.title,
    periodLabel: periodLabel(row.start_date, row.end_date, shortDate),
    remainingLabel: remainingLabel({ remainingQty, remainingValue }),
    committedLabel: committedLabel({ committedQty, committedValue }),
    status,
    statusLabel: statusLabel(status),
    statusTone: statusTone(status),
    progress: remainingProgress({
      committedQty,
      committedValue,
      remainingQty,
      remainingValue,
    }),
    notes: row.notes,
    startDate: row.start_date,
    endDate: row.end_date,
    committedQty,
    committedValue,
    remainingQty,
    remainingValue,
  };
}

function rpcMessage(error: { message?: string; details?: string } | null): string {
  const raw = String(error?.message || error?.details || "Blanket draw-down failed");
  return raw.replace(/^ERROR:\s*/i, "").split("\n")[0] ?? raw;
}

async function nextBlanketNumber(workspaceId: string): Promise<string> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("blanket_purchase_orders")
    .select("blanket_number")
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);

  let maxN = 1000;
  for (const row of data ?? []) {
    const digits = String(row.blanket_number ?? "").replace(/\D/g, "");
    if (!digits) continue;
    const n = Number(digits);
    if (Number.isFinite(n) && n > maxN) maxN = n;
  }
  return `BPO-${maxN + 1}`;
}

export async function listBlanketPurchaseOrders(
  workspaceId: string,
  opts?: { supplierId?: string | null },
): Promise<BlanketListItem[]> {
  const supabase = createServiceClient();
  let query = supabase
    .from("blanket_purchase_orders")
    .select(
      "id, workspace_id, supplier_id, blanket_number, title, start_date, end_date, committed_qty, committed_value, remaining_qty, remaining_value, status, notes, suppliers(name)",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (opts?.supplierId) query = query.eq("supplier_id", opts.supplierId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const today = utcToday();
  return (data ?? []).map((row) => mapListItem(row as BlanketRow, today));
}

export async function listBlanketsPage(
  workspaceId: string,
  opts?: ListPageOpts & { supplierId?: string | null },
): Promise<ListPageResult<BlanketListItem>> {
  const supabase = createServiceClient();
  const q = sanitizeSearch(opts?.q);
  const window = resolveListWindow(opts);
  let query = supabase
    .from("blanket_purchase_orders")
    .select(
      "id, workspace_id, supplier_id, blanket_number, title, start_date, end_date, committed_qty, committed_value, remaining_qty, remaining_value, status, notes, suppliers(name)",
      { count: "exact" },
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .range(window.from, window.to);
  if (opts?.supplierId) query = query.eq("supplier_id", opts.supplierId);
  if (q) {
    query = query.or(
      `blanket_number.ilike.%${q}%,title.ilike.%${q}%`,
    );
  }
  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  const today = utcToday();
  return {
    rows: (data ?? []).map((row) => mapListItem(row as BlanketRow, today)),
    total: count ?? 0,
  };
}

export async function listBlanketPickerOptions(
  workspaceId: string,
): Promise<BlanketPickerOption[]> {
  const rows = await listBlanketPurchaseOrders(workspaceId);
  const today = utcToday();
  return rows.map((row) => ({
    id: row.id,
    supplierId: row.supplierId,
    blanketNumber: row.blanketNumber,
    title: row.title,
    remainingLabel: row.remainingLabel,
    canDraw: canDrawDown(
      {
        committedQty: row.committedQty,
        committedValue: row.committedValue,
        remainingQty: row.remainingQty,
        remainingValue: row.remainingValue,
        status: row.status === "closed" ? "closed" : "active",
        startDate: row.startDate,
        endDate: row.endDate,
      },
      today,
    ),
  }));
}

export async function getBlanketDetail(
  workspaceId: string,
  blanketId: string,
): Promise<BlanketDetail | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("blanket_purchase_orders")
    .select(
      "id, workspace_id, supplier_id, blanket_number, title, start_date, end_date, committed_qty, committed_value, remaining_qty, remaining_value, status, notes, suppliers(name)",
    )
    .eq("workspace_id", workspaceId)
    .eq("id", blanketId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const today = utcToday();
  const item = mapListItem(data as BlanketRow, today);

  const { data: draws, error: dErr } = await supabase
    .from("blanket_po_drawdowns")
    .select(
      "id, po_id, qty_drawn, value_drawn, remaining_qty_after, remaining_value_after, reversed_at, created_at, purchase_orders(po_number, status)",
    )
    .eq("workspace_id", workspaceId)
    .eq("blanket_po_id", blanketId)
    .order("created_at", { ascending: false });
  if (dErr) throw new Error(dErr.message);

  return {
    ...item,
    storedStatus: data.status === "closed" ? "closed" : "active",
    notes: data.notes,
    drawdowns: (draws ?? []).map((row) => {
      const po = row.purchase_orders as unknown as {
        po_number: string;
        status: string;
      } | null;
      const qty = Number(row.qty_drawn) || 0;
      const value = Number(row.value_drawn) || 0;
      return {
        id: row.id,
        poId: row.po_id,
        poNumber: po?.po_number ?? "—",
        poStatus: po?.status ?? "",
        qtyDrawn: qty,
        valueDrawn: value,
        qtyLabel: Number.isInteger(qty) ? String(qty) : String(Number(qty.toFixed(4))),
        valueLabel: money(value),
        remainingAfterLabel: remainingLabel({
          remainingQty: numOrNull(row.remaining_qty_after),
          remainingValue: numOrNull(row.remaining_value_after),
        }),
        reversed: Boolean(row.reversed_at),
        createdLabel: shortDate(row.created_at),
      };
    }),
  };
}

export async function getBlanketSummaryForPo(
  workspaceId: string,
  blanketId: string | null | undefined,
  poId: string,
): Promise<{
  id: string;
  blanketNumber: string;
  title: string;
  remainingLabel: string;
  statusLabel: string;
  qtyDrawn: number;
  valueDrawn: number;
  qtyLabel: string;
  valueLabel: string;
  reversed: boolean;
} | null> {
  if (!blanketId) return null;
  const detail = await getBlanketDetail(workspaceId, blanketId);
  if (!detail) return null;
  const draw = detail.drawdowns.find((d) => d.poId === poId);
  return {
    id: detail.id,
    blanketNumber: detail.blanketNumber,
    title: detail.title,
    remainingLabel: detail.remainingLabel,
    statusLabel: detail.statusLabel,
    qtyDrawn: draw?.qtyDrawn ?? 0,
    valueDrawn: draw?.valueDrawn ?? 0,
    qtyLabel: draw?.qtyLabel ?? "0",
    valueLabel: draw?.valueLabel ?? money(0),
    reversed: draw?.reversed ?? false,
  };
}

export async function createBlanketPurchaseOrder(opts: {
  workspaceId: string;
  supplierId: string;
  title: string;
  startDate?: string | null;
  endDate?: string | null;
  committedQty?: unknown;
  committedValue?: unknown;
  notes?: string | null;
}): Promise<{ id: string; blanketNumber: string }> {
  const title = String(opts.title ?? "").trim();
  if (!title) throw new Error("Title is required");
  if (!opts.supplierId) throw new Error("Supplier is required");

  const committedQty = parseOptionalAmount(opts.committedQty);
  const committedValue = parseOptionalAmount(opts.committedValue);
  if (committedQty == null && committedValue == null) {
    throw new Error("Set a committed quantity, a committed value, or both");
  }

  const startDate = String(opts.startDate ?? "").trim() || null;
  const endDate = String(opts.endDate ?? "").trim() || null;
  if (startDate && endDate && endDate < startDate) {
    throw new Error("End date must be on or after the start date");
  }

  const supabase = createServiceClient();
  const { data: supplier, error: sErr } = await supabase
    .from("suppliers")
    .select("id")
    .eq("id", opts.supplierId)
    .eq("workspace_id", opts.workspaceId)
    .maybeSingle();
  if (sErr) throw new Error(sErr.message);
  if (!supplier) throw new Error("Supplier not found");

  const blanketNumber = await nextBlanketNumber(opts.workspaceId);
  const { data, error } = await supabase
    .from("blanket_purchase_orders")
    .insert({
      workspace_id: opts.workspaceId,
      supplier_id: opts.supplierId,
      blanket_number: blanketNumber,
      title,
      start_date: startDate,
      end_date: endDate,
      committed_qty: committedQty,
      committed_value: committedValue,
      remaining_qty: committedQty,
      remaining_value: committedValue,
      status: "active",
      notes: String(opts.notes ?? "").trim() || null,
    })
    .select("id, blanket_number")
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id, blanketNumber: data.blanket_number };
}

export async function updateBlanketPurchaseOrder(opts: {
  workspaceId: string;
  blanketId: string;
  title: string;
  startDate?: string | null;
  endDate?: string | null;
  committedQty?: unknown;
  committedValue?: unknown;
  notes?: string | null;
}): Promise<void> {
  const title = String(opts.title ?? "").trim();
  if (!title) throw new Error("Title is required");

  const nextCommittedQty = parseOptionalAmount(opts.committedQty);
  const nextCommittedValue = parseOptionalAmount(opts.committedValue);
  const startDate = String(opts.startDate ?? "").trim() || null;
  const endDate = String(opts.endDate ?? "").trim() || null;
  if (startDate && endDate && endDate < startDate) {
    throw new Error("End date must be on or after the start date");
  }

  const supabase = createServiceClient();
  const { data: current, error } = await supabase
    .from("blanket_purchase_orders")
    .select(
      "id, committed_qty, committed_value, remaining_qty, remaining_value, status",
    )
    .eq("id", opts.blanketId)
    .eq("workspace_id", opts.workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!current) throw new Error("Blanket PO not found");
  if (current.status === "closed") {
    throw new Error("Closed blanket POs cannot be edited");
  }

  const next = nextRemainingOnCommitChange({
    committedQty: numOrNull(current.committed_qty),
    committedValue: numOrNull(current.committed_value),
    remainingQty: numOrNull(current.remaining_qty),
    remainingValue: numOrNull(current.remaining_value),
    nextCommittedQty,
    nextCommittedValue,
  });
  if (!next.ok) throw new Error(next.message);

  const { error: uErr } = await supabase
    .from("blanket_purchase_orders")
    .update({
      title,
      start_date: startDate,
      end_date: endDate,
      committed_qty: nextCommittedQty,
      committed_value: nextCommittedValue,
      remaining_qty: next.remainingQty,
      remaining_value: next.remainingValue,
      notes: String(opts.notes ?? "").trim() || null,
    })
    .eq("id", opts.blanketId)
    .eq("workspace_id", opts.workspaceId);
  if (uErr) throw new Error(uErr.message);
}

export async function closeBlanketPurchaseOrder(
  workspaceId: string,
  blanketId: string,
): Promise<void> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("blanket_purchase_orders")
    .update({ status: "closed" })
    .eq("id", blanketId)
    .eq("workspace_id", workspaceId)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Blanket PO not found");
}

export async function deleteBlanketPurchaseOrder(
  workspaceId: string,
  blanketId: string,
): Promise<void> {
  const supabase = createServiceClient();
  const { count, error: cErr } = await supabase
    .from("blanket_po_drawdowns")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("blanket_po_id", blanketId);
  if (cErr) throw new Error(cErr.message);
  if ((count ?? 0) > 0) {
    throw new Error(
      "This blanket has draw-down history. Close it instead of deleting.",
    );
  }
  const { error } = await supabase
    .from("blanket_purchase_orders")
    .delete()
    .eq("id", blanketId)
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
}

export async function syncBlanketDrawdownForPo(
  workspaceId: string,
  poId: string,
): Promise<void> {
  const supabase = createServiceClient();
  const { data: po, error } = await supabase
    .from("purchase_orders")
    .select("id, status, total, supplier_id, blanket_po_id")
    .eq("id", poId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!po?.blanket_po_id) return;

  if (po.status === "cancelled" || po.status === "rejected") {
    const { error: rErr } = await supabase.rpc("release_blanket_po_drawdown", {
      p_workspace_id: workspaceId,
      p_po_id: poId,
    });
    if (rErr) throw new Error(rpcMessage(rErr));
    return;
  }

  const { data: blanket, error: bErr } = await supabase
    .from("blanket_purchase_orders")
    .select("id, supplier_id")
    .eq("id", po.blanket_po_id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (bErr) throw new Error(bErr.message);
  if (!blanket) throw new Error("Blanket PO not found");
  if (blanket.supplier_id !== po.supplier_id) {
    throw new Error("This blanket belongs to a different supplier");
  }

  const { data: lines, error: lErr } = await supabase
    .from("po_line_items")
    .select("qty")
    .eq("po_id", poId);
  if (lErr) throw new Error(lErr.message);
  const qty = (lines ?? []).reduce((sum, line) => sum + (Number(line.qty) || 0), 0);
  const value = Number(Number(po.total || 0).toFixed(2));

  const { error: aErr } = await supabase.rpc("apply_blanket_po_drawdown", {
    p_workspace_id: workspaceId,
    p_blanket_id: po.blanket_po_id,
    p_po_id: poId,
    p_qty: qty,
    p_value: value,
  });
  if (aErr) throw new Error(rpcMessage(aErr));
}

export async function releaseBlanketDrawdownForPo(
  workspaceId: string,
  poId: string,
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.rpc("release_blanket_po_drawdown", {
    p_workspace_id: workspaceId,
    p_po_id: poId,
  });
  if (error) throw new Error(rpcMessage(error));
}
