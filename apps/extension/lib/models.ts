import {
  MODEL_IDS,
  MODEL_LABEL_PATTERN,
  type ModelId,
  type Site,
} from "@footprint/contracts";
import type { ApplicationRepository } from "@footprint/ledger";

// Recognition only: these tables say which registry id a site's own label names. Which
// EcoLogits record or stand-in that id uses is the estimation policy (config/*.json).
// Sources: ChatGPT /backend-api/models, the Claude bootstrap model list, Perplexity
// /rest/models/config and Gemini turn labels, audited on 1 and 3 October 2026, plus
// earlier ChatGPT slugs that imported history can still carry.

export interface ModelLabel {
  readonly id: ModelId;
  /** The site named a model the registry does not know; Details says so. */
  readonly unlisted: boolean;
}

const known = new Set<string>(MODEL_IDS);
const label = (id: ModelId, unlisted = false): ModelLabel => ({ id, unlisted });
const lookup = (
  table: Readonly<Record<string, ModelId>>,
  key: string,
): ModelId | undefined => (Object.hasOwn(table, key) ? table[key] : undefined);

/** The label without its trailing reasoning, effort or speed words (B4), at most three. */
function withoutWords(label: string, words: RegExp): string {
  let key = label;
  for (let step = 0; step < 3; step++) key = key.replace(words, "");
  return key;
}

// ChatGPT slugs after Work suffixes are removed and dots become dashes. The vendor titles
// decide the record: GPT-5.6 Sol answers as gpt-5-6, -instant and -thinking (B4).
const CHATGPT: Readonly<Record<string, ModelId>> = Object.freeze({
  // Owner decision of 15 October 2026: ChatGPT's plain "GPT-6" (gpt-6, -thinking, -instant) is
  // GPT-6 Sol on paid plans per OpenAI's help article ("GPT-6 Sol powers Instant, Medium, High,
  // and Extra High"). gpt-6-mini and gpt-6-t-mini have no source yet and keep their stand-in.
  "gpt-6": "chatgpt-gpt-6-sol",
  "gpt-6-1-sol": "chatgpt-gpt-6-1-sol",
  "gpt-6-sol": "chatgpt-gpt-6-sol",
  "gpt-6-luna": "chatgpt-gpt-6-luna",
  "gpt-6-astra": "chatgpt-gpt-6-astra",
  "gpt-6-pro": "chatgpt-gpt-6-pro",
  "gpt-5-6": "chatgpt-gpt-5-6-sol",
  "gpt-5-6-sol": "chatgpt-gpt-5-6-sol",
  "gpt-5-6-terra": "chatgpt-gpt-5-6-terra",
  "gpt-5-6-luna": "chatgpt-gpt-5-6-luna",
  "gpt-5-6-mini": "chatgpt-gpt-5-6-luna",
  "gpt-5-6-t-mini": "chatgpt-gpt-5-6-luna",
  "gpt-5-6-pro": "chatgpt-gpt-5-6-sol-pro",
  "gpt-5-5": "chatgpt-gpt-5-5",
  "gpt-5-5-pro": "chatgpt-gpt-5-5-pro",
  "gpt-5-5-mini": "chatgpt-gpt-5-5-mini",
  "gpt-5-4": "chatgpt-gpt-5-4",
  "gpt-5-4-pro": "chatgpt-gpt-5-4-pro",
  "gpt-5-4-mini": "chatgpt-gpt-5-4-mini",
  "gpt-5-4-t-mini": "chatgpt-gpt-5-4-mini",
  "gpt-5-3-mini": "chatgpt-gpt-5-3-mini",
  "gpt-5-2": "chatgpt-gpt-5-2",
  "gpt-5-2-pro": "chatgpt-gpt-5-2-pro",
  "gpt-5-1": "chatgpt-gpt-5-1",
  "gpt-5": "chatgpt-gpt-5",
  "gpt-5-mini": "chatgpt-gpt-5-mini",
  "gpt-5-t-mini": "chatgpt-gpt-5-mini",
  "gpt-5-pro": "chatgpt-gpt-5-pro",
  "gpt-4-1": "chatgpt-gpt-4-1",
  "gpt-4-1-mini": "chatgpt-gpt-4-1-mini",
  "gpt-4o": "chatgpt-gpt-4o",
  "gpt-4o-mini": "chatgpt-gpt-4o-mini",
  "gpt-4": "chatgpt-gpt-4",
  "text-davinci-002-render-sha": "chatgpt-gpt-3-5",
  o1: "chatgpt-o1",
  o3: "chatgpt-o3",
  "o3-pro": "chatgpt-o3-pro",
  "o3-mini": "chatgpt-o3-mini",
  "o3-mini-high": "chatgpt-o3-mini",
  "o4-mini": "chatgpt-o4-mini",
  "o4-mini-high": "chatgpt-o4-mini",
  "chat-latest": "chatgpt-latest",
  // Routes that name no model of their own (B2). A Deep Research report names its model
  // separately (`gpt-5-thinking`), which resolves through the variant rule below.
  research: "chatgpt-deep-research",
  bidi: "chatgpt-voice-bidi",
});
// Effort variants of one model share its record (B4). Owner decision of 14 October 2026: a
// reasoning word is a setting of the model, not another model, so it is removed before any
// family or variant check too. Only words seen in ChatGPT slugs are listed ("high" in
// o3-mini-high); a slug the table lists keeps its own entry.
const CHATGPT_VARIANT = /-(?:instant|thinking|auto-thinking|high)$/;

// Owner decision of 13 October 2026: a version the registry does not list yet, of a family the
// label names, is estimated with that family's newest record (config/estimation.build.json),
// not with the provider's flagship. Labels without a family keep the site's unlisted id.
// Only version numbers may accompany the family name: the family's plain record would misstate
// a variant such as "-mini". Effort and speed suffixes that run the same model are removed
// before this check, and "-pro" names Pro reasoning of the family model (CHATGPT_PRO).
const CHATGPT_FAMILY: Readonly<Record<string, ModelId>> = Object.freeze({
  sol: "chatgpt-gpt-sol-unlisted",
  astra: "chatgpt-gpt-astra-unlisted",
  luna: "chatgpt-gpt-luna-unlisted",
  terra: "chatgpt-gpt-terra-unlisted",
});
// Owner decision of 14 October 2026: one variant word after the version (and an optional
// family) names a variant, estimated with the same variant's newest record: GPT-6 Luna mini
// uses GPT-5.4 mini. Any other word, such as "-image" (OpenAI has no image record) or two
// variant words, keeps the site's unlisted id. The variant tables per vendor are MODEL_VARIANTS
// in packages/estimator/src/family-stand-ins.ts. A Pro after a family name is not a variant
// (CHATGPT_PRO); only a Pro of a generation without a known family (GPT-7 Pro) uses GPT Pro.
const GPT_VARIANT: Readonly<Record<string, ModelId>> = Object.freeze({
  pro: "chatgpt-gpt-pro-unlisted",
  mini: "chatgpt-gpt-mini-unlisted",
  // The thinking mini ("gpt-5-4-t-mini") is the mini model (B4).
  "t-mini": "chatgpt-gpt-mini-unlisted",
  nano: "chatgpt-gpt-nano-unlisted",
  codex: "chatgpt-gpt-codex-unlisted",
});
// Owner correction of 14 October 2026: "gpt-6-sol-pro is not a different underlying model from
// GPT-6 Sol. It is GPT-6 Sol running with reasoning.mode set to pro." A Pro after a GPT family
// name is that family model at its version, under its Pro reasoning id so Details names the
// mode. It uses the family model's record: Pro reasoning writes more reasoning output, which is
// counted as far as the page shows it, so no multiplier applies.
const CHATGPT_PRO: Readonly<Record<string, ModelId>> = Object.freeze({
  "chatgpt-gpt-6-1-sol": "chatgpt-gpt-6-1-sol-pro",
  "chatgpt-gpt-6-sol": "chatgpt-gpt-6-sol-pro",
  "chatgpt-gpt-6-luna": "chatgpt-gpt-6-luna-pro",
  // OpenAI's help page: GPT-6 Pro in ChatGPT is GPT-6 Astra through the Pro reasoning option.
  "chatgpt-gpt-6-astra": "chatgpt-gpt-6-pro",
  "chatgpt-gpt-5-6-sol": "chatgpt-gpt-5-6-sol-pro",
  "chatgpt-gpt-5-6-luna": "chatgpt-gpt-5-6-luna-pro",
  "chatgpt-gpt-5-6-terra": "chatgpt-gpt-5-6-terra-pro",
  "chatgpt-gpt-sol-unlisted": "chatgpt-gpt-sol-pro-unlisted",
  "chatgpt-gpt-astra-unlisted": "chatgpt-gpt-astra-pro-unlisted",
  "chatgpt-gpt-luna-unlisted": "chatgpt-gpt-luna-pro-unlisted",
  "chatgpt-gpt-terra-unlisted": "chatgpt-gpt-terra-pro-unlisted",
});
// The family that a Pro without a family name runs on, by GPT generation: GPT-6 Pro is GPT-6
// Astra, so an unlisted GPT-6.2 Pro is taken as Astra too. A generation not listed here names
// no known family and keeps the GPT Pro variant.
const GPT_PRO_FAMILY: Readonly<Record<string, string>> = Object.freeze({
  "6": "astra",
});

/** The family label a Pro label runs on ("gpt-6-2-pro" is "gpt-6-2-astra"), if any. */
function proFamilyLabel(base: string): string | undefined {
  const named = base.match(/^(gpt-(?:\d+-)*(?:sol|astra|luna|terra))-pro$/)?.[1];
  if (named) return named;
  const version = base.match(/^gpt-(\d+)((?:-\d+)*)-pro$/);
  return version && Object.hasOwn(GPT_PRO_FAMILY, version[1]!)
    ? `gpt-${version[1]}${version[2]}-${GPT_PRO_FAMILY[version[1]!]}`
    : undefined;
}

function chatgpt(raw: string): ModelLabel | null {
  const slug = raw.trim().toLowerCase().replace(/-wm$/, "").replace(/\./g, "-");
  // "auto" is the request, not the model that answered (B0).
  if (slug === "auto" || slug === "") return null;
  const base = withoutWords(slug, CHATGPT_VARIANT);
  const id = lookup(CHATGPT, slug) ?? lookup(CHATGPT, base);
  if (id) return label(id);
  const proFamily = proFamilyLabel(base);
  const plain = proFamily ? chatgpt(proFamily) : null;
  const pro = plain && lookup(CHATGPT_PRO, plain.id);
  if (plain && pro) return label(pro, plain.unlisted);
  const family = base.match(/^gpt-(?:\d+-)*(sol|astra|luna|terra)$/)?.[1];
  const variant = base.match(
    /^gpt-(?:\d+-)*(?:(?:sol|astra|luna|terra)-)?((?:t-)?mini|pro|nano|codex)$/,
  )?.[1];
  return label(
    (family && lookup(CHATGPT_FAMILY, family)) ||
      (variant && lookup(GPT_VARIANT, variant)) ||
      "chatgpt-unlisted",
    true,
  );
}

const CLAUDE_FAMILY: Readonly<Record<string, ModelId>> = Object.freeze({
  opus: "claude-opus-unlisted",
  sonnet: "claude-sonnet-unlisted",
  haiku: "claude-haiku-unlisted",
  fable: "claude-fable-unlisted",
});

/** Dated ids, consumer suffixes and the older "claude-3-5-sonnet" order map to one id. */
function claude(raw: string): ModelLabel | null {
  let id = raw.trim().toLowerCase();
  if (id === "") return null;
  // `-fast` is the same model served faster; the measured time is kept (B4). Owner decision of
  // 14 October 2026: `-thinking` is a reasoning setting of the same model, as on Perplexity
  // (`claude55sonnetthinking`), so `claude-haiku-6-thinking` is an unlisted Claude Haiku.
  // Anthropic's catalog records have no thinking model of their own.
  id = withoutWords(
    id.replace(/-claude-ai$/, ""),
    /-(?:fast|thinking|20\d{6}|latest)$/,
  );
  const legacy = id.match(/^claude-(\d)(?:-(\d))?-(opus|sonnet|haiku)$/);
  if (legacy)
    id = `claude-${legacy[3]}-${legacy[1]}${legacy[2] ? `-${legacy[2]}` : ""}`;
  const family = id.match(/^claude-([a-z]+)(?:-|$)/)?.[1];
  const unlisted = family ? lookup(CLAUDE_FAMILY, family) : undefined;
  if (unlisted && known.has(id) && !id.endsWith("-unlisted"))
    return label(id as ModelId);
  // A word after the version names a variant (see CHATGPT_FAMILY and GPT_VARIANT). The
  // catalog has no small Claude variant, so a mini, nano or lite variant of a known family
  // uses Claude Haiku, Anthropic's small model; any other word keeps claude-unlisted.
  const versionOnly = /^claude-[a-z]+(?:-\d+)*$/.test(id);
  const small = /^claude-[a-z]+(?:-\d+)*-(?:mini|nano|lite)$/.test(id);
  return label(
    (unlisted && (versionOnly ? unlisted : small && "claude-small-unlisted")) ||
      "claude-unlisted",
    true,
  );
}

// Gemini shows a label, not an id: "3.6 Flash (New)", "Nano Banana 2", "Gemini Omni 1.1 Flash".
const GEMINI: Readonly<Record<string, ModelId>> = Object.freeze({
  "3.8 flash": "gemini-3-8-flash",
  "3.7 flash": "gemini-3-7-flash",
  "3.6 flash": "gemini-3-6-flash",
  // The same model with more thinking (B4).
  "3.6 thinking": "gemini-3-6-thinking",
  "extended thinking": "gemini-3-6-thinking",
  "3.5 flash": "gemini-3-5-flash",
  "3.5 flash-lite": "gemini-3-5-flash-lite",
  "3.1 pro": "gemini-3-1-pro",
  "3 pro": "gemini-3-pro",
  "3.0 pro": "gemini-3-pro",
  "3 flash": "gemini-3-flash",
  "3.0 flash": "gemini-3-flash",
  "2.5 flash": "gemini-2-5-flash",
  "2.5 flash-lite": "gemini-2-5-flash-lite",
  "2.5 pro": "gemini-2-5-pro",
  "nano banana": "gemini-nano-banana",
  "nano banana 2": "gemini-nano-banana-2",
  "nano banana 2 lite": "gemini-nano-banana-2-lite",
  "nano banana pro": "gemini-nano-banana-pro",
  "deep think": "gemini-deep-think",
  "deep research": "gemini-deep-research",
});

function gemini(raw: string): ModelLabel | null {
  const text = raw
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^gemini /, "");
  if (text === "") return null;
  // Gemini Omni has no EcoLogits record; its text uses the Google benchmark (B2).
  if (/^omni\b/.test(text)) return label("gemini-omni");
  if (/^lyria\b/.test(text)) return label("gemini-lyria");
  const id = lookup(GEMINI, text);
  if (id) return label(id);
  // Owner decision of 14 October 2026: "Thinking" is a reasoning setting, not another model.
  // The table's "3.6 Thinking" is 3.6 Flash with more thinking (B4), so a version with only
  // "Thinking" names that version's Flash, and "3.8 Pro Thinking" names 3.8 Pro.
  const thinking = text.match(/^(.+?) (?:extended )?thinking$/)?.[1];
  if (thinking)
    return gemini(/^\d+(?:\.\d+)?$/.test(thinking) ? `${thinking} flash` : thinking);
  // Only a plain "<version> <family>" label names a family; "Nano Banana Pro 3" does not.
  const family = text.match(/^(?:\d+(?:\.\d+)? )?(flash[- ]lite|flash|pro)$/)?.[1];
  if (family)
    return label(
      family === "flash"
        ? "gemini-flash-unlisted"
        : family === "pro"
          ? "gemini-pro-unlisted"
          : "gemini-flash-lite-unlisted",
      true,
    );
  // Owner decision of 14 October 2026: an unknown image model uses the newest record of its
  // image variant ("3 Pro Image", "Nano Banana Pro 3"), or the newest image record when the
  // label names no Pro or Flash size (see GPT_VARIANT).
  const image = text.match(/^(?:\d+(?:\.\d+)? )?(?:(flash[- ]lite|flash|pro) )?image$/);
  if (image) return label(geminiImage(image[1] ?? ""), true);
  const banana = text.match(/^nano banana\b(.*)$/)?.[1];
  if (banana !== undefined)
    return label(
      geminiImage(/^(?: \d+(?:\.\d+)?)* pro(?: \d+(?:\.\d+)?)*$/.test(banana) ? "pro" : ""),
      true,
    );
  return label("gemini-unlisted", true);
}

/** The unlisted image id of a Gemini size: Pro, Flash, or none that the catalog has. */
function geminiImage(size: string): ModelId {
  return size === "pro"
    ? "gemini-pro-image-unlisted"
    : size === "flash"
      ? "gemini-flash-image-unlisted"
      : "gemini-image-unlisted";
}

// Perplexity protocol ids from `display_model` and the generated video's `model_str`
// (B0, B8). Labels follow Perplexity's own names in /rest/models/config: for example
// `claude2` and `claude37sonnetthinking` are listed as Claude Sonnet 4.0.
const PERPLEXITY: Readonly<Record<string, ModelId>> = Object.freeze({
  turbo: "perplexity-best",
  pplx_pro: "perplexity-best",
  pplx_pro_upgraded: "perplexity-best",
  experimental: "perplexity-sonar-2",
  pplx_alpha: "perplexity-deep-research",
  pplx_beta: "perplexity-create-files",
  pplx_study: "perplexity-study",
  pplx_agentic_research: "perplexity-agentic-research",
  comet_browser_agent: "perplexity-comet",
  comet_browser_agent_sonnet: "perplexity-claude-sonnet-5",
  comet_browser_agent_opus: "perplexity-claude-opus-4-8",
  gpt6_1_sol: "perplexity-gpt-6-1-sol",
  gpt6_sol: "perplexity-gpt-6-sol",
  gpt56_sol: "perplexity-gpt-5-6-sol",
  gpt56_terra: "perplexity-gpt-5-6-terra",
  gpt55: "perplexity-gpt-5-5",
  gpt54: "perplexity-gpt-5-4",
  gpt52: "perplexity-gpt-5-2",
  gpt52_pro: "perplexity-gpt-5-2-pro",
  gpt51: "perplexity-gpt-5-1",
  gpt5: "perplexity-gpt-5",
  gpt5_mini: "perplexity-gpt-5-mini",
  gpt5_nano: "perplexity-gpt-5-nano",
  gpt5_pro: "perplexity-gpt-5-pro",
  gpt41: "perplexity-gpt-4-1",
  gpt4o: "perplexity-gpt-4o",
  o4mini: "perplexity-o4-mini",
  o3pro: "perplexity-o3-pro",
  claude55opus: "perplexity-claude-opus-5-5",
  claude55sonnet: "perplexity-claude-sonnet-5-5",
  claude50opus: "perplexity-claude-opus-5",
  claude50sonnet: "perplexity-claude-sonnet-5",
  claude48opus: "perplexity-claude-opus-4-8",
  claude47opus: "perplexity-claude-opus-4-7",
  claude46opus: "perplexity-claude-opus-4-6",
  claude45opus: "perplexity-claude-opus-4-5",
  claude41opus: "perplexity-claude-opus-4-1",
  claude40opus: "perplexity-claude-opus-4",
  claude46sonnet: "perplexity-claude-sonnet-4-6",
  claude45sonnet: "perplexity-claude-sonnet-4-5",
  claude40sonnet: "perplexity-claude-sonnet-4",
  claude37sonnet: "perplexity-claude-sonnet-4",
  claude2: "perplexity-claude-sonnet-4",
  claude45haiku: "perplexity-claude-haiku-4-5",
  gemini38flash: "perplexity-gemini-3-8-flash",
  gemini37flash: "perplexity-gemini-3-7-flash",
  gemini35flash: "perplexity-gemini-3-5-flash",
  gemini31pro: "perplexity-gemini-3-1-pro",
  gemini30pro: "perplexity-gemini-3-pro",
  gemini30flash: "perplexity-gemini-3-flash",
  gemini25pro: "perplexity-gemini-2-5-pro",
  glm_5_3: "perplexity-glm-5-3",
  glm_5_2: "perplexity-glm-5-2",
  kimik3: "perplexity-kimi-k3",
  kimik2: "perplexity-kimi",
  kimik25: "perplexity-kimi",
  kimik26: "perplexity-kimi",
  grok46: "perplexity-grok-4-6",
  grok47: "perplexity-grok",
  grok45: "perplexity-grok",
  grok41: "perplexity-grok",
  grok4: "perplexity-grok",
  grok: "perplexity-grok",
  nv_nemotron_3_ultra: "perplexity-nemotron-3-ultra",
  nv_nemotron_3_super: "perplexity-nemotron",
  nanobananapro: "perplexity-nano-banana-pro",
  nanobanana2: "perplexity-nano-banana-2",
  nanobanana: "perplexity-nano-banana",
  // D3: the video's own `model_str` wins over the picker id.
  veo31: "perplexity-veo-3-1",
  veo31fast: "perplexity-veo-3-1-fast",
  veo3: "perplexity-veo-3-0",
  veo3fast: "perplexity-veo-3-0-fast",
  veo3_fast: "perplexity-veo-3-0-fast",
  sora2: "perplexity-sora-2-pro",
  sora2pro: "perplexity-sora-2-pro",
});
// Computer ids name their orchestrator (`computer_harness`); `_fast` runs the same model.
const COMPUTER: Readonly<Record<string, ModelId>> = Object.freeze({
  "": "perplexity-claude-opus-5-5",
  opus: "perplexity-claude-opus-5-5",
  opus_thinking: "perplexity-claude-opus-4-8",
  sonnet: "perplexity-claude-sonnet-5-5",
  sonnet_thinking: "perplexity-claude-sonnet-5",
  fable_5: "perplexity-claude-fable-5-1",
  astra: "perplexity-gpt-6-astra",
  gpt_6_1_sol: "perplexity-gpt-6-1-sol",
  gpt_6_sol: "perplexity-gpt-6-sol",
  gpt_56_sol: "perplexity-gpt-5-6-sol",
  gpt_55: "perplexity-gpt-5-5",
  gpt54: "perplexity-gpt-5-4",
  gemini_3_8_flash: "perplexity-gemini-3-8-flash",
  glm_5_3: "perplexity-glm-5-3",
  glm: "perplexity-glm-5-2",
  kimi_k3: "perplexity-kimi-k3",
  kimi: "perplexity-kimi",
  qwen: "perplexity-qwen",
  grok: "perplexity-grok",
  grok_46: "perplexity-grok-4-6",
  grok_45: "perplexity-grok",
  deepseek_v4_pro: "perplexity-deepseek",
});
// Thinking and effort variants answer with their base model (B4). Owner decision of 14 October
// 2026: "_fast" is a speed setting on every id, not only on Computer ids, so `gpt6_sol_fast` is
// GPT-6 Sol. Ids the tables list keep their own entry (`veo3_fast` is Veo 3 Fast, a video
// record of its own), because each step looks the id up before removing a word.
const PERPLEXITY_VARIANT =
  /(?:_low_thinking|_?nonthinking|_?thinking|nonreasoning|reasoning|_?instant|_?low|_?medium|_?high|_fast)$/;

const PERPLEXITY_FAMILY: Readonly<Record<string, ModelId>> = Object.freeze({
  opus: "perplexity-claude-opus-unlisted",
  sonnet: "perplexity-claude-sonnet-unlisted",
  haiku: "perplexity-claude-haiku-unlisted",
  fable: "perplexity-claude-fable-unlisted",
  flash: "perplexity-gemini-flash-unlisted",
  flashlite: "perplexity-gemini-flash-lite-unlisted",
  pro: "perplexity-gemini-pro-unlisted",
  sol: "perplexity-gpt-sol-unlisted",
  astra: "perplexity-gpt-astra-unlisted",
  luna: "perplexity-gpt-luna-unlisted",
  terra: "perplexity-gpt-terra-unlisted",
});

// Variant words of unknown Perplexity ids by vendor (owner decision of 14 October 2026, see
// GPT_VARIANT). A Claude variant needs its family named; GPT variants share one id per variant.
const PERPLEXITY_CLAUDE_VARIANT: Readonly<Record<string, ModelId>> =
  Object.freeze({
    mini: "perplexity-claude-small-unlisted",
    nano: "perplexity-claude-small-unlisted",
    lite: "perplexity-claude-small-unlisted",
  });
const PERPLEXITY_GPT_VARIANT: Readonly<Record<string, ModelId>> = Object.freeze({
  pro: "perplexity-gpt-pro-unlisted",
  mini: "perplexity-gpt-mini-unlisted",
  nano: "perplexity-gpt-nano-unlisted",
  codex: "perplexity-gpt-codex-unlisted",
});
// Pro reasoning of a GPT family model on Perplexity (`gpt6_sol_pro`), see CHATGPT_PRO.
const PERPLEXITY_PRO: Readonly<Record<string, ModelId>> = Object.freeze({
  "perplexity-gpt-6-1-sol": "perplexity-gpt-6-1-sol-pro",
  "perplexity-gpt-6-sol": "perplexity-gpt-6-sol-pro",
  "perplexity-gpt-6-astra": "perplexity-gpt-6-astra-pro",
  "perplexity-gpt-5-6-sol": "perplexity-gpt-5-6-sol-pro",
  "perplexity-gpt-5-6-terra": "perplexity-gpt-5-6-terra-pro",
  "perplexity-gpt-sol-unlisted": "perplexity-gpt-sol-pro-unlisted",
  "perplexity-gpt-astra-unlisted": "perplexity-gpt-astra-pro-unlisted",
  "perplexity-gpt-luna-unlisted": "perplexity-gpt-luna-pro-unlisted",
  "perplexity-gpt-terra-unlisted": "perplexity-gpt-terra-pro-unlisted",
});

/**
 * The family id a Perplexity Pro id runs on (`gpt6_sol_pro` is `gpt6_sol`, `gpt6_2_pro` is
 * `gpt6_2_astra` by GPT_PRO_FAMILY), if any. `id` has no thinking or effort suffix.
 */
function perplexityProFamily(id: string): string | undefined {
  // GPT family names are common words, so they count only in a GPT or Computer id.
  if (!/gpt|^pplx_asi/.test(id)) return undefined;
  const named = id.match(/^(.*(?:sol|astra|luna|terra))_?pro$/)?.[1];
  if (named) return named;
  const version = id.match(/^gpt(\d)([\d_]*?)_?pro$/);
  return version && Object.hasOwn(GPT_PRO_FAMILY, version[1]!)
    ? `gpt${version[1]}${version[2]}_${GPT_PRO_FAMILY[version[1]!]}`
    : undefined;
}
/** The unlisted image id of a Gemini size on Perplexity (see geminiImage). */
const perplexityImage = (size: string): ModelId =>
  size === "pro"
    ? "perplexity-gemini-pro-image-unlisted"
    : size === "flash"
      ? "perplexity-gemini-flash-image-unlisted"
      : "perplexity-gemini-image-unlisted";

/**
 * Unknown Perplexity ids of a named family (`claude55haiku`, `gemini40flash`, `gpt6_2_sol`)
 * use that family's newest record, ids of a family with Pro reasoning (`gpt6_sol_pro`) the
 * family model's Pro reasoning id, and ids of a named variant (`gpt7pro`, `gemini3proimage`,
 * `claude60sonnetmini`) that variant's stand-in. Claude and Gemini ids without either use their
 * vendor's provider default, and other ids the unknown-provider benchmark. `id` has no
 * thinking, effort or `_fast` suffix.
 */
function perplexityFamily(id: string): ModelLabel {
  const proFamily = perplexityProFamily(id);
  const plain = proFamily ? perplexity(proFamily) : null;
  const pro = plain && lookup(PERPLEXITY_PRO, plain.id);
  if (plain && pro) return label(pro, plain.unlisted);
  const bare = id.replace(/^pplx_asi_?/, "");
  const found = (
    vendor: string,
    family: RegExp,
    fallback: ModelId,
    variant: (family: string, word: string) => ModelId | undefined,
  ) => {
    const match = family.exec(bare);
    // Besides the vendor and family names only version digits and at most one variant word
    // may remain (see CHATGPT_FAMILY).
    const rest = match
      ? bare.slice(0, match.index) + bare.slice(match.index + match[0].length)
      : bare;
    const word = rest.replace(vendor, "").replace(/[\d_.-]/g, "");
    const name = (match?.[1] ?? match?.[0] ?? "").replace(/[_-]/g, "");
    // A variant word counts only beside the vendor's or a family's name.
    const named = !!match || bare.includes(vendor);
    const resolved =
      word === ""
        ? lookup(PERPLEXITY_FAMILY, name)
        : named
          ? variant(name, word)
          : undefined;
    return label(resolved || fallback, true);
  };
  if (/claude|opus|sonnet|haiku|fable/.test(id))
    return found(
      "claude",
      /opus|sonnet|haiku|fable/,
      "perplexity-unlisted-anthropic",
      (family, word) =>
        family ? lookup(PERPLEXITY_CLAUDE_VARIANT, word) : undefined,
    );
  // Nano Banana is Gemini's image line; only a Pro size is named by the catalog's records.
  const banana = id.match(/^nanobanana(.*)$/)?.[1];
  if (banana !== undefined)
    return label(
      perplexityImage(/^[\d_]*pro[\d_]*$/.test(banana) ? "pro" : ""),
      true,
    );
  if (/gemini/.test(id))
    return found(
      "gemini",
      /flash_?-?lite|flash|pro/,
      "perplexity-unlisted-google",
      (family, word) => (word === "image" ? perplexityImage(family) : undefined),
    );
  // GPT family names are common words, so they count only in a GPT or Computer id.
  if (/gpt|^pplx_asi/.test(id))
    return found(
      "gpt",
      /(?:^|[^a-z])(sol|astra|luna|terra)(?:$|[^a-z])/,
      "perplexity-unlisted",
      (_family, word) => lookup(PERPLEXITY_GPT_VARIANT, word),
    );
  return label("perplexity-unlisted", true);
}

function perplexity(raw: string): ModelLabel | null {
  const id = raw.trim().toLowerCase();
  if (id === "") return null;
  // "_fast" runs the same orchestrator, so it is removed before the lookup.
  const orchestrator = id.replace(/_fast$/, "");
  const computer = orchestrator.match(/^pplx_asi(?:_(.+))?$/);
  if (computer) {
    const found = lookup(COMPUTER, computer[1] ?? "");
    return found
      ? label(found)
      : perplexityFamily(withoutWords(orchestrator, PERPLEXITY_VARIANT));
  }
  if (/^deepseek/.test(id)) return label("perplexity-deepseek");
  if (/^qwen/.test(id)) return label("perplexity-qwen");
  let key = id;
  for (let step = 0; step < 3; step++) {
    const found = lookup(PERPLEXITY, key);
    if (found) return label(found);
    const shorter = key.replace(PERPLEXITY_VARIANT, "");
    if (shorter === key) break;
    key = shorter;
  }
  // Without its thinking or effort suffix, so "gpt7astrathinking" still names Astra.
  return perplexityFamily(key);
}

/**
 * The registry id a site label names. A label the registry does not know becomes the
 * unlisted id of its model family or variant, estimated with that family's or variant's newest
 * record, or the site's unlisted id when it names neither, estimated with the provider default;
 * null means no model was named.
 */
export function resolveModelLabel(
  site: Site,
  raw: string | null,
): ModelLabel | null {
  // NotebookLM names no model anywhere; every feature uses the B3 stand-in, and Studio
  // images name the image stand-in themselves (D1).
  if (site === "notebooklm")
    return label(
      raw === "notebooklm-image" ? "notebooklm-image" : "notebooklm-default",
    );
  if (raw === null) return null;
  // A label that is already a registry id of this site passes through unchanged.
  if (raw.startsWith(site + "-") && known.has(raw))
    return label(raw as ModelId, raw.endsWith("-unlisted"));
  switch (site) {
    case "chatgpt":
      return chatgpt(raw);
    case "claude":
      return claude(raw);
    case "gemini":
      return gemini(raw);
    case "perplexity":
      return perplexity(raw);
    default:
      return null;
  }
}

export function normalizeModel(site: Site, raw: string | null): ModelId | null {
  return resolveModelLabel(site, raw)?.id ?? null;
}

/** The registry id of a generated video's own label; unknown ids use the stand-in (D3). */
export function resolveVideoModel(
  site: Site,
  raw: string | null,
): ModelId | null {
  // Gemini videos are Gemini Omni, which uses the Veo 3.1 stand-in.
  if (site === "gemini") return "gemini-omni-video";
  if (site !== "perplexity" || raw === null) return null;
  const found = perplexity(raw);
  return found && !found.unlisted && /^perplexity-(?:veo|sora)-/.test(found.id)
    ? found.id
    : "perplexity-video-unlisted";
}

/** A raw label that may be kept as a local diagnostic, or null when it is not label-like. */
export function storableModelLabel(raw: string | null): string | null {
  const value = raw?.trim() ?? "";
  return MODEL_LABEL_PATTERN.test(value) ? value : null;
}

/** The unknown, storable label of a resolution, if any. */
export function unknownModelLabel(
  resolved: ModelLabel | null,
  raw: string | null,
): string | null {
  return resolved?.unlisted ? storableModelLabel(raw) : null;
}

/**
 * Keeps labels the registry does not know in this browser so Details can name them. They
 * never leave the browser; the reply itself carries only the site's unlisted id.
 */
export async function keepUnknownModelLabels(
  repository: Pick<ApplicationRepository, "recordModelLabel" | "health">,
  namespace: string,
  site: Site,
  labels: Iterable<string>,
): Promise<void> {
  for (const value of labels)
    try {
      await repository.recordModelLabel(namespace, site, value);
    } catch {
      // A lost diagnostic must not stop counting; the reply still says the model is not
      // in the library. The failure is reported like any other local write failure.
      await repository
        .health(namespace, "storage_write_failed")
        .catch(() => undefined);
      return;
    }
}
