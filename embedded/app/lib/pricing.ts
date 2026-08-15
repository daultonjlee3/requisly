export type PriceScheduleRow = {
  id: string;
  unit_cost: number | string;
  effective_date: string;
  created_at: string;
  freight_per_unit?: number | string | null;
  duty_per_unit?: number | string | null;
  customs_per_unit?: number | string | null;
  landed_unit_cost?: number | string | null;
};

function num(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Landed = FOB unit_cost + freight + duty + customs (per unit). */
export function computeLandedUnitCost(row: {
  unit_cost: number | string;
  freight_per_unit?: number | string | null;
  duty_per_unit?: number | string | null;
  customs_per_unit?: number | string | null;
  landed_unit_cost?: number | string | null;
}): number {
  if (row.landed_unit_cost != null && row.landed_unit_cost !== "") {
    const stored = Number(row.landed_unit_cost);
    if (Number.isFinite(stored)) return stored;
  }
  return (
    num(row.unit_cost) +
    num(row.freight_per_unit) +
    num(row.duty_per_unit) +
    num(row.customs_per_unit)
  );
}

function sortScheduleNewestFirst(rows: PriceScheduleRow[]): PriceScheduleRow[] {
  return [...rows].sort((a, b) => {
    if (a.effective_date !== b.effective_date) {
      return a.effective_date < b.effective_date ? 1 : -1;
    }
    return a.created_at < b.created_at ? 1 : -1;
  });
}

/**
 * Current unit cost = price with the latest effective_date <= asOf.
 * Never returns a future-scheduled price as current.
 * Returns FOB / supplier invoice cost (excludes freight/duty/customs).
 */
export function currentUnitCostAsOf(
  rows: PriceScheduleRow[],
  asOf: string,
): number | null {
  const current = sortScheduleNewestFirst(rows).find(
    (r) => r.effective_date <= asOf,
  );
  if (current == null) return null;
  const n = Number(current.unit_cost);
  return Number.isFinite(n) ? n : null;
}

/** Current landed unit cost (FOB + freight + duty + customs) as of date. */
export function currentLandedUnitCostAsOf(
  rows: PriceScheduleRow[],
  asOf: string,
): number | null {
  const current = sortScheduleNewestFirst(rows).find(
    (r) => r.effective_date <= asOf,
  );
  if (current == null) return null;
  const n = computeLandedUnitCost(current);
  return Number.isFinite(n) ? n : null;
}

export type LandedAllocationLine = {
  key: string;
  qty: number;
  unitCost: number;
};

export type LandedAllocationResult = {
  key: string;
  qty: number;
  unitCost: number;
  freightPerUnit: number;
  dutyPerUnit: number;
  customsPerUnit: number;
  landedUnitCost: number;
};

/**
 * Allocate shipment-level freight/duty/customs into per-unit amounts.
 * by_value: proportional to (qty × unitCost); by_qty: proportional to qty.
 * Remainder cents go to the last line with positive weight.
 */
export function allocateLandedCosts(opts: {
  freightTotal: number;
  dutyTotal: number;
  customsTotal: number;
  lines: LandedAllocationLine[];
  method: "by_value" | "by_qty";
}): LandedAllocationResult[] {
  const lines = opts.lines.filter((l) => l.qty > 0);
  if (!lines.length) return [];

  const weights = lines.map((l) =>
    opts.method === "by_qty" ? l.qty : l.qty * Math.max(0, l.unitCost),
  );
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  if (!(totalWeight > 0)) {
    return lines.map((l) => ({
      key: l.key,
      qty: l.qty,
      unitCost: l.unitCost,
      freightPerUnit: 0,
      dutyPerUnit: 0,
      customsPerUnit: 0,
      landedUnitCost: l.unitCost,
    }));
  }

  function allocateBucket(total: number): number[] {
    const safe = Math.max(0, Number(total) || 0);
    const raw = weights.map((w) => (safe * w) / totalWeight);
    const perLineTotals = raw.map((v) => Math.floor(v * 10000) / 10000);
    const assigned = perLineTotals.reduce((s, v) => s + v, 0);
    const remainder = Math.round((safe - assigned) * 10000) / 10000;
    if (remainder !== 0) {
      perLineTotals[perLineTotals.length - 1] =
        Math.round((perLineTotals[perLineTotals.length - 1] + remainder) * 10000) /
        10000;
    }
    return perLineTotals.map((lineTotal, i) =>
      Math.round((lineTotal / lines[i].qty) * 10000) / 10000,
    );
  }

  const freight = allocateBucket(opts.freightTotal);
  const duty = allocateBucket(opts.dutyTotal);
  const customs = allocateBucket(opts.customsTotal);

  return lines.map((l, i) => {
    const freightPerUnit = freight[i] ?? 0;
    const dutyPerUnit = duty[i] ?? 0;
    const customsPerUnit = customs[i] ?? 0;
    return {
      key: l.key,
      qty: l.qty,
      unitCost: l.unitCost,
      freightPerUnit,
      dutyPerUnit,
      customsPerUnit,
      landedUnitCost:
        Math.round(
          (l.unitCost + freightPerUnit + dutyPerUnit + customsPerUnit) * 10000,
        ) / 10000,
    };
  });
}

/** Today as YYYY-MM-DD in local time. */
export function todayDateInputValue() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
