import Link from "next/link";
import { notFound } from "next/navigation";
import { ClosePoButton } from "@/components/ClosePoButton";
import { ManifestTimeline } from "@/components/ManifestTimeline";
import { PendingProposalsPanel } from "@/components/PendingProposalsPanel";
import { SendPoButton } from "@/components/SendPoButton";
import { StatusChip } from "@/components/StatusChip";
import { Topbar } from "@/components/shell/Topbar";
import { updatePoArrivalDate } from "@/lib/actions/notifications";
import { duplicatePurchaseOrder } from "@/lib/actions/purchase-orders";
import { money, shortDate } from "@/lib/format";
import type { LineItemProposal, PoStatus, TimelineEvent } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/workspace";

export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { workspace } = await getSessionContext();
  const supabase = await createClient();

  const { data: po } = await supabase
    .from("purchase_orders")
    .select(
      "*, suppliers(name, email), locations(name), po_line_items(*), po_timeline_events(*), supplier_link_tokens(token)",
    )
    .eq("id", id)
    .eq("workspace_id", workspace!.id)
    .maybeSingle();

  if (!po) notFound();

  const supplier = po.suppliers as unknown as { name: string; email: string };
  const location = po.locations as unknown as { name: string } | null;
  const lines = (po.po_line_items ?? []) as Array<{
    id: string;
    description: string;
    sku: string | null;
    qty: number;
    unit_cost: number;
    line_total: number;
    is_free_text: boolean;
    sort_order: number;
  }>;
  lines.sort((a, b) => a.sort_order - b.sort_order);

  const events = ((po.po_timeline_events ?? []) as TimelineEvent[]).sort(
    (a, b) => +new Date(a.occurred_at) - +new Date(b.occurred_at),
  );

  const tokens = po.supplier_link_tokens as unknown as Array<{ token: string }>;
  const token = tokens?.[0]?.token;

  const status = po.status as PoStatus;
  const canReceive = ["shipped", "in_transit", "partially_received"].includes(
    status,
  );

  async function duplicate() {
    "use server";
    await duplicatePurchaseOrder(id);
  }

  const shippedEvent = events.find((e) => e.event_type === "shipped");
  const tracking =
    (shippedEvent?.metadata as { tracking_number?: string; carrier?: string } | null)
      ?.tracking_number ?? null;
  const carrier =
    (shippedEvent?.metadata as { tracking_number?: string; carrier?: string } | null)
      ?.carrier ?? null;

  const lineIds = lines.map((l) => l.id);
  const { data: proposalRows } = lineIds.length
    ? await supabase
        .from("po_line_item_proposals")
        .select("*")
        .in("po_line_item_id", lineIds)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
    : { data: [] as LineItemProposal[] };

  const pendingProposals = (proposalRows ?? []) as LineItemProposal[];

  return (
    <>
      <Topbar
        title={po.po_number}
        subline={`${supplier.name} · created ${shortDate(po.created_at)}`}
        actions={
          <>
            <form action={duplicate}>
              <button type="submit" className="btn btn-secondary">
                Duplicate
              </button>
            </form>
            {canReceive ? (
              <Link
                href={`/purchase-orders/${po.id}/receive`}
                className="btn btn-primary"
              >
                Receive
              </Link>
            ) : null}
            {status === "partially_received" ? (
              <ClosePoButton poId={po.id} />
            ) : null}
          </>
        }
      />
      <div className="content">
        <div className="row" style={{ marginBottom: 12, gap: 10 }}>
          <span className="po-number" style={{ fontSize: 18 }}>
            {po.po_number}
          </span>
          <StatusChip status={status} />
        </div>

        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-body">
            <ManifestTimeline status={status} events={events} />
          </div>
        </div>

        {status === "rejected" ? (
          <div
            className="card"
            style={{
              marginBottom: 20,
              borderColor: "var(--status-alert)",
              background: "var(--status-alert-wash)",
            }}
          >
            <div className="card-body" style={{ color: "var(--status-alert)" }}>
              <strong>Rejected by supplier.</strong> This is a terminal state —
              Supplier Link actions are closed for this PO.
            </div>
          </div>
        ) : null}

        <div
          className="grid-2"
          style={{ gridTemplateColumns: "1fr 320px", alignItems: "start" }}
        >
          <div className="stack">
            <PendingProposalsPanel
              proposals={pendingProposals}
              lines={lines.map((l) => ({
                id: l.id,
                description: l.description,
                qty: l.qty,
                unit_cost: Number(l.unit_cost),
              }))}
            />

            <div className="card">
              <div className="card-header">
                <h3>Line items</h3>
                <span className="small muted">
                  {lines.length} item{lines.length === 1 ? "" : "s"}
                </span>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>SKU</th>
                    <th style={{ textAlign: "right" }}>Qty</th>
                    <th style={{ textAlign: "right" }}>Unit cost</th>
                    <th style={{ textAlign: "right" }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.id}>
                      <td>
                        {line.description}{" "}
                        {line.is_free_text ? (
                          <span className="chip chip-idle" style={{ marginLeft: 6 }}>
                            Free-text
                          </span>
                        ) : null}
                      </td>
                      <td className="mono small muted">{line.sku || "—"}</td>
                      <td className="mono" style={{ textAlign: "right" }}>
                        {line.qty}
                      </td>
                      <td className="mono" style={{ textAlign: "right" }}>
                        {money(line.unit_cost)}
                      </td>
                      <td className="mono" style={{ textAlign: "right" }}>
                        {money(line.line_total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div
                className="card-body"
                style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}
              >
                <div className="kv">
                  <span className="k">Total</span>
                  <span className="v mono">{money(po.total)}</span>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <h3>Activity</h3>
              </div>
              <div className="card-body stack" style={{ gap: 12 }}>
                {events.length === 0 ? (
                  <div className="small muted">No activity yet.</div>
                ) : (
                  [...events].reverse().map((event) => (
                    <div key={event.id} className="row" style={{ alignItems: "flex-start" }}>
                      <span
                        className="chip-dot"
                        style={{
                          background: "var(--ink-faint)",
                          marginTop: 6,
                          display: "inline-block",
                        }}
                      />
                      <div className="small">
                        <strong>{event.event_type}</strong> · {event.actor}{" "}
                        <span className="muted">{shortDate(event.occurred_at)}</span>
                        {event.metadata && Object.keys(event.metadata).length ? (
                          <div className="muted mono" style={{ fontSize: 11 }}>
                            {JSON.stringify(event.metadata)}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="stack">
            <div className="card">
              <div className="card-body">
                <div className="small muted" style={{ marginBottom: 4 }}>
                  Supplier
                </div>
                <div style={{ fontWeight: 600 }}>{supplier.name}</div>
                <div className="small muted">{supplier.email}</div>
                <hr className="divider" />
                <div className="kv">
                  <span className="k">Ship to</span>
                  <span className="v">{location?.name ?? "—"}</span>
                </div>
                <div className="kv">
                  <span className="k">Requested ship</span>
                  <span className="v mono">{shortDate(po.requested_ship_date)}</span>
                </div>
                <div className="kv">
                  <span className="k">Confirmed ship</span>
                  <span className="v mono">{shortDate(po.confirmed_ship_date)}</span>
                </div>
                <div className="kv">
                  <span className="k">Est. arrival</span>
                  <span className="v mono">
                    {shortDate(po.estimated_arrival_date)}
                  </span>
                </div>
                {tracking ? (
                  <div className="kv">
                    <span className="k">Tracking</span>
                    <span className="v mono">
                      {carrier ? `${carrier} ` : ""}
                      {tracking}
                    </span>
                  </div>
                ) : null}
                {po.notes ? (
                  <>
                    <hr className="divider" />
                    <div className="small muted">{po.notes}</div>
                  </>
                ) : null}
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <h3>Estimated arrival</h3>
              </div>
              <form
                action={updatePoArrivalDate.bind(null, po.id)}
                className="card-body stack"
                style={{ gap: 10 }}
              >
                <div>
                  <label className="field-label" htmlFor="estimated_arrival_date">
                    Arrival date
                  </label>
                  <input
                    id="estimated_arrival_date"
                    name="estimated_arrival_date"
                    type="date"
                    className="field"
                    defaultValue={po.estimated_arrival_date ?? ""}
                  />
                </div>
                <p className="small muted" style={{ margin: 0 }}>
                  Powers “arriving tomorrow” and “shipment delayed” emails.
                  Suppliers can also set this when marking shipped.
                </p>
                <button type="submit" className="btn btn-secondary btn-sm">
                  Save arrival date
                </button>
              </form>
            </div>

            {(status === "draft" || status === "sent" || token) && (
              <div className="card">
                <div className="card-header">
                  <h3>Supplier Link</h3>
                </div>
                <div className="card-body">
                  <SendPoButton poId={po.id} />
                  {token && status !== "draft" ? (
                    <div className="copy-box" style={{ marginTop: 10 }}>
                      <Link href={`/s/${token}`} style={{ flex: 1, color: "var(--accent)" }}>
                        /s/{token.slice(0, 10)}…
                      </Link>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
