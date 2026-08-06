import Link from "next/link";
import { LocalDateInput } from "@/components/LocalDateInput";
import { Topbar } from "@/components/shell/Topbar";
import { createSupplierProduct } from "@/lib/actions/products";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/workspace";

export default async function NewSupplierProductPage({
  searchParams,
}: {
  searchParams: Promise<{ supplier?: string }>;
}) {
  const { supplier: supplierParam } = await searchParams;
  const { workspace } = await getSessionContext();
  const supabase = await createClient();

  const { data: suppliers } = await supabase
    .from("suppliers")
    .select("id, name")
    .eq("workspace_id", workspace!.id)
    .order("name");

  if (!suppliers?.length) {
    return (
      <>
        <Topbar title="Add supplier product" />
        <div className="content">
          <div className="card">
            <div className="card-body empty-state">
              <p style={{ margin: "0 0 12px" }}>
                Add a supplier before creating catalog products.
              </p>
              <Link href="/suppliers/new" className="btn btn-primary">
                Add supplier
              </Link>
            </div>
          </div>
        </div>
      </>
    );
  }

  const returnTo = supplierParam
    ? `/suppliers/${supplierParam}?tab=products`
    : "/products";

  return (
    <>
      <Topbar
        title="Add supplier product"
        subline="No Shopify variant required — free-text is fine"
        actions={
          <Link href={returnTo} className="btn btn-secondary">
            Cancel
          </Link>
        }
      />
      <div className="content" style={{ maxWidth: 560 }}>
        <form action={createSupplierProduct} className="card">
          <input type="hidden" name="return_to" value={returnTo} />
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
                defaultValue={supplierParam ?? suppliers[0]!.id}
              >
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="title">
                Title
              </label>
              <input id="title" name="title" className="field" required />
            </div>
            <div>
              <label className="field-label" htmlFor="sku">
                SKU <span className="muted">(optional)</span>
              </label>
              <input id="sku" name="sku" className="field" />
            </div>
            <div className="grid-2">
              <div>
                <label className="field-label" htmlFor="unit_cost">
                  Unit cost <span className="muted">(optional)</span>
                </label>
                <input
                  id="unit_cost"
                  name="unit_cost"
                  className="field"
                  inputMode="decimal"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="effective_date">
                  Price effective
                </label>
                <LocalDateInput
                  id="effective_date"
                  name="effective_date"
                  className="field"
                />
              </div>
            </div>
            <div className="grid-2">
              <div>
                <label className="field-label" htmlFor="case_qty">
                  Case qty <span className="muted">(optional)</span>
                </label>
                <input
                  id="case_qty"
                  name="case_qty"
                  className="field"
                  inputMode="numeric"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="moq">
                  MOQ <span className="muted">(optional)</span>
                </label>
                <input
                  id="moq"
                  name="moq"
                  className="field"
                  inputMode="numeric"
                />
              </div>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              Unit cost is stored on an effective-dated schedule (not a direct
              field edit). Use a future effective date to schedule a change.
              Shopify mapping is optional.
            </p>
            <button type="submit" className="btn btn-primary">
              Save product
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
