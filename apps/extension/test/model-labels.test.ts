import assert from "node:assert/strict";
import test from "node:test";
import type { Site } from "@footprint/contracts";
import {
  createMethodRegistry,
  observedProvider,
  resolveModelProfile,
} from "@footprint/estimator";
import configuration from "../../../config/estimation.build.json";
import mappings from "../../../config/estimation.mappings.json";
import media from "../../../config/estimation.media.json";
import {
  normalizeModel,
  resolveModelLabel,
  resolveVideoModel,
  storableModelLabel,
} from "../lib/models";

const methods = createMethodRegistry(configuration, mappings, media);

/** The record a registry id is estimated with, and why (the catalog check is model-coverage). */
function record(site: Site, modelId: string | null) {
  const resolution = resolveModelProfile(
    { modelId, provider: observedProvider(site), workload: "text" },
    methods.mappings.bindings,
    methods.ecoDefinition.fallback,
    { has: () => true },
  );
  assert.equal(resolution.kind, "upstream", `${site} ${modelId}`);
  if (resolution.kind !== "upstream") throw new Error("unreachable");
  return `${resolution.profile.model_name} ${resolution.basis}`;
}

const EXACT = "exact_record";
const NEAREST = "nearest_record";
const FAMILY = "family_benchmark";
const UNNAMED = "model_not_named";
const UNKNOWN = "model_not_in_library";
const SAME_FAMILY = "model_family_stand_in";
const SAME_VARIANT = "model_variant_stand_in";
const SAME_KIND = "model_kind_stand_in";

// Labels seen in the 1 and 3 October audits, with the registry id and record that the
// reference tables (B0 to B8) assign. [label, registry id, record and basis]
const CASES: Record<Site, [string, string, string][]> = {
  chatgpt: [
    ["gpt-5-5", "chatgpt-gpt-5-5", `gpt-5.5 ${EXACT}`],
    ["gpt-5-5-instant", "chatgpt-gpt-5-5", `gpt-5.5 ${EXACT}`],
    ["gpt-5-5-thinking", "chatgpt-gpt-5-5", `gpt-5.5 ${EXACT}`],
    ["gpt-5-6", "chatgpt-gpt-5-6-sol", `gpt-5.6-sol ${EXACT}`],
    ["gpt-5-6-instant", "chatgpt-gpt-5-6-sol", `gpt-5.6-sol ${EXACT}`],
    ["gpt-5-6-thinking", "chatgpt-gpt-5-6-sol", `gpt-5.6-sol ${EXACT}`],
    ["gpt-5.5-wm", "chatgpt-gpt-5-5", `gpt-5.5 ${EXACT}`],
    ["gpt-5.6-sol-wm", "chatgpt-gpt-5-6-sol", `gpt-5.6-sol ${EXACT}`],
    ["gpt-6-sol-wm", "chatgpt-gpt-6-sol", `gpt-6-sol ${EXACT}`],
    ["gpt-6-luna-wm", "chatgpt-gpt-6-luna", `gpt-6-luna ${EXACT}`],
    ["gpt-6.1-sol-wm", "chatgpt-gpt-6-1-sol", `gpt-6.1-sol ${EXACT}`],
    ["gpt-5.6-terra-wm", "chatgpt-gpt-5-6-terra", `gpt-5.6-terra ${EXACT}`],
    ["gpt-5.6-luna-wm", "chatgpt-gpt-5-6-luna", `gpt-5.6-luna ${EXACT}`],
    ["gpt-6-astra-wm", "chatgpt-gpt-6-astra", `gpt-6-astra ${EXACT}`],
    ["gpt-5-5-pro", "chatgpt-gpt-5-5-pro", `gpt-5.5-pro ${EXACT}`],
    // Owner correction of 14 October 2026: a Pro is Pro reasoning of a family model, not a
    // model of its own. OpenAI: GPT-6 Pro in ChatGPT is GPT-6 Astra with the Pro option, and the
    // registry lists GPT-5.6 Pro as GPT-5.6 Sol Pro.
    ["gpt-5-6-pro", "chatgpt-gpt-5-6-sol-pro", `gpt-5.6-sol ${EXACT}`],
    ["gpt-6-pro", "chatgpt-gpt-6-pro", `gpt-6-astra ${EXACT}`],
    ["gpt-6-pro-thinking", "chatgpt-gpt-6-pro", `gpt-6-astra ${EXACT}`],
    ["gpt-5-3-mini", "chatgpt-gpt-5-3-mini", `gpt-5.4-mini ${NEAREST}`],
    ["gpt-5-5-mini", "chatgpt-gpt-5-5-mini", `gpt-5.4-mini ${NEAREST}`],
    ["gpt-5-6-mini", "chatgpt-gpt-5-6-luna", `gpt-5.6-luna ${EXACT}`],
    ["gpt-5-4-t-mini", "chatgpt-gpt-5-4-mini", `gpt-5.4-mini ${EXACT}`],
    ["gpt-5-6-t-mini", "chatgpt-gpt-5-6-luna", `gpt-5.6-luna ${EXACT}`],
    ["gpt-5-4-thinking", "chatgpt-gpt-5-4", `gpt-5.4 ${EXACT}`],
    ["gpt-5-4-auto-thinking", "chatgpt-gpt-5-4", `gpt-5.4 ${EXACT}`],
    // The Deep Research report names its model (E1).
    ["gpt-5-thinking", "chatgpt-gpt-5", `gpt-5 ${EXACT}`],
    ["o3-pro", "chatgpt-o3-pro", `gpt-6-astra ${NEAREST}`],
    ["research", "chatgpt-deep-research", `gpt-6.1-sol ${UNNAMED}`],
    ["bidi", "chatgpt-voice-bidi", `gpt-6.1-sol ${UNNAMED}`],
    ["gpt-7-preview", "chatgpt-unlisted", `gpt-6.1-sol ${UNKNOWN}`],
    // Owner decision of 15 October 2026: ChatGPT's plain GPT-6 is GPT-6 Sol (OpenAI help article).
    ["gpt-6", "chatgpt-gpt-6-sol", `gpt-6-sol ${EXACT}`],
    ["gpt-6-thinking", "chatgpt-gpt-6-sol", `gpt-6-sol ${EXACT}`],
    ["gpt-6-instant", "chatgpt-gpt-6-sol", `gpt-6-sol ${EXACT}`],
    ["gpt-6-2-sol", "chatgpt-gpt-sol-unlisted", `gpt-6.1-sol ${SAME_FAMILY}`],
    [
      "gpt-6.2-sol-thinking-wm",
      "chatgpt-gpt-sol-unlisted",
      `gpt-6.1-sol ${SAME_FAMILY}`,
    ],
    ["gpt-7-astra", "chatgpt-gpt-astra-unlisted", `gpt-6-astra ${SAME_FAMILY}`],
    ["gpt-6-1-luna", "chatgpt-gpt-luna-unlisted", `gpt-6-luna ${SAME_FAMILY}`],
    ["gpt-6-terra", "chatgpt-gpt-terra-unlisted", `gpt-5.6-terra ${SAME_FAMILY}`],
    // Owner correction of 14 October 2026: "gpt-6-sol-pro is not a different underlying model
    // from GPT-6 Sol. It is GPT-6 Sol running with reasoning.mode set to pro." A Pro after a family
    // name is that family model at its version, or the family's newest record when the version
    // is not listed.
    ["gpt-6-sol-pro", "chatgpt-gpt-6-sol-pro", `gpt-6-sol ${EXACT}`],
    [
      "gpt-6.1-sol-pro-thinking-wm",
      "chatgpt-gpt-6-1-sol-pro",
      `gpt-6.1-sol ${EXACT}`,
    ],
    ["gpt-5.6-sol-pro", "chatgpt-gpt-5-6-sol-pro", `gpt-5.6-sol ${EXACT}`],
    ["gpt-6-luna-pro", "chatgpt-gpt-6-luna-pro", `gpt-6-luna ${EXACT}`],
    ["gpt-5-6-terra-pro", "chatgpt-gpt-5-6-terra-pro", `gpt-5.6-terra ${EXACT}`],
    ["gpt-6-astra-pro", "chatgpt-gpt-6-pro", `gpt-6-astra ${EXACT}`],
    ["gpt-6-2-sol-pro", "chatgpt-gpt-sol-pro-unlisted", `gpt-6.1-sol ${SAME_FAMILY}`],
    ["gpt-7-luna-pro", "chatgpt-gpt-luna-pro-unlisted", `gpt-6-luna ${SAME_FAMILY}`],
    // A GPT-6 Pro of an unlisted version runs on Astra like GPT-6 Pro. A Pro of a generation
    // without a known family still uses the newest Pro record of its own.
    ["gpt-6-2-pro", "chatgpt-gpt-astra-pro-unlisted", `gpt-6-astra ${SAME_FAMILY}`],
    ["gpt-7-pro", "chatgpt-gpt-pro-unlisted", `gpt-5.5-pro ${SAME_VARIANT}`],
    ["gpt-5-7-pro", "chatgpt-gpt-pro-unlisted", `gpt-5.5-pro ${SAME_VARIANT}`],
    ["gpt-6-luna-mini", "chatgpt-gpt-mini-unlisted", `gpt-5.4-mini ${SAME_VARIANT}`],
    ["gpt-6-t-mini", "chatgpt-gpt-mini-unlisted", `gpt-5.4-mini ${SAME_VARIANT}`],
    ["gpt-6-nano", "chatgpt-gpt-nano-unlisted", `gpt-5.4-nano ${SAME_VARIANT}`],
    ["gpt-6-sol-codex", "chatgpt-gpt-codex-unlisted", `gpt-5.3-codex ${SAME_VARIANT}`],
    // OpenAI has no image record, and two variant words or an unknown word name no variant.
    ["gpt-6-2-astra-image", "chatgpt-unlisted", `gpt-6.1-sol ${UNKNOWN}`],
    ["gpt-6-pro-mini", "chatgpt-unlisted", `gpt-6.1-sol ${UNKNOWN}`],
    ["gpt-6-sol-max", "chatgpt-unlisted", `gpt-6.1-sol ${UNKNOWN}`],
    ["gpt-6-2-luna-thinking", "chatgpt-gpt-luna-unlisted", `gpt-6-luna ${SAME_FAMILY}`],
    // Owner decision of 14 October 2026: a reasoning word is a setting of the model, not another
    // model, also after a family or an unlisted version ("high" as in o3-mini-high).
    ["gpt-6-sol-high", "chatgpt-gpt-6-sol", `gpt-6-sol ${EXACT}`],
    ["gpt-6-1-sol-thinking-high", "chatgpt-gpt-6-1-sol", `gpt-6.1-sol ${EXACT}`],
    ["gpt-7-astra-high", "chatgpt-gpt-astra-unlisted", `gpt-6-astra ${SAME_FAMILY}`],
  ],
  claude: [
    ["claude-fable-5-1", "claude-fable-5-1", `claude-fable-5-1 ${EXACT}`],
    ["claude-opus-5-5", "claude-opus-5-5", `claude-opus-5-5 ${EXACT}`],
    ["claude-opus-5-5-fast", "claude-opus-5-5", `claude-opus-5-5 ${EXACT}`],
    ["claude-opus-4-5-20251101", "claude-opus-4-5", `claude-opus-4-5 ${EXACT}`],
    ["claude-sonnet-5-5", "claude-sonnet-5-5", `claude-sonnet-5-5 ${EXACT}`],
    [
      "claude-haiku-4-5-20251001",
      "claude-haiku-4-5",
      `claude-haiku-4-5 ${EXACT}`,
    ],
    [
      "claude-sonnet-4-5-20250929",
      "claude-sonnet-4-5",
      `claude-sonnet-4-5 ${EXACT}`,
    ],
    ["claude-fable-5", "claude-fable-5", `claude-fable-5 ${EXACT}`],
    ["claude-opus-5", "claude-opus-5", `claude-opus-5 ${EXACT}`],
    ["claude-opus-4-8", "claude-opus-4-8", `claude-opus-4-8 ${EXACT}`],
    ["claude-opus-4-7", "claude-opus-4-7", `claude-opus-4-7 ${EXACT}`],
    ["claude-opus-4-6", "claude-opus-4-6", `claude-opus-4-6 ${EXACT}`],
    ["claude-sonnet-5", "claude-sonnet-5", `claude-sonnet-5 ${EXACT}`],
    ["claude-sonnet-4-6", "claude-sonnet-4-6", `claude-sonnet-4-6 ${EXACT}`],
    [
      "claude-opus-4-1-20250805-claude-ai",
      "claude-opus-4-1",
      `claude-opus-4-5 ${NEAREST}`,
    ],
    [
      "claude-opus-4-1-20250805",
      "claude-opus-4-1",
      `claude-opus-4-5 ${NEAREST}`,
    ],
    ["claude-opus-4-20250514", "claude-opus-4", `claude-opus-4-5 ${NEAREST}`],
    ["claude-3-opus-20240229", "claude-opus-3", `claude-opus-4-5 ${NEAREST}`],
    [
      "claude-3-5-sonnet-20240620",
      "claude-sonnet-3-5",
      `claude-sonnet-4-5 ${NEAREST}`,
    ],
    [
      "claude-3-5-sonnet-20241022",
      "claude-sonnet-3-5",
      `claude-sonnet-4-5 ${NEAREST}`,
    ],
    [
      "claude-3-5-haiku-20241022",
      "claude-haiku-3-5",
      `claude-haiku-4-5 ${NEAREST}`,
    ],
    // Owner decision of 13 October 2026: an unknown version uses its family's newest record.
    ["claude-opus-6", "claude-opus-unlisted", `claude-opus-5-5 ${SAME_FAMILY}`],
    // The live chat of 13 October: Haiku 5.5 had been estimated as Opus 5.5. Since EcoLogits
    // 0.11.3 (22 October 2026) it has its own record.
    ["claude-haiku-5-5", "claude-haiku-5-5", `claude-haiku-5-5 ${EXACT}`],
    ["claude-haiku-5-5-20261001", "claude-haiku-5-5", `claude-haiku-5-5 ${EXACT}`],
    ["claude-haiku-5-9", "claude-haiku-unlisted", `claude-haiku-5-5 ${SAME_FAMILY}`],
    ["claude-3-7-haiku", "claude-haiku-unlisted", `claude-haiku-5-5 ${SAME_FAMILY}`],
    ["claude-sonnet-6", "claude-sonnet-unlisted", `claude-sonnet-5-5 ${SAME_FAMILY}`],
    ["claude-fable-6-fast", "claude-fable-unlisted", `claude-fable-5-1 ${SAME_FAMILY}`],
    // Owner decision of 14 October 2026: "-thinking" is a reasoning setting, as "-fast" is a
    // speed setting; the catalog has no Claude thinking record.
    ["claude-haiku-6-thinking", "claude-haiku-unlisted", `claude-haiku-5-5 ${SAME_FAMILY}`],
    ["claude-opus-5-5-thinking", "claude-opus-5-5", `claude-opus-5-5 ${EXACT}`],
    [
      "claude-sonnet-4-5-thinking-20250929",
      "claude-sonnet-4-5",
      `claude-sonnet-4-5 ${EXACT}`,
    ],
    ["claude-sonnet-6-mini-thinking", "claude-small-unlisted", `claude-haiku-5-5 ${SAME_KIND}`],
    ["claude-opus", "claude-opus-unlisted", `claude-opus-5-5 ${SAME_FAMILY}`],
    // Owner decision of 14 October 2026: the library has no small Claude variant, so a mini,
    // nano or lite variant uses Claude Haiku, Anthropic's small model, not Opus.
    ["claude-haiku-5-5-mini", "claude-small-unlisted", `claude-haiku-5-5 ${SAME_KIND}`],
    ["claude-sonnet-6-mini", "claude-small-unlisted", `claude-haiku-5-5 ${SAME_KIND}`],
    [
      "claude-opus-6-lite-20261001",
      "claude-small-unlisted",
      `claude-haiku-5-5 ${SAME_KIND}`,
    ],
    // No Anthropic image or Pro record exists, and an unknown family names no variant.
    ["claude-sonnet-6-image-20261001", "claude-unlisted", `claude-opus-5-5 ${UNKNOWN}`],
    ["claude-opus-6-pro", "claude-unlisted", `claude-opus-5-5 ${UNKNOWN}`],
    ["claude-nova-1-mini", "claude-unlisted", `claude-opus-5-5 ${UNKNOWN}`],
    // Without a family the provider default stays.
    ["claude-nova-1", "claude-unlisted", `claude-opus-5-5 ${UNKNOWN}`],
  ],
  gemini: [
    [
      "3.5 Flash-Lite",
      "gemini-3-5-flash-lite",
      `gemini-3.5-flash-lite ${EXACT}`,
    ],
    ["3.6 Flash (New)", "gemini-3-6-flash", `gemini-3.6-flash ${EXACT}`],
    ["3.6 Flash", "gemini-3-6-flash", `gemini-3.6-flash ${EXACT}`],
    ["3.6 Thinking", "gemini-3-6-thinking", `gemini-3.6-flash ${EXACT}`],
    ["Extended thinking", "gemini-3-6-thinking", `gemini-3.6-flash ${EXACT}`],
    // Owner decision of 14 October 2026: "Thinking" is a reasoning setting. A version with only
    // "Thinking" is that version's Flash, as "3.6 Thinking" is.
    ["3.8 Flash Thinking", "gemini-3-8-flash", `gemini-3.8-flash ${EXACT}`],
    ["3.1 Pro Thinking", "gemini-3-1-pro", `gemini-3.1-pro-preview ${EXACT}`],
    ["3.9 Thinking", "gemini-flash-unlisted", `gemini-3.8-flash ${SAME_FAMILY}`],
    [
      "4.0 Pro Extended thinking",
      "gemini-pro-unlisted",
      `gemini-3.1-pro-preview ${SAME_FAMILY}`,
    ],
    // Owner decision of 14 October 2026: Nano Banana Pro is Gemini 3 Pro Image.
    ["Nano Banana Pro", "gemini-nano-banana-pro", `gemini-3-pro-image-preview ${EXACT}`],
    ["3.1 Pro", "gemini-3-1-pro", `gemini-3.1-pro-preview ${EXACT}`],
    ["3.5 Flash", "gemini-3-5-flash", `gemini-3.5-flash ${EXACT}`],
    ["2.5 Flash", "gemini-2-5-flash", `gemini-2.5-flash ${EXACT}`],
    ["Gemini Omni 1.1 Flash", "gemini-omni", `gemini-3.8-flash ${UNKNOWN}`],
    ["4.0 Flash", "gemini-flash-unlisted", `gemini-3.8-flash ${SAME_FAMILY}`],
    ["3.9 Flash", "gemini-flash-unlisted", `gemini-3.8-flash ${SAME_FAMILY}`],
    [
      "3.9 Flash-Lite",
      "gemini-flash-lite-unlisted",
      `gemini-3.5-flash-lite ${SAME_FAMILY}`,
    ],
    [
      "4 Flash Lite (New)",
      "gemini-flash-lite-unlisted",
      `gemini-3.5-flash-lite ${SAME_FAMILY}`,
    ],
    ["3.5 Pro", "gemini-pro-unlisted", `gemini-3.1-pro-preview ${SAME_FAMILY}`],
    // An image model whose name contains Pro is not the Pro family. Owner decision of 14
    // October 2026: it uses the newest record of its image variant, or of any image size.
    [
      "3.9 Flash Image",
      "gemini-flash-image-unlisted",
      `gemini-3.1-flash-image-preview ${SAME_VARIANT}`,
    ],
    ["3 Pro Image", "gemini-pro-image-unlisted", `gemini-3-pro-image-preview ${SAME_VARIANT}`],
    [
      "Gemini 3 Pro Image (Preview)",
      "gemini-pro-image-unlisted",
      `gemini-3-pro-image-preview ${SAME_VARIANT}`,
    ],
    [
      "Nano Banana Pro 3",
      "gemini-pro-image-unlisted",
      `gemini-3-pro-image-preview ${SAME_VARIANT}`,
    ],
    [
      "3.9 Flash-Lite Image",
      "gemini-image-unlisted",
      `gemini-3.1-flash-image-preview ${SAME_KIND}`,
    ],
    [
      "Nano Banana 3",
      "gemini-image-unlisted",
      `gemini-3.1-flash-image-preview ${SAME_KIND}`,
    ],
    ["3.9 Ultra", "gemini-unlisted", `gemini-3.8-flash ${UNKNOWN}`],
  ],
  perplexity: [
    ["turbo", "perplexity-best", `gpt-6.1-sol ${UNNAMED}`],
    ["pplx_pro", "perplexity-best", `gpt-6.1-sol ${UNNAMED}`],
    ["experimental", "perplexity-sonar-2", `gpt-6.1-sol ${FAMILY}`],
    ["pplx_alpha", "perplexity-deep-research", `gpt-6.1-sol ${UNNAMED}`],
    ["pplx_beta", "perplexity-create-files", `gpt-6.1-sol ${UNNAMED}`],
    ["pplx_study", "perplexity-study", `gpt-6.1-sol ${UNNAMED}`],
    [
      "pplx_agentic_research",
      "perplexity-agentic-research",
      `gpt-6.1-sol ${UNNAMED}`,
    ],
    ["comet_browser_agent", "perplexity-comet", `gpt-6.1-sol ${UNNAMED}`],
    [
      "comet_browser_agent_sonnet",
      "perplexity-claude-sonnet-5",
      `claude-sonnet-5 ${EXACT}`,
    ],
    [
      "comet_browser_agent_opus",
      "perplexity-claude-opus-4-8",
      `claude-opus-4-8 ${EXACT}`,
    ],
    ["gpt56_terra", "perplexity-gpt-5-6-terra", `gpt-5.6-terra ${EXACT}`],
    [
      "gpt56_terra_thinking",
      "perplexity-gpt-5-6-terra",
      `gpt-5.6-terra ${EXACT}`,
    ],
    ["gpt56_sol_thinking", "perplexity-gpt-5-6-sol", `gpt-5.6-sol ${EXACT}`],
    ["gpt6_1_sol", "perplexity-gpt-6-1-sol", `gpt-6.1-sol ${EXACT}`],
    ["gpt6_1_sol_thinking", "perplexity-gpt-6-1-sol", `gpt-6.1-sol ${EXACT}`],
    ["gpt6_sol_thinking", "perplexity-gpt-6-sol", `gpt-6-sol ${EXACT}`],
    // Owner decision of 14 October 2026: "_fast" is a speed setting on every id, not only on
    // Computer ids; Veo 3 Fast keeps its own video record (D3).
    ["gpt6_sol_fast", "perplexity-gpt-6-sol", `gpt-6-sol ${EXACT}`],
    ["gpt6_sol_thinking_fast", "perplexity-gpt-6-sol", `gpt-6-sol ${EXACT}`],
    [
      "claude55sonnet_fast",
      "perplexity-claude-sonnet-5-5",
      `claude-sonnet-5-5 ${EXACT}`,
    ],
    ["gpt7astra_fast", "perplexity-gpt-astra-unlisted", `gpt-6-astra ${SAME_FAMILY}`],
    // Owner decision of 14 October 2026: Nano Banana Pro is Gemini 3 Pro Image.
    [
      "nanobananapro",
      "perplexity-nano-banana-pro",
      `gemini-3-pro-image-preview ${EXACT}`,
    ],
    [
      "gemini38flash",
      "perplexity-gemini-3-8-flash",
      `gemini-3.8-flash ${EXACT}`,
    ],
    [
      "gemini38flashthinking",
      "perplexity-gemini-3-8-flash",
      `gemini-3.8-flash ${EXACT}`,
    ],
    [
      "gemini37flashthinking",
      "perplexity-gemini-3-7-flash",
      `gemini-3.7-flash ${EXACT}`,
    ],
    [
      "claude55sonnet",
      "perplexity-claude-sonnet-5-5",
      `claude-sonnet-5-5 ${EXACT}`,
    ],
    [
      "claude55sonnetthinking",
      "perplexity-claude-sonnet-5-5",
      `claude-sonnet-5-5 ${EXACT}`,
    ],
    [
      "claude50sonnet",
      "perplexity-claude-sonnet-5",
      `claude-sonnet-5 ${EXACT}`,
    ],
    [
      "claude55opusthinking",
      "perplexity-claude-opus-5-5",
      `claude-opus-5-5 ${EXACT}`,
    ],
    ["claude48opus", "perplexity-claude-opus-4-8", `claude-opus-4-8 ${EXACT}`],
    [
      "claude45opusthinking",
      "perplexity-claude-opus-4-5",
      `claude-opus-4-5 ${EXACT}`,
    ],
    [
      "claude41opus",
      "perplexity-claude-opus-4-1",
      `claude-opus-4-5 ${NEAREST}`,
    ],
    ["claude40opus", "perplexity-claude-opus-4", `claude-opus-4-5 ${NEAREST}`],
    [
      "claude46sonnetthinking",
      "perplexity-claude-sonnet-4-6",
      `claude-sonnet-4-6 ${EXACT}`,
    ],
    [
      "claude45haikuthinking",
      "perplexity-claude-haiku-4-5",
      `claude-haiku-4-5 ${EXACT}`,
    ],
    ["claude2", "perplexity-claude-sonnet-4", `claude-sonnet-4-5 ${NEAREST}`],
    [
      "claude37sonnetthinking",
      "perplexity-claude-sonnet-4",
      `claude-sonnet-4-5 ${NEAREST}`,
    ],
    [
      "claude40sonnetthinking",
      "perplexity-claude-sonnet-4",
      `claude-sonnet-4-5 ${NEAREST}`,
    ],
    ["kimik3thinking", "perplexity-kimi-k3", `gpt-6.1-sol ${FAMILY}`],
    ["kimik25thinking", "perplexity-kimi", `gpt-6.1-sol ${FAMILY}`],
    ["kimik26instant", "perplexity-kimi", `gpt-6.1-sol ${FAMILY}`],
    ["glm_5_3_thinking", "perplexity-glm-5-3", `zai-glm-5-3 ${EXACT}`],
    ["glm_5_2", "perplexity-glm-5-2", `zai-glm-5-2 ${EXACT}`],
    ["grok47thinking", "perplexity-grok", `gpt-6.1-sol ${FAMILY}`],
    ["grok46low", "perplexity-grok-4-6", `gpt-6.1-sol ${FAMILY}`],
    ["grok46medium", "perplexity-grok-4-6", `gpt-6.1-sol ${FAMILY}`],
    ["grok4nonthinking", "perplexity-grok", `gpt-6.1-sol ${FAMILY}`],
    ["grok41nonreasoning", "perplexity-grok", `gpt-6.1-sol ${FAMILY}`],
    ["grok41reasoning", "perplexity-grok", `gpt-6.1-sol ${FAMILY}`],
    [
      "nv_nemotron_3_ultra",
      "perplexity-nemotron-3-ultra",
      `gpt-6.1-sol ${FAMILY}`,
    ],
    ["nv_nemotron_3_super", "perplexity-nemotron", `gpt-6.1-sol ${FAMILY}`],
    ["gpt4o", "perplexity-gpt-4o", `gpt-4o ${EXACT}`],
    ["gpt41", "perplexity-gpt-4-1", `gpt-4.1 ${EXACT}`],
    ["gpt5_thinking", "perplexity-gpt-5", `gpt-5 ${EXACT}`],
    ["gpt51_low_thinking", "perplexity-gpt-5-1", `gpt-5.1 ${EXACT}`],
    ["gpt5_nano", "perplexity-gpt-5-nano", `gpt-5-nano ${EXACT}`],
    ["gpt52_pro", "perplexity-gpt-5-2-pro", `gpt-5.2-pro ${EXACT}`],
    ["gpt55_thinking", "perplexity-gpt-5-5", `gpt-5.5 ${EXACT}`],
    [
      "gemini30pro",
      "perplexity-gemini-3-pro",
      `gemini-3.1-pro-preview ${NEAREST}`,
    ],
    [
      "gemini30flash_high",
      "perplexity-gemini-3-flash",
      `gemini-3-flash-preview ${EXACT}`,
    ],
    [
      "gemini31pro_low",
      "perplexity-gemini-3-1-pro",
      `gemini-3.1-pro-preview ${EXACT}`,
    ],
    [
      "gemini35flash_medium",
      "perplexity-gemini-3-5-flash",
      `gemini-3.5-flash ${EXACT}`,
    ],
    ["o4mini", "perplexity-o4-mini", `o4-mini ${EXACT}`],
    ["o3pro", "perplexity-o3-pro", `gpt-6-astra ${NEAREST}`],
    ["pplx_asi", "perplexity-claude-opus-5-5", `claude-opus-5-5 ${EXACT}`],
    ["pplx_asi_opus", "perplexity-claude-opus-5-5", `claude-opus-5-5 ${EXACT}`],
    [
      "pplx_asi_opus_fast",
      "perplexity-claude-opus-5-5",
      `claude-opus-5-5 ${EXACT}`,
    ],
    // "_fast" runs the same default orchestrator.
    ["pplx_asi_fast", "perplexity-claude-opus-5-5", `claude-opus-5-5 ${EXACT}`],
    [
      "pplx_asi_opus_thinking",
      "perplexity-claude-opus-4-8",
      `claude-opus-4-8 ${EXACT}`,
    ],
    [
      "pplx_asi_sonnet",
      "perplexity-claude-sonnet-5-5",
      `claude-sonnet-5-5 ${EXACT}`,
    ],
    [
      "pplx_asi_sonnet_thinking",
      "perplexity-claude-sonnet-5",
      `claude-sonnet-5 ${EXACT}`,
    ],
    [
      "pplx_asi_fable_5",
      "perplexity-claude-fable-5-1",
      `claude-fable-5-1 ${EXACT}`,
    ],
    ["pplx_asi_astra", "perplexity-gpt-6-astra", `gpt-6-astra ${EXACT}`],
    ["pplx_asi_astra_fast", "perplexity-gpt-6-astra", `gpt-6-astra ${EXACT}`],
    ["pplx_asi_gpt_6_1_sol", "perplexity-gpt-6-1-sol", `gpt-6.1-sol ${EXACT}`],
    [
      "pplx_asi_gpt_6_1_sol_fast",
      "perplexity-gpt-6-1-sol",
      `gpt-6.1-sol ${EXACT}`,
    ],
    ["pplx_asi_gpt_6_sol", "perplexity-gpt-6-sol", `gpt-6-sol ${EXACT}`],
    ["pplx_asi_gpt_56_sol", "perplexity-gpt-5-6-sol", `gpt-5.6-sol ${EXACT}`],
    ["pplx_asi_gpt54", "perplexity-gpt-5-4", `gpt-5.4 ${EXACT}`],
    ["pplx_asi_gpt_55", "perplexity-gpt-5-5", `gpt-5.5 ${EXACT}`],
    [
      "pplx_asi_gemini_3_8_flash",
      "perplexity-gemini-3-8-flash",
      `gemini-3.8-flash ${EXACT}`,
    ],
    ["pplx_asi_glm_5_3", "perplexity-glm-5-3", `zai-glm-5-3 ${EXACT}`],
    ["pplx_asi_glm", "perplexity-glm-5-2", `zai-glm-5-2 ${EXACT}`],
    ["pplx_asi_kimi_k3", "perplexity-kimi-k3", `gpt-6.1-sol ${FAMILY}`],
    ["pplx_asi_kimi", "perplexity-kimi", `gpt-6.1-sol ${FAMILY}`],
    ["pplx_asi_qwen", "perplexity-qwen", `gpt-6.1-sol ${FAMILY}`],
    ["pplx_asi_grok", "perplexity-grok", `gpt-6.1-sol ${FAMILY}`],
    ["pplx_asi_grok_46", "perplexity-grok-4-6", `gpt-6.1-sol ${FAMILY}`],
    ["pplx_asi_grok_45", "perplexity-grok", `gpt-6.1-sol ${FAMILY}`],
    [
      "pplx_asi_deepseek_v4_pro",
      "perplexity-deepseek",
      `gpt-6.1-sol ${FAMILY}`,
    ],
    ["pplx_asi_glm_pt_0728", "perplexity-unlisted", `gpt-6.1-sol ${UNKNOWN}`],
    [
      "claudecode",
      "perplexity-unlisted-anthropic",
      `claude-opus-5-5 ${UNKNOWN}`,
    ],
    [
      "gemini40flash",
      "perplexity-gemini-flash-unlisted",
      `gemini-3.8-flash ${SAME_FAMILY}`,
    ],
    [
      "gemini40flashlite",
      "perplexity-gemini-flash-lite-unlisted",
      `gemini-3.5-flash-lite ${SAME_FAMILY}`,
    ],
    [
      "gemini40pro",
      "perplexity-gemini-pro-unlisted",
      `gemini-3.1-pro-preview ${SAME_FAMILY}`,
    ],
    ["gemini40", "perplexity-unlisted-google", `gemini-3.8-flash ${UNKNOWN}`],
    // Gemini 3 Pro Image is an image model, not Gemini Pro text (C1). Owner decision of 14
    // October 2026: unknown variants use the same variant's newest record, or their kind's.
    [
      "gemini3proimage",
      "perplexity-gemini-pro-image-unlisted",
      `gemini-3-pro-image-preview ${SAME_VARIANT}`,
    ],
    [
      "gemini40flashimage",
      "perplexity-gemini-flash-image-unlisted",
      `gemini-3.1-flash-image-preview ${SAME_VARIANT}`,
    ],
    [
      "gemini40flashliteimage",
      "perplexity-gemini-image-unlisted",
      `gemini-3.1-flash-image-preview ${SAME_KIND}`,
    ],
    [
      "nanobananapro2",
      "perplexity-gemini-pro-image-unlisted",
      `gemini-3-pro-image-preview ${SAME_VARIANT}`,
    ],
    [
      "nanobanana3",
      "perplexity-gemini-image-unlisted",
      `gemini-3.1-flash-image-preview ${SAME_KIND}`,
    ],
    [
      "claude60sonnetmini",
      "perplexity-claude-small-unlisted",
      `claude-haiku-5-5 ${SAME_KIND}`,
    ],
    [
      "claude60sonnetminithinking",
      "perplexity-claude-small-unlisted",
      `claude-haiku-5-5 ${SAME_KIND}`,
    ],
    // No Anthropic Pro record exists, and a variant word needs a family or vendor name.
    [
      "pplx_asi_opus_6_pro",
      "perplexity-unlisted-anthropic",
      `claude-opus-5-5 ${UNKNOWN}`,
    ],
    ["claude60mini", "perplexity-unlisted-anthropic", `claude-opus-5-5 ${UNKNOWN}`],
    ["pplx_asi_mini", "perplexity-unlisted", `gpt-6.1-sol ${UNKNOWN}`],
    ["gpt6_sol_pro_mini", "perplexity-unlisted", `gpt-6.1-sol ${UNKNOWN}`],
    // Owner correction of 14 October 2026: a Pro after a GPT family name is that family model
    // with Pro reasoning, at its version where the registry lists it.
    ["gpt6_sol_pro", "perplexity-gpt-6-sol-pro", `gpt-6-sol ${EXACT}`],
    ["gpt6_1_sol_pro_thinking", "perplexity-gpt-6-1-sol-pro", `gpt-6.1-sol ${EXACT}`],
    ["gpt56_sol_pro", "perplexity-gpt-5-6-sol-pro", `gpt-5.6-sol ${EXACT}`],
    ["gpt56_terra_pro", "perplexity-gpt-5-6-terra-pro", `gpt-5.6-terra ${EXACT}`],
    ["pplx_asi_gpt_6_sol_pro", "perplexity-gpt-6-sol-pro", `gpt-6-sol ${EXACT}`],
    ["pplx_asi_astra_pro_fast", "perplexity-gpt-6-astra-pro", `gpt-6-astra ${EXACT}`],
    ["gpt6_2_sol_pro", "perplexity-gpt-sol-pro-unlisted", `gpt-6.1-sol ${SAME_FAMILY}`],
    ["gpt6_luna_pro", "perplexity-gpt-luna-pro-unlisted", `gpt-6-luna ${SAME_FAMILY}`],
    ["gpt6_pro", "perplexity-gpt-astra-pro-unlisted", `gpt-6-astra ${SAME_FAMILY}`],
    ["gpt7pro", "perplexity-gpt-pro-unlisted", `gpt-5.5-pro ${SAME_VARIANT}`],
    ["gpt6_luna_mini", "perplexity-gpt-mini-unlisted", `gpt-5.4-mini ${SAME_VARIANT}`],
    [
      "pplx_asi_luna_mini",
      "perplexity-gpt-mini-unlisted",
      `gpt-5.4-mini ${SAME_VARIANT}`,
    ],
    ["gpt6_nano", "perplexity-gpt-nano-unlisted", `gpt-5.4-nano ${SAME_VARIANT}`],
    [
      "claude55haiku",
      "perplexity-claude-haiku-unlisted",
      `claude-haiku-5-5 ${SAME_FAMILY}`,
    ],
    [
      "claude55haikuthinking",
      "perplexity-claude-haiku-unlisted",
      `claude-haiku-5-5 ${SAME_FAMILY}`,
    ],
    [
      "claude60opus",
      "perplexity-claude-opus-unlisted",
      `claude-opus-5-5 ${SAME_FAMILY}`,
    ],
    [
      "claude60sonnet",
      "perplexity-claude-sonnet-unlisted",
      `claude-sonnet-5-5 ${SAME_FAMILY}`,
    ],
    [
      "pplx_asi_fable_6",
      "perplexity-claude-fable-unlisted",
      `claude-fable-5-1 ${SAME_FAMILY}`,
    ],
    // Computer ids lose their speed and effort suffixes before the family check.
    [
      "pplx_asi_fable_6_thinking_fast",
      "perplexity-claude-fable-unlisted",
      `claude-fable-5-1 ${SAME_FAMILY}`,
    ],
    [
      "gpt6_2_sol",
      "perplexity-gpt-sol-unlisted",
      `gpt-6.1-sol ${SAME_FAMILY}`,
    ],
    [
      "gpt7astrathinking",
      "perplexity-gpt-astra-unlisted",
      `gpt-6-astra ${SAME_FAMILY}`,
    ],
    [
      "pplx_asi_luna",
      "perplexity-gpt-luna-unlisted",
      `gpt-6-luna ${SAME_FAMILY}`,
    ],
    [
      "gpt57_terra",
      "perplexity-gpt-terra-unlisted",
      `gpt-5.6-terra ${SAME_FAMILY}`,
    ],
    ["gpt53codex", "perplexity-gpt-codex-unlisted", `gpt-5.3-codex ${SAME_VARIANT}`],
    // A family word outside a GPT or Computer id names no family.
    ["solar2", "perplexity-unlisted", `gpt-6.1-sol ${UNKNOWN}`],
  ],
  notebooklm: [
    ["any label", "notebooklm-default", `gemini-3-flash-preview ${UNNAMED}`],
  ],
};

test("W2 every audited label resolves to the registry id and record of the reference tables", () => {
  for (const [site, cases] of Object.entries(CASES) as [
    Site,
    [string, string, string][],
  ][])
    for (const [raw, id, expected] of cases) {
      const resolved = resolveModelLabel(site, raw);
      assert.equal(resolved?.id, id, `${site} ${raw}`);
      assert.equal(
        resolved.unlisted,
        id.endsWith("-unlisted") || /-unlisted-/.test(id),
        `${site} ${raw} unlisted flag`,
      );
      assert.equal(record(site, id), expected, `${site} ${raw}`);
    }
});

test("W2 acceptance labels name the expected EcoLogits records", () => {
  const profile = (site: Site, raw: string) => {
    const resolution = resolveModelProfile(
      {
        modelId: normalizeModel(site, raw),
        provider: observedProvider(site),
        workload: "text",
      },
      methods.mappings.bindings,
      methods.ecoDefinition.fallback,
      { has: () => true },
    );
    return resolution.kind === "upstream"
      ? `${resolution.profile.provider}/${resolution.profile.model_name}`
      : resolution.kind;
  };
  assert.equal(
    profile("claude", "claude-opus-5-5"),
    "anthropic/claude-opus-5-5",
  );
  assert.equal(profile("chatgpt", "gpt-6-astra-wm"), "openai/gpt-6-astra");
  assert.equal(
    profile("perplexity", "pplx_asi_opus"),
    "anthropic/claude-opus-5-5",
  );
  // GLM keeps the catalog's Mistral record; the media policy moves its grid, PUE and WUE to
  // EcoLogits' US multi-cloud profile (C4, owner decision of 15 October 2026).
  assert.equal(
    profile("perplexity", "glm_5_3_thinking"),
    "mistralai/zai-glm-5-3",
  );
  assert.deepEqual(methods.media.environment_overrides["perplexity-glm-5-3"], {
    electricity_mix_zone: "USA",
    datacenter_pue: { min: "1.09", max: "1.14" },
    datacenter_wue: { min: "0.13", max: "0.99" },
  });
});

test("B0 a request for auto names no model and an empty label is no label", () => {
  assert.equal(resolveModelLabel("chatgpt", "auto"), null);
  for (const site of ["chatgpt", "claude", "gemini", "perplexity"] as const) {
    assert.equal(resolveModelLabel(site, null), null);
    assert.equal(resolveModelLabel(site, "  "), null);
  }
  // A registry id of the same site passes through; another site's id is an unknown label.
  assert.equal(normalizeModel("chatgpt", "chatgpt-gpt-5-5"), "chatgpt-gpt-5-5");
  assert.deepEqual(resolveModelLabel("claude", "chatgpt-gpt-5-5"), {
    id: "claude-unlisted",
    unlisted: true,
  });
  assert.equal(
    normalizeModel("perplexity", "gpt-5-6-thinking"),
    "perplexity-unlisted",
  );
  // NotebookLM names no model, so even no label uses its stand-in (B3).
  assert.deepEqual(resolveModelLabel("notebooklm", null), {
    id: "notebooklm-default",
    unlisted: false,
  });
});

test("D3 generated video labels use their own record or the Veo 3.1 stand-in", () => {
  assert.equal(
    resolveVideoModel("perplexity", "veo3_fast"),
    "perplexity-veo-3-0-fast",
  );
  assert.equal(resolveVideoModel("perplexity", "veo31"), "perplexity-veo-3-1");
  assert.equal(
    resolveVideoModel("perplexity", "veo31fast"),
    "perplexity-veo-3-1-fast",
  );
  assert.equal(
    resolveVideoModel("perplexity", "sora2"),
    "perplexity-sora-2-pro",
  );
  assert.equal(
    resolveVideoModel("perplexity", "sora2pro"),
    "perplexity-sora-2-pro",
  );
  // A text model id or an unknown id is not a video record.
  assert.equal(
    resolveVideoModel("perplexity", "turbo"),
    "perplexity-video-unlisted",
  );
  assert.equal(
    resolveVideoModel("perplexity", "veo9"),
    "perplexity-video-unlisted",
  );
  assert.equal(
    resolveVideoModel("gemini", "models/omni_1p2_pro_gemini_app"),
    "gemini-omni-video",
  );
  assert.equal(resolveVideoModel("chatgpt", "veo31"), null);
});

test("D6 only label-like values are kept as local diagnostics", () => {
  for (const value of [
    "gpt-7-preview",
    "Gemini Omni 1.1 Flash",
    "3.6 Flash (New)",
    "models/omni_1p2_pro_gemini_app",
    "pplx_asi_glm_pt_0728",
  ])
    assert.equal(storableModelLabel(value), value);
  for (const value of [
    null,
    "",
    " ",
    "a".repeat(81),
    "label\nwith a line break",
    "name <script>",
    "ünïcode",
  ])
    assert.equal(storableModelLabel(value), null, String(value));
});
