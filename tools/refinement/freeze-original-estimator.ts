import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  AttemptObservationSchema,
  HistoryMessageSchema,
  composeOutputTotal,
  emptyAttemptMedia,
  emptyGeneration,
  historyResponseParts,
  emptyTokenFields,
  notApplicableMeasurement,
  type AttemptObservation,
} from "../../packages/contracts/src/index";
import {
  BASELINE_METHOD_HASH,
  BASELINE_METHOD_ID,
  estimateAttempt,
  estimateHistoricalText,
} from "../../packages/estimator/src/index";

const root = resolve(import.meta.dirname, "../..");
const destination = process.argv[2];
if (!destination)
  throw new Error(
    "Supply a new fixture path; existing files are never overwritten.",
  );

function attempt(count: string | null): AttemptObservation {
  const tokens = emptyTokenFields();
  if (count !== null) {
    tokens.answer_output = {
      value: count,
      evidence: "heuristic_estimate",
      scope: "observed_text",
      completeness: "complete_for_scope",
      profile_id: "o200k-base-4.0.0-reference",
      reason: "tokenizer_mapping_unverified",
    };
  }
  tokens.intermediate_output = notApplicableMeasurement();
  tokens.output_total = composeOutputTotal(tokens);
  return AttemptObservationSchema.parse({ timing: null,
    schema_version: "3.0.0",
    kind: "attempt",
    attempt_id: "00000000-0000-4000-8000-000000000002",
    request_id: "00000000-0000-4000-8000-000000000001",
    revision: 1,
    provider_attempt_key: null,
    key_version: "1",
    started_at: "2026-09-10T12:00:00.000Z",
    ended_at: "2026-09-10T12:00:05.000Z",
    state: "completed",
    execution_evidence: "content_observed",
    model_id: null,
    model_evidence: "unknown",
    tokens,
    media: emptyAttemptMedia(),
    generation: emptyGeneration(),
    coverage_reasons: [],
    tokenizer_profile_id: null,
    tokenizer_asset_hash: null,
    proposed_method_id: BASELINE_METHOD_ID,
    company_dedup_key: null,
  });
}

const live: Array<{
  name: string;
  observation: AttemptObservation;
  expected: unknown;
}> = [];
function add(name: string, observation: AttemptObservation) {
  const parsed = AttemptObservationSchema.parse(observation);
  live.push({ name, observation: parsed, expected: estimateAttempt(parsed) });
}
for (const count of [
  null,
  "0",
  "1",
  "500",
  "1000",
  "32768",
  "9007199254740991",
  "9007199254740992",
  "9223372036854775807",
]) {
  add(`output-${count ?? "unknown"}`, attempt(count));
}
for (const state of [
  "generating",
  "failed",
  "cancelled",
  "interrupted_unconfirmed",
] as const) {
  add(`partial-${state}`, {
    ...attempt("500"),
    state,
    ended_at: state === "generating" ? null : "2026-09-10T12:00:05.000Z",
  });
}
add("execution-not-observed", {
  ...attempt("500"),
  execution_evidence: "none",
});
add("recognized-model", {
  ...attempt("500"),
  model_id: "chatgpt-gpt-5-5",
  model_evidence: "response_field",
});
const reported = attempt("500");
// An inclusive total that is not the sum of the observed parts is a reported total.
reported.tokens.output_total = {
  ...reported.tokens.answer_output,
  value: "800",
  evidence: "provider_reported",
  scope: "provider_request",
};
reported.tokens.reported_reasoning = {
  ...reported.tokens.answer_output,
  value: "300",
};
add("inclusive-output-not-plus-reasoning", reported);
const longInput = attempt("500");
longInput.tokens.logical_input_total = {
  ...longInput.tokens.answer_output,
  value: "500000",
  scope: "reconstructed_context",
};
add("input-does-not-change-output-formula", longInput);

const history = [null, "0", "100", "9223372036854775807"].flatMap((count) =>
  (["prompt", "response"] as const).map((role) => {
    const observation = HistoryMessageSchema.parse({ timing: null,
      schema_version: "3.0.0",
      kind: "history_message",
      message_key: "a".repeat(64),
      role,
      conversation_key: "c".repeat(64),
      key_version: "1",
      site: "claude",
      parent_key: null,
      prompt_key: null,
      provider_request_key: null,
      provider_attempt_key: null,
      occurred_at: "2020-01-01T00:00:00.000001Z",
      date_basis: "message_created",
      observed_at: "2026-09-14T16:00:00.000Z",
      model_id: null,
      proposed_method_id: BASELINE_METHOD_ID,
      proposed_method_hash: BASELINE_METHOD_HASH,
      tokens: {
        value: count,
        evidence: count === null ? "unknown" : "heuristic_estimate",
        scope: "observed_text",
        completeness: count === null ? "unknown" : "complete_for_scope",
        profile_id: count === null ? null : "observed-text-v1",
        reason:
          count === null ? "history_only" : "tokenizer_mapping_unverified",
      },
      inline_file_text: null,
      parts:
        role === "response"
          ? historyResponseParts({
              value: count,
              evidence: count === null ? "unknown" : "heuristic_estimate",
              scope: "observed_text",
              completeness: count === null ? "unknown" : "complete_for_scope",
              profile_id: count === null ? null : "observed-text-v1",
              reason:
                count === null
                  ? "history_only"
                  : "tokenizer_mapping_unverified",
            })
          : null,
      generation: emptyGeneration(),
      company_dedup_key: null,
      text_complete: count !== null,
      coverage_reasons: ["history_only"],
    });
    return {
      name: `${role}-${count ?? "unknown"}`,
      observation,
      expected: estimateHistoricalText(observation),
    };
  }),
);
const sourceFiles = [
  "packages/estimator/src/index.ts",
  "packages/estimator/src/original.ts",
  "packages/estimator/src/bundle.ts",
  "packages/estimator/src/history.ts",
  "packages/estimator/src/numeric.ts",
  "packages/estimator/src/methods/text.ts",
  "packages/estimator/src/methods/environment.ts",
  "packages/estimator/data/baseline.json",
  "packages/estimator/python/footprint_estimator.py",
];
const fixture = {
  format: "frozen-legacy-estimator-1",
  provenance: {
    source_head: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    working_tree_capture: true,
    method_id: BASELINE_METHOD_ID,
    method_hash: BASELINE_METHOD_HASH,
    source_sha256: Object.fromEntries(
      sourceFiles.map((path) => [
        path,
        createHash("sha256")
          .update(readFileSync(resolve(root, path)))
          .digest("hex"),
      ]),
    ),
  },
  live,
  history,
  // The image benchmark data was removed on 20 October 2026. Its one saved record without
  // figures is carried over so the contract tests can still read results saved before then.
  retired_image_reference: JSON.parse(
    readFileSync(
      resolve(root, "packages/estimator/test/fixtures/legacy-refinement.json"),
      "utf8",
    ),
  ).retired_image_reference,
};
// A characterization fixture is captured once before refactoring, never refreshed by tests.
writeFileSync(resolve(destination), JSON.stringify(fixture, null, 2) + "\n", {
  flag: "wx",
});
process.stdout.write(
  `Frozen ${live.length} live and ${history.length} history cases.\n`,
);
