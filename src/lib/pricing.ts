import { money, shortDate } from "@/lib/format";

export type SupplierProductPricing = {
  supplier_product_id: string;
  current_unit_cost: number | null;
  next_unit_cost: number | null;
  next_effective_date: string | null;
};

export type PriceScheduleRow = {
  id: string;
  unit_cost: number | string;
  effective_date: string;
  created_at: string;
};

/**
 * Resolve current + next price from a schedule using a calendar "as of" date
 * (YYYY-MM-DD). Prefer this over the DB view when the merchant's local day
 * may differ from Postgres `current_date` (UTC).
 */
export function resolvePricingAsOf(
  supplierProductId: string,
  rows: PriceScheduleRow[],
  asOf: string,
): SupplierProductPricing {
  const sorted = [...rows].sort((a, b) => {
    if (a.effective_date !== b.effective_date) {
      return a.effective_date < b.effective_date ? 1 : -1;
    }
    return a.created_at < b.created_at ? 1 : -1;
  });

  const current = sorted.find((r) => r.effective_date <= asOf) ?? null;
  const upcoming = [...rows]
    .filter((r) => r.effective_date > asOf)
    .sort((a, b) => {
      if (a.effective_date !== b.effective_date) {
        return a.effective_date < b.effective_date ? -1 : 1;
      }
      return a.created_at < b.created_at ? -1 : 1;
    });
  const next = upcoming[0] ?? null;

  return {
    supplier_product_id: supplierProductId,
    current_unit_cost:
      current == null ? null : Number(current.unit_cost),
    next_unit_cost: next == null ? null : Number(next.unit_cost),
    next_effective_date: next?.effective_date ?? null,
  };
}

export function currentPriceRowId(
  rows: PriceScheduleRow[],
  asOf: string,
): string | null {
  const sorted = [...rows].sort((a, b) => {
    if (a.effective_date !== b.effective_date) {
      return a.effective_date < b.effective_date ? 1 : -1;
    }
    return a.created_at < b.created_at ? 1 : -1;
  });
  return sorted.find((r) => r.effective_date <= asOf)?.id ?? null;
}

/** Plain scheduled-change copy — restrained, not a badge. */
export function scheduledPriceNote(
  pricing: {
    next_unit_cost: number | null;
    next_effective_date: string | null;
  },
  style: "short" | "full" = "short",
) {
  if (
    pricing.next_unit_cost == null ||
    !pricing.next_effective_date
  ) {
    return null;
  }
  if (style === "short") {
    return `Changing ${shortDate(pricing.next_effective_date)}`;
  }
  return `Changing to ${money(pricing.next_unit_cost)} on ${shortDate(pricing.next_effective_date)}`;
}

export function currentPriceLabel(pricing: {
  current_unit_cost: number | null;
}) {
  if (pricing.current_unit_cost == null) return "—";
  return money(pricing.current_unit_cost);
}

/**
 * Live margin from retail − unit cost. Not stored.
 * Dollar amount + gross margin % of retail: (retail − cost) / retail.
 */
export function liveMargin(
  retailPrice: number | null | undefined,
  unitCost: number | null | undefined,
): { dollars: number; percent: number } | null {
  if (retailPrice == null || unitCost == null) return null;
  if (!Number.isFinite(retailPrice) || !Number.isFinite(unitCost)) return null;
  if (retailPrice <= 0) return null;
  const dollars = retailPrice - unitCost;
  const percent = (dollars / retailPrice) * 100;
  return { dollars, percent };
}

export function marginLabel(
  retailPrice: number | null | undefined,
  unitCost: number | null | undefined,
): string {
  const m = liveMargin(retailPrice, unitCost);
  if (!m) return "—";
  const pct = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  }).format(m.percent);
  return `${money(m.dollars)} · ${pct}%`;
}

/** Today as YYYY-MM-DD in local time for date inputs. */
export function todayDateInputValue() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
