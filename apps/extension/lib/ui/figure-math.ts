import type { DisplayScenario } from "@footprint/contracts";
import { carbonEquivalent, energyEquivalent, toGrams, toMillilitres, toWh, waterEquivalent } from "@footprint/ui/comparisons";
import { formatInteger, formatMetric, metricParts } from "@footprint/ui/formatters";
import type { BreakdownSummary, UsageBreakdownView } from "../dashboard/types";
import type { HistorySummary } from "@footprint/contracts";
import { usageFigures, type UsageFigures } from "./usage-figures";
import type { Resource } from "./components";

/** A dashboard figure: one of the three resources, or the request count. */
export type Metric = Resource | "requests";

/**
 * A figure in a fixed base unit (Wh, g CO2e, mL or requests) so charts can scale and compare it.
 * Null when the figure is unknown. Presentation only: the stored and estimated values are untouched.
 */
export function baseValue(f: UsageFigures, metric: Metric): number | null {
  if (metric === "requests") return f.requests === null ? null : Number(f.requests);
  const figure = f[metric];
  return metric === "energy" ? toWh(figure.value, figure.unit) : metric === "carbon" ? toGrams(figure.value, figure.unit) : toMillilitres(figure.value, figure.unit);
}

/** Formats a base-unit value with the same scaling rules as the bar under each chat. */
/** "1 request", "12 requests"; a string is an already formatted count, such as "≈ 1". */
export function requestsPhrase(count: string | number) {
  const text = typeof count === "number" ? formatInteger(Math.round(count)) : count;
  return `${text} ${text.replace(/^≈ /, "") === "1" ? "request" : "requests"}`;
}

// Zero has no size to pick a unit by, so it would read "0 kWh" or "0 L"; it takes the unit
// small figures use.
const ZERO_PARTS: Record<Resource, { number: string; unit: string }> = {
  energy: { number: "0", unit: "Wh" },
  carbon: { number: "0", unit: "g CO₂e" },
  water: { number: "0", unit: "mL" },
};

export function baseText(metric: Metric, value: number | null, digits = 3): string {
  if (value === null || !Number.isFinite(value)) return "Unknown";
  if (metric === "requests") return formatInteger(Math.round(value));
  if (value === 0) return `0 ${ZERO_PARTS[metric].unit}`;
  const text = metric === "energy" ? formatMetric(String(value / 1000), "kWh", digits) : metric === "carbon" ? formatMetric(String(value), "gCO2e", digits) : formatMetric(String(value / 1000), "L", digits);
  return text.replace(/^≈ /, "");
}
export function baseParts(metric: Metric, value: number | null, digits = 3): { number: string; unit: string } | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (metric === "requests") return { number: formatInteger(Math.round(value)), unit: Math.round(value) === 1 ? "request" : "requests" };
  if (value === 0) return { ...ZERO_PARTS[metric] };
  return metric === "energy" ? metricParts(String(value / 1000), "kWh", digits) : metric === "carbon" ? metricParts(String(value), "gCO2e", digits) : metricParts(String(value / 1000), "L", digits);
}

export function equivalentText(metric: Metric, value: number | null) {
  if (value === null || metric === "requests") return null;
  return metric === "energy" ? energyEquivalent(value) : metric === "carbon" ? carbonEquivalent(value) : waterEquivalent(value);
}

/** "12% less than the 30 days before"; null when there is nothing to compare with. */
export function changeText(current: number | null, previous: number | null, against: string, perDay?: number) {
  if (current === null || previous === null || !(previous > 0)) return null;
  const base = perDay ? previous / perDay : previous;
  if (!(base > 0)) return null;
  const change = Math.round(((current - base) / base) * 100);
  if (change === 0) return { up: false, change, text: `Same as ${against}` };
  return { up: change > 0, change, text: `${Math.abs(change)}% ${change > 0 ? (perDay ? "above" : "more than") : perDay ? "below" : "less than"} ${against}` };
}

/** A zero summary shaped like the totals, for buckets that only have saved history. */
export function emptyLike(view: UsageBreakdownView): BreakdownSummary {
  const zero = { value: null, known: 0, unknown: 0, groups: [] };
  return {
    requests: 0,
    attempts: 0,
    tokens: Object.fromEntries(Object.keys(view.total.tokens).map((k) => [k, { ...zero, partial: 0, notApplicable: 0 }])),
    metrics: { energy: zero, carbon: zero, waterDirect: zero, waterUpstream: zero, water: zero },
    tools: {},
    models: [],
  } as unknown as BreakdownSummary;
}

type Part = "buckets" | "sites" | "models";
/**
 * Figures for one bucket, tool or model, live and saved history combined exactly like the totals.
 * Null when neither side has anything for the key.
 */
export function partFigures(view: UsageBreakdownView, part: Part, key: string, scenario: DisplayScenario): UsageFigures | null {
  const live = view[part][key] ?? null;
  const saved: HistorySummary | null = view.history ? (view.history[part][key] ?? null) : null;
  if (!live && !saved) return null;
  return usageFigures(live ?? emptyLike(view), saved, scenario);
}
export function totalFigures(view: UsageBreakdownView, scenario: DisplayScenario) {
  return usageFigures(view.total, view.history?.total, scenario);
}
/** Every key of a part across live and saved history. */
export function partKeys(view: UsageBreakdownView, part: Part) {
  return [...new Set([...Object.keys(view[part]), ...Object.keys(view.history?.[part] ?? {})])];
}
export function modelSite(view: UsageBreakdownView, model: string) {
  return view.modelSites?.[model] ?? view.history?.modelSites?.[model] ?? null;
}
/** People who used AI in the window, from the organization summary; null when the server leaves it out. */
export function peopleOf(summary: { active_users?: unknown } | null | undefined) {
  const n = Number(summary?.active_users);
  return summary?.active_users !== undefined && Number.isSafeInteger(n) && n > 0 ? n : null;
}
export function lastReplyAt(view: UsageBreakdownView, site: string) {
  const live = view.siteLastAt?.[site];
  const saved = view.history?.siteLastAt?.[site];
  const latest = [live, saved].filter((v): v is string => !!v).sort().at(-1);
  return latest ? Date.parse(latest) : null;
}
