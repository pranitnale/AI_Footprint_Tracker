import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  DEFAULT_DISPLAY_SCENARIO,
  DisplayScenarioSchema,
  EstimationEnvelopeSchema,
  HistoricalResourceV2Schema,
  ProductMetricSchema,
  SerializedEcoLogitsOutputSchema,
  OriginalEstimateResultSchema,
  payloadHash,
  scenarioValue,
} from "../src/index";

const raw = (type: string, name: string, unit: string) => ({
  type,
  name,
  unit,
  value: { min: "1e-24", max: "2e-24" },
});
const rawMetrics = {
  energy: raw("energy", "Energy", "kWh"),
  gwp: raw("GWP", "Global Warming Potential", "kgCO2eq"),
  adpe: raw("ADPe", "Abiotic Depletion Potential (elements)", "kgSbeq"),
  pe: raw("PE", "Primary Energy", "MJ"),
  wcf: raw("WCF", "Water Consumption Footprint", "L"),
};
const eco = {
  ...rawMetrics,
  usage: { type: "usage", name: "Usage", ...rawMetrics },
  embodied: {
    type: "embodied",
    name: "Embodied",
    gwp: rawMetrics.gwp,
    adpe: rawMetrics.adpe,
    pe: rawMetrics.pe,
  },
  warnings: [
    { code: "model-arch-not-released", message: "Synthetic source warning." },
  ],
  errors: null,
};

test("PR01 PR02 serialized source preserves every phase/range and rejects mismatched units", () => {
  assert.deepEqual(SerializedEcoLogitsOutputSchema.parse(eco), eco);
  for (const change of [
    { energy: { ...rawMetrics.energy, unit: "Wh" } },
    { energy: { ...rawMetrics.energy, value: { min: "2", max: "1" } } },
    { energy: { ...rawMetrics.energy, value: "NaN" } },
    { usage: { ...eco.usage, training: rawMetrics.energy } },
    { errors: [{ code: "model-not-registered", message: "Synthetic error." }] },
  ])
    assert.equal(
      SerializedEcoLogitsOutputSchema.safeParse({ ...eco, ...change }).success,
      false,
    );
  assert.ok(
    SerializedEcoLogitsOutputSchema.safeParse({
      energy: null,
      gwp: null,
      adpe: null,
      pe: null,
      wcf: null,
      usage: null,
      embodied: null,
      warnings: null,
      errors: [{ code: "model-not-registered", message: "Synthetic error." }],
    }).success,
  );
});

test("PR03 midpoint metadata cannot masquerade as a scalar or an unavailable value", () => {
  const metric = {
    value: "1.5",
    unit: "kWh",
    status: "partial_estimate",
    scope: "modeled_text_component",
    phase: "usage",
    scenario_low: "1",
    scenario_high: "2",
    interval_kind: "upstream_approximation",
    value_kind: "midpoint",
    reasons: [],
  };
  assert.ok(ProductMetricSchema.safeParse(metric).success);
  for (const change of [
    { value: "3" },
    { value: null },
    { status: "unavailable" },
    { scenario_high: null },
    { value_kind: "scalar" },
    { interval_kind: null },
    { phase: "total" },
  ]) {
    assert.equal(
      ProductMetricSchema.safeParse({ ...metric, ...change }).success,
      false,
    );
  }
});

test("PF06 PR17 original raw output binds its observation and effective method without relabeling", () => {
  const corpus = JSON.parse(
    readFileSync(
      new URL(
        "../../estimator/test/fixtures/legacy-refinement.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const original = OriginalEstimateResultSchema.parse(
    corpus.live.find((entry: { name: string }) => entry.name === "output-500")
      .expected,
  );
  const identity = {
    engine_id: "original",
    implementation_version: "original-v1",
    method_id: original.method_id,
    method_hash: original.method_hash,
    source_version: null,
    source_commit: null,
    catalog_hash: null,
    profile_policy_hash: "a".repeat(64),
    environment_policy_hash: "b".repeat(64),
    product_scope: "operational-only",
  };
  const result = {
    schema_version: "3.0.0",
    source: {
      family: "live",
      request_id: "00000000-0000-4000-8000-000000000001",
      request_revision: 1,
      request_hash: "c".repeat(64),
      attempt_id: original.attempt_id,
      attempt_revision: original.observation_revision,
      attempt_hash: original.observation_hash,
    },
    input_hash: "d".repeat(64),
    auxiliary_method_hashes: {
      image_reference: corpus.retired_image_reference.cohort_hash,
    },
    requested_method: identity,
    effective_method: identity,
    execution_origin: "local",
    view: "original",
    original_method_hash: null,
    selection: {
      kind: "legacy_reference",
      observed_model_id: null,
      profile: null,
      reason: null,
      basis: null,
    },
    components: [],
    raw: { engine_id: "original", result: original },
    status: "estimated",
    image_references: original.image_references,
    metrics: Object.fromEntries(
      Object.entries(original.metrics).map(([name, metric]) => [
        name,
        {
          ...metric,
          phase: "usage",
          interval_kind: null,
          value_kind: metric.value === null ? "unavailable" : "scalar",
        },
      ]),
    ),
    reasons: original.reasons,
    missing_components: original.missing_components,
    validation_state: "unvalidated_reference",
    comparability: {
      energy_boundary: "facility",
      carbon_boundary: "lifecycle",
      carbon_accounting: "location",
      water_kind: "consumption",
      direct_water_source: "unknown",
      upstream_water_source: "all_source",
      common_water_scope: null,
      tokenizer_profile_id: "o200k-base-4.0.0-reference",
    },
  };
  result.input_hash = payloadHash({
    schema_version: "3.0.0",
    source: result.source,
    requested_method_hash: identity.method_hash,
    effective_method_hash: identity.method_hash,
    selection: result.selection,
    auxiliary_method_hashes: result.auxiliary_method_hashes,
  });
  assert.ok(EstimationEnvelopeSchema.safeParse(result).success);
  for (const change of [
    { source: { ...result.source, attempt_revision: 2 } },
    { source: { ...result.source, attempt_hash: "e".repeat(64) } },
    { effective_method: { ...identity, method_id: "different-method" } },
    {
      effective_method: {
        ...identity,
        implementation_version: "forged-version",
      },
    },
    { effective_method: { ...identity, engine_id: "ecologits" } },
    { requested_method: { ...identity, engine_id: "ecologits" } },
    { view: "recalculated" },
    { status: "unavailable" },
    { prompt: "forbidden" },
  ])
    assert.equal(
      EstimationEnvelopeSchema.safeParse({ ...result, ...change }).success,
      false,
    );
});

test("display scenarios select retained endpoints and fall back to the midpoint", () => {
  const ranged = {
    value: "1.5",
    value_kind: "midpoint" as const,
    scenario_low: "1",
    scenario_high: "2",
  };
  assert.equal(scenarioValue(ranged, "minimum"), "1");
  assert.equal(scenarioValue(ranged, "midpoint"), "1.5");
  assert.equal(scenarioValue(ranged, "maximum"), "2");
  const summed = { ...ranged, value_kind: "midpoint_sum" as const };
  assert.equal(scenarioValue(summed, "minimum"), "1");
  assert.equal(scenarioValue(summed, "maximum"), "2");
  const legacy = {
    value: "1.5",
    value_kind: "midpoint_sum" as const,
    scenario_low: null,
    scenario_high: null,
  };
  assert.equal(scenarioValue(legacy, "minimum"), "1.5");
  assert.equal(scenarioValue(legacy, "maximum"), "1.5");
  assert.equal(
    scenarioValue({ value: "3", value_kind: "scalar" }, "maximum"),
    "3",
  );
  assert.equal(
    scenarioValue({ value: null, value_kind: "unavailable" }, "minimum"),
    null,
  );
  // The product ships with Midpoint since 12 October 2026 (owner); Minimum before.
  assert.equal(DEFAULT_DISPLAY_SCENARIO, "midpoint");
  assert.equal(DisplayScenarioSchema.safeParse("expected").success, false);
});

test("historical midpoint sums may carry scenario sums but never a joint interval kind", () => {
  const ecoMethod = {
    engine_id: "ecologits",
    implementation_version: "test-port-v1",
    method_id: "test-ecologits-v1",
    method_hash: "e".repeat(64),
    source_version: "0.11.1",
    source_commit: null,
    catalog_hash: null,
    profile_policy_hash: "b".repeat(64),
    environment_policy_hash: "c".repeat(64),
    product_scope: "operational-only",
  };
  const resource = {
    quantity: "energy",
    unit: "kWh",
    value: "3e-19",
    status: "partial_estimate",
    scope: "historical_visible_response",
    method_id: ecoMethod.method_id,
    method_hash: ecoMethod.method_hash,
    validation_state: "unvalidated_reference",
    profile_selection: "direct_mapping",
    selected_profile_id: "openai/gpt-test",
    reasons: [],
    missing_components: ["provider_execution_unobserved"],
    known_message_count: "2",
    unknown_message_count: "0",
    phase: "usage",
    value_kind: "midpoint_sum",
    scenario_low: "1e-19",
    scenario_high: "5e-19",
    interval_kind: null,
    requested_method: ecoMethod,
    effective_method: ecoMethod,
    comparability: {
      energy_boundary: "facility",
      carbon_boundary: "unknown",
      carbon_accounting: "location",
      water_kind: "consumption",
      direct_water_source: "unknown",
      upstream_water_source: "unknown",
      common_water_scope: null,
      tokenizer_profile_id: null,
    },
  };
  assert.ok(HistoricalResourceV2Schema.safeParse(resource).success);
  assert.ok(
    HistoricalResourceV2Schema.safeParse({
      ...resource,
      scenario_low: null,
      scenario_high: null,
    }).success,
  );
  for (const change of [
    { scenario_high: null },
    { interval_kind: "upstream_approximation" },
    { scenario_low: "4e-19" },
    { value_kind: "scalar" },
    { value_kind: "midpoint" },
  ]) {
    assert.equal(
      HistoricalResourceV2Schema.safeParse({ ...resource, ...change }).success,
      false,
      JSON.stringify(change),
    );
  }
});
