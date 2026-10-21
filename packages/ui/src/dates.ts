export type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export function dateParts(date: Date, timezone: string): DateParts {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((value) => value.type !== "literal")
      .map((value) => [value.type, value.value]),
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

export function calendarDate(year: number, month: number, day: number) {
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

export function addCalendarDays(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return calendarDate(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  );
}

export function monthStart(value: string, offset = 0) {
  const [year, month] = value.split("-").map(Number) as [number, number];
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return calendarDate(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

export function zonedMidnight(value: string, timezone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("Use a valid calendar date in YYYY-MM-DD form.");
  const [year, month, day] = value.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const normalized = new Date(Date.UTC(year, month - 1, day));
  if (
    normalized.getUTCFullYear() !== year ||
    normalized.getUTCMonth() + 1 !== month ||
    normalized.getUTCDate() !== day
  )
    throw new Error("The selected calendar date does not exist.");
  const target = year * 10_000 + month * 100 + day;
  const center = normalized.valueOf();
  let low = center - 36 * 60 * 60 * 1_000;
  let high = center + 36 * 60 * 60 * 1_000;
  while (low < high) {
    const midpoint = Math.floor((low + high) / 2);
    const actual = dateParts(new Date(midpoint), timezone);
    const key = actual.year * 10_000 + actual.month * 100 + actual.day;
    if (key < target) low = midpoint + 1;
    else high = midpoint;
  }
  const found = dateParts(new Date(low), timezone);
  if (found.year * 10_000 + found.month * 100 + found.day !== target)
    throw new Error("This local date does not exist in the selected timezone.");
  return new Date(low).toISOString();
}

export function previousMonthRange(timezone: string, now = new Date()) {
  const current = dateParts(now, timezone);
  const today = calendarDate(current.year, current.month, current.day);
  return { start: monthStart(today, -1), end: monthStart(today) };
}
