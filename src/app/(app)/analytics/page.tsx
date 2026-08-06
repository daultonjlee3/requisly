import { ForecastPlaceholder } from "@/components/analytics/ForecastPlaceholder";
import { ScorecardCard } from "@/components/analytics/ScorecardCard";
import {
  SpendSection,
  type SpendByMonth,
  type SpendBySku,
  type SpendBySupplier,
} from "@/components/analytics/SpendSection";
import { Topbar } from "@/components/shell/Topbar";
import {
  SCORECARD_MIN_COMPLETED_POS,
  monthKey,
  monthLabel,
  type SupplierScorecard,
} from "@/lib/analytics";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/workspace";

export default async function AnalyticsPage() {
  const { workspace } = await getSessionContext();
  const supabase = await createClient();

  const { data: workspaceRow } = await supabase
    .from("workspaces")
    .select("id, name, is_demo")
    .eq("id", workspace!.id)
    .maybeSingle();

  const isDemo = Boolean(workspaceRow?.is_demo);

  const workspaceId = workspace!.id;

  const { data: suppliers } = await supabase
    .from("suppliers")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .order("name");

  const { data: scorecardRows } = await supabase
    .from("supplier_scorecards")
    .select("*")
    .eq("workspace_id", workspaceId);

  const scorecardBySupplier = new Map<string, SupplierScorecard>();
  for (const row of scorecardRows ?? []) {
    scorecardBySupplier.set(row.supplier_id, row as SupplierScorecard);
  }

  const { data: closedPos } = await supabase
    .from("purchase_orders")
    .select(
      "id, supplier_id, total, created_at, requested_ship_date, confirmed_ship_date, status, po_line_items(description, sku, qty, line_total), po_timeline_events(event_type, occurred_at)",
    )
    .eq("workspace_id", workspaceId)
    .eq("status", "closed")
    .order("created_at", { ascending: true });

  // Monthly on-time trend per supplier (only used when enough history)
  const trendBySupplier = new Map<
    string,
    Map<string, { onTime: number; total: number }>
  >();

  const spendBySupplierMap = new Map<string, SpendBySupplier>();
  const spendByMonthMap = new Map<string, SpendByMonth>();
  const spendBySkuMap = new Map<string, SpendBySku>();
  let totalSpend = 0;

  for (const po of closedPos ?? []) {
    const supplier = (suppliers ?? []).find((s) => s.id === po.supplier_id);
    const total = Number(po.total) || 0;
    totalSpend += total;

    const existing = spendBySupplierMap.get(po.supplier_id) ?? {
      supplierId: po.supplier_id,
      name: supplier?.name ?? "Supplier",
      total: 0,
      poCount: 0,
    };
    existing.total += total;
    existing.poCount += 1;
    spendBySupplierMap.set(po.supplier_id, existing);

    const mk = monthKey(po.created_at);
    const monthRow = spendByMonthMap.get(mk) ?? {
      month: mk,
      total: 0,
      poCount: 0,
    };
    monthRow.total += total;
    monthRow.poCount += 1;
    spendByMonthMap.set(mk, monthRow);

    const lines = (po.po_line_items ?? []) as Array<{
      description: string;
      sku: string | null;
      qty: number;
      line_total: number | string;
    }>;
    for (const line of lines) {
      const key = `${line.sku ?? ""}::${line.description}`;
      const skuRow = spendBySkuMap.get(key) ?? {
        sku: line.sku ?? "",
        description: line.description,
        total: 0,
        qty: 0,
      };
      skuRow.total += Number(line.line_total) || 0;
      skuRow.qty += line.qty;
      spendBySkuMap.set(key, skuRow);
    }

    const events = (po.po_timeline_events ?? []) as Array<{
      event_type: string;
      occurred_at: string;
    }>;
    const shipped = events.find((e) => e.event_type === "shipped");
    const shipDate =
      po.confirmed_ship_date ??
      (shipped ? shipped.occurred_at.slice(0, 10) : null);
    const onTime =
      po.requested_ship_date && shipDate
        ? shipDate <= po.requested_ship_date
        : null;

    if (onTime != null) {
      const bucket =
        trendBySupplier.get(po.supplier_id) ??
        new Map<string, { onTime: number; total: number }>();
      const closeMonth = monthKey(
        events.find((e) => e.event_type === "closed")?.occurred_at ??
          po.created_at,
      );
      const point = bucket.get(closeMonth) ?? { onTime: 0, total: 0 };
      point.total += 1;
      if (onTime) point.onTime += 1;
      bucket.set(closeMonth, point);
      trendBySupplier.set(po.supplier_id, bucket);
    }
  }

  const bySupplier = [...spendBySupplierMap.values()].sort(
    (a, b) => b.total - a.total,
  );
  const byMonth = [...spendByMonthMap.values()].sort((a, b) =>
    a.month.localeCompare(b.month),
  );
  const bySku = [...spendBySkuMap.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, 12);

  const supplierList = suppliers ?? [];
  const withHistory = supplierList.filter((s) =>
    hasEnough(
      scorecardBySupplier.get(s.id)?.completed_pos ?? 0,
    ),
  ).length;

  return (
    <>
      <Topbar
        title="Analytics"
        subline="Summaries of purchase orders — not a separate data model"
      />
      <div className="content stack" style={{ gap: 28 }}>
        {isDemo ? (
          <div className="demo-banner">
            <strong>Demo workspace</strong>
            <span>
              Scorecards and spend below are computed from seeded history (
              {SCORECARD_MIN_COMPLETED_POS}+ closed POs required per supplier
              before a chart renders). This is exploratory — not evidence for a
              real Phase 2 launch gate.
            </span>
          </div>
        ) : (
          <div className="demo-banner demo-banner-live">
            <strong>Live workspace</strong>
            <span>
              Charts only render for suppliers with at least{" "}
              {SCORECARD_MIN_COMPLETED_POS} completed POs. Thin history shows
              an explicit empty state — never a fabricated trend.
            </span>
          </div>
        )}

        <section className="stack" style={{ gap: 14 }}>
          <div className="between">
            <div>
              <h2 className="section-title">Supplier scorecards</h2>
              <p className="small muted" style={{ margin: 0 }}>
                On-time %, lead-time variance, fill rate, and monthly trend.
              </p>
            </div>
            <span className="mono small muted">
              {withHistory}/{supplierList.length} ready
            </span>
          </div>
          {supplierList.length === 0 ? (
            <div className="card">
              <div className="card-body empty-state">
                <p style={{ margin: 0 }}>
                  Add suppliers and complete purchase orders to unlock
                  scorecards.
                </p>
              </div>
            </div>
          ) : (
            <div className="scorecard-grid">
              {supplierList.map((supplier) => {
                const sc = scorecardBySupplier.get(supplier.id) ?? null;
                const trendMap = trendBySupplier.get(supplier.id);
                const trend = trendMap
                  ? [...trendMap.entries()]
                      .sort(([a], [b]) => a.localeCompare(b))
                      .slice(-8)
                      .map(([month, point]) => ({
                        month,
                        label: monthLabel(month),
                        onTimePct:
                          point.total > 0 ? point.onTime / point.total : null,
                        completed: point.total,
                      }))
                  : [];
                return (
                  <ScorecardCard
                    key={supplier.id}
                    supplierId={supplier.id}
                    supplierName={supplier.name}
                    scorecard={sc}
                    trend={
                      hasEnough(sc?.completed_pos ?? 0) ? trend : []
                    }
                  />
                );
              })}
            </div>
          )}
        </section>

        <section className="stack" style={{ gap: 14 }}>
          <div>
            <h2 className="section-title">Spend & cost</h2>
            <p className="small muted" style={{ margin: 0 }}>
              Closed PO totals rolled up by supplier, month, and line item.
            </p>
          </div>
          <SpendSection
            bySupplier={bySupplier}
            byMonth={byMonth}
            bySku={bySku}
            totalSpend={totalSpend}
          />
        </section>

        <section className="stack" style={{ gap: 14 }}>
          <div>
            <h2 className="section-title">Demand forecasting</h2>
            <p className="small muted" style={{ margin: 0 }}>
              Held back on purpose — even in this exploratory build.
            </p>
          </div>
          <ForecastPlaceholder />
        </section>
      </div>
    </>
  );
}

function hasEnough(n: number) {
  return n >= SCORECARD_MIN_COMPLETED_POS;
}
