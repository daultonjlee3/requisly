import { createServiceClient } from "./supabase.server";
import { SCORECARD_MIN_COMPLETED_POS } from "./supplier-scorecard";

export {
  SCORECARD_MIN_COMPLETED_POS,
  daysLabel,
  pctLabel,
  spendLabel,
} from "./supplier-scorecard";

export type OnTimeTrendPoint = {
  month: string; // YYYY-MM
  label: string; // e.g. Aug 2026
  onTimePct: number; // 0–1
  sampleSize: number;
};

export type SupplierScorecardExportData = {
  workspaceName: string;
  supplierId: string;
  supplierName: string;
  completedPos: number;
  ready: boolean;
  onTimePct: number | null;
  fillRate: number | null;
  avgLeadTimeVarianceDays: number | null;
  avgConfirmationDays: number | null;
  closedSpend: number;
  trend: OnTimeTrendPoint[];
  generatedAt: string;
};

function monthKey(iso: string) {
  return iso.slice(0, 7);
}

function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, (m ?? 1) - 1, 1));
  return d.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * Load scorecard + monthly on-time trend for one supplier (Analytics trend logic).
 */
export async function loadSupplierScorecardExport(
  workspaceId: string,
  supplierId: string,
): Promise<SupplierScorecardExportData | null> {
  const supabase = createServiceClient();

  const [workspaceRes, supplierRes, scorecardRes, closedRes] =
    await Promise.all([
      supabase
        .from("workspaces")
        .select("name")
        .eq("id", workspaceId)
        .maybeSingle(),
      supabase
        .from("suppliers")
        .select("id, name")
        .eq("id", supplierId)
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
      supabase
        .from("supplier_scorecards")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("supplier_id", supplierId)
        .maybeSingle(),
      supabase
        .from("purchase_orders")
        .select(
          "id, total, created_at, requested_ship_date, confirmed_ship_date, po_timeline_events(event_type, occurred_at)",
        )
        .eq("workspace_id", workspaceId)
        .eq("supplier_id", supplierId)
        .eq("status", "closed")
        .order("created_at", { ascending: true }),
    ]);

  if (workspaceRes.error) throw new Error(workspaceRes.error.message);
  if (supplierRes.error) throw new Error(supplierRes.error.message);
  if (scorecardRes.error) throw new Error(scorecardRes.error.message);
  if (closedRes.error) throw new Error(closedRes.error.message);
  if (!supplierRes.data) return null;

  const scorecard = scorecardRes.data;
  const completedPos = Number(scorecard?.completed_pos ?? 0);
  const closedPos = closedRes.data ?? [];

  let closedSpend = 0;
  const trendBucket = new Map<string, { onTime: number; total: number }>();

  for (const po of closedPos) {
    closedSpend += Number(po.total) || 0;
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
      const point = trendBucket.get(closeMonth) ?? { onTime: 0, total: 0 };
      point.total += 1;
      if (onTime) point.onTime += 1;
      trendBucket.set(closeMonth, point);
    }
  }

  const trend: OnTimeTrendPoint[] =
    completedPos >= SCORECARD_MIN_COMPLETED_POS
      ? [...trendBucket.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([month, v]) => ({
            month,
            label: monthLabel(month),
            onTimePct: v.total > 0 ? v.onTime / v.total : 0,
            sampleSize: v.total,
          }))
      : [];

  return {
    workspaceName: workspaceRes.data?.name ?? "Workspace",
    supplierId: supplierRes.data.id,
    supplierName: supplierRes.data.name,
    completedPos,
    ready: completedPos >= SCORECARD_MIN_COMPLETED_POS,
    onTimePct:
      scorecard?.on_time_pct != null ? Number(scorecard.on_time_pct) : null,
    fillRate:
      scorecard?.fill_rate != null ? Number(scorecard.fill_rate) : null,
    avgLeadTimeVarianceDays:
      scorecard?.avg_lead_time_variance_days != null
        ? Number(scorecard.avg_lead_time_variance_days)
        : null,
    avgConfirmationDays:
      scorecard?.avg_confirmation_days != null
        ? Number(scorecard.avg_confirmation_days)
        : null,
    closedSpend,
    trend,
    generatedAt: new Date().toISOString(),
  };
}
