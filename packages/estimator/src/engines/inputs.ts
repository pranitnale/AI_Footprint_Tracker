import {
  AttemptObservationSchema,
  RequestObservationSchema,
  HistoryMessageSchema,
  historyNumericPayloadHash,
  payloadHash,
  calculationInputHash,
  generationCovers,
  type AttemptObservation,
  type RequestObservation,
  type HistoryMessage,
  type EstimationEnvelope,
  type EstimateObservationSource,
  type EstimateReason,
  type EngineMethodIdentity,
  type MediaOutput,
  type Site,
  type TokenMeasurement,
  type TimingEvidence,
  CanonicalRequestBindingSchema,
  type CanonicalRequestBinding,
} from "@footprint/contracts";
import { observedProvider } from "./methods";
import { RETIRED_IMAGE_REFERENCE_HASH } from "../original";
import { deepFreeze } from "../bundle";
import {
  assertLinkedHistory,
  linkedReplyModel,
  selectOutputMeasurement,
  selectTimingEvidence,
} from "@footprint/contracts";

export type NumericObservationInput =
  | {
      family: "live";
      request: RequestObservation;
      attempt: AttemptObservation;
      canonicalRequestBinding?: CanonicalRequestBinding;
      history?: HistoryMessage;
    }
  | { family: "history"; record: HistoryMessage };
/** Generated text of another model than the reply's own, estimated as its own component. */
export interface PreparedTextComponent {
  readonly role: "side_calls" | "research" | "storyboard";
  readonly modelId: string | null;
  readonly output: TokenMeasurement;
  readonly timing: TimingEvidence | null;
}
export interface PreparedObservation {
  readonly original: NumericObservationInput;
  readonly source: EstimateObservationSource;
  readonly site: Site;
  readonly modelId: string | null;
  readonly provider: string | null;
  readonly output: TokenMeasurement;
  readonly timing: TimingEvidence | null;
  readonly scope: "modeled_text_component" | "historical_visible_response";
  readonly coverageReasons: readonly EstimateReason[];
  /** Nothing was generated, so no component applies (not_applicable). */
  readonly executionReason: EstimateReason | null;
  /** The main text component cannot be estimated (unknown or zero output). */
  readonly ineligibleReason: EstimateReason | null;
  readonly textComponents: readonly PreparedTextComponent[];
  readonly media: readonly MediaOutput[];
}

function textComponents(
  generation: HistoryMessage["generation"],
): PreparedTextComponent[] {
  return generation.text_components.map((component) => ({
    role: component.role,
    modelId: component.model_id,
    output: component.tokens,
    timing:
      component.timing?.completeness === "complete_for_scope"
        ? component.timing
        : null,
  }));
}

/** Validate and snapshot both dependencies before a resolver or executor can yield. */
export function prepareObservation(
  input: NumericObservationInput,
): PreparedObservation {
  if (input.family === "history") {
    const record = HistoryMessageSchema.parse(input.record);
    const executionReason: EstimateReason | null =
      record.role !== "response" ? "not_applicable" : null;
    return deepFreeze<PreparedObservation>({
      original: { family: "history", record },
      source: {
        family: "history",
        message_key: record.message_key,
        observation_hash: historyNumericPayloadHash(record),
      },
      site: record.site,
      modelId: record.model_id,
      provider: observedProvider(record.site),
      output: record.tokens,
      timing: selectTimingEvidence(null, record),
      scope: "historical_visible_response",
      coverageReasons: record.coverage_reasons,
      executionReason,
      ineligibleReason:
        executionReason ??
        (record.tokens.value === null || record.tokens.value === "0"
          ? "estimate_unavailable"
          : null),
      textComponents: textComponents(record.generation),
      media: record.generation.media,
    });
  }
  const request = RequestObservationSchema.parse(input.request);
  const attempt = AttemptObservationSchema.parse(input.attempt);
  const history =
    input.history === undefined
      ? undefined
      : HistoryMessageSchema.parse(input.history);
  if (history) assertLinkedHistory(request, attempt, history);
  const binding =
    input.canonicalRequestBinding === undefined
      ? undefined
      : CanonicalRequestBindingSchema.parse(input.canonicalRequestBinding);
  if (request.request_id !== attempt.request_id) {
    if (
      !binding ||
      binding.observed_request_id !== attempt.request_id ||
      binding.canonical_request_id !== request.request_id ||
      binding.relation_hash !==
        payloadHash({
          kind: "canonical_request_alias",
          observed_request_id: attempt.request_id,
          canonical_request_id: request.request_id,
        })
    ) {
      throw new Error("dependency_missing");
    }
  } else if (binding !== undefined) {
    throw new Error("dependency_missing");
  }
  const output = selectOutputMeasurement(attempt, history);
  // A saved reply can carry media or components the live stream never showed (late
  // images, research reports); the fuller of the two descriptions is used, never both.
  const generation =
    history && generationCovers(history.generation, attempt.generation)
      ? history.generation
      : attempt.generation;
  const executionReason: EstimateReason | null =
    attempt.execution_evidence === "none" && !history?.text_complete
      ? "not_applicable"
      : null;
  return deepFreeze<PreparedObservation>({
    original: {
      family: "live",
      request,
      attempt,
      ...(binding === undefined ? {} : { canonicalRequestBinding: binding }),
      ...(history === undefined ? {} : { history }),
    },
    source: {
      family: "live",
      request_id: request.request_id,
      request_revision: request.revision,
      request_hash: payloadHash(request),
      attempt_id: attempt.attempt_id,
      attempt_revision: attempt.revision,
      attempt_hash: payloadHash(attempt),
      ...(binding === undefined ? {} : { canonical_request_binding: binding }),
      ...(history === undefined
        ? {}
        : {
            history_binding: {
              message_key: history.message_key,
              observation_hash: historyNumericPayloadHash(history),
            },
          }),
    },
    site: request.site,
    modelId: linkedReplyModel(attempt, history),
    provider: observedProvider(request.site),
    output,
    timing: selectTimingEvidence(attempt, history),
    scope: "modeled_text_component",
    coverageReasons: [
      ...new Set([
        ...attempt.coverage_reasons,
        ...(history?.coverage_reasons ?? []),
      ]),
    ],
    executionReason,
    ineligibleReason:
      executionReason ??
      (output.value === null || output.value === "0"
        ? "estimate_unavailable"
        : null),
    textComponents: textComponents(generation),
    media: generation.media,
  });
}

export function estimationInputHash(
  input: PreparedObservation,
  requested: EngineMethodIdentity,
  effective: EngineMethodIdentity,
  selection: EstimationEnvelope["selection"],
): string {
  return calculationInputHash({
    source: input.source,
    requested_method: requested,
    effective_method: effective,
    selection,
    auxiliary_method_hashes: {
      image_reference: RETIRED_IMAGE_REFERENCE_HASH,
    },
  });
}
