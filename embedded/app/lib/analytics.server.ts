import { createServiceClient } from "./supabase.server";
import { money } from "./format";

const SCORECARD_MIN = 5;

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
        .select("id, supplier_id, total, status")
        .eq("workspace_id", workspaceId)
        .eq("status", "closed"),
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
  for (const po of closedPos) {
    const cur = spendMap.get(po.supplier_id) ?? { total: 0, count: 0 };
    cur.total += Number(po.total) || 0;
    cur.count += 1;
    spendMap.set(po.supplier_id, cur);
  }

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
  };
}
