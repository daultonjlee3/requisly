"use client";

import { useState } from "react";
import { scheduleSupplierProductPrice } from "@/lib/actions/products";
import { todayDateInputValue } from "@/lib/pricing";

export function SchedulePriceForm({
  supplierProductId,
  supplierId,
  compact,
  returnTo,
}: {
  supplierProductId: string;
  supplierId: string;
  compact?: boolean;
  returnTo?: string;
}) {
  // Client-local today — SSR UTC would bake tomorrow for US evenings.
  const [effectiveDate, setEffectiveDate] = useState(todayDateInputValue);

  const formClass = compact
    ? "schedule-price-form compact"
    : "schedule-price-form stack-form";

  return (
    <form action={scheduleSupplierProductPrice} className={formClass}>
      <input type="hidden" name="supplier_product_id" value={supplierProductId} />
      <input type="hidden" name="supplier_id" value={supplierId} />
      {returnTo ? (
        <input type="hidden" name="return_to" value={returnTo} />
      ) : null}
      <div>
        <label className="field-label" htmlFor={`unit_cost_${supplierProductId}`}>
          Unit cost
        </label>
        <input
          id={`unit_cost_${supplierProductId}`}
          name="unit_cost"
          className="field"
          inputMode="decimal"
          required
          placeholder="0.00"
        />
      </div>
      <div>
        <label
          className="field-label"
          htmlFor={`effective_date_${supplierProductId}`}
        >
          Effective date
        </label>
        <input
          id={`effective_date_${supplierProductId}`}
          name="effective_date"
          type="date"
          className="field"
          required
          value={effectiveDate}
          onChange={(e) => setEffectiveDate(e.target.value)}
        />
      </div>
      <button
        type="submit"
        className={compact ? "btn btn-secondary btn-sm" : "btn btn-primary"}
      >
        Schedule price
      </button>
    </form>
  );
}
