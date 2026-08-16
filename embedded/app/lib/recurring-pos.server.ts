import { createPurchaseOrder } from "./purchase-orders.server";
import {
  createPoTemplate,
  getPoTemplateDetail,
  recordTemplateUse,
  type PoTemplateLineInput,
} from "./po-templates.server";
import {
  addUtcDays,
  clampInterval,
  clampLeadDays,
  isDue,
  isUpcoming,
  nextRunAfter,
  normalizeKind,
  occurrencesInRange,
  scheduleLabel,
  upcomingMeta,
  utcToday,
  type RecurringSchedule,
  type ScheduleKind,
} from "./recurring-po";
import { shortDate } from "./format";
import { createServiceClient } from "./supabase.server";

export type TemplateScheduleFields = RecurringSchedule & {
  lastRunOn: string | null;
  lastPoId: string | null;
  lastError: string | null;
};

export type UpcomingRecurringItem = {
  id: string;
  href: string;
  templateId: string;
  poId: string | null;
  primary: string;
  secondary: string;
  meta: string;
  right?: string;
  badgeLabel: string;
  badgeTone: "info" | "success" | "warning" | "attention";
};

type TemplateScheduleRow = {
  id: string;
  name: string;
  supplier_id: string | null;
  location_id: string | null;
  notes: string | null;
  payment_terms: string | null;
  status: string;
  schedule_enabled: boolean;
  schedule_kind: string;
  schedule_interval: number;
  schedule_day_of_month: number | null;
  schedule_lead_days: number;
  schedule_next_run_on: string | null;
  schedule_last_run_on: string | null;
  schedule_last_po_id: string | null;
  schedule_last_error: string | null;
  suppliers: { name: string } | null;
};

export function rowToSchedule(row: {
  schedule_enabled?: boolean | null;
  schedule_kind?: string | null;
  schedule_interval?: number | null;
  schedule_day_of_month?: number | null;
  schedule_lead_days?: number | null;
  schedule_next_run_on?: string | null;
}): RecurringSchedule {
  return {
    enabled: Boolean(row.schedule_enabled),
    kind: normalizeKind(row.schedule_kind),
    interval: clampInterval(Number(row.schedule_interval) || 1),
    dayOfMonth: row.schedule_day_of_month ?? null,
    leadDays: clampLeadDays(row.schedule_lead_days),
    nextRunOn: row.schedule_next_run_on ?? null,
  };
}

function templateSelect() {
  return "id, name, supplier_id, location_id, notes, payment_terms, status, schedule_enabled, schedule_kind, schedule_interval, schedule_day_of_month, schedule_lead_days, schedule_next_run_on, schedule_last_run_on, schedule_last_po_id, schedule_last_error, suppliers(name)";
}

export async function listUpcomingRecurringPOs(
  workspaceId: string,
  today = utcToday(),
): Promise<UpcomingRecurringItem[]> {
  const supabase = createServiceClient();
  const { data: templates, error } = await supabase
    .from("purchase_order_templates")
    .select(templateSelect())
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .eq("schedule_enabled", true);
  if (error) throw new Error(error.message);

  const items: UpcomingRecurringItem[] = [];
  const seenDraftIds = new Set<string>();

  for (const row of (templates ?? []) as unknown as TemplateScheduleRow[]) {
    const schedule = rowToSchedule(row);
    const supplierName = row.suppliers?.name ?? "No supplier";
    const cadence = scheduleLabel(schedule);

    if (isUpcoming(row.schedule_next_run_on, today, schedule.leadDays)) {
      items.push({
        id: `tmpl:${row.id}`,
        href: `/app/templates/${row.id}`,
        templateId: row.id,
        poId: null,
        primary: row.name,
        secondary: `${supplierName} · ${cadence}`,
        meta: upcomingMeta(row.schedule_next_run_on!, today),
        right: shortDate(row.schedule_next_run_on),
        badgeLabel: "Scheduled",
        badgeTone: row.schedule_next_run_on === today ? "warning" : "info",
      });
    }
  }

  const { data: drafts, error: dErr } = await supabase
    .from("purchase_orders")
    .select("id, po_number, source_template_id, suppliers(name)")
    .eq("workspace_id", workspaceId)
    .eq("status", "draft")
    .not("source_template_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(20);
  if (dErr) throw new Error(dErr.message);

  const scheduledById = new Map(
    ((templates ?? []) as unknown as TemplateScheduleRow[])
      .filter((t) => t.schedule_enabled)
      .map((t) => [t.id, t]),
  );

  for (const po of drafts ?? []) {
    const templateId = String(po.source_template_id ?? "");
    const tmpl = scheduledById.get(templateId);
    if (!tmpl) continue;
    const poId = String(po.id);
    if (seenDraftIds.has(poId)) continue;
    seenDraftIds.add(poId);
    const supplier = po.suppliers as unknown as { name: string } | null;
    items.unshift({
      id: `po:${poId}`,
      href: `/app/purchase-orders/${poId}`,
      templateId,
      poId,
      primary: po.po_number,
      secondary: `${supplier?.name ?? "—"} · ${tmpl.name}`,
      meta: "Draft ready to review — not sent",
      badgeLabel: "Draft",
      badgeTone: "attention",
    });
  }

  return items.slice(0, 12);
}

export async function listCalendarRecurringEvents(
  workspaceId: string,
  fromDate: string,
  toDate: string,
) {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("purchase_order_templates")
    .select(templateSelect())
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .eq("schedule_enabled", true);
  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as TemplateScheduleRow[]).flatMap((row) => {
    const schedule = rowToSchedule(row);
    const supplierName = row.suppliers?.name ?? "—";
    return occurrencesInRange(schedule, fromDate, toDate).map((plotDate) => ({
      id: `recurring:${row.id}:${plotDate}`,
      href: `/app/templates/${row.id}`,
      poNumber: row.name,
      statusLabel: "Scheduled",
      statusTone: "info" as const,
      total: "—",
      supplierName,
      plotDate,
      dateSource: "recurring" as const,
    }));
  });
}

async function createDraftFromTemplate(opts: {
  workspaceId: string;
  templateId: string;
  dueOn: string;
}): Promise<{ id: string; poNumber: string }> {
  const detail = await getPoTemplateDetail(opts.workspaceId, opts.templateId);
  if (!detail) throw new Error("Template not found");
  if (detail.status === "archived") throw new Error("Template is archived");
  if (!detail.supplierId) {
    throw new Error("Recurring template needs a supplier before it can draft");
  }
  if (!detail.lines.length) {
    throw new Error("Recurring template has no product lines");
  }

  const created = await createPurchaseOrder({
    workspaceId: opts.workspaceId,
    supplierId: detail.supplierId,
    locationId: detail.locationId,
    requestedShipDate: null,
    notes: [
      detail.notes?.trim() || "",
      `Drafted from recurring template "${detail.name}" for ${opts.dueOn}. Review and send — never auto-sent.`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    paymentTerms: detail.paymentTerms,
    lines: detail.lines.map((line) => ({
      description: line.description,
      sku: line.sku,
      qty: Number(line.qty) || 1,
      unit_cost: Number(line.unitCost) || 0,
      is_free_text: !line.supplierProductId,
      supplier_product_id: line.supplierProductId,
    })),
    source: "recurring_template",
    sourceTemplateId: opts.templateId,
  });

  await recordTemplateUse(opts.workspaceId, opts.templateId);
  return created;
}

export type RecurringRunResult = {
  workspaceId?: string;
  considered: number;
  created: Array<{ templateId: string; poId: string; poNumber: string }>;
  skipped: Array<{ templateId: string; reason: string }>;
  errors: Array<{ templateId: string; error: string }>;
};

async function runDueForWorkspace(
  workspaceId: string,
  today: string,
): Promise<RecurringRunResult> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("purchase_order_templates")
    .select(templateSelect())
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .eq("schedule_enabled", true)
    .lte("schedule_next_run_on", today);
  if (error) throw new Error(error.message);

  const result: RecurringRunResult = {
    workspaceId,
    considered: (data ?? []).length,
    created: [],
    skipped: [],
    errors: [],
  };

  for (const row of (data ?? []) as unknown as TemplateScheduleRow[]) {
    const schedule = rowToSchedule(row);
    if (!schedule.enabled || schedule.kind === "off" || !row.schedule_next_run_on) {
      result.skipped.push({ templateId: row.id, reason: "schedule off" });
      continue;
    }
    if (!isDue(row.schedule_next_run_on, today)) {
      result.skipped.push({ templateId: row.id, reason: "not due" });
      continue;
    }
    if (row.schedule_last_run_on === today) {
      result.skipped.push({ templateId: row.id, reason: "already drafted today" });
      continue;
    }

    try {
      const created = await createDraftFromTemplate({
        workspaceId,
        templateId: row.id,
        dueOn: row.schedule_next_run_on,
      });
      const next = nextRunAfter(schedule, today);
      const { error: upErr } = await supabase
        .from("purchase_order_templates")
        .update({
          schedule_last_run_on: today,
          schedule_last_po_id: created.id,
          schedule_next_run_on: next,
          schedule_last_error: null,
        })
        .eq("id", row.id)
        .eq("workspace_id", workspaceId);
      if (upErr) throw new Error(upErr.message);
      result.created.push({
        templateId: row.id,
        poId: created.id,
        poNumber: created.poNumber,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Draft failed";
      await supabase
        .from("purchase_order_templates")
        .update({ schedule_last_error: message })
        .eq("id", row.id)
        .eq("workspace_id", workspaceId);
      result.errors.push({ templateId: row.id, error: message });
    }
  }

  return result;
}

export async function runDueRecurringTemplates(opts?: {
  workspaceId?: string;
  today?: string;
}): Promise<{
  ok: true;
  workspaces: number;
  created: number;
  errors: number;
  results: RecurringRunResult[];
}> {
  const today = opts?.today ?? utcToday();
  const supabase = createServiceClient();

  let workspaceIds: string[] = [];
  if (opts?.workspaceId) {
    workspaceIds = [opts.workspaceId];
  } else {
    const { data, error } = await supabase
      .from("purchase_order_templates")
      .select("workspace_id")
      .eq("status", "active")
      .eq("schedule_enabled", true)
      .lte("schedule_next_run_on", today);
    if (error) throw new Error(error.message);
    workspaceIds = [
      ...new Set((data ?? []).map((r) => r.workspace_id as string)),
    ];
  }

  const results: RecurringRunResult[] = [];
  for (const workspaceId of workspaceIds) {
    results.push(await runDueForWorkspace(workspaceId, today));
  }

  return {
    ok: true,
    workspaces: results.length,
    created: results.reduce((n, r) => n + r.created.length, 0),
    errors: results.reduce((n, r) => n + r.errors.length, 0),
    results,
  };
}

export async function createRecurringFromCadenceInsight(opts: {
  workspaceId: string;
  insightId: string;
  createdByLabel?: string | null;
}): Promise<{ templateId: string; created: boolean }> {
  const supabase = createServiceClient();
  const { data: insight, error } = await supabase
    .from("ai_insights")
    .select("id, insight_type, supplier_id, supporting_data, dismissed")
    .eq("workspace_id", opts.workspaceId)
    .eq("id", opts.insightId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!insight) throw new Error("Insight not found");
  if (insight.insight_type !== "reorder_cadence") {
    throw new Error("This insight is not a reorder cadence");
  }
  const supplierId = insight.supplier_id as string | null;
  if (!supplierId) throw new Error("Cadence insight is missing a supplier");

  const support = (insight.supporting_data ?? {}) as {
    cadence_days?: number;
  };
  const cadenceDays = clampInterval(Number(support.cadence_days) || 14);
  const kind: ScheduleKind =
    cadenceDays % 7 === 0 ? "every_n_weeks" : "every_n_days";
  const interval = kind === "every_n_weeks" ? cadenceDays / 7 : cadenceDays;
  const today = utcToday();
  const schedule: RecurringSchedule = {
    enabled: true,
    kind,
    interval,
    dayOfMonth: null,
    leadDays: 7,
    nextRunOn: addUtcDays(today, cadenceDays),
  };

  const { data: existing } = await supabase
    .from("purchase_order_templates")
    .select("id, schedule_enabled")
    .eq("workspace_id", opts.workspaceId)
    .eq("supplier_id", supplierId)
    .eq("status", "active")
    .eq("schedule_enabled", true)
    .limit(1)
    .maybeSingle();
  if (existing?.id) {
    return { templateId: existing.id, created: false };
  }

  const { data: latestPo, error: poErr } = await supabase
    .from("purchase_orders")
    .select("id, po_number")
    .eq("workspace_id", opts.workspaceId)
    .eq("supplier_id", supplierId)
    .not("status", "eq", "cancelled")
    .not("status", "eq", "rejected")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (poErr) throw new Error(poErr.message);
  if (!latestPo) {
    throw new Error("No purchase order found for this supplier to copy lines from");
  }

  const { data: supplier } = await supabase
    .from("suppliers")
    .select("name")
    .eq("id", supplierId)
    .eq("workspace_id", opts.workspaceId)
    .maybeSingle();

  const { data: po } = await supabase
    .from("purchase_orders")
    .select(
      "supplier_id, location_id, notes, payment_terms, po_line_items(description, sku, qty, unit_cost, supplier_product_id, is_free_text, sort_order)",
    )
    .eq("id", latestPo.id)
    .eq("workspace_id", opts.workspaceId)
    .maybeSingle();
  if (!po) throw new Error("Purchase order not found");

  const lines: PoTemplateLineInput[] = (
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
      qty: Number(line.qty) || 1,
      unit_cost: Number(line.unit_cost) || 0,
      supplier_product_id: line.is_free_text ? null : line.supplier_product_id,
    }));
  if (!lines.length) throw new Error("Latest PO has no line items");

  const created = await createPoTemplate({
    workspaceId: opts.workspaceId,
    name: `${supplier?.name ?? "Supplier"} recurring`,
    description: `From reorder cadence (${cadenceDays} days). Review lines, then leave the schedule on — drafts only, never auto-sent.`,
    supplierId,
    locationId: po.location_id,
    notes: po.notes,
    paymentTerms: po.payment_terms,
    createdByLabel: opts.createdByLabel,
    sourcePoId: latestPo.id,
    lines,
    metadata: {
      from_cadence_insight: opts.insightId,
      cadence_days: cadenceDays,
    },
    schedule,
  });

  await supabase
    .from("ai_insights")
    .update({ dismissed: true })
    .eq("id", opts.insightId)
    .eq("workspace_id", opts.workspaceId);

  return { templateId: created.id, created: true };
}
