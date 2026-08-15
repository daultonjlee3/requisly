"use client";

import { useState, useTransition } from "react";
import { runSupplierLinkAction } from "@/lib/supplier-link-actions";
import { money, shortDate } from "@/lib/format";
import { statusChipClass, statusLabel } from "@/lib/po-status";
import type { PoStatus } from "@/lib/types";

type PendingProposal = {
  id: string;
  po_line_item_id: string;
  proposed_qty: number | null;
  proposed_unit_cost: number | null;
  note: string | null;
  status: string;
};

type LineItem = {
  id: string;
  description: string;
  sku: string | null;
  qty: number;
  unit_cost: number;
  line_total: number;
  is_free_text: boolean;
};

type ShipmentLine = {
  po_line_item_id: string;
  description: string;
  qty: number;
};

type Shipment = {
  id: string;
  tracking_number: string | null;
  carrier: string | null;
  estimated_arrival_date: string | null;
  shipped_at: string;
  note: string | null;
  created_by: string;
  lines: ShipmentLine[];
};

type DocumentMeta = {
  id: string;
  file_name: string;
  file_type: string | null;
  kind: string;
  created_at: string;
};

type LinkPayload = {
  po: {
    id: string;
    po_number: string;
    status: PoStatus;
    notes: string | null;
    subtotal: number;
    total: number;
    currency: string;
    requested_ship_date: string | null;
    confirmed_ship_date: string | null;
    estimated_arrival_date: string | null;
    confirmation_stale?: boolean;
    created_at: string;
  };
  supplier: { name: string; email: string };
  workspace: { name: string };
  line_items: LineItem[];
  pending_proposals?: PendingProposal[];
  shipments?: Shipment[];
  documents?: DocumentMeta[];
};

type LineProposalDraft = {
  enabled: boolean;
  qty: string;
  unit_cost: string;
  note: string;
};

function documentKindLabel(kind: string) {
  switch (kind) {
    case "po_pdf":
      return "PO PDF";
    case "invoice":
      return "Invoice";
    case "packing_slip":
      return "Packing slip";
    case "other":
      return "Other";
    default:
      return "Document";
  }
}

function asPayload(raw: unknown): LinkPayload | null {
  const value =
    typeof raw === "string"
      ? (() => {
          try {
            return JSON.parse(raw) as unknown;
          } catch {
            return null;
          }
        })()
      : raw;
  if (!value || typeof value !== "object") return null;
  const parsed = value as LinkPayload;
  if (!parsed.po || !Array.isArray(parsed.line_items)) return null;
  return parsed;
}

function formStateFromPayload(parsed: LinkPayload | null) {
  const shipmentLineQtys: Record<string, string> = {};
  const drafts: Record<string, LineProposalDraft> = {};
  for (const line of parsed?.line_items ?? []) {
    shipmentLineQtys[line.id] = "";
    drafts[line.id] = {
      enabled: false,
      qty: String(line.qty),
      unit_cost: String(line.unit_cost),
      note: "",
    };
  }
  return {
    shipDate:
      parsed?.po.confirmed_ship_date || parsed?.po.requested_ship_date || "",
    estimatedArrival: parsed?.po.estimated_arrival_date || "",
    shipmentLineQtys,
    drafts,
  };
}

export function SupplierLinkClient({
  token,
  initialData,
  initialError,
}: {
  token: string;
  initialData: unknown;
  initialError: string | null;
}) {
  const starting = asPayload(initialData);
  const startingForm = formStateFromPayload(starting);
  const [data, setData] = useState<LinkPayload | null>(starting);
  const [error, setError] = useState<string | null>(
    initialError ?? (initialData && !starting ? "This link could not be read." : null),
  );
  const [shipDate, setShipDate] = useState(startingForm.shipDate);
  const [tracking, setTracking] = useState("");
  const [carrier, setCarrier] = useState("UPS");
  const [estimatedArrival, setEstimatedArrival] = useState(
    startingForm.estimatedArrival,
  );
  const [shipmentNote, setShipmentNote] = useState("");
  const [shipmentLineQtys, setShipmentLineQtys] = useState(
    startingForm.shipmentLineQtys,
  );
  const [rejectNote, setRejectNote] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [drafts, setDrafts] = useState(startingForm.drafts);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function applyPayload(parsed: LinkPayload) {
    setData(parsed);
    setShipDate(
      parsed.po.confirmed_ship_date || parsed.po.requested_ship_date || "",
    );
    setEstimatedArrival(parsed.po.estimated_arrival_date || "");
    setShipmentLineQtys((prev) => {
      const next: Record<string, string> = {};
      for (const line of parsed.line_items) {
        next[line.id] = prev[line.id] ?? "";
      }
      return next;
    });
    setDrafts((prev) => {
      const next: Record<string, LineProposalDraft> = {};
      for (const line of parsed.line_items) {
        next[line.id] = prev[line.id] ?? {
          enabled: false,
          qty: String(line.qty),
          unit_cost: String(line.unit_cost),
          note: "",
        };
      }
      return next;
    });
  }

  function runRpc(
    name: string,
    args: Record<string, unknown>,
    successMessage: string,
  ) {
    startTransition(async () => {
      setMessage(null);
      setError(null);
      const { data: payload, error: rpcError } = await runSupplierLinkAction(
        name,
        args,
      );
      if (rpcError) {
        setError(rpcError);
        return;
      }
      const next = asPayload(payload);
      if (!next) {
        setError("This link could not be read.");
        return;
      }
      applyPayload(next);
      setMessage(successMessage);
      setShowReject(false);
      if (name === "supplier_link_add_shipment" || name === "supplier_link_ship") {
        setTracking("");
        setShipmentNote("");
        setShipmentLineQtys((prev) => {
          const cleared: Record<string, string> = {};
          for (const id of Object.keys(prev)) cleared[id] = "";
          return cleared;
        });
      }
    });
  }

  function confirm() {
    runRpc(
      "supplier_link_confirm",
      { p_token: token, p_ship_date: shipDate || null },
      data?.po.confirmation_stale
        ? "Fresh confirmation recorded for the updated order."
        : "Ship date confirmed. Production stays optional — mark shipped when ready.",
    );
  }

  function reportShipment() {
    const lines = Object.entries(shipmentLineQtys)
      .map(([po_line_item_id, qtyStr]) => ({
        po_line_item_id,
        qty: Number(qtyStr),
      }))
      .filter((l) => l.qty > 0 && !Number.isNaN(l.qty));

    runRpc(
      "supplier_link_add_shipment",
      {
        p_token: token,
        p_tracking: tracking || null,
        p_carrier: carrier || null,
        p_estimated_arrival_date: estimatedArrival || null,
        p_note: shipmentNote.trim() || null,
        p_lines: lines,
      },
      lines.length
        ? "Shipment reported with line quantities."
        : "Shipment reported.",
    );
  }

  function rejectPo() {
    runRpc(
      "supplier_link_reject",
      { p_token: token, p_note: rejectNote || null },
      "Order rejected. No further actions are available on this link.",
    );
  }

  function submitProposals() {
    if (!data) return;
    const changes = data.line_items
      .filter((line) => drafts[line.id]?.enabled)
      .map((line) => {
        const d = drafts[line.id]!;
        const proposed_qty = d.qty === "" ? null : Number(d.qty);
        const proposed_unit_cost =
          d.unit_cost === "" ? null : Number(d.unit_cost);
        return {
          po_line_item_id: line.id,
          proposed_qty,
          proposed_unit_cost,
          note: d.note.trim() || null,
        };
      })
      .filter(
        (c) =>
          (c.proposed_qty != null && !Number.isNaN(c.proposed_qty)) ||
          (c.proposed_unit_cost != null &&
            !Number.isNaN(c.proposed_unit_cost)),
      );

    if (!changes.length) {
      setError("Enable at least one line and set a new quantity or cost.");
      return;
    }

    runRpc(
      "supplier_link_propose_changes",
      { p_token: token, p_changes: changes },
      "Proposal sent. The buyer will accept or reject each line.",
    );
  }

  if (error && !data) {
    return (
      <div className="supplier-shell">
        <div className="supplier-header">
          <h1>Link unavailable</h1>
        </div>
        <div className="supplier-body">
          <p className="small" style={{ color: "var(--status-alert)" }}>
            {error}
          </p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="supplier-shell">
        <div className="supplier-header">
          <div className="from">Loading purchase order…</div>
        </div>
      </div>
    );
  }

  const rejected = data.po.status === "rejected";
  const cancelled = data.po.status === "cancelled";
  const confirmationStale = Boolean(data.po.confirmation_stale);
  const confirmed = [
    "confirmed",
    "production",
    "shipped",
    "in_transit",
    "partially_received",
    "received",
    "closed",
  ].includes(data.po.status);
  const closedOut = ["closed", "received", "rejected", "cancelled"].includes(
    data.po.status,
  );
  const canShip =
    !closedOut &&
    ["confirmed", "production", "shipped", "in_transit", "partially_received"].includes(
      data.po.status,
    );
  const showConfirmCard =
    !rejected &&
    !cancelled &&
    !closedOut &&
    (confirmationStale || ["sent", "viewed"].includes(data.po.status));
  const canPropose =
    !rejected &&
    !cancelled &&
    ["sent", "viewed"].includes(data.po.status);
  const pendingByLine = new Map(
    (data.pending_proposals ?? []).map((p) => [p.po_line_item_id, p]),
  );
  const shipments = data.shipments ?? [];
  const documents = data.documents ?? [];

  return (
    <div className="supplier-shell">
      <div className="supplier-header">
        <div className="from">Purchase order from</div>
        <h1>{data.workspace.name}</h1>
        <div className="sub">
          Sent to {data.supplier.email} · {shortDate(data.po.created_at)}
        </div>
      </div>

      <div className="supplier-body">
        {rejected ? (
          <div
            className="confirmed-banner"
            style={{
              background: "var(--status-alert-wash)",
              color: "var(--status-alert)",
            }}
          >
            This order was rejected. No further updates can be made from this
            link.
          </div>
        ) : null}

        {cancelled ? (
          <div
            className="confirmed-banner"
            style={{
              background: "var(--status-alert-wash)",
              color: "var(--status-alert)",
            }}
          >
            The buyer cancelled this purchase order. No further updates can be
            made from this link.
          </div>
        ) : null}

        {confirmationStale && !rejected && !cancelled ? (
          <div
            className="confirmed-banner"
            style={{
              background: "var(--status-alert-wash)",
              color: "var(--status-alert)",
              marginBottom: 16,
            }}
          >
            The buyer edited this PO after you confirmed. Please review the
            current quantities and confirm again.
          </div>
        ) : null}

        {confirmed && !rejected && !cancelled && !confirmationStale ? (
          <div className="confirmed-banner">
            ✓ You confirmed this order
            {data.po.confirmed_ship_date
              ? ` — ship date ${shortDate(data.po.confirmed_ship_date)}`
              : ""}
          </div>
        ) : null}

        {message ? (
          <div className="confirmed-banner" style={{ marginBottom: 16 }}>
            {message}
          </div>
        ) : null}

        {error ? (
          <p className="small" style={{ color: "var(--status-alert)" }}>
            {error}
          </p>
        ) : null}

        <div className="row between" style={{ marginBottom: 18 }}>
          <div>
            <div className="po-number" style={{ fontSize: 16 }}>
              {data.po.po_number}
            </div>
            <div className="small muted">
              {data.line_items.length} line items · {money(data.po.total)} total
            </div>
          </div>
          <span className={`chip ${statusChipClass(data.po.status)}`}>
            <span className="chip-dot" />
            {statusLabel(data.po.status)}
          </span>
        </div>

        {showConfirmCard ? (
          <div
            className="action-card"
            style={{
              borderColor: "var(--accent)",
              background: "var(--accent-wash)",
            }}
          >
            <h4 style={{ color: "var(--accent-ink)" }}>
              {confirmationStale
                ? "Re-confirm updated order"
                : "Update this order"}
            </h4>
            <div className="stack" style={{ gap: 12 }}>
              <div>
                <label
                  className="field-label"
                  style={{ color: "var(--accent-ink)" }}
                >
                  Ship date
                </label>
                <input
                  type="date"
                  className="field"
                  value={shipDate}
                  onChange={(e) => setShipDate(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={pending || !shipDate}
                onClick={confirm}
                style={{ justifyContent: "center" }}
              >
                {confirmationStale
                  ? "Confirm updated order"
                  : "Confirm ship date"}
              </button>
            </div>
          </div>
        ) : null}

        {canPropose ? (
          <div className="action-card">
            <h4>Propose line changes</h4>
            <p className="small muted" style={{ marginTop: 0 }}>
              Suggest a different quantity or cost. Use the note for context —
              there is no chat thread on this link.
            </p>
            <div className="stack" style={{ gap: 14 }}>
              {data.line_items.map((line) => {
                const draft = drafts[line.id];
                const existing = pendingByLine.get(line.id);
                if (!draft) return null;
                return (
                  <div
                    key={line.id}
                    style={{
                      paddingTop: 10,
                      borderTop: "1px solid var(--line)",
                    }}
                  >
                    <label className="row" style={{ gap: 8, marginBottom: 8 }}>
                      <input
                        type="checkbox"
                        checked={draft.enabled}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [line.id]: {
                              ...prev[line.id]!,
                              enabled: e.target.checked,
                            },
                          }))
                        }
                      />
                      <span style={{ fontWeight: 600 }}>{line.description}</span>
                      <span className="muted small">
                        current × {line.qty} @ {money(line.unit_cost)}
                      </span>
                    </label>
                    {existing ? (
                      <div
                        className="chip chip-sent"
                        style={{ marginBottom: 8 }}
                      >
                        <span className="chip-dot" />
                        Pending proposal
                      </div>
                    ) : null}
                    {draft.enabled ? (
                      <div className="stack" style={{ gap: 8 }}>
                        <div className="row" style={{ gap: 8 }}>
                          <div style={{ flex: 1 }}>
                            <label className="field-label">Qty</label>
                            <input
                              className="field"
                              value={draft.qty}
                              onChange={(e) =>
                                setDrafts((prev) => ({
                                  ...prev,
                                  [line.id]: {
                                    ...prev[line.id]!,
                                    qty: e.target.value,
                                  },
                                }))
                              }
                            />
                          </div>
                          <div style={{ flex: 1 }}>
                            <label className="field-label">Unit cost</label>
                            <input
                              className="field"
                              value={draft.unit_cost}
                              onChange={(e) =>
                                setDrafts((prev) => ({
                                  ...prev,
                                  [line.id]: {
                                    ...prev[line.id]!,
                                    unit_cost: e.target.value,
                                  },
                                }))
                              }
                            />
                          </div>
                        </div>
                        <div>
                          <label className="field-label">
                            Note <span className="muted">(optional)</span>
                          </label>
                          <textarea
                            className="field"
                            rows={2}
                            placeholder="Why this change?"
                            value={draft.note}
                            onChange={(e) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [line.id]: {
                                  ...prev[line.id]!,
                                  note: e.target.value,
                                },
                              }))
                            }
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
              <button
                type="button"
                className="btn btn-secondary"
                style={{ justifyContent: "center" }}
                disabled={pending}
                onClick={submitProposals}
              >
                Send proposal
              </button>
            </div>
          </div>
        ) : null}

        {canShip ? (
          <div className="action-card">
            <h4>
              {shipments.length > 0 ? "Report another shipment" : "Mark as shipped"}
            </h4>
            <p className="small muted" style={{ marginTop: 0 }}>
              Partial shipments are fine — each report keeps its own tracking
              and ETA.
            </p>
            <div className="stack" style={{ gap: 12 }}>
              <div>
                <label className="field-label">
                  Tracking number <span className="muted">(optional)</span>
                </label>
                <input
                  className="field"
                  placeholder="e.g. 1Z8894F2039481"
                  value={tracking}
                  onChange={(e) => setTracking(e.target.value)}
                />
              </div>
              <div>
                <label className="field-label">
                  Carrier <span className="muted">(optional)</span>
                </label>
                <select
                  className="field"
                  value={carrier}
                  onChange={(e) => setCarrier(e.target.value)}
                >
                  <option>UPS</option>
                  <option>FedEx</option>
                  <option>USPS</option>
                  <option>Freight / LTL</option>
                  <option>Other</option>
                </select>
              </div>
              <div>
                <label className="field-label">
                  Estimated arrival <span className="muted">(optional)</span>
                </label>
                <input
                  type="date"
                  className="field"
                  value={estimatedArrival}
                  onChange={(e) => setEstimatedArrival(e.target.value)}
                />
              </div>
              <div>
                <label className="field-label">
                  Note <span className="muted">(optional)</span>
                </label>
                <input
                  className="field"
                  placeholder="e.g. Cartons 1–3 of 6"
                  value={shipmentNote}
                  onChange={(e) => setShipmentNote(e.target.value)}
                />
              </div>
              <div>
                <label className="field-label">
                  Line quantities in this shipment{" "}
                  <span className="muted">(optional)</span>
                </label>
                <div className="stack" style={{ gap: 8 }}>
                  {data.line_items.map((line) => (
                    <div
                      key={line.id}
                      className="row between"
                      style={{ gap: 8, alignItems: "center" }}
                    >
                      <span className="small">
                        {line.description}{" "}
                        <span className="muted">ordered × {line.qty}</span>
                      </span>
                      <input
                        className="field"
                        style={{ width: 88 }}
                        inputMode="numeric"
                        placeholder="Qty"
                        value={shipmentLineQtys[line.id] ?? ""}
                        onChange={(e) =>
                          setShipmentLineQtys((prev) => ({
                            ...prev,
                            [line.id]: e.target.value,
                          }))
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ justifyContent: "center" }}
                disabled={pending}
                onClick={reportShipment}
              >
                {shipments.length > 0 ? "Add shipment" : "Mark shipped"}
              </button>
            </div>
          </div>
        ) : null}

        {shipments.length > 0 ? (
          <div className="action-card">
            <h4>Shipment history</h4>
            <div className="stack" style={{ gap: 14 }}>
              {shipments.map((shipment, index) => (
                <div
                  key={shipment.id}
                  style={{
                    paddingTop: index === 0 ? 0 : 12,
                    borderTop: index === 0 ? undefined : "1px solid var(--line)",
                  }}
                >
                  <div className="row between" style={{ marginBottom: 4 }}>
                    <span style={{ fontWeight: 600 }}>
                      Shipment {shipments.length - index}
                    </span>
                    <span className="small muted">
                      {shortDate(shipment.shipped_at)}
                    </span>
                  </div>
                  <div className="small">
                    {shipment.carrier || "Carrier —"}
                    {shipment.tracking_number
                      ? ` · ${shipment.tracking_number}`
                      : " · No tracking"}
                  </div>
                  {shipment.estimated_arrival_date ? (
                    <div className="small muted">
                      ETA {shortDate(shipment.estimated_arrival_date)}
                    </div>
                  ) : null}
                  {shipment.note ? (
                    <div className="small">{shipment.note}</div>
                  ) : null}
                  {shipment.lines?.length ? (
                    <div className="stack" style={{ gap: 4, marginTop: 6 }}>
                      {shipment.lines.map((line) => (
                        <div
                          key={`${shipment.id}-${line.po_line_item_id}`}
                          className="small muted"
                        >
                          {line.description} × {line.qty}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {documents.length > 0 ? (
          <div className="action-card">
            <h4>Documents</h4>
            <div className="stack" style={{ gap: 10 }}>
              {documents.map((doc) => (
                <div key={doc.id} className="row between" style={{ gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{doc.file_name}</div>
                    <div className="small muted">
                      {documentKindLabel(doc.kind)} ·{" "}
                      {shortDate(doc.created_at)}
                    </div>
                  </div>
                  <a
                    className="btn btn-secondary"
                    href={`/api/supplier-link/document?token=${encodeURIComponent(token)}&documentId=${encodeURIComponent(doc.id)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Download
                  </a>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {canPropose ? (
          <div
            className="action-card"
            style={{ borderColor: "var(--status-alert)" }}
          >
            <h4 style={{ color: "var(--status-alert)" }}>Reject this order</h4>
            {!showReject ? (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ justifyContent: "center" }}
                onClick={() => setShowReject(true)}
              >
                Reject order
              </button>
            ) : (
              <div className="stack" style={{ gap: 10 }}>
                <div>
                  <label className="field-label">
                    Note <span className="muted">(optional)</span>
                  </label>
                  <textarea
                    className="field"
                    rows={2}
                    value={rejectNote}
                    onChange={(e) => setRejectNote(e.target.value)}
                    placeholder="Reason for rejecting"
                  />
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setShowReject(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{
                      background: "var(--status-alert)",
                      borderColor: "var(--status-alert)",
                    }}
                    disabled={pending}
                    onClick={rejectPo}
                  >
                    Confirm rejection
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : null}

        <div className="action-card">
          <h4>Order contents</h4>
          {data.line_items.map((line) => (
            <div key={line.id} className="li-mini">
              <span>
                {line.description}{" "}
                <span className="muted">× {line.qty}</span>
              </span>
              <span className="mono">{money(line.line_total)}</span>
            </div>
          ))}
        </div>

        <div className="footer-note">
          This link is unique to {data.supplier.name}. No account or password
          needed.
        </div>
      </div>
    </div>
  );
}
