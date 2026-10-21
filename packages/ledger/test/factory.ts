import {
  composeOutputTotal,
  emptyTokenFields,
  emptyGeneration,
  emptyAttemptMedia,
  emptyRequestMedia,
  type RequestObservation,
  type AttemptObservation,
  type TokenFields,
} from "@footprint/contracts";
export const scope = {
  namespace: "company:00000000-0000-4000-8000-000000000010",
  mode: "company" as const,
  era: "era-1",
};
/** 3.0.0 attempts carry the composite of their parts as the output total. */
export const withOutputTotal = (tokens: TokenFields): TokenFields => ({
  ...tokens,
  output_total: composeOutputTotal(tokens),
});
export function records(): [RequestObservation, AttemptObservation] {
  const request: RequestObservation = {
    schema_version: "3.0.0",
    kind: "request",
    request_id: crypto.randomUUID(),
    revision: 1,
    conversation_key: "a".repeat(64),
    key_version: "1",
    provider_request_key: null,
    site: "claude",
    adapter_version: "0.1.0",
    action: "send",
    dispatched_at: "2026-09-10T10:00:00.000Z",
    ended_at: null,
    state: "generating",
    model_id: null,
    model_evidence: "unknown",
    features: ["text"],
    observed_search_operations: null,
    documents: {
      upload_count: "0",
      types: [],
      processing: "none",
      extracted_text: [],
    },
    media: emptyRequestMedia(),
    coverage_reasons: ["context_unobserved"],
    policy_version: "1.0.0",
    company_dedup_key: null,
  };
  const attempt: AttemptObservation = {
    schema_version: "3.0.0",
    kind: "attempt",
    timing: null,
    attempt_id: crypto.randomUUID(),
    request_id: request.request_id,
    revision: 1,
    provider_attempt_key: null,
    key_version: "1",
    started_at: request.dispatched_at,
    ended_at: null,
    state: "generating",
    execution_evidence: "content_observed",
    model_id: null,
    model_evidence: "unknown",
    tokens: emptyTokenFields(),
    media: emptyAttemptMedia(),
    generation: emptyGeneration(),
    coverage_reasons: ["hidden_reasoning_unobserved"],
    tokenizer_profile_id: null,
    tokenizer_asset_hash: null,
    proposed_method_id: null,
    company_dedup_key: null,
  };
  attempt.tokens.answer_output = {
    value: "100",
    evidence: "heuristic_estimate",
    scope: "observed_text",
    completeness: "complete_for_scope",
    profile_id: "observed-text-v1",
    reason: "tokenizer_mapping_unverified",
  };
  attempt.tokens.output_total = composeOutputTotal(attempt.tokens);
  return [request, attempt];
}
