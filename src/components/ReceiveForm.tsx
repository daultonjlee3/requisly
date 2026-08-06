"use client";

import { useMemo, useState } from "react";
import { completeReceiving } from "@/lib/actions/receiving";
import type { ReceiptCondition } from "@/lib/types";

type Line = {
  id: string;
  description: string;
  qty: number;
  already_received: number;
};

type DraftLine = {
  po_line_item_id: string;
  qty_received: string;
  condition: ReceiptCondition;
  reason_note: string;
};

export function ReceiveForm({
  poId,
  lines,
}: {
  poId: string;
  lines: Line[];
}) {
  const [drafts, setDrafts] = useState<DraftLine[]>(
    lines.map((line) => ({
      po_line_item_id: line.id,
      qty_received: String(Math.max(line.qty - line.already_received, 0)),
      condition: "good" as ReceiptCondition,
      reason_note: "",
    })),
  );

  const progress = useMemo(() => {
    let ordered = 0;
    let received = 0;
    for (const line of lines) {
      ordered += line.qty;
      const draft = drafts.find((d) => d.po_line_item_id === line.id);
      received +=
        line.already_received + (Number(draft?.qty_received) || 0);
    }
    return { ordered, received, pct: ordered ? Math.min(100, Math.round((received / ordered) * 100)) : 0 };
  }, [lines, drafts]);

  function update(id: string, patch: Partial<DraftLine>) {
    setDrafts((prev) =>
      prev.map((d) => (d.po_line_item_id === id ? { ...d, ...patch } : d)),
    );
  }

  return (
    <form action={completeReceiving.bind(null, poId)}>
      <input
        type="hidden"
        name="lines_json"
        value={JSON.stringify(
          drafts.map((d) => ({
            po_line_item_id: d.po_line_item_id,
            qty_received: Number(d.qty_received) || 0,
            condition: d.condition,
            reason_note: d.reason_note || d.condition,
          })),
        )}
      />

      <div
        className="grid-2"
        style={{ gridTemplateColumns: "1fr 300px", alignItems: "start" }}
      >
        <div className="stack">
          <div className="card">
            <div className="card-header">
              <h3>What arrived</h3>
              <span className="small muted">
                Non-good conditions require a reason code
              </span>
            </div>
            <table className="receive-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th style={{ textAlign: "right" }}>Ordered</th>
                  <th style={{ textAlign: "right" }}>Already</th>
                  <th style={{ textAlign: "right" }}>This receipt</th>
                  <th>Condition</th>
                  <th style={{ textAlign: "right" }}>Remaining</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const draft = drafts.find((d) => d.po_line_item_id === line.id)!;
                  const remaining = Math.max(
                    line.qty -
                      line.already_received -
                      (Number(draft.qty_received) || 0),
                    0,
                  );
                  return (
                    <tr key={line.id}>
                      <td>{line.description}</td>
                      <td className="mono" style={{ textAlign: "right" }}>
                        {line.qty}
                      </td>
                      <td className="mono" style={{ textAlign: "right" }}>
                        {line.already_received}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <input
                          type="number"
                          min={0}
                          value={draft.qty_received}
                          onChange={(e) =>
                            update(line.id, { qty_received: e.target.value })
                          }
                        />
                      </td>
                      <td>
                        <select
                          className="reason-select"
                          value={draft.condition}
                          onChange={(e) =>
                            update(line.id, {
                              condition: e.target.value as ReceiptCondition,
                            })
                          }
                        >
                          <option value="good">Good condition</option>
                          <option value="damaged">Damaged</option>
                          <option value="wrong_item">Wrong item</option>
                          <option value="backorder">Backorder</option>
                        </select>
                        {draft.condition !== "good" ? (
                          <input
                            className="field"
                            style={{ marginTop: 6 }}
                            placeholder="Reason note"
                            value={draft.reason_note}
                            onChange={(e) =>
                              update(line.id, { reason_note: e.target.value })
                            }
                            required
                          />
                        ) : null}
                      </td>
                      <td
                        className={`mono ${remaining === 0 ? "qty-ok" : "qty-short"}`}
                        style={{ textAlign: "right" }}
                      >
                        {remaining}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="card-body" style={{ borderTop: "1px solid var(--line)" }}>
              <label className="field-label" htmlFor="note">
                Note on this receipt <span className="muted">(optional)</span>
              </label>
              <textarea id="note" name="note" className="field" rows={2} />
              <div style={{ marginTop: 14 }}>
                <button type="submit" className="btn btn-primary">
                  Complete this receipt →
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-body">
              <div
                className="small muted"
                style={{
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  fontWeight: 600,
                  marginBottom: 8,
                }}
              >
                Receiving progress
              </div>
              <div className="between" style={{ fontSize: 13, marginBottom: 2 }}>
                <span className="muted">
                  {progress.received} of {progress.ordered} units
                </span>
                <span style={{ fontWeight: 600 }}>{progress.pct}%</span>
              </div>
              <div
                style={{
                  height: 6,
                  background: "var(--paper-sunk)",
                  borderRadius: 3,
                  overflow: "hidden",
                  marginTop: 6,
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${progress.pct}%`,
                    background: "var(--status-confirmed)",
                    borderRadius: 3,
                  }}
                />
              </div>
              <div className="small muted" style={{ marginTop: 8 }}>
                {progress.received >= progress.ordered
                  ? "This will mark the PO Received and auto-close it."
                  : "This will mark the PO Partially Received until remaining units arrive (or you Close PO)."}
              </div>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
