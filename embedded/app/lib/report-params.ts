/**
 * Constrained Report Builder parameter surface.
 * Claude / heuristics map intent onto these allowlists — never raw SQL or arbitrary fields.
 */

export type ReportParamValue = string | number | boolean;
export type ReportParams = Record<string, ReportParamValue>;
export type ReportKind = "aggregate" | "listing";
export type ReportChartHint = "bar" | "line" | "grouped_bar";

export const REPORT_PERIODS = [
  "this_quarter",
  "last_quarter",
  "last_30d",
  "last_90d",
  "this_year",
  "last_year",
] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export const PO_STATUS_VALUES = [
  "draft",
  "sent",
  "viewed",
  "confirmed",
  "production",
  "shipped",
  "in_transit",
  "partially_received",
  "received",
  "closed",
  "rejected",
  "cancelled",
] as const;

export const RECEIPT_CONDITION_VALUES = [
  "good",
  "damaged",
  "wrong_item",
  "backorder",
] as const;

export type TemplateSchema = {
  id: string;
  question: string;
  blurb: string;
  starter: boolean;
  chartHint: ReportChartHint;
  needsOrders: boolean;
  kind: ReportKind;
  supportsDate: boolean;
  allowedParams: readonly string[];
  allowedColumns: readonly string[];
  allowedSorts: readonly string[];
  defaultColumns: readonly string[];
  defaultSort?: { by: string; dir: "asc" | "desc" };
  /** Patterns that must decline on this template instead of guessing another. */
  unsupported: ReadonlyArray<{ test: RegExp; reason: string }>;
};

const MARGIN_UNSUPPORTED: TemplateSchema["unsupported"] = [
  {
    test: /\b(this quarter|last quarter|last \d+\s*days|this year|last year|date range|between \d)/i,
    reason:
      "This is a current catalog snapshot — it has no date range. You can filter by supplier or margin threshold, or list closed POs for a period.",
  },
];

const LISTING_MARGIN_REASON =
  "This listing does not include profit margin, COGS, or retail — those come from catalog cost vs price, not PO/receipt rows. Available columns: {columns}. Or ask a new question like “Which suppliers are actually costing me margin?”";

export const REPORT_TEMPLATE_DEFS: TemplateSchema[] = [
  {
    id: "margin_by_supplier",
    question: "Which suppliers are actually costing me margin?",
    blurb: "Catalog retail vs unit cost, rolled up by supplier.",
    starter: true,
    chartHint: "bar",
    needsOrders: false,
    kind: "aggregate",
    supportsDate: false,
    allowedParams: [
      "limit",
      "min_margin_pct",
      "max_margin_pct",
      "supplier_q",
      "sort_by",
      "sort_dir",
      "columns",
    ],
    allowedColumns: [
      "supplier",
      "skus",
      "avg_cost",
      "avg_retail",
      "margin_pct",
      "unit_margin",
    ],
    allowedSorts: [
      "margin_pct",
      "supplier",
      "skus",
      "unit_margin",
      "avg_cost",
      "avg_retail",
    ],
    defaultColumns: [
      "supplier",
      "skus",
      "avg_cost",
      "avg_retail",
      "margin_pct",
      "unit_margin",
    ],
    defaultSort: { by: "margin_pct", dir: "asc" },
    unsupported: MARGIN_UNSUPPORTED,
  },
  {
    id: "spend_vs_revenue_by_supplier",
    question: "Compare spend vs. revenue by supplier.",
    blurb: "Closed PO spend next to Shopify order revenue on linked SKUs.",
    starter: true,
    chartHint: "grouped_bar",
    needsOrders: true,
    kind: "aggregate",
    supportsDate: true,
    allowedParams: [
      "limit",
      "supplier_q",
      "period",
      "date_from",
      "date_to",
      "sort_by",
      "sort_dir",
      "columns",
    ],
    allowedColumns: [
      "supplier",
      "spend",
      "revenue",
      "net",
      "po_count",
      "units_sold",
    ],
    allowedSorts: ["spend", "revenue", "net", "supplier", "po_count"],
    defaultColumns: [
      "supplier",
      "spend",
      "revenue",
      "net",
      "po_count",
      "units_sold",
    ],
    defaultSort: { by: "spend", dir: "desc" },
    unsupported: [
      {
        test: /\b(profit margin|margin %|catalog margin)\b/i,
        reason:
          "Spend vs revenue is PO spend next to order revenue, not catalog margin %. Available columns: supplier, spend, revenue, net, po_count, units_sold.",
      },
    ],
  },
  {
    id: "profit_vs_reliability",
    question: "Is my most profitable product also my most reliably-shipped one?",
    blurb: "Product margin crossed with supplier on-time rate.",
    starter: true,
    chartHint: "bar",
    needsOrders: false,
    kind: "aggregate",
    supportsDate: false,
    allowedParams: [
      "limit",
      "min_margin_pct",
      "max_margin_pct",
      "supplier_q",
      "sort_by",
      "sort_dir",
      "columns",
    ],
    allowedColumns: [
      "product",
      "sku",
      "supplier",
      "margin_pct",
      "on_time_pct",
      "reliable",
    ],
    allowedSorts: ["margin_pct", "on_time_pct", "product", "supplier"],
    defaultColumns: [
      "product",
      "sku",
      "supplier",
      "margin_pct",
      "on_time_pct",
      "reliable",
    ],
    defaultSort: { by: "margin_pct", dir: "desc" },
    unsupported: MARGIN_UNSUPPORTED,
  },
  {
    id: "spend_by_supplier",
    question: "Where is my closed PO spend going?",
    blurb: "Closed purchase-order totals by supplier.",
    starter: true,
    chartHint: "bar",
    needsOrders: false,
    kind: "aggregate",
    supportsDate: true,
    allowedParams: [
      "limit",
      "supplier_q",
      "period",
      "date_from",
      "date_to",
      "sort_by",
      "sort_dir",
      "columns",
    ],
    allowedColumns: ["supplier", "spend", "closed_pos"],
    allowedSorts: ["spend", "supplier", "closed_pos"],
    defaultColumns: ["supplier", "spend", "closed_pos"],
    defaultSort: { by: "spend", dir: "desc" },
    unsupported: [
      {
        test: /\b(profit margin|margin %|cogs)\b/i,
        reason:
          "Closed PO spend is purchase totals, not catalog margin or COGS. Available columns: supplier, spend, closed_pos. Or list the underlying POs.",
      },
    ],
  },
  {
    id: "late_suppliers",
    question: "Which suppliers miss ship dates most?",
    blurb: "On-time % from scorecards with enough closed history.",
    starter: true,
    chartHint: "bar",
    needsOrders: false,
    kind: "aggregate",
    supportsDate: false,
    allowedParams: ["limit", "supplier_q", "sort_by", "sort_dir", "columns"],
    allowedColumns: ["supplier", "completed_pos", "on_time_pct", "late_pct"],
    allowedSorts: ["late_pct", "on_time_pct", "completed_pos", "supplier"],
    defaultColumns: ["supplier", "completed_pos", "on_time_pct", "late_pct"],
    defaultSort: { by: "late_pct", dir: "desc" },
    unsupported: [
      {
        test: /\b(this quarter|last quarter|last \d+\s*days|this year)\b/i,
        reason:
          "On-time rates are from the current scorecard (5+ closed POs), not a date-ranged slice. You can filter by supplier or list closed POs for a period.",
      },
    ],
  },
  {
    id: "top_sku_margin",
    question: "Which SKUs have the thinnest margins right now?",
    blurb: "Per-SKU retail minus current vendor cost.",
    starter: true,
    chartHint: "bar",
    needsOrders: false,
    kind: "aggregate",
    supportsDate: false,
    allowedParams: [
      "limit",
      "min_margin_pct",
      "max_margin_pct",
      "supplier_q",
      "sort_by",
      "sort_dir",
      "columns",
    ],
    allowedColumns: ["product", "sku", "supplier", "cost", "retail", "margin_pct"],
    allowedSorts: ["margin_pct", "product", "supplier", "cost", "retail"],
    defaultColumns: [
      "product",
      "sku",
      "supplier",
      "cost",
      "retail",
      "margin_pct",
    ],
    defaultSort: { by: "margin_pct", dir: "asc" },
    unsupported: MARGIN_UNSUPPORTED,
  },
  {
    id: "dead_stock",
    question: "What's not selling?",
    blurb:
      "On-hand inventory with little or no recent order velocity (dead / excess stock).",
    starter: true,
    chartHint: "bar",
    needsOrders: true,
    kind: "aggregate",
    supportsDate: false,
    allowedParams: [
      "limit",
      "zero_sales_only",
      "lookback_days",
      "sort_by",
      "sort_dir",
      "columns",
    ],
    allowedColumns: [
      "product",
      "sku",
      "on_hand",
      "units_30d",
      "units_per_day",
      "days_of_cover",
      "velocity_note",
    ],
    allowedSorts: ["on_hand", "units_30d", "days_of_cover", "product"],
    defaultColumns: [
      "product",
      "sku",
      "on_hand",
      "units_30d",
      "units_per_day",
      "days_of_cover",
      "velocity_note",
    ],
    defaultSort: { by: "on_hand", dir: "desc" },
    unsupported: [
      {
        test: /\b(profit margin|po total|closed pos?)\b/i,
        reason:
          "Dead-stock is on-hand vs recent order velocity, not PO totals or catalog margin. Available columns: product, sku, on_hand, units_30d, units_per_day, days_of_cover, velocity_note.",
      },
    ],
  },
  {
    id: "cogs_by_product",
    question: "What's my real COGS by product/supplier/period?",
    blurb:
      "Requisly COGS from real purchase price history — Weighted Average or FIFO (Settings).",
    starter: true,
    chartHint: "bar",
    needsOrders: true,
    kind: "aggregate",
    supportsDate: false,
    allowedParams: [
      "limit",
      "lookback_days",
      "group_by",
      "period",
      "supplier_q",
      "sort_by",
      "sort_dir",
      "columns",
    ],
    allowedColumns: [
      "product",
      "sku",
      "kind",
      "supplier",
      "units",
      "avg_unit_cost",
      "cogs",
      "cost_source",
    ],
    allowedSorts: ["cogs", "units", "product", "supplier", "avg_unit_cost"],
    defaultColumns: [
      "product",
      "sku",
      "kind",
      "supplier",
      "units",
      "avg_unit_cost",
      "cogs",
      "cost_source",
    ],
    defaultSort: { by: "cogs", dir: "desc" },
    unsupported: [],
  },
  {
    id: "po_list",
    question: "List purchase orders",
    blurb: "Underlying PO rows — filterable by status, supplier, and date.",
    starter: false,
    chartHint: "bar",
    needsOrders: false,
    kind: "listing",
    supportsDate: true,
    allowedParams: [
      "limit",
      "status",
      "supplier_q",
      "period",
      "date_from",
      "date_to",
      "sort_by",
      "sort_dir",
      "columns",
    ],
    allowedColumns: [
      "po_number",
      "supplier",
      "status",
      "total",
      "ship_date",
      "arrival",
      "updated",
      "created_at",
    ],
    allowedSorts: [
      "total",
      "created_at",
      "po_number",
      "supplier",
      "status",
      "ship_date",
    ],
    defaultColumns: [
      "po_number",
      "supplier",
      "status",
      "total",
      "ship_date",
      "updated",
    ],
    defaultSort: { by: "created_at", dir: "desc" },
    unsupported: [
      {
        test: /\b(profit|margin|cogs|retail|on[- ]?hand|velocity|days of cover)\b/i,
        reason: LISTING_MARGIN_REASON.replace(
          "{columns}",
          "PO number, supplier, status, total, ship date, arrival, updated, created date",
        ),
      },
    ],
  },
  {
    id: "receipt_list",
    question: "List receipts",
    blurb: "Receipt line rows — filterable by condition, supplier, and date.",
    starter: false,
    chartHint: "bar",
    needsOrders: false,
    kind: "listing",
    supportsDate: true,
    allowedParams: [
      "limit",
      "condition",
      "supplier_q",
      "period",
      "date_from",
      "date_to",
      "sort_by",
      "sort_dir",
      "columns",
    ],
    allowedColumns: [
      "received_at",
      "po_number",
      "supplier",
      "sku",
      "description",
      "qty_received",
      "condition",
      "reason_note",
    ],
    allowedSorts: [
      "received_at",
      "po_number",
      "supplier",
      "qty_received",
      "condition",
    ],
    defaultColumns: [
      "received_at",
      "po_number",
      "supplier",
      "description",
      "qty_received",
      "condition",
    ],
    defaultSort: { by: "received_at", dir: "desc" },
    unsupported: [
      {
        test: /\b(profit|margin|cogs|spend|revenue|retail)\b/i,
        reason:
          "Receipt listings are receiving rows (qty + condition), not margin or spend. Available columns: received_at, po_number, supplier, sku, description, qty_received, condition, reason_note.",
      },
    ],
  },
];

export const TEMPLATE_SCHEMA_BY_ID: Record<string, TemplateSchema> =
  Object.fromEntries(REPORT_TEMPLATE_DEFS.map((t) => [t.id, t]));

export function getTemplateSchema(templateId: string): TemplateSchema | null {
  return TEMPLATE_SCHEMA_BY_ID[templateId] ?? null;
}

export function availableFieldsHint(templateId: string): string {
  const schema = getTemplateSchema(templateId);
  if (!schema) return "Try a starter card, or ask about margin, spend, POs, or receipts.";
  return `Available columns: ${schema.allowedColumns.join(", ")}. Sorts: ${schema.allowedSorts.join(", ")}.`;
}

const COLUMN_ALIASES: Record<string, string> = {
  "po number": "po_number",
  "po #": "po_number",
  po: "po_number",
  ponumber: "po_number",
  supplier: "supplier",
  vendor: "supplier",
  total: "total",
  amount: "total",
  spend: "spend",
  status: "status",
  date: "created_at",
  created: "created_at",
  "created at": "created_at",
  "created date": "created_at",
  "ship date": "ship_date",
  ship: "ship_date",
  arrival: "arrival",
  updated: "updated",
  margin: "margin_pct",
  "margin %": "margin_pct",
  "margin pct": "margin_pct",
  "profit margin": "margin_pct",
  sku: "sku",
  product: "product",
  cogs: "cogs",
  revenue: "revenue",
  net: "net",
  condition: "condition",
  qty: "qty_received",
  quantity: "qty_received",
  "qty received": "qty_received",
  description: "description",
  sku_code: "sku",
  received: "received_at",
  "received at": "received_at",
  reason: "reason_note",
  note: "reason_note",
  units: "units",
  cost: "cost",
  retail: "retail",
  skus: "skus",
};

const SORT_ALIASES: Record<string, string> = {
  ...COLUMN_ALIASES,
  date: "created_at",
  newest: "created_at",
  oldest: "created_at",
};

const STATUS_ALIASES: Record<string, string> = {
  draft: "draft",
  sent: "sent",
  viewed: "viewed",
  confirmed: "confirmed",
  production: "production",
  shipped: "shipped",
  "in transit": "in_transit",
  in_transit: "in_transit",
  "partially received": "partially_received",
  partially_received: "partially_received",
  received: "received",
  closed: "closed",
  rejected: "rejected",
  cancelled: "cancelled",
  canceled: "cancelled",
};

const CONDITION_ALIASES: Record<string, string> = {
  good: "good",
  damaged: "damaged",
  damage: "damaged",
  "wrong item": "wrong_item",
  wrong_item: "wrong_item",
  wrong: "wrong_item",
  backorder: "backorder",
  "back order": "backorder",
};

function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function resolvePeriod(
  period: string,
  now = new Date(),
): { date_from: string; date_to: string } | null {
  if (!REPORT_PERIODS.includes(period as ReportPeriod)) return null;
  const to = ymd(now);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  if (period === "last_30d") {
    const from = new Date(now);
    from.setUTCDate(from.getUTCDate() - 30);
    return { date_from: ymd(from), date_to: to };
  }
  if (period === "last_90d") {
    const from = new Date(now);
    from.setUTCDate(from.getUTCDate() - 90);
    return { date_from: ymd(from), date_to: to };
  }
  if (period === "this_year") {
    return { date_from: `${year}-01-01`, date_to: to };
  }
  if (period === "last_year") {
    return { date_from: `${year - 1}-01-01`, date_to: `${year - 1}-12-31` };
  }
  if (period === "this_quarter") {
    const qStart = Math.floor(month / 3) * 3;
    const from = new Date(Date.UTC(year, qStart, 1));
    return { date_from: ymd(from), date_to: to };
  }
  const qStart = Math.floor(month / 3) * 3 - 3;
  const start = new Date(Date.UTC(year, qStart, 1));
  const end = new Date(Date.UTC(year, qStart + 3, 0));
  return { date_from: ymd(start), date_to: ymd(end) };
}

export function resolveDateBounds(params: ReportParams): {
  from: string | null;
  to: string | null;
} {
  if (typeof params.period === "string") {
    const resolved = resolvePeriod(params.period);
    if (resolved) return { from: resolved.date_from, to: resolved.date_to };
  }
  return {
    from: typeof params.date_from === "string" ? params.date_from : null,
    to: typeof params.date_to === "string" ? params.date_to : null,
  };
}

/** Exclusive upper bound for a YYYY-MM-DD inclusive end date. */
export function dayAfterIso(ymdDate: string): string {
  const dt = new Date(`${ymdDate}T00:00:00.000Z`);
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString();
}

function clampLimit(n: number, listing: boolean): number {
  const max = listing ? 500 : 50;
  return Math.min(max, Math.max(1, Math.round(n)));
}

function sanitizeSearchValue(raw: string): string {
  return raw
    .trim()
    .slice(0, 80)
    .replace(/[%_,()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseColumnTokens(raw: string): string[] {
  return raw
    .split(/,|\band\b/i)
    .map((part) => part.replace(/[.“”"']/g, "").trim().toLowerCase())
    .filter(Boolean);
}

export function resolveColumnName(
  token: string,
  templateId?: string,
): string | null {
  const key = token.trim().toLowerCase().replace(/[_-]+/g, " ");
  const aliased = COLUMN_ALIASES[key] ?? key.replace(/\s+/g, "_");
  if (!templateId) return aliased;
  const schema = getTemplateSchema(templateId);
  if (!schema) return null;
  return schema.allowedColumns.includes(aliased) ? aliased : null;
}

export function resolveSortName(
  token: string,
  templateId: string,
): string | null {
  const key = token.trim().toLowerCase().replace(/[_-]+/g, " ");
  const aliased = SORT_ALIASES[key] ?? key.replace(/\s+/g, "_");
  const schema = getTemplateSchema(templateId);
  if (!schema) return null;
  return schema.allowedSorts.includes(aliased) ? aliased : null;
}

export function sanitizeReportParams(
  templateId: string,
  raw: Record<string, unknown> | null | undefined,
): ReportParams {
  const schema = getTemplateSchema(templateId);
  if (!schema || !raw || typeof raw !== "object") return {};
  const allowed = new Set(schema.allowedParams);
  const listing = schema.kind === "listing";
  const out: ReportParams = {};

  for (const [key, value] of Object.entries(raw)) {
    if (!allowed.has(key)) continue;
    if (typeof value === "boolean") {
      if (key === "zero_sales_only") out[key] = value;
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      if (key === "limit") out[key] = clampLimit(value, listing);
      else if (key.endsWith("_pct"))
        out[key] = Math.min(100, Math.max(0, Math.round(value * 10) / 10));
      else if (key === "lookback_days")
        out[key] = Math.min(365, Math.max(1, Math.round(value)));
      continue;
    }
    if (typeof value !== "string" || !value.trim()) continue;
    const trimmed = value.trim();
    if (key === "columns") {
      const cols = parseColumnTokens(trimmed)
        .map((tok) => resolveColumnName(tok, templateId))
        .filter((c): c is string => Boolean(c));
      const unique = [...new Set(cols)];
      if (unique.length) out.columns = unique.join(",");
      continue;
    }
    if (key === "sort_by") {
      const sort = resolveSortName(trimmed, templateId);
      if (sort) out.sort_by = sort;
      continue;
    }
    if (key === "sort_dir") {
      const dir = trimmed.toLowerCase();
      if (dir === "asc" || dir === "ascending" || dir === "lowest")
        out.sort_dir = "asc";
      else if (
        dir === "desc" ||
        dir === "descending" ||
        dir === "highest" ||
        dir === "high to low"
      )
        out.sort_dir = "desc";
      continue;
    }
    if (key === "period") {
      if (REPORT_PERIODS.includes(trimmed as ReportPeriod)) out.period = trimmed;
      continue;
    }
    if (key === "date_from" || key === "date_to") {
      if (isYmd(trimmed)) out[key] = trimmed;
      continue;
    }
    if (key === "status") {
      const status =
        STATUS_ALIASES[trimmed.toLowerCase().replace(/[_-]+/g, " ")];
      if (status) out.status = status;
      continue;
    }
    if (key === "condition") {
      const condition =
        CONDITION_ALIASES[trimmed.toLowerCase().replace(/[_-]+/g, " ")];
      if (condition) out.condition = condition;
      continue;
    }
    if (key === "group_by") {
      const g = trimmed.toLowerCase();
      if (g === "product" || g === "supplier") out.group_by = g;
      continue;
    }
    if (key === "supplier_q") {
      const q = sanitizeSearchValue(trimmed);
      if (q) out.supplier_q = q;
      continue;
    }
    if (key === "zero_sales_only") {
      out.zero_sales_only = trimmed === "true" || trimmed === "1";
      continue;
    }
    const n = Number(trimmed);
    if (Number.isFinite(n)) {
      if (key === "limit") out[key] = clampLimit(n, listing);
      else if (key.endsWith("_pct"))
        out[key] = Math.min(100, Math.max(0, Math.round(n * 10) / 10));
      else if (key === "lookback_days")
        out[key] = Math.min(365, Math.max(1, Math.round(n)));
    }
  }

  if (typeof out.period === "string" && schema.supportsDate) {
    const bounds = resolvePeriod(out.period);
    if (bounds) {
      out.date_from = bounds.date_from;
      out.date_to = bounds.date_to;
    }
  }

  if (templateId === "cogs_by_product" && typeof out.period === "string") {
    const bounds = resolvePeriod(out.period);
    if (bounds && out.lookback_days == null) {
      const from = new Date(`${bounds.date_from}T00:00:00.000Z`);
      const to = new Date(`${bounds.date_to}T00:00:00.000Z`);
      const days = Math.max(
        1,
        Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1,
      );
      out.lookback_days = Math.min(365, days);
    }
  }

  return out;
}

export function mergeReportParams(
  templateId: string,
  previous: ReportParams,
  next: ReportParams,
): ReportParams {
  return sanitizeReportParams(templateId, { ...previous, ...next });
}

export function refineRecords<T extends Record<string, unknown>>(
  templateId: string,
  records: T[],
  params: ReportParams,
): T[] {
  let out = records;
  if (typeof params.supplier_q === "string" && params.supplier_q) {
    const q = params.supplier_q.toLowerCase();
    out = out.filter((r) => String(r.supplier ?? "").toLowerCase().includes(q));
  }
  if (params.min_margin_pct != null) {
    const min = Number(params.min_margin_pct);
    out = out.filter((r) => Number(r.margin_pct) >= min);
  }
  if (params.max_margin_pct != null) {
    const max = Number(params.max_margin_pct);
    out = out.filter((r) => Number(r.margin_pct) <= max);
  }
  if (typeof params.sort_by === "string") {
    const schema = getTemplateSchema(templateId);
    const key = params.sort_by;
    if (schema?.allowedSorts.includes(key)) {
      const dir = params.sort_dir === "asc" ? 1 : -1;
      const defaultDir =
        params.sort_dir == null && schema.defaultSort?.by === key
          ? schema.defaultSort.dir === "asc"
            ? 1
            : -1
          : dir;
      const sign = params.sort_dir == null ? defaultDir : dir;
      out = [...out].sort((a, b) => compareRecordValues(a[key], b[key], sign));
    }
  }
  if (params.limit != null) {
    out = out.slice(0, Number(params.limit));
  }
  return out;
}

function compareRecordValues(a: unknown, b: unknown, sign: number): number {
  if (typeof a === "number" || typeof b === "number") {
    const an = Number(a);
    const bn = Number(b);
    if (Number.isFinite(an) && Number.isFinite(bn)) return (an - bn) * sign;
  }
  return (
    String(a ?? "").localeCompare(String(b ?? ""), undefined, {
      numeric: true,
      sensitivity: "base",
    }) * sign
  );
}

export function projectReportColumns(
  templateId: string,
  params: ReportParams,
  columns: string[],
  rows: Array<Array<string | number | null>>,
): { columns: string[]; rows: Array<Array<string | number | null>> } {
  if (typeof params.columns !== "string" || !params.columns) {
    return { columns, rows };
  }
  const wanted = params.columns
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const schema = getTemplateSchema(templateId);
  const allowed = new Set(schema?.allowedColumns ?? columns);
  const nextCols = wanted.filter(
    (c) => allowed.has(c) && columns.includes(c),
  );
  if (!nextCols.length) return { columns, rows };
  const idxs = nextCols.map((c) => columns.indexOf(c));
  return {
    columns: nextCols,
    rows: rows.map((row) => idxs.map((i) => row[i] ?? null)),
  };
}

export type ReportPromptContext = {
  templateId: string;
  params: ReportParams;
  prompt?: string | null;
};

export type HeuristicMatch = {
  templateId: string;
  params: ReportParams;
  confidence: "high" | "medium" | "low";
  explanation: string;
  declined: boolean;
};

function extractThresholds(prompt: string): ReportParams {
  const params: ReportParams = {};
  const below = prompt.match(
    /\b(?:below|under|less than|<)\s*(\d{1,3}(?:\.\d+)?)\s*%?/i,
  );
  const above = prompt.match(
    /\b(?:above|over|more than|greater than|>)\s*(\d{1,3}(?:\.\d+)?)\s*%?/i,
  );
  const topN = prompt.match(/\b(?:top|bottom|worst)\s*(\d{1,2})\b/i);
  if (below) params.max_margin_pct = Number(below[1]);
  if (above) params.min_margin_pct = Number(above[1]);
  if (topN) params.limit = Number(topN[1]);
  return params;
}

function extractPeriod(prompt: string): ReportPeriod | null {
  const p = prompt.toLowerCase();
  if (/\bthis quarter\b/.test(p)) return "this_quarter";
  if (/\blast quarter\b/.test(p)) return "last_quarter";
  if (/\blast 90\s*days\b/.test(p)) return "last_90d";
  if (/\blast 30\s*days\b/.test(p)) return "last_30d";
  if (/\bthis year\b/.test(p)) return "this_year";
  if (/\blast year\b/.test(p)) return "last_year";
  return null;
}

function extractStatus(prompt: string): string | null {
  const p = prompt.toLowerCase();
  for (const [alias, status] of Object.entries(STATUS_ALIASES)) {
    if (new RegExp(`\\b${alias}\\b`).test(p)) return status;
  }
  return null;
}

function extractCondition(prompt: string): string | null {
  const p = prompt.toLowerCase();
  if (/\bwrong items?\b/.test(p)) return "wrong_item";
  if (/\bback\s*orders?\b/.test(p)) return "backorder";
  if (/\bdamaged?\b/.test(p)) return "damaged";
  if (/\bgood condition\b/.test(p)) return "good";
  return null;
}

function looksLikeColumnRequest(prompt: string): boolean {
  return /\b(just show|only show|show (?:just|only)|export just|export only|only columns?|columns?:|fields?:)\b/i.test(
    prompt,
  );
}

function extractRequestedColumns(
  prompt: string,
  templateId?: string,
): { resolved: string[]; unknown: string[] } {
  const m = prompt.match(
    /\b(?:just show|only show|show (?:just|only)|export just|export only|only columns?|columns?:|fields?:)\s+(.+)$/i,
  );
  if (!m?.[1]) return { resolved: [], unknown: [] };
  const tokens = parseColumnTokens(
    m[1].replace(/\s+(instead|please|thanks).*$/i, ""),
  );
  const resolved: string[] = [];
  const unknown: string[] = [];
  for (const tok of tokens) {
    if (["the", "a", "an", "of", "to", "csv"].includes(tok)) continue;
    const col = resolveColumnName(tok, templateId);
    if (col) resolved.push(col);
    else unknown.push(tok);
  }
  return { resolved: [...new Set(resolved)], unknown };
}

function extractSort(
  prompt: string,
  templateId: string,
): { sort_by?: string; sort_dir?: string; unknown?: string } {
  const m = prompt.match(
    /\bsort(?:ed)?(?:\s+that)?\s+by\s+([a-z0-9 #]+?)(?:\s+(asc|desc|ascending|descending|lowest|highest))?(?:\s+instead)?\s*$/i,
  );
  if (!m?.[1]) return {};
  const sort = resolveSortName(m[1], templateId);
  if (!sort) return { unknown: m[1].trim() };
  let sort_dir: string | undefined;
  const dirRaw = (m[2] ?? "").toLowerCase();
  if (dirRaw === "asc" || dirRaw === "ascending" || dirRaw === "lowest")
    sort_dir = "asc";
  if (
    dirRaw === "desc" ||
    dirRaw === "descending" ||
    dirRaw === "highest" ||
    /\b(desc|descending|highest|high to low)\b/i.test(prompt)
  )
    sort_dir = "desc";
  if (/\b(asc|ascending|lowest|low to high)\b/i.test(prompt) && !sort_dir)
    sort_dir = "asc";
  return { sort_by: sort, sort_dir };
}

function extractSupplierQ(prompt: string): string | null {
  if (looksLikeColumnRequest(prompt)) return null;
  const from = prompt.match(
    /\bfrom\s+([A-Z][\w&.'’-]{1,40}(?:\s+[A-Z][\w&.'’-]{1,40}){0,5})/i,
  );
  if (from?.[1]) return sanitizeSearchValue(from[1]);
  const only = prompt.match(
    /\b(?:only|just)\s+([A-Za-z][\w&.'’-]{1,40}(?:\s+[A-Za-z][\w&.'’-]{1,40}){0,5})\s*$/i,
  );
  if (only?.[1]) {
    const name = only[1].trim();
    if (STATUS_ALIASES[name.toLowerCase()]) return null;
    if (CONDITION_ALIASES[name.toLowerCase()]) return null;
    return sanitizeSearchValue(name);
  }
  return null;
}

function extractLookbackDays(prompt: string): number | null {
  const m = prompt.match(/\b(?:last|past)\s+(\d{1,3})\s*days?\b/i);
  if (m) return Number(m[1]);
  return null;
}

function extractGroupBy(prompt: string): "product" | "supplier" | null {
  if (/\bby products?\b|\bper products?\b|\binstead of supplier\b/i.test(prompt))
    return "product";
  if (/\bby suppliers?\b|\bper suppliers?\b|\binstead of product\b/i.test(prompt))
    return "supplier";
  return null;
}

export function refersToCurrentReport(prompt: string): boolean {
  return /\b(these|those|this list|the same|same thing|that(?:\s+by)?|instead|just show|only show|export just|export only|sort(?:ed)?(?:\s+that)?\s+by|this quarter|last quarter|last \d+\s*days|narrow|filter)\b/i.test(
    prompt,
  );
}

export function detectUnsupportedOnTemplate(
  templateId: string,
  prompt: string,
): string | null {
  const schema = getTemplateSchema(templateId);
  if (!schema) return null;
  for (const rule of schema.unsupported) {
    if (rule.test.test(prompt)) return rule.reason;
  }
  if (looksLikeColumnRequest(prompt)) {
    const { resolved, unknown } = extractRequestedColumns(prompt, templateId);
    if (unknown.length && !resolved.length) {
      return `Those fields aren't on this report. ${availableFieldsHint(templateId)}`;
    }
  }
  const sort = extractSort(prompt, templateId);
  if (sort.unknown) {
    return `Can't sort by “${sort.unknown}” on this report. ${availableFieldsHint(templateId)}`;
  }
  const period = extractPeriod(prompt);
  if (period && !schema.supportsDate && templateId !== "cogs_by_product") {
    const dateRule = schema.unsupported.find((r) =>
      r.test.test("this quarter last 30 days"),
    );
    return (
      dateRule?.reason ??
      `This report doesn't have a date range. ${availableFieldsHint(templateId)}`
    );
  }
  return null;
}

function looksLikeListingPrompt(prompt: string): boolean {
  return /\b(list|show( me)? all|all (closed )?pos?|every po)\b/i.test(prompt);
}

function scoreNewTemplate(prompt: string): {
  id: string;
  score: number;
  why: string;
} | null {
  const p = prompt.toLowerCase();
  const cands: Array<{ id: string; score: number; why: string }> = [];
  const bump = (id: string, score: number, why: string) => {
    cands.push({ id, score, why });
  };

  if (
    looksLikeListingPrompt(prompt) &&
    /\b(pos?|purchase orders?)\b/.test(p) &&
    !/\b(spend|margin|revenue|cogs)\b/.test(p)
  ) {
    bump("po_list", 14, "PO listing");
  }
  if (
    /\breceipts?\b/.test(p) &&
    /\b(list|show|all|damaged|condition|wrong item|backorder)\b/.test(p) &&
    !/\b(margin|cogs|spend vs)\b/.test(p)
  ) {
    bump("receipt_list", 14, "receipt listing");
  }
  if (
    /\b(spend|costing|purchase).*\b(revenue|sales)\b|\brevenue\b.*\b(spend|cost)\b|\bspend vs\b|\bvs\.?\s*revenue\b/.test(
      p,
    )
  ) {
    bump("spend_vs_revenue_by_supplier", 10, "spend vs revenue");
  }
  if (
    /\b(profit|margin).*\b(reliable|on[- ]?time|ship)\b|\breliable.*\b(profit|margin)\b/.test(
      p,
    )
  ) {
    bump("profit_vs_reliability", 12, "profit vs reliability");
  }
  if (
    /\bmargin\b/.test(p) &&
    /\bsupplier/.test(p) &&
    !/\bsku|product|variant\b/.test(p)
  ) {
    bump("margin_by_supplier", 9, "margin by supplier");
  }
  if (
    /\b(costing me margin|thin(?:nest)? margins?|margin problem)\b/.test(p) &&
    !/\b(ship|late|reliable|sku|product)\b/.test(p)
  ) {
    bump("margin_by_supplier", 10, "margin pressure");
  }
  if (
    /\b(late|miss(?:es|ing)? ship|on[- ]?time|delivery reliability)\b/.test(p) &&
    /\bsupplier/.test(p)
  ) {
    bump("late_suppliers", 9, "late suppliers");
  }
  if (/\b(where.*(spend|money)|spend by supplier|po spend)\b/.test(p)) {
    bump("spend_by_supplier", 8, "spend by supplier");
  }
  if (/\b(sku|product).*\bmargin|\bmargin.*\b(sku|product)\b/.test(p)) {
    bump("top_sku_margin", 9, "SKU margins");
  }
  if (/\bthinnest\b.*\bmargin|\blow(?:est)? margin\b/.test(p)) {
    bump("top_sku_margin", 8, "thinnest margins");
  }
  if (
    /\b(dead.?stock|excess inventory|not selling|slow.?mov|sitting (in|on) (stock|inventory)|what.?s not selling)\b/.test(
      p,
    )
  ) {
    bump("dead_stock", 11, "dead stock / not selling");
  }
  if (
    /\b(cogs|cost of goods|real cogs|landed cogs|fifo|weighted average)\b/.test(
      p,
    )
  ) {
    bump("cogs_by_product", 12, "COGS by product/period");
  }

  if (!cands.length) return null;
  cands.sort((a, b) => b.score - a.score);
  return cands[0] ?? null;
}

function extractParamsForTemplate(
  prompt: string,
  templateId: string,
): ReportParams {
  const schema = getTemplateSchema(templateId);
  const raw: ReportParams = { ...extractThresholds(prompt) };
  const period = extractPeriod(prompt);
  if (period) raw.period = period;
  const lookback = extractLookbackDays(prompt);
  if (lookback != null) raw.lookback_days = lookback;
  const groupBy = extractGroupBy(prompt);
  if (groupBy) raw.group_by = groupBy;
  const supplierQ = extractSupplierQ(prompt);
  if (supplierQ) raw.supplier_q = supplierQ;
  if (schema?.allowedParams.includes("status")) {
    const status = extractStatus(prompt);
    if (status) raw.status = status;
  }
  if (schema?.allowedParams.includes("condition")) {
    const condition = extractCondition(prompt);
    if (condition) raw.condition = condition;
  }
  const cols = extractRequestedColumns(prompt, templateId);
  if (cols.resolved.length) raw.columns = cols.resolved.join(",");
  const sort = extractSort(prompt, templateId);
  if (sort.sort_by) raw.sort_by = sort.sort_by;
  if (sort.sort_dir) raw.sort_dir = sort.sort_dir;
  return sanitizeReportParams(templateId, raw);
}

function allowedPivot(
  previousId: string,
  groupBy: "product" | "supplier",
): string | null {
  if (previousId === "cogs_by_product") return "cogs_by_product";
  if (previousId === "margin_by_supplier" && groupBy === "product")
    return "top_sku_margin";
  if (previousId === "top_sku_margin" && groupBy === "supplier")
    return "margin_by_supplier";
  if (previousId === "spend_by_supplier" && groupBy === "product") return null;
  if (previousId === "po_list" || previousId === "receipt_list") return null;
  return null;
}

/**
 * Map a prompt onto an allowlisted template + params.
 * When `previous` is set, refinements inherit that template unless the user
 * clearly asks a different catalog question. Out-of-scope follow-ups decline.
 */
export function mapReportPromptHeuristic(
  promptRaw: string,
  previous?: ReportPromptContext | null,
): HeuristicMatch | null {
  const prompt = promptRaw.trim().slice(0, 500);
  if (!prompt) return null;

  if (previous?.templateId) {
    const unsupported = detectUnsupportedOnTemplate(previous.templateId, prompt);
    if (unsupported && refersToCurrentReport(prompt)) {
      return {
        templateId: "",
        params: previous.params,
        confidence: "low",
        explanation: unsupported,
        declined: true,
      };
    }

    const groupBy = extractGroupBy(prompt);
    if (groupBy && /\b(same thing|instead|now show|by product|by supplier)\b/i.test(prompt)) {
      const pivot = allowedPivot(previous.templateId, groupBy);
      if (pivot === null && previous.templateId !== "cogs_by_product") {
        const schema = getTemplateSchema(previous.templateId);
        return {
          templateId: "",
          params: previous.params,
          confidence: "low",
          explanation: `This report doesn't group by ${groupBy}. ${availableFieldsHint(previous.templateId)}${
            schema?.kind === "listing"
              ? " Listings are row-level — there is no product/supplier rollup on this view."
              : ""
          }`,
          declined: true,
        };
      }
      if (pivot === "cogs_by_product" || previous.templateId === "cogs_by_product") {
        return {
          templateId: "cogs_by_product",
          params: mergeReportParams("cogs_by_product", previous.params, {
            group_by: groupBy,
          }),
          confidence: "high",
          explanation: `Same COGS report, grouped by ${groupBy}.`,
          declined: false,
        };
      }
      if (pivot && pivot !== previous.templateId) {
        const meta = getTemplateSchema(pivot);
        return {
          templateId: pivot,
          params: sanitizeReportParams(pivot, {
            supplier_q: previous.params.supplier_q,
          }),
          confidence: "high",
          explanation: `Switched to “${meta?.question ?? pivot}” (${groupBy} view).`,
          declined: false,
        };
      }
    }

    const refinementParams = extractParamsForTemplate(prompt, previous.templateId);
    const isRefinement =
      looksLikeColumnRequest(prompt) ||
      /\bsort(?:ed)?(?:\s+that)?\s+by\b/i.test(prompt) ||
      Boolean(extractPeriod(prompt)) ||
      Boolean(extractSupplierQ(prompt)) ||
      (Boolean(extractStatus(prompt)) && previous.templateId === "po_list") ||
      (Boolean(extractCondition(prompt)) &&
        previous.templateId === "receipt_list") ||
      Object.keys(extractThresholds(prompt)).length > 0;

    if (isRefinement && refersToCurrentReport(prompt)) {
      if (
        looksLikeColumnRequest(prompt) &&
        !refinementParams.columns &&
        extractRequestedColumns(prompt, previous.templateId).unknown.length
      ) {
        return {
          templateId: "",
          params: previous.params,
          confidence: "low",
          explanation: `Those fields aren't on this report. ${availableFieldsHint(previous.templateId)}`,
          declined: true,
        };
      }
      return {
        templateId: previous.templateId,
        params: mergeReportParams(
          previous.templateId,
          previous.params,
          refinementParams,
        ),
        confidence: "high",
        explanation: `Same report, updated filters (${getTemplateSchema(previous.templateId)?.question ?? previous.templateId}).`,
        declined: false,
      };
    }
  }

  const scored = scoreNewTemplate(prompt);
  if (!scored) {
    if (previous?.templateId) {
      const refinementParams = extractParamsForTemplate(
        prompt,
        previous.templateId,
      );
      if (Object.keys(refinementParams).length) {
        return {
          templateId: previous.templateId,
          params: mergeReportParams(
            previous.templateId,
            previous.params,
            refinementParams,
          ),
          confidence: "high",
          explanation: `Applied that as a filter on “${getTemplateSchema(previous.templateId)?.question ?? previous.templateId}”.`,
          declined: false,
        };
      }
    }
    return null;
  }

  const params = extractParamsForTemplate(prompt, scored.id);
  const meta = getTemplateSchema(scored.id);
  return {
    templateId: scored.id,
    params,
    confidence: scored.score >= 9 ? "high" : "medium",
    explanation: `Matched “${meta?.question ?? scored.id}” (${scored.why}).`,
    declined: false,
  };
}

export function unmatchedExplanation(previous?: ReportPromptContext | null): string {
  if (previous?.templateId) {
    return `Couldn't map that follow-up onto this report. ${availableFieldsHint(previous.templateId)}`;
  }
  return "Couldn't match that to a built-in report. Try a starter card, or ask about margin, spend, revenue, closed POs, or receipts.";
}
