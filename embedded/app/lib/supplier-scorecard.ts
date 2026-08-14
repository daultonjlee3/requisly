import { money } from "./format";

/** Same threshold as Analytics / AI agents — never export thin history. */
export const SCORECARD_MIN_COMPLETED_POS = 5;

export function pctLabel(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return `${Math.round(Number(value) * 100)}%`;
}

export function daysLabel(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const n = Number(value);
  const abs = Math.abs(n);
  const formatted = abs < 10 ? n.toFixed(1) : String(Math.round(n));
  return `${formatted}d`;
}

export function spendLabel(value: number) {
  return money(value);
}
