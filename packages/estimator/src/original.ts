import {
  AttemptObservationSchema,
  canonicalJson,
  type ImageReferenceResultSchema,
  payloadHash,
  UNAVAILABLE_ADMISSION_METHOD_ID,
  TokenMeasurementSchema,
  type AttemptObservation,
  type TokenMeasurement,
} from "@footprint/contracts";
import {
  BASELINE_BUNDLE,
  BASELINE_METHOD_ID,
  BASELINE_METHOD_HASH,
  approveBundle,
  deepFreeze,
  type MethodBundle,
} from "./bundle";
import { D, fixed } from "./numeric";
import { textEnergy, testLinearEnergy } from "./methods/text";
import { environmentalAllocation } from "./methods/environment";
import { admitsMissingOriginalMethod } from "./lineage";
export {
  BASELINE_BUNDLE,
  BASELINE_METHOD_ID,
  BASELINE_METHOD_HASH,
  approveBundle,
  environmentalAllocation,
};
export type { MethodBundle, Scenario } from "./bundle";
export {
  installSignedMethodUpdate,
  verifySignedMethodUpdate,
  immutableMethodEnvelope,
} from "./updates";
export type { SignedMethodUpdate } from "./updates";
export type Metric = {
  value: string | null;
  unit: "kWh" | "gCO2e" | "gCO2" | "L";
  status: "partial_estimate" | "unavailable";
  scope: string;
  scenario_low: null;
  scenario_high: null;
  reasons: string[];
};
export type Selection =
  "matched_profile" | "highest_comparable" | "reference_only" | "unavailable";
export type EstimateResult = {
  schema_version: "1.0.0";
  attempt_id: string;
  observation_revision: number;
  observation_hash: string;
  method_id: string;
  method_hash: string;
  view: "original" | "recalculated";
  original_method_hash: string | null;
  observed_model_key: string | null;
  model_evidence: string;
  profile_selection: Selection;
  selected_profile_id: string | null;
  cohort_id: string;
  cohort_hash: string;
  eligible_candidate_count: number;
  eligibility_signature: string;
  environment_scenario_id: string;
  factor_provenance_status: string;
  starting_energy_boundary: "it";
  result_scope: "modeled_text_component";
  reference_only: boolean;
  validation_state: "unvalidated_reference";
  known_settings: Record<string, string>;
  assumed_settings: Record<string, string>;
  selection_reason: string;
  included_components: string[];
  missing_components: string[];
  reasons: string[];
  metrics: Record<
    "energy" | "carbon" | "water_direct" | "water_upstream" | "water_total",
    Metric
  >;
  /**
   * Empty in new estimates since the image benchmark data was removed on 20 October 2026;
   * results saved before then may still hold references.
   */
  image_references: ReturnType<typeof ImageReferenceResultSchema.parse>[];
  provenance: MethodBundle["provenance"];
  environment_provenance: MethodBundle["scenario"];
};
const methods = {
  "ecologits-output-v1": textEnergy,
  "test-linear-v1": testLinearEnergy,
} as const;
const bundles = new Map<string, Readonly<MethodBundle>>([
  [BASELINE_METHOD_ID, BASELINE_BUNDLE],
]);
export function registerMethodBundle(input: unknown): string {
  const b = approveBundle(input),
    old = bundles.get(b.method_id);
  if (b.method_id === UNAVAILABLE_ADMISSION_METHOD_ID)
    throw new Error("method_update_invalid");
  if (old && payloadHash(old) !== payloadHash(b))
    throw new Error("method_update_invalid");
  if (bundles.size >= 32 && !old) throw new Error("method_update_invalid");
  bundles.set(b.method_id, b);
  return payloadHash(b);
}
export type EstimateOptions = {
  methodId?: string;
  view?: "original" | "recalculated";
  originalMethodHash?: string;
  originalMethodMissing?: boolean;
};
function metric(
  value: ReturnType<typeof fixed>,
  unit: Metric["unit"],
  reasons: string[],
): Metric {
  return {
    value,
    unit,
    status: value === null ? "unavailable" : "partial_estimate",
    scope: "modeled_text_component",
    scenario_low: null,
    scenario_high: null,
    reasons: value === null ? [...reasons, "factor_unavailable"] : [...reasons],
  };
}
export function estimateAttempt(
  input: AttemptObservation,
  options: EstimateOptions = {},
  scopedBundle?: Readonly<MethodBundle>,
  linkedEvidence?: {
    output: TokenMeasurement;
    contentObserved: boolean;
    modelId?: AttemptObservation["model_id"];
  },
): Readonly<EstimateResult> {
  const a = AttemptObservationSchema.parse(input),
    methodId = options.methodId ?? a.proposed_method_id ?? BASELINE_METHOD_ID;
  if (methodId === UNAVAILABLE_ADMISSION_METHOD_ID)
    throw new Error("method_unsupported");
  const b = scopedBundle ? approveBundle(scopedBundle) : bundles.get(methodId);
  if (!b) throw new Error("method_unsupported");
  if (b.method_id !== methodId) throw new Error("method_update_invalid");
  const originalMethodMissing = admitsMissingOriginalMethod(
    "live",
    a.proposed_method_id,
    options,
  );
  if (
    options.view === "recalculated" &&
    !options.originalMethodHash &&
    !originalMethodMissing
  )
    throw new Error("method_update_invalid");
  // The engine envelope binds linked historical evidence separately; retain the immutable live source hash.
  const observedModel = linkedEvidence?.modelId ?? a.model_id;
  const output = linkedEvidence
    ? TokenMeasurementSchema.parse(linkedEvidence.output)
    : a.tokens.output_total.value !== null
      ? a.tokens.output_total
      : a.tokens.answer_output;
  const usable =
    (a.execution_evidence !== "none" ||
      linkedEvidence?.contentObserved === true) &&
    output.value !== null &&
    new D(output.value).gt(0);
  const cohortHash = payloadHash(b.profiles),
    signature = payloadHash({
      work_units: output.value,
      count_scope: output.scope,
      scenario_hash: payloadHash(b.scenario),
      cohort_hash: cohortHash,
      method_hash: payloadHash(b),
    });
  const candidates = usable
    ? b.profiles.map((p) => ({
        p,
        energy: methods[b.equation_id](output.value!, p, b),
      }))
    : [];
  candidates.sort(
    (a, c) =>
      c.energy.it!.cmp(a.energy.it!) ||
      (a.p.id < c.p.id ? -1 : a.p.id > c.p.id ? 1 : 0),
  );
  const winner = candidates[0];
  const allocation = winner
    ? environmentalAllocation(winner.energy.it!, "it", b.scenario)
    : null;
  const reasons = [
    ...new Set([
      ...a.coverage_reasons,
      "unvalidated_reference",
      "input_length_not_modelled",
      "hidden_reasoning_unobserved",
      ...(!winner ? ["estimate_unavailable"] : []),
      ...(originalMethodMissing ? ["original_method_missing"] : []),
    ]),
  ];
  const result: EstimateResult = {
    schema_version: "1.0.0",
    attempt_id: a.attempt_id,
    observation_revision: a.revision,
    observation_hash: payloadHash(a),
    method_id: methodId,
    method_hash: payloadHash(b),
    view: options.view ?? "original",
    original_method_hash: options.originalMethodHash ?? null,
    observed_model_key: observedModel,
    model_evidence: a.model_evidence,
    profile_selection: winner ? "highest_comparable" : "unavailable",
    selected_profile_id: winner?.p.id ?? null,
    cohort_id: b.method_id + "-text",
    cohort_hash: cohortHash,
    eligible_candidate_count: candidates.length,
    eligibility_signature: signature,
    environment_scenario_id: b.scenario.id,
    factor_provenance_status: "source_snapshot_original_year_unknown",
    starting_energy_boundary: "it",
    result_scope: "modeled_text_component",
    reference_only: false,
    validation_state: "unvalidated_reference",
    known_settings: {
      output_tokens: output.value ?? "unknown",
      output_scope: output.scope,
    },
    assumed_settings: {
      ...b.settings,
      duration_strategy: "regression_uncapped_reference",
    },
    selection_reason:
      observedModel === null ? "unknown_model" : "profile_absent",
    included_components: winner
      ? ["observed_output_surrogate", "allocated_host", "allocated_facility"]
      : [],
    missing_components: [...b.missing_components],
    reasons,
    metrics: {
      energy: metric(fixed(allocation?.facility ?? null), "kWh", reasons),
      carbon: metric(
        fixed(allocation?.carbon ?? null),
        b.scenario.carbon_gas === "CO2" ? "gCO2" : "gCO2e",
        reasons,
      ),
      water_direct: metric(fixed(allocation?.direct ?? null), "L", reasons),
      water_upstream: metric(fixed(allocation?.upstream ?? null), "L", reasons),
      water_total: metric(fixed(allocation?.total ?? null), "L", reasons),
    },
    image_references: [],
    provenance: b.provenance,
    environment_provenance: b.scenario,
  };
  return deepFreeze(result);
}
/**
 * The identity the removed image benchmark data had. Until 20 October 2026 the estimator
 * bundled 208 GPU energy figures from the ML.ENERGY Leaderboard as a reference shown apart
 * from the totals; the owner dropped them because their source repository has no licence.
 * Every estimate still names this hash in auxiliary_method_hashes because the calculation
 * input hash covers it: keeping it means saved and organization results keep their input
 * hashes and are not recalculated, and servers that predate the removal accept the binding.
 * Saved results may still hold references from before; no new ones are produced.
 */
export const RETIRED_IMAGE_REFERENCE_HASH =
  "6ffd40d42b09cd20fab2aa2be60a12d9428ec400ae11a43cf5de2ade4cdad76a";
// Cache only immutable numerical observations, never tokenizer text or provider payloads.
export class EstimateCache {
  private readonly values = new Map<string, Readonly<EstimateResult>>();
  constructor(readonly capacity = 256) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 4096)
      throw new Error("Invalid cache capacity");
  }
  estimate(a: AttemptObservation, options: EstimateOptions = {}) {
    const id = options.methodId ?? a.proposed_method_id ?? BASELINE_METHOD_ID,
      b = bundles.get(id);
    if (!b) throw new Error("method_unsupported");
    const key = payloadHash({
      observation: a,
      options: JSON.parse(JSON.stringify(options)),
      method_hash: payloadHash(b),
    });
    const old = this.values.get(key);
    if (old) {
      this.values.delete(key);
      this.values.set(key, old);
      return old;
    }
    const value = estimateAttempt(a, options);
    this.values.set(key, value);
    while (this.values.size > this.capacity)
      this.values.delete(this.values.keys().next().value!);
    return value;
  }
  get size() {
    return this.values.size;
  }
}
export {
  estimateHistoricalText,
  emptyHistorySummary,
  HistoryAccumulator,
} from "./history";
