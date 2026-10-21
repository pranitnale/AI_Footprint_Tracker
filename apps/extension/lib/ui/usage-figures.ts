import {
  scenarioValue,
  type DisplayScenario,
  type HistorySummary,
  type HistoryView,
} from "@footprint/contracts";
import { formatInteger, formatMetric } from "@footprint/ui/formatters";
import { combinedUsage, historyTokenRows } from "../history-presentation";
import { metricValue } from "../dashboard/metric-presentation";
import { scenarioUnavailable } from "../dashboard/resource-presentation";
import { INPUT_FIELDS } from "../token-summary";
import type { BreakdownSummary, LocalSummary, ServerSummary } from "../dashboard/types";

export type Figure = {
  /** The value for the chosen scenario, a decimal string in `unit`, or null when unknown. */
  value: string | null;
  unit: string;
  /** Minimum, midpoint and maximum totals when the figure is a range; null for exact values. */
  low: string | null;
  mid: string | null;
  high: string | null;
  /** Rows calculated in incompatible ways cannot add up to one total; Details explains them. */
  multiple: boolean;
  text: string;
};
export type UsageFigures = {
  requests: bigint | null;
  requestsText: string;
  tokensIn: bigint | null;
  tokensOut: bigint | null;
  energy: Figure;
  carbon: Figure;
  water: Figure;
  /** Live and saved requests could not all be matched, so the request count is approximate. */
  approximate: boolean;
};

type Summary = LocalSummary | ServerSummary | BreakdownSummary;

function figure(
  value: string | null,
  unit: string,
  low: string | null,
  high: string | null,
  ranged: boolean,
  multiple: boolean,
  scenario: DisplayScenario,
): Figure {
  const shown = multiple
    ? null
    : scenarioValue(
        { value, value_kind: ranged ? "midpoint_sum" : "scalar", scenario_low: low, scenario_high: high },
        scenario,
      );
  return {
    value: shown,
    unit,
    low: ranged ? low : null,
    mid: ranged ? value : null,
    high: ranged ? high : null,
    multiple,
    text: multiple ? "See Details" : formatMetric(shown, unit),
  };
}

// combinedUsage reads the local snapshot for a local summary and the server snapshot for a server
// summary (selectedHistory). The caller already chose the saved summary that belongs to `live`, so
// it fills both: with `server` null, organization summaries silently dropped every saved message.
const savedView = (saved: HistorySummary): HistoryView => ({
  local: saved,
  pending: null,
  server: saved,
  server_status: "personal",
  coverage: "partial_loaded_history",
});

function tokenTotal(summary: Summary, side: "input" | "output"): bigint | null {
  if (!("requests" in summary)) {
    const rows = summary.tokens?.filter((row) =>
      side === "input" ? (INPUT_FIELDS as readonly string[]).includes(row.quantity) : ["output_total", "other_model_output"].includes(row.quantity),
    );
    const known = rows?.filter((row) => row.value !== null) ?? [];
    return known.length ? known.reduce((n, row) => n + BigInt(row.value!), 0n) : null;
  }
  const keys = side === "input" ? (["newInput", "toolOutput", "imageInput"] as const) : (["output", "otherModels"] as const);
  const known = keys.map((key) => summary.tokens[key]?.value).filter((value): value is string => value != null);
  return known.length ? known.reduce((n, value) => n + BigInt(value), 0n) : null;
}

/** Live tokens plus the saved rows of the same side, as the bar adds them (A6, A7, D3). */
function addTokens(live: bigint | null, saved: HistorySummary, side: "input" | "output") {
  const rows = historyTokenRows(saved.tokens, side).filter((row) => row.value !== null);
  if (live === null && !rows.length) return null;
  return rows.reduce((n, row) => n + BigInt(row.value!), live ?? 0n);
}

/**
 * The figures every redesigned surface shows for one summary. Live totals and saved history combine
 * through combinedUsage, the same function behind the bar, so the popup, dashboard and bar agree.
 * Without available saved history the live figures stand alone, exactly as the earlier dashboard did.
 */
export function usageFigures(
  live: Summary | null,
  saved: HistorySummary | null | undefined,
  scenario: DisplayScenario,
): UsageFigures {
  if (!live)
    return {
      requests: null,
      requestsText: "Unknown",
      tokensIn: null,
      tokensOut: null,
      energy: figure(null, "kWh", null, null, false, false, scenario),
      carbon: figure(null, "gCO2e", null, null, false, false, scenario),
      water: figure(null, "L", null, null, false, false, scenario),
      approximate: false,
    };
  const combined = saved?.status === "available" ? combinedUsage(live, savedView(saved), scenario) : null;
  if (combined) {
    const part = (kind: "energy" | "carbon" | "water") => {
      const c = combined[kind];
      return figure(c.value, c.unit, c.scenario_low, c.scenario_high, c.scenario_low != null, c.multiple, scenario);
    };
    const liveRequests = "requests" in live ? BigInt(live.requests) : BigInt(live.request_count ?? "0");
    const requests = liveRequests + BigInt(saved!.prompt_count);
    return {
      requests,
      requestsText: combined.requests,
      tokensIn: addTokens(tokenTotal(live, "input"), saved!, "input"),
      tokensOut: addTokens(tokenTotal(live, "output"), saved!, "output"),
      energy: part("energy"),
      carbon: part("carbon"),
      water: part("water"),
      approximate: combined.matchingIncomplete,
    };
  }
  const part = (kind: "energy" | "carbon" | "water") => {
    const m = metricValue(live, kind);
    const ranged = m.provenance.value_kind === "midpoint_sum" || m.provenance.value_kind === "midpoint";
    // A group without scenario sums can only show its midpoint sum, so it is not a range here.
    const usable = ranged && !scenarioUnavailable(m.provenance, "minimum");
    return figure(
      m.value,
      m.unit || (kind === "energy" ? "kWh" : kind === "carbon" ? "gCO2e" : "L"),
      usable ? (m.provenance.scenario_low ?? null) : null,
      usable ? (m.provenance.scenario_high ?? null) : null,
      usable,
      m.multiple,
      scenario,
    );
  };
  const requests = metricValue(live, "requests").value;
  return {
    requests: requests === null ? null : BigInt(requests),
    requestsText: formatInteger(requests),
    tokensIn: tokenTotal(live, "input"),
    tokensOut: tokenTotal(live, "output"),
    energy: part("energy"),
    carbon: part("carbon"),
    water: part("water"),
    approximate: false,
  };
}
