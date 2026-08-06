/** Minimum closed POs before a supplier scorecard may render charts/metrics. */
export const SCORECARD_MIN_COMPLETED_POS = 5;

export type SupplierScorecard = {
  supplier_id: string;
  workspace_id: string;
  completed_pos: number;
  avg_confirmation_days: number | null;
  avg_lead_time_variance_days: number | null;
  on_time_pct: number | null;
  fill_rate: number | null;
};

export function hasEnoughScorecardHistory(
  completedPos: number | null | undefined,
) {
  return (completedPos ?? 0) >= SCORECARD_MIN_COMPLETED_POS;
}

export function pctLabel(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return `${Math.round(Number(value) * 100)}%`;
}

export function daysLabel(value: number | null | undefined, digits = 1) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const n = Number(value);
  const formatted = Math.abs(n) < 10 ? n.toFixed(digits) : Math.round(n).toString();
  return `${formatted}d`;
}

export function monthKey(value: string | Date) {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "unknown";
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return key;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}
