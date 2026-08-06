"use client";

import { useState } from "react";
import { createSupplierProduct } from "@/lib/actions/products";
import { todayDateInputValue } from "@/lib/pricing";

export function AddSupplierProductForm({
  supplierId,
  returnTo,
}: {
  supplierId: string;
  returnTo: string;
}) {
  const [effectiveDate, setEffectiveDate] = useState(todayDateInputValue);

  return (
    <form action={createSupplierProduct} className="add-supplier-product-form">
      <input type="hidden" name="supplier_id" value={supplierId} />
      <input type="hidden" name="return_to" value={returnTo} />
      <div>
        <label className="field-label" htmlFor="add_product_title">
          Title
        </label>
        <input
          id="add_product_title"
          name="title"
          className="field"
          required
          placeholder="e.g. Hangtag — Kraft"
        />
      </div>
      <div>
        <label className="field-label" htmlFor="add_product_sku">
          SKU
        </label>
        <input
          id="add_product_sku"
          name="sku"
          className="field"
          placeholder="Optional"
        />
      </div>
      <div>
        <label className="field-label" htmlFor="add_product_unit_cost">
          Unit cost
        </label>
        <input
          id="add_product_unit_cost"
          name="unit_cost"
          className="field"
          inputMode="decimal"
          required
          placeholder="0.00"
        />
      </div>
      <div>
        <label className="field-label" htmlFor="add_product_effective_date">
          Effective date
        </label>
        <input
          id="add_product_effective_date"
          name="effective_date"
          type="date"
          className="field"
          required
          value={effectiveDate}
          onChange={(e) => setEffectiveDate(e.target.value)}
        />
      </div>
      <div>
        <label className="field-label" htmlFor="add_product_case_qty">
          Case qty
        </label>
        <input
          id="add_product_case_qty"
          name="case_qty"
          className="field"
          inputMode="numeric"
          placeholder="Optional"
        />
      </div>
      <div>
        <label className="field-label" htmlFor="add_product_moq">
          MOQ
        </label>
        <input
          id="add_product_moq"
          name="moq"
          className="field"
          inputMode="numeric"
          placeholder="Optional"
        />
      </div>
      <button type="submit" className="btn btn-primary">
        Add product
      </button>
    </form>
  );
}
