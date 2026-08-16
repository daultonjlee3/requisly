import { randomUUID } from "node:crypto";
import { createServiceClient } from "./supabase.server";
import { relativeTime, shortDate } from "./format";
import type { CreatePoInitialData } from "./po-types";
import {
  resolveListWindow,
  sanitizeSearch,
  type ListPageResult,
} from "./list-table";
import {
  normalizeKind,
  scheduleLabel,
  scheduleToDb,
  type RecurringSchedule,
} from "./recurring-po";

export type TemplateStatus = "active" | "archived";

export type PoTemplateLineInput = {
  description: string;
  sku?: string | null;
  qty: number;
  unit_cost: number;
  uom?: string | null;
  supplier_product_id?: string | null;
};

export type PoTemplateListItem = {
  id: string;
  name: string;
  description: string | null;
  supplierId: string | null;
  supplierName: string;
  productCount: number;
  status: TemplateStatus;
  useCount: number;
  lastUsedLabel: string;
  lastUsedAt: string | null;
  createdLabel: string;
  createdAt: string;
  createdBy: string;
  scheduleEnabled: boolean;
  scheduleLabel: string;
  scheduleNextRunOn: string | null;
};

export type PoTemplateDetail = {
  id: string;
  name: string;
  description: string | null;
  supplierId: string | null;
  supplierName: string;
  locationId: string | null;
  currency: string;
  notes: string | null;
  paymentTerms: string | null;
  status: TemplateStatus;
  useCount: number;
  lastUsedLabel: string;
  createdBy: string;
  sourcePoId: string | null;
  schedule: RecurringSchedule;
  scheduleLastError: string | null;
  lines: Array<{
    id: string;
    description: string;
    sku: string;
    qty: string;
    unitCost: string;
    uom: string;
    supplierProductId: string | null;
  }>;
};

export type TemplatePickerItem = {
  id: string;
  name: string;
  supplierName: string;
  productCount: number;
  useCount: number;
  lastUsedLabel: string;
};

function emptyToNull(value: unknown) {
  const s = String(value ?? "").trim();
  return s.length ? s : null;
}

export async function listPoTemplates(
  workspaceId: string,
  opts?: {
    q?: string | null;
    supplierId?: string | null;
    status?: TemplateStatus | "all" | null;
    sort?: "last_used" | "name" | "created" | null;
    page?: number;
    pageSize?: number;
    forExport?: boolean;
  },
): Promise<ListPageResult<PoTemplateListItem>> {
  const supabase = createServiceClient();
  const status = opts?.status ?? "active";
  const sort = opts?.sort ?? "last_used";
  const window = resolveListWindow(opts);
  const q = sanitizeSearch(opts?.q);

  let query = supabase
    .from("purchase_order_templates")
    .select(
      "id, name, description, supplier_id, status, use_count, last_used_at, created_at, created_by_label, schedule_enabled, schedule_kind, schedule_interval, schedule_day_of_month, schedule_lead_days, schedule_next_run_on, suppliers(name), purchase_order_template_lines(id, description, sku)",
      { count: "exact" },
    )
    .eq("workspace_id", workspaceId);

  if (status !== "all") {
    query = query.eq("status", status);
  }
  if (opts?.supplierId) {
    query = query.eq("supplier_id", opts.supplierId);
  }
  if (q) {
    const { data: named } = await supabase
      .from("suppliers")
      .select("id")
      .eq("workspace_id", workspaceId)
      .ilike("name", `%${q}%`);
    const supplierIds = (named ?? []).map((s) => s.id);
    query = supplierIds.length
      ? query.or(
          `name.ilike.%${q}%,description.ilike.%${q}%,supplier_id.in.(${supplierIds.join(",")})`,
        )
      : query.or(`name.ilike.%${q}%,description.ilike.%${q}%`);
  }

  if (sort === "name") {
    query = query.order("name", { ascending: true });
  } else if (sort === "created") {
    query = query.order("created_at", { ascending: false });
  } else {
    query = query
      .order("use_count", { ascending: false })
      .order("last_used_at", { ascending: false })
      .order("created_at", { ascending: false });
  }

  const { data, error, count } = await query.range(window.from, window.to);
  if (error) throw new Error(error.message);

  const rows = (data ?? []).map((row) => {
    const supplier = row.suppliers as unknown as { name: string } | null;
    const lines = (row.purchase_order_template_lines ?? []) as Array<{
      id: string;
    }>;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      supplierId: row.supplier_id,
      supplierName: supplier?.name ?? "No supplier",
      productCount: lines.length,
      status: row.status as TemplateStatus,
      useCount: row.use_count ?? 0,
      lastUsedAt: row.last_used_at,
      lastUsedLabel: row.last_used_at
        ? relativeTime(row.last_used_at)
        : "Never used",
      createdAt: row.created_at,
      createdLabel: shortDate(row.created_at),
      createdBy: row.created_by_label?.trim() || "Merchant",
      scheduleEnabled: Boolean(row.schedule_enabled),
      scheduleLabel: scheduleLabel({
        enabled: Boolean(row.schedule_enabled),
      kind: normalizeKind(row.schedule_kind),
        interval: Number(row.schedule_interval) || 1,
        dayOfMonth: row.schedule_day_of_month,
        leadDays: Number(row.schedule_lead_days) || 7,
        nextRunOn: row.schedule_next_run_on,
      }),
      scheduleNextRunOn: row.schedule_next_run_on,
    };
  });
  return { rows, total: count ?? rows.length };
}

export async function listTemplatePickerSuggestions(
  workspaceId: string,
): Promise<{
  recent: TemplatePickerItem[];
  mostUsed: TemplatePickerItem[];
  recentlyUsed: TemplatePickerItem[];
}> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("purchase_order_templates")
    .select(
      "id, name, use_count, last_used_at, created_at, suppliers(name), purchase_order_template_lines(id)",
    )
    .eq("workspace_id", workspaceId)
    .eq("status", "active");
  if (error) throw new Error(error.message);

  const mapped: TemplatePickerItem[] = (data ?? []).map((row) => {
    const supplier = row.suppliers as unknown as { name: string } | null;
    const lines = (row.purchase_order_template_lines ?? []) as Array<{
      id: string;
    }>;
    return {
      id: row.id,
      name: row.name,
      supplierName: supplier?.name ?? "No supplier",
      productCount: lines.length,
      useCount: row.use_count ?? 0,
      lastUsedLabel: row.last_used_at
        ? relativeTime(row.last_used_at)
        : "Never used",
      _createdAt: row.created_at as string,
      _lastUsedAt: row.last_used_at as string | null,
    } as TemplatePickerItem & {
      _createdAt: string;
      _lastUsedAt: string | null;
    };
  });

  const withMeta = mapped as Array<
    TemplatePickerItem & { _createdAt: string; _lastUsedAt: string | null }
  >;

  const recent = [...withMeta]
    .sort((a, b) => +new Date(b._createdAt) - +new Date(a._createdAt))
    .slice(0, 4)
    .map(stripMeta);

  const mostUsed = [...withMeta]
    .sort((a, b) => b.useCount - a.useCount || a.name.localeCompare(b.name))
    .filter((t) => t.useCount > 0)
    .slice(0, 4)
    .map(stripMeta);

  const recentlyUsed = [...withMeta]
    .filter((t) => t._lastUsedAt)
    .sort((a, b) => +new Date(b._lastUsedAt!) - +new Date(a._lastUsedAt!))
    .slice(0, 4)
    .map(stripMeta);

  return { recent, mostUsed, recentlyUsed };
}

function stripMeta(
  t: TemplatePickerItem & { _createdAt?: string; _lastUsedAt?: string | null },
): TemplatePickerItem {
  return {
    id: t.id,
    name: t.name,
    supplierName: t.supplierName,
    productCount: t.productCount,
    useCount: t.useCount,
    lastUsedLabel: t.lastUsedLabel,
  };
}

export async function getPoTemplateDetail(
  workspaceId: string,
  templateId: string,
): Promise<PoTemplateDetail | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("purchase_order_templates")
    .select(
      "*, suppliers(name), purchase_order_template_lines(*)",
    )
    .eq("workspace_id", workspaceId)
    .eq("id", templateId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const supplier = data.suppliers as unknown as { name: string } | null;
  const lines = (
    (data.purchase_order_template_lines ?? []) as Array<{
      id: string;
      description: string;
      sku: string | null;
      qty: number | string;
      unit_cost: number | string;
      uom: string | null;
      supplier_product_id: string | null;
      sort_order: number;
    }>
  ).sort((a, b) => a.sort_order - b.sort_order);

  return {
    id: data.id,
    name: data.name,
    description: data.description,
    supplierId: data.supplier_id,
    supplierName: supplier?.name ?? "No supplier",
    locationId: data.location_id,
    currency: data.currency ?? "USD",
    notes: data.notes,
    paymentTerms: data.payment_terms,
    status: data.status as TemplateStatus,
    useCount: data.use_count ?? 0,
    lastUsedLabel: data.last_used_at
      ? relativeTime(data.last_used_at)
      : "Never used",
    createdBy: data.created_by_label?.trim() || "Merchant",
    sourcePoId: data.source_po_id,
    schedule: {
      enabled: Boolean(data.schedule_enabled),
      kind: normalizeKind(data.schedule_kind),
      interval: Number(data.schedule_interval) || 1,
      dayOfMonth: data.schedule_day_of_month,
      leadDays: Number(data.schedule_lead_days) || 7,
      nextRunOn: data.schedule_next_run_on,
    },
    scheduleLastError: data.schedule_last_error ?? null,
    lines: lines.map((line) => ({
      id: line.id,
      description: line.description,
      sku: line.sku ?? "",
      qty: String(line.qty),
      unitCost: String(line.unit_cost),
      uom: line.uom ?? "",
      supplierProductId: line.supplier_product_id,
    })),
  };
}

async function replaceTemplateLines(
  workspaceId: string,
  templateId: string,
  lines: PoTemplateLineInput[],
) {
  const supabase = createServiceClient();
  const { error: delErr } = await supabase
    .from("purchase_order_template_lines")
    .delete()
    .eq("template_id", templateId)
    .eq("workspace_id", workspaceId);
  if (delErr) throw new Error(delErr.message);

  const cleaned = lines
    .map((line) => ({
      description: String(line.description ?? "").trim(),
      sku: emptyToNull(line.sku),
      qty: Number(line.qty) || 0,
      unit_cost: Number(line.unit_cost) || 0,
      uom: emptyToNull(line.uom),
      supplier_product_id: line.supplier_product_id || null,
    }))
    .filter((line) => line.description);

  if (!cleaned.length) return;

  const { error } = await supabase.from("purchase_order_template_lines").insert(
    cleaned.map((line, index) => ({
      workspace_id: workspaceId,
      template_id: templateId,
      description: line.description,
      sku: line.sku,
      qty: line.qty > 0 ? line.qty : 1,
      unit_cost: line.unit_cost,
      uom: line.uom,
      supplier_product_id: line.supplier_product_id,
      sort_order: index,
    })),
  );
  if (error) throw new Error(error.message);
}

export async function createPoTemplate(opts: {
  workspaceId: string;
  name: string;
  description?: string | null;
  supplierId?: string | null;
  locationId?: string | null;
  currency?: string | null;
  notes?: string | null;
  paymentTerms?: string | null;
  createdByLabel?: string | null;
  sourcePoId?: string | null;
  lines: PoTemplateLineInput[];
  metadata?: Record<string, unknown>;
  schedule?: RecurringSchedule;
}): Promise<{ id: string }> {
  const name = opts.name.trim();
  if (!name) throw new Error("Template name is required");
  if (!opts.lines.length) throw new Error("Add at least one product line");
  if (opts.schedule?.enabled && !opts.supplierId) {
    throw new Error("Pick a supplier before enabling a recurring schedule");
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("purchase_order_templates")
    .insert({
      workspace_id: opts.workspaceId,
      name,
      description: emptyToNull(opts.description),
      supplier_id: opts.supplierId || null,
      location_id: opts.locationId || null,
      currency: opts.currency?.trim() || "USD",
      notes: emptyToNull(opts.notes),
      payment_terms: emptyToNull(opts.paymentTerms),
      status: "active",
      created_by_label: emptyToNull(opts.createdByLabel) ?? "Merchant",
      source_po_id: opts.sourcePoId || null,
      metadata: {
        ...(opts.metadata ?? {}),
        line_count: opts.lines.length,
      },
      ...(opts.schedule ? scheduleToDb(opts.schedule) : {}),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await replaceTemplateLines(opts.workspaceId, data.id, opts.lines);
  return { id: data.id };
}

export async function updatePoTemplate(opts: {
  workspaceId: string;
  templateId: string;
  name: string;
  description?: string | null;
  supplierId?: string | null;
  locationId?: string | null;
  currency?: string | null;
  notes?: string | null;
  paymentTerms?: string | null;
  status?: TemplateStatus;
  lines: PoTemplateLineInput[];
  schedule?: RecurringSchedule;
}): Promise<void> {
  const name = opts.name.trim();
  if (!name) throw new Error("Template name is required");
  if (opts.schedule?.enabled && !opts.supplierId) {
    throw new Error("Pick a supplier before enabling a recurring schedule");
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("purchase_order_templates")
    .update({
      name,
      description: emptyToNull(opts.description),
      supplier_id: opts.supplierId || null,
      location_id: opts.locationId || null,
      currency: opts.currency?.trim() || "USD",
      notes: emptyToNull(opts.notes),
      payment_terms: emptyToNull(opts.paymentTerms),
      status: opts.status ?? "active",
      metadata: { line_count: opts.lines.length },
      ...(opts.schedule
        ? { ...scheduleToDb(opts.schedule), schedule_last_error: null }
        : {}),
    })
    .eq("id", opts.templateId)
    .eq("workspace_id", opts.workspaceId);
  if (error) throw new Error(error.message);

  await replaceTemplateLines(opts.workspaceId, opts.templateId, opts.lines);
}

export async function duplicatePoTemplate(opts: {
  workspaceId: string;
  templateId: string;
  createdByLabel?: string | null;
}): Promise<{ id: string }> {
  const detail = await getPoTemplateDetail(opts.workspaceId, opts.templateId);
  if (!detail) throw new Error("Template not found");

  return createPoTemplate({
    workspaceId: opts.workspaceId,
    name: `${detail.name} (copy)`,
    description: detail.description,
    supplierId: detail.supplierId,
    locationId: detail.locationId,
    currency: detail.currency,
    notes: detail.notes,
    paymentTerms: detail.paymentTerms,
    createdByLabel: opts.createdByLabel,
    sourcePoId: detail.sourcePoId,
    lines: detail.lines.map((line) => ({
      description: line.description,
      sku: line.sku,
      qty: Number(line.qty) || 1,
      unit_cost: Number(line.unitCost) || 0,
      uom: line.uom,
      supplier_product_id: line.supplierProductId,
    })),
    metadata: { duplicated_from: opts.templateId },
  });
}

export async function archivePoTemplate(
  workspaceId: string,
  templateId: string,
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("purchase_order_templates")
    .update({ status: "archived" })
    .eq("id", templateId)
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
}

export async function restorePoTemplate(
  workspaceId: string,
  templateId: string,
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("purchase_order_templates")
    .update({ status: "active" })
    .eq("id", templateId)
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
}

export async function deletePoTemplate(
  workspaceId: string,
  templateId: string,
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("purchase_order_templates")
    .delete()
    .eq("id", templateId)
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
}

export async function recordTemplateUse(
  workspaceId: string,
  templateId: string,
): Promise<void> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("purchase_order_templates")
    .select("use_count")
    .eq("id", templateId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return;

  const { error: updateErr } = await supabase
    .from("purchase_order_templates")
    .update({
      use_count: (data.use_count ?? 0) + 1,
      last_used_at: new Date().toISOString(),
    })
    .eq("id", templateId)
    .eq("workspace_id", workspaceId);
  if (updateErr) throw new Error(updateErr.message);
}

export async function templateToCreatePoInitial(
  workspaceId: string,
  templateId: string,
): Promise<CreatePoInitialData | null> {
  const detail = await getPoTemplateDetail(workspaceId, templateId);
  if (!detail || detail.status === "archived") return null;

  return {
    supplierId: detail.supplierId ?? undefined,
    locationId: detail.locationId,
    notes: detail.notes ?? "",
    paymentTerms: detail.paymentTerms ?? "",
    lines: detail.lines.map((line) => ({
      key: randomUUID(),
      description: line.description,
      sku: line.sku,
      qty: line.qty || "1",
      unitCost: line.unitCost,
      isFreeText: !line.supplierProductId,
      supplierProductId: line.supplierProductId,
      shopifyVariantId: null,
      fromCatalogPrice: Boolean(line.supplierProductId),
      costSource: line.unitCost ? ("catalog" as const) : null,
    })),
  };
}

export async function savePurchaseOrderAsTemplate(opts: {
  workspaceId: string;
  poId: string;
  name: string;
  description?: string | null;
  replaceTemplateId?: string | null;
  saveSupplier: boolean;
  saveQuantities: boolean;
  savePricing: boolean;
  createdByLabel?: string | null;
}): Promise<{ id: string }> {
  const name = opts.name.trim();
  if (!name) throw new Error("Template name is required");

  const supabase = createServiceClient();
  const { data: po, error } = await supabase
    .from("purchase_orders")
    .select(
      "id, supplier_id, location_id, notes, payment_terms, po_line_items(description, sku, qty, unit_cost, supplier_product_id, is_free_text, sort_order)",
    )
    .eq("id", opts.poId)
    .eq("workspace_id", opts.workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!po) throw new Error("Purchase order not found");

  const lines = (
    (po.po_line_items ?? []) as Array<{
      description: string;
      sku: string | null;
      qty: number;
      unit_cost: number;
      supplier_product_id: string | null;
      is_free_text: boolean;
      sort_order: number;
    }>
  )
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((line) => ({
      description: line.description,
      sku: line.sku,
      qty: opts.saveQuantities ? Number(line.qty) || 1 : 1,
      unit_cost: opts.savePricing ? Number(line.unit_cost) || 0 : 0,
      uom: null as string | null,
      supplier_product_id: line.is_free_text ? null : line.supplier_product_id,
    }));

  if (!lines.length) throw new Error("PO has no line items to save");

  const payload = {
    workspaceId: opts.workspaceId,
    name,
    description: opts.description,
    supplierId: opts.saveSupplier ? po.supplier_id : null,
    locationId: po.location_id,
    notes: po.notes,
    paymentTerms: po.payment_terms,
    createdByLabel: opts.createdByLabel,
    sourcePoId: po.id,
    lines,
    metadata: {
      saved_from_po: po.id,
      save_supplier: opts.saveSupplier,
      save_quantities: opts.saveQuantities,
      save_pricing: opts.savePricing,
    },
  };

  if (opts.replaceTemplateId) {
    await updatePoTemplate({
      workspaceId: opts.workspaceId,
      templateId: opts.replaceTemplateId,
      name: payload.name,
      description: payload.description,
      supplierId: payload.supplierId,
      locationId: payload.locationId,
      notes: payload.notes,
      paymentTerms: payload.paymentTerms,
      status: "active",
      lines: payload.lines,
    });
    const supabase2 = createServiceClient();
    await supabase2
      .from("purchase_order_templates")
      .update({
        source_po_id: po.id,
        metadata: payload.metadata,
      })
      .eq("id", opts.replaceTemplateId)
      .eq("workspace_id", opts.workspaceId);
    return { id: opts.replaceTemplateId };
  }

  return createPoTemplate(payload);
}

export async function createTemplateFromPo(
  workspaceId: string,
  poId: string,
  createdByLabel?: string | null,
): Promise<{ id: string }> {
  const supabase = createServiceClient();
  const { data: po, error } = await supabase
    .from("purchase_orders")
    .select("po_number")
    .eq("id", poId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!po) throw new Error("Purchase order not found");

  return savePurchaseOrderAsTemplate({
    workspaceId,
    poId,
    name: `From ${po.po_number}`,
    description: `Created from purchase order ${po.po_number}`,
    saveSupplier: true,
    saveQuantities: true,
    savePricing: true,
    createdByLabel,
  });
}
