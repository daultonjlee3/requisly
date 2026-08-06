import Link from "next/link";
import { StatusChip } from "@/components/StatusChip";
import { SignOutButton } from "@/components/shell/SignOutButton";
import { Topbar } from "@/components/shell/Topbar";
import { money, relativeTime, shortDate } from "@/lib/format";
import type { PoStatus } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/workspace";

export default async function TodaysWorkPage() {
  const { workspace } = await getSessionContext();
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const workspaceId = workspace!.id;

  const [
    { data: waitingConfirmation },
    { data: arrivingToday },
    { data: readyToReceive },
    { data: overdue },
    { data: recentUpdates },
  ] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select("id, po_number, status, total, suppliers(name), updated_at")
      .eq("workspace_id", workspaceId)
      .in("status", ["sent", "viewed"])
      .order("updated_at", { ascending: false })
      .limit(8),
    supabase
      .from("purchase_orders")
      .select("id, po_number, status, confirmed_ship_date, requested_ship_date, suppliers(name)")
      .eq("workspace_id", workspaceId)
      .or(
        `confirmed_ship_date.eq.${today},requested_ship_date.eq.${today}`,
      )
      .in("status", ["confirmed", "production", "shipped", "in_transit"])
      .limit(8),
    supabase
      .from("purchase_orders")
      .select("id, po_number, status, total, suppliers(name), updated_at")
      .eq("workspace_id", workspaceId)
      .in("status", ["shipped", "in_transit", "partially_received"])
      .order("updated_at", { ascending: false })
      .limit(8),
    supabase
      .from("purchase_orders")
      .select("id, po_number, status, requested_ship_date, confirmed_ship_date, suppliers(name)")
      .eq("workspace_id", workspaceId)
      .in("status", ["sent", "viewed", "confirmed", "production"])
      .lt("requested_ship_date", today)
      .limit(8),
    supabase
      .from("po_timeline_events")
      .select(
        "id, event_type, actor, occurred_at, po_id, purchase_orders!inner(po_number, workspace_id, suppliers(name))",
      )
      .eq("purchase_orders.workspace_id", workspaceId)
      .in("actor", ["supplier", "system"])
      .order("occurred_at", { ascending: false })
      .limit(8),
  ]);

  return (
    <>
      <Topbar
        title="Today's Work"
        subline={workspace ? `${workspace.name} · operational command center` : undefined}
        actions={
          <>
            <Link href="/purchase-orders/new" className="btn btn-primary">
              New PO
            </Link>
            <SignOutButton />
          </>
        }
      />
      <div className="content">
        <div className="grid-2" style={{ gap: 16 }}>
          <DashCard
            title="Waiting for confirmation"
            empty="No POs waiting on suppliers."
            rows={(waitingConfirmation ?? []).map((po) => ({
              id: po.id,
              href: `/purchase-orders/${po.id}`,
              primary: po.po_number,
              secondary: supplierName(po.suppliers),
              meta: relativeTime(po.updated_at),
              status: po.status as PoStatus,
              right: money(po.total),
            }))}
          />
          <DashCard
            title="Inventory to receive"
            empty="Nothing ready to receive."
            rows={(readyToReceive ?? []).map((po) => ({
              id: po.id,
              href: `/purchase-orders/${po.id}/receive`,
              primary: po.po_number,
              secondary: supplierName(po.suppliers),
              meta: relativeTime(po.updated_at),
              status: po.status as PoStatus,
              right: money(po.total),
            }))}
          />
          <DashCard
            title="Shipments arriving today"
            empty="No shipments dated today."
            rows={(arrivingToday ?? []).map((po) => ({
              id: po.id,
              href: `/purchase-orders/${po.id}`,
              primary: po.po_number,
              secondary: supplierName(po.suppliers),
              meta: shortDate(po.confirmed_ship_date || po.requested_ship_date),
              status: po.status as PoStatus,
            }))}
          />
          <DashCard
            title="Suppliers overdue"
            empty="No overdue ship dates."
            rows={(overdue ?? []).map((po) => ({
              id: po.id,
              href: `/purchase-orders/${po.id}`,
              primary: po.po_number,
              secondary: supplierName(po.suppliers),
              meta: shortDate(po.requested_ship_date),
              status: po.status as PoStatus,
            }))}
          />
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">
            <h3>Recent supplier updates</h3>
          </div>
          {(recentUpdates?.length ?? 0) === 0 ? (
            <div className="card-body empty-state">
              <p style={{ margin: 0 }}>
                Supplier Link activity will show up here once a supplier opens or
                updates an order.
              </p>
            </div>
          ) : (
            <div className="card-body stack" style={{ gap: 12 }}>
              {recentUpdates!.map((event) => {
                const po = event.purchase_orders as unknown as {
                  po_number: string;
                  suppliers: { name: string } | null;
                } | null;
                return (
                  <div key={event.id} className="between">
                    <div className="small">
                      <Link
                        href={`/purchase-orders/${event.po_id}`}
                        className="po-number"
                      >
                        {po?.po_number ?? "PO"}
                      </Link>{" "}
                      · {event.event_type} via {event.actor}
                      {po?.suppliers?.name ? (
                        <span className="muted"> · {po.suppliers.name}</span>
                      ) : null}
                    </div>
                    <span className="small muted">
                      {relativeTime(event.occurred_at)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function supplierName(value: unknown) {
  const s = value as { name: string } | null;
  return s?.name ?? "—";
}

function DashCard({
  title,
  empty,
  rows,
}: {
  title: string;
  empty: string;
  rows: Array<{
    id: string;
    href: string;
    primary: string;
    secondary: string;
    meta: string;
    status: PoStatus;
    right?: string;
  }>;
}) {
  return (
    <div className="card">
      <div className="card-header">
        <h3>{title}</h3>
        <span className="mono small muted">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div className="card-body">
          <p className="small muted" style={{ margin: 0 }}>
            {empty}
          </p>
        </div>
      ) : (
        <table>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="row-link">
                <td>
                  <Link href={row.href} className="po-number">
                    {row.primary}
                  </Link>
                  <div className="small muted">{row.secondary}</div>
                </td>
                <td>
                  <StatusChip status={row.status} />
                </td>
                <td className="small muted">{row.meta}</td>
                {row.right ? <td className="mono">{row.right}</td> : <td />}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
