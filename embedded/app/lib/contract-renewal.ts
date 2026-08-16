/** Client-safe vendor contract renewal window. No Node builtins. */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export const DEFAULT_CONTRACT_LEAD_DAYS = 30;

export function isDateOnly(value: string | null | undefined): value is string {
  return Boolean(value && DATE_ONLY.test(value.trim()));
}

export function daysUntil(from: string, to: string): number {
  const a = DATE_ONLY.exec(from.trim());
  const b = DATE_ONLY.exec(to.trim());
  if (!a || !b) throw new Error("Invalid date");
  const ms =
    Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3])) -
    Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  return Math.round(ms / 86_400_000);
}

export function isApproachingRenewal(opts: {
  renewalDate: string | null | undefined;
  today: string;
  leadDays: number;
}): boolean {
  if (!isDateOnly(opts.renewalDate) || !isDateOnly(opts.today)) return false;
  const lead = Number.isFinite(opts.leadDays)
    ? Math.max(0, Math.round(opts.leadDays))
    : DEFAULT_CONTRACT_LEAD_DAYS;
  const delta = daysUntil(opts.today, opts.renewalDate);
  return delta >= 0 && delta <= lead;
}

export function contractRenewalLabel(opts: {
  renewalDate: string | null | undefined;
  today: string;
  leadDays?: number;
}): { label: string; tone: "info" | "warning" | "critical" | "success" | undefined } {
  if (!isDateOnly(opts.renewalDate)) {
    return { label: "No renewal date", tone: undefined };
  }
  const delta = daysUntil(opts.today, opts.renewalDate);
  if (delta < 0) return { label: "Expired", tone: "critical" };
  if (
    isApproachingRenewal({
      renewalDate: opts.renewalDate,
      today: opts.today,
      leadDays: opts.leadDays ?? DEFAULT_CONTRACT_LEAD_DAYS,
    })
  ) {
    if (delta === 0) return { label: "Renews today", tone: "warning" };
    if (delta === 1) return { label: "Renews tomorrow", tone: "warning" };
    return { label: `Renews in ${delta} days`, tone: "warning" };
  }
  return { label: "Upcoming", tone: "info" };
}
