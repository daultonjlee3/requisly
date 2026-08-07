export type PriceScheduleRow = {
  id: string;
  unit_cost: number | string;
  effective_date: string;
  created_at: string;
};

/**
 * Current unit cost = price with the latest effective_date <= asOf.
 * Never returns a future-scheduled price as current.
 */
export function currentUnitCostAsOf(
  rows: PriceScheduleRow[],
  asOf: string,
): number | null {
  const sorted = [...rows].sort((a, b) => {
    if (a.effective_date !== b.effective_date) {
      return a.effective_date < b.effective_date ? 1 : -1;
    }
    return a.created_at < b.created_at ? 1 : -1;
  });
  const current = sorted.find((r) => r.effective_date <= asOf) ?? null;
  if (current == null) return null;
  const n = Number(current.unit_cost);
  return Number.isFinite(n) ? n : null;
}

/** Today as YYYY-MM-DD in local time. */
export function todayDateInputValue() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
