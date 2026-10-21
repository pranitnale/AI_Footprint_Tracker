/*
 * The figure rules the admin site shares with the extension. The bar, popup and dashboard combine
 * live totals and saved history, apply the chosen EcoLogits scenario and scale units through these
 * modules; reading them from one place keeps an administrator's figures equal to what each person's
 * extension shows. They are pure modules with no browser-extension APIs.
 */
import { scenarioValue, type DisplayScenario, type HistorySummary } from "@footprint/contracts";
import { formatMetric } from "@footprint/ui/formatters";
import { comparableGroups, comparableTotal, type TotalRow } from "@footprint/ui/totals";
import { usageFigures, type Figure, type UsageFigures } from "../../../extension/lib/ui/usage-figures";
import type { Resource } from "../../../extension/lib/ui/components";
import type { ServerSummary } from "../../../extension/lib/dashboard/types";
import type { Summary } from "../types";

export { usageFigures, type UsageFigures };
export {
  baseParts,
  baseText,
  baseValue,
  changeText,
  equivalentText,
  peopleOf,
  type Metric,
} from "../../../extension/lib/ui/figure-math";
export { modelName } from "../../../extension/lib/ui/model-names";
export {
  DASH_PERIOD_LABELS,
  dashAxis,
  dashWindow,
  dayText,
  decodePeriod,
  encodePeriod,
  type DashPeriod,
  type DashWindow,
} from "../../../extension/lib/ui/dash-periods";
export {
  RESOURCE_LABELS,
  SCENARIO_NAMES,
  SITE_LABELS,
  SITE_ORDER,
  type Resource,
} from "../../../extension/lib/ui/components";

/** An admin summary with the splits the server adds for administrators. */
export type AdminSummary = Summary & {
  /** With person analytics on, a person's summary counts from this instant (Analytics.person_floor). */
  person_analytics_since?: string;
  days?: Record<string, AdminSummary>;
  sites?: Record<string, AdminSummary>;
  models?: Record<string, AdminSummary & { site?: string }>;
};

export type AdminFigures = UsageFigures & {
  /**
   * Resources whose rows could not all be added (other EcoLogits data or boundaries): each shows
   * the largest set of rows that add, never a sum across sets, and the page says so.
   */
  partial: Resource[];
  /** How many method releases the shown energy total combines; over 1 after extension updates. */
  releases: number;
};

const QUANTITY: Record<Resource, string> = { energy: "energy", carbon: "carbon", water: "water_total" };

/** The rows usageFigures combines for one resource: live series once anything ran, and saved rows. */
function resourceRows(summary: AdminSummary, resource: Resource): TotalRow[] {
  const ran = (summary.request_count ?? "0") !== "0" || (summary.attempt_count ?? "0") !== "0";
  const live = ran ? (summary.resources ?? []) : [];
  const saved = summary.history?.status === "available" ? summary.history.resources : [];
  return [...live, ...saved].filter((row) => row.quantity === QUANTITY[resource]) as unknown as TotalRow[];
}

function largestSet(rows: TotalRow[], unit: string, scenario: DisplayScenario): Figure | null {
  const set = comparableGroups(rows)[0];
  if (!set || set.value === null) return null;
  const value = scenarioValue(set, scenario);
  const ranged = set.value_kind === "midpoint_sum";
  return {
    value,
    unit: set.unit ?? unit,
    low: ranged ? set.scenario_low : null,
    mid: ranged ? set.value : null,
    high: ranged ? set.scenario_high : null,
    multiple: true,
    text: formatMetric(value, set.unit ?? unit),
  };
}

/**
 * Figures for one admin summary (whole, a day, a tool or a model), live and saved history combined
 * exactly like the extension's organization view. Null for a missing or hidden summary.
 */
export function adminFigures(
  summary: AdminSummary | null | undefined,
  scenario: DisplayScenario,
): AdminFigures | null {
  if (!summary || summary.suppressed || summary.aggregate_status !== "current") return null;
  const figures: AdminFigures = {
    ...usageFigures(
      summary as unknown as ServerSummary,
      (summary.history as unknown as HistorySummary | undefined) ?? null,
      scenario,
    ),
    partial: [],
    releases: comparableTotal(resourceRows(summary, "energy")).methodReleases,
  };
  // The extension shows "See Details" here; the admin site has no Details, so a figure that
  // cannot be one total shows its largest comparable part, marked as partial.
  for (const resource of ["energy", "carbon", "water"] as const) {
    if (!figures[resource].multiple) continue;
    const shown = largestSet(resourceRows(summary, resource), figures[resource].unit, scenario);
    if (!shown) continue;
    figures[resource] = shown;
    figures.partial.push(resource);
  }
  return figures;
}

/** The server query for a period window: calendar dates with an exclusive end, or all time. */
export function periodQuery(window: { startDate?: string; endDate?: string }) {
  return window.startDate && window.endDate
    ? { period: "custom", start: window.startDate, end: window.endDate }
    : { period: "all" };
}
