import { comparableTotal, methodReleaseKeys } from "@footprint/ui/totals";
import type { ResourceProvenance } from "./resource-presentation";
import { addCounters } from "../ui-model";
import type { BreakdownSummary, LocalSummary, ServerSummary } from "./types";
export function metricValue(
  summary: LocalSummary | ServerSummary | BreakdownSummary | null,
  kind: "requests" | "energy" | "carbon" | "water",
): {
  value: string | null;
  unit: string;
  unknown: bigint | null;
  multiple: boolean;
  provenance: ResourceProvenance;
} {
  if (!summary)
    return {
      value: null,
      unit: "",
      unknown: null as bigint | null,
      multiple: false,
      provenance: {},
    };
  if ("requests" in summary) {
    if (kind === "requests")
      return {
        value: String(summary.requests),
        unit: "",
        unknown: 0n,
        multiple: false,
        provenance: {},
      };
    const metric = summary.metrics[kind];
    return {
      value: metric.value,
      unit: metric.unit ?? "",
      unknown: BigInt(metric.unknown),
      multiple: (metric.groups?.length ?? 0) > 1,
      provenance: metric.value_kind
        ? metric
        : metric.groups?.length === 1
          ? metric.groups[0]
          : {},
    };
  }
  if (kind === "requests")
    return {
      value: summary.request_count ?? null,
      unit: "",
      unknown: 0n,
      multiple: false,
      provenance: {},
    };
  const quantity = kind === "water" ? "water_total" : kind;
  const groups =
    summary.resources?.filter((item) => item.quantity === quantity) ?? [];
  // Company series are kept per model; series that were calculated alike add up (D4).
  const total = comparableTotal(groups);
  const known = groups.filter((group) => group.value !== null);
  return {
    value: total.value,
    unit: total.unit ?? (groups.length === 1 ? groups[0]!.unit : ""),
    unknown: addCounters(groups.map((group) => group.unknown_count)),
    multiple: total.multiple,
    provenance:
      known.length === 1
        ? known[0]!
        : total.value !== null
          ? {
              phase: "usage",
              value: total.value,
              value_kind: total.value_kind!,
              scenario_low: total.scenario_low,
              scenario_high: total.scenario_high,
              method_releases: [...new Set(known.flatMap(methodReleaseKeys))],
              // Validated series carry complete method identities in their lineage.
              ...((total.lineage ?? {}) as Pick<
                ResourceProvenance,
                "requested_method" | "effective_method" | "comparability"
              >),
            }
          : groups.length === 1
            ? groups[0]!
            : {},
  };
}

export function unknownLabel(value: bigint | null) {
  if (value === null) return "Unknown coverage count";
  return value > 0n
    ? `${value} attempt${value === 1n ? "" : "s"} unknown`
    : "Available components";
}
