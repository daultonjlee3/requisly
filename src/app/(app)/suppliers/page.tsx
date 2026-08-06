import Link from "next/link";
import { Topbar } from "@/components/shell/Topbar";
import { supplierInitials, relativeTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/workspace";

export default async function SuppliersPage() {
  const { workspace } = await getSessionContext();
  const supabase = await createClient();
  const { data: suppliers } = await supabase
    .from("suppliers")
    .select("id, name, email, created_at")
    .eq("workspace_id", workspace!.id)
    .order("name");

  const { data: openPos } = await supabase
    .from("purchase_orders")
    .select("supplier_id, status")
    .eq("workspace_id", workspace!.id);

  const openCount = new Map<string, number>();
  for (const po of openPos ?? []) {
    if (po.status === "closed" || po.status === "draft") continue;
    openCount.set(po.supplier_id, (openCount.get(po.supplier_id) ?? 0) + 1);
  }

  return (
    <>
      <Topbar
        title="Suppliers"
        subline={`${suppliers?.length ?? 0} supplier${(suppliers?.length ?? 0) === 1 ? "" : "s"}`}
        actions={
          <Link href="/suppliers/new" className="btn btn-primary">
            Add supplier
          </Link>
        }
      />
      <div className="content">
        <div className="card">
          {(suppliers?.length ?? 0) === 0 ? (
            <div className="card-body empty-state">
              <p style={{ margin: "0 0 12px" }}>
                No suppliers yet. Add one to start creating purchase orders.
              </p>
              <Link href="/suppliers/new" className="btn btn-primary">
                Add supplier
              </Link>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Contact</th>
                  <th>Open POs</th>
                  <th>Added</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {suppliers!.map((supplier) => (
                  <tr key={supplier.id} className="row-link">
                    <td>
                      <Link
                        href={`/suppliers/${supplier.id}`}
                        className="row"
                        style={{ gap: 10 }}
                      >
                        <div className="supplier-avatar">
                          {supplierInitials(supplier.name)}
                        </div>
                        <strong>{supplier.name}</strong>
                      </Link>
                    </td>
                    <td className="small muted">{supplier.email}</td>
                    <td className="mono">{openCount.get(supplier.id) ?? 0}</td>
                    <td className="small">{relativeTime(supplier.created_at)}</td>
                    <td style={{ textAlign: "right" }}>
                      <Link
                        href={`/suppliers/${supplier.id}`}
                        className="btn btn-ghost btn-sm"
                      >
                        View →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
