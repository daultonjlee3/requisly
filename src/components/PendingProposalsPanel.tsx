"use client";

import { useTransition } from "react";
import { resolveProposal } from "@/lib/actions/proposals";
import { money } from "@/lib/format";
import type { LineItemProposal } from "@/lib/types";

type Line = {
  id: string;
  description: string;
  qty: number;
  unit_cost: number;
};

export function PendingProposalsPanel({
  proposals,
  lines,
}: {
  proposals: LineItemProposal[];
  lines: Line[];
}) {
  const [pending, startTransition] = useTransition();
  const lineById = new Map(lines.map((l) => [l.id, l]));

  if (!proposals.length) return null;

  function act(id: string, accept: boolean) {
    startTransition(async () => {
      await resolveProposal(id, accept);
    });
  }

  return (
    <div className="card">
      <div className="card-header">
        <h3>Pending proposals</h3>
        <span className="chip chip-sent">
          <span className="chip-dot" />
          {proposals.length} awaiting review
        </span>
      </div>
      <div className="card-body stack" style={{ gap: 14 }}>
        <p className="small muted" style={{ margin: 0 }}>
          Accepting a proposal updates that line&apos;s quantity/cost and
          recalculates the PO total. The supplier&apos;s note is the only
          message — there is no chat thread.
        </p>
        {proposals.map((proposal) => {
          const line = lineById.get(proposal.po_line_item_id);
          return (
            <div
              key={proposal.id}
              style={{
                padding: 14,
                border: "1px solid var(--line)",
                borderRadius: "var(--radius-sm)",
                background: "var(--paper)",
              }}
            >
              <div className="between" style={{ marginBottom: 8 }}>
                <div style={{ fontWeight: 600 }}>
                  {line?.description ?? "Line item"}
                </div>
                <span className="chip chip-sent">
                  <span className="chip-dot" />
                  Pending
                </span>
              </div>
              <div className="small muted" style={{ marginBottom: 8 }}>
                Current: × {line?.qty ?? "—"} @{" "}
                {line ? money(line.unit_cost) : "—"}
              </div>
              <div className="row" style={{ gap: 16, marginBottom: 8 }}>
                {proposal.proposed_qty != null ? (
                  <div>
                    <div className="field-label">Proposed qty</div>
                    <div className="mono" style={{ fontWeight: 600 }}>
                      {proposal.proposed_qty}
                    </div>
                  </div>
                ) : null}
                {proposal.proposed_unit_cost != null ? (
                  <div>
                    <div className="field-label">Proposed unit cost</div>
                    <div className="mono" style={{ fontWeight: 600 }}>
                      {money(proposal.proposed_unit_cost)}
                    </div>
                  </div>
                ) : null}
              </div>
              {proposal.note ? (
                <div
                  className="small"
                  style={{
                    padding: "8px 10px",
                    background: "var(--paper-raised)",
                    border: "1px solid var(--line)",
                    borderRadius: "var(--radius-sm)",
                    marginBottom: 10,
                  }}
                >
                  <span className="muted">Supplier note: </span>
                  {proposal.note}
                </div>
              ) : null}
              <div className="row" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={pending}
                  onClick={() => act(proposal.id, false)}
                >
                  Reject proposal
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={pending}
                  onClick={() => act(proposal.id, true)}
                >
                  Accept proposal
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
