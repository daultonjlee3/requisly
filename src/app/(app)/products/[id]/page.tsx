import Link from "next/link";
import { notFound } from "next/navigation";
import { DeletePriceButton } from "@/components/DeletePriceButton";
import { SchedulePriceForm } from "@/components/SchedulePriceForm";
import { Topbar } from "@/components/shell/Topbar";
import { mediumDate, money, shortDate } from "@/lib/format";
import {
  currentPriceLabel,
  currentPriceRowId,
  resolvePricingAsOf,
  todayDateInputValue,
} from "@/lib/pricing";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/workspace";

export default async function SupplierProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { workspace } = await getSessionContext();
  const supabase = await createClient();
  const workspaceId = workspace!.id;
  // Merchant-local calendar day (server TZ for Node; matches schedule form defaults).
  const today = todayDateInputValue();

  const { data: product } = await supabase
    .from("supplier_products")
    .select(
      "id, title, sku, case_qty, moq, product_variant_id, suppliers(id, name)",
    )
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!product) notFound();

  const supplier = product.suppliers as unknown as {
    id: string;
    name: string;
  } | null;

  const { data: priceRows } = await supabase
    .from("supplier_product_prices")
    .select("id, unit_cost, effective_date, created_at, created_by")
    .eq("supplier_product_id", id)
    .order("effective_date", { ascending: false })
    .order("created_at", { ascending: false });

  const schedule = priceRows ?? [];
  const pricing = resolvePricingAsOf(product.id, schedule, today);
  const currentRowId = currentPriceRowId(schedule, today);

  return (
    <>
      <Topbar
        title={product.title}
        subline={
          supplier
            ? `${supplier.name}${product.sku ? ` · ${product.sku}` : ""}`
            : product.sku || "Supplier product"
        }
        actions={
          <>
            {supplier ? (
              <Link
                href={`/suppliers/${supplier.id}?tab=products`}
                className="btn btn-secondary"
              >
                Back to supplier
              </Link>
            ) : (
              <Link href="/products" className="btn btn-secondary">
                Back to products
              </Link>
            )}
          </>
        }
      />
      <div className="content stack" style={{ gap: 20 }}>
        <div
          className="grid-2"
          style={{ gridTemplateColumns: "1fr 320px", alignItems: "start" }}
        >
          <div className="card">
            <div className="card-header">
              <h3>Price schedule</h3>
              <span className="small muted">
                Effective-dated — current is the latest on or before today
              </span>
            </div>
            {(priceRows?.length ?? 0) === 0 ? (
              <div className="card-body empty-state">
                <p style={{ margin: 0 }}>
                  No prices scheduled yet. Add one with the form on the right.
                </p>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Effective</th>
                    <th style={{ textAlign: "right" }}>Unit cost</th>
                    <th>Status</th>
                    <th>Entered</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {priceRows!.map((row) => {
                    let status: "Current" | "Scheduled" | "Past" = "Past";
                    if (row.effective_date > today) status = "Scheduled";
                    else if (row.id === currentRowId) status = "Current";
                    const label = `${money(row.unit_cost)} · ${mediumDate(row.effective_date)}`;

                    return (
                      <tr key={row.id}>
                        <td className="mono">{mediumDate(row.effective_date)}</td>
                        <td className="mono" style={{ textAlign: "right" }}>
                          {money(row.unit_cost)}
                        </td>
                        <td>
                          {status === "Current" ? (
                            <span className="chip chip-confirmed">
                              <span className="chip-dot" />
                              Current
                            </span>
                          ) : status === "Scheduled" ? (
                            <span className="chip chip-sent">
                              <span className="chip-dot" />
                              Scheduled
                            </span>
                          ) : (
                            <span className="chip chip-idle">
                              <span className="chip-dot" />
                              Past
                            </span>
                          )}
                        </td>
                        <td className="mono small muted">
                          {shortDate(row.created_at)}
                        </td>
                        <td style={{ textAlign: "right", width: 1 }}>
                          <DeletePriceButton
                            priceId={row.id}
                            label={label}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="stack">
            <div className="card">
              <div className="card-header">
                <h3>Today</h3>
              </div>
              <div className="card-body stack" style={{ gap: 10 }}>
                <div className="kv">
                  <span className="k">Current unit cost</span>
                  <span className="v mono">
                    {pricing ? currentPriceLabel(pricing) : "—"}
                  </span>
                </div>
                {pricing?.next_unit_cost != null &&
                pricing.next_effective_date ? (
                  <div className="kv">
                    <span className="k">Next change</span>
                    <span className="v mono small">
                      {money(pricing.next_unit_cost)} on{" "}
                      {mediumDate(pricing.next_effective_date)}
                    </span>
                  </div>
                ) : (
                  <p className="small muted" style={{ margin: 0 }}>
                    No future price scheduled.
                  </p>
                )}
                <div className="kv">
                  <span className="k">Case qty</span>
                  <span className="v mono">{product.case_qty ?? "—"}</span>
                </div>
                <div className="kv">
                  <span className="k">MOQ</span>
                  <span className="v mono">{product.moq ?? "—"}</span>
                </div>
                {supplier ? (
                  <div className="kv">
                    <span className="k">Supplier</span>
                    <span className="v">
                      <Link href={`/suppliers/${supplier.id}?tab=products`}>
                        {supplier.name}
                      </Link>
                    </span>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <h3>Schedule a price</h3>
              </div>
              <div className="card-body">
                {supplier ? (
                  <SchedulePriceForm
                    supplierProductId={product.id}
                    supplierId={supplier.id}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
