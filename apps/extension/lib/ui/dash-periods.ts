import { addCalendarDays, calendarDate, dateParts, zonedMidnight } from "@footprint/ui/dates";

/** Dashboard periods (canvas MenusSheet): the popup's three plus calendar months, all time and custom dates. */
export type DashPeriod =
  | { kind: "today" | "7d" | "30d" | "month" | "last-month" | "all" }
  | { kind: "custom"; from: string; to: string };

export type DashWindow = {
  period: DashPeriod;
  /** "Last 30 days", "This month", "Custom: 1 to 30 Sep". */
  label: string;
  /** Lower-case form for sentences: "last 30 days", "this month", "1 to 30 September". */
  phrase: string;
  /** "7 September to 6 October"; null for all time. */
  range: string | null;
  start?: string;
  end?: string;
  startDate?: string;
  endDate?: string;
  bucket: "hour" | "day";
  /** Bucket keys in display order; empty for all time, which takes its days from the data. */
  keys: string[];
  /** The window before, of the same length; null for all time. */
  previous: null | { start: string; end: string; startDate: string; endDate: string; days: number; phrase: string };
};

export const DASH_PERIOD_LABELS: Record<Exclude<DashPeriod["kind"], "custom">, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  month: "This month",
  "last-month": "Last month",
  all: "All time",
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return { y: y!, m: m!, d: d! };
}
export function monthName(month: string, short = false) {
  return (short ? SHORT_MONTHS : MONTHS)[parts(`${month}-01`).m - 1]!;
}
/** "7 September" or "7 Sep". */
export function dayText(day: string, short = false) {
  const p = parts(day);
  return `${p.d} ${(short ? SHORT_MONTHS : MONTHS)[p.m - 1]}`;
}
/** "7 September to 6 October", or "1 to 30 September" inside one month. */
export function rangeText(first: string, last: string) {
  const a = parts(first);
  const b = parts(last);
  if (first === last) return dayText(first);
  if (a.y === b.y && a.m === b.m) return `${a.d} to ${b.d} ${MONTHS[b.m - 1]}`;
  return `${dayText(first)} to ${dayText(last)}`;
}
export function daysBetween(first: string, endExclusive: string) {
  return Math.round((Date.parse(`${endExclusive}T12:00:00Z`) - Date.parse(`${first}T12:00:00Z`)) / 86_400_000);
}
export function monthOf(day: string) {
  return day.slice(0, 7);
}
export function addMonths(month: string, n: number) {
  const p = parts(`${month}-01`);
  const index = p.y * 12 + (p.m - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}
export function monthDays(month: string) {
  const first = `${month}-01`;
  return daysBetween(first, `${addMonths(month, 1)}-01`);
}
export function todayIn(timezone: string, now: Date) {
  const p = dateParts(now, timezone);
  return calendarDate(p.year, p.month, p.day);
}

function dayWindow(period: DashPeriod, first: string, endExclusive: string, timezone: string, label: string, phrase: string, previousFirst: string | null, previousPhrase: string): DashWindow {
  const days = daysBetween(first, endExclusive);
  const prevStart = previousFirst ?? addCalendarDays(first, -days);
  return {
    period,
    label,
    phrase,
    range: rangeText(first, addCalendarDays(endExclusive, -1)),
    start: zonedMidnight(first, timezone),
    end: zonedMidnight(endExclusive, timezone),
    startDate: first,
    endDate: endExclusive,
    bucket: "day",
    keys: Array.from({ length: days }, (_, i) => addCalendarDays(first, i)),
    previous: {
      start: zonedMidnight(prevStart, timezone),
      end: zonedMidnight(addCalendarDays(prevStart, days), timezone),
      startDate: prevStart,
      endDate: addCalendarDays(prevStart, days),
      days,
      phrase: previousPhrase,
    },
  };
}

/** Calendar windows in the person's time zone. Ends are exclusive midnights, like the ledger filters. */
export function dashWindow(period: DashPeriod, timezone: string, now: Date): DashWindow {
  const today = todayIn(timezone, now);
  const tomorrow = addCalendarDays(today, 1);
  switch (period.kind) {
    case "today":
      return {
        period,
        label: DASH_PERIOD_LABELS.today,
        phrase: "today",
        range: dayText(today),
        start: zonedMidnight(today, timezone),
        end: zonedMidnight(tomorrow, timezone),
        startDate: today,
        endDate: tomorrow,
        bucket: "hour",
        keys: Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0")),
        previous: {
          start: zonedMidnight(addCalendarDays(today, -30), timezone),
          end: zonedMidnight(today, timezone),
          startDate: addCalendarDays(today, -30),
          endDate: today,
          days: 30,
          phrase: "your daily average",
        },
      };
    case "7d":
    case "30d": {
      const n = period.kind === "7d" ? 7 : 30;
      return dayWindow(period, addCalendarDays(today, -(n - 1)), tomorrow, timezone, DASH_PERIOD_LABELS[period.kind], `last ${n} days`, null, `the ${n} days before`);
    }
    case "month": {
      const month = monthOf(today);
      const first = `${month}-01`;
      const before = addMonths(month, -1);
      const elapsed = daysBetween(first, tomorrow);
      // "This month" compares with the same first days of the month before (canvas: "1 to 6 September").
      const prevDays = Math.min(elapsed, monthDays(before));
      return dayWindow(period, first, tomorrow, timezone, DASH_PERIOD_LABELS.month, "this month", `${before}-01`, rangeText(`${before}-01`, addCalendarDays(`${before}-01`, prevDays - 1)));
    }
    case "last-month": {
      const month = addMonths(monthOf(today), -1);
      return monthWindow(month, timezone, DASH_PERIOD_LABELS["last-month"], period);
    }
    case "custom": {
      const [from, to] = period.from <= period.to ? [period.from, period.to] : [period.to, period.from];
      const label = `Custom: ${rangeText(from, to).replace(/ (January|February|March|April|May|June|July|August|September|October|November|December)/g, (m) => ` ${m.trim().slice(0, 3)}`)}`;
      return dayWindow(period, from, addCalendarDays(to, 1), timezone, label, rangeText(from, to), null, "the days before");
    }
    case "all":
      return { period, label: DASH_PERIOD_LABELS.all, phrase: "all time", range: null, bucket: "day", keys: [], previous: null };
  }
}

/** One calendar month, for the monthly recap and "Last month". */
export function monthWindow(month: string, timezone: string, label = `${monthName(month)} ${month.slice(0, 4)}`, period: DashPeriod = { kind: "custom", from: `${month}-01`, to: addCalendarDays(`${addMonths(month, 1)}-01`, -1) }): DashWindow {
  const first = `${month}-01`;
  const next = `${addMonths(month, 1)}-01`;
  const before = addMonths(month, -1);
  const prevDays = monthDays(before);
  const w = dayWindow(period, first, next, timezone, label, rangeText(first, addCalendarDays(next, -1)), `${before}-01`, monthName(before));
  w.previous = { ...w.previous!, days: prevDays, endDate: `${month}-01`, end: zonedMidnight(`${month}-01`, timezone) };
  return w;
}

/** Five evenly spaced axis labels under a daily chart ("7 Sep"), or hours for today. */
export function dashAxis(window: DashWindow, keys = window.keys): string[] {
  if (window.bucket === "hour") return ["00:00", "06:00", "12:00", "18:00", "23:00"];
  if (keys.length === 0) return [];
  const count = Math.min(5, keys.length);
  return Array.from({ length: count }, (_, i) => dayText(keys[Math.round((i * (keys.length - 1)) / Math.max(1, count - 1))]!, true));
}

/** The period serialised for preferences and the address bar. */
export function encodePeriod(period: DashPeriod) {
  return period.kind === "custom" ? `custom:${period.from}:${period.to}` : period.kind;
}
export function decodePeriod(value: unknown): DashPeriod | null {
  if (typeof value !== "string") return null;
  if (["today", "7d", "30d", "month", "last-month", "all"].includes(value)) return { kind: value as Exclude<DashPeriod["kind"], "custom"> };
  const match = /^custom:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(value);
  return match && Number.isFinite(Date.parse(match[1]!)) && Number.isFinite(Date.parse(match[2]!)) ? { kind: "custom", from: match[1]!, to: match[2]! } : null;
}
