import assert from "node:assert/strict";
import test from "node:test";
import {
  EcoLogitsFallbackPolicySchema,
  EngineBuildConfigurationSchema,
  EnginePreferenceRecordSchema,
  EstimateObservationSourceSchema,
  FiniteDecimalSchema,
  MediaPolicySchema,
  NonnegativeFiniteDecimalSchema,
  DecimalSchema,
  finiteDecimal,
} from "../src/index";
import media from "../../../config/estimation.media.json";

const policy = {
  policy_version: "test-policy-1",
  review_date: "2026-09-14",
  provider_defaults: {
    openai: {
      strategy: "upstream_provider_flagship",
      profile: {
        provider: "openai",
        model_name: "test-model",
        workload: "text",
      },
    },
    anthropic: { strategy: "original_engine" },
  },
  model_overrides: {},
  unknown_provider: { strategy: "unavailable" },
};

test("BE03 PF08 policy rejects malformed defaults, cross-provider proxies and executable fields", () => {
  const base = {
    schema_version: "1.0.0",
    default_engine: "original",
    available_engines: ["original", "ecologits"],
    ecologits_fallback: policy,
  };
  assert.ok(EngineBuildConfigurationSchema.safeParse(base).success);
  for (const change of [
    { default_engine: "typo" },
    { available_engines: ["original"] },
    { formula: "remote-code" },
    {
      ecologits_fallback: {
        ...policy,
        provider_defaults: {
          openai: {
            strategy: "upstream_provider_flagship",
            profile: {
              provider: "anthropic",
              model_name: "test-model",
              workload: "text",
            },
          },
        },
      },
    },
  ])
    assert.equal(
      EngineBuildConfigurationSchema.safeParse({ ...base, ...change }).success,
      false,
    );
  assert.equal(
    EcoLogitsFallbackPolicySchema.safeParse({
      ...policy,
      unknown_provider: policy.provider_defaults.openai,
    }).success,
    true,
  );
  for (const unknown of [
    { strategy: "upstream_provider_flagship" },
    {
      strategy: "upstream_profile",
      profile: policy.provider_defaults.openai.profile,
    },
    {
      strategy: "original_engine",
      profile: policy.provider_defaults.openai.profile,
    },
  ])
    assert.equal(
      EcoLogitsFallbackPolicySchema.safeParse({
        ...policy,
        unknown_provider: unknown,
      }).success,
      false,
    );
});

test("BE04 BE11 strict preference is installation metadata and has an exact revision", () => {
  const value = {
    schema_version: "1.0.0",
    preference: "build_default",
    selection_revision: 1,
    updated_at: "2026-09-14T21:00:00.000Z",
  };
  assert.deepEqual(EnginePreferenceRecordSchema.parse(value), value);
  for (const change of [
    { selection_revision: 0 },
    { selection_revision: Number.MAX_SAFE_INTEGER },
    { preference: "remote" },
    { tenant_id: "other" },
  ]) {
    assert.equal(
      EnginePreferenceRecordSchema.safeParse({ ...value, ...change }).success,
      false,
    );
  }
});

test("PF13 live dependency identity requires both request and attempt hashes", () => {
  const value = {
    family: "live",
    request_id: "00000000-0000-4000-8000-000000000001",
    request_revision: 1,
    request_hash: "a".repeat(64),
    attempt_id: "00000000-0000-4000-8000-000000000002",
    attempt_revision: 1,
    attempt_hash: "b".repeat(64),
  };
  assert.ok(EstimateObservationSourceSchema.safeParse(value).success);
  const { request_hash: _omitted, ...missing } = value;
  assert.equal(
    EstimateObservationSourceSchema.safeParse(missing).success,
    false,
  );
  assert.equal(
    EstimateObservationSourceSchema.safeParse({ ...value, prompt: "forbidden" })
      .success,
    false,
  );
});

test("EL17 EL19 binary64 serialization is explicit and does not change legacy decimals", () => {
  for (const value of [
    0,
    Number.MIN_VALUE,
    1e-24,
    0.00038900446245,
    1e21,
    Number.MAX_VALUE,
  ]) {
    const encoded = finiteDecimal(value);
    assert.equal(Number(NonnegativeFiniteDecimalSchema.parse(encoded)), value);
  }
  assert.equal(finiteDecimal(-0), "0");
  assert.equal(DecimalSchema.safeParse("1e-24").success, false);
  assert.equal(FiniteDecimalSchema.safeParse("1e-999").success, false);
  for (const value of ["NaN", "Infinity", "1e999", "-0", "-1"]) {
    assert.equal(
      NonnegativeFiniteDecimalSchema.safeParse(value).success,
      false,
    );
  }
  assert.throws(() => finiteDecimal(Infinity));
});

test("C4 environment overrides accept a grid with PUE and WUE and reject anything else", () => {
  // The shipped GLM overrides carry EcoLogits' US multi-cloud PUE and WUE ranges.
  assert.ok(MediaPolicySchema.safeParse(media).success);
  const withOverride = (override: unknown) =>
    MediaPolicySchema.safeParse({
      ...media,
      environment_overrides: { "test-model": override },
    }).success;
  assert.ok(withOverride({ electricity_mix_zone: "USA" }));
  assert.ok(
    withOverride({
      electricity_mix_zone: "USA",
      datacenter_pue: "1.2",
      datacenter_wue: { min: "0.13", max: "0.99" },
    }),
  );
  for (const override of [
    { datacenter_pue: "1.1" },
    { electricity_mix_zone: "USA", datacenter_location: "USA" },
    { electricity_mix_zone: "USA", gwp: "0.4" },
    { electricity_mix_zone: "USA", datacenter_pue: 1.1 },
    { electricity_mix_zone: "USA", datacenter_pue: "0.9" },
    { electricity_mix_zone: "USA", datacenter_pue: { min: "0.95", max: "1.1" } },
    { electricity_mix_zone: "USA", datacenter_wue: { min: "0.99", max: "0.13" } },
    { electricity_mix_zone: "USA", datacenter_wue: { min: "0.13" } },
    { electricity_mix_zone: "USA", datacenter_wue: { min: "0.13", max: "0.99", mean: "0.5" } },
    { electricity_mix_zone: "USA", datacenter_wue: "0" },
    { electricity_mix_zone: "USA", datacenter_wue: "-1" },
  ])
    assert.equal(withOverride(override), false, JSON.stringify(override));
});
