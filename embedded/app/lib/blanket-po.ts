/** Client-safe blanket PO remaining / status math. No Node builtins. */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export type BlanketStoredStatus = "active" | "closed";

export type BlanketEffectiveStatus =
  | "active"
  | "closed"
  | "expired"
  | "scheduled";

export type BlanketCommitment = {
  committedQty: number | null;
  committedValue: number | null;
  remainingQty: number | null;
  remainingValue: number | null;
  status: BlanketStoredStatus;
  startDate: string | null;
  endDate: string | null;
};

export type BlanketPickerOption = {
  id: string;
  supplierId: string;
  blanketNumber: string;
  title: string;
  remainingLabel: string;
  canDraw: boolean;
};

export function isDateOnly(value: string | null | undefined): value is string {
  return Boolean(value && DATE_ONLY.test(value.trim()));
}

export function utcToday(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function moneyNumber(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

function qtyNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toFixed(4)));
}

export function parsePositiveAmount(
  value: unknown,
): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function parseOptionalAmount(value: unknown): number | null {
  if (value == null || String(value).trim() === "") return null;
  return parsePositiveAmount(value);
}

export function effectiveStatus(
  blanket: Pick<BlanketCommitment, "status" | "startDate" | "endDate">,
  today: string,
): BlanketEffectiveStatus {
  if (blanket.status === "closed") return "closed";
  if (isDateOnly(blanket.startDate) && blanket.startDate > today) {
    return "scheduled";
  }
  if (isDateOnly(blanket.endDate) && blanket.endDate < today) {
    return "expired";
  }
  return "active";
}

export function canDrawDown(
  blanket: BlanketCommitment,
  today: string,
): boolean {
  if (effectiveStatus(blanket, today) !== "active") return false;
  if (blanket.remainingQty != null && blanket.remainingQty <= 0) return false;
  if (blanket.remainingValue != null && blanket.remainingValue <= 0) return false;
  return (
    blanket.remainingQty != null || blanket.remainingValue != null
  );
}

export function wouldOverdraw(
  blanket: BlanketCommitment,
  qty: number,
  value: number,
): { ok: true } | { ok: false; message: string } {
  const q = Number.isFinite(qty) ? qty : 0;
  const v = Number.isFinite(value) ? value : 0;
  if (q < 0 || v < 0) {
    return { ok: false, message: "Draw-down quantity and value must be zero or more" };
  }
  if (blanket.remainingQty != null && blanket.remainingQty - q < -1e-9) {
    return {
      ok: false,
      message: `This PO would exceed remaining quantity (${qtyNumber(blanket.remainingQty)} left)`,
    };
  }
  if (blanket.remainingValue != null && blanket.remainingValue - v < -1e-9) {
    return {
      ok: false,
      message: `This PO would exceed remaining value (${moneyNumber(blanket.remainingValue)} left)`,
    };
  }
  return { ok: true };
}

export function remainingAfterApply(
  blanket: BlanketCommitment,
  qty: number,
  value: number,
): { remainingQty: number | null; remainingValue: number | null } {
  return {
    remainingQty:
      blanket.remainingQty == null
        ? null
        : Number((blanket.remainingQty - qty).toFixed(4)),
    remainingValue:
      blanket.remainingValue == null
        ? null
        : Number((blanket.remainingValue - value).toFixed(2)),
  };
}

export function remainingLabel(blanket: {
  remainingQty: number | null;
  remainingValue: number | null;
}): string {
  const parts: string[] = [];
  if (blanket.remainingQty != null) {
    parts.push(`${qtyNumber(blanket.remainingQty)} units`);
  }
  if (blanket.remainingValue != null) {
    parts.push(moneyNumber(blanket.remainingValue));
  }
  return parts.length ? parts.join(" · ") : "—";
}

export function committedLabel(blanket: {
  committedQty: number | null;
  committedValue: number | null;
}): string {
  const parts: string[] = [];
  if (blanket.committedQty != null) {
    parts.push(`${qtyNumber(blanket.committedQty)} units`);
  }
  if (blanket.committedValue != null) {
    parts.push(moneyNumber(blanket.committedValue));
  }
  return parts.length ? parts.join(" · ") : "—";
}

export function remainingProgress(blanket: {
  committedQty: number | null;
  committedValue: number | null;
  remainingQty: number | null;
  remainingValue: number | null;
}): number {
  if (blanket.committedValue && blanket.committedValue > 0 && blanket.remainingValue != null) {
    const used = (blanket.committedValue - blanket.remainingValue) / blanket.committedValue;
    return Math.max(0, Math.min(100, Math.round(used * 100)));
  }
  if (blanket.committedQty && blanket.committedQty > 0 && blanket.remainingQty != null) {
    const used = (blanket.committedQty - blanket.remainingQty) / blanket.committedQty;
    return Math.max(0, Math.min(100, Math.round(used * 100)));
  }
  return 0;
}

export function statusLabel(status: BlanketEffectiveStatus): string {
  if (status === "closed") return "Closed";
  if (status === "expired") return "Expired";
  if (status === "scheduled") return "Scheduled";
  return "Active";
}

export function statusTone(
  status: BlanketEffectiveStatus,
): "success" | "attention" | "warning" | "info" | undefined {
  if (status === "closed") return undefined;
  if (status === "expired") return "attention";
  if (status === "scheduled") return "info";
  return "success";
}

export function periodLabel(
  startDate: string | null,
  endDate: string | null,
  formatDate: (value: string | null) => string,
): string {
  if (!startDate && !endDate) return "No period set";
  if (startDate && endDate) {
    return `${formatDate(startDate)} – ${formatDate(endDate)}`;
  }
  if (startDate) return `From ${formatDate(startDate)}`;
  return `Through ${formatDate(endDate)}`;
}

export function nextRemainingOnCommitChange(opts: {
  committedQty: number | null;
  committedValue: number | null;
  remainingQty: number | null;
  remainingValue: number | null;
  nextCommittedQty: number | null;
  nextCommittedValue: number | null;
}):
  | { ok: true; remainingQty: number | null; remainingValue: number | null }
  | { ok: false; message: string } {
  const drawnQty =
    opts.committedQty != null && opts.remainingQty != null
      ? Number((opts.committedQty - opts.remainingQty).toFixed(4))
      : 0;
  const drawnValue =
    opts.committedValue != null && opts.remainingValue != null
      ? Number((opts.committedValue - opts.remainingValue).toFixed(2))
      : 0;

  let remainingQty: number | null = null;
  let remainingValue: number | null = null;

  if (opts.nextCommittedQty != null) {
    remainingQty = Number((opts.nextCommittedQty - drawnQty).toFixed(4));
    if (remainingQty < 0) {
      return {
        ok: false,
        message: `Committed quantity cannot be below ${qtyNumber(drawnQty)} already drawn`,
      };
    }
  }
  if (opts.nextCommittedValue != null) {
    remainingValue = Number((opts.nextCommittedValue - drawnValue).toFixed(2));
    if (remainingValue < 0) {
      return {
        ok: false,
        message: `Committed value cannot be below ${moneyNumber(drawnValue)} already drawn`,
      };
    }
  }
  if (remainingQty == null && remainingValue == null) {
    return {
      ok: false,
      message: "Set a committed quantity, a committed value, or both",
    };
  }
  return { ok: true, remainingQty, remainingValue };
}
