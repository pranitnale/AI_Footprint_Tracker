import {
  ENVELOPE_SCHEMA_VERSION,
  payloadHash,
  historyNumericPayloadHash,
  type HistoryMessage,
  type AttemptObservation,
  type EstimationEnvelope,
  type ProductMetric,
  type RequestObservation,
} from "@footprint/contracts";
import type { EstimateResult, Metric } from "@footprint/estimator";
import { methodFamily, methodReleaseKeys } from "@footprint/ui/totals";

export type PresentedEstimate = EstimateResult | EstimationEnvelope;
export type EstimateMetricName = keyof EstimateResult["metrics"];
export type PresentedMetric = Metric | ProductMetric;

export function isEstimationEnvelope(
  estimate: PresentedEstimate,
): estimate is EstimationEnvelope {
  return estimate.schema_version === ENVELOPE_SCHEMA_VERSION;
}

export function estimateSourceAttemptId(
  estimate: PresentedEstimate,
): string | undefined {
  if (!isEstimationEnvelope(estimate)) return estimate.attempt_id;
  return estimate.source.family === "live"
    ? estimate.source.attempt_id
    : undefined;
}

export function estimateSourceRevision(
  estimate: PresentedEstimate,
): number | undefined {
  if (!isEstimationEnvelope(estimate)) return estimate.observation_revision;
  return estimate.source.family === "live"
    ? estimate.source.attempt_revision
    : undefined;
}

/**
 * The two record hashes an estimate is checked against. A summary scan passes its own
 * (scanHashes in summary-scan.ts), which computes each record's hash once instead of once
 * per total, day, tool, model and chat the record is added to.
 */
export type RecordHashes = {
  payload: (value: object) => string;
  history: (record: HistoryMessage) => string;
};
const directHashes: RecordHashes = {
  payload: payloadHash,
  history: historyNumericPayloadHash,
};
export function estimateMatchesSource(
  estimate: PresentedEstimate,
  attempt: AttemptObservation,
  parent: RequestObservation,
  history?: HistoryMessage,
  hashes: RecordHashes = directHashes,
): boolean {
  if (
    estimateSourceAttemptId(estimate) !== attempt.attempt_id ||
    estimateSourceRevision(estimate) !== attempt.revision
  )
    return false;
  if (!isEstimationEnvelope(estimate))
    return estimate.observation_hash === hashes.payload(attempt);
  const source = estimate.source;
  return (
    source.family === "live" &&
    source.attempt_hash === hashes.payload(attempt) &&
    source.request_id === parent.request_id &&
    source.request_revision === parent.revision &&
    source.request_hash === hashes.payload(parent) &&
    (source.history_binding === undefined ||
      (history !== undefined &&
        source.history_binding.message_key === history.message_key &&
        source.history_binding.observation_hash === hashes.history(history)))
  );
}

export function estimateView(estimate: PresentedEstimate) {
  return estimate.view;
}

export function estimateRequestedMethodId(estimate: PresentedEstimate) {
  return isEstimationEnvelope(estimate)
    ? estimate.requested_method.method_id
    : estimate.method_id;
}

export function estimateIsReferenceOnly(estimate: PresentedEstimate) {
  return isEstimationEnvelope(estimate) ? false : estimate.reference_only;
}

export function estimateMetric(
  estimate: PresentedEstimate,
  name: EstimateMetricName,
): PresentedMetric {
  return estimate.metrics[name];
}

export function metricLineage(
  estimate: PresentedEstimate,
  name: EstimateMetricName,
) {
  if (!isEstimationEnvelope(estimate)) {
    const metric = estimate.metrics[name];
    return {
      method_id: estimate.method_id,
      method_hash: estimate.method_hash,
      view: estimate.view,
      scope: metric.scope,
      unit: metric.unit,
      starting_energy_boundary: estimate.starting_energy_boundary,
      environment_scenario_id: estimate.environment_scenario_id,
      profile_selection: estimate.profile_selection,
      selected_profile_id: estimate.selected_profile_id,
      cohort_id: estimate.cohort_id,
      cohort_hash: estimate.cohort_hash,
      validation_state: estimate.validation_state,
    };
  }
  const metric = estimate.metrics[name];
  return {
    schema_version: estimate.schema_version,
    requested_method: estimate.requested_method,
    effective_method: estimate.effective_method,
    execution_origin: estimate.execution_origin,
    view: estimate.view,
    original_method_hash: estimate.original_method_hash,
    selection: estimate.selection,
    comparability: estimate.comparability,
    validation_state: estimate.validation_state,
    product_scope: estimate.effective_method.product_scope,
    scope: metric.scope,
    unit: metric.unit,
    phase: metric.phase,
    value_kind: metric.value_kind,
    scenario_low: metric.scenario_low,
    scenario_high: metric.scenario_high,
    interval_kind: metric.interval_kind,
  };
}

/**
 * How one counted reply's model was matched to an estimation record: the selection kind
 * (direct_mapping, model_override, provider_flagship and so on), why a stand-in was used and the
 * record as "provider/model". The figure groups leave these out on purpose (comparableLineage),
 * so the dashboard's model table reads them from this tally instead.
 */
export type ReplySelection = {
  kind: string;
  basis: string | null;
  record: string | null;
  replies: number;
};

export function estimateSelection(
  estimate: PresentedEstimate,
): Omit<ReplySelection, "replies"> {
  if (!isEstimationEnvelope(estimate))
    return {
      kind: estimate.profile_selection,
      basis: null,
      record: estimate.selected_profile_id,
    };
  const { kind, basis, profile } = estimate.selection;
  return {
    kind,
    basis,
    record: profile ? `${profile.provider}/${profile.model_name}` : null,
  };
}

/**
 * What makes two replies' figures addable: the same method, view, boundaries, units,
 * scope and phase. The model, its profile choice, where the calculation ran and the
 * tokenizer are details of each reply, so a chat with several models still has a total.
 * Ranged and scalar figures add endpoint by endpoint, so the range kind does not split.
 */
function comparableLineage(
  estimate: PresentedEstimate,
  name: EstimateMetricName,
) {
  const l = metricLineage(estimate, name);
  return "schema_version" in l
    ? {
        schema_version: l.schema_version,
        requested_method: l.requested_method,
        effective_method: l.effective_method,
        view: l.view,
        comparability: { ...l.comparability, tokenizer_profile_id: null },
        validation_state: l.validation_state,
        product_scope: l.product_scope,
        scope: l.scope,
        unit: l.unit,
        phase: l.phase,
      }
    : {
        method_id: l.method_id,
        method_hash: l.method_hash,
        view: l.view,
        scope: l.scope,
        unit: l.unit,
        starting_energy_boundary: l.starting_energy_boundary,
        environment_scenario_id: l.environment_scenario_id,
        cohort_id: l.cohort_id,
        cohort_hash: l.cohort_hash,
        validation_state: l.validation_state,
      };
}

/**
 * The group key of a reply's figure. Envelope methods enter it by their family (methodFamily, as
 * in the organization totals): every extension build that changes the model mappings, stand-ins
 * or media coefficients is a new method id, and a chat or period that spans an update must still
 * add up (CONTRACTS: comparable methods add, with a mixed-method indicator). The Original engine,
 * an implicit fallback to it and another EcoLogits core, catalog or environment policy keep their
 * own hash, so they stay apart as before.
 */
export function metricSignature(
  estimate: PresentedEstimate,
  name: EstimateMetricName,
) {
  const lineage = comparableLineage(estimate, name);
  return JSON.stringify(
    isEstimationEnvelope(estimate)
      ? {
          ...lineage,
          requested_method: methodFamily(estimate.requested_method),
          effective_method: methodFamily(estimate.effective_method),
        }
      : lineage,
  );
}

/** The method release of a reply's estimate, as methodReleaseKeys names it for the totals. */
export function estimateRelease(estimate: PresentedEstimate) {
  return methodReleaseKeys(
    isEstimationEnvelope(estimate)
      ? {
          value: null,
          requested_method: estimate.requested_method,
          effective_method: estimate.effective_method,
        }
      : { value: null, method_hash: estimate.method_hash },
  )[0]!;
}

/** A group's own lineage; envelope groups fill their range fields as members are added. */
export function aggregateMetricLineage(
  estimate: PresentedEstimate,
  name: EstimateMetricName,
) {
  const grouping = comparableLineage(estimate, name);
  return "schema_version" in grouping
    ? {
        ...grouping,
        value_kind: "scalar" as "scalar" | "midpoint_sum" | "unavailable",
        scenario_low: null as string | null,
        scenario_high: null as string | null,
        interval_kind: null,
      }
    : { ...grouping };
}

const ranged = (metric: PresentedMetric) =>
  "scenario_low" in metric &&
  metric.scenario_low != null &&
  metric.scenario_high != null;

/**
 * Adds members of one group. A group with any ranged member is a midpoint sum whose
 * scenario totals add the same endpoint of every member, a scalar counting as both.
 */
export function groupRange(
  metrics: readonly PresentedMetric[],
  sum: (values: string[]) => string,
): {
  value_kind: "scalar" | "midpoint_sum";
  scenario_low: string | null;
  scenario_high: string | null;
} {
  if (!metrics.some(ranged))
    return { value_kind: "scalar", scenario_low: null, scenario_high: null };
  const endpoint = (
    metric: PresentedMetric,
    side: "scenario_low" | "scenario_high",
  ) =>
    ranged(metric) && side in metric
      ? (metric as Record<typeof side, string>)[side]
      : metric.value!;
  return {
    value_kind: "midpoint_sum",
    scenario_low: sum(
      metrics.map((metric) => endpoint(metric, "scenario_low")),
    ),
    scenario_high: sum(
      metrics.map((metric) => endpoint(metric, "scenario_high")),
    ),
  };
}

export function aggregateMetricMetadata(
  group: Record<string, unknown> | undefined,
) {
  if (group?.schema_version !== ENVELOPE_SCHEMA_VERSION) return {};
  return {
    phase: "usage" as const,
    value_kind: group.value_kind as "scalar" | "midpoint_sum" | "unavailable",
    scenario_low: (group.scenario_low as string | null | undefined) ?? null,
    scenario_high: (group.scenario_high as string | null | undefined) ?? null,
    interval_kind: null,
  };
}
