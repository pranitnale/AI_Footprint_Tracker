import assert from "node:assert/strict";
import test from "node:test";
import { MODEL_IDS } from "@footprint/contracts";
import { catalog, findModel, findVideoModel } from "@footprint/ecologits-core";
import configuration from "../../../config/estimation.build.json";
import mappings from "../../../config/estimation.mappings.json";
import media from "../../../config/estimation.media.json";
import { createMethodRegistry } from "../src/index";

const methods = createMethodRegistry(configuration, mappings, media);
const FAMILIES = new Set(["openai", "anthropic", "google_genai"]);

// Records of the three families that the consumer apps do not offer under their own name.
// A record that becomes reachable from a site must move out of this list (D6).
const NOT_OFFERED: Readonly<Record<string, string>> = {
  "openai/gpt-3.5-turbo-instruct": "API completion model",
  "openai/gpt-35-turbo": "Azure name of gpt-3.5-turbo",
  "openai/gpt-35-turbo-16k": "Azure name of an API snapshot",
  "openai/gpt-35-turbo-instruct": "Azure name of an API completion model",
  "openai/gpt-3.5-turbo-16k": "API snapshot",
  "openai/gpt-4-turbo": "API name; ChatGPT labelled it gpt-4",
  "openai/gpt-4.1-nano": "API only",
  "openai/gpt-4o-mini-search-preview": "API search model",
  "openai/gpt-4o-search-preview": "API search model",
  "openai/gpt-4o-mini-transcribe": "speech input model, not generated output",
  "openai/gpt-5-chat-latest":
    "API alias of the ChatGPT instant model (B4 maps instant to gpt-5)",
  "openai/gpt-5.1-chat-latest": "API alias of the ChatGPT instant model",
  "openai/gpt-5.2-chat-latest": "API alias of the ChatGPT instant model",
  "openai/gpt-5.3-chat-latest": "API alias of the ChatGPT instant model",
  "openai/gpt-5-codex": "Codex model, outside the browser apps (E9)",
  "openai/gpt-5.1-codex": "Codex model, outside the browser apps (E9)",
  "openai/gpt-5.1-codex-max": "Codex model, outside the browser apps (E9)",
  "openai/gpt-5.1-codex-mini": "Codex model, outside the browser apps (E9)",
  "openai/gpt-5.2-codex": "Codex model, outside the browser apps (E9)",
  // gpt-5.3-codex, gpt-5.4-nano, gemini-3-pro-image-preview and gemini-3.1-flash-image-preview
  // stand in for unknown variants (owner decision of 14 October 2026), so they are reachable.
  "openai/gpt-5-search-api": "API search model",
  "openai/o4-mini-deep-research":
    "API research model; Deep Research names its own model (E1)",
  "google_genai/gemini-2.5-flash-image":
    "image model; images use the image method (D1)",
  "google_genai/gemini-3.1-flash-lite":
    "not in the Gemini app pickers seen on 1 Oct",
  "google_genai/gemini-3.1-flash-lite-preview": "API preview",
  "google_genai/gemini-3.1-pro-preview-customtools": "API variant",
  "google_genai/gemini-flash-latest": "API alias",
  "google_genai/gemini-flash-lite-latest": "API alias",
  "google_genai/gemini-pro-latest": "API alias",
  "google_genai/gemma-4-26b-a4b-it": "open model, not in the Gemini app",
  "google_genai/gemma-4-31b-it": "open model, not in the Gemini app",
};
// A dated snapshot is covered by its undated record.
const dated = (name: string) =>
  name.replace(/-(?:\d{4}-\d{2}-\d{2}|\d{4}|\d{8})$/, "");

function usedRecords(): Set<string> {
  const used = new Set<string>();
  const fallback = methods.ecoDefinition.fallback;
  for (const profile of Object.values(methods.mappings.bindings))
    used.add(`${profile.provider}/${profile.model_name}`);
  for (const override of Object.values(fallback.model_overrides))
    if (override.strategy === "upstream_profile")
      used.add(`${override.profile.provider}/${override.profile.model_name}`);
  for (const fallbackProfile of [
    ...Object.values(fallback.provider_defaults),
    fallback.unknown_provider,
  ])
    if (fallbackProfile.strategy === "upstream_provider_flagship")
      used.add(
        `${fallbackProfile.profile.provider}/${fallbackProfile.profile.model_name}`,
      );
  // The speech method's stand-in for every vendor (B6).
  used.add(
    `${methods.media.speech.profile.provider}/${methods.media.speech.profile.model_name}`,
  );
  return used;
}

test("D6 every OpenAI, Anthropic and Google record is reachable or listed as not offered", () => {
  const used = usedRecords();
  const missing: string[] = [];
  const both: string[] = [];
  for (const model of catalog.models) {
    if (!FAMILIES.has(model.provider)) continue;
    const key = `${model.provider}/${model.name}`;
    const base = `${model.provider}/${dated(model.name)}`;
    const reachable = used.has(key) || (base !== key && used.has(base));
    const listed =
      Object.hasOwn(NOT_OFFERED, key) ||
      (base !== key && Object.hasOwn(NOT_OFFERED, base));
    if (!reachable && !listed) missing.push(key);
    if (used.has(key) && Object.hasOwn(NOT_OFFERED, key)) both.push(key);
  }
  assert.deepEqual(
    missing,
    [],
    "bind these records or list them as not offered",
  );
  assert.deepEqual(
    both,
    [],
    "reachable records must leave the not-offered list",
  );
  for (const key of Object.keys(NOT_OFFERED)) {
    const [provider, name] = key.split("/") as [string, string];
    assert.ok(findModel(provider, name), `stale not-offered entry ${key}`);
  }
});

test("D6 every binding and stand-in names an existing record of its workload", () => {
  const fallback = methods.ecoDefinition.fallback;
  const profiles = [
    ...Object.entries(methods.mappings.bindings),
    ...Object.entries(fallback.model_overrides).flatMap(([id, override]) =>
      override.strategy === "upstream_profile"
        ? [[id, override.profile] as const]
        : [],
    ),
  ];
  for (const [id, profile] of profiles) {
    assert.ok((MODEL_IDS as readonly string[]).includes(id), id);
    if (profile.workload === "video")
      assert.equal(
        findVideoModel(profile.model_name)?.provider,
        profile.provider,
        id,
      );
    else assert.ok(findModel(profile.provider, profile.model_name), id);
  }
  // A stand-in always says why it stands in; exact records are bindings, not overrides.
  for (const [id, override] of Object.entries(fallback.model_overrides))
    if (override.strategy === "upstream_profile")
      assert.notEqual(override.basis, "exact_record", id);
});

test("an id estimated with a Gemini image record is credited to Google by the image method", () => {
  // Owner decision of 14 October 2026: Nano Banana Pro is Gemini 3 Pro Image. Its text and
  // its images must name the same vendor, as for the Gemini image variants.
  const fallback = methods.ecoDefinition.fallback;
  const imageIds = [
    ...Object.entries(methods.mappings.bindings),
    ...Object.entries(fallback.model_overrides).flatMap(([id, override]) =>
      override.strategy === "upstream_profile"
        ? [[id, override.profile] as const]
        : [],
    ),
  ]
    .filter(
      ([, profile]) =>
        profile.provider === "google_genai" &&
        /-image(?:-|$)/.test(profile.model_name),
    )
    .map(([id]) => id);
  for (const id of ["gemini-nano-banana-pro", "perplexity-nano-banana-pro"])
    assert.ok(imageIds.includes(id), id);
  for (const id of imageIds)
    assert.equal(methods.media.image.model_providers[id], "google_genai", id);
});

test("B2 family benchmarks replace the provider defaults", () => {
  const fallback = methods.ecoDefinition.fallback;
  const benchmark = (provider: string) => {
    const value = fallback.provider_defaults[provider];
    return value?.strategy === "upstream_provider_flagship"
      ? value.profile.model_name
      : null;
  };
  assert.equal(benchmark("openai"), "gpt-6.1-sol");
  assert.equal(benchmark("anthropic"), "claude-opus-5-5");
  assert.equal(benchmark("google_genai"), "gemini-3.8-flash");
  assert.equal(
    fallback.unknown_provider.strategy === "upstream_provider_flagship"
      ? fallback.unknown_provider.profile.model_name
      : null,
    "gpt-6.1-sol",
  );
});

test("D3 each site's stand-in for an unnamed video model is a video record", () => {
  const fallback = methods.ecoDefinition.fallback;
  const entries = Object.entries(methods.media.video.site_models);
  assert.deepEqual(entries.map(([site]) => site).sort(), [
    "gemini",
    "perplexity",
  ]);
  for (const [site, id] of entries) {
    assert.ok((MODEL_IDS as readonly string[]).includes(id!), site);
    const override = fallback.model_overrides[id!];
    const profile =
      override?.strategy === "upstream_profile"
        ? override.profile
        : methods.mappings.bindings[id!];
    assert.equal(profile?.workload, "video", site);
    assert.equal(
      findVideoModel(profile!.model_name)?.provider,
      profile!.provider,
      site,
    );
  }
});
