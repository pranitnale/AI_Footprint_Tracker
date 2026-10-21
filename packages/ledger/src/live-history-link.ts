import {
  historyModelConflicts,
  type AttemptObservation,
  type HistoryMessage,
  type RequestObservation,
} from "@footprint/contracts";

/** Prefer the strongest captured evidence before using stable chronological tie breakers. */
export function compareLiveEvidence(
  a: AttemptObservation | RequestObservation,
  b: AttemptObservation | RequestObservation,
): number {
  if (a.kind === "attempt" && b.kind === "attempt") {
    const quality = (value: AttemptObservation) => [
      value.timing?.source === "browser_request" &&
      value.timing.completeness === "complete_for_scope"
        ? 1
        : 0,
      value.tokens.output_total.value !== null &&
      value.tokens.output_total.evidence === "provider_reported"
        ? 1
        : 0,
      value.tokens.answer_output.value !== null &&
      value.tokens.answer_output.completeness === "complete_for_scope"
        ? 1
        : 0,
      value.state === "completed" ? 1 : 0,
    ];
    const aq = quality(a),
      bq = quality(b);
    for (let index = 0; index < aq.length; index++)
      if (aq[index] !== bq[index]) return bq[index]! - aq[index]!;
  }
  return 0;
}

export interface LiveHistoryCandidate {
  request: RequestObservation;
  attempt?: AttemptObservation;
}

/** Provider identities are meaningful only inside the same conversation and site. */
export function uniqueLiveHistoryMatch<T extends LiveHistoryCandidate>(
  history: HistoryMessage,
  candidates: readonly T[],
): T | null {
  const matches = candidates.filter(
    ({ request, attempt }) =>
      request.site === history.site &&
      (request.conversation_key === history.conversation_key ||
        (history.site === "perplexity" &&
          !!history.provider_request_key &&
          request.provider_request_key === history.provider_request_key)) &&
      !request.coverage_reasons.includes("request_identity_ambiguous") &&
      (history.role === "prompt"
        ? !!history.provider_request_key &&
          request.provider_request_key === history.provider_request_key
        : !!history.provider_attempt_key &&
          attempt?.provider_attempt_key === history.provider_attempt_key &&
          !historyModelConflicts(history, attempt) &&
          !attempt.coverage_reasons.includes("request_identity_ambiguous")),
  );
  return matches.length === 1 ? matches[0]! : null;
}
