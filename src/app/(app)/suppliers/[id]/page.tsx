import Link from "next/link";
import { notFound } from "next/navigation";
import { AddSupplierProductForm } from "@/components/AddSupplierProductForm";
import { SchedulePriceForm } from "@/components/SchedulePriceForm";
import { ScheduledPriceNote } from "@/components/ScheduledPriceNote";
import { StatusChip } from "@/components/StatusChip";
import { Topbar } from "@/components/shell/Topbar";
import { money, relativeTime, shortDate, supplierInitials } from "@/lib/format";
import {
  currentPriceLabel,
  type SupplierProductPricing,
} from "@/lib/pricing";
import type { PoStatus } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import { updateSupplier } from "@/lib/actions/suppliers";
import { getSessionContext } from "@/lib/workspace";

export default async function SupplierDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const tab = tabParam === "products" ? "products" : "orders";

  const { workspace } = await getSessionContext();
  const supabase = await createClient();

  const { data: supplier } = await supabase
    .from("suppliers")
    .select("*")
    .eq("id", id)
    .eq("workspace_id", workspace!.id)
    .maybeSingle();

  if (!supplier) notFound();

  const [{ data: pos }, { data: products }, { data: pricingRows }] =
    await Promise.all([
      supabase
        .from("purchase_orders")
        .select("id, po_number, status, total, requested_ship_date, updated_at")
        .eq("supplier_id", id)
        .eq("workspace_id", workspace!.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("supplier_products")
        .select("id, title, sku, case_qty, moq")
        .eq("supplier_id", id)
        .eq("workspace_id", workspace!.id)
        .order("title"),
      supabase
        .from("supplier_product_pricing")
        .select(
          "supplier_product_id, current_unit_cost, next_unit_cost, next_effective_date",
        )
        .eq("supplier_id", id)
        .eq("workspace_id", workspace!.id),
    ]);

  const pricingByProduct = new Map<string, SupplierProductPricing>();
  for (const row of pricingRows ?? []) {
    pricingByProduct.set(row.supplier_product_id, {
      supplier_product_id: row.supplier_product_id,
      current_unit_cost:
        row.current_unit_cost == null ? null : Number(row.current_unit_cost),
      next_unit_cost:
        row.next_unit_cost == null ? null : Number(row.next_unit_cost),
      next_effective_date: row.next_effective_date,
    });
  }

  const openCount = (pos ?? []).filter(
    (p) => p.status !== "closed" && p.status !== "draft",
  ).length;

  async function save(formData: FormData) {
    "use server";
    await updateSupplier(id, formData);
  }

  return (
    <>
      <Topbar
        title={supplier.name}
        subline={`${supplier.email} · supplier since ${shortDate(supplier.created_at)}`}
        actions={
          <Link
            href={`/purchase-orders/new?supplier=${supplier.id}`}
            className="btn btn-primary"
          >
            New PO
          </Link>
        }
      />
      <div className="content">
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-body" style={{ display: "flex", padding: 0 }}>
            <div
              className="stat-mini"
              style={{ flex: 1, borderRight: "1px solid var(--line)" }}
            >
              <div className="num">{pos?.length ?? 0}</div>
              <div className="label">Total POs</div>
            </div>
            <div
              className="stat-mini"
              style={{ flex: 1, borderRight: "1px solid var(--line)" }}
            >
              <div className="num">{openCount}</div>
              <div className="label">Open now</div>
            </div>
            <div className="stat-mini" style={{ flex: 1 }}>
              <div className="num">{products?.length ?? 0}</div>
              <div className="label">Products</div>
            </div>
          </div>
        </div>

        <div className="detail-tabs" role="tablist">
          <Link
            href={`/suppliers/${supplier.id}`}
            className={`detail-tab${tab === "orders" ? " active" : ""}`}
            role="tab"
            aria-selected={tab === "orders"}
          >
            Purchase orders
          </Link>
          <Link
            href={`/suppliers/${supplier.id}?tab=products`}
            className={`detail-tab${tab === "products" ? " active" : ""}`}
            role="tab"
            aria-selected={tab === "products"}
          >
            Products
          </Link>
        </div>

        {tab === "products" ? (
          <div className="stack" style={{ gap: 16 }}>
            <div className="card">
              <div className="card-header">
                <h3>Products</h3>
                <span className="small muted">
                  Prices from the effective-dated schedule — today&apos;s
                  current only
                </span>
              </div>
              {(products?.length ?? 0) === 0 ? (
                <div className="card-body empty-state">
                  <p style={{ margin: 0 }}>
                    No catalog products yet. Add the first one below.
                  </p>
                </div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>SKU</th>
                      <th>Unit cost</th>
                      <th style={{ textAlign: "right" }}>Case qty</th>
                      <th style={{ textAlign: "right" }}>MOQ</th>
                      <th>Schedule a price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products!.map((product) => {
                      const pricing = pricingByProduct.get(product.id);
                      return (
                        <tr key={product.id}>
                          <td>
                            <Link
                              href={`/products/${product.id}`}
                              className="title-link"
                            >
                              <strong>{product.title}</strong>
                            </Link>
                          </td>
                          <td className="mono small muted">
                            {product.sku || "—"}
                          </td>
                          <td>
                            <div className="mono">
                              {pricing ? currentPriceLabel(pricing) : "—"}
                            </div>
                            {pricing?.current_unit_cost != null &&
                            pricing.next_unit_cost != null &&
                            pricing.next_effective_date ? (
                              <div className="price-change-note">
                                Current: {money(pricing.current_unit_cost)} ·{" "}
                                Changing to {money(pricing.next_unit_cost)} on{" "}
                                {shortDate(pricing.next_effective_date)}
                              </div>
                            ) : pricing ? (
                              <ScheduledPriceNote
                                next_unit_cost={pricing.next_unit_cost}
                                next_effective_date={
                                  pricing.next_effective_date
                                }
                              />
                            ) : null}
                          </td>
                          <td className="mono" style={{ textAlign: "right" }}>
                            {product.case_qty ?? "—"}
                          </td>
                          <td className="mono" style={{ textAlign: "right" }}>
                            {product.moq ?? "—"}
                          </td>
                          <td>
                            <SchedulePriceForm
                              supplierProductId={product.id}
                              supplierId={supplier.id}
                              compact
                              returnTo={`/suppliers/${supplier.id}?tab=products`}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card">
              <div className="card-header">
                <h3>Add product</h3>
                <span className="small muted">
                  Creates the catalog row and the first price schedule entry
                </span>
              </div>
              <div className="card-body">
                <AddSupplierProductForm
                  supplierId={supplier.id}
                  returnTo={`/suppliers/${supplier.id}?tab=products`}
                />
              </div>
            </div>
          </div>
        ) : (
          <div
            className="grid-2"
            style={{ gridTemplateColumns: "1fr 300px", alignItems: "start" }}
          >
            <div className="card">
              <div className="card-header">
                <h3>Purchase orders</h3>
              </div>
              {(pos?.length ?? 0) === 0 ? (
                <div className="card-body empty-state">
                  <p style={{ margin: 0 }}>No POs with this supplier yet.</p>
                </div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>PO #</th>
                      <th>Status</th>
                      <th>Total</th>
                      <th>Expected</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pos!.map((po) => (
                      <tr key={po.id} className="row-link">
                        <td>
                          <Link
                            href={`/purchase-orders/${po.id}`}
                            className="po-number"
                          >
                            {po.po_number}
                          </Link>
                        </td>
                        <td>
                          <StatusChip status={po.status as PoStatus} />
                        </td>
                        <td className="mono">{money(po.total)}</td>
                        <td className="mono small">
                          {shortDate(po.requested_ship_date)}
                        </td>
                        <td className="small muted">
                          {relativeTime(po.updated_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="stack">
              <div className="card">
                <div className="card-header">
                  <h3>Details</h3>
                  <div className="supplier-avatar">
                    {supplierInitials(supplier.name)}
                  </div>
                </div>
                <form action={save} className="card-body stack" style={{ gap: 12 }}>
                  <div>
                    <label className="field-label" htmlFor="name">
                      Name
                    </label>
                    <input
                      id="name"
                      name="name"
                      className="field"
                      defaultValue={supplier.name}
                      required
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="email">
                      Email
                    </label>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      className="field"
                      defaultValue={supplier.email}
                      required
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="contact_name">
                      Contact
                    </label>
                    <input
                      id="contact_name"
                      name="contact_name"
                      className="field"
                      defaultValue={supplier.contact_name ?? ""}
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="phone">
                      Phone
                    </label>
                    <input
                      id="phone"
                      name="phone"
                      className="field"
                      defaultValue={supplier.phone ?? ""}
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="payment_terms">
                      Payment terms
                    </label>
                    <input
                      id="payment_terms"
                      name="payment_terms"
                      className="field"
                      defaultValue={supplier.payment_terms ?? ""}
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="notes">
                      Notes
                    </label>
                    <textarea
                      id="notes"
                      name="notes"
                      className="field"
                      rows={3}
                      defaultValue={supplier.notes ?? ""}
                    />
                  </div>
                  <button type="submit" className="btn btn-secondary">
                    Save details
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
