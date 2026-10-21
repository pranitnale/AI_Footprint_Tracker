import {
  claudeFactorFor,
  claudeMeasurement,
  type ComponentResult,
  type EstimationEnvelope,
  type EstimateReason,
  type Selection,
} from "@footprint/contracts";
import type * as Core from "@footprint/ecologits-core";
import { BASELINE_BUNDLE } from "../bundle";
import type { PreparedObservation } from "./inputs";
import type { MethodRegistry } from "./methods";
import {
  mediaComponents,
  sumComponentMetrics,
  textComponent,
  textSelection,
} from "./components";
import { unavailableMetric } from "./projection";

export type EcoLogitsRuntime = typeof Core;
export type EngineComputation = Pick<
  EstimationEnvelope,
  | "raw"
  | "metrics"
  | "reasons"
  | "missing_components"
  | "comparability"
  | "components"
>;

export function emptyEcoComputation(
  input: PreparedObservation,
  reasons: readonly EstimateReason[],
): EngineComputation {
  return {
    raw: null,
    components: [],
    // A reply with nothing estimated keeps the same reasons on every metric.
    metrics: {
      energy: unavailableMetric("kWh", input.scope, reasons),
      carbon: unavailableMetric("gCO2e", input.scope, reasons),
      water_direct: unavailableMetric("L", input.scope, reasons),
      water_upstream: unavailableMetric("L", input.scope, reasons),
      water_total: unavailableMetric("L", input.scope, reasons),
    },
    reasons: [...new Set(reasons)],
    missing_components: [
      ...BASELINE_BUNDLE.missing_components.filter(
        (component) => component !== "compatible_total_water_scope",
      ),
      ...(input.original.family === "history"
        ? ["provider_execution_unobserved"]
        : []),
    ],
    comparability: {
      energy_boundary: "facility",
      carbon_boundary: "lifecycle",
      carbon_accounting: "location",
      water_kind: "consumption",
      direct_water_source: "unknown",
      upstream_water_source: "all_source",
      common_water_scope: null,
      tokenizer_profile_id: input.output.profile_id,
    },
  };
}

/**
 * One result per generated component, then their sum. The reply's own text uses the
 * selected model; other models' text, images, video and speech follow their own method.
 */
export function calculateEcoLogits(
  input: PreparedObservation,
  selection: Selection,
  methods: MethodRegistry,
  core: EcoLogitsRuntime,
  contextualReasons: readonly EstimateReason[],
): EngineComputation {
  const base = emptyEcoComputation(input, contextualReasons);
  if (input.executionReason !== null)
    return emptyEcoComputation(input, [
      ...contextualReasons,
      input.executionReason,
    ]);
  const components: ComponentResult[] = [];
  const others = input.textComponents.length > 0 || input.media.length > 0;
  // Claude text counted with the tracker's tokenizer is estimated from Claude's own count,
  // only under a method whose definition names the factor (owner decision of 15 Oct 2026).
  const factor = methods.media.claude_token_factor ?? null;
  // A reply that generated only media has no text to estimate; an unknown count still
  // appears so Details can say what is missing. Each component names its own stand-in, so
  // a media-only reply never reports the text model's proxy.
  if (!(others && input.output.value === "0"))
    components.push(
      textComponent(core, methods, {
        componentId: "text_0",
        role: "main",
        selection,
        output: claudeMeasurement(
          input.output,
          claudeFactorFor(input.site, input.modelId, factor),
        ),
        timing: input.timing,
        scope: input.scope,
        reasons: [
          ...contextualReasons,
          ...(selection.reason === "model_proxy"
            ? (["model_proxy"] as const)
            : []),
        ],
      }),
    );
  input.textComponents.forEach((component, index) => {
    const chosen = textSelection(methods, core, component.modelId, input.provider);
    components.push(
      textComponent(core, methods, {
        componentId: `text_${index + 1}`,
        role: component.role,
        selection: chosen.selection,
        output: claudeMeasurement(
          component.output,
          claudeFactorFor(input.site, component.modelId, factor),
        ),
        timing: component.timing,
        scope: input.scope,
        reasons: [
          ...contextualReasons,
          ...(chosen.selection.reason === "model_proxy"
            ? (["model_proxy"] as const)
            : []),
        ],
      }),
    );
  });
  const mediaReasons: EstimateReason[] = [
    "unvalidated_reference",
    "provider_environment_assumed",
    ...(input.original.family === "history" ? (["history_only"] as const) : []),
  ];
  components.push(
    ...mediaComponents(core, methods, input.site, input.media, mediaReasons),
  );
  const unavailable = components.some(
    (component) => component.status === "unavailable",
  );
  // A stand-in is reported only when a component it estimated counts in the total.
  const proxied = components.some(
    (component) =>
      component.status === "estimated" &&
      component.reasons.includes("model_proxy"),
  );
  const reasons = [
    ...new Set<EstimateReason>([
      ...contextualReasons,
      ...components.flatMap((component) => component.reasons),
      ...(unavailable && components.length > 1
        ? (["component_unavailable"] as const)
        : []),
    ]),
  ].filter((reason) => reason !== "model_proxy" || proxied);
  const main = components.find((component) => component.role === "main");
  return {
    ...base,
    components,
    raw:
      main?.raw === null || main === undefined
        ? null
        : { engine_id: "ecologits", result: main.raw },
    reasons,
    metrics: components.some((component) => component.status === "estimated")
      ? sumComponentMetrics(components, input.scope, reasons)
      : emptyEcoComputation(input, reasons).metrics,
  };
}
