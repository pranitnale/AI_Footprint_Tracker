import assert from "node:assert/strict";
import test from "node:test";
import {
  AttemptObservationSchema,
  EstimationEnvelopeSchema,
  HistoryMessageSchema,
  RequestObservationSchema,
  composeOutputTotal,
  emptyAttemptMedia,
  emptyGeneration,
  historyResponseParts,
  emptyRequestMedia,
  emptyTokenFields,
  unknownMeasurement,
  type ComponentResult,
  type Generation,
  type ProductMetric,
  type Site,
  type TokenMeasurement,
} from "@footprint/contracts";
import * as core from "@footprint/ecologits-core";
import { pythonReference } from "../../../tools/python-reference.cjs";
import configuration from "../../../config/estimation.build.json";
import mappings from "../../../config/estimation.mappings.json";
import media from "../../../config/estimation.media.json";
import { createMethodRegistry, LocalEstimateExecutor } from "../src/index";
import { serializeEcoLogitsOutput } from "../src/engines/projection";

const methods = createMethodRegistry(configuration, mappings, media);
const executor = new LocalEstimateExecutor(methods);
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const measurement = (value: string): TokenMeasurement => ({
  value,
  evidence: "heuristic_estimate",
  scope: "observed_text",
  completeness: "complete_for_scope",
  profile_id: "o200k-base-4.0.0-reference",
  reason: "tokenizer_mapping_unverified",
});

/** A completed reply whose only generated text is the answer; other parts are measured zero. */
function live(
  site: Site,
  model: string | null,
  answer: string,
  generation: Generation,
) {
  const tokens = {
    ...emptyTokenFields(),
    answer_output: measurement(answer),
    visible_thinking: measurement("0"),
    tool_input: measurement("0"),
    intermediate_output: measurement("0"),
  };
  tokens.output_total = composeOutputTotal(tokens);
  const request = RequestObservationSchema.parse({
    schema_version: "3.0.0",
    kind: "request",
    request_id: id(1),
    revision: 1,
    conversation_key: "a".repeat(64),
    key_version: "1",
    provider_request_key: null,
    site,
    adapter_version: "0.1.0",
    action: "send",
    dispatched_at: "2026-10-04T12:00:00.000Z",
    ended_at: "2026-10-04T12:00:09.000Z",
    state: "completed",
    model_id: model,
    model_evidence: model === null ? "unknown" : "response_field",
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
  const attempt = AttemptObservationSchema.parse({
    schema_version: "3.0.0",
    kind: "attempt",
    attempt_id: id(2),
    request_id: id(1),
    revision: 1,
    provider_attempt_key: null,
    key_version: "1",
    started_at: request.dispatched_at,
    ended_at: request.ended_at,
    timing: null,
    state: "completed",
    execution_evidence: "content_observed",
    model_id: model,
    model_evidence: request.model_evidence,
    tokens,
    media: emptyAttemptMedia(),
    generation,
    coverage_reasons: [],
    tokenizer_profile_id: null,
    tokenizer_asset_hash: null,
    proposed_method_id: methods.ecologits.method_id,
    company_dedup_key: null,
  });
  return { family: "live" as const, request, attempt };
}

const estimate = async (input: Parameters<typeof executor.estimate>[0]) => {
  const result = await executor.estimate(input, {
    methodId: methods.ecologits.method_id,
  });
  EstimationEnvelopeSchema.parse(result);
  return result;
};
const component = (components: readonly ComponentResult[], id: string) => {
  const found = components.find((item) => item.component_id === id);
  assert.ok(found, id);
  return found;
};
const close = (actual: string | null, expected: number, label = "") => {
  assert.notEqual(actual, null, label);
  assert.ok(
    Math.abs(Number(actual) - expected) <= Math.abs(expected) * 1e-12,
    `${label}: ${actual} != ${expected}`,
  );
};
const low = (metric: ProductMetric) => Number(metric.scenario_low ?? metric.value);
const high = (metric: ProductMetric) =>
  Number(metric.scenario_high ?? metric.value);
const environment = (provider: string) => {
  const config = core.catalog.provider_configurations[provider]!;
  return core.electricityInput(
    core.findElectricityMix(config.datacenter_location)!,
    config,
  );
};

test("D1 images use 2.907 Wh per image times the provider PUE with the EcoLogits water rule", async () => {
  const result = await estimate(
    live("chatgpt", "chatgpt-gpt-5-5", "120", {
      text_components: [],
      media: [
        {
          kind: "image",
          model_id: "chatgpt-images-2-5",
          count: "2",
          width: 1024,
          height: 1536,
          outcome: "returned",
        },
      ],
    }),
  );
  assert.equal(result.status, "estimated");
  assert.deepEqual(
    result.components.map((item) => [item.component_id, item.role, item.kind]),
    [
      ["text_0", "main", "text"],
      ["image_0", "generated_image", "image"],
    ],
  );
  const image = component(result.components, "image_0");
  assert.equal(image.method_id, "image-luccioni-2024-mean-v1");
  assert.equal(image.status, "estimated");
  assert.equal(image.selection, null);
  assert.equal(image.inputs.units, "2");
  assert.equal(image.inputs.environment_provider, "openai");
  assert.equal(image.inputs.electricity_mix_zone, "USA");
  assert.equal(image.metrics.energy.scope, "modeled_image_component");
  // Hand calculation: OpenAI PUE 1.2, USA grid 0.3844 kgCO2e/kWh and 3.1321 L/kWh, WUE 0.569.
  const it = (2 * 2.907) / 1000;
  close(image.metrics.energy.value, it * 1.2, "energy");
  close(image.metrics.carbon.value, it * 1.2 * 0.3844 * 1000, "carbon");
  close(image.metrics.water_total.value, it * (0.569 + 1.2 * 3.1321), "water");
  assert.equal(image.metrics.water_direct.value, null);
  // The documented figure per OpenAI image: about 3.49 Wh.
  close(String(Number(image.metrics.energy.value) / 2), 0.0034884, "per image");
  const text = component(result.components, "text_0");
  for (const name of ["energy", "carbon", "water_total"] as const) {
    assert.ok(
      Math.abs(
        low(result.metrics[name]) -
          (low(text.metrics[name]) + low(image.metrics[name])),
      ) <= 1e-15 + low(result.metrics[name]) * 1e-12,
      name,
    );
    assert.ok(
      Math.abs(
        high(result.metrics[name]) -
          (high(text.metrics[name]) + high(image.metrics[name])),
      ) <= 1e-15 + high(result.metrics[name]) * 1e-12,
      name,
    );
  }
});

test("D1 image providers follow the named model, else the site, with Google at about 3.17 Wh", async () => {
  for (const [site, model, provider, perImage] of [
    ["gemini", "gemini-nano-banana-2", "google_genai", 0.00316863],
    ["perplexity", "perplexity-nano-banana-pro", "google_genai", 0.00316863],
    ["perplexity", null, "openai", 0.0034884],
    ["notebooklm", "notebooklm-image", "google_genai", 0.00316863],
  ] as const) {
    const result = await estimate(
      live(site, null, "40", {
        text_components: [],
        media: [
          {
            kind: "image",
            model_id: model,
            count: "1",
            width: null,
            height: null,
            outcome: "returned",
          },
        ],
      }),
    );
    const image = component(result.components, "image_0");
    assert.equal(image.inputs.environment_provider, provider, site);
    close(image.metrics.energy.value, perImage, `${site} ${model}`);
  }
  // A stopped job that visibly started counts as one image.
  const stopped = await estimate(
    live("chatgpt", "chatgpt-gpt-5-5", "0", {
      text_components: [],
      media: [
        {
          kind: "image",
          model_id: null,
          count: "1",
          width: null,
          height: null,
          outcome: "started_not_returned",
        },
      ],
    }),
  );
  assert.deepEqual(
    stopped.components.map((item) => item.component_id),
    ["image_0"],
  );
  close(stopped.metrics.energy.value, 0.0034884, "stopped image");
  assert.equal(stopped.status, "estimated");
  assert.equal(stopped.raw, null);
});

test("D4 speech: 55 characters at 17 per second give 65 audio tokens on the OpenAI environment", async () => {
  const result = await estimate(
    live("chatgpt", "chatgpt-voice-bidi", "14", {
      text_components: [],
      media: [
        {
          kind: "speech",
          length_basis: "characters",
          seconds: null,
          characters: "55",
        },
      ],
    }),
  );
  const speech = component(result.components, "speech_0");
  assert.equal(speech.method_id, "speech-tts-audio-tokens-v1");
  assert.equal(speech.role, "generated_speech");
  assert.equal(speech.inputs.output_tokens, "65");
  close(speech.inputs.audio_seconds, 55 / 17, "seconds");
  assert.equal(speech.inputs.environment_provider, "openai");
  assert.deepEqual(speech.selection, {
    kind: "model_override",
    observed_model_id: null,
    profile: { provider: "openai", model_name: "gpt-4o-mini-tts", workload: "text" },
    reason: "model_proxy",
    basis: "model_not_named",
  });
  assert.ok(speech.reasons.includes("speech_length_estimated"));
  assert.deepEqual(
    speech.raw,
    serializeEcoLogitsOutput(
      core.llmImpacts({
        provider: "openai",
        model_name: "gpt-4o-mini-tts",
        output_token_count: 65,
        request_latency: null,
      }),
    ),
  );
  // About 0.007 Wh at the upper end (own calculation in the reference).
  assert.ok(high(speech.metrics.energy) > 0.0000070);
  assert.ok(high(speech.metrics.energy) < 0.0000075);
});

test("D4 speech on Google and Anthropic sites keeps their rate and data-centre configuration", async () => {
  for (const [site, seconds, rate, provider] of [
    ["gemini", "394.24", 25, "google_genai"],
    ["claude", "24.6", 20, "anthropic"],
  ] as const) {
    const result = await estimate(
      live(site, null, "10", {
        text_components: [],
        media: [
          {
            kind: "speech",
            length_basis: "stored_length",
            seconds,
            characters: null,
          },
        ],
      }),
    );
    const speech = component(result.components, "speech_0");
    const tokens = Math.floor(Number(seconds) * rate + 0.5);
    assert.equal(speech.inputs.output_tokens, String(tokens), site);
    assert.equal(speech.inputs.environment_provider, provider);
    assert.ok(!speech.reasons.includes("speech_length_estimated"));
    const resolved = core.resolveLlmInput({
      provider: "openai",
      model_name: "gpt-4o-mini-tts",
      output_token_count: tokens,
      request_latency: null,
    });
    assert.ok("input" in resolved);
    const expected = core.output(
      core.computeLlmImpacts({ ...resolved.input, ...environment(provider) }),
      resolved.model.warnings,
    );
    assert.deepEqual(speech.raw, serializeEcoLogitsOutput(expected), site);
  }
});

test("D3 video P6: Perplexity veo3_fast without page values uses 720p, 8 s and no audio", async () => {
  const result = await estimate(
    live("perplexity", "perplexity-best", "60", {
      text_components: [],
      media: [
        {
          kind: "video",
          model_id: "perplexity-veo-3-0-fast",
          width: null,
          height: null,
          duration_seconds: null,
          with_audio: null,
        },
      ],
    }),
  );
  const video = component(result.components, "video_0");
  assert.equal(video.method_id, "ecologits-video-0-11");
  assert.deepEqual(video.selection, {
    kind: "direct_mapping",
    observed_model_id: "perplexity-veo-3-0-fast",
    profile: { provider: "google", model_name: "google/veo-3.0-fast", workload: "video" },
    reason: null,
    basis: "exact_record",
  });
  assert.equal(video.inputs.width, 1280);
  assert.equal(video.inputs.height, 720);
  assert.equal(video.inputs.duration_seconds, "8");
  assert.equal(video.inputs.with_audio, false);
  assert.deepEqual(video.inputs.defaults_applied, ["resolution", "duration", "audio"]);
  assert.ok(video.reasons.includes("media_default_assumed"));
  const expected = core.videoImpacts({
    model_name: "google/veo-3.0-fast",
    resolution: "1280x720",
    duration: 8,
    with_audio: false,
    datacenter_location: null,
  });
  assert.deepEqual(video.raw, serializeEcoLogitsOutput(expected));
  // 12.9 to 28.3 Wh in the reference (own calculation).
  assert.equal(Math.round(low(video.metrics.energy) * 1e5) / 100, 12.91);
  assert.equal(Math.round(high(video.metrics.energy) * 1e5) / 100, 28.29);
});

test("D3 video G3: Gemini Omni stands in as veo-3.1 at the stored size and 10 s with audio, plus the storyboard", async () => {
  const result = await estimate(
    live("gemini", "gemini-omni", "0", {
      text_components: [
        {
          role: "storyboard",
          model_id: null,
          model_evidence: "unknown",
          tokens: measurement("954"),
          timing: null,
        },
      ],
      media: [
        {
          kind: "video",
          model_id: "gemini-omni-video",
          width: 1280,
          height: 720,
          duration_seconds: "10",
          with_audio: null,
        },
      ],
    }),
  );
  assert.deepEqual(
    result.components.map((item) => [item.component_id, item.role]),
    [
      ["text_1", "storyboard"],
      ["video_0", "generated_video"],
    ],
  );
  const video = component(result.components, "video_0");
  assert.equal(video.selection?.kind, "model_override");
  assert.equal(video.selection?.basis, "model_not_in_library");
  assert.equal(video.selection?.profile?.model_name, "google/veo-3.1");
  assert.deepEqual(video.inputs.defaults_applied, ["audio"]);
  assert.equal(video.inputs.with_audio, true);
  assert.equal(Math.round(low(video.metrics.energy) * 1e5) / 100, 32.57);
  assert.equal(Math.round(high(video.metrics.energy) * 1e5) / 100, 71.34);
  const storyboard = component(result.components, "text_1");
  // The page names no model for the storyboard, so the Google family benchmark applies.
  assert.equal(storyboard.selection?.kind, "provider_flagship");
  assert.equal(storyboard.selection?.basis, "model_not_named");
  assert.equal(storyboard.selection?.profile?.model_name, "gemini-3.8-flash");
  assert.equal(storyboard.inputs.output_tokens, "954");
  // 3.4 to 5.8 Wh in the reference (EP2, own calculation).
  assert.equal(Math.round(low(storyboard.metrics.energy) * 1e4) / 10, 3.4);
  assert.equal(Math.round(high(storyboard.metrics.energy) * 1e4) / 10, 5.8);
  // Ranges add endpoint by endpoint.
  close(
    String(low(result.metrics.energy)),
    low(video.metrics.energy) + low(storyboard.metrics.energy),
    "low",
  );
  close(
    String(high(result.metrics.energy)),
    high(video.metrics.energy) + high(storyboard.metrics.energy),
    "high",
  );
  assert.equal(result.raw, null);
  assert.ok(!result.reasons.includes("component_unavailable"));
});

test("D5 NotebookLM Video Overview: 86.83 s gives 9 illustrations and 2,171 narration tokens", async () => {
  const record = HistoryMessageSchema.parse({
    schema_version: "3.0.0",
    kind: "history_message",
    message_key: "d".repeat(64),
    role: "response",
    conversation_key: "c".repeat(64),
    key_version: "1",
    site: "notebooklm",
    parent_key: null,
    prompt_key: null,
    provider_request_key: null,
    provider_attempt_key: null,
    occurred_at: "2026-10-03T10:00:00.000Z",
    date_basis: "message_created",
    observed_at: "2026-10-04T10:00:00.000Z",
    proposed_method_id: methods.ecologits.method_id,
    proposed_method_hash: methods.ecologits.method_hash,
    model_id: "notebooklm-default",
    tokens: measurement("0"),
    inline_file_text: null,
    parts: historyResponseParts(measurement("0")),
    generation: {
      text_components: [],
      media: [{ kind: "video_overview", duration_seconds: "86.83" }],
    },
    text_complete: true,
    timing: null,
    // Every NotebookLM saved row is a Studio item without a live request (W9).
    coverage_reasons: ["history_only", "no_live_request"],
    company_dedup_key: null,
  });
  const result = await estimate({ family: "history", record });
  assert.deepEqual(
    result.components.map((item) => [item.component_id, item.role, item.kind]),
    [
      ["image_0", "overview_illustrations", "image"],
      ["speech_0", "overview_narration", "speech"],
    ],
  );
  const illustrations = component(result.components, "image_0");
  assert.equal(illustrations.inputs.units, "9");
  assert.equal(illustrations.inputs.environment_provider, "google_genai");
  // 9 x 3.17 Wh = 28.5 Wh (own calculation in the reference).
  close(illustrations.metrics.energy.value, 9 * 0.002907 * 1.09, "illustrations");
  const narration = component(result.components, "speech_0");
  assert.equal(narration.inputs.output_tokens, "2171");
  assert.equal(narration.inputs.environment_provider, "google_genai");
  assert.ok(narration.reasons.includes("history_only"));
  assert.ok(high(narration.metrics.energy) < 0.000224);
  assert.equal(result.status, "estimated");
});

const unnamedVideo = {
  kind: "video" as const,
  model_id: null,
  width: 1280,
  height: 720,
  duration_seconds: "8",
  with_audio: true,
};

test("a video without a named model uses the site's stand-in and says so", async () => {
  const unnamed = await estimate(
    live("gemini", "gemini-3-8-flash", "200", {
      text_components: [],
      media: [unnamedVideo],
    }),
  );
  const named = await estimate(
    live("gemini", "gemini-3-8-flash", "200", {
      text_components: [],
      media: [{ ...unnamedVideo, model_id: "gemini-omni-video" }],
    }),
  );
  const video = component(unnamed.components, "video_0");
  assert.equal(video.status, "estimated");
  assert.deepEqual(video.selection, {
    kind: "model_override",
    observed_model_id: null,
    profile: { provider: "google", model_name: "google/veo-3.1", workload: "video" },
    reason: "model_proxy",
    basis: "model_not_named",
  });
  assert.deepEqual(video.inputs.defaults_applied, ["model"]);
  assert.ok(video.reasons.includes("model_proxy"));
  assert.ok(video.reasons.includes("media_default_assumed"));
  // The same figures as the named stand-in: about 27.7 to 60.6 Wh (own calculation).
  // Only the reasons differ, as the unnamed model is a default the reply did not show.
  const figures = (metrics: ComponentResult["metrics"]) =>
    Object.values(metrics).map(({ reasons: _reasons, ...metric }) => metric);
  assert.deepEqual(
    figures(video.metrics),
    figures(component(named.components, "video_0").metrics),
  );
  assert.equal(Math.round(low(video.metrics.energy) * 1e4) / 10, 27.7);
  assert.equal(Math.round(high(video.metrics.energy) * 1e4) / 10, 60.6);
  assert.ok(!unnamed.reasons.includes("component_unavailable"));
});

test("a media-only reply reports only the stand-ins its own components used", async () => {
  const result = await estimate(
    live("perplexity", "perplexity-best", "0", {
      text_components: [],
      media: [
        {
          kind: "image",
          model_id: null,
          count: "1",
          width: 1024,
          height: 1024,
          outcome: "returned",
        },
      ],
    }),
  );
  assert.deepEqual(
    result.components.map((item) => item.component_id),
    ["image_0"],
  );
  // The reply's own model is a stand-in, but no text was estimated with it.
  assert.equal(result.selection.reason, "model_proxy");
  assert.ok(!result.reasons.includes("model_proxy"));
  // An unavailable text count does not report its stand-in either.
  const blank = live("perplexity", "perplexity-unlisted", "1", {
    text_components: [],
    media: [
      {
        kind: "image",
        model_id: null,
        count: "1",
        width: null,
        height: null,
        outcome: "returned",
      },
    ],
  });
  for (const part of [
    "answer_output",
    "visible_thinking",
    "tool_input",
    "intermediate_output",
  ] as const)
    blank.attempt.tokens[part] = unknownMeasurement("tokenizer_unavailable");
  blank.attempt.tokens.output_total = composeOutputTotal(blank.attempt.tokens);
  const unknownText = await estimate(blank);
  assert.equal(component(unknownText.components, "text_0").status, "unavailable");
  assert.ok(component(unknownText.components, "text_0").reasons.includes("model_proxy"));
  assert.ok(!unknownText.reasons.includes("model_proxy"));
  const text = await estimate(
    live("perplexity", "perplexity-best", "60", emptyGeneration()),
  );
  assert.ok(text.reasons.includes("model_proxy"));
  assert.ok(component(text.components, "text_0").reasons.includes("model_proxy"));
});

test("top-level metrics and raw output must match the components", async () => {
  // An image-only reply has point estimates only. Its total is a range of zero width, so it
  // adds to ranged replies endpoint by endpoint; a forged total passes every metric rule.
  const imageOnly = await estimate(
    live("perplexity", "perplexity-best", "0", {
      text_components: [],
      media: [
        {
          kind: "image",
          model_id: null,
          count: "1",
          width: null,
          height: null,
          outcome: "returned",
        },
      ],
    }),
  );
  assert.equal(imageOnly.metrics.energy.value_kind, "midpoint");
  assert.equal(imageOnly.metrics.energy.scenario_low, imageOnly.metrics.energy.value);
  assert.equal(imageOnly.metrics.energy.scenario_high, imageOnly.metrics.energy.value);
  const forged = structuredClone(imageOnly) as any;
  forged.metrics.energy.value = "999";
  // A consistent range that is twice the component range.
  const ranged = await estimate(
    live("gemini", "gemini-3-8-flash", "200", {
      text_components: [],
      media: [unnamedVideo],
    }),
  );
  const doubled = structuredClone(ranged) as any;
  for (const key of ["value", "scenario_low", "scenario_high"])
    doubled.metrics.energy[key] = String(Number(doubled.metrics.energy[key]) * 2);
  // An EcoLogits total with its components removed has nothing to add up.
  const stripped = structuredClone(ranged) as any;
  stripped.components = [];
  // The top-level raw output is the main text's; dropping or swapping it is rejected.
  assert.notEqual(ranged.raw, null);
  const rawless = structuredClone(ranged) as any;
  rawless.raw = null;
  const other = await estimate(
    live("gemini", "gemini-3-8-flash", "300", emptyGeneration()),
  );
  const swapped = structuredClone(ranged) as any;
  swapped.raw = structuredClone(other.raw);
  // A second text component adds nothing when unavailable, but only one is the reply's own.
  const extra = (role: string) => {
    const value = structuredClone(ranged) as any;
    const copy = structuredClone(
      value.components.find((item: any) => item.role === "main"),
    );
    copy.component_id = "text_9";
    copy.role = role;
    copy.status = "unavailable";
    for (const metric of Object.values(copy.metrics) as any[])
      Object.assign(metric, {
        value: null,
        status: "unavailable",
        value_kind: "unavailable",
        scenario_low: null,
        scenario_high: null,
        interval_kind: null,
      });
    value.components.push(copy);
    return value;
  };
  const cases = [
    [imageOnly, true],
    [forged, false],
    [ranged, true],
    [doubled, false],
    [stripped, false],
    [rawless, false],
    [swapped, false],
    [extra("side_calls"), true],
    [extra("main"), false],
  ] as const;
  for (const [value, valid] of cases)
    assert.equal(EstimationEnvelopeSchema.safeParse(value).success, valid);
  const code = [
    "import json,sys",
    "from estimation_contracts import validate_estimation_envelope",
    "from footprint_contracts import ContractError",
    "out=[]",
    "for value in json.load(sys.stdin):",
    "  try:",
    "    validate_estimation_envelope(value)",
    "    out.append(True)",
    "  except ContractError:",
    "    out.append(False)",
    "print(json.dumps(out))",
  ].join("\n");
  const run = pythonReference(["-c", code], {
    input: JSON.stringify(cases.map(([value]) => value)),
  });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(
    JSON.parse(run.stdout),
    cases.map(([, valid]) => valid),
  );
});

test("an unavailable component is named and never dropped silently", async () => {
  // ChatGPT has no video stand-in, so a video it shows without a model cannot be estimated.
  const result = await estimate(
    live("chatgpt", "chatgpt-gpt-5-5", "200", {
      text_components: [],
      media: [unnamedVideo],
    }),
  );
  const video = component(result.components, "video_0");
  assert.equal(video.status, "unavailable");
  assert.equal(video.metrics.energy.value, null);
  assert.ok(result.reasons.includes("component_unavailable"));
  const text = component(result.components, "text_0");
  // The total is the estimated text alone, marked as partial by the reason above.
  assert.equal(result.metrics.energy.value, text.metrics.energy.value);
  assert.equal(result.status, "estimated");
});

test("media coefficients are bound into the EcoLogits method hash", () => {
  const changed = createMethodRegistry(configuration, mappings, {
    ...media,
    image: { ...media.image, it_energy_wh_per_image: "2.908" },
  });
  assert.notEqual(changed.ecologits.method_hash, methods.ecologits.method_hash);
  assert.notEqual(
    changed.ecologits.profile_policy_hash,
    methods.ecologits.profile_policy_hash,
  );
  assert.throws(() =>
    createMethodRegistry(configuration, mappings, {
      ...media,
      image: { ...media.image, it_energy_wh_per_image: "-1" },
    }),
  );
});

test("D1 image figures and input hashes stay the same after the image benchmark data was removed", async () => {
  // Pinned on main (71685720) before the bundled ML.ENERGY image figures were removed on
  // 20 October 2026. They were a reference outside the totals, and estimates keep naming the
  // retired data's identity, so every figure and input hash is unchanged; only
  // image_references, which held a GPU energy reference here, is now empty.
  const input = live("chatgpt", "chatgpt-gpt-5-5", "120", {
    text_components: [],
    media: [
      {
        kind: "image",
        model_id: "chatgpt-images-2-5",
        count: "2",
        width: 1024,
        height: 1024,
        outcome: "returned",
      },
    ],
  });
  const settings = {
    width: 1024,
    height: 1024,
    steps: 50,
    precision: "bfloat16" as const,
    architecture: "diffusion" as const,
  };
  const observed = {
    ...input,
    attempt: AttemptObservationSchema.parse({
      ...input.attempt,
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
    }),
  };
  const figures = (metrics: Record<string, ProductMetric>) =>
    Object.fromEntries(
      Object.entries(metrics).map(([name, metric]) => [
        name,
        [metric.value, metric.scenario_low, metric.scenario_high],
      ]),
    );
  const none = [null, null, null];
  const result = await estimate(observed);
  assert.equal(
    result.input_hash,
    "06416eb783fbf84e97091749030c8e9b546fee61051e1f53cda0955fea6dbf8c",
  );
  assert.deepEqual(figures(result.metrics), {
    energy: ["0.007793041258604229", "0.00751753604348263", "0.008068546473725829"],
    carbon: ["2.995645059807466", "2.8897408551147232", "3.101549264500209"],
    water_direct: none,
    water_upstream: none,
    water_total: ["0.02810378492286248", "0.027110239649076627", "0.029097330196648334"],
  });
  assert.deepEqual(figures(component(result.components, "image_0").metrics), {
    energy: ["0.006976799999999999", null, null],
    carbon: ["2.68188192", null, null],
    water_direct: none,
    water_upstream: none,
    water_total: ["0.02516020128", null, null],
  });
  assert.deepEqual(result.image_references, []);
  const original = await executor.estimate(observed, {
    methodId: methods.original.method_id,
  });
  EstimationEnvelopeSchema.parse(original);
  assert.equal(
    original.input_hash,
    "3bfa6a3e950cf1eb66299a788cd39e2ce67bc5e830f3bdc46930b99f78921e05",
  );
  assert.deepEqual(figures(original.metrics), {
    energy: ["0.000093361070985012", null, null],
    carbon: ["0.035887995686638597", null, null],
    water_direct: ["0.000085566706343144", null, null],
    water_upstream: ["0.000292416210432156", null, null],
    water_total: none,
  });
  assert.deepEqual(original.image_references, []);
  assert.deepEqual(
    (original.raw?.result as unknown as { image_references?: unknown })
      .image_references,
    [],
  );
});
