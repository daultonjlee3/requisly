import { money } from "@/lib/format";
import { monthLabel } from "@/lib/analytics";

export type SpendBySupplier = {
  supplierId: string;
  name: string;
  total: number;
  poCount: number;
};

export type SpendByMonth = {
  month: string;
  total: number;
  poCount: number;
};

export type SpendBySku = {
  sku: string;
  description: string;
  total: number;
  qty: number;
};

export function SpendSection({
  bySupplier,
  byMonth,
  bySku,
  totalSpend,
}: {
  bySupplier: SpendBySupplier[];
  byMonth: SpendByMonth[];
  bySku: SpendBySku[];
  totalSpend: number;
}) {
  const maxSupplier = Math.max(...bySupplier.map((s) => s.total), 1);
  const maxMonth = Math.max(...byMonth.map((m) => m.total), 1);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="card">
        <div className="card-header">
          <h3>Spend overview</h3>
          <span className="mono" style={{ fontWeight: 600 }}>
            {money(totalSpend)} closed
          </span>
        </div>
        <div className="card-body">
          <p className="small muted" style={{ margin: "0 0 4px" }}>
            Pure aggregation over purchase orders — no separate analytics model.
          </p>
        </div>
      </div>

      <div
        className="grid-2"
        style={{ gridTemplateColumns: "1fr 1fr", alignItems: "start", gap: 20 }}
      >
        <div className="card">
          <div className="card-header">
            <h3>By supplier</h3>
          </div>
          <div className="card-body">
            {bySupplier.length === 0 ? (
              <p className="small muted" style={{ margin: 0 }}>
                No closed PO spend yet.
              </p>
            ) : (
              <div className="analytics-bars">
                {bySupplier.map((row) => (
                  <div key={row.supplierId} className="analytics-bar-row">
                    <div className="analytics-bar-label">{row.name}</div>
                    <div className="analytics-bar-track">
                      <div
                        className="analytics-bar-fill"
                        style={{
                          width: `${Math.round((row.total / maxSupplier) * 100)}%`,
                        }}
                      />
                    </div>
                    <div className="analytics-bar-value mono">
                      {money(row.total)}
                      <span className="muted" style={{ marginLeft: 6 }}>
                        {row.poCount} POs
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>By month</h3>
          </div>
          <div className="card-body">
            {byMonth.length === 0 ? (
              <p className="small muted" style={{ margin: 0 }}>
                No monthly spend yet.
              </p>
            ) : (
              <div className="analytics-bars">
                {byMonth.map((row) => (
                  <div key={row.month} className="analytics-bar-row">
                    <div className="analytics-bar-label mono">
                      {monthLabel(row.month)}
                    </div>
                    <div className="analytics-bar-track">
                      <div
                        className="analytics-bar-fill accent-soft"
                        style={{
                          width: `${Math.round((row.total / maxMonth) * 100)}%`,
                        }}
                      />
                    </div>
                    <div className="analytics-bar-value mono">
                      {money(row.total)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>Top line items by spend</h3>
        </div>
        {bySku.length === 0 ? (
          <div className="card-body">
            <p className="small muted" style={{ margin: 0 }}>
              No line-item spend yet.
            </p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>SKU</th>
                <th style={{ textAlign: "right" }}>Qty</th>
                <th style={{ textAlign: "right" }}>Spend</th>
              </tr>
            </thead>
            <tbody>
              {bySku.map((row) => (
                <tr key={`${row.sku}-${row.description}`}>
                  <td>{row.description}</td>
                  <td className="mono small muted">{row.sku || "—"}</td>
                  <td className="mono" style={{ textAlign: "right" }}>
                    {row.qty}
                  </td>
                  <td className="mono" style={{ textAlign: "right" }}>
                    {money(row.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
