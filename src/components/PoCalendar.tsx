import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { StatusChip } from "@/components/StatusChip";
import { money } from "@/lib/format";
import type { PoStatus } from "@/lib/types";

export type CalendarPo = {
  id: string;
  po_number: string;
  status: PoStatus;
  total: number | string;
  supplier_name: string;
  /** YYYY-MM-DD plotted date */
  plot_date: string;
  date_source: "arrival" | "ship";
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function monthKey(year: number, monthIndex: number) {
  return `${year}-${pad(monthIndex + 1)}`;
}

function parseMonthParam(value: string | undefined): { year: number; month: number } {
  const now = new Date();
  if (!value || !/^\d{4}-\d{2}$/.test(value)) {
    return { year: now.getFullYear(), month: now.getMonth() };
  }
  const [y, m] = value.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) {
    return { year: now.getFullYear(), month: now.getMonth() };
  }
  return { year: y, month: m - 1 };
}

function shiftMonth(year: number, month: number, delta: number) {
  const d = new Date(year, month + delta, 1);
  return monthKey(d.getFullYear(), d.getMonth());
}

export function PoCalendar({
  purchaseOrders,
  monthParam,
}: {
  purchaseOrders: CalendarPo[];
  monthParam?: string;
}) {
  const { year, month } = parseMonthParam(monthParam);
  const label = new Date(year, month, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);
  const todayKey = (() => {
    const t = new Date();
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  })();

  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const byDate = new Map<string, CalendarPo[]>();
  for (const po of purchaseOrders) {
    if (!po.plot_date.startsWith(monthKey(year, month))) continue;
    const list = byDate.get(po.plot_date) ?? [];
    list.push(po);
    byDate.set(po.plot_date, list);
  }

  const cells: Array<{ day: number | null; key: string | null }> = [];
  for (let i = 0; i < firstDow; i += 1) cells.push({ day: null, key: null });
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({
      day,
      key: `${year}-${pad(month + 1)}-${pad(day)}`,
    });
  }
  while (cells.length % 7 !== 0) cells.push({ day: null, key: null });

  return (
    <div className="card po-calendar">
      <div className="card-header po-calendar-header">
        <div className="row" style={{ gap: 8 }}>
          <Link
            href={`/purchase-orders?view=calendar&month=${prev}`}
            className="btn btn-ghost btn-sm"
            aria-label="Previous month"
          >
            <ChevronLeft size={16} strokeWidth={1.75} />
          </Link>
          <h3 style={{ margin: 0, minWidth: 160 }}>{label}</h3>
          <Link
            href={`/purchase-orders?view=calendar&month=${next}`}
            className="btn btn-ghost btn-sm"
            aria-label="Next month"
          >
            <ChevronRight size={16} strokeWidth={1.75} />
          </Link>
        </div>
        <Link
          href={`/purchase-orders?view=calendar&month=${monthKey(
            new Date().getFullYear(),
            new Date().getMonth(),
          )}`}
          className="btn btn-secondary btn-sm"
        >
          Today
        </Link>
      </div>

      <div className="po-calendar-weekdays">
        {WEEKDAYS.map((d) => (
          <div key={d} className="po-calendar-weekday">
            {d}
          </div>
        ))}
      </div>

      <div className="po-calendar-grid">
        {cells.map((cell, i) => {
          if (!cell.key || cell.day == null) {
            return <div key={`empty-${i}`} className="po-calendar-cell empty" />;
          }
          const items = byDate.get(cell.key) ?? [];
          const isToday = cell.key === todayKey;
          return (
            <div
              key={cell.key}
              className={`po-calendar-cell${isToday ? " today" : ""}`}
            >
              <div className="po-calendar-daynum mono">{cell.day}</div>
              <div className="po-calendar-events">
                {items.map((po) => (
                  <Link
                    key={po.id}
                    href={`/purchase-orders/${po.id}`}
                    className="kanban-card po-calendar-card"
                    title={`${po.po_number} · ${po.supplier_name}`}
                  >
                    <div className="between" style={{ gap: 6, marginBottom: 4 }}>
                      <span className="po-number" style={{ fontSize: 11 }}>
                        {po.po_number}
                      </span>
                      <StatusChip status={po.status} />
                    </div>
                    <div
                      className="small"
                      style={{
                        fontWeight: 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {po.supplier_name}
                    </div>
                    <div className="between" style={{ marginTop: 6 }}>
                      <span className="mono small muted">
                        {po.date_source === "arrival" ? "Arrive" : "Ship"}
                      </span>
                      <span className="mono" style={{ fontSize: 11, fontWeight: 600 }}>
                        {money(po.total)}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
