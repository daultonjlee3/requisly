import Link from "next/link";
import { StatusChip } from "@/components/StatusChip";
import { money, shortDate } from "@/lib/format";
import { KANBAN_COLUMNS } from "@/lib/po-status";
import type { PoStatus } from "@/lib/types";

export type KanbanPo = {
  id: string;
  po_number: string;
  status: PoStatus;
  total: number | string;
  requested_ship_date: string | null;
  supplier_name: string;
};

export function PoKanbanBoard({ purchaseOrders }: { purchaseOrders: KanbanPo[] }) {
  const byStatus = new Map<PoStatus, KanbanPo[]>();
  for (const step of KANBAN_COLUMNS) {
    byStatus.set(step.key, []);
  }
  for (const po of purchaseOrders) {
    const bucket = byStatus.get(po.status);
    if (bucket) bucket.push(po);
  }

  return (
    <div className="kanban-board">
      {KANBAN_COLUMNS.map((step) => {
        const cards = byStatus.get(step.key) ?? [];
        return (
          <section key={step.key} className="kanban-column">
            <header className="kanban-column-header">
              <div className="kanban-column-title">
                <span className="kanban-column-label">{step.label}</span>
                {step.skippable ? (
                  <span className="kanban-optional">optional</span>
                ) : null}
              </div>
              <span className="mono small muted">{cards.length}</span>
            </header>
            <div className="kanban-column-body">
              {cards.length === 0 ? (
                <div className="kanban-empty muted small">No POs</div>
              ) : (
                cards.map((po) => (
                  <Link
                    key={po.id}
                    href={`/purchase-orders/${po.id}`}
                    className="kanban-card"
                  >
                    <div className="between" style={{ gap: 8, marginBottom: 8 }}>
                      <span className="po-number">{po.po_number}</span>
                      <StatusChip status={po.status} />
                    </div>
                    <div className="small" style={{ fontWeight: 500 }}>
                      {po.supplier_name}
                    </div>
                    <div className="between" style={{ marginTop: 10 }}>
                      <span className="mono small muted">
                        {shortDate(po.requested_ship_date)}
                      </span>
                      <span className="mono" style={{ fontWeight: 600 }}>
                        {money(po.total)}
                      </span>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
