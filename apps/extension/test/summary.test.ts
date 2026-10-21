import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize, sumFixed } from "../lib/summary";
import { normalizeModel } from "../lib/models";
import {
  records,
  withOutputTotal,
} from "../../../packages/ledger/test/factory";
import { estimateAttempt, BASELINE_METHOD_ID } from "@footprint/estimator";
const row = (record: any) => ({
  key: record.kind,
  namespace: "personal:test",
  era: null,
  record,
  hash: "a".repeat(64),
});
test("G06 request and attempt occurrence boundaries remain independent across midnight", () => {
  const [r, a] = records();
  r.dispatched_at = "2026-09-09T23:59:59.000Z";
  a.started_at = "2026-09-10T00:00:01.000Z";
  a.proposed_method_id = BASELINE_METHOD_ID;
  const result = summarize([row(r), row(a)], [estimateAttempt(a)], {
    start: "2026-09-10T00:00:00.000Z",
    end: "2026-09-11T00:00:00.000Z",
  });
  assert.equal(result.requests, 0);
  assert.equal(result.attempts, 1);
  assert.equal(result.tokens.answer.value, "100");
  const previous = summarize([row(r), row(a)], [estimateAttempt(a)], {
    start: "2026-09-09T00:00:00.000Z",
    end: "2026-09-10T00:00:00.000Z",
  });
  assert.equal(previous.requests, 1);
  assert.equal(previous.attempts, 0);
});
test("G07 carbon and evidence scopes are split, never hidden behind first unit", () => {
  const [r, a] = records();
  a.proposed_method_id = BASELINE_METHOD_ID;
  const b = { ...a, attempt_id: crypto.randomUUID() };
  const first = estimateAttempt(a);
  const second = structuredClone(estimateAttempt(b));
  second.metrics.carbon.unit = "gCO2";
  second.metrics.carbon.value = "1";
  const result = summarize([row(r), row(a), row(b)], [first, second]);
  assert.equal(result.metrics.carbon.value, null);
  assert.equal(result.metrics.carbon.groups.length, 2);
  assert.equal(result.metrics.carbon.unknown, 0);
  b.tokens = {
    ...a.tokens,
    answer_output: {
      ...a.tokens.answer_output,
      scope: "provider_defined_subset",
    },
  };
  // Approximate token counts add; each scope stays a group of its own for Details.
  const answer = summarize([row(r), row(a), row(b)], []).tokens.answer;
  assert.equal(answer.groups.length, 2);
  assert.equal(
    answer.value,
    (2n * BigInt(a.tokens.answer_output.value!)).toString(),
  );
});
test("G08 old estimate revisions and benchmark references never inflate current totals", () => {
  const [r, a] = records();
  a.proposed_method_id = BASELINE_METHOD_ID;
  const estimate = estimateAttempt(a);
  const old = { ...estimate, observation_revision: 99 };
  const reference = { ...estimate, reference_only: true };
  const result = summarize(
    [row(r), row(a)],
    [old, reference, estimate, estimate],
  );
  assert.equal(result.metrics.energy.known, 1);
  assert.equal(result.metrics.energy.unknown, 0);
  assert.equal(
    sumFixed(["0.000000000000000001", "0.000000000000000009"]),
    "0.00000000000000001",
  );
  assert.equal(sumFixed(["1e-7", "2.5e-7", "-5e-8"]), "0.0000003");
  assert.equal(sumFixed(["1e+3", "-999.5"]), "0.5");
  assert.equal(sumFixed(["5e-324", "5e-324"]), `0.${"0".repeat(322)}1`);
  for (const invalid of ["NaN", "Infinity", "1e999", "1e-324"])
    assert.throws(() => sumFixed([invalid]), /summary_response_invalid/);
});
test("Observed aliases normalize only under the provider evidence registry", () => {
  assert.equal(
    normalizeModel("chatgpt", "gpt-5-6-thinking"),
    "chatgpt-gpt-5-6-sol",
  );
  // Best names no model; it is estimated with the family benchmark (B2).
  assert.equal(normalizeModel("perplexity", "pplx_pro"), "perplexity-best");
  for (const [label, id] of [
    ["gpt56_terra", "perplexity-gpt-5-6-terra"],
    ["gemini38flash", "perplexity-gemini-3-8-flash"],
    ["claude50sonnet", "perplexity-claude-sonnet-5"],
    ["nv_nemotron_3_ultra", "perplexity-nemotron-3-ultra"],
    ["grok46low", "perplexity-grok-4-6"],
    ["glm_5_3_thinking", "perplexity-glm-5-3"],
    ["kimik3thinking", "perplexity-kimi-k3"],
  ] as const)
    assert.equal(normalizeModel("perplexity", label), id);
  // A label of another site is not recognised: it stays local as an unlisted model.
  assert.equal(
    normalizeModel("perplexity", "gpt-5-6-thinking"),
    "perplexity-unlisted",
  );
  assert.equal(normalizeModel("chatgpt", "gpt56_terra"), "chatgpt-unlisted");
  assert.equal(normalizeModel("gemini", "Thinking"), "gemini-unlisted");
  assert.equal(normalizeModel("claude", "chatgpt-gpt-5-5"), "claude-unlisted");
});
test("P7 a profile choice is a detail of each reply: totals add across choices; token evidence groups stay distinct in Details", () => {
  const [r, a] = records();
  a.proposed_method_id = BASELINE_METHOD_ID;
  const b = {
    ...a,
    attempt_id: crypto.randomUUID(),
    tokens: withOutputTotal({
      ...a.tokens,
      answer_output: {
        ...a.tokens.answer_output,
        evidence: "provider_reported" as const,
        completeness: "partial" as const,
      },
    }),
  };
  const first = estimateAttempt(a),
    second = {
      ...estimateAttempt(b),
      profile_selection: "matched_profile" as const,
    };
  const result = summarize([row(r), row(a), row(b)], [first, second]);
  // Totals group by comparability (D4), never by model or profile choice.
  assert.equal(result.metrics.energy.groups.length, 1);
  assert.equal(
    result.metrics.energy.value,
    sumFixed([first.metrics.energy.value!, second.metrics.energy.value!]),
  );
  assert.ok(!("profile_selection" in result.metrics.energy.groups[0]!));
  assert.ok(
    result.metrics.energy.groups.every((g) => g.cohort_hash && g.method_hash),
  );
  assert.equal(result.tokens.answer.groups.length, 2);
  assert.equal(
    result.tokens.answer.value,
    (2n * BigInt(a.tokens.answer_output.value!)).toString(),
  );
  assert.deepEqual(
    new Set(result.tokens.answer.groups.map((g) => g.evidence)),
    new Set(["heuristic_estimate", "provider_reported"]),
  );
});
