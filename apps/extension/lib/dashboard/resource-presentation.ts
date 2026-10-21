import { formatMetric } from "@footprint/ui/formatters";
import {
  DEFAULT_DISPLAY_SCENARIO,
  scenarioValue,
  type DisplayScenario,
  type EngineMethodIdentity,
  type EstimationEnvelope,
} from "@footprint/contracts";

export const SCENARIO_LABELS: Record<DisplayScenario, string> = {
  minimum: "Minimum scenario",
  midpoint: "Midpoint scenario",
  maximum: "Maximum scenario",
};

/** Ranged groups from older snapshots have no scenario sums, so only the midpoint sum can be shown. */
export function scenarioUnavailable(
  metadata: ResourceProvenance,
  scenario: DisplayScenario,
) {
  return (
    scenario !== "midpoint" &&
    metadata.value_kind === "midpoint_sum" &&
    (metadata.scenario_low == null || metadata.scenario_high == null)
  );
}

export type ResourceProvenance = {
  value?: string | null;
  value_kind?: "scalar" | "midpoint" | "midpoint_sum" | "unavailable";
  scenario_low?: string | null;
  scenario_high?: string | null;
  interval_kind?: "upstream_approximation" | "scenario" | null;
  phase?: "usage";
  requested_method?: EngineMethodIdentity;
  effective_method?: EngineMethodIdentity;
  selection?: EstimationEnvelope["selection"];
  comparability?: EstimationEnvelope["comparability"];
  /** The method releases a summed figure adds (methodReleaseKeys); more than one is noted. */
  method_releases?: readonly string[];
};

/**
 * The Details note for a figure that adds estimates from several releases of one method family.
 * Null for one release, so a figure from a single build reads as before.
 */
export function methodReleaseNote(releases: number) {
  return releases > 1
    ? `Combines estimates from ${releases} extension releases of the same method (same EcoLogits version, model catalog and boundaries).`
    : null;
}

export function isVisibleResource(
  quantity: string,
  metadata: ResourceProvenance,
) {
  return !(
    metadata.effective_method?.engine_id === "ecologits" &&
    (quantity === "water_direct" || quantity === "water_upstream")
  );
}

export function resourceValue(
  value: string | null,
  unit: string,
  metadata: ResourceProvenance,
  scenario: DisplayScenario = DEFAULT_DISPLAY_SCENARIO,
) {
  if (value === null) return formatMetric(value, unit);
  const shown = scenarioValue(
    {
      value,
      value_kind: metadata.value_kind,
      scenario_low: metadata.scenario_low,
      scenario_high: metadata.scenario_high,
    },
    scenario,
  );
  const formatted = formatMetric(shown, unit);
  // A single ranged record names its endpoint. A group that cannot honor the chosen
  // scenario says so, because the midpoint sum is not the value the person asked for.
  if (metadata.value_kind === "midpoint") return `${formatted} (${scenario})`;
  if (scenarioUnavailable(metadata, scenario)) return `${formatted} (midpoint)`;
  return formatted;
}

export function resourceProvenance(
  metadata: ResourceProvenance,
  unit: string,
  scenario: DisplayScenario = DEFAULT_DISPLAY_SCENARIO,
) {
  const parts: string[] = [];
  if (metadata.phase === "usage") parts.push("Operational use only.");
  const shown = `Shown: ${SCENARIO_LABELS[scenario].toLowerCase()}.`;
  if (metadata.value_kind === "midpoint_sum") {
    if (metadata.scenario_low != null && metadata.scenario_high != null)
      parts.push(
        `Scenario totals: minimum ${formatMetric(metadata.scenario_low, unit)}, midpoint ${formatMetric(metadata.value ?? null, unit)}, maximum ${formatMetric(metadata.scenario_high, unit)}. Each total adds the same endpoint of every record's range. ${shown} This is not a confidence interval or a measured mean.`,
      );
    else
      parts.push(
        "Scenario totals are unavailable for this group, so the sum of midpoints is shown. Per-record ranges are retained separately.",
      );
  }
  if (
    metadata.value_kind === "midpoint" &&
    metadata.scenario_low != null &&
    metadata.scenario_high != null
  ) {
    parts.push(
      `${metadata.interval_kind === "upstream_approximation" ? "Upstream approximation" : "Scenario"} interval: ${formatMetric(metadata.scenario_low, unit)} to ${formatMetric(metadata.scenario_high, unit)}. ${shown} This is not a confidence interval or a measured mean.`,
    );
  }
  const requested = metadata.requested_method,
    effective = metadata.effective_method;
  if (requested && effective) {
    const label = (engine: EngineMethodIdentity) =>
      engine.engine_id === "ecologits" ? "EcoLogits" : "Original calculation";
    parts.push(
      `Requested: ${label(requested)}. Calculated with: ${label(effective)}.`,
    );
    if (requested.engine_id !== effective.engine_id)
      parts.push("Configured original-engine fallback.");
    // A group of several releases carries the identity of one of them, which would misname the rest.
    if ((metadata.method_releases?.length ?? 1) <= 1)
      parts.push(
        `Method ${effective.method_id}. Hash ${effective.method_hash}.`,
      );
    if (effective.source_version)
      parts.push(`Source version ${effective.source_version}.`);
  }
  const releases = methodReleaseNote(metadata.method_releases?.length ?? 1);
  if (releases) parts.push(releases);
  if (metadata.selection) {
    parts.push(
      `Profile choice: ${metadata.selection.kind.replaceAll("_", " ")}.`,
    );
    if (metadata.selection.profile)
      parts.push(
        `Profile ${metadata.selection.profile.provider}/${metadata.selection.profile.model_name}.`,
      );
    if (metadata.selection.reason)
      parts.push(`Reason: ${metadata.selection.reason.replaceAll("_", " ")}.`);
  }
  if (metadata.comparability) {
    const scope = metadata.comparability;
    parts.push(
      `Electricity boundary: ${scope.energy_boundary}. Carbon boundary: ${scope.carbon_boundary}; ${scope.carbon_accounting} accounting.`,
    );
    if (effective?.engine_id !== "ecologits")
      parts.push(
        `Water: ${scope.water_kind}. Direct source: ${scope.direct_water_source.replaceAll("_", " ")}. Electricity-supply source: ${scope.upstream_water_source.replaceAll("_", " ")}.`,
      );
  }
  return parts.join(" ");
}
