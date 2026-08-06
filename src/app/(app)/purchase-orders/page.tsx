import Link from "next/link";
import { PoCalendar } from "@/components/PoCalendar";
import { PoKanbanBoard } from "@/components/PoKanbanBoard";
import { PoViewToggle, type PoView } from "@/components/PoViewToggle";
import { StatusChip } from "@/components/StatusChip";
import { Topbar } from "@/components/shell/Topbar";
import { money, relativeTime, shortDate } from "@/lib/format";
import type { PoStatus } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/workspace";

function resolveView(value: string | undefined): PoView {
  if (value === "kanban") return "kanban";
  if (value === "calendar") return "calendar";
  return "list";
}

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; month?: string }>;
}) {
  const { view: viewParam, month } = await searchParams;
  const view = resolveView(viewParam);

  const { workspace } = await getSessionContext();
  const supabase = await createClient();
  const { data: pos } = await supabase
    .from("purchase_orders")
    .select(
      "id, po_number, status, total, requested_ship_date, estimated_arrival_date, updated_at, suppliers(name)",
    )
    .eq("workspace_id", workspace!.id)
    .order("created_at", { ascending: false });

  const count = pos?.length ?? 0;

  return (
    <>
      <Topbar
        title="Purchase Orders"
        subline={`${count} order${count === 1 ? "" : "s"}`}
        actions={
          <>
            <PoViewToggle view={view} month={month} />
            <Link href="/purchase-orders/new" className="btn btn-primary">
              New PO
            </Link>
          </>
        }
      />
      <div className="content">
        {count === 0 ? (
          <div className="card">
            <div className="card-body empty-state">
              <p style={{ margin: "0 0 12px" }}>
                No purchase orders yet. Create one to start the golden workflow.
              </p>
              <Link href="/purchase-orders/new" className="btn btn-primary">
                New PO
              </Link>
            </div>
          </div>
        ) : view === "kanban" ? (
          <PoKanbanBoard
            purchaseOrders={(pos ?? []).map((po) => {
              const supplier = po.suppliers as unknown as { name: string } | null;
              return {
                id: po.id,
                po_number: po.po_number,
                status: po.status as PoStatus,
                total: po.total,
                requested_ship_date: po.requested_ship_date,
                supplier_name: supplier?.name ?? "—",
              };
            })}
          />
        ) : view === "calendar" ? (
          <PoCalendar
            monthParam={month}
            purchaseOrders={(pos ?? [])
              .map((po) => {
                const supplier = po.suppliers as unknown as {
                  name: string;
                } | null;
                const plot_date =
                  po.estimated_arrival_date || po.requested_ship_date;
                if (!plot_date) return null;
                return {
                  id: po.id,
                  po_number: po.po_number,
                  status: po.status as PoStatus,
                  total: po.total,
                  supplier_name: supplier?.name ?? "—",
                  plot_date,
                  date_source: po.estimated_arrival_date
                    ? ("arrival" as const)
                    : ("ship" as const),
                };
              })
              .filter((p): p is NonNullable<typeof p> => p != null)}
          />
        ) : (
          <div className="card">
            <table>
              <thead>
                <tr>
                  <th>PO #</th>
                  <th>Supplier</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th>Ship date</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {pos!.map((po) => {
                  const supplier = po.suppliers as unknown as {
                    name: string;
                  } | null;
                  return (
                    <tr key={po.id} className="row-link">
                      <td>
                        <Link
                          href={`/purchase-orders/${po.id}`}
                          className="po-number"
                        >
                          {po.po_number}
                        </Link>
                      </td>
                      <td>{supplier?.name ?? "—"}</td>
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
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
