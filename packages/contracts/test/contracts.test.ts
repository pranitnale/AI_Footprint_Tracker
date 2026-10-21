import { test } from "node:test";
import assert from "node:assert/strict";
import { pythonReference } from "../../../tools/python-reference.cjs";
import {
  ObservationSchema,
  CounterSchema,
  UsageBatchSchema,
  parseUsageBatch,
  canonicalJson,
  payloadHash,
  emptyTokenFields,
  emptyGeneration,
  emptyAttemptMedia,
  type AttemptObservation,
} from "../src/index";
export function attempt(): AttemptObservation {
  return {
    schema_version: "3.0.0",
    kind: "attempt",
    timing: null,
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
    tokens: emptyTokenFields(),
    media: emptyAttemptMedia(),
    generation: emptyGeneration(),
    coverage_reasons: ["cross_device_dedup_unverified"],
    tokenizer_profile_id: null,
    tokenizer_asset_hash: null,
    proposed_method_id: null,
    company_dedup_key: null,
  };
}
test("P0 strict recursive whitelist rejects text, identity injection, unknown model and bad versions", () => {
  const a = attempt();
  assert.equal(ObservationSchema.safeParse(a).success, true);
  for (const bad of [
    { ...a, prompt: "PRIVATE_MARKER" },
    { ...a, company_id: a.request_id },
    { ...a, model_id: "page supplied text" },
    { ...a, schema_version: "1.0.0" },
    {
      ...a,
      tokens: {
        ...a.tokens,
        answer_output: { ...a.tokens.answer_output, text: "PRIVATE_MARKER" },
      },
    },
  ])
    assert.equal(ObservationSchema.safeParse(bad).success, false);
});
test("P0 T12 invalid counters fail without throwing and precise BIGINT bounds hold", () => {
  for (const value of [
    "marker-not-a-count",
    "1.5",
    "01",
    "-1",
    "1e3",
    "9223372036854775808",
    "NaN",
    "Infinity",
    "",
    1,
  ])
    assert.equal(CounterSchema.safeParse(value).success, false);
  assert.equal(
    CounterSchema.parse("9223372036854775807"),
    "9223372036854775807",
  );
});
test("P0 no missing-as-zero or unearned calibrated status and chronological dates", () => {
  const a = attempt();
  for (const bad of [
    { ...a, ended_at: "2026-09-09T12:00:00.000Z" },
    { ...a, started_at: "2026-02-30T12:00:00.000Z" },
    {
      ...a,
      tokens: {
        ...a.tokens,
        answer_output: { ...a.tokens.answer_output, value: "0" },
      },
    },
    {
      ...a,
      tokens: {
        ...a.tokens,
        answer_output: {
          ...a.tokens.answer_output,
          value: "1",
          evidence: "calibrated_estimate",
        },
      },
    },
  ])
    assert.equal(ObservationSchema.safeParse(bad).success, false);
});
test("P0 batch count and size bounds cannot admit hidden nested content", () => {
  const b = {
    schema_version: "3.0.0",
    batch_id: attempt().request_id,
    sent_at: attempt().started_at,
    client_version: "0.1.0",
    deletion_epoch: 0,
    records: [attempt()],
  };
  assert.equal(parseUsageBatch(b).records.length, 1);
  assert.equal(
    UsageBatchSchema.safeParse({ ...b, records: [] }).success,
    false,
  );
  assert.equal(
    UsageBatchSchema.safeParse({ ...b, records: Array(101).fill(attempt()) })
      .success,
    false,
  );
  assert.throws(() => parseUsageBatch({ ...b, oversized: "x".repeat(524288) }));
});
test("P0 Python and TypeScript canonical JSON/hash parity", () => {
  const input = {
    z: ["é", "😀", 1, true, null],
    a: { k: "9223372036854775807" },
  };
  const code =
    "import json,sys;from footprint_contracts import canonical_json,payload_hash;x=json.load(sys.stdin);print(json.dumps([canonical_json(x),payload_hash(x)]))";
  const run = pythonReference(["-c", code], { input: JSON.stringify(input) });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), [
    canonicalJson(input),
    payloadHash(input),
  ]);
});
