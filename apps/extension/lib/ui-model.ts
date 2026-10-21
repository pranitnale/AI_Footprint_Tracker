export type Period = "week" | "month" | "last_month" | "custom" | "all";
export type UsageFilterDraft = {
  period: Period;
  start: string;
  end: string;
  site: string;
  model: string;
  calculationView: "selected" | "original" | "recalculated";
  methodId: string;
};
export type ViewKind = "my" | "company";

import {
  addCalendarDays as addDays,
  calendarDate,
  dateParts as parts,
  monthStart,
  zonedMidnight,
} from "@footprint/ui/dates";
export { zonedMidnight } from "@footprint/ui/dates";
export function buildUsageFilters(
  draft: UsageFilterDraft,
  timezone: string,
  now: Date,
  view: ViewKind,
) {
  if (
    draft.calculationView === "recalculated" &&
    !/^[a-z0-9][a-z0-9.-]{0,127}$/.test(draft.methodId)
  )
    throw new Error("Choose an available calculation method.");
  const current = parts(now, timezone);
  const today = calendarDate(current.year, current.month, current.day);
  let startDate = "",
    endDate = "",
    serverPeriod: "week" | "month" | "all" | "custom";
  if (draft.period === "week") {
    const weekday = new Date(`${today}T12:00:00.000Z`).getUTCDay();
    startDate = addDays(today, -((weekday + 6) % 7));
    endDate = addDays(today, 1);
    serverPeriod = "week";
  } else if (draft.period === "month") {
    startDate = monthStart(today);
    endDate = addDays(today, 1);
    serverPeriod = "month";
  } else if (draft.period === "last_month") {
    startDate = monthStart(today, -1);
    endDate = monthStart(today);
    serverPeriod = "custom";
  } else if (draft.period === "custom") {
    if (!draft.start || !draft.end || draft.start >= draft.end)
      throw new Error(
        "Choose a custom start date before the exclusive end date.",
      );
    startDate = draft.start;
    endDate = draft.end;
    serverPeriod = "custom";
  } else {
    serverPeriod = "all";
  }
  const local = {
    ...(startDate ? { start: zonedMidnight(startDate, timezone) } : {}),
    ...(endDate ? { end: zonedMidnight(endDate, timezone) } : {}),
    ...(draft.site ? { site: draft.site } : {}),
    ...(draft.model && view === "my" ? { model: draft.model } : {}),
    ...(draft.calculationView === "selected"
      ? {}
      : { calculationView: draft.calculationView }),
    ...(draft.calculationView === "recalculated" && draft.methodId
      ? { methodId: draft.methodId }
      : {}),
  };
  const query = new URLSearchParams({ period: serverPeriod });
  if (serverPeriod === "custom") {
    query.set("start", startDate);
    query.set("end", endDate);
  }
  if (draft.site) query.set("site", draft.site);
  if (draft.model && view === "my") query.set("model", draft.model);
  if (draft.calculationView !== "selected")
    query.set("calculation_view", draft.calculationView);
  if (draft.calculationView === "recalculated" && draft.methodId)
    query.set("method_id", draft.methodId);
  return { local, query: `?${query.toString()}`, startDate, endDate };
}

/**
 * The same organization summary query without the per-day, per-site and per-model splits, for
 * screens that read only totals (a previous period, a share). The splits are most of a company
 * summary's size; the totals in the answer are the same with or without them.
 */
export function totalsOnlyQuery(query: string): string {
  const params = new URLSearchParams(query);
  params.set("splits", "none");
  return `?${params.toString()}`;
}

/**
 * The same summary query asking the background for this browser's last validated copy only
 * (cached=only), with no request to the organization server. The copy is the one stored for
 * exactly this query, so it can stand in while the fresh summary for the same query loads.
 */
export function cachedOnlyQuery(query: string): string {
  const params = new URLSearchParams(query);
  params.set("cached", "only");
  return `?${params.toString()}`;
}

export function counter(
  value: string | number | bigint | null | undefined,
): bigint | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0))
    return null;
  const text = String(value);
  if (!/^(0|[1-9]\d*)$/.test(text)) return null;
  const parsed = BigInt(text);
  return parsed <= 9_223_372_036_854_775_807n ? parsed : null;
}

export function addCounters(
  values: Array<string | number | bigint | null | undefined>,
): bigint | null {
  let total = 0n;
  for (const value of values) {
    const parsed = counter(value);
    if (parsed === null) return null;
    total += parsed;
  }
  return total;
}
