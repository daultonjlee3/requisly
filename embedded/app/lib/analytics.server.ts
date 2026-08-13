import { createServiceClient } from "./supabase.server";
import { money } from "./format";

const SCORECARD_MIN = 5;

export type AnalyticsChartPoint = {
  key: string;
  value: number | null;
};

export type AnalyticsData = {
  isDemo: boolean;
  scorecards: Array<{
    supplierName: string;
    completedPos: number;
    ready: boolean;
    onTimePct: string;
    fillRate: string;
    avgConfirmDays: string;
  }>;
  spendBySupplier: Array<{ supplierName: string; total: string; count: number }>;
  /** Monthly closed-PO spend for Polaris Viz. */
  spendByMonth: AnalyticsChartPoint[];
  /** Workspace-level monthly on-time rate (0–100) for Polaris Viz. */
  onTimeByMonth: AnalyticsChartPoint[];
  closedCount: number;
  loadError: string | null;
};

function pctLabel(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return `${Math.round(Number(value) * 100)}%`;
}

function daysLabel(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const n = Number(value);
  return `${Math.abs(n) < 10 ? n.toFixed(1) : Math.round(n)}d`;
}

function monthKey(iso: string) {
  return iso.slice(0, 7);
}

function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, (m ?? 1) - 1, 1));
  return d.toLocaleString("en-US", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

export async function loadAnalytics(workspaceId: string): Promise<AnalyticsData> {
  const supabase = createServiceClient();

  const [workspaceRes, suppliersRes, scorecardsRes, closedRes] =
    await Promise.all([
      supabase
        .from("workspaces")
        .select("is_demo")
        .eq("id", workspaceId)
        .maybeSingle(),
      supabase
        .from("suppliers")
        .select("id, name")
        .eq("workspace_id", workspaceId),
      supabase
        .from("supplier_scorecards")
        .select("*")
        .eq("workspace_id", workspaceId),
      supabase
        .from("purchase_orders")
        .select(
          "id, supplier_id, total, status, created_at, requested_ship_date, confirmed_ship_date, po_timeline_events(event_type, occurred_at)",
        )
        .eq("workspace_id", workspaceId)
        .eq("status", "closed")
        .order("created_at", { ascending: true }),
    ]);

  const failures = [
    workspaceRes.error && `workspace: ${workspaceRes.error.message}`,
    suppliersRes.error && `suppliers: ${suppliersRes.error.message}`,
    scorecardsRes.error && `scorecards: ${scorecardsRes.error.message}`,
    closedRes.error && `closed: ${closedRes.error.message}`,
  ].filter(Boolean) as string[];

  if (failures.length) {
    return {
      isDemo: false,
      scorecards: [],
      spendBySupplier: [],
      spendByMonth: [],
      onTimeByMonth: [],
      closedCount: 0,
      loadError: failures.join(" · "),
    };
  }

  const workspace = workspaceRes.data;
  const suppliers = suppliersRes.data ?? [];
  const scorecards = scorecardsRes.data ?? [];
  const closedPos = closedRes.data ?? [];

  const nameById = new Map(suppliers.map((s) => [s.id, s.name] as const));

  const spendMap = new Map<string, { total: number; count: number }>();
  const spendMonth = new Map<string, number>();
  const onTimeMonth = new Map<string, { onTime: number; total: number }>();

  for (const po of closedPos) {
    const cur = spendMap.get(po.supplier_id) ?? { total: 0, count: 0 };
    cur.total += Number(po.total) || 0;
    cur.count += 1;
    spendMap.set(po.supplier_id, cur);

    const mk = monthKey(po.created_at);
    spendMonth.set(mk, (spendMonth.get(mk) ?? 0) + (Number(po.total) || 0));

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
      const closeMonth = monthKey(
        events.find((e) => e.event_type === "closed")?.occurred_at ??
          po.created_at,
      );
      const bucket = onTimeMonth.get(closeMonth) ?? { onTime: 0, total: 0 };
      bucket.total += 1;
      if (onTime) bucket.onTime += 1;
      onTimeMonth.set(closeMonth, bucket);
    }
  }

  const spendByMonth = [...spendMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ key: monthLabel(key), value }));

  const onTimeByMonth = [...onTimeMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => ({
      key: monthLabel(key),
      value: v.total > 0 ? Math.round((v.onTime / v.total) * 100) : null,
    }));

  return {
    loadError: null,
    isDemo: Boolean(workspace?.is_demo),
    closedCount: closedPos.length,
    scorecards: scorecards.map((row) => ({
      supplierName: nameById.get(row.supplier_id) ?? "—",
      completedPos: row.completed_pos ?? 0,
      ready: (row.completed_pos ?? 0) >= SCORECARD_MIN,
      onTimePct: pctLabel(row.on_time_pct),
      fillRate: pctLabel(row.fill_rate),
      avgConfirmDays: daysLabel(row.avg_confirmation_days),
    })),
    spendBySupplier: [...spendMap.entries()]
      .map(([id, v]) => ({
        supplierName: nameById.get(id) ?? "—",
        total: money(v.total),
        count: v.count,
      }))
      .sort((a, b) => b.count - a.count),
    spendByMonth,
    onTimeByMonth,
  };
}
