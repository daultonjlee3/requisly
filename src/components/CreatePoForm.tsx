"use client";

import { useMemo, useState } from "react";
import { createPurchaseOrder } from "@/lib/actions/purchase-orders";
import { money } from "@/lib/format";

type SupplierOption = { id: string; name: string };
type LocationOption = { id: string; name: string; is_primary: boolean };

type Line = {
  key: string;
  description: string;
  sku: string;
  qty: string;
  unit_cost: string;
  is_free_text: boolean;
};

export function CreatePoForm({
  suppliers,
  locations,
  defaultSupplierId,
}: {
  suppliers: SupplierOption[];
  locations: LocationOption[];
  defaultSupplierId?: string;
}) {
  const [lines, setLines] = useState<Line[]>([
    {
      key: crypto.randomUUID(),
      description: "",
      sku: "",
      qty: "1",
      unit_cost: "0",
      is_free_text: true,
    },
  ]);

  const subtotal = useMemo(
    () =>
      lines.reduce((sum, line) => {
        const qty = Number(line.qty) || 0;
        const cost = Number(line.unit_cost) || 0;
        return sum + qty * cost;
      }, 0),
    [lines],
  );

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: string) {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.key !== key)));
  }

  return (
    <form action={createPurchaseOrder}>
      <input
        type="hidden"
        name="lines_json"
        value={JSON.stringify(
          lines.map((l) => ({
            description: l.description,
            sku: l.sku,
            qty: Number(l.qty) || 0,
            unit_cost: Number(l.unit_cost) || 0,
            is_free_text: true,
          })),
        )}
      />

      <div className="grid-2" style={{ gridTemplateColumns: "1fr 320px", alignItems: "start" }}>
        <div className="stack">
          <div className="card">
            <div className="card-header">
              <h3>Line items</h3>
              <span className="small muted">Free-text for anything outside Shopify</span>
            </div>
            <table className="li-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU</th>
                  <th style={{ textAlign: "right", width: 80 }}>Qty</th>
                  <th style={{ textAlign: "right", width: 100 }}>Unit cost</th>
                  <th style={{ textAlign: "right", width: 100 }}>Total</th>
                  <th style={{ width: 30 }} />
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const total =
                    (Number(line.qty) || 0) * (Number(line.unit_cost) || 0);
                  return (
                    <tr key={line.key}>
                      <td>
                        <input
                          placeholder="Free-text item"
                          value={line.description}
                          onChange={(e) =>
                            updateLine(line.key, { description: e.target.value })
                          }
                          required
                        />
                      </td>
                      <td>
                        <input
                          className="mono"
                          placeholder="—"
                          value={line.sku}
                          onChange={(e) =>
                            updateLine(line.key, { sku: e.target.value })
                          }
                        />
                      </td>
                      <td className="num">
                        <input
                          value={line.qty}
                          onChange={(e) =>
                            updateLine(line.key, { qty: e.target.value })
                          }
                        />
                      </td>
                      <td className="num">
                        <input
                          value={line.unit_cost}
                          onChange={(e) =>
                            updateLine(line.key, { unit_cost: e.target.value })
                          }
                        />
                      </td>
                      <td className="num" style={{ color: "var(--ink-faint)" }}>
                        {money(total)}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => removeLine(line.key)}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="card-body">
              <button
                type="button"
                className="add-row-btn"
                onClick={() =>
                  setLines((prev) => [
                    ...prev,
                    {
                      key: crypto.randomUUID(),
                      description: "",
                      sku: "",
                      qty: "1",
                      unit_cost: "0",
                      is_free_text: true,
                    },
                  ])
                }
              >
                + Add line item
              </button>
            </div>
            <div className="card-body" style={{ borderTop: "1px solid var(--line)" }}>
              <div className="kv">
                <span className="k">Subtotal</span>
                <span className="v mono">{money(subtotal)}</span>
              </div>
              <div className="kv" style={{ fontSize: 14.5 }}>
                <span className="k" style={{ color: "var(--ink)", fontWeight: 600 }}>
                  Total
                </span>
                <span className="v mono" style={{ fontSize: 14.5 }}>
                  {money(subtotal)}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-body stack" style={{ gap: 14 }}>
              <div>
                <label className="field-label" htmlFor="supplier_id">
                  Supplier
                </label>
                <select
                  id="supplier_id"
                  name="supplier_id"
                  className="field"
                  required
                  defaultValue={defaultSupplierId ?? ""}
                >
                  <option value="" disabled>
                    Select supplier
                  </option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="location_id">
                  Ship to
                </label>
                <select
                  id="location_id"
                  name="location_id"
                  className="field"
                  defaultValue={
                    locations.find((l) => l.is_primary)?.id ?? locations[0]?.id ?? ""
                  }
                >
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                      {l.is_primary ? " (primary)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="requested_ship_date">
                  Requested ship date
                </label>
                <input
                  id="requested_ship_date"
                  name="requested_ship_date"
                  type="date"
                  className="field"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="notes">
                  Notes to supplier <span className="muted">(optional)</span>
                </label>
                <textarea
                  id="notes"
                  name="notes"
                  className="field"
                  rows={3}
                  placeholder="Anything the supplier should know…"
                />
              </div>
              <button type="submit" className="btn btn-primary">
                Save draft
              </button>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
