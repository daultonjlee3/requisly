/**
 * COGS calculator — Weighted Average (default) or FIFO.
 * Numbers computed in code only. Never auto-reconciles with QuickBooks.
 *
 * Resale: cost(method) × units sold in period.
 * Manufactured: raw-material cost consumed by completed MOs (same method on ingredients).
 * Lot / specific-identification costing is out of scope.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeLandedUnitCost,
  currentLandedUnitCostAsOf,
  type PriceScheduleRow,
} from "./pricing";
import {
  cogsCardTitle,
  cogsFeatureLabel,
  cogsMethodLabel,
  type CogsMethod,
} from "./cogs";
import { createServiceClient } from "./supabase.server";

export type { CogsMethod };
export { cogsCardTitle, cogsFeatureLabel, cogsMethodLabel };

export type CogsSettings = {
  method: CogsMethod;
  updatedAt: string | null;
};

export type CogsLineKind = "resale" | "manufactured";

export type CogsLine = {
  productVariantId: string;
  title: string;
  sku: string | null;
  kind: CogsLineKind;
  supplierName: string | null;
  units: number;
  cogs: number;
  avgUnitCost: number | null;
  costSource: "fifo_receipts" | "weighted_average" | "fallback_schedule" | "mo_materials";
};

export type CogsReport = {
  method: CogsMethod;
  methodLabel: string;
  featureLabel: string;
  periodFrom: string;
  periodTo: string;
  totalCogs: number;
  totalUnits: number;
  lines: CogsLine[];
};

type ReceiptLayer = {
  id: string;
  productVariantId: string;
  qty: number;
  remaining: number;
  unitCost: number;
  receivedAt: string;
  supplierName: string | null;
};

type SaleEvent = {
  at: string;
  productVariantId: string;
  qty: number;
  title: string;
  sku: string | null;
  isSynthetic: boolean;
};

type MoEvent = {
  at: string;
  moId: string;
  finishedVariantId: string;
  qtyToMake: number;
  ingredients: Array<{ productVariantId: string; qty: number }>;
};

export async function getCogsSettings(
  workspaceId: string,
  supabase?: SupabaseClient,
): Promise<CogsSettings> {
  const sb = supabase ?? createServiceClient();
  const { data, error } = await sb
    .from("workspace_cogs_settings")
    .select("method, updated_at")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    method: (data?.method as CogsMethod | undefined) ?? "weighted_average",
    updatedAt: (data?.updated_at as string | null) ?? null,
  };
}

export async function setCogsMethod(
  workspaceId: string,
  method: CogsMethod,
): Promise<CogsSettings> {
  if (method !== "weighted_average" && method !== "fifo") {
    throw new Error("Method must be weighted_average or fifo");
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("workspace_cogs_settings")
    .upsert(
      {
        workspace_id: workspaceId,
        method,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" },
    )
    .select("method, updated_at")
    .single();
  if (error) throw new Error(error.message);
  return {
    method: data.method as CogsMethod,
    updatedAt: data.updated_at as string,
  };
}

function parsePeriod(opts: {
  from?: string | null;
  to?: string | null;
  lookbackDays?: number;
}): { from: string; to: string; fromIso: string; toIso: string } {
  const toDate = opts.to?.trim()
    ? new Date(`${opts.to.trim()}T23:59:59.999Z`)
    : new Date();
  const lookback = opts.lookbackDays ?? 30;
  const fromDate = opts.from?.trim()
    ? new Date(`${opts.from.trim()}T00:00:00.000Z`)
    : new Date(toDate.getTime() - lookback * 86400000);
  const from = fromDate.toISOString().slice(0, 10);
  const to = toDate.toISOString().slice(0, 10);
  return {
    from,
    to,
    fromIso: fromDate.toISOString(),
    toIso: toDate.toISOString(),
  };
}

async function loadPriceRowsByVariant(
  workspaceId: string,
  variantIds: string[],
  supabase: SupabaseClient,
): Promise<Map<string, PriceScheduleRow[]>> {
  const byVariant = new Map<string, PriceScheduleRow[]>();
  if (!variantIds.length) return byVariant;

  const { data: products, error } = await supabase
    .from("supplier_products")
    .select(
      "id, product_variant_id, supplier_product_prices(id, unit_cost, freight_per_unit, duty_per_unit, customs_per_unit, landed_unit_cost, effective_date, created_at)",
    )
    .eq("workspace_id", workspaceId)
    .in("product_variant_id", variantIds);
  if (error) throw new Error(error.message);

  for (const sp of products ?? []) {
    const vid = sp.product_variant_id as string | null;
    if (!vid) continue;
    const prices = (sp.supplier_product_prices ?? []) as PriceScheduleRow[];
    const existing = byVariant.get(vid) ?? [];
    byVariant.set(vid, existing.concat(prices));
  }
  return byVariant;
}

/** Prices that were in effect at any point during [from, to]. */
function pricesInEffectDuring(
  rows: PriceScheduleRow[],
  from: string,
  to: string,
): PriceScheduleRow[] {
  if (!rows.length) return [];
  const sorted = [...rows].sort((a, b) => {
    if (a.effective_date !== b.effective_date) {
      return a.effective_date < b.effective_date ? -1 : 1;
    }
    return a.created_at < b.created_at ? -1 : 1;
  });
  const inEffect: PriceScheduleRow[] = [];
  const atStart = [...sorted].reverse().find((r) => r.effective_date <= from);
  if (atStart) inEffect.push(atStart);
  for (const r of sorted) {
    if (r.effective_date > from && r.effective_date <= to) {
      inEffect.push(r);
    }
  }
  // Dedupe by id
  const seen = new Set<string>();
  return inEffect.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

function weightedAverageUnitCost(
  rows: PriceScheduleRow[],
  from: string,
  to: string,
): number | null {
  const active = pricesInEffectDuring(rows, from, to);
  if (!active.length) {
    return currentLandedUnitCostAsOf(rows, to);
  }
  let sum = 0;
  let n = 0;
  for (const r of active) {
    const c = computeLandedUnitCost(r);
    if (Number.isFinite(c)) {
      sum += c;
      n += 1;
    }
  }
  return n ? sum / n : null;
}

async function loadReceiptLayers(
  workspaceId: string,
  supabase: SupabaseClient,
): Promise<ReceiptLayer[]> {
  const { data: receipts, error: rErr } = await supabase
    .from("receipts")
    .select("id, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });
  if (rErr) throw new Error(rErr.message);
  if (!(receipts ?? []).length) return [];

  const receiptIds = (receipts ?? []).map((r) => r.id as string);
  const receivedAtById = new Map(
    (receipts ?? []).map((r) => [r.id as string, r.created_at as string]),
  );

  const { data, error } = await supabase
    .from("receipt_line_items")
    .select(
      "id, receipt_id, qty_received, po_line_items(unit_cost, supplier_product_id, supplier_products(product_variant_id, suppliers(name)))",
    )
    .in("receipt_id", receiptIds);
  if (error) throw new Error(error.message);

  const layers: ReceiptLayer[] = [];
  for (const row of data ?? []) {
    const receiptId = row.receipt_id as string;
    const receivedAt = receivedAtById.get(receiptId);
    const poLine = row.po_line_items as unknown as {
      unit_cost: number | string;
      supplier_product_id: string | null;
      supplier_products: {
        product_variant_id: string | null;
        suppliers: { name: string } | null;
      } | null;
    } | null;
    const variantId = poLine?.supplier_products?.product_variant_id ?? null;
    if (!variantId || !receivedAt) continue;
    const qty = Math.max(0, Number(row.qty_received ?? 0));
    if (!(qty > 0)) continue;
    const unitCost = Number(poLine?.unit_cost);
    if (!Number.isFinite(unitCost) || unitCost < 0) continue;
    layers.push({
      id: row.id as string,
      productVariantId: variantId,
      qty,
      remaining: qty,
      unitCost,
      receivedAt,
      supplierName: poLine?.supplier_products?.suppliers?.name ?? null,
    });
  }

  // Prefer landed schedule cost as-of receive date when available.
  const variantIds = [...new Set(layers.map((l) => l.productVariantId))];
  const pricesByVariant = await loadPriceRowsByVariant(
    workspaceId,
    variantIds,
    supabase,
  );
  for (const layer of layers) {
    const asOf = layer.receivedAt.slice(0, 10);
    const landed = currentLandedUnitCostAsOf(
      pricesByVariant.get(layer.productVariantId) ?? [],
      asOf,
    );
    if (landed != null && landed > 0) {
      layer.unitCost = landed;
    }
  }

  return layers.sort((a, b) =>
    a.receivedAt < b.receivedAt ? -1 : a.receivedAt > b.receivedAt ? 1 : 0,
  );
}

function fifoConsume(
  layers: ReceiptLayer[],
  productVariantId: string,
  qty: number,
): { cogs: number; consumed: number; unitCost: number | null } {
  let need = qty;
  let cogs = 0;
  let consumed = 0;
  for (const layer of layers) {
    if (layer.productVariantId !== productVariantId) continue;
    if (!(layer.remaining > 0) || !(need > 0)) continue;
    const take = Math.min(layer.remaining, need);
    cogs += take * layer.unitCost;
    layer.remaining -= take;
    need -= take;
    consumed += take;
  }
  return {
    cogs,
    consumed,
    unitCost: consumed > 0 ? cogs / consumed : null,
  };
}

async function loadSalesEvents(
  workspaceId: string,
  toIso: string,
  supabase: SupabaseClient,
): Promise<SaleEvent[]> {
  const { data: orders, error } = await supabase
    .from("shopify_orders")
    .select("id, processed_at, created_at, is_synthetic_test")
    .eq("workspace_id", workspaceId)
    .lte("created_at", toIso)
    .order("processed_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  if (!(orders ?? []).length) return [];

  const orderIds = (orders ?? []).map((o) => o.id as string);
  const orderMeta = new Map(
    (orders ?? []).map((o) => [
      o.id as string,
      {
        at: ((o.processed_at as string | null) ??
          (o.created_at as string)) as string,
        isSynthetic: Boolean(o.is_synthetic_test),
      },
    ]),
  );

  const { data: lines, error: lErr } = await supabase
    .from("shopify_order_line_items")
    .select("order_id, product_variant_id, quantity, title, sku")
    .eq("workspace_id", workspaceId)
    .in("order_id", orderIds)
    .not("product_variant_id", "is", null);
  if (lErr) throw new Error(lErr.message);

  const events: SaleEvent[] = [];
  for (const line of lines ?? []) {
    const oid = line.order_id as string;
    const meta = orderMeta.get(oid);
    const vid = line.product_variant_id as string | null;
    if (!meta || !vid) continue;
    const qty = Math.max(0, Number(line.quantity ?? 0));
    if (!(qty > 0)) continue;
    events.push({
      at: meta.at,
      productVariantId: vid,
      qty,
      title: (line.title as string) ?? "—",
      sku: (line.sku as string | null) ?? null,
      isSynthetic: meta.isSynthetic,
    });
  }
  return events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

async function loadMoEvents(
  workspaceId: string,
  toIso: string,
  supabase: SupabaseClient,
): Promise<MoEvent[]> {
  const { data: mos, error } = await supabase
    .from("manufacturing_orders")
    .select("id, product_variant_id, qty_to_make, completed_at")
    .eq("workspace_id", workspaceId)
    .eq("status", "completed")
    .not("completed_at", "is", null)
    .lte("completed_at", toIso)
    .order("completed_at", { ascending: true });
  if (error) throw new Error(error.message);

  const events: MoEvent[] = [];
  for (const mo of mos ?? []) {
    const moId = mo.id as string;
    const finishedVariantId = mo.product_variant_id as string;
    const qtyToMake = Math.max(0, Number(mo.qty_to_make ?? 0));
    const at = mo.completed_at as string;
    if (!(qtyToMake > 0)) continue;

    const { data: reqs, error: rErr } = await supabase.rpc(
      "expand_bom_requirements",
      {
        p_workspace_id: workspaceId,
        p_finished_variant_id: finishedVariantId,
        p_qty_to_make: qtyToMake,
      },
    );
    if (rErr) throw new Error(rErr.message);
    const ingredients = (
      (reqs ?? []) as Array<{
        ingredient_product_variant_id: string;
        qty_required: number;
      }>
    ).map((r) => ({
      productVariantId: r.ingredient_product_variant_id,
      qty: Math.ceil(Number(r.qty_required)),
    }));

    events.push({
      at,
      moId,
      finishedVariantId,
      qtyToMake,
      ingredients,
    });
  }
  return events;
}

async function loadVariantMeta(
  workspaceId: string,
  variantIds: string[],
  supabase: SupabaseClient,
): Promise<
  Map<
    string,
    { title: string; sku: string | null; supplierName: string | null }
  >
> {
  const map = new Map<
    string,
    { title: string; sku: string | null; supplierName: string | null }
  >();
  if (!variantIds.length) return map;

  const [{ data: variants }, { data: links }] = await Promise.all([
    supabase
      .from("product_variants")
      .select("id, title, sku")
      .eq("workspace_id", workspaceId)
      .in("id", variantIds),
    supabase
      .from("supplier_products")
      .select("product_variant_id, suppliers(name)")
      .eq("workspace_id", workspaceId)
      .in("product_variant_id", variantIds),
  ]);

  for (const v of variants ?? []) {
    map.set(v.id as string, {
      title: (v.title as string) ?? "—",
      sku: (v.sku as string | null) ?? null,
      supplierName: null,
    });
  }
  for (const sp of links ?? []) {
    const vid = sp.product_variant_id as string | null;
    if (!vid) continue;
    const supplier = sp.suppliers as unknown as { name: string } | null;
    const cur = map.get(vid);
    if (cur && !cur.supplierName && supplier?.name) {
      cur.supplierName = supplier.name;
    }
  }
  return map;
}

async function loadManufacturedVariantIds(
  workspaceId: string,
  supabase: SupabaseClient,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("product_recipes")
    .select("product_variant_id")
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r) => r.product_variant_id as string));
}

/**
 * Compute period COGS for the workspace using the merchant's selected method.
 */
export async function computeCogsReport(
  workspaceId: string,
  opts?: {
    from?: string | null;
    to?: string | null;
    lookbackDays?: number;
    method?: CogsMethod;
    supabase?: SupabaseClient;
  },
): Promise<CogsReport> {
  const supabase = opts?.supabase ?? createServiceClient();
  const settings = await getCogsSettings(workspaceId, supabase);
  const method = opts?.method ?? settings.method;
  const period = parsePeriod(opts ?? {});

  const manufacturedIds = await loadManufacturedVariantIds(
    workspaceId,
    supabase,
  );
  const sales = await loadSalesEvents(workspaceId, period.toIso, supabase);
  const mos = await loadMoEvents(workspaceId, period.toIso, supabase);

  const salesInPeriod = sales.filter(
    (s) => s.at >= period.fromIso && s.at <= period.toIso,
  );
  const mosInPeriod = mos.filter(
    (m) => m.at >= period.fromIso && m.at <= period.toIso,
  );

  const allVariantIds = [
    ...new Set([
      ...salesInPeriod.map((s) => s.productVariantId),
      ...mosInPeriod.flatMap((m) => [
        m.finishedVariantId,
        ...m.ingredients.map((i) => i.productVariantId),
      ]),
    ]),
  ];
  const pricesByVariant = await loadPriceRowsByVariant(
    workspaceId,
    allVariantIds,
    supabase,
  );
  const meta = await loadVariantMeta(workspaceId, allVariantIds, supabase);

  type Acc = {
    kind: CogsLineKind;
    units: number;
    cogs: number;
    costSource: CogsLine["costSource"];
    supplierName: string | null;
  };
  const acc = new Map<string, Acc>();

  function bump(
    variantId: string,
    kind: CogsLineKind,
    units: number,
    cogs: number,
    costSource: CogsLine["costSource"],
    supplierName: string | null,
  ) {
    const cur = acc.get(variantId);
    if (!cur) {
      acc.set(variantId, { kind, units, cogs, costSource, supplierName });
      return;
    }
    cur.units += units;
    cur.cogs += cogs;
    if (!cur.supplierName && supplierName) cur.supplierName = supplierName;
  }

  if (method === "fifo") {
    const layers = await loadReceiptLayers(workspaceId, supabase);

    // Replay chronologically through end of period so remaining qty is correct.
    type Timeline =
      | { kind: "sale"; at: string; sale: SaleEvent }
      | { kind: "mo"; at: string; mo: MoEvent };
    const timeline: Timeline[] = [
      ...sales.map((sale) => ({ kind: "sale" as const, at: sale.at, sale })),
      ...mos.map((mo) => ({ kind: "mo" as const, at: mo.at, mo })),
    ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

    for (const ev of timeline) {
      const inPeriod = ev.at >= period.fromIso && ev.at <= period.toIso;

      if (ev.kind === "mo") {
        let materialCogs = 0;
        for (const ing of ev.mo.ingredients) {
          const used = fifoConsume(layers, ing.productVariantId, ing.qty);
          let lineCogs = used.cogs;
          let source: CogsLine["costSource"] = "mo_materials";
          if (used.consumed < ing.qty) {
            const short = ing.qty - used.consumed;
            const fallback =
              weightedAverageUnitCost(
                pricesByVariant.get(ing.productVariantId) ?? [],
                period.from,
                period.to,
              ) ?? 0;
            lineCogs += short * fallback;
            source = used.consumed > 0 ? "mo_materials" : "fallback_schedule";
          }
          materialCogs += lineCogs;
          void source;
        }
        if (inPeriod) {
          bump(
            ev.mo.finishedVariantId,
            "manufactured",
            ev.mo.qtyToMake,
            materialCogs,
            "mo_materials",
            meta.get(ev.mo.finishedVariantId)?.supplierName ?? null,
          );
        }
        continue;
      }

      // Sale
      if (manufacturedIds.has(ev.sale.productVariantId)) {
        // Manufactured finished goods: sales don't add separate COGS here —
        // material cost is recognized on MO completion (above).
        continue;
      }
      if (!inPeriod) {
        // Still consume layers before the period so FIFO remaining is correct.
        fifoConsume(layers, ev.sale.productVariantId, ev.sale.qty);
        continue;
      }

      const used = fifoConsume(
        layers,
        ev.sale.productVariantId,
        ev.sale.qty,
      );
      let cogs = used.cogs;
      let costSource: CogsLine["costSource"] = "fifo_receipts";
      if (used.consumed < ev.sale.qty) {
        const short = ev.sale.qty - used.consumed;
        const fallback =
          weightedAverageUnitCost(
            pricesByVariant.get(ev.sale.productVariantId) ?? [],
            period.from,
            period.to,
          ) ?? 0;
        cogs += short * fallback;
        costSource =
          used.consumed > 0 ? "fifo_receipts" : "fallback_schedule";
      }
      bump(
        ev.sale.productVariantId,
        "resale",
        ev.sale.qty,
        cogs,
        costSource,
        meta.get(ev.sale.productVariantId)?.supplierName ?? null,
      );
    }
  } else {
    // Weighted Average — resale sales × avg price-in-effect; MOs × ingredient WA.
    for (const sale of salesInPeriod) {
      if (manufacturedIds.has(sale.productVariantId)) continue;
      const unit =
        weightedAverageUnitCost(
          pricesByVariant.get(sale.productVariantId) ?? [],
          period.from,
          period.to,
        ) ?? 0;
      bump(
        sale.productVariantId,
        "resale",
        sale.qty,
        unit * sale.qty,
        unit > 0 ? "weighted_average" : "fallback_schedule",
        meta.get(sale.productVariantId)?.supplierName ?? null,
      );
    }

    for (const mo of mosInPeriod) {
      let materialCogs = 0;
      for (const ing of mo.ingredients) {
        const unit =
          weightedAverageUnitCost(
            pricesByVariant.get(ing.productVariantId) ?? [],
            period.from,
            period.to,
          ) ?? 0;
        materialCogs += unit * ing.qty;
      }
      bump(
        mo.finishedVariantId,
        "manufactured",
        mo.qtyToMake,
        materialCogs,
        "mo_materials",
        meta.get(mo.finishedVariantId)?.supplierName ?? null,
      );
    }
  }

  const lines: CogsLine[] = [...acc.entries()]
    .map(([productVariantId, a]) => {
      const m = meta.get(productVariantId);
      return {
        productVariantId,
        title: m?.title ?? "—",
        sku: m?.sku ?? null,
        kind: a.kind,
        supplierName: a.supplierName ?? m?.supplierName ?? null,
        units: a.units,
        cogs: Math.round(a.cogs * 100) / 100,
        avgUnitCost:
          a.units > 0 ? Math.round((a.cogs / a.units) * 10000) / 10000 : null,
        costSource: a.costSource,
      };
    })
    .filter((l) => l.cogs > 0 || l.units > 0)
    .sort((a, b) => b.cogs - a.cogs);

  const totalCogs =
    Math.round(lines.reduce((s, l) => s + l.cogs, 0) * 100) / 100;
  const totalUnits = lines.reduce((s, l) => s + l.units, 0);

  return {
    method,
    methodLabel: cogsMethodLabel(method),
    featureLabel: cogsFeatureLabel(method),
    periodFrom: period.from,
    periodTo: period.to,
    totalCogs,
    totalUnits,
    lines,
  };
}

/** Analytics summary card — last N days. */
export async function loadCogsAnalyticsSummary(
  workspaceId: string,
  lookbackDays = 30,
): Promise<{
  method: CogsMethod;
  cardTitle: string;
  featureLabel: string;
  totalCogs: number;
  totalUnits: number;
  periodFrom: string;
  periodTo: string;
}> {
  const report = await computeCogsReport(workspaceId, { lookbackDays });
  return {
    method: report.method,
    cardTitle: cogsCardTitle(report.method),
    featureLabel: report.featureLabel,
    totalCogs: report.totalCogs,
    totalUnits: report.totalUnits,
    periodFrom: report.periodFrom,
    periodTo: report.periodTo,
  };
}
