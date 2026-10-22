import assert from "node:assert/strict";
import test from "node:test";
import { MODEL_IDS } from "@footprint/contracts";
import * as core from "@footprint/ecologits-core";
import configuration from "../../../config/estimation.build.json";
import mappings from "../../../config/estimation.mappings.json";
import media from "../../../config/estimation.media.json";
import {
  FAMILY_STAND_IN_BASIS,
  KIND_STAND_IN_BASIS,
  MODEL_FAMILIES,
  MODEL_VARIANTS,
  VARIANT_STAND_IN_BASIS,
  familyStandIn,
  familyStandInOverrides,
  standInIds,
  standInOverrides,
  variantStandIn,
} from "../src/family-stand-ins";
import { createMethodRegistry, resolveModelProfile } from "../src/index";

const methods = createMethodRegistry(configuration, mappings, media);
const fallback = methods.ecoDefinition.fallback;
const catalog = {
  has: (profile: { provider: string; model_name: string }) =>
    core.findModel(profile.provider, profile.model_name) !== null,
};
const resolve = (modelId: string | null, provider: string | null) =>
  resolveModelProfile(
    { modelId, provider, workload: "text" },
    methods.mappings.bindings,
    fallback,
    catalog,
  );

// Owner decision of 13 October 2026, computed from the EcoLogits 0.11.3 catalog.
const TODAY: Record<string, string> = {
  "claude-haiku": "anthropic/claude-haiku-5-5",
  "claude-sonnet": "anthropic/claude-sonnet-5-5",
  "claude-opus": "anthropic/claude-opus-5-5",
  "claude-fable": "anthropic/claude-fable-5-1",
  "gpt-sol": "openai/gpt-6.1-sol",
  "gpt-astra": "openai/gpt-6-astra",
  "gpt-luna": "openai/gpt-6-luna",
  "gpt-terra": "openai/gpt-5.6-terra",
  "gemini-flash": "google_genai/gemini-3.8-flash",
  "gemini-flash-lite": "google_genai/gemini-3.5-flash-lite",
  "gemini-pro": "google_genai/gemini-3.1-pro-preview",
};

test("FS1 the build configuration holds the family stand-ins the catalog gives", () => {
  const expected = familyStandInOverrides(core.catalog.models);
  const familyIds = MODEL_FAMILIES.flatMap((family) => family.ids);
  assert.deepEqual(Object.keys(expected).sort(), [...familyIds].sort());
  for (const id of familyIds)
    assert.deepEqual(
      fallback.model_overrides[id],
      expected[id],
      `${id}: run node --import tsx tools/estimation-family-stand-ins.ts`,
    );
  // No other override claims the family basis.
  for (const [id, rule] of Object.entries(fallback.model_overrides))
    if ("basis" in rule && rule.basis === FAMILY_STAND_IN_BASIS)
      assert.ok(familyIds.includes(id), id);
});

test("VS1 the build configuration holds the variant stand-ins the catalog gives", () => {
  const expected = standInOverrides(core.catalog.models);
  const ids = standInIds();
  assert.deepEqual(Object.keys(expected).sort(), [...ids].sort());
  for (const id of ids) {
    assert.deepEqual(
      fallback.model_overrides[id],
      expected[id],
      `${id}: run node --import tsx tools/estimation-family-stand-ins.ts`,
    );
    assert.ok((MODEL_IDS as readonly string[]).includes(id), id);
  }
  const generated = new Set<string>([
    FAMILY_STAND_IN_BASIS,
    VARIANT_STAND_IN_BASIS,
    KIND_STAND_IN_BASIS,
  ]);
  for (const [id, rule] of Object.entries(fallback.model_overrides))
    if ("basis" in rule && generated.has(rule.basis))
      assert.ok(ids.includes(id), id);
});

// Owner decision of 14 October 2026, computed from the EcoLogits 0.11.3 catalog: [registry id,
// record, basis]. Anthropic's catalog has no mini, nano or lite record, so Claude Haiku, its
// small model, stands in by kind; Google's only image records are the stand-ins for images.
const VARIANT = "model_variant_stand_in";
const KIND = "model_kind_stand_in";
const TODAY_VARIANTS: [string, string, string][] = [
  ["chatgpt-gpt-pro-unlisted", "openai/gpt-5.5-pro", VARIANT],
  ["perplexity-gpt-pro-unlisted", "openai/gpt-5.5-pro", VARIANT],
  ["chatgpt-gpt-mini-unlisted", "openai/gpt-5.4-mini", VARIANT],
  ["perplexity-gpt-mini-unlisted", "openai/gpt-5.4-mini", VARIANT],
  ["chatgpt-gpt-nano-unlisted", "openai/gpt-5.4-nano", VARIANT],
  ["perplexity-gpt-nano-unlisted", "openai/gpt-5.4-nano", VARIANT],
  ["chatgpt-gpt-codex-unlisted", "openai/gpt-5.3-codex", VARIANT],
  ["perplexity-gpt-codex-unlisted", "openai/gpt-5.3-codex", VARIANT],
  ["claude-small-unlisted", "anthropic/claude-haiku-5-5", KIND],
  ["perplexity-claude-small-unlisted", "anthropic/claude-haiku-5-5", KIND],
  [
    "gemini-pro-image-unlisted",
    "google_genai/gemini-3-pro-image-preview",
    VARIANT,
  ],
  [
    "perplexity-gemini-pro-image-unlisted",
    "google_genai/gemini-3-pro-image-preview",
    VARIANT,
  ],
  [
    "gemini-flash-image-unlisted",
    "google_genai/gemini-3.1-flash-image-preview",
    VARIANT,
  ],
  [
    "perplexity-gemini-flash-image-unlisted",
    "google_genai/gemini-3.1-flash-image-preview",
    VARIANT,
  ],
  ["gemini-image-unlisted", "google_genai/gemini-3.1-flash-image-preview", KIND],
  [
    "perplexity-gemini-image-unlisted",
    "google_genai/gemini-3.1-flash-image-preview",
    KIND,
  ],
];

test("VS2 each variant id resolves to its stand-in today, never of another vendor", () => {
  const variantIds = MODEL_VARIANTS.flatMap((variant) => variant.ids);
  assert.deepEqual(
    TODAY_VARIANTS.map(([id]) => id).sort(),
    [...variantIds].sort(),
  );
  for (const [id, record, basis] of TODAY_VARIANTS) {
    const resolution = resolve(id, null);
    assert.equal(resolution.kind, "upstream", id);
    if (resolution.kind !== "upstream") throw new Error("unreachable");
    assert.equal(resolution.selection, "model_override", id);
    assert.equal(
      `${resolution.profile.provider}/${resolution.profile.model_name}`,
      record,
      id,
    );
    assert.equal(resolution.basis, basis, id);
    const variant = MODEL_VARIANTS.find((entry) => entry.ids.includes(id))!;
    assert.equal(resolution.profile.provider, variant.provider, id);
  }
});

test("VS3 a newer catalog variant becomes the stand-in; the kind applies only without one", () => {
  const variant = (name: string) =>
    MODEL_VARIANTS.find((entry) => entry.variant === name)!;
  const pick = (name: string, models: string[], provider: string) => {
    const found = variantStandIn(
      variant(name),
      models.map((model) => ({ provider, name: model })),
    );
    return found && `${found.profile.model_name} ${found.basis}`;
  };
  // A later Pro replaces GPT-5.5 Pro. A family-named Pro record is that family model with Pro
  // reasoning, not a Pro model (owner correction of 14 October 2026), and dated snapshots are
  // not versions.
  assert.equal(
    pick("gpt-pro", ["gpt-5.5-pro", "gpt-6-sol-pro", "gpt-7-pro-2027-01-01"], "openai"),
    `gpt-5.5-pro ${VARIANT}`,
  );
  assert.equal(
    pick("gpt-pro", ["gpt-5.5-pro", "gpt-6-pro", "gpt-6.1-pro"], "openai"),
    `gpt-6.1-pro ${VARIANT}`,
  );
  // Plain records and other variants are not Pro or mini.
  assert.equal(pick("gpt-pro", ["gpt-6.1-sol", "gpt-5.4-mini"], "openai"), null);
  assert.equal(
    pick("gpt-mini", ["gpt-4o-mini", "gpt-5.1-codex-mini", "gpt-5.4-mini"], "openai"),
    `gpt-5.4-mini ${VARIANT}`,
  );
  // Another vendor's records never stand in.
  assert.equal(pick("gpt-pro", ["gpt-5.5-pro"], "anthropic"), null);
  assert.equal(pick("claude-small", ["claude-haiku-4-5"], "openai"), null);
  // A Claude mini record would replace Haiku; without one Haiku stands in by kind.
  assert.equal(
    pick("claude-small", ["claude-haiku-4-5", "claude-opus-5-5"], "anthropic"),
    `claude-haiku-4-5 ${KIND}`,
  );
  assert.equal(
    pick("claude-small", ["claude-haiku-4-5", "claude-sonnet-6-mini"], "anthropic"),
    `claude-sonnet-6-mini ${VARIANT}`,
  );
  // Image variants: the same size first, else the newest image record of any size.
  const images = [
    "gemini-2.5-flash-image",
    "gemini-3-pro-image-preview",
    "gemini-3.1-flash-image-preview",
    "gemini-3.8-flash",
  ];
  assert.equal(
    pick("gemini-pro-image", images, "google_genai"),
    `gemini-3-pro-image-preview ${VARIANT}`,
  );
  assert.equal(
    pick("gemini-pro-image", ["gemini-2.5-flash-image", "gemini-3.8-flash"], "google_genai"),
    `gemini-2.5-flash-image ${KIND}`,
  );
  assert.equal(
    pick("gemini-image", images, "google_genai"),
    `gemini-3.1-flash-image-preview ${KIND}`,
  );
  assert.equal(pick("gemini-image", ["gemini-3.8-flash"], "google_genai"), null);
});

test("PR1 a GPT family with Pro reasoning is estimated as that family model, not as a Pro model", () => {
  // Owner correction of 14 October 2026: "gpt-6-sol-pro is not a different underlying model
  // from GPT-6 Sol. It is GPT-6 Sol running with reasoning.mode set to pro." OpenAI's help page:
  // GPT-6 Pro in ChatGPT is GPT-6 Astra through the Pro reasoning option. [id, record, basis]
  const cases: [string, string, string][] = [
    ["chatgpt-gpt-6-pro", "openai/gpt-6-astra", "exact_record"],
    ["chatgpt-gpt-5-6-sol-pro", "openai/gpt-5.6-sol", "exact_record"],
    ["chatgpt-gpt-6-sol-pro", "openai/gpt-6-sol", "exact_record"],
    ["chatgpt-gpt-6-1-sol-pro", "openai/gpt-6.1-sol", "exact_record"],
    ["chatgpt-gpt-6-luna-pro", "openai/gpt-6-luna", "exact_record"],
    ["chatgpt-gpt-5-6-luna-pro", "openai/gpt-5.6-luna", "exact_record"],
    ["chatgpt-gpt-5-6-terra-pro", "openai/gpt-5.6-terra", "exact_record"],
    ["perplexity-gpt-6-sol-pro", "openai/gpt-6-sol", "exact_record"],
    ["perplexity-gpt-6-1-sol-pro", "openai/gpt-6.1-sol", "exact_record"],
    ["perplexity-gpt-6-astra-pro", "openai/gpt-6-astra", "exact_record"],
    ["perplexity-gpt-5-6-sol-pro", "openai/gpt-5.6-sol", "exact_record"],
    ["perplexity-gpt-5-6-terra-pro", "openai/gpt-5.6-terra", "exact_record"],
    ["chatgpt-gpt-sol-pro-unlisted", "openai/gpt-6.1-sol", FAMILY_STAND_IN_BASIS],
    ["chatgpt-gpt-astra-pro-unlisted", "openai/gpt-6-astra", FAMILY_STAND_IN_BASIS],
    ["chatgpt-gpt-luna-pro-unlisted", "openai/gpt-6-luna", FAMILY_STAND_IN_BASIS],
    ["chatgpt-gpt-terra-pro-unlisted", "openai/gpt-5.6-terra", FAMILY_STAND_IN_BASIS],
    ["perplexity-gpt-sol-pro-unlisted", "openai/gpt-6.1-sol", FAMILY_STAND_IN_BASIS],
    ["perplexity-gpt-astra-pro-unlisted", "openai/gpt-6-astra", FAMILY_STAND_IN_BASIS],
    ["perplexity-gpt-luna-pro-unlisted", "openai/gpt-6-luna", FAMILY_STAND_IN_BASIS],
    ["perplexity-gpt-terra-pro-unlisted", "openai/gpt-5.6-terra", FAMILY_STAND_IN_BASIS],
  ];
  for (const [id, record, basis] of cases) {
    assert.ok((MODEL_IDS as readonly string[]).includes(id), id);
    const resolution = resolve(id, null);
    assert.equal(resolution.kind, "upstream", id);
    if (resolution.kind !== "upstream") throw new Error("unreachable");
    assert.equal(
      `${resolution.profile.provider}/${resolution.profile.model_name}`,
      record,
      id,
    );
    assert.equal(resolution.basis, basis, id);
  }
  // Every Pro reasoning id of the registry is covered above; only GPT Pro models without a
  // family keep Pro records of their own.
  const proReasoning = MODEL_IDS.filter((id) =>
    /-(?:sol|astra|luna|terra)-pro(?:-unlisted)?$/.test(id),
  );
  assert.deepEqual(
    [...proReasoning, "chatgpt-gpt-6-pro"].sort(),
    cases.map(([id]) => id).sort(),
  );
});

test("FS2 each family resolves to its newest catalog record today", () => {
  for (const family of MODEL_FAMILIES) {
    const profile = familyStandIn(family, core.catalog.models);
    assert.equal(
      profile && `${profile.provider}/${profile.model_name}`,
      TODAY[family.family],
      family.family,
    );
  }
  assert.deepEqual(
    Object.keys(TODAY).sort(),
    MODEL_FAMILIES.map((family) => family.family).sort(),
  );
});

test("FS3 a newer catalog version becomes the stand-in without editing the families", () => {
  const family = (name: string) =>
    MODEL_FAMILIES.find((entry) => entry.family === name)!;
  const pick = (name: string, models: string[], provider: string) =>
    familyStandIn(
      family(name),
      models.map((model) => ({ provider, name: model })),
    )?.model_name ?? null;
  // Haiku 5.5 in a future release replaces Haiku 4.5, and Haiku 5.9 replaces Haiku 5.5.
  assert.equal(
    pick("claude-haiku", ["claude-haiku-4-5", "claude-haiku-5-5"], "anthropic"),
    "claude-haiku-5-5",
  );
  assert.equal(
    pick(
      "claude-haiku",
      ["claude-haiku-5-9", "claude-haiku-4-5", "claude-haiku-5-5"],
      "anthropic",
    ),
    "claude-haiku-5-9",
  );
  // A major version without a minor counts as .0; dated snapshots are not versions.
  assert.equal(
    pick(
      "claude-opus",
      ["claude-opus-5", "claude-opus-4-8", "claude-opus-4-20250514"],
      "anthropic",
    ),
    "claude-opus-5",
  );
  // Another provider's record of the same name is not the family.
  assert.equal(pick("claude-haiku", ["claude-haiku-9"], "openai"), null);
  assert.equal(
    pick("gpt-sol", ["gpt-6-sol", "gpt-6.1-sol", "gpt-6.1-sol-pro"], "openai"),
    "gpt-6.1-sol",
  );
  // Versions compare as numbers, and a release wins over its preview.
  assert.equal(
    pick(
      "gemini-flash",
      ["gemini-3.9-flash", "gemini-3.10-flash-preview", "gemini-3.10-flash"],
      "google_genai",
    ),
    "gemini-3.10-flash",
  );
  // Flash-Lite and Flash stay apart, and image or alias records are not Pro.
  assert.equal(
    pick(
      "gemini-flash-lite",
      ["gemini-3.9-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
      "google_genai",
    ),
    "gemini-3.5-flash-lite",
  );
  assert.equal(
    pick(
      "gemini-pro",
      ["gemini-3-pro-image-preview", "gemini-pro-latest", "gemini-2.5-pro"],
      "google_genai",
    ),
    "gemini-2.5-pro",
  );
});

test("FS4 a family id is a model override with the family basis; a label without a family keeps the provider default", () => {
  const haiku = resolve("claude-haiku-unlisted", "anthropic");
  assert.deepEqual(haiku, {
    kind: "upstream",
    selection: "model_override",
    profile: {
      provider: "anthropic",
      model_name: "claude-haiku-5-5",
      workload: "text",
    },
    basis: "model_family_stand_in",
  });
  const plain = resolve("claude-unlisted", "anthropic");
  assert.equal(plain.kind, "upstream");
  if (plain.kind !== "upstream") throw new Error("unreachable");
  assert.equal(plain.selection, "provider_flagship");
  assert.equal(plain.profile.model_name, "claude-opus-5-5");
  assert.equal(plain.basis, "model_not_in_library");
  // Perplexity names no provider; its family ids carry the vendor of their record.
  const perplexity = resolve("perplexity-gemini-flash-lite-unlisted", null);
  assert.equal(
    perplexity.kind === "upstream" && perplexity.profile.model_name,
    "gemini-3.5-flash-lite",
  );
  for (const id of MODEL_FAMILIES.flatMap((family) => family.ids))
    assert.ok((MODEL_IDS as readonly string[]).includes(id), id);
});

test("FS5 the live Haiku 5.5 chat of 13 October no longer gets the Opus 5.5 figure", () => {
  // 19,724 output tokens on claude.ai's claude-haiku-5-5, which EcoLogits 0.11.2 lacked; an unknown
  // Haiku now uses the Haiku 5.5 record of 0.11.3.
  const midpointWh = (modelId: string) => {
    const resolution = resolve(modelId, "anthropic");
    assert.equal(resolution.kind, "upstream");
    if (resolution.kind !== "upstream") throw new Error("unreachable");
    const energy = core.llmImpacts({
      provider: resolution.profile.provider,
      model_name: resolution.profile.model_name,
      output_token_count: 19_724,
      request_latency: null,
    }).usage!.energy.value;
    return typeof energy === "number"
      ? energy * 1000
      : ((energy.min + energy.max) / 2) * 1000;
  };
  const haiku = midpointWh("claude-haiku-unlisted");
  const opus = midpointWh("claude-unlisted");
  assert.ok(haiku > 0);
  assert.ok(haiku * 20 < opus, `${haiku} Wh against ${opus} Wh`);
});
