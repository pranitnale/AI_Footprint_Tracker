import {
  AttemptObservationSchema,
  CounterSchema,
  EcoLogitsFallbackPolicySchema,
  HistoryMessageSchema,
  RequestObservationSchema,
  SiteSchema,
  TokenMeasurementSchema,
  composeOutputTotal,
  emptyAttemptMedia,
  emptyGeneration,
  historyResponseParts,
  emptyRequestMedia,
  emptyTokenFields,
  notApplicableMeasurement,
  payloadHash,
  type EcoLogitsFallbackPolicy,
  type Site,
  type TokenMeasurement,
} from "../../packages/contracts/src/index";
import {
  BASELINE_METHOD_HASH,
  BASELINE_METHOD_ID,
  BASELINE_BUNDLE,
  type NumericObservationInput,
} from "../../packages/estimator/src/index";

export interface ComparisonCase {
  id: string;
  family: "live" | "history";
  site: Site;
  model_id: string | null;
  language: "en" | "de" | "hi" | "zh" | "mixed" | "und";
  tokens: {
    input: string | null;
    answer: string | null;
    output_total: string | null;
    visible_thinking: string | null;
  };
  history_role: "prompt" | "response";
  execution: "content_observed" | "none" | null;
}
export interface ComparisonFixtures {
  format: "engine-comparison-fixtures-1";
  provenance: "synthetic_numeric_only";
  cases: ComparisonCase[];
  policy_variants: Array<{ id: string; policy: EcoLogitsFallbackPolicy }>;
  controlled_cases: ControlledCase[];
}
export interface ControlledCase {
  id: string;
  output_tokens: string;
  profile_id: string;
  environment: "baseline-reference" | "synthetic-unity";
}
function object(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("comparison_fixture_invalid");
  const result = value as Record<string, unknown>;
  if (
    Object.keys(result).some((key) => !allowed.includes(key)) ||
    required.some((key) => !Object.hasOwn(result, key))
  )
    throw new Error("comparison_fixture_invalid");
  return result;
}
const identifier = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(value))
    throw new Error("comparison_fixture_invalid");
  return value;
};
const count = (value: unknown): string | null =>
  value === null ? null : CounterSchema.parse(value);

/** Only declared synthetic numeric fields are accepted; no conversation text or persisted identities. */
export function parseComparisonFixtures(value: unknown): ComparisonFixtures {
  const root = object(
    value,
    ["format", "provenance", "cases", "policy_variants", "controlled_cases"],
    ["format", "provenance", "cases"],
  );
  if (
    root.format !== "engine-comparison-fixtures-1" ||
    root.provenance !== "synthetic_numeric_only" ||
    !Array.isArray(root.cases) ||
    root.cases.length < 1 ||
    root.cases.length > 128
  )
    throw new Error("comparison_fixture_invalid");
  const cases = root.cases.map((value, index): ComparisonCase => {
    const item = object(
      value,
      [
        "id",
        "family",
        "site",
        "model_id",
        "language",
        "tokens",
        "history_role",
        "execution",
      ],
      ["id", "family", "site", "model_id", "language", "tokens"],
    );
    if (item.family !== "live" && item.family !== "history")
      throw new Error("comparison_fixture_invalid");
    if (item.model_id !== null && typeof item.model_id !== "string")
      throw new Error("comparison_fixture_invalid");
    if (
      !["en", "de", "hi", "zh", "mixed", "und"].includes(
        item.language as string,
      )
    )
      throw new Error("comparison_fixture_invalid");
    const tokens = object(
      item.tokens,
      ["input", "answer", "output_total", "visible_thinking"],
      ["input", "answer", "output_total", "visible_thinking"],
    );
    const result: ComparisonCase = {
      id: identifier(item.id),
      family: item.family,
      site: SiteSchema.parse(item.site),
      model_id: item.model_id as string | null,
      language: item.language as ComparisonCase["language"],
      tokens: {
        input: count(tokens.input),
        answer: count(tokens.answer),
        output_total: count(tokens.output_total),
        visible_thinking: count(tokens.visible_thinking),
      },
      history_role:
        item.history_role === undefined
          ? "response"
          : (item.history_role as ComparisonCase["history_role"]),
      execution:
        item.family === "history"
          ? null
          : item.execution === undefined
            ? "content_observed"
            : (item.execution as ComparisonCase["execution"]),
    };
    if (
      !["prompt", "response"].includes(result.history_role) ||
      (result.family === "live" &&
        !["content_observed", "none"].includes(result.execution!))
    )
      throw new Error("comparison_fixture_invalid");
    if (
      result.family === "history" &&
      (item.execution !== undefined ||
        result.tokens.input !== null ||
        result.tokens.output_total !== null ||
        result.tokens.visible_thinking !== null)
    )
      throw new Error("comparison_fixture_invalid");
    buildObservation(result, index);
    return result;
  });
  if (new Set(cases.map((item) => item.id)).size !== cases.length)
    throw new Error("comparison_fixture_invalid");
  const variants = root.policy_variants ?? [];
  if (!Array.isArray(variants) || variants.length > 8)
    throw new Error("comparison_fixture_invalid");
  const policy_variants = variants.map((value) => {
    const item = object(value, ["id", "policy"], ["id", "policy"]);
    return {
      id: identifier(item.id),
      policy: EcoLogitsFallbackPolicySchema.parse(item.policy),
    };
  });
  if (
    new Set(policy_variants.map((item) => item.id)).size !==
      policy_variants.length ||
    policy_variants.some((item) =>
      [
        "original",
        "ecologits-configured",
        "ecologits-original-fallback",
      ].includes(item.id),
    )
  )
    throw new Error("comparison_fixture_invalid");
  const controls = root.controlled_cases ?? [];
  if (!Array.isArray(controls) || controls.length > 128)
    throw new Error("comparison_fixture_invalid");
  const controlled_cases = controls.map((value): ControlledCase => {
    const fields = ["id", "output_tokens", "profile_id", "environment"];
    const item = object(value, fields, fields);
    if (
      !BASELINE_BUNDLE.profiles.some(
        (profile) => profile.id === item.profile_id,
      ) ||
      !["baseline-reference", "synthetic-unity"].includes(
        item.environment as string,
      )
    )
      throw new Error("comparison_control_unsupported");
    return {
      id: identifier(item.id),
      output_tokens: CounterSchema.parse(item.output_tokens),
      profile_id: item.profile_id as string,
      environment: item.environment as ControlledCase["environment"],
    };
  });
  if (
    new Set(controlled_cases.map((item) => item.id)).size !==
    controlled_cases.length
  )
    throw new Error("comparison_fixture_invalid");
  return {
    format: "engine-comparison-fixtures-1",
    provenance: "synthetic_numeric_only",
    cases,
    policy_variants,
    controlled_cases,
  };
}

function measurement(
  value: string | null,
  scope: TokenMeasurement["scope"] = "observed_text",
): TokenMeasurement {
  return TokenMeasurementSchema.parse({
    value,
    evidence: value === null ? "unknown" : "heuristic_estimate",
    scope,
    completeness: value === null ? "unknown" : "complete_for_scope",
    profile_id: value === null ? null : "observed-text-v1",
    reason:
      value === null
        ? "provider_usage_unavailable"
        : "tokenizer_mapping_unverified",
  });
}
export function buildObservation(
  item: ComparisonCase,
  index: number,
): NumericObservationInput {
  const uuid = (offset: number) =>
    `00000000-0000-4000-8000-${String(index * 2 + offset).padStart(12, "0")}`;
  if (item.family === "history")
    return {
      family: "history",
      record: HistoryMessageSchema.parse({ timing: null,
        schema_version: "3.0.0",
        kind: "history_message",
        message_key: payloadHash({ synthetic_case: item.id }),
        conversation_key: payloadHash({ synthetic_conversation: item.id }),
        role: item.history_role,
        key_version: "1",
        site: item.site,
        parent_key: null,
        prompt_key: null,
        provider_request_key: null,
        provider_attempt_key: null,
        occurred_at: "2026-01-01T12:00:00.000Z",
        date_basis: "message_created",
        observed_at: "2026-09-14T12:00:00.000Z",
        proposed_method_id: BASELINE_METHOD_ID,
        proposed_method_hash: BASELINE_METHOD_HASH,
        model_id: item.model_id,
        tokens: measurement(item.tokens.answer),
        inline_file_text: null,
        parts:
          item.history_role === "response"
            ? historyResponseParts(measurement(item.tokens.answer))
            : null,
        generation: emptyGeneration(),
        company_dedup_key: null,
        text_complete: item.tokens.answer !== null,
        coverage_reasons: ["history_only"],
      }),
    };
  const tokens = emptyTokenFields();
  tokens.logical_input_total = measurement(
    item.tokens.input,
    "reconstructed_context",
  );
  tokens.answer_output = measurement(item.tokens.answer);
  tokens.visible_thinking = measurement(item.tokens.visible_thinking);
  tokens.intermediate_output = notApplicableMeasurement();
  // A supplied inclusive total is kept as the provider's report of the request, exactly as
  // the frozen corpus upgrade does; otherwise the total is the sum of the supplied parts.
  tokens.output_total =
    item.tokens.output_total === null
      ? composeOutputTotal(tokens)
      : {
          ...measurement(item.tokens.output_total, "provider_request"),
          evidence: "provider_reported",
        };
  const model_evidence = item.model_id === null ? "unknown" : "response_field";
  const request = RequestObservationSchema.parse({
    schema_version: "3.0.0",
    kind: "request",
    request_id: uuid(1),
    revision: 1,
    conversation_key: payloadHash({ synthetic_conversation: item.id }),
    key_version: "1",
    provider_request_key: null,
    site: item.site,
    adapter_version: "0.1.0",
    action: "send",
    dispatched_at: "2026-09-14T12:00:00.000Z",
    ended_at: "2026-09-14T12:00:05.000Z",
    state: "completed",
    model_id: item.model_id,
    model_evidence,
    features: ["text"],
    observed_search_operations: null,
    documents: { extracted_text: null, upload_count: null, types: [], processing: "unknown" },
    media: emptyRequestMedia(),
    coverage_reasons: [],
    policy_version: "0.1.0",
    company_dedup_key: null,
  });
  const attempt = AttemptObservationSchema.parse({ timing: null,
    schema_version: "3.0.0",
    kind: "attempt",
    attempt_id: uuid(2),
    request_id: uuid(1),
    revision: 1,
    provider_attempt_key: null,
    key_version: "1",
    started_at: request.dispatched_at,
    ended_at: request.ended_at,
    state: "completed",
    execution_evidence: item.execution,
    model_id: item.model_id,
    model_evidence,
    tokens,
    media: emptyAttemptMedia(),
    generation: emptyGeneration(),
    coverage_reasons: [],
    tokenizer_profile_id: "observed-text-v1",
    tokenizer_asset_hash: null,
    proposed_method_id: BASELINE_METHOD_ID,
    company_dedup_key: null,
  });
  return { family: "live", request, attempt };
}
