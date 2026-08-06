import Link from "next/link";
import { Calendar, LayoutGrid, List } from "lucide-react";

export type PoView = "list" | "kanban" | "calendar";

export function PoViewToggle({
  view,
  month,
}: {
  view: PoView;
  month?: string;
}) {
  const calendarHref = month
    ? `/purchase-orders?view=calendar&month=${month}`
    : "/purchase-orders?view=calendar";

  return (
    <div className="view-toggle" role="group" aria-label="Purchase order view">
      <Link
        href="/purchase-orders?view=list"
        className={`view-toggle-btn${view === "list" ? " active" : ""}`}
        aria-current={view === "list" ? "page" : undefined}
      >
        <List size={14} strokeWidth={1.75} />
        List
      </Link>
      <Link
        href={calendarHref}
        className={`view-toggle-btn${view === "calendar" ? " active" : ""}`}
        aria-current={view === "calendar" ? "page" : undefined}
      >
        <Calendar size={14} strokeWidth={1.75} />
        Calendar
      </Link>
      <Link
        href="/purchase-orders?view=kanban"
        className={`view-toggle-btn${view === "kanban" ? " active" : ""}`}
        aria-current={view === "kanban" ? "page" : undefined}
      >
        <LayoutGrid size={14} strokeWidth={1.75} />
        Kanban
      </Link>
    </div>
  );
}
