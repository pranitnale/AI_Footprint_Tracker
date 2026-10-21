import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EstimationEnvelopeSchema,
  payloadHash,
  type ProductMetric,
} from "../../../packages/contracts/src/index";
import build from "../../../config/estimation.build.json";
import mappings from "../../../config/estimation.mappings.json";
import media from "../../../config/estimation.media.json";
import fixtures from "../fixtures/engine-comparison.json";
import {
  compareEngines,
  comparisonMarkdown,
  metricDelta,
  runComparisonCli,
} from "../compare-engines";
import { parseComparisonFixtures } from "../comparison-fixtures";
import {
  BASELINE_BUNDLE,
  BASELINE_METHOD_HASH,
} from "../../../packages/estimator/src/bundle";
import { D } from "../../../packages/estimator/src/numeric";

const manifest = {
  fixture_sha256: "a".repeat(64),
  build_sha256: "b".repeat(64),
  mappings_sha256: "c".repeat(64),
  media_sha256: "5".repeat(64),
  citation_sha256: "d".repeat(64),
  core_lock_sha256: "e".repeat(64),
  retained_source_manifest_sha256: "f".repeat(64),
  comparison_sha256: "1".repeat(64),
  controlled_comparison_sha256: "2".repeat(64),
  original_text_sha256: "3".repeat(64),
  original_environment_sha256: "4".repeat(64),
};
const reportPromise = compareEngines(
  fixtures,
  build,
  mappings,
  media,
  manifest,
);

test("RL07/PF12 comparison uses actual executor outputs and preserves methods, profiles, raw phases and uncertainty", async () => {
  const report = await reportPromise;
  assert.equal(report.cases.length, 19);
  const run = (id: string, variant = "ecologits-configured") =>
    report.cases
      .find((item) => item.id === id)!
      .runs.find((item) => item.variant_id === variant)!.result;
  assert.equal(run("direct-openai").selection.kind, "direct_mapping");
  assert.equal(run("unmapped-openai").selection.kind, "provider_flagship");
  assert.equal(run("unknown-model").selection.kind, "provider_flagship");
  assert.equal(
    run("unknown-underlying-provider").selection.kind,
    "provider_flagship",
  );
  assert.equal(
    run("unknown-underlying-provider").selection.profile?.model_name,
    "gpt-6.1-sol",
  );
  assert.equal(
    run("unknown-underlying-provider").effective_method.engine_id,
    "ecologits",
  );
  assert.equal(
    run("unmapped-openai", "ecologits-original-fallback").effective_method
      .engine_id,
    "original",
  );
  assert.equal(
    run("direct-openai", "ecologits-original-fallback").selection.kind,
    "direct_mapping",
  );
  assert.equal(
    run("direct-openai", "model-override").selection.kind,
    "model_override",
  );
  assert.equal(
    run("direct-openai", "original-model-override").selection.kind,
    "original_fallback",
  );
  assert.ok(
    run("direct-openai", "unsupported-video-profile").reasons.includes(
      "unsupported_workload",
    ),
  );
  assert.equal(
    run("unknown-underlying-provider", "unavailable-policy").status,
    "unavailable",
  );
  for (const id of [
    "zero-output",
    "missing-output",
    "unsafe-binary64-count",
    "int64-limit",
    "no-execution",
    "history-prompt",
  ]) {
    assert.equal(run(id).status, "unavailable", id);
    assert.equal(run(id).metrics.energy.value, null);
  }
  assert.equal(run("unsafe-binary64-count", "original").status, "estimated");
  assert.equal(run("history-response").source.family, "history");
  const direct = run("direct-openai");
  assert.equal(direct.raw?.engine_id, "ecologits");
  if (direct.raw?.engine_id !== "ecologits")
    throw new Error("Missing raw source");
  assert.ok(
    direct.raw.result.embodied &&
      direct.raw.result.usage &&
      direct.raw.result.gwp,
  );
  assert.equal(direct.metrics.carbon.phase, "usage");
  assert.equal(direct.metrics.carbon.value_kind, "midpoint");
  assert.ok(
    direct.metrics.carbon.scenario_low && direct.metrics.carbon.scenario_high,
  );
  // Water policy upstream-wcf-1 (16 September 2026) displays the unchanged
  // upstream WCF midpoint as water consumption. The component rows stay null
  // and not applicable, and the earlier forced-unavailable total is gone.
  const wcf = direct.raw.result.wcf;
  if (!wcf || typeof wcf.value === "string")
    throw new Error("Expected a ranged upstream WCF");
  const total = direct.metrics.water_total;
  assert.equal(total.status, "partial_estimate");
  assert.equal(total.unit, "L");
  assert.equal(total.value_kind, "midpoint");
  assert.equal(total.scenario_low, wcf.value.min);
  assert.equal(total.scenario_high, wcf.value.max);
  assert.equal(
    Number(total.value),
    (Number(wcf.value.min) + Number(wcf.value.max)) / 2,
  );
  assert.equal(total.reasons.includes("factor_incompatible"), false);
  assert.equal(
    direct.missing_components.includes("compatible_total_water_scope"),
    false,
  );
  for (const component of ["water_direct", "water_upstream"] as const) {
    assert.equal(direct.metrics[component].value, null);
    assert.deepEqual(direct.metrics[component].reasons, ["not_applicable"]);
  }
  // The Original engine has no total, so the report must not invent a delta.
  assert.equal(
    report.cases
      .find((item) => item.id === "direct-openai")!
      .deltas.find(
        (delta) => delta.candidate_variant === "ecologits-configured",
      )!.metrics.water_total.reason,
    "reference_unavailable",
  );
  // Every estimated EcoLogits run follows the same water shape.
  for (const item of report.cases)
    for (const entry of item.runs) {
      const result = entry.result;
      if (
        result.effective_method.engine_id !== "ecologits" ||
        result.status !== "estimated"
      )
        continue;
      assert.notEqual(result.metrics.water_total.value, null, item.id);
      assert.deepEqual(result.metrics.water_direct.reasons, ["not_applicable"]);
      assert.deepEqual(result.metrics.water_upstream.reasons, [
        "not_applicable",
      ]);
    }
  for (const item of report.cases)
    for (const entry of item.runs) {
      EstimationEnvelopeSchema.parse(entry.result);
      assert.equal(entry.output_hash, payloadHash(entry.result));
    }
  assert.equal(
    new Set(report.methods.map((method) => method.ecologits.method_hash)).size,
    6,
  );
});

test("Numeric-only multilingual observations keep counts; reports are deterministic and do not retokenize", async () => {
  const report = await reportPromise;
  const values = report.cases
    .filter((item) => item.id.startsWith("numeric-language-"))
    .map((item) => item.runs[1].result.metrics);
  for (const value of values) assert.deepEqual(value, values[0]);
  const again = await compareEngines(
    fixtures,
    build,
    mappings,
    media,
    manifest,
  );
  assert.equal(JSON.stringify(again), JSON.stringify(report));
  assert.equal(comparisonMarkdown(again), comparisonMarkdown(report));
  const markdown = comparisonMarkdown(report);
  assert.match(markdown, /Raw EcoLogits phases/);
  assert.match(markdown, /not physical measurements/);
  assert.match(markdown, /10\.21105\/joss\.07471/);
  assert.match(markdown, /midpoint/);
});

test("RL07 controlled runs share profile, coefficients, hardware, token and environment inputs while preserving incompatible scopes", async () => {
  const before = payloadHash(BASELINE_BUNDLE);
  const report = await reportPromise;
  assert.equal(report.controlled_cases.length, 7);
  assert.equal(report.cases[0].mode, "native_product_policies");
  for (const item of report.controlled_cases.filter(
    (value) => value.status === "computed",
  )) {
    assert.equal(item.mode, "controlled_mathematical_inputs");
    assert.equal(item.identity.original_bundle_hash, BASELINE_METHOD_HASH);
    assert.equal(item.identity.controls_hash, payloadHash(item.shared));
    assert.equal(
      item.identity.protocol_hash,
      payloadHash(report.controlled_protocol),
    );
    const original = item.runs[0],
      eco = item.runs[1];
    assert.equal(original.input_hash, eco.input_hash);
    assert.equal(original.input_hash, item.identity.controls_hash);
    if (!("input" in eco)) throw new Error("Missing core input");
    assert.equal(eco.input.output_token_count, item.shared.output_tokens);
    assert.equal(
      eco.input.model_active_parameter_count,
      item.shared.profile.activeBillions,
    );
    assert.equal(
      eco.input.model_total_parameter_count,
      item.shared.profile.totalBillions,
    );
    assert.equal(eco.input.batch_size, item.shared.settings.batchSize);
    assert.equal(eco.input.model_quantization_bits, "16");
    assert.equal(eco.input.gpu_memory, "80");
    assert.equal(eco.input.server_power, item.shared.settings.hostPowerKw);
    assert.equal(
      eco.input.server_gpu_count,
      item.shared.settings.serverGpuCount,
    );
    assert.equal(eco.input.datacenter_pue, item.shared.scenario.pue);
    assert.equal(
      eco.input.if_electricity_mix_gwp,
      new D(item.shared.scenario.carbon!).div(1000).toString(),
    );
    assert.equal(
      eco.input.if_electricity_mix_wue,
      item.shared.scenario.upstream_water,
    );
    assert.equal(eco.input.datacenter_wue, item.shared.scenario.direct_water);
    assert.equal(eco.input.request_latency, null);
    assert.equal(eco.input.tps, null);
    assert.equal(eco.input.ttft, null);
    for (const run of item.runs) {
      const { output_hash, ...output } = run;
      assert.equal(output_hash, payloadHash(output));
    }
    for (const quantity of ["energy", "carbon", "water_upstream"] as const) {
      const delta = item.deltas![quantity];
      if (item.shared.output_tokens === "0") {
        assert.equal(delta.signed_delta, "0");
        assert.equal(delta.relative_delta, null);
        assert.equal(delta.reason, "zero_reference_value");
      } else {
        assert.equal(delta.reason, null);
        assert.ok(new D(delta.relative_delta!).abs().lt("1e-10"), quantity);
      }
    }
    assert.equal(item.deltas!.water_direct.reason, "incompatible_scope");
    assert.equal(item.deltas!.water_direct.signed_delta, null);
    assert.equal(item.deltas!.water_total.signed_delta, null);
    assert.ok(eco.raw.embodied);
    assert.equal("embodied" in original.raw, false);
  }
  const unsafe = report.controlled_cases.find(
    (item) => item.id === "shared-unsafe-count",
  )!;
  assert.equal(unsafe.status, "unavailable");
  assert.equal(unsafe.reason, "numeric_domain_unsupported");
  assert.deepEqual(unsafe.runs, []);
  assert.equal(unsafe.deltas, null);
  assert.equal(payloadHash(BASELINE_BUNDLE), before);
});

test("controlled environment variants change allocation without changing shared IT energy or native product results", async () => {
  const report = await reportPromise;
  const baseline = report.controlled_cases.find(
    (item) => item.id === "shared-111b-baseline",
  )!;
  const unity = report.controlled_cases.find(
    (item) => item.id === "shared-111b-unity",
  )!;
  assert.notEqual(
    baseline.identity.controls_hash,
    unity.identity.controls_hash,
  );
  const originalBase = baseline.runs[0],
    originalUnity = unity.runs[0],
    eco = baseline.runs[1];
  if (
    !("environment" in originalBase.raw) ||
    !("environment" in originalUnity.raw) ||
    !("intermediates" in eco)
  )
    throw new Error("Missing mathematical evidence");
  assert.equal(originalBase.raw.energy.it, originalUnity.raw.energy.it);
  assert.equal(originalUnity.metrics.energy.value, originalUnity.raw.energy.it);
  assert.equal(
    new D(originalUnity.metrics.carbon.value!).div(1000).toString(),
    originalUnity.metrics.energy.value,
  );
  assert.equal(
    originalUnity.metrics.water_upstream.value,
    originalUnity.metrics.energy.value,
  );
  assert.equal(originalUnity.metrics.water_direct.value, "0");
  assert.equal(eco.intermediates.gpu_required_count, "4");
  assert.equal(eco.intermediates.model_required_memory, "266.4");
  assert.match(comparisonMarkdown(report), /Controlled mathematical inputs/);
  assert.match(comparisonMarkdown(report), /synthetic-unity-comparison-1/);
  const noControls = await compareEngines(
    { ...fixtures, controlled_cases: [] },
    build,
    mappings,
    media,
    manifest,
  );
  assert.deepEqual(noControls.cases, report.cases);
  assert.deepEqual(noControls.methods, report.methods);
});

test("controlled fixture admission rejects unsupported profile/range/environment fields and unsafe coercion", () => {
  for (const patch of [
    { profile_id: "unadmitted-large-or-ranged-profile" },
    { environment: "unidentified-provider-location" },
    { active_billions: { min: 8, max: 12 } },
    { request_latency: 10 },
    { output_tokens: 500 },
    { output_tokens: "-1" },
    { prompt: "forbidden text" },
  ]) {
    const copy = structuredClone(fixtures);
    Object.assign(copy.controlled_cases[0], patch);
    assert.throws(() => parseComparisonFixtures(copy));
  }
});

test("Delta arithmetic preserves tiny decimals and reports null for zero denominators or missing scope", () => {
  const metric = (value: string | null): ProductMetric => ({
    value,
    unit: "kWh",
    status: value === null ? "unavailable" : "partial_estimate",
    scope: "modeled_text_component",
    phase: "usage",
    scenario_low: null,
    scenario_high: null,
    interval_kind: null,
    value_kind: value === null ? "unavailable" : "scalar",
    reasons: [],
  });
  assert.equal(metricDelta(metric("0"), metric("1")).relative_delta, null);
  assert.equal(
    metricDelta(metric("0"), metric("1")).reason,
    "zero_reference_value",
  );
  assert.equal(
    metricDelta(metric("0"), metric("0")).reason,
    "zero_reference_value",
  );
  assert.equal(
    metricDelta(metric(null), metric("1")).reason,
    "reference_unavailable",
  );
  assert.equal(
    metricDelta(metric("1"), metric(null)).reason,
    "candidate_unavailable",
  );
  assert.equal(
    metricDelta(metric("1"), metric("2"), false).reason,
    "incompatible_scope",
  );
  assert.equal(
    metricDelta(metric("1e-30"), metric("2e-30")).relative_delta,
    "1",
  );
  assert.equal(
    metricDelta(
      metric("1000000000000000000.000000000000000001"),
      metric("1000000000000000000.000000000000000002"),
    ).absolute_delta,
    "0.000000000000000001",
  );
});

test("Strict fixture admission rejects raw text, identity fields, coercion and unknown sites/models", () => {
  for (const patch of [
    { prompt: "forbidden" },
    { title: "forbidden" },
    { request_id: "user-id" },
    { site: "unknown" },
    { model_id: "unregistered-free-form-model" },
  ]) {
    const copy = structuredClone(fixtures);
    Object.assign(copy.cases[0], patch);
    assert.throws(() => parseComparisonFixtures(copy));
  }
  for (const count of [1, true, "-1", "01", "9223372036854775808"]) {
    const copy = structuredClone(fixtures) as any;
    copy.cases[0].tokens.answer = count;
    assert.throws(() => parseComparisonFixtures(copy));
  }
});

test("CLI requires explicit paths, writes deterministic JSON/Markdown offline, and refuses overwrite", async () => {
  const scratch = fileURLToPath(new URL("../.test-runtime/", import.meta.url));
  mkdirSync(scratch, { recursive: true });
  const directory = mkdtempSync(join(scratch, "cli-"));
  const file = join(directory, "numeric.json");
  writeFileSync(
    file,
    JSON.stringify({
      ...fixtures,
      cases: fixtures.cases.slice(0, 1),
      policy_variants: [],
    }),
  );
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("Network is forbidden in offline comparison");
  }) as typeof fetch;
  try {
    await assert.rejects(runComparisonCli([]));
    const a = await runComparisonCli([
      "--fixtures",
      file,
      "--output",
      join(directory, "a"),
    ]);
    const b = await runComparisonCli([
      "--fixtures",
      file,
      "--output",
      join(directory, "b"),
    ]);
    assert.equal(readFileSync(a.json, "utf8"), readFileSync(b.json, "utf8"));
    assert.equal(
      readFileSync(a.markdown, "utf8"),
      readFileSync(b.markdown, "utf8"),
    );
    await assert.rejects(
      runComparisonCli(["--fixtures", file, "--output", join(directory, "a")]),
      /output_exists/,
    );
    assert.ok(existsSync(a.json) && existsSync(a.markdown));
  } finally {
    globalThis.fetch = previousFetch;
  }
});
