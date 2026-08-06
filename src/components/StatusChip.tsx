import { statusChipClass, statusLabel } from "@/lib/po-status";
import type { PoStatus } from "@/lib/types";

export function StatusChip({ status }: { status: PoStatus }) {
  return (
    <span className={`chip ${statusChipClass(status)}`}>
      <span className="chip-dot" />
      {statusLabel(status)}
    </span>
  );
}
