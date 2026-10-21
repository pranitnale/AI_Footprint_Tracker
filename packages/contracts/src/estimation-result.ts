import { z } from "zod";
import {
  EngineMethodIdentitySchema,
  EstimateObservationSourceSchema,
  UpstreamProfileReferenceSchema,
} from "./engine-policy";
import {
  CounterSchema,
  DecimalSchema,
  MethodIdentifierSchema,
  NonnegativeFiniteDecimalSchema,
  OpaqueKeySchema,
} from "./scalars";
import {
  OriginalScenarioSchema,
  OriginalSourceSchema,
} from "./original-method";
import { ReasonCodeSchema } from "./reasons";
import { canonicalJson, payloadHash } from "./canonical";

export const EstimateReasonSchema = z.union([
  ReasonCodeSchema,
  z.enum([
    "provider_unknown",
    "model_override",
    "provider_policy",
    "unknown_provider_policy",
    "model_provider_conflict",
    "unsupported_workload",
    "numeric_domain_unsupported",
    "model_proxy",
    "original_engine_fallback",
    "provider_environment_assumed",
    "source_error",
    "source_warning",
    "cancelled",
    "stale_estimation_result",
    "original_method_missing",
  ]),
]);
export type EstimateReason = z.infer<typeof EstimateReasonSchema>;
const reasons = z.array(EstimateReasonSchema).max(96);

function validEngineSelection(
  requested: string,
  effective: string,
  selection: string,
): boolean {
  if (selection === "original_fallback")
    return requested === "ecologits" && effective === "original";
  if (selection === "legacy_reference")
    return requested === "original" && effective === "original";
  if (
    ["direct_mapping", "model_override", "provider_flagship"].includes(
      selection,
    )
  )
    return requested === "ecologits" && effective === "ecologits";
  return selection === "unavailable" && requested === effective;
}

export const ImpactValueSchema = z.union([
  NonnegativeFiniteDecimalSchema,
  z
    .strictObject({
      min: NonnegativeFiniteDecimalSchema,
      max: NonnegativeFiniteDecimalSchema,
    })
    .refine(
      (range) => Number(range.min) <= Number(range.max),
      "Reversed impact interval",
    ),
]);
function metric<
  const T extends string,
  const N extends string,
  const U extends string,
>(type: T, name: N, unit: U) {
  return z.strictObject({
    type: z.literal(type),
    name: z.literal(name),
    unit: z.literal(unit),
    value: ImpactValueSchema,
  });
}
const energy = metric("energy", "Energy", "kWh");
const gwp = metric("GWP", "Global Warming Potential", "kgCO2eq");
const adpe = metric("ADPe", "Abiotic Depletion Potential (elements)", "kgSbeq");
const pe = metric("PE", "Primary Energy", "MJ");
const wcf = metric("WCF", "Water Consumption Footprint", "L");
const statusMessage = z.strictObject({
  code: z.string().regex(/^[a-z][a-z0-9_-]{0,127}$/),
  message: z.string().max(1024),
});

export const SerializedEcoLogitsOutputSchema = z
  .strictObject({
    energy: energy.nullable(),
    gwp: gwp.nullable(),
    adpe: adpe.nullable(),
    pe: pe.nullable(),
    wcf: wcf.nullable(),
    usage: z
      .strictObject({
        type: z.literal("usage"),
        name: z.literal("Usage"),
        energy,
        gwp,
        adpe,
        pe,
        wcf,
      })
      .nullable(),
    embodied: z
      .strictObject({
        type: z.literal("embodied"),
        name: z.literal("Embodied"),
        gwp,
        adpe,
        pe,
      })
      .nullable(),
    warnings: z.array(statusMessage).min(1).max(64).nullable(),
    errors: z.array(statusMessage).min(1).max(64).nullable(),
  })
  .superRefine((value, context) => {
    const fields = [
      value.energy,
      value.gwp,
      value.adpe,
      value.pe,
      value.wcf,
      value.usage,
      value.embodied,
    ];
    if (
      value.errors === null
        ? fields.some((field) => field === null)
        : fields.some((field) => field !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Inconsistent upstream outcome",
      });
    }
  });
export type SerializedEcoLogitsOutput = z.infer<
  typeof SerializedEcoLogitsOutputSchema
>;

const legacyMetric = z.strictObject({
  value: DecimalSchema.nullable(),
  unit: z.enum(["kWh", "gCO2e", "gCO2", "L"]),
  status: z.enum(["partial_estimate", "unavailable"]),
  scope: z.string(),
  scenario_low: z.null(),
  scenario_high: z.null(),
  reasons: z.array(z.string()),
});
export const ImageReferenceResultSchema = z.strictObject({
  profile_selection: z.enum(["reference_only", "unavailable"]),
  reference_only: z.literal(true),
  selected_profile_id: z.string().nullable(),
  cohort_id: z.string(),
  cohort_hash: OpaqueKeySchema,
  eligible_candidate_count: z.number().int().nonnegative(),
  result_scope: z.literal("gpu_associated_reference"),
  starting_energy_boundary: z.literal("gpu"),
  gpu_kwh: DecimalSchema.nullable(),
  generated_image_count: CounterSchema.nullable(),
  known_settings: z.strictObject({
    width: z.number().nullable().optional(),
    height: z.number().nullable().optional(),
    steps: z.number().nullable().optional(),
    precision: z.string().optional(),
    kind: z.string().optional(),
  }),
  reasons: z.array(z.string()),
});

export const OriginalEstimateResultSchema = z.strictObject({
  schema_version: z.literal("1.0.0"),
  attempt_id: z.uuid(),
  observation_revision: z.number().int().min(1),
  observation_hash: OpaqueKeySchema,
  method_id: MethodIdentifierSchema,
  method_hash: OpaqueKeySchema,
  view: z.enum(["original", "recalculated"]),
  original_method_hash: OpaqueKeySchema.nullable(),
  observed_model_key: z.string().nullable(),
  model_evidence: z.string(),
  profile_selection: z.enum([
    "matched_profile",
    "highest_comparable",
    "reference_only",
    "unavailable",
  ]),
  selected_profile_id: z.string().nullable(),
  cohort_id: z.string(),
  cohort_hash: OpaqueKeySchema,
  eligible_candidate_count: z.number().int().nonnegative(),
  eligibility_signature: OpaqueKeySchema,
  environment_scenario_id: z.string(),
  factor_provenance_status: z.string(),
  starting_energy_boundary: z.literal("it"),
  result_scope: z.literal("modeled_text_component"),
  reference_only: z.boolean(),
  validation_state: z.literal("unvalidated_reference"),
  known_settings: z.record(z.string(), z.string()),
  assumed_settings: z.record(z.string(), z.string()),
  selection_reason: z.string(),
  included_components: z.array(z.string()),
  missing_components: z.array(z.string()),
  reasons: z.array(z.string()),
  metrics: z.strictObject({
    energy: legacyMetric,
    carbon: legacyMetric,
    water_direct: legacyMetric,
    water_upstream: legacyMetric,
    water_total: legacyMetric,
  }),
  image_references: z.array(ImageReferenceResultSchema),
  provenance: OriginalSourceSchema,
  environment_provenance: OriginalScenarioSchema,
});
const legacyHistoryMetric = z.strictObject({
  quantity: z.enum([
    "energy",
    "carbon",
    "water_direct",
    "water_upstream",
    "water_total",
  ]),
  value: DecimalSchema.nullable(),
  unit: z.string(),
  scope: z.literal("historical_visible_response"),
  method_id: MethodIdentifierSchema,
  method_hash: OpaqueKeySchema,
  status: z.enum(["partial_estimate", "unavailable"]),
  validation_state: z.literal("unvalidated_reference"),
  profile_selection: z.enum(["highest_comparable", "unavailable"]),
  selected_profile_id: z.string().nullable(),
  reasons: z.array(z.string()),
  missing_components: z.array(z.string()),
  known_message_count: CounterSchema,
  unknown_message_count: CounterSchema,
});
export const OriginalHistoricalResultSchema = z
  .array(legacyHistoryMetric)
  .max(5)
  .refine(
    (values) =>
      (values.length === 0 || values.length === 5) &&
      new Set(values.map((metric) => metric.quantity)).size === values.length,
    "Incomplete historical result",
  );

export const ProductMetricSchema = z
  .strictObject({
    value: NonnegativeFiniteDecimalSchema.nullable(),
    unit: z.enum(["kWh", "gCO2e", "gCO2", "L"]),
    status: z.enum(["partial_estimate", "unavailable"]),
    scope: z.enum([
      "modeled_text_component",
      "historical_visible_response",
      "modeled_video_component",
      "modeled_image_component",
      "modeled_speech_component",
    ]),
    phase: z.literal("usage"),
    scenario_low: NonnegativeFiniteDecimalSchema.nullable(),
    scenario_high: NonnegativeFiniteDecimalSchema.nullable(),
    interval_kind: z.enum(["upstream_approximation", "scenario"]).nullable(),
    value_kind: z.enum(["scalar", "midpoint", "unavailable"]),
    reasons,
  })
  .superRefine((value, context) => {
    const absent = value.value === null;
    const interval =
      value.scenario_low !== null && value.scenario_high !== null;
    if (
      absent !== (value.status === "unavailable") ||
      absent !== (value.value_kind === "unavailable")
    ) {
      context.addIssue({
        code: "custom",
        message: "Metric availability contradicts value",
      });
    }
    if (
      interval !== (value.value_kind === "midpoint") ||
      interval !== (value.interval_kind !== null) ||
      (value.scenario_low === null) !== (value.scenario_high === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Incomplete interval metadata",
      });
    }
    if (
      interval &&
      (Number(value.scenario_low) > Number(value.value) ||
        Number(value.value) > Number(value.scenario_high))
    ) {
      context.addIssue({
        code: "custom",
        message: "Display value outside interval",
      });
    }
  });
export type ProductMetric = z.infer<typeof ProductMetricSchema>;

/** Which endpoint of a retained range compact displays show. Stored results keep every endpoint. */
export const DisplayScenarioSchema = z.enum(["minimum", "midpoint", "maximum"]);
export type DisplayScenario = z.infer<typeof DisplayScenarioSchema>;
/** Midpoint since 12 October 2026 (owner); Minimum before. A saved choice is kept. */
export const DEFAULT_DISPLAY_SCENARIO: DisplayScenario = "midpoint";

export type ScenarioMetric = {
  value: string | null;
  value_kind?: "scalar" | "midpoint" | "midpoint_sum" | "unavailable" | null;
  scenario_low?: string | null;
  scenario_high?: string | null;
};

/**
 * Selects the displayed value for a scenario. A ranged record exposes its own endpoints and a
 * `midpoint_sum` group exposes scenario sums, so minimum/maximum map to `scenario_low`/`scenario_high`.
 * Scalars, unavailable values and groups without endpoint sums (older snapshots) return `value`.
 */
export function scenarioValue(
  metric: ScenarioMetric,
  scenario: DisplayScenario,
): string | null {
  if (metric.value === null || scenario === "midpoint") return metric.value;
  if (metric.value_kind !== "midpoint" && metric.value_kind !== "midpoint_sum")
    return metric.value;
  if (metric.scenario_low == null || metric.scenario_high == null)
    return metric.value;
  return scenario === "minimum" ? metric.scenario_low : metric.scenario_high;
}

export const ProductMetricsSchema = z
  .strictObject({
    energy: ProductMetricSchema,
    carbon: ProductMetricSchema,
    water_direct: ProductMetricSchema,
    water_upstream: ProductMetricSchema,
    water_total: ProductMetricSchema,
  })
  .superRefine((metrics, context) => {
    if (
      metrics.energy.unit !== "kWh" ||
      !["gCO2e", "gCO2"].includes(metrics.carbon.unit) ||
      [metrics.water_direct, metrics.water_upstream, metrics.water_total].some(
        (metric) => metric.unit !== "L",
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Metric has incompatible units",
      });
    }
  });

export const ENVELOPE_SCHEMA_VERSION = "3.0.0" as const;
/** Why a model record was chosen; Details explains each basis in plain words. */
export const SELECTION_BASES = [
  "exact_record",
  "nearest_record",
  "family_benchmark",
  "model_not_named",
  "model_not_in_library",
  "model_family_stand_in",
  "model_variant_stand_in",
  "model_kind_stand_in",
] as const;
export const SelectionBasisSchema = z.enum(SELECTION_BASES);
export type SelectionBasis = z.infer<typeof SelectionBasisSchema>;
export const SelectionSchema = z.strictObject({
  kind: z.enum([
    "legacy_reference",
    "direct_mapping",
    "model_override",
    "provider_flagship",
    "original_fallback",
    "unavailable",
  ]),
  observed_model_id: MethodIdentifierSchema.nullable(),
  profile: UpstreamProfileReferenceSchema.nullable(),
  reason: EstimateReasonSchema.nullable(),
  basis: SelectionBasisSchema.nullable(),
});
export type Selection = z.infer<typeof SelectionSchema>;
const optionalSeconds = NonnegativeFiniteDecimalSchema.nullable();
/** Inputs that produced one component, kept so Details can show how it was estimated. */
export const ComponentInputsSchema = z.strictObject({
  output_tokens: CounterSchema.nullable(),
  latency_seconds: optionalSeconds,
  latency_basis: z
    .enum(["measured", "history", "research_task", "modeled"])
    .nullable(),
  environment_provider: z
    .string()
    .regex(/^[a-z][a-z0-9_-]{0,63}$/)
    .nullable(),
  electricity_mix_zone: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  units: CounterSchema.nullable(),
  width: z.number().int().min(1).max(65536).nullable(),
  height: z.number().int().min(1).max(65536).nullable(),
  duration_seconds: optionalSeconds,
  with_audio: z.boolean().nullable(),
  audio_seconds: optionalSeconds,
  defaults_applied: z
    .array(z.enum(["resolution", "duration", "audio", "length", "model"]))
    .max(5),
});
export type ComponentInputs = z.infer<typeof ComponentInputsSchema>;
export const ComponentResultSchema = z
  .strictObject({
    component_id: z.string().regex(/^[a-z][a-z_]{0,31}_[0-9]{1,3}$/),
    kind: z.enum(["text", "image", "video", "speech"]),
    role: z.enum([
      "main",
      "side_calls",
      "research",
      "storyboard",
      "generated_image",
      "generated_video",
      "generated_speech",
      "overview_illustrations",
      "overview_narration",
    ]),
    method_id: MethodIdentifierSchema,
    selection: SelectionSchema.nullable(),
    inputs: ComponentInputsSchema,
    raw: SerializedEcoLogitsOutputSchema.nullable(),
    status: z.enum(["estimated", "unavailable"]),
    metrics: ProductMetricsSchema,
    reasons,
  })
  .superRefine((component, context) => {
    const available = Object.values(component.metrics).some(
      (metric) => metric.value !== null,
    );
    if (available !== (component.status === "estimated"))
      context.addIssue({
        code: "custom",
        message: "Component status contradicts its metrics",
      });
    if (
      component.selection !== null &&
      ["direct_mapping", "model_override", "provider_flagship"].includes(
        component.selection.kind,
      ) !==
        (component.selection.profile !== null)
    )
      context.addIssue({
        code: "custom",
        message: "Component selection profile mismatch",
      });
    if (component.raw?.errors && component.status === "estimated")
      context.addIssue({
        code: "custom",
        message: "Component estimate carries upstream errors",
      });
  });
export type ComponentResult = z.infer<typeof ComponentResultSchema>;
export const EstimationEnvelopeSchema = z
  .strictObject({
    schema_version: z.literal(ENVELOPE_SCHEMA_VERSION),
    source: EstimateObservationSourceSchema,
    input_hash: OpaqueKeySchema,
    auxiliary_method_hashes: z.strictObject({
      image_reference: OpaqueKeySchema,
    }),
    requested_method: EngineMethodIdentitySchema,
    effective_method: EngineMethodIdentitySchema,
    execution_origin: z.enum(["local", "organization"]),
    view: z.enum(["original", "recalculated"]),
    original_method_hash: OpaqueKeySchema.nullable(),
    selection: SelectionSchema,
    components: z.array(ComponentResultSchema).max(96),
    raw: z
      .discriminatedUnion("engine_id", [
        z.strictObject({
          engine_id: z.literal("original"),
          result: z.union([
            OriginalEstimateResultSchema,
            OriginalHistoricalResultSchema,
          ]),
        }),
        z.strictObject({
          engine_id: z.literal("ecologits"),
          result: SerializedEcoLogitsOutputSchema,
        }),
      ])
      .nullable(),
    status: z.enum(["estimated", "unavailable"]),
    metrics: ProductMetricsSchema,
    image_references: z.array(ImageReferenceResultSchema).max(100),
    reasons,
    missing_components: z
      .array(z.string().regex(/^[a-z][a-z0-9_]{0,127}$/))
      .max(64),
    validation_state: z.literal("unvalidated_reference"),
    comparability: z.strictObject({
      energy_boundary: z.literal("facility"),
      carbon_boundary: z.enum(["generation", "lifecycle", "unknown"]),
      carbon_accounting: z.enum(["location", "market"]),
      water_kind: z.literal("consumption"),
      direct_water_source: z.enum(["freshwater", "all_source", "unknown"]),
      upstream_water_source: z.enum(["freshwater", "all_source", "unknown"]),
      common_water_scope: z
        .enum(["freshwater_consumption", "all_source_consumption"])
        .nullable(),
      tokenizer_profile_id: MethodIdentifierSchema.nullable(),
    }),
  })
  .superRefine((result, context) => {
    if (
      result.requested_method.engine_id === result.effective_method.engine_id &&
      payloadHash(result.requested_method) !==
        payloadHash(result.effective_method)
    ) {
      context.addIssue({
        code: "custom",
        message: "The same engine must retain its complete method identity",
      });
    }
    if (result.input_hash !== calculationInputHash(result)) {
      context.addIssue({
        code: "custom",
        message: "Calculation input hash mismatch",
      });
    }
    if (
      result.image_references.some(
        (reference) =>
          reference.cohort_hash !==
          result.auxiliary_method_hashes.image_reference,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Independent image method mismatch",
      });
    }
    if (
      !validEngineSelection(
        result.requested_method.engine_id,
        result.effective_method.engine_id,
        result.selection.kind,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Selection misattributes its engine",
      });
    }
    if (
      ["direct_mapping", "model_override", "provider_flagship"].includes(
        result.selection.kind,
      ) !==
      (result.selection.profile !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Selection profile mismatch",
      });
    }
    if (
      result.raw !== null &&
      result.raw.engine_id !== result.effective_method.engine_id
    ) {
      context.addIssue({
        code: "custom",
        message: "Raw output engine mismatch",
      });
    }
    const missingOriginal = result.reasons.includes("original_method_missing");
    if (
      missingOriginal &&
      (result.view !== "recalculated" ||
        result.source.family !== "live" ||
        result.original_method_hash !== null)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Missing original lineage is only valid for an explicitly unrecorded live calculation",
      });
    }
    if (
      result.view === "recalculated" &&
      result.original_method_hash === null &&
      !missingOriginal
    ) {
      context.addIssue({
        code: "custom",
        message: "Recalculation requires original lineage",
      });
    }
    if (
      result.status === "unavailable" &&
      Object.values(result.metrics).some((metric) => metric.value !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Unavailable result has a successful metric",
      });
    }
    // An image-only result has no upstream raw output; its components carry the evidence.
    const componentEvidence = result.components.some(
      (component) => component.status === "estimated",
    );
    if (
      result.status === "estimated" &&
      ((result.raw === null && !componentEvidence) ||
        Object.values(result.metrics).every(
          (metric) => metric.value === null,
        ) ||
        (result.raw?.engine_id === "ecologits" &&
          result.raw.result.errors !== null &&
          !componentEvidence))
    ) {
      context.addIssue({
        code: "custom",
        message: "Estimated result lacks numerical evidence",
      });
    }
    if (
      (componentEvidence ||
        result.effective_method.engine_id === "ecologits") &&
      !metricsMatchComponents(result.metrics, result.components)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Top-level metrics must equal the sum of the estimated components",
      });
    }
    if (
      result.effective_method.engine_id === "original" &&
      result.components.length > 0
    ) {
      context.addIssue({
        code: "custom",
        message: "The original method has no components",
      });
    }
    if (
      new Set(result.components.map((component) => component.component_id))
        .size !== result.components.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Duplicate component identity",
      });
    }
    // The top-level raw output is a copy of the main text's, so a stored result cannot
    // show one upstream output while its figures come from another.
    const mains = result.components.filter(
      (component) => component.role === "main",
    );
    if (
      result.effective_method.engine_id === "ecologits" &&
      (mains.length > 1 ||
        canonicalJson(result.raw) !==
          canonicalJson(
            mains[0]?.raw
              ? { engine_id: "ecologits", result: mains[0].raw }
              : null,
          ))
    ) {
      context.addIssue({
        code: "custom",
        message: "Raw output must be the main component's raw output",
      });
    }
    if (
      result.requested_method.engine_id !== result.effective_method.engine_id &&
      !(
        result.requested_method.engine_id === "ecologits" &&
        result.effective_method.engine_id === "original" &&
        result.selection.kind === "original_fallback"
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Unsupported engine substitution",
      });
    }
    if (result.raw?.engine_id === "original") {
      const original = result.raw.result;
      if (Array.isArray(original)) {
        if (
          result.source.family !== "history" ||
          original.some(
            (metric) =>
              metric.method_hash !== result.effective_method.method_hash ||
              metric.method_id !== result.effective_method.method_id,
          ) ||
          (original.length === 0 && result.status === "estimated")
        ) {
          context.addIssue({
            code: "custom",
            message: "Original historical result binding mismatch",
          });
        }
      } else if (
        result.source.family !== "live" ||
        original.observation_hash !== result.source.attempt_hash ||
        original.observation_revision !== result.source.attempt_revision ||
        original.attempt_id !== result.source.attempt_id ||
        original.method_hash !== result.effective_method.method_hash ||
        original.method_id !== result.effective_method.method_id ||
        original.observed_model_key !== result.selection.observed_model_id
      ) {
        context.addIssue({
          code: "custom",
          message: "Original live result binding mismatch",
        });
      }
    }
  });
export type EstimationEnvelope = z.infer<typeof EstimationEnvelopeSchema>;

// Component sums are computed in binary floating point in both runtimes, so equality is
// checked to a relative tolerance far below any displayed precision.
function closeTo(actual: string | null, expected: number): boolean {
  if (actual === null) return false;
  const value = Number(actual);
  return (
    Math.abs(value - expected) <=
    1e-9 * Math.max(Math.abs(value), Math.abs(expected))
  );
}

/**
 * Top-level metrics are the sum of the estimated components: ranges add endpoint by
 * endpoint and a scalar counts as both endpoints. A metric no component estimates stays
 * unavailable at the top as well.
 */
function metricsMatchComponents(
  metrics: z.infer<typeof ProductMetricsSchema>,
  components: readonly ComponentResult[],
): boolean {
  const estimated = components.filter(
    (component) => component.status === "estimated",
  );
  return (Object.keys(metrics) as (keyof typeof metrics)[]).every((name) => {
    const parts = estimated
      .map((component) => component.metrics[name])
      .filter((metric) => metric.value !== null);
    const top = metrics[name];
    if (!parts.length) return top.value === null;
    // A total may show point estimates as a range of zero width, so a ranged total adds
    // every part endpoint by endpoint; a scalar total needs scalar parts.
    if (top.value_kind === "scalar")
      return (
        !parts.some((metric) => metric.value_kind === "midpoint") &&
        closeTo(
          top.value,
          parts.reduce((sum, metric) => sum + Number(metric.value), 0),
        )
      );
    const low = parts.reduce(
      (sum, metric) => sum + Number(metric.scenario_low ?? metric.value),
      0,
    );
    const high = parts.reduce(
      (sum, metric) => sum + Number(metric.scenario_high ?? metric.value),
      0,
    );
    return (
      top.value_kind === "midpoint" &&
      closeTo(top.scenario_low, low) &&
      closeTo(top.scenario_high, high) &&
      closeTo(top.value, (low + high) / 2)
    );
  });
}

/** Hashes numerical dependencies and method choices, never display state or execution location. */
export function calculationInputHash(
  value: Pick<
    EstimationEnvelope,
    | "source"
    | "requested_method"
    | "effective_method"
    | "selection"
    | "auxiliary_method_hashes"
  >,
): string {
  return payloadHash({
    schema_version: ENVELOPE_SCHEMA_VERSION,
    source: value.source,
    requested_method_hash: value.requested_method.method_hash,
    effective_method_hash: value.effective_method.method_hash,
    selection: value.selection,
    auxiliary_method_hashes: value.auxiliary_method_hashes,
  });
}

export const HistoricalResourceV2Schema = z
  .strictObject({
    ...legacyHistoryMetric.shape,
    value: NonnegativeFiniteDecimalSchema.nullable(),
    unit: z.enum(["kWh", "gCO2e", "gCO2", "L"]),
    phase: z.literal("usage"),
    scenario_low: NonnegativeFiniteDecimalSchema.nullable(),
    scenario_high: NonnegativeFiniteDecimalSchema.nullable(),
    interval_kind: z.enum(["upstream_approximation", "scenario"]).nullable(),
    value_kind: z.enum(["scalar", "midpoint", "midpoint_sum", "unavailable"]),
    profile_selection: z.enum([
      "legacy_reference",
      "direct_mapping",
      "model_override",
      "provider_flagship",
      "original_fallback",
      "unavailable",
    ]),
    selected_profile_id: z
      .string()
      .max(320)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:/@+\-]*$/)
      .nullable(),
    reasons,
    requested_method: EngineMethodIdentitySchema,
    effective_method: EngineMethodIdentitySchema,
    comparability: EstimationEnvelopeSchema.shape.comparability,
  })
  .superRefine((resource, context) => {
    const fail = (message: string) =>
      context.addIssue({ code: "custom", message });
    if (
      resource.requested_method.engine_id ===
        resource.effective_method.engine_id &&
      payloadHash(resource.requested_method) !==
        payloadHash(resource.effective_method)
    )
      fail(
        "The same historical engine must retain its complete method identity",
      );
    if (
      !validEngineSelection(
        resource.requested_method.engine_id,
        resource.effective_method.engine_id,
        resource.profile_selection,
      )
    )
      fail("Historical selection misattributes its engine");
    if (
      resource.method_id !== resource.requested_method.method_id ||
      resource.method_hash !== resource.requested_method.method_hash
    )
      fail("Historical method binding mismatch");
    if (
      (resource.value === null) !== (resource.status === "unavailable") ||
      (resource.value === null) !== (resource.value_kind === "unavailable")
    )
      fail("Historical availability mismatch");
    if (
      (resource.profile_selection === "unavailable" &&
        resource.selected_profile_id !== null) ||
      (resource.value !== null && resource.selected_profile_id === null)
    )
      fail("Historical profile mismatch");
    const bounded =
      resource.scenario_low !== null && resource.scenario_high !== null;
    // A midpoint record carries its own interval. A midpoint_sum group carries scenario sums
    // (the same endpoint of every record added) or, in older snapshots, no endpoints at all.
    const ranged =
      resource.value_kind === "midpoint" ||
      resource.value_kind === "midpoint_sum";
    if (
      (resource.scenario_low === null) !== (resource.scenario_high === null) ||
      (resource.value_kind === "midpoint" &&
        (!bounded || resource.interval_kind === null)) ||
      (resource.value_kind === "midpoint_sum" &&
        resource.interval_kind !== null) ||
      (!ranged && (bounded || resource.interval_kind !== null))
    )
      fail("Historical interval metadata mismatch");
    if (
      bounded &&
      (Number(resource.scenario_low) > Number(resource.value) ||
        Number(resource.value) > Number(resource.scenario_high))
    )
      fail("Historical value outside interval");
    if (
      resource.quantity === "energy"
        ? resource.unit !== "kWh"
        : resource.quantity === "carbon"
          ? !["gCO2e", "gCO2"].includes(resource.unit)
          : resource.unit !== "L"
    )
      fail("Historical quantity unit mismatch");
    if (
      resource.requested_method.engine_id !==
        resource.effective_method.engine_id &&
      !(
        resource.requested_method.engine_id === "ecologits" &&
        resource.effective_method.engine_id === "original" &&
        resource.profile_selection === "original_fallback"
      )
    )
      fail("Historical engine substitution mismatch");
  });
export type HistoricalResourceV2 = z.infer<typeof HistoricalResourceV2Schema>;
