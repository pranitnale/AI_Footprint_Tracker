import assert from "node:assert/strict";
import test from "node:test";
import {
  type EnginePreferenceRecord,
  type UpstreamProfileReference,
} from "@footprint/contracts";
import {
  resolveEngineChoice,
  resolveModelProfile,
  validateProfilePolicy,
  type ProfileCatalog,
} from "../src/selection";

const profile = (
  model_name: string,
  provider = "openai",
): UpstreamProfileReference => ({ provider, model_name, workload: "text" });
const catalog: ProfileCatalog = {
  has: (p) => ["direct", "flagship", "override"].includes(p.model_name),
};
const policyInput = {
  policy_version: "test-policy-1",
  review_date: "2026-09-14",
  provider_defaults: {
    openai: {
      strategy: "upstream_provider_flagship",
      profile: profile("flagship"),
    },
    anthropic: {
      strategy: "upstream_provider_flagship",
      profile: profile("flagship", "anthropic"),
    },
  },
  model_overrides: {},
  unknown_provider: { strategy: "unavailable" },
};
const policy = validateProfilePolicy(policyInput, catalog, [
  "openai",
  "anthropic",
]);
const input = {
  modelId: "test-direct",
  provider: "openai",
  workload: "text" as const,
};
const preference = (
  value: EnginePreferenceRecord["preference"],
): EnginePreferenceRecord => ({
  schema_version: "1.0.0",
  preference: value,
  selection_revision: 1,
  updated_at: "2026-09-14T21:00:00.000Z",
});

test("BE01 BE05 BE06 explicit selection survives changed build default", () => {
  assert.deepEqual(resolveEngineChoice("original", null), {
    status: "selected",
    engine: "original",
    preference: null,
  });
  assert.equal(
    (
      resolveEngineChoice("ecologits", preference("original")) as {
        engine: string;
      }
    ).engine,
    "original",
  );
  assert.equal(
    (
      resolveEngineChoice("ecologits", preference("build_default")) as {
        engine: string;
      }
    ).engine,
    "ecologits",
  );
  assert.deepEqual(
    resolveEngineChoice("original", preference("ecologits"), ["original"]),
    { status: "unavailable", reason: "engine_unavailable" },
  );
  assert.deepEqual(resolveEngineChoice("original", { preference: "other" }), {
    status: "unavailable",
    reason: "invalid_preference",
  });
});

test("PF01-PF05 explicit override, direct mapping and provider flagship have deterministic precedence", () => {
  const mappings = { "test-direct": profile("direct") };
  assert.deepEqual(resolveModelProfile(input, mappings, policy, catalog), {
    kind: "upstream",
    selection: "direct_mapping",
    profile: profile("direct"),
    basis: "exact_record",
  });
  assert.deepEqual(
    resolveModelProfile(
      { ...input, modelId: "new-model" },
      mappings,
      policy,
      catalog,
    ),
    {
      kind: "upstream",
      selection: "provider_flagship",
      profile: profile("flagship"),
      basis: "model_not_in_library",
    },
  );
  assert.deepEqual(
    resolveModelProfile(
      { ...input, provider: "anthropic", modelId: null },
      {},
      policy,
      catalog,
    ),
    {
      kind: "upstream",
      selection: "provider_flagship",
      profile: profile("flagship", "anthropic"),
      basis: "model_not_named",
    },
  );
  const override = validateProfilePolicy(
    {
      ...policyInput,
      model_overrides: {
        "test-direct": {
          strategy: "upstream_profile",
          profile: profile("override"),
          basis: "nearest_record",
        },
      },
    },
    catalog,
    [],
  );
  assert.deepEqual(resolveModelProfile(input, mappings, override, catalog), {
    kind: "upstream",
    selection: "model_override",
    profile: profile("override"),
    basis: "nearest_record",
  });
});

test("PF06 PF07 original fallback is explicit and never recurses", () => {
  const original = validateProfilePolicy(
    {
      ...policyInput,
      provider_defaults: { openai: { strategy: "original_engine" } },
      unknown_provider: { strategy: "original_engine" },
    },
    catalog,
    ["openai"],
  );
  assert.deepEqual(resolveModelProfile(input, {}, original, catalog), {
    kind: "original",
    reason: "provider_policy",
  });
  assert.deepEqual(
    resolveModelProfile({ ...input, provider: null }, {}, original, catalog),
    { kind: "original", reason: "unknown_provider_policy" },
  );
  assert.deepEqual(
    resolveModelProfile({ ...input, provider: null }, {}, policy, catalog),
    { kind: "unavailable", reason: "provider_unknown" },
  );
});

test("PF08 policy snapshots reject missing references and prototype keys cannot impersonate mappings", () => {
  assert.throws(() => validateProfilePolicy(policyInput, catalog, ["missing"]));
  assert.throws(() =>
    validateProfilePolicy(
      {
        ...policyInput,
        provider_defaults: {
          openai: {
            strategy: "upstream_provider_flagship",
            profile: profile("absent"),
          },
        },
      },
      catalog,
      [],
    ),
  );
  // A stand-in must say why it stands in, so Details can name the basis.
  assert.throws(() =>
    validateProfilePolicy(
      {
        ...policyInput,
        model_overrides: {
          "test-direct": {
            strategy: "upstream_profile",
            profile: profile("override"),
          },
        },
      },
      catalog,
      [],
    ),
  );
  assert.throws(() => {
    (policy.provider_defaults.openai as { strategy: string }).strategy =
      "unavailable";
  });
  assert.deepEqual(
    resolveModelProfile(
      { ...input, modelId: "constructor", provider: "constructor" },
      {},
      policy,
      catalog,
    ),
    { kind: "unavailable", reason: "provider_unknown" },
  );
  assert.deepEqual(
    resolveModelProfile(
      input,
      { "test-direct": profile("direct", "anthropic") },
      policy,
      catalog,
    ),
    { kind: "unavailable", reason: "model_provider_conflict" },
  );
  assert.deepEqual(
    resolveModelProfile({ ...input, workload: "video" }, {}, policy, catalog),
    { kind: "unavailable", reason: "unsupported_workload" },
  );
});

test("PF07 unknown-provider benchmark profile is explicit, validated and never crosses an identified provider", () => {
  const benchmark = validateProfilePolicy(
    {
      ...policyInput,
      unknown_provider: {
        strategy: "upstream_provider_flagship",
        profile: profile("flagship"),
      },
    },
    catalog,
    ["openai", "anthropic"],
  );
  assert.deepEqual(
    resolveModelProfile(
      { ...input, modelId: null, provider: null },
      {},
      benchmark,
      catalog,
    ),
    {
      kind: "upstream",
      selection: "provider_flagship",
      profile: profile("flagship"),
      basis: "model_not_named",
    },
  );
  assert.deepEqual(
    resolveModelProfile(
      { ...input, modelId: "perplexity-best", provider: null },
      {},
      benchmark,
      catalog,
    ),
    {
      kind: "upstream",
      selection: "provider_flagship",
      profile: profile("flagship"),
      basis: "model_not_in_library",
    },
  );
  assert.deepEqual(
    resolveModelProfile(
      { ...input, provider: "mistralai" },
      {},
      benchmark,
      catalog,
    ),
    { kind: "unavailable", reason: "model_provider_conflict" },
  );
  assert.throws(() =>
    validateProfilePolicy(
      {
        ...policyInput,
        unknown_provider: {
          strategy: "upstream_provider_flagship",
          profile: profile("absent"),
        },
      },
      catalog,
      [],
    ),
  );
});
