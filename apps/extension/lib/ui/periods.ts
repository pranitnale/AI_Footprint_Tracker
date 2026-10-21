import { addCalendarDays, calendarDate, dateParts, zonedMidnight } from "@footprint/ui/dates";

export type PopupPeriod = "today" | "7d" | "30d";
export type PeriodWindow = {
  period: PopupPeriod;
  label: string;
  start: string;
  end: string;
  /** Calendar days for server queries: first day and the exclusive end day. */
  startDate: string;
  endDate: string;
  bucket: "hour" | "day";
  /** Bucket keys in display order: "00" to "23", or calendar days oldest first. */
  keys: string[];
  /** Comparison window. Today compares with the daily average of the 30 days before. */
  previous: { start: string; end: string; startDate: string; endDate: string; days: number };
};

export const PERIOD_LABELS: Record<PopupPeriod, string> = {
  today: "Today",
  "7d": "7 days",
  "30d": "30 days",
};

/** Calendar windows in the person's time zone, matching the dashboard's period boundaries. */
export function periodWindow(period: PopupPeriod, timezone: string, now: Date): PeriodWindow {
  const p = dateParts(now, timezone);
  const today = calendarDate(p.year, p.month, p.day);
  const tomorrow = addCalendarDays(today, 1);
  const end = zonedMidnight(tomorrow, timezone);
  if (period === "today") {
    return {
      period,
      label: PERIOD_LABELS.today,
      start: zonedMidnight(today, timezone),
      end,
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
      },
    };
  }
  const days = period === "7d" ? 7 : 30;
  const first = addCalendarDays(today, -(days - 1));
  return {
    period,
    label: PERIOD_LABELS[period],
    start: zonedMidnight(first, timezone),
    end,
    startDate: first,
    endDate: tomorrow,
    bucket: "day",
    keys: Array.from({ length: days }, (_, i) => addCalendarDays(first, i)),
    previous: {
      start: zonedMidnight(addCalendarDays(first, -days), timezone),
      end: zonedMidnight(first, timezone),
      startDate: addCalendarDays(first, -days),
      endDate: first,
      days,
    },
  };
}

const dayFormat = new Map<string, Intl.DateTimeFormat>();
function formatDay(key: string, options: Intl.DateTimeFormatOptions) {
  const id = JSON.stringify(options);
  let format = dayFormat.get(id);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" });
    dayFormat.set(id, format);
  }
  const text = format.format(new Date(`${key}T12:00:00.000Z`));
  // Recent ICU data abbreviates September as "Sept" in en-GB; the design uses three letters for every month.
  return options.month === "short" ? text.replace("Sept", "Sep") : text;
}

/** Three axis labels under a bar chart: first, middle and last bucket. */
export function axisLabels(window: PeriodWindow): string[] {
  const k = window.keys;
  if (window.bucket === "hour") return ["00:00", "12:00", "23:00"];
  const pick = [k[0]!, k[Math.floor((k.length - 1) / 2)]!, k[k.length - 1]!];
  return window.period === "7d"
    ? pick.map((key) => formatDay(key, { weekday: "short" }))
    : pick.map((key) => formatDay(key, { day: "numeric", month: "short" }));
}

/** "7 Sep" style label for one calendar day key. */
export function dayLabel(key: string, long = false) {
  return formatDay(key, long ? { weekday: "long", day: "numeric", month: "long" } : { day: "numeric", month: "short" });
}
