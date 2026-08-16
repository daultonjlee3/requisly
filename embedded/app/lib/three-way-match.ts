import { money } from "./format";

const CENT = 0.005;

export type ThreeWayLine = {
  id: string;
  qty: number;
  qtyReceived: number;
};

export type ThreeWayMatch = {
  poTotal: number;
  invoiceAmount: number | null;
  orderedQty: number;
  receivedQty: number;
  receivedComplete: boolean;
  hasReceipts: boolean;
  hasInvoice: boolean;
  ready: boolean;
  amountDiscrepancy: number | null;
  hasDiscrepancy: boolean;
  summary: string;
  receivedLabel: string;
};

function roundMoney(n: number): number {
  return Number(n.toFixed(2));
}

export function receivedLabel(opts: {
  hasReceipts: boolean;
  receivedComplete: boolean;
  receivedQty: number;
  orderedQty: number;
}): string {
  if (!opts.hasReceipts) return "none yet";
  if (opts.receivedComplete) return "full qty confirmed";
  return `${opts.receivedQty} of ${opts.orderedQty} units`;
}

export function buildThreeWayMatch(opts: {
  poTotal: number;
  invoiceAmount: number | null;
  lines: ThreeWayLine[];
}): ThreeWayMatch {
  const poTotal = roundMoney(Number(opts.poTotal) || 0);
  const invoiceAmount =
    opts.invoiceAmount == null || !Number.isFinite(opts.invoiceAmount)
      ? null
      : roundMoney(opts.invoiceAmount);
  const orderedQty = opts.lines.reduce((sum, line) => sum + (line.qty || 0), 0);
  const receivedQty = opts.lines.reduce(
    (sum, line) => sum + (line.qtyReceived || 0),
    0,
  );
  const hasReceipts = receivedQty > 0;
  const receivedComplete =
    opts.lines.length > 0 &&
    opts.lines.every((line) => (line.qtyReceived || 0) >= (line.qty || 0));
  const hasInvoice = invoiceAmount != null;
  const amountDiscrepancy =
    hasInvoice ? roundMoney(invoiceAmount - poTotal) : null;
  const amountMismatch =
    amountDiscrepancy != null && Math.abs(amountDiscrepancy) >= CENT;
  const qtyMismatch = hasReceipts && !receivedComplete;
  const ready = hasReceipts && hasInvoice;
  const hasDiscrepancy = ready && (amountMismatch || qtyMismatch);
  const received = receivedLabel({
    hasReceipts,
    receivedComplete,
    receivedQty,
    orderedQty,
  });

  const parts = [
    `PO: ${money(poTotal)}`,
    `Received: ${received}`,
    hasInvoice
      ? `Invoiced: ${money(invoiceAmount)}`
      : "Invoiced: not submitted",
  ];
  if (amountMismatch && amountDiscrepancy != null) {
    parts.push(`${money(Math.abs(amountDiscrepancy))} discrepancy`);
  } else if (qtyMismatch) {
    parts.push("qty short vs PO");
  }

  return {
    poTotal,
    invoiceAmount,
    orderedQty,
    receivedQty,
    receivedComplete,
    hasReceipts,
    hasInvoice,
    ready,
    amountDiscrepancy,
    hasDiscrepancy,
    summary: parts.join(" · "),
    receivedLabel: received,
  };
}

/** Received, closed, or partially received (incomplete receive is a discrepancy, not a hard skip). */
export const QBO_PUSHABLE_STATUSES = [
  "partially_received",
  "received",
  "closed",
] as const;

export type QboPushableStatus = (typeof QBO_PUSHABLE_STATUSES)[number];

export function isQboPushableStatus(status: string): status is QboPushableStatus {
  return (QBO_PUSHABLE_STATUSES as readonly string[]).includes(status);
}

export type QuickBooksPushGate = {
  ok: boolean;
  alreadySynced: boolean;
  reason: string | null;
};

/**
 * Same 3-way gate the stub used: invoice required, discrepancy must be
 * acknowledged, already-pushed is not a silent re-send. Status eligibility is
 * additive (received/closed), not a parallel discrepancy check.
 */
export function assertQuickBooksPushGate(opts: {
  status: string;
  hasInvoice: boolean;
  hasDiscrepancy: boolean;
  acknowledged: boolean;
  alreadyPushed: boolean;
  force?: boolean;
}): QuickBooksPushGate {
  if (!isQboPushableStatus(opts.status)) {
    return {
      ok: false,
      alreadySynced: false,
      reason:
        "Push to QuickBooks is available once the PO is received or closed.",
    };
  }
  if (!opts.hasInvoice) {
    return {
      ok: false,
      alreadySynced: false,
      reason: "Record the invoiced amount before pushing to QuickBooks.",
    };
  }
  if (opts.hasDiscrepancy && !opts.acknowledged) {
    return {
      ok: false,
      alreadySynced: false,
      reason:
        "Unresolved 3-way discrepancy — acknowledge it before pushing.",
    };
  }
  if (opts.alreadyPushed && !opts.force) {
    return {
      ok: false,
      alreadySynced: true,
      reason: "Already pushed to QuickBooks.",
    };
  }
  return { ok: true, alreadySynced: false, reason: null };
}
