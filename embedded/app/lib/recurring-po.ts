/** Client-safe recurring PO schedule math. No Node builtins. */

export type ScheduleKind =
  | "off"
  | "every_n_days"
  | "every_n_weeks"
  | "day_of_month";

export type RecurringSchedule = {
  enabled: boolean;
  kind: ScheduleKind;
  interval: number;
  dayOfMonth: number | null;
  leadDays: number;
  nextRunOn: string | null;
};

export const DEFAULT_LEAD_DAYS = 7;
export const MIN_INTERVAL = 1;
export const MAX_INTERVAL = 365;
export const MIN_DAY_OF_MONTH = 1;
export const MAX_DAY_OF_MONTH = 28;

export const DEFAULT_SCHEDULE: RecurringSchedule = {
  enabled: false,
  kind: "every_n_days",
  interval: 14,
  dayOfMonth: 1,
  leadDays: DEFAULT_LEAD_DAYS,
  nextRunOn: null,
};

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateOnly(value: string | null | undefined): value is string {
  return Boolean(value && DATE_ONLY.test(value.trim()));
}

export function utcToday(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function addUtcDays(isoDate: string, days: number): string {
  const m = DATE_ONLY.exec(isoDate.trim());
  if (!m) throw new Error(`Invalid date: ${isoDate}`);
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days);
  return new Date(utc).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const a = DATE_ONLY.exec(from.trim());
  const b = DATE_ONLY.exec(to.trim());
  if (!a || !b) throw new Error("Invalid date");
  const ms =
    Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3])) -
    Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  return Math.round(ms / 86_400_000);
}

export function clampInterval(n: number): number {
  if (!Number.isFinite(n)) return MIN_INTERVAL;
  return Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, Math.round(n)));
}

export function clampDayOfMonth(n: number | null | undefined): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 1;
  return Math.min(MAX_DAY_OF_MONTH, Math.max(MIN_DAY_OF_MONTH, Math.round(v)));
}

export function clampLeadDays(n: number | null | undefined): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return DEFAULT_LEAD_DAYS;
  return Math.min(60, Math.max(0, Math.round(v)));
}

export function normalizeKind(value: string | null | undefined): ScheduleKind {
  if (
    value === "every_n_days" ||
    value === "every_n_weeks" ||
    value === "day_of_month"
  ) {
    return value;
  }
  return "off";
}

function nextDayOfMonthOnOrAfter(from: string, day: number): string {
  const m = DATE_ONLY.exec(from.trim());
  if (!m) throw new Error(`Invalid date: ${from}`);
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  const fromDay = Number(m[3]);
  const dom = clampDayOfMonth(day);
  if (fromDay <= dom) {
    return `${m[1]}-${m[2]}-${String(dom).padStart(2, "0")}`;
  }
  const nextMonth = Date.UTC(year, monthIndex + 1, dom);
  return new Date(nextMonth).toISOString().slice(0, 10);
}

function nextDayOfMonthAfter(from: string, day: number): string {
  return nextDayOfMonthOnOrAfter(addUtcDays(from, 1), day);
}

export function intervalDays(schedule: Pick<RecurringSchedule, "kind" | "interval">): number {
  const n = clampInterval(schedule.interval);
  if (schedule.kind === "every_n_weeks") return n * 7;
  return n;
}

/** Next occurrence strictly after `afterDate`. */
export function nextRunAfter(
  schedule: Pick<RecurringSchedule, "kind" | "interval" | "dayOfMonth">,
  afterDate: string,
): string | null {
  const kind = schedule.kind;
  if (kind === "off") return null;
  if (kind === "day_of_month") {
    return nextDayOfMonthAfter(afterDate, schedule.dayOfMonth ?? 1);
  }
  return addUtcDays(afterDate, intervalDays(schedule));
}

/** First occurrence on or after `fromDate` (used when enabling / defaulting). */
export function firstRunOnOrAfter(
  schedule: Pick<RecurringSchedule, "kind" | "interval" | "dayOfMonth">,
  fromDate: string,
): string | null {
  const kind = schedule.kind;
  if (kind === "off") return null;
  if (kind === "day_of_month") {
    return nextDayOfMonthOnOrAfter(fromDate, schedule.dayOfMonth ?? 1);
  }
  return fromDate;
}

export function isDue(nextRunOn: string | null, today: string): boolean {
  return Boolean(nextRunOn && nextRunOn <= today);
}

/** Surface on Today's Work when the next run is within lead days (inclusive). */
export function isUpcoming(
  nextRunOn: string | null,
  today: string,
  leadDays: number,
): boolean {
  if (!nextRunOn) return false;
  const lead = clampLeadDays(leadDays);
  const horizon = addUtcDays(today, lead);
  return nextRunOn >= today && nextRunOn <= horizon;
}

export function occurrencesInRange(
  schedule: RecurringSchedule,
  fromDate: string,
  toDate: string,
  limit = 24,
): string[] {
  if (!schedule.enabled || schedule.kind === "off") return [];
  let cursor = schedule.nextRunOn
    ? schedule.nextRunOn
    : firstRunOnOrAfter(schedule, fromDate);
  if (!cursor) return [];
  while (cursor < fromDate) {
    const next = nextRunAfter(schedule, cursor);
    if (!next || next <= cursor) break;
    cursor = next;
  }
  const out: string[] = [];
  while (cursor && cursor <= toDate && out.length < limit) {
    if (cursor >= fromDate) out.push(cursor);
    const next = nextRunAfter(schedule, cursor);
    if (!next || next <= cursor) break;
    cursor = next;
  }
  return out;
}

export function scheduleLabel(schedule: RecurringSchedule): string {
  if (!schedule.enabled || schedule.kind === "off") return "Not scheduled";
  const n = clampInterval(schedule.interval);
  if (schedule.kind === "every_n_days") {
    return n === 1 ? "Every day" : `Every ${n} days`;
  }
  if (schedule.kind === "every_n_weeks") {
    return n === 1 ? "Every week" : `Every ${n} weeks`;
  }
  return `Monthly on day ${clampDayOfMonth(schedule.dayOfMonth)}`;
}

export function upcomingMeta(nextRunOn: string, today: string): string {
  const delta = daysBetween(today, nextRunOn);
  if (delta <= 0) return "Due today";
  if (delta === 1) return "Due tomorrow";
  return `Due in ${delta} days`;
}

export function scheduleToDb(schedule: RecurringSchedule) {
  const enabled = schedule.enabled && schedule.kind !== "off";
  return {
    schedule_enabled: enabled,
    schedule_kind: schedule.kind,
    schedule_interval: clampInterval(schedule.interval),
    schedule_day_of_month:
      schedule.kind === "day_of_month"
        ? clampDayOfMonth(schedule.dayOfMonth)
        : null,
    schedule_lead_days: clampLeadDays(schedule.leadDays),
    schedule_next_run_on: schedule.nextRunOn,
  };
}

export function parseScheduleFromForm(form: FormData): RecurringSchedule {
  const enabled = String(form.get("schedule_enabled") ?? "") === "true";
  let kind = normalizeKind(String(form.get("schedule_kind") ?? "off"));
  if (enabled && kind === "off") kind = "every_n_days";
  const interval = clampInterval(Number(form.get("schedule_interval") || 1));
  const dayOfMonth = clampDayOfMonth(
    Number(form.get("schedule_day_of_month") || 1),
  );
  const leadDays = clampLeadDays(Number(form.get("schedule_lead_days") || 7));
  const rawNext = String(form.get("schedule_next_run_on") ?? "").trim();
  const today = utcToday();
  const base: RecurringSchedule = {
    enabled,
    kind,
    interval,
    dayOfMonth: kind === "day_of_month" ? dayOfMonth : null,
    leadDays,
    nextRunOn: null,
  };
  if (!enabled) {
    return {
      ...base,
      enabled: false,
      nextRunOn: isDateOnly(rawNext) ? rawNext : null,
    };
  }
  const nextRunOn = isDateOnly(rawNext)
    ? rawNext
    : firstRunOnOrAfter(base, today);
  return { ...base, nextRunOn };
}
