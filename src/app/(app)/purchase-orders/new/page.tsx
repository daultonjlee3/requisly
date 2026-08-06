import Link from "next/link";
import { CreatePoForm } from "@/components/CreatePoForm";
import { Topbar } from "@/components/shell/Topbar";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/workspace";

export default async function NewPurchaseOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ supplier?: string }>;
}) {
  const { supplier } = await searchParams;
  const { workspace } = await getSessionContext();
  const supabase = await createClient();
  const workspaceId = workspace!.id;

  const [{ data: suppliers }, { data: locations }] = await Promise.all([
    supabase
      .from("suppliers")
      .select("id, name")
      .eq("workspace_id", workspaceId)
      .order("name"),
    supabase
      .from("locations")
      .select("id, name, is_primary")
      .eq("workspace_id", workspaceId)
      .order("name"),
  ]);

  if (!suppliers?.length) {
    return (
      <>
        <Topbar title="New Purchase Order" />
        <div className="content">
          <div className="card">
            <div className="card-body empty-state">
              <p style={{ margin: "0 0 12px" }}>
                Add a supplier before creating a purchase order.
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

  return (
    <>
      <Topbar
        title="New Purchase Order"
        subline="Draft · not yet sent"
        actions={
          <Link href="/purchase-orders" className="btn btn-secondary">
            Cancel
          </Link>
        }
      />
      <div className="content">
        <CreatePoForm
          suppliers={suppliers}
          locations={locations ?? []}
          defaultSupplierId={supplier}
        />
      </div>
    </>
  );
}
