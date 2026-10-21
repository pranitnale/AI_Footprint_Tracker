import assert from "node:assert/strict";
import test from "node:test";
import {
  composeOutputTotal,
  AttemptObservationSchema,
  RequestObservationSchema,
  HistoryMessageSchema,
  emptyRequestMedia,
  payloadHash,
  canonicalJson,
  historyResponseParts,
  providerMeasurement,
  type Site,
} from "@footprint/contracts";
import configuration from "../../../config/estimation.build.json";
import mappings from "../../../config/estimation.mappings.json";
import media from "../../../config/estimation.media.json";
import {
  createMethodRegistry,
  LocalEstimateExecutor,
  estimateAttempt,
  estimateHistoricalText,
  BASELINE_METHOD_HASH,
} from "../src/index";
import { prepareObservation } from "../src/engines/inputs";
import { serializeEcoLogitsOutput } from "../src/engines/projection";
import { loadLegacyCorpus } from "./legacy-corpus";

const corpus = loadLegacyCorpus();
const methods = createMethodRegistry(configuration, mappings, media);
const executor = new LocalEstimateExecutor(methods);
/** Test-only policy: the shipped policy never routes to the original engine. */
const legacyConfiguration = {
  ...configuration,
  ecologits_fallback: {
    ...configuration.ecologits_fallback,
    unknown_provider: { strategy: "original_engine" as const },
  },
};
const legacyMethods = createMethodRegistry(legacyConfiguration, mappings, media);
const legacyExecutor = new LocalEstimateExecutor(legacyMethods);
function live(
  site: Site = "chatgpt",
  model: string | null = "chatgpt-gpt-5-5",
  count = "500",
) {
  const attempt = AttemptObservationSchema.parse(
    structuredClone(
      corpus.live.find((entry: { name: string }) => entry.name === "output-500")
        .observation,
    ),
  );
  attempt.model_id = model as typeof attempt.model_id;
  attempt.model_evidence = model === null ? "unknown" : "response_field";
  attempt.tokens.answer_output.value = count;
  attempt.tokens.output_total = composeOutputTotal(attempt.tokens);
  const request = RequestObservationSchema.parse({
    schema_version: "3.0.0",
    kind: "request",
    request_id: attempt.request_id,
    revision: 1,
    conversation_key: "a".repeat(64),
    key_version: "1",
    provider_request_key: null,
    site,
    adapter_version: "0.1.0",
    action: "send",
    dispatched_at: attempt.started_at,
    ended_at: attempt.ended_at,
    state: "completed",
    model_id: model,
    model_evidence: attempt.model_evidence,
    features: ["text"],
    observed_search_operations: null,
    documents: {
      extracted_text: null,
      upload_count: null,
      types: [],
      processing: "unknown",
    },
    media: emptyRequestMedia(),
    coverage_reasons: [],
    policy_version: "0.1.0",
    company_dedup_key: null,
  });
  return { family: "live" as const, request, attempt };
}

test("LG02 LG10 original execution preserves its raw output and does not load EcoLogits", async () => {
  let loaded = false;
  const local = new LocalEstimateExecutor(methods, async () => {
    loaded = true;
    throw new Error("unavailable");
  });
  const input = live();
  const result = await local.estimate(input);
  assert.equal(loaded, false);
  assert.equal(result.requested_method.engine_id, "original");
  assert.equal(result.raw?.engine_id, "original");
  assert.equal(
    canonicalJson(result.raw?.result),
    canonicalJson(estimateAttempt(input.attempt)),
  );
  assert.equal(result.metrics.water_total.value, null);
});

test("PF01 PR01 direct EcoLogits uses usage phase, keeps hardware and preserves intervals", async () => {
  const result = await executor.estimate(live(), {
    methodId: methods.ecologits.method_id,
  });
  assert.equal(result.status, "estimated");
  assert.equal(result.selection.kind, "direct_mapping");
  assert.equal(result.selection.profile?.model_name, "gpt-5.5");
  assert.equal(result.raw?.engine_id, "ecologits");
  if (result.raw?.engine_id !== "ecologits")
    throw new Error("Expected EcoLogits source output");
  const raw = result.raw.result;
  assert.ok(raw.embodied && raw.usage && raw.gwp);
  const midpoint = (value: string | { min: string; max: string }) =>
    typeof value === "string"
      ? Number(value)
      : (Number(value.min) + Number(value.max)) / 2;
  assert.ok(
    Math.abs(
      Number(result.metrics.carbon.value) -
        midpoint(raw.usage.gwp.value) * 1000,
    ) < 1e-10,
  );
  assert.ok(midpoint(raw.gwp.value) >= midpoint(raw.usage.gwp.value));
  assert.ok(raw.wcf);
  assert.equal(
    Number(result.metrics.water_total.value),
    midpoint(raw.wcf.value),
  );
  assert.equal(result.metrics.water_total.unit, "L");
  assert.equal(
    result.metrics.water_total.reasons.includes("factor_incompatible"),
    false,
  );
  assert.equal(result.metrics.water_direct.value, null);
  assert.equal(result.metrics.water_upstream.value, null);
  assert.equal(
    result.missing_components.includes("compatible_total_water_scope"),
    false,
  );
  if (typeof raw.wcf.value !== "string") {
    assert.equal(result.metrics.water_total.scenario_low, raw.wcf.value.min);
    assert.equal(result.metrics.water_total.scenario_high, raw.wcf.value.max);
  }
  if (typeof raw.usage.gwp.value !== "string") {
    assert.equal(result.metrics.carbon.value_kind, "midpoint");
    assert.notEqual(result.metrics.carbon.scenario_low, null);
  }
});

test("EcoLogits water uses one unchanged upstream result with no component recalculation", async () => {
  const core = await import("@footprint/ecologits-core");
  let calls = 0;
  const local = new LocalEstimateExecutor(methods, async () => ({
    ...core,
    llmImpacts: (input) => {
      calls++;
      return core.llmImpacts(input);
    },
    computeLlmImpacts: () => {
      throw new Error("Product adapter must not recalculate water components");
    },
  }));
  for (const [site, model] of [
    ["chatgpt", "chatgpt-gpt-5-5"],
    ["claude", "claude-opus-4-8"],
    ["gemini", "gemini-3-1-pro"],
  ] as const) {
    const result = await local.estimate(live(site, model), {
      methodId: methods.ecologits.method_id,
    });
    assert.equal(result.status, "estimated");
    assert.notEqual(result.metrics.water_total.value, null);
    assert.deepEqual(result.metrics.water_direct.reasons, ["not_applicable"]);
    assert.deepEqual(result.metrics.water_upstream.reasons, ["not_applicable"]);
  }
  assert.equal(calls, 3);
  assert.equal(methods.ecoDefinition.water_total_policy, "upstream-wcf-1");
  assert.notEqual(
    methods.ecologits.method_hash,
    payloadHash({
      ...methods.ecoDefinition,
      water_total_policy: "unavailable-with-unresolved-categories",
    }),
  );
});

test("the newly supported consumer models use direct EcoLogits profiles", async () => {
  for (const [site, model, expected] of [
    ["chatgpt", "chatgpt-gpt-5-6-sol", "gpt-5.6-sol"],
    ["chatgpt", "chatgpt-gpt-5-6-luna", "gpt-5.6-luna"],
    ["claude", "claude-fable-5", "claude-fable-5"],
    ["claude", "claude-fable-5-1", "claude-fable-5-1"],
    ["claude", "claude-opus-5", "claude-opus-5"],
    ["claude", "claude-sonnet-5", "claude-sonnet-5"],
    ["gemini", "gemini-3-6-flash", "gemini-3.6-flash"],
    // Owner correction of 14 October 2026: a GPT Pro is a family model with Pro reasoning, and
    // OpenAI says GPT-6 Pro in ChatGPT is GPT-6 Astra with the Pro option.
    ["chatgpt", "chatgpt-gpt-6-pro", "gpt-6-astra"],
    ["chatgpt", "chatgpt-gpt-5-6-sol-pro", "gpt-5.6-sol"],
    ["chatgpt", "chatgpt-gpt-6-sol-pro", "gpt-6-sol"],
    ["perplexity", "perplexity-gpt-6-sol-pro", "gpt-6-sol"],
    // Owner decision of 14 October 2026: Nano Banana Pro is Gemini 3 Pro Image, on both sites.
    ["gemini", "gemini-nano-banana-pro", "gemini-3-pro-image-preview"],
    ["perplexity", "perplexity-nano-banana-pro", "gemini-3-pro-image-preview"],
  ] as const) {
    const result = await executor.estimate(live(site, model), {
      methodId: methods.ecologits.method_id,
    });
    assert.equal(result.status, "estimated", model);
    assert.equal(result.selection.kind, "direct_mapping", model);
    assert.equal(result.selection.observed_model_id, model);
    assert.equal(result.selection.profile?.model_name, expected);
    assert.ok(!result.reasons.includes("model_proxy"));
    assert.ok(result.reasons.includes("unvalidated_reference"));
    assert.ok(result.reasons.includes("provider_environment_assumed"));
    assert.notEqual(result.metrics.energy.value, null);
    assert.notEqual(result.metrics.water_total.value, null);
  }
});

test("PF02 PF03 stand-ins and family benchmarks cover models without an EcoLogits record", async () => {
  for (const [site, model, kind, expected, basis] of [
    ["chatgpt", "chatgpt-o3-pro", "model_override", "gpt-6-astra", "nearest_record"],
    ["chatgpt", "chatgpt-gpt-5-5-mini", "model_override", "gpt-5.4-mini", "nearest_record"],
    ["claude", "claude-opus-3", "model_override", "claude-opus-4-5", "nearest_record"],
    ["claude", "claude-sonnet-3-5", "model_override", "claude-sonnet-4-5", "nearest_record"],
    ["chatgpt", "chatgpt-unlisted", "provider_flagship", "gpt-6.1-sol", "model_not_in_library"],
    ["claude", "claude-unlisted", "provider_flagship", "claude-opus-5-5", "model_not_in_library"],
    ["gemini", "gemini-unlisted", "provider_flagship", "gemini-3.8-flash", "model_not_in_library"],
    ["chatgpt", null, "provider_flagship", "gpt-6.1-sol", "model_not_named"],
    ["claude", null, "provider_flagship", "claude-opus-5-5", "model_not_named"],
    ["gemini", null, "provider_flagship", "gemini-3.8-flash", "model_not_named"],
  ] as const) {
    const result = await executor.estimate(live(site, model), {
      methodId: methods.ecologits.method_id,
    });
    assert.equal(result.status, "estimated", String(model));
    assert.equal(result.selection.kind, kind, String(model));
    assert.equal(result.selection.profile?.model_name, expected);
    assert.equal(result.selection.basis, basis, String(model));
    assert.ok(result.reasons.includes("model_proxy"));
    assert.equal(result.components.length, 1);
    assert.deepEqual(result.components[0]!.selection, result.selection);
  }
});

test("PF06 opaque router's explicit original fallback retains genuine child output", async () => {
  const input = live("perplexity", "perplexity-unlisted");
  const result = await legacyExecutor.estimate(input, {
    methodId: legacyMethods.ecologits.method_id,
  });
  assert.equal(result.selection.kind, "original_fallback");
  assert.equal(result.requested_method.engine_id, "ecologits");
  assert.equal(result.effective_method.engine_id, "original");
  assert.equal(result.effective_method.method_hash, BASELINE_METHOD_HASH);
  assert.equal(
    canonicalJson(result.raw?.result),
    canonicalJson(estimateAttempt(input.attempt)),
  );
  assert.ok(result.reasons.includes("original_engine_fallback"));
});

test("EL17 PR10 numeric-domain and zero-output outcomes retain source evidence without zero energy", async () => {
  for (const count of ["0", "9007199254740992", "9223372036854775807"]) {
    const input = live("chatgpt", "chatgpt-gpt-5-5", count);
    const result = await executor.estimate(input, {
      methodId: methods.ecologits.method_id,
    });
    assert.equal(result.status, "unavailable");
    assert.equal(result.metrics.energy.value, null);
    assert.equal(input.attempt.tokens.answer_output.value, count);
    assert.equal(result.source.family, "live");
  }
  const positive = live();
  positive.attempt.state = "cancelled";
  assert.equal(
    (
      await executor.estimate(positive, {
        methodId: methods.ecologits.method_id,
      })
    ).status,
    "estimated",
  );
});

test("PR11 PR22 historical estimates use recorded output counts and preserve original observations", async () => {
  for (const role of ["prompt", "response"] as const) {
    const record = HistoryMessageSchema.parse(
      corpus.history.find(
        (entry: { name: string }) => entry.name === `${role}-100`,
      ).observation,
    );
    const before = canonicalJson(record);
    const original = await executor.estimate({ family: "history", record });
    assert.equal(
      canonicalJson(original.raw?.result),
      canonicalJson(estimateHistoricalText(record)),
    );
    const revised = await executor.estimate(
      { family: "history", record },
      {
        methodId: methods.ecologits.method_id,
        view: "recalculated",
        originalMethodHash: record.proposed_method_hash,
      },
    );
    assert.equal(
      revised.status,
      role === "response" ? "estimated" : "unavailable",
    );
    assert.equal(revised.view, "recalculated");
    assert.equal(revised.original_method_hash, BASELINE_METHOD_HASH);
    assert.equal(canonicalJson(record), before);
    assert.ok(revised.reasons.includes("history_only"));
  }
});

test("PF13 input hashes bind both dependencies and trusted canonical relation data", async () => {
  const input = live();
  const first = await executor.estimate(input);
  const next = structuredClone(input);
  next.request.revision++;
  assert.notEqual((await executor.estimate(next)).input_hash, first.input_hash);
  next.request.request_id = "00000000-0000-4000-8000-000000000003";
  assert.throws(() => prepareObservation(next), /dependency_missing/);
  const binding = {
    observed_request_id: next.attempt.request_id,
    canonical_request_id: next.request.request_id,
    relation_hash: payloadHash({
      kind: "canonical_request_alias",
      observed_request_id: next.attempt.request_id,
      canonical_request_id: next.request.request_id,
    }),
  };
  const aliased = await executor.estimate({
    ...next,
    canonicalRequestBinding: binding,
  });
  assert.notEqual(aliased.input_hash, first.input_hash);
  assert.equal(
    aliased.source.family === "live" &&
      aliased.source.canonical_request_binding?.relation_hash,
    binding.relation_hash,
  );
  assert.throws(
    () =>
      prepareObservation({
        ...next,
        canonicalRequestBinding: { ...binding, relation_hash: "f".repeat(64) },
      }),
    /dependency_missing/,
  );
});

test("AR10 cancelled loading cannot publish and callers cannot mutate a prepared observation", async () => {
  const signal = new AbortController();
  signal.abort();
  await assert.rejects(
    executor.estimate(live(), { signal: signal.signal }),
    /cancelled/,
  );
  const prepared = prepareObservation(live());
  assert.throws(() => {
    (prepared.source as { request_hash: string }).request_hash = "f".repeat(64);
  });
  const changedDefault = createMethodRegistry(
    { ...configuration, default_engine: "ecologits" },
    mappings,
    media,
  );
  assert.equal(
    changedDefault.ecologits.method_hash,
    methods.ecologits.method_hash,
  );
});

test("PF07 Perplexity labels use their own records, stand-ins or the family benchmark", async () => {
  for (const [model, kind, provider, expected, basis] of [
    ["perplexity-gpt-5-6-terra", "direct_mapping", "openai", "gpt-5.6-terra", "exact_record"],
    ["perplexity-gpt-5-6-sol", "direct_mapping", "openai", "gpt-5.6-sol", "exact_record"],
    ["perplexity-claude-sonnet-5", "direct_mapping", "anthropic", "claude-sonnet-5", "exact_record"],
    ["perplexity-claude-opus-5", "direct_mapping", "anthropic", "claude-opus-5", "exact_record"],
    ["perplexity-gemini-3-8-flash", "direct_mapping", "google_genai", "gemini-3.8-flash", "exact_record"],
    ["perplexity-gemini-3-7-flash", "direct_mapping", "google_genai", "gemini-3.7-flash", "exact_record"],
    ["perplexity-glm-5-3", "direct_mapping", "mistralai", "zai-glm-5-3", "exact_record"],
    ["perplexity-gemini-3-pro", "model_override", "google_genai", "gemini-3.1-pro-preview", "nearest_record"],
    ["perplexity-best", "model_override", "openai", "gpt-6.1-sol", "model_not_named"],
    ["perplexity-deep-research", "model_override", "openai", "gpt-6.1-sol", "model_not_named"],
    ["perplexity-sonar-2", "model_override", "openai", "gpt-6.1-sol", "family_benchmark"],
    ["perplexity-kimi-k3", "model_override", "openai", "gpt-6.1-sol", "family_benchmark"],
    ["perplexity-grok-4-6", "model_override", "openai", "gpt-6.1-sol", "family_benchmark"],
    ["perplexity-nemotron-3-ultra", "model_override", "openai", "gpt-6.1-sol", "family_benchmark"],
    ["perplexity-unlisted-anthropic", "model_override", "anthropic", "claude-opus-5-5", "model_not_in_library"],
    ["perplexity-unlisted-google", "model_override", "google_genai", "gemini-3.8-flash", "model_not_in_library"],
    ["perplexity-unlisted", "provider_flagship", "openai", "gpt-6.1-sol", "model_not_in_library"],
    [null, "provider_flagship", "openai", "gpt-6.1-sol", "model_not_named"],
  ] as const) {
    const result = await executor.estimate(live("perplexity", model), {
      methodId: methods.ecologits.method_id,
    });
    assert.equal(result.status, "estimated", String(model));
    assert.equal(result.selection.kind, kind, String(model));
    assert.equal(result.selection.observed_model_id, model);
    assert.equal(result.selection.basis, basis, String(model));
    assert.deepEqual(result.selection.profile, {
      provider,
      model_name: expected,
      workload: "text",
    });
    assert.equal(result.requested_method.engine_id, "ecologits");
    assert.equal(result.effective_method.engine_id, "ecologits");
    assert.equal(result.raw?.engine_id, "ecologits");
    assert.equal(result.reasons.includes("model_proxy"), kind !== "direct_mapping");
    assert.ok(result.reasons.includes("provider_environment_assumed"));
    assert.ok(!result.reasons.includes("original_engine_fallback"));
    assert.notEqual(result.metrics.water_total.value, null, String(model));
    assert.notEqual(result.metrics.energy.value, null);
  }
});

test("C4 GLM through Perplexity keeps the GLM record but uses US grid, PUE and WUE", async () => {
  const core = await import("@footprint/ecologits-core");
  // Owner decision of 15 October 2026: EcoLogits' own US multi-cloud profile (its
  // huggingface_hub provider configuration), not Mistral's Swedish data centres.
  const us = core.catalog.provider_configurations.huggingface_hub!;
  const mistral = core.catalog.provider_configurations.mistralai!;
  assert.equal(us.datacenter_location, "USA");
  assert.notDeepEqual(us.datacenter_pue, mistral.datacenter_pue);
  assert.notDeepEqual(us.datacenter_wue, mistral.datacenter_wue);
  const records = { "perplexity-glm-5-2": "zai-glm-5-2", "perplexity-glm-5-3": "zai-glm-5-3" };
  for (const [model, record] of Object.entries(records)) {
    const override = methods.media.environment_overrides[model]!;
    // The method's decimal strings are EcoLogits' values, so the profiles cannot drift apart.
    for (const key of ["datacenter_pue", "datacenter_wue"] as const) {
      const factor = override[key] as { min: string; max: string };
      assert.deepEqual({ min: Number(factor.min), max: Number(factor.max) }, us[key], model);
    }
    const result = await executor.estimate(live("perplexity", model), {
      methodId: methods.ecologits.method_id,
    });
    assert.equal(result.status, "estimated", model);
    assert.deepEqual(result.selection.profile, {
      provider: "mistralai",
      model_name: record,
      workload: "text",
    });
    const main = result.components[0]!;
    assert.equal(main.inputs.electricity_mix_zone, "USA");
    assert.ok(main.reasons.includes("environment_override"));
    assert.ok(result.reasons.includes("environment_override"));
    const lookup = {
      provider: "mistralai",
      model_name: record,
      output_token_count: Number(main.inputs.output_tokens),
      request_latency:
        main.inputs.latency_seconds === null ? null : Number(main.inputs.latency_seconds),
      electricity_mix_zone: "USA",
    };
    const resolved = core.resolveLlmInput(lookup);
    assert.ok("input" in resolved);
    const expected = core.output(
      core.computeLlmImpacts({
        ...resolved.input,
        datacenter_pue: us.datacenter_pue,
        datacenter_wue: us.datacenter_wue,
      }),
      [...resolved.model.warnings, ...resolved.electricity_mix.warnings],
    );
    assert.equal(JSON.stringify(main.raw), JSON.stringify(serializeEcoLogitsOutput(expected)));
    // Mistral's own PUE and WUE with the US grid give other figures.
    const mistralFactors = core.llmImpacts(lookup);
    assert.notEqual(JSON.stringify(mistralFactors.usage?.energy), JSON.stringify(expected.usage?.energy));
    assert.notEqual(JSON.stringify(mistralFactors.wcf), JSON.stringify(expected.wcf));
  }
  // Both GLM versions use modelled serving speed: neither record carries Mistral's measured one.
  for (const record of Object.values(records)) {
    const entry = core.catalog.models.find(
      (item) => item.provider === "mistralai" && item.name === record,
    )!;
    assert.deepEqual(entry.architecture, {
      parameters: { active: 40, total: 744 },
      type: "moe",
    });
    assert.equal(entry.deployment?.tps ?? null, null);
  }
  // Other Perplexity records keep their provider's own grid.
  const other = await executor.estimate(live("perplexity", "perplexity-gpt-5-5"), {
    methodId: methods.ecologits.method_id,
  });
  assert.equal(other.components[0]!.reasons.includes("environment_override"), false);
});

test("PF07 the shipped EcoLogits policy never routes to the original engine implicitly", () => {
  const policy = methods.ecoDefinition.fallback;
  const rules = [
    ...Object.values(policy.provider_defaults),
    ...Object.values(policy.model_overrides),
    policy.unknown_provider,
  ];
  assert.ok(rules.length > 0);
  for (const rule of rules) assert.notEqual(rule.strategy, "original_engine");
  assert.equal(policy.unknown_provider.strategy, "upstream_provider_flagship");
});

test("Claude token factor: Claude text is estimated from 1.56 times the tokenizer's count", async () => {
  // Owner decision of 15 October 2026: one factor for every Claude count the tracker makes.
  assert.equal(methods.media.claude_token_factor?.factor, "1.56");
  const output = async (input: ReturnType<typeof live> | { family: "history"; record: unknown }) => {
    const result = await executor.estimate(input as Parameters<typeof executor.estimate>[0], {
      methodId: methods.ecologits.method_id,
    });
    assert.equal(result.status, "estimated");
    return result.components.find((component) => component.role === "main")!;
  };
  // A claude.ai reply: 500 counted tokens are estimated as 780, and the impacts are the
  // record's own for 780 output tokens.
  const claude = await output(live("claude", "claude-opus-5-5"));
  assert.equal(claude.inputs.output_tokens, "780");
  const core = await import("@footprint/ecologits-core");
  assert.equal(
    JSON.stringify(claude.raw),
    JSON.stringify(
      serializeEcoLogitsOutput(
        core.llmImpacts({
          provider: "anthropic",
          model_name: "claude-opus-5-5",
          output_token_count: 780,
          request_latency:
            claude.inputs.latency_seconds === null ? null : Number(claude.inputs.latency_seconds),
        }),
      ),
    ),
  );
  // A Perplexity reply answered by a Claude model gets the factor; Best, GPT and ChatGPT do not.
  assert.equal((await output(live("perplexity", "perplexity-claude-sonnet-5-5"))).inputs.output_tokens, "780");
  assert.equal((await output(live("perplexity", "perplexity-best"))).inputs.output_tokens, "500");
  assert.equal((await output(live("perplexity", "perplexity-gpt-5-5"))).inputs.output_tokens, "500");
  assert.equal((await output(live("chatgpt", "chatgpt-gpt-5-5"))).inputs.output_tokens, "500");
  // A saved Claude reply counted by the tokenizer: 100 tokens become 156.
  const parts = historyResponseParts({
    value: "100",
    evidence: "heuristic_estimate",
    scope: "observed_text",
    completeness: "complete_for_scope",
    profile_id: "o200k-base-4.0.0-reference",
    reason: "tokenizer_mapping_unverified",
  });
  const saved = HistoryMessageSchema.parse({
    ...corpus.history.find((entry: { name: string }) => entry.name === "response-100").observation,
    site: "claude",
    model_id: "claude-opus-5-5",
    parts,
    tokens: composeOutputTotal(parts),
  });
  assert.equal((await output({ family: "history", record: saved })).inputs.output_tokens, "156");
  // A count Claude reported itself (Cowork modelUsage) is used as reported.
  const reported = live("claude", "claude-opus-5-5");
  reported.attempt.tokens.output_total = providerMeasurement("433");
  assert.equal((await output(reported)).inputs.output_tokens, "433");
});

test("Claude token factor is part of the method: a method without it keeps the tokenizer's count", async () => {
  const { claude_token_factor: _factor, ...earlier } = media;
  const before = createMethodRegistry(configuration, mappings, earlier);
  assert.notEqual(before.ecologits.method_hash, methods.ecologits.method_hash);
  assert.notEqual(before.ecologits.method_id, methods.ecologits.method_id);
  const result = await new LocalEstimateExecutor(before).estimate(live("claude", "claude-opus-5-5"), {
    methodId: before.ecologits.method_id,
  });
  assert.equal(result.components[0]!.inputs.output_tokens, "500");
});
