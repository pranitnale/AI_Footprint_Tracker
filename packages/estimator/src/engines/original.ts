import {
  OriginalEstimateResultSchema,
  OriginalHistoricalResultSchema,
  type EstimationEnvelope,
  type EstimateReason,
} from "@footprint/contracts";
import { estimateAttempt, type Metric } from "../original";
import { estimateHistoricalText } from "../history";
import {
  BASELINE_BUNDLE,
  BASELINE_METHOD_ID,
  BASELINE_METHOD_HASH,
} from "../bundle";
import type { PreparedObservation } from "./inputs";
import { projectLegacyMetric, unavailableMetric } from "./projection";

export function calculateOriginal(
  input: PreparedObservation,
  options: {
    view: "original" | "recalculated";
    originalMethodHash: string | null;
    originalMethodMissing?: boolean;
  },
): Pick<
  EstimationEnvelope,
  | "raw"
  | "metrics"
  | "reasons"
  | "missing_components"
  | "comparability"
  | "components"
> {
  const comparability: EstimationEnvelope["comparability"] = {
    energy_boundary: "facility",
    carbon_boundary: BASELINE_BUNDLE.scenario.carbon_boundary,
    carbon_accounting: BASELINE_BUNDLE.scenario.carbon_accounting,
    water_kind: BASELINE_BUNDLE.scenario.water_kind,
    direct_water_source: BASELINE_BUNDLE.scenario.direct_water_source,
    upstream_water_source: BASELINE_BUNDLE.scenario.upstream_water_source,
    common_water_scope: BASELINE_BUNDLE.scenario.common_water_scope,
    tokenizer_profile_id: input.output.profile_id,
  };
  if (input.original.family === "live") {
    const result = OriginalEstimateResultSchema.parse(
      estimateAttempt(
        input.original.attempt,
        {
          methodId: BASELINE_METHOD_ID,
          view: options.view,
          ...(options.originalMethodHash === null
            ? {}
            : { originalMethodHash: options.originalMethodHash }),
          ...(options.originalMethodMissing === true
            ? { originalMethodMissing: true }
            : {}),
        },
        BASELINE_BUNDLE,
        input.original.history === undefined
          ? undefined
          : {
              output: input.output,
              contentObserved: input.original.history.text_complete,
              modelId:
                input.original.attempt.model_id ??
                input.original.history.model_id,
            },
      ),
    );
    const metrics = Object.fromEntries(
      Object.entries(result.metrics).map(([name, value]) => [
        name,
        projectLegacyMetric(value, input.scope),
      ]),
    ) as EstimationEnvelope["metrics"];
    return {
      raw: { engine_id: "original", result },
      components: [],
      metrics,
      reasons: result.reasons as EstimateReason[],
      missing_components: result.missing_components,
      comparability,
    };
  }
  // The child method is explicit; the saved historical observation is never rewritten.
  const result = OriginalHistoricalResultSchema.parse(
    estimateHistoricalText({
      ...input.original.record,
      proposed_method_id: BASELINE_METHOD_ID,
      proposed_method_hash: BASELINE_METHOD_HASH,
    }),
  );
  const reasons: EstimateReason[] = [
    "history_only",
    "unvalidated_reference",
    "input_length_not_modelled",
    "hidden_reasoning_unobserved",
  ];
  const metrics: EstimationEnvelope["metrics"] = {
    energy: unavailableMetric("kWh", input.scope, reasons),
    carbon: unavailableMetric("gCO2e", input.scope, reasons),
    water_direct: unavailableMetric("L", input.scope, reasons),
    water_upstream: unavailableMetric("L", input.scope, reasons),
    water_total: unavailableMetric("L", input.scope, reasons),
  };
  for (const value of result) {
    metrics[value.quantity] = projectLegacyMetric(
      {
        value: value.value,
        unit: value.unit as Metric["unit"],
        status: value.status,
        scope: value.scope,
        scenario_low: null,
        scenario_high: null,
        reasons: value.reasons,
      },
      input.scope,
    );
  }
  return {
    raw: { engine_id: "original", result },
    components: [],
    metrics,
    reasons,
    missing_components: [
      ...BASELINE_BUNDLE.missing_components,
      "provider_execution_unobserved",
    ],
    comparability,
  };
}
