import { test } from "node:test";
import assert from "node:assert/strict";
import { pythonReference } from "../../../tools/python-reference.cjs";
import { resolve } from "node:path";
import {
  composeOutputTotal,
  emptyTokenFields,
  emptyGeneration,
  emptyAttemptMedia,
  type AttemptObservation,
} from "@footprint/contracts";
import {
  estimateAttempt,
  BASELINE_BUNDLE,
  BASELINE_METHOD_ID,
  BASELINE_METHOD_HASH,
  registerMethodBundle,
  environmentalAllocation,
  EstimateCache,
} from "../src/index";
import { fixed } from "../src/numeric";
import numericFixtures from "../../../calibration/numeric-fixtures.json";
function attempt(n = "500"): AttemptObservation {
  const tokens = emptyTokenFields();
  tokens.answer_output = {
    value: n,
    evidence: "heuristic_estimate",
    scope: "observed_text",
    completeness: "complete_for_scope",
    profile_id: "o200k-base-4.0.0-reference",
    reason: "tokenizer_mapping_unverified",
  };
  tokens.output_total = composeOutputTotal(tokens);
  return { timing: null,
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
  };
}
function python(a: AttemptObservation, bundles: unknown[] = [], options = {}) {
  const root = resolve(import.meta.dirname, "../../..");
  const r = pythonReference(
    [resolve(root, "packages/estimator/python/footprint_estimator.py")],
    { input: JSON.stringify({ observation: a, bundles, options }) },
  );
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
test("E01 MU03 old bundle full TS/Python numerical, scope, provenance and lineage parity", () => {
  for (const n of numericFixtures.output_counts)
    assert.deepEqual(estimateAttempt(attempt(n)), python(attempt(n)));
});
test("FM01 independent published Command A golden and no invented complete water scope", () => {
  const r = estimateAttempt(attempt("500"));
  assert.equal(r.selected_profile_id, "command-a-03-2025-h100-reference");
  assert.equal(r.eligible_candidate_count, 4);
  assert.ok(
    Math.abs(Number(r.metrics.energy.value) - 0.00038900446245) < 1e-12,
  );
  assert.equal(r.metrics.water_total.value, null);
  assert.equal(r.environment_provenance.carbon_boundary, "lifecycle");
  assert.equal(r.environment_provenance.upstream_water_source, "all_source");
});
test("E02 E03 E04 Q03 Q04 Q06 denominators, partial factors and compatible water scope", () => {
  const s = structuredClone(BASELINE_BUNDLE.scenario);
  s.pue = null;
  let a = environmentalAllocation("0.001", "facility", s);
  assert.equal(fixed(a.facility), "0.001");
  assert.equal(a.it, null);
  assert.equal(a.direct, null);
  assert.equal(fixed(a.carbon), "0.3844");
  s.direct_denominator = "facility";
  a = environmentalAllocation("0.001", "facility", s);
  assert.equal(fixed(a.direct), "0.000999");
  s.direct_water_source = "all_source";
  s.common_water_scope = "all_source_consumption";
  assert.equal(
    fixed(environmentalAllocation("0.001", "facility", s).total),
    "0.0041311",
  );
  assert.throws(() =>
    environmentalAllocation("0.001", "it", {
      ...s,
      water_kind: "withdrawal",
    } as never),
  );
  assert.throws(() =>
    environmentalAllocation("0.001", "it", { ...s, pue: "" }),
  );
});
test("FM05 FM08 finite maximum preserves observed identity, deterministic ASCII tie", () => {
  const b = structuredClone(
    BASELINE_BUNDLE,
  ) as import("../src/bundle").MethodBundle;
  b.method_id = "test-tie-v1";
  b.profiles = [
    { ...b.profiles[3], id: "z-profile" },
    { ...b.profiles[3], id: "a-profile" },
  ];
  registerMethodBundle(b);
  const a = attempt();
  a.model_id = "chatgpt-gpt-5-5";
  a.model_evidence = "response_field";
  const r = estimateAttempt(a, { methodId: b.method_id });
  assert.equal(r.observed_model_key, "chatgpt-gpt-5-5");
  assert.equal(r.selected_profile_id, "a-profile");
  assert.equal(r.validation_state, "unvalidated_reference");
});
test("MU01 MU02 MU03 MU04 replacement coefficients/equation preserve callers and original results", () => {
  const original = estimateAttempt(attempt());
  for (const replacement of [false, true]) {
    const b = structuredClone(
      BASELINE_BUNDLE,
    ) as import("../src/bundle").MethodBundle;
    b.method_id = replacement ? "test-linear-v1" : "test-coefficients-v1";
    b.coefficients.energyAlpha = "0.000002";
    if (replacement) b.equation_id = "test-linear-v1";
    registerMethodBundle(b);
    const options = {
      methodId: b.method_id,
      view: "recalculated" as const,
      originalMethodHash: BASELINE_METHOD_HASH,
    };
    const result = estimateAttempt(attempt(), options);
    assert.notEqual(result.metrics.energy.value, original.metrics.energy.value);
    assert.deepEqual(result, python(attempt(), [b], options));
  }
  assert.deepEqual(estimateAttempt(attempt()), original);
});
test("MU05 Q01 Q12 unsupported, research-only, executable and conflicting bundles rejected", () => {
  assert.throws(() =>
    estimateAttempt(attempt(), { methodId: "not-supported" }),
  );
  for (const changes of [
    { runtime_selection_allowed: false },
    { equation: "eval(1)" },
    { coefficients: { ...BASELINE_BUNDLE.coefficients, energyAlpha: "-1" } },
    { scenario: { ...BASELINE_BUNDLE.scenario, carbon: "999" } },
  ])
    assert.throws(() =>
      registerMethodBundle({ ...structuredClone(BASELINE_BUNDLE), ...changes }),
    );
});
test("MU06 immutable bounded cache distinguishes revision, observation and method", () => {
  const c = new EstimateCache(2),
    a = attempt();
  const r = c.estimate(a);
  assert.equal(c.estimate(a), r);
  assert.throws(() => {
    (r.metrics.energy as { value: string }).value = "0";
  });
  c.estimate({ ...a, revision: 2 });
  c.estimate(attempt("1000"));
  assert.equal(c.size, 2);
  assert.notEqual(c.estimate(a), r);
});
test("FM10 E07 E08 missing hidden work does not suppress text; zero output after execution unknown", () => {
  const a = attempt(),
    r = estimateAttempt(a);
  assert.notEqual(r.metrics.energy.value, null);
  a.tokens.logical_input_total = {
    ...a.tokens.answer_output,
    value: "500000",
    scope: "reconstructed_context",
  };
  a.tokens.reported_reasoning = { ...a.tokens.answer_output, value: "9999" };
  assert.equal(estimateAttempt(a).metrics.energy.value, r.metrics.energy.value);
  assert.ok(r.reasons.includes("input_length_not_modelled"));
  assert.equal(estimateAttempt(attempt("0")).metrics.energy.value, null);
  assert.equal(
    estimateAttempt({ ...a, execution_evidence: "none" }).metrics.energy.value,
    null,
  );
});
test("IM08 image operations produce no benchmark reference and leave the text estimate unchanged", () => {
  // The bundled ML.ENERGY image figures were removed on 20 October 2026 (no licence). The
  // Original method never added them to its totals, so only image_references changes.
  const a = attempt("500");
  const settings = {
    width: 1024,
    height: 1024,
    steps: 50,
    precision: "bfloat16" as const,
    architecture: "diffusion" as const,
  };
  const withImage: AttemptObservation = {
    ...a,
    media: {
      ...emptyAttemptMedia(),
      image_operations: [
        {
          operation_key: "b".repeat(64),
          kind: "text_to_image",
          requested_count: "2",
          returned_count: "2",
          state: "completed",
          execution_evidence: "content_observed",
          settings,
          model_id: null,
          model_evidence: "unknown",
        },
      ],
      generated_images: [
        {
          operation_key: "b".repeat(64),
          count: "2",
          width: 1024,
          height: 1024,
          dimension_source: "original",
          settings,
        },
      ],
    },
  };
  const r = estimateAttempt(withImage);
  assert.deepEqual(r.image_references, []);
  assert.deepEqual(r.metrics, estimateAttempt(a).metrics);
  assert.deepEqual(r, python(withImage));
});
