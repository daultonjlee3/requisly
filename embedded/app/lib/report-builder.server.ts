/**
 * Report Builder — template-only queries (never LLM-generated SQL).
 * Numbers are computed in code; Claude only narrates finished facts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { narrateInsight } from "./ai-narration.server";
import { createServiceClient } from "./supabase.server";
import { startTimer } from "./timing.server";
import { todayDateInputValue } from "./pricing";

export type ReportChartType = "bar" | "line" | "grouped_bar";

export type ReportChartSpec = {
  type: ReportChartType;
  title: string;
  series: Array<{
    name: string;
    data: Array<{ key: string; value: number | null }>;
  }>;
};

export type ReportFollowUp = {
  id: string;
  label: string;
  templateId: string;
  params: Record<string, string | number | boolean>;
};

export type ReportTemplateMeta = {
  id: string;
  question: string;
  blurb: string;
  /** Highlight on first load as a "killer" cross-join pitch. */
  starter: boolean;
  chartHint: ReportChartType;
  needsOrders: boolean;
};

export type ReportResult = {
  templateId: string;
  title: string;
  summary: string;
  body: string | null;
  narrationSource: "claude" | "template";
  columns: string[];
  rows: Array<Array<string | number | null>>;
  chart: ReportChartSpec | null;
  followUps: ReportFollowUp[];
  facts: Record<string, unknown>;
  timingMs: number;
  emptyReason?: string;
  /** Original merchant prompt when run from free text / a saved report. */
  prompt?: string | null;
  /** How the prompt was mapped onto a template. */
  matchExplanation?: string | null;
  params?: Record<string, string | number | boolean>;
};

export type SavedReportRow = {
  id: string;
  title: string;
  prompt: string;
  template_id: string;
  params: Record<string, string | number | boolean>;
  created_at: string;
  updated_at: string;
};

export const REPORT_TEMPLATES: ReportTemplateMeta[] = [
  {
    id: "margin_by_supplier",
    question: "Which suppliers are actually costing me margin?",
    blurb: "Catalog retail vs unit cost, rolled up by supplier.",
    starter: true,
    chartHint: "bar",
    needsOrders: false,
  },
  {
    id: "spend_vs_revenue_by_supplier",
    question: "Compare spend vs. revenue by supplier.",
    blurb: "Closed PO spend next to Shopify order revenue on linked SKUs.",
    starter: true,
    chartHint: "grouped_bar",
    needsOrders: true,
  },
  {
    id: "profit_vs_reliability",
    question: "Is my most profitable product also my most reliably-shipped one?",
    blurb: "Product margin crossed with supplier on-time rate.",
    starter: true,
    chartHint: "bar",
    needsOrders: false,
  },
  {
    id: "spend_by_supplier",
    question: "Where is my closed PO spend going?",
    blurb: "Closed purchase-order totals by supplier.",
    starter: true,
    chartHint: "bar",
    needsOrders: false,
  },
  {
    id: "late_suppliers",
    question: "Which suppliers miss ship dates most?",
    blurb: "On-time % from scorecards with enough closed history.",
    starter: true,
    chartHint: "bar",
    needsOrders: false,
  },
  {
    id: "top_sku_margin",
    question: "Which SKUs have the thinnest margins right now?",
    blurb: "Per-SKU retail minus current vendor cost.",
    starter: true,
    chartHint: "bar",
    needsOrders: false,
  },
];

function money(n: number) {
  return Math.round(n * 100) / 100;
}

function marginPct(retail: number, cost: number): number | null {
  if (!(retail > 0) || !Number.isFinite(cost)) return null;
  return Math.round(((retail - cost) / retail) * 1000) / 10;
}

async function currentCostMap(
  supabase: SupabaseClient,
  supplierProductIds: string[],
  asOf: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!supplierProductIds.length) return map;
  const { data, error } = await supabase
    .from("supplier_product_prices")
    .select("supplier_product_id, unit_cost, effective_date")
    .in("supplier_product_id", supplierProductIds)
    .lte("effective_date", asOf)
    .order("effective_date", { ascending: false });
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    const id = row.supplier_product_id as string;
    if (map.has(id)) continue;
    map.set(id, Number(row.unit_cost));
  }
  return map;
}

function applyFollowUpFilter(
  rows: Array<Record<string, number | string | null>>,
  params: Record<string, string | number | boolean>,
): Array<Record<string, number | string | null>> {
  let out = rows;
  if (params.min_margin_pct != null) {
    const min = Number(params.min_margin_pct);
    out = out.filter((r) => Number(r.margin_pct) >= min);
  }
  if (params.max_margin_pct != null) {
    const max = Number(params.max_margin_pct);
    out = out.filter((r) => Number(r.margin_pct) <= max);
  }
  if (params.limit != null) {
    out = out.slice(0, Number(params.limit));
  }
  return out;
}

async function computeMarginBySupplier(
  workspaceId: string,
  params: Record<string, string | number | boolean>,
  supabase: SupabaseClient,
) {
  const asOf = todayDateInputValue();
  const { data: products, error } = await supabase
    .from("supplier_products")
    .select(
      "id, title, sku, supplier_id, product_variant_id, unit_cost, suppliers(name), product_variants(retail_price, title)",
    )
    .eq("workspace_id", workspaceId)
    .not("product_variant_id", "is", null);
  if (error) throw new Error(error.message);

  const costMap = await currentCostMap(
    supabase,
    (products ?? []).map((p) => p.id),
    asOf,
  );

  const bySupplier = new Map<
    string,
    { name: string; skus: number; marginSum: number; costSum: number; retailSum: number }
  >();

  for (const sp of products ?? []) {
    const retail = Number(
      (sp.product_variants as { retail_price?: number | null } | null)
        ?.retail_price,
    );
    const cost = costMap.get(sp.id) ?? Number(sp.unit_cost);
    if (!(retail > 0) || !Number.isFinite(cost)) continue;
    const sid = sp.supplier_id as string;
    const name =
      (sp.suppliers as { name: string } | null)?.name ?? "Supplier";
    const entry = bySupplier.get(sid) ?? {
      name,
      skus: 0,
      marginSum: 0,
      costSum: 0,
      retailSum: 0,
    };
    entry.skus += 1;
    entry.marginSum += retail - cost;
    entry.costSum += cost;
    entry.retailSum += retail;
    bySupplier.set(sid, entry);
  }

  let records = [...bySupplier.entries()].map(([supplier_id, e]) => ({
    supplier_id,
    supplier: e.name,
    skus: e.skus,
    avg_cost: money(e.costSum / e.skus),
    avg_retail: money(e.retailSum / e.skus),
    margin_pct:
      e.retailSum > 0
        ? Math.round(((e.retailSum - e.costSum) / e.retailSum) * 1000) / 10
        : null,
    unit_margin: money(e.marginSum / e.skus),
  }));

  records.sort(
    (a, b) => (a.margin_pct ?? 999) - (b.margin_pct ?? 999),
  );
  records = applyFollowUpFilter(records, params) as typeof records;

  const columns = [
    "supplier",
    "skus",
    "avg_cost",
    "avg_retail",
    "margin_pct",
    "unit_margin",
  ];
  const rows = records.map((r) => [
    r.supplier,
    r.skus,
    r.avg_cost,
    r.avg_retail,
    r.margin_pct,
    r.unit_margin,
  ]);

  const chart: ReportChartSpec = {
    type: "bar",
    title: "Margin % by supplier (lower = thinner)",
    series: [
      {
        name: "Margin %",
        data: records.map((r) => ({
          key: r.supplier,
          value: r.margin_pct,
        })),
      },
    ],
  };

  const thinnest = records[0];
  const fallback = {
    summary: thinnest
      ? `${thinnest.supplier} shows the thinnest catalog margin at ${thinnest.margin_pct}% across ${thinnest.skus} linked SKU${thinnest.skus === 1 ? "" : "s"}.`
      : "No linked catalog SKUs with both retail price and unit cost yet.",
    body: thinnest
      ? `Avg cost $${thinnest.avg_cost} vs retail $${thinnest.avg_retail}.`
      : null,
  };

  return {
    title: "Margin by supplier",
    columns,
    rows,
    chart: records.length ? chart : null,
    records,
    fallback,
    followUps: [
      {
        id: "below_30",
        label: "Show me just the ones below 30%",
        templateId: "margin_by_supplier",
        params: { max_margin_pct: 30 },
      },
      {
        id: "top_5_thin",
        label: "Top 5 thinnest margins",
        templateId: "margin_by_supplier",
        params: { limit: 5 },
      },
    ] satisfies ReportFollowUp[],
    emptyReason: records.length
      ? undefined
      : "Link supplier products to Shopify variants with retail prices to compute margin.",
  };
}

async function computeSpendVsRevenue(
  workspaceId: string,
  params: Record<string, string | number | boolean>,
  supabase: SupabaseClient,
) {
  const { data: closed, error: cErr } = await supabase
    .from("purchase_orders")
    .select("supplier_id, total, suppliers(name)")
    .eq("workspace_id", workspaceId)
    .eq("status", "closed");
  if (cErr) throw new Error(cErr.message);

  const spend = new Map<string, { name: string; spend: number; poCount: number }>();
  for (const po of closed ?? []) {
    const sid = po.supplier_id as string;
    const name = (po.suppliers as { name: string } | null)?.name ?? "Supplier";
    const entry = spend.get(sid) ?? { name, spend: 0, poCount: 0 };
    entry.spend += Number(po.total) || 0;
    entry.poCount += 1;
    spend.set(sid, entry);
  }

  // Revenue: order lines → product_variant → preferred supplier_product
  const { data: lines, error: lErr } = await supabase
    .from("shopify_order_line_items")
    .select("product_variant_id, quantity, unit_price")
    .eq("workspace_id", workspaceId)
    .not("product_variant_id", "is", null);
  if (lErr) throw new Error(lErr.message);

  const variantIds = [
    ...new Set(
      (lines ?? [])
        .map((l) => l.product_variant_id as string)
        .filter(Boolean),
    ),
  ];

  const { data: links } = await supabase
    .from("supplier_products")
    .select("product_variant_id, supplier_id, suppliers(name)")
    .eq("workspace_id", workspaceId)
    .in(
      "product_variant_id",
      variantIds.length ? variantIds : ["00000000-0000-0000-0000-000000000000"],
    );

  const supplierByVariant = new Map<
    string,
    { supplier_id: string; name: string }
  >();
  for (const link of links ?? []) {
    const vid = link.product_variant_id as string;
    if (!vid || supplierByVariant.has(vid)) continue;
    supplierByVariant.set(vid, {
      supplier_id: link.supplier_id,
      name: (link.suppliers as { name: string } | null)?.name ?? "Supplier",
    });
  }

  const revenue = new Map<string, { name: string; revenue: number; units: number }>();
  for (const line of lines ?? []) {
    const vid = line.product_variant_id as string;
    const link = supplierByVariant.get(vid);
    if (!link) continue;
    const entry = revenue.get(link.supplier_id) ?? {
      name: link.name,
      revenue: 0,
      units: 0,
    };
    const qty = Number(line.quantity) || 0;
    const price = Number(line.unit_price) || 0;
    entry.revenue += qty * price;
    entry.units += qty;
    revenue.set(link.supplier_id, entry);
  }

  const ids = new Set([...spend.keys(), ...revenue.keys()]);
  let records = [...ids].map((id) => {
    const s = spend.get(id);
    const r = revenue.get(id);
    const spendAmt = money(s?.spend ?? 0);
    const revAmt = money(r?.revenue ?? 0);
    return {
      supplier: s?.name ?? r?.name ?? "Supplier",
      spend: spendAmt,
      revenue: revAmt,
      po_count: s?.poCount ?? 0,
      units_sold: r?.units ?? 0,
      net: money(revAmt - spendAmt),
    };
  });
  records.sort((a, b) => b.spend - a.spend);
  if (params.limit != null) records = records.slice(0, Number(params.limit));

  const columns = ["supplier", "spend", "revenue", "net", "po_count", "units_sold"];
  const rows = records.map((r) => [
    r.supplier,
    r.spend,
    r.revenue,
    r.net,
    r.po_count,
    r.units_sold,
  ]);

  const chart: ReportChartSpec = {
    type: "grouped_bar",
    title: "Spend vs revenue by supplier",
    series: [
      {
        name: "PO spend",
        data: records.map((r) => ({ key: r.supplier, value: r.spend })),
      },
      {
        name: "Order revenue",
        data: records.map((r) => ({ key: r.supplier, value: r.revenue })),
      },
    ],
  };

  const top = records[0];
  const fallback = {
    summary: top
      ? `${top.supplier}: $${top.spend.toFixed(2)} closed PO spend vs $${top.revenue.toFixed(2)} linked order revenue (net $${top.net.toFixed(2)}).`
      : "No closed PO spend or linked order revenue yet.",
    body:
      (lines ?? []).length === 0
        ? "Sync Shopify Orders (read_orders) to populate revenue."
        : null,
  };

  return {
    title: "Spend vs revenue by supplier",
    columns,
    rows,
    chart: records.length ? chart : null,
    records,
    fallback,
    followUps: [
      {
        id: "top_5",
        label: "Top 5 by spend",
        templateId: "spend_vs_revenue_by_supplier",
        params: { limit: 5 },
      },
      {
        id: "margin_view",
        label: "Which suppliers are actually costing me margin?",
        templateId: "margin_by_supplier",
        params: {},
      },
    ] satisfies ReportFollowUp[],
    emptyReason: records.length
      ? undefined
      : "Need closed POs and/or synced order lines linked to supplier catalog SKUs.",
  };
}

async function computeProfitVsReliability(
  workspaceId: string,
  params: Record<string, string | number | boolean>,
  supabase: SupabaseClient,
) {
  const asOf = todayDateInputValue();
  const [{ data: products, error: pErr }, { data: scorecards, error: sErr }] =
    await Promise.all([
      supabase
        .from("supplier_products")
        .select(
          "id, title, sku, supplier_id, unit_cost, product_variant_id, suppliers(name), product_variants(retail_price, title)",
        )
        .eq("workspace_id", workspaceId)
        .not("product_variant_id", "is", null),
      supabase
        .from("supplier_scorecards")
        .select("supplier_id, on_time_pct, completed_pos")
        .eq("workspace_id", workspaceId),
    ]);
  if (pErr) throw new Error(pErr.message);
  if (sErr) throw new Error(sErr.message);

  const onTime = new Map<string, number>();
  for (const sc of scorecards ?? []) {
    if (Number(sc.completed_pos) < 5) continue;
    onTime.set(sc.supplier_id, Number(sc.on_time_pct));
  }

  const costMap = await currentCostMap(
    supabase,
    (products ?? []).map((p) => p.id),
    asOf,
  );

  let records = (products ?? [])
    .map((sp) => {
      const retail = Number(
        (sp.product_variants as { retail_price?: number | null } | null)
          ?.retail_price,
      );
      const cost = costMap.get(sp.id) ?? Number(sp.unit_cost);
      const m = marginPct(retail, cost);
      if (m == null) return null;
      const ot = onTime.get(sp.supplier_id);
      return {
        product:
          sp.title ||
          (sp.product_variants as { title?: string } | null)?.title ||
          "Product",
        sku: sp.sku ?? "",
        supplier:
          (sp.suppliers as { name: string } | null)?.name ?? "Supplier",
        margin_pct: m,
        on_time_pct:
          ot == null || Number.isNaN(ot) ? null : Math.round(ot * 1000) / 10,
        reliable: ot != null && ot >= 0.7,
      };
    })
    .filter(Boolean) as Array<{
    product: string;
    sku: string;
    supplier: string;
    margin_pct: number;
    on_time_pct: number | null;
    reliable: boolean;
  }>;

  records.sort((a, b) => b.margin_pct - a.margin_pct);
  records = applyFollowUpFilter(records, params) as typeof records;
  if (params.limit != null) records = records.slice(0, Number(params.limit));

  const top = records[0];
  const columns = [
    "product",
    "sku",
    "supplier",
    "margin_pct",
    "on_time_pct",
    "reliable",
  ];
  const rows = records.map((r) => [
    r.product,
    r.sku,
    r.supplier,
    r.margin_pct,
    r.on_time_pct,
    r.reliable ? "yes" : "no",
  ]);

  const chart: ReportChartSpec = {
    type: "bar",
    title: "Top product margins (with supplier on-time when available)",
    series: [
      {
        name: "Margin %",
        data: records.slice(0, 8).map((r) => ({
          key: r.product.slice(0, 24),
          value: r.margin_pct,
        })),
      },
    ],
  };

  const fallback = {
    summary: top
      ? top.on_time_pct == null
        ? `${top.product} leads margin at ${top.margin_pct}%, but ${top.supplier} does not yet clear the on-time evidence gate (5+ closed POs).`
        : `${top.product} leads margin at ${top.margin_pct}% via ${top.supplier} (${top.on_time_pct}% on-time) — ${top.reliable ? "also reliable" : "not your most reliable shipper"}.`
      : "Need linked SKUs with retail + cost to cross margin against ship reliability.",
    body: null,
  };

  return {
    title: "Profit vs ship reliability",
    columns,
    rows,
    chart: records.length ? chart : null,
    records,
    fallback,
    followUps: [
      {
        id: "top_8",
        label: "Top 8 by margin",
        templateId: "profit_vs_reliability",
        params: { limit: 8 },
      },
      {
        id: "late_suppliers",
        label: "Which suppliers miss ship dates most?",
        templateId: "late_suppliers",
        params: {},
      },
    ] satisfies ReportFollowUp[],
    emptyReason: records.length
      ? undefined
      : "Link catalog SKUs with retail prices and keep closing POs for on-time rates.",
  };
}

async function computeSpendBySupplier(
  workspaceId: string,
  params: Record<string, string | number | boolean>,
  supabase: SupabaseClient,
) {
  const { data: closed, error } = await supabase
    .from("purchase_orders")
    .select("supplier_id, total, suppliers(name)")
    .eq("workspace_id", workspaceId)
    .eq("status", "closed");
  if (error) throw new Error(error.message);

  const map = new Map<string, { name: string; spend: number; count: number }>();
  for (const po of closed ?? []) {
    const sid = po.supplier_id as string;
    const name = (po.suppliers as { name: string } | null)?.name ?? "Supplier";
    const e = map.get(sid) ?? { name, spend: 0, count: 0 };
    e.spend += Number(po.total) || 0;
    e.count += 1;
    map.set(sid, e);
  }
  let records = [...map.values()]
    .map((e) => ({
      supplier: e.name,
      spend: money(e.spend),
      closed_pos: e.count,
    }))
    .sort((a, b) => b.spend - a.spend);
  if (params.limit != null) records = records.slice(0, Number(params.limit));

  const top = records[0];
  return {
    title: "Closed PO spend by supplier",
    columns: ["supplier", "spend", "closed_pos"],
    rows: records.map((r) => [r.supplier, r.spend, r.closed_pos]),
    chart: records.length
      ? ({
          type: "bar",
          title: "Closed PO spend",
          series: [
            {
              name: "Spend",
              data: records.map((r) => ({ key: r.supplier, value: r.spend })),
            },
          ],
        } satisfies ReportChartSpec)
      : null,
    records,
    fallback: {
      summary: top
        ? `${top.supplier} leads closed PO spend at $${top.spend.toFixed(2)} across ${top.closed_pos} orders.`
        : "No closed purchase orders yet.",
      body: null,
    },
    followUps: [
      {
        id: "vs_rev",
        label: "Compare spend vs. revenue by supplier.",
        templateId: "spend_vs_revenue_by_supplier",
        params: {},
      },
    ] satisfies ReportFollowUp[],
    emptyReason: records.length ? undefined : "Close purchase orders to see spend.",
  };
}

async function computeLateSuppliers(
  workspaceId: string,
  params: Record<string, string | number | boolean>,
  supabase: SupabaseClient,
) {
  const [{ data: scorecards, error }, { data: suppliers }] = await Promise.all([
    supabase
      .from("supplier_scorecards")
      .select("supplier_id, on_time_pct, completed_pos")
      .eq("workspace_id", workspaceId),
    supabase.from("suppliers").select("id, name").eq("workspace_id", workspaceId),
  ]);
  if (error) throw new Error(error.message);
  const names = new Map((suppliers ?? []).map((s) => [s.id, s.name]));

  let records = (scorecards ?? [])
    .filter((s) => Number(s.completed_pos) >= 5)
    .map((s) => {
      const onTime = Number(s.on_time_pct);
      return {
        supplier: names.get(s.supplier_id) ?? "Supplier",
        completed_pos: Number(s.completed_pos),
        on_time_pct: Math.round(onTime * 1000) / 10,
        late_pct: Math.round((1 - onTime) * 1000) / 10,
      };
    })
    .sort((a, b) => b.late_pct - a.late_pct);
  if (params.limit != null) records = records.slice(0, Number(params.limit));

  const top = records[0];
  return {
    title: "Suppliers by missed ship dates",
    columns: ["supplier", "completed_pos", "on_time_pct", "late_pct"],
    rows: records.map((r) => [
      r.supplier,
      r.completed_pos,
      r.on_time_pct,
      r.late_pct,
    ]),
    chart: records.length
      ? ({
          type: "bar",
          title: "Late % (higher is worse)",
          series: [
            {
              name: "Late %",
              data: records.map((r) => ({ key: r.supplier, value: r.late_pct })),
            },
          ],
        } satisfies ReportChartSpec)
      : null,
    records,
    fallback: {
      summary: top
        ? `${top.supplier} is late on roughly ${top.late_pct}% of ${top.completed_pos} closed orders.`
        : "Need 5+ closed POs per supplier for on-time evidence.",
      body: null,
    },
    followUps: [
      {
        id: "top_3",
        label: "Worst 3 late rates",
        templateId: "late_suppliers",
        params: { limit: 3 },
      },
    ] satisfies ReportFollowUp[],
    emptyReason: records.length
      ? undefined
      : "Scorecards unlock after 5 closed POs per supplier.",
  };
}

async function computeTopSkuMargin(
  workspaceId: string,
  params: Record<string, string | number | boolean>,
  supabase: SupabaseClient,
) {
  const asOf = todayDateInputValue();
  const { data: products, error } = await supabase
    .from("supplier_products")
    .select(
      "id, title, sku, unit_cost, suppliers(name), product_variants(retail_price, title)",
    )
    .eq("workspace_id", workspaceId)
    .not("product_variant_id", "is", null);
  if (error) throw new Error(error.message);
  const costMap = await currentCostMap(
    supabase,
    (products ?? []).map((p) => p.id),
    asOf,
  );

  let records = (products ?? [])
    .map((sp) => {
      const retail = Number(
        (sp.product_variants as { retail_price?: number | null } | null)
          ?.retail_price,
      );
      const cost = costMap.get(sp.id) ?? Number(sp.unit_cost);
      const m = marginPct(retail, cost);
      if (m == null) return null;
      return {
        product: sp.title,
        sku: sp.sku ?? "",
        supplier: (sp.suppliers as { name: string } | null)?.name ?? "Supplier",
        cost: money(cost),
        retail: money(retail),
        margin_pct: m,
      };
    })
    .filter(Boolean) as Array<{
    product: string;
    sku: string;
    supplier: string;
    cost: number;
    retail: number;
    margin_pct: number;
  }>;
  records.sort((a, b) => a.margin_pct - b.margin_pct);
  records = applyFollowUpFilter(records, params) as typeof records;
  if (params.limit == null) records = records.slice(0, 12);
  else records = records.slice(0, Number(params.limit));

  const top = records[0];
  return {
    title: "Thinnest SKU margins",
    columns: ["product", "sku", "supplier", "cost", "retail", "margin_pct"],
    rows: records.map((r) => [
      r.product,
      r.sku,
      r.supplier,
      r.cost,
      r.retail,
      r.margin_pct,
    ]),
    chart: records.length
      ? ({
          type: "bar",
          title: "Thinnest margins",
          series: [
            {
              name: "Margin %",
              data: records.map((r) => ({
                key: (r.sku || r.product).slice(0, 20),
                value: r.margin_pct,
              })),
            },
          ],
        } satisfies ReportChartSpec)
      : null,
    records,
    fallback: {
      summary: top
        ? `${top.product} (${top.sku || "no sku"}) is at ${top.margin_pct}% margin — $${top.cost} cost vs $${top.retail} retail.`
        : "No SKUs with both retail and cost.",
      body: null,
    },
    followUps: [
      {
        id: "below_30",
        label: "Only SKUs below 30% margin",
        templateId: "top_sku_margin",
        params: { max_margin_pct: 30, limit: 20 },
      },
    ] satisfies ReportFollowUp[],
    emptyReason: records.length
      ? undefined
      : "Set retail prices on variants linked to supplier products.",
  };
}

export async function runReportTemplate(opts: {
  workspaceId: string;
  templateId: string;
  params?: Record<string, string | number | boolean>;
  supabase?: SupabaseClient;
}): Promise<ReportResult> {
  const timer = startTimer(`report:${opts.templateId}`);
  const supabase = opts.supabase ?? createServiceClient();
  const params = opts.params ?? {};
  const meta = REPORT_TEMPLATES.find((t) => t.id === opts.templateId);
  if (!meta) {
    throw new Error(`Unknown report template: ${opts.templateId}`);
  }

  let computed: Awaited<ReturnType<typeof computeMarginBySupplier>>;
  switch (opts.templateId) {
    case "margin_by_supplier":
      computed = await computeMarginBySupplier(
        opts.workspaceId,
        params,
        supabase,
      );
      break;
    case "spend_vs_revenue_by_supplier":
      computed = await computeSpendVsRevenue(
        opts.workspaceId,
        params,
        supabase,
      );
      break;
    case "profit_vs_reliability":
      computed = await computeProfitVsReliability(
        opts.workspaceId,
        params,
        supabase,
      );
      break;
    case "spend_by_supplier":
      computed = await computeSpendBySupplier(
        opts.workspaceId,
        params,
        supabase,
      );
      break;
    case "late_suppliers":
      computed = await computeLateSuppliers(
        opts.workspaceId,
        params,
        supabase,
      );
      break;
    case "top_sku_margin":
      computed = await computeTopSkuMargin(
        opts.workspaceId,
        params,
        supabase,
      );
      break;
    default:
      throw new Error(`Unhandled template: ${opts.templateId}`);
  }

  const facts = {
    template_id: opts.templateId,
    title: computed.title,
    params,
    row_count: computed.rows.length,
    preview_rows: computed.records.slice(0, 8),
    empty_reason: computed.emptyReason ?? null,
  };

  const narrated = await narrateInsight({
    insightType: `report_${opts.templateId}`,
    facts,
    fallback: computed.fallback,
  });

  const timingMs = timer.end({
    rows: computed.rows.length,
    narration: narrated.source,
  });

  return {
    templateId: opts.templateId,
    title: computed.title,
    summary: narrated.summary,
    body: narrated.body,
    narrationSource: narrated.source,
    columns: computed.columns,
    rows: computed.rows,
    chart: computed.chart,
    followUps: computed.followUps,
    facts,
    timingMs,
    emptyReason: computed.emptyReason,
    prompt: null,
    matchExplanation: null,
    params,
  };
}

export async function listSavedReports(
  workspaceId: string,
): Promise<SavedReportRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("saved_reports")
    .select("id, title, prompt, template_id, params, created_at, updated_at")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    prompt: row.prompt as string,
    template_id: row.template_id as string,
    params: (row.params ?? {}) as Record<string, string | number | boolean>,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }));
}

export async function saveReportDefinition(opts: {
  workspaceId: string;
  title: string;
  prompt: string;
  templateId: string;
  params?: Record<string, string | number | boolean>;
}): Promise<SavedReportRow> {
  if (!REPORT_TEMPLATES.some((t) => t.id === opts.templateId)) {
    throw new Error(`Unknown report template: ${opts.templateId}`);
  }
  const title = opts.title.trim().slice(0, 120) || "Saved report";
  const prompt = opts.prompt.trim().slice(0, 500) || title;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("saved_reports")
    .insert({
      workspace_id: opts.workspaceId,
      title,
      prompt,
      template_id: opts.templateId,
      params: opts.params ?? {},
    })
    .select("id, title, prompt, template_id, params, created_at, updated_at")
    .single();
  if (error) throw new Error(error.message);
  return {
    id: data.id as string,
    title: data.title as string,
    prompt: data.prompt as string,
    template_id: data.template_id as string,
    params: (data.params ?? {}) as Record<string, string | number | boolean>,
    created_at: data.created_at as string,
    updated_at: data.updated_at as string,
  };
}

export async function deleteSavedReport(opts: {
  workspaceId: string;
  id: string;
}): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("saved_reports")
    .delete()
    .eq("workspace_id", opts.workspaceId)
    .eq("id", opts.id);
  if (error) throw new Error(error.message);
}

export async function pinReportToDashboard(opts: {
  workspaceId: string;
  result: ReportResult;
}): Promise<string> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("ai_insights")
    .insert({
      workspace_id: opts.workspaceId,
      agent: "reports",
      insight_type: "pinned_report",
      summary: opts.result.summary,
      body: opts.result.body,
      supporting_data: {
        template_id: opts.result.templateId,
        title: opts.result.title,
        columns: opts.result.columns,
        rows: opts.result.rows.slice(0, 25),
        chart: opts.result.chart,
        timing_ms: opts.result.timingMs,
        pinned: true,
      },
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function listPinnedReports(workspaceId: string, limit = 5) {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("ai_insights")
    .select(
      "id, agent, insight_type, summary, body, supporting_data, generated_at, dismissed",
    )
    .eq("workspace_id", workspaceId)
    .eq("insight_type", "pinned_report")
    .eq("dismissed", false)
    .order("generated_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}
