import type { ModelId, Site, TokenMeasurement } from "@footprint/contracts";

/**
 * Uploaded image tokens (A7) follow each vendor's published API rule for the model that
 * answered, as published on 4 October 2026. The sites do not say how they resize uploads,
 * so the API default detail level is assumed; every value is an estimate, and a change to
 * any rule below needs a new profile id.
 *
 * Sources: OpenAI "Images and vision" (patch and tile rules, multipliers, model sizing
 * table); Anthropic "Vision" (28-pixel patches, the edge and token limits and the resize
 * that keeps the aspect ratio); Google "Media resolution" (Gemini 3 default of 1,120
 * tokens per image) and "Understand and count tokens" (258 tokens per 768-pixel tile).
 *
 * Origin: written for this project from the rules those documentation pages describe; no
 * vendor package or sample code is included. The OpenAI patch budget follows the
 * calculation steps in OpenAI's guide. `anthropicResizedSize` was rewritten on 20 October
 * 2026 from Anthropic's written resize rules, with the same results as before
 * (`test/image-resize-pin.test.ts`).
 */
export const IMAGE_INPUT_PROFILE_ID = "vendor-image-rules-1" as const;

export interface ImageSize {
  readonly width: number | null;
  readonly height: number | null;
}

export type ImageInputRule =
  /** OpenAI 32-pixel patches; the multiplier is in hundredths so tokens stay exact. */
  | {
      readonly kind: "openai_patches";
      readonly maxDimension: number;
      readonly budget: number | null;
      readonly multiplier: number;
    }
  /** OpenAI 512-pixel tiles after fitting 2048 pixels and a 768-pixel shortest side. */
  | {
      readonly kind: "openai_tiles";
      readonly base: number;
      readonly tile: number;
    }
  /** Anthropic 28-pixel patches after the resize to the model's edge and token limits. */
  | {
      readonly kind: "anthropic_patches";
      readonly maxEdge: number;
      readonly maxTokens: number;
    }
  /** Gemini 3: a fixed count per image at the default media resolution. */
  | { readonly kind: "fixed"; readonly tokens: number }
  /** Older Gemini: 258 tokens up to 384 pixels, otherwise 258 per 768-pixel tile. */
  | { readonly kind: "gemini_tiles" };

// Images past 30,000 patches are rejected by the API rather than resized. A site that
// accepts such an upload must have scaled it, so the estimate scales it to that limit.
const OPENAI_PATCH_LIMIT = 30_000;
// "original" detail, the auto default of these models: no resizing budget below the
// 65,535-pixel side limit.
const ORIGINAL = { maxDimension: 65_535, budget: null } as const;
const patches = (
  sizing: { maxDimension: number; budget: number | null },
  multiplier: number,
): ImageInputRule => ({ kind: "openai_patches", ...sizing, multiplier });
const tiles = (base: number, tile: number): ImageInputRule => ({
  kind: "openai_tiles",
  base,
  tile,
});

/** OpenAI models by registry name, at their auto detail level. */
const OPENAI: Readonly<Record<string, ImageInputRule>> = Object.freeze({
  "gpt-6-astra": patches(ORIGINAL, 120),
  "gpt-5-6-sol": patches(ORIGINAL, 120),
  "gpt-5-6-terra": patches(ORIGINAL, 120),
  "gpt-5-6-luna": patches(ORIGINAL, 120),
  // Auto is original detail: up to 10,000 patches and 6,000 pixels.
  "gpt-5-5": patches({ maxDimension: 6000, budget: 10_000 }, 120),
  // Auto is high detail: up to 2,500 patches and 2,048 pixels.
  "gpt-5-4": patches({ maxDimension: 2048, budget: 2500 }, 120),
  "gpt-5-4-mini": patches({ maxDimension: 2048, budget: 2500 }, 120),
  "gpt-5-4-nano": patches({ maxDimension: 2048, budget: 2500 }, 120),
  "gpt-5-2": patches({ maxDimension: 2048, budget: 6144 }, 120),
  "gpt-4-1-mini": patches({ maxDimension: 2048, budget: 6144 }, 162),
  // Retired patch models have a published multiplier but no sizing row; they use the
  // sizing of the other patch models of their generation.
  "gpt-5-mini": patches({ maxDimension: 2048, budget: 6144 }, 120),
  "gpt-5-nano": patches({ maxDimension: 2048, budget: 6144 }, 150),
  "o4-mini": patches({ maxDimension: 2048, budget: 6144 }, 172),
  "gpt-5-1": tiles(70, 140),
  "gpt-5": tiles(70, 140),
  "gpt-4o": tiles(85, 170),
  "gpt-4-1": tiles(85, 170),
  "gpt-4o-mini": tiles(2833, 5667),
  o1: tiles(75, 150),
  o3: tiles(75, 150),
});
// GPT-6.1 Sol, the OpenAI family benchmark (B2), is not listed; it uses the GPT-6 Astra
// row, as do OpenAI models with no row of their own.
const OPENAI_BENCHMARK = OPENAI["gpt-6-astra"]!;
// Claude 4.7 and later read images at high resolution.
const ANTHROPIC_HIGH: ImageInputRule = {
  kind: "anthropic_patches",
  maxEdge: 2576,
  maxTokens: 4784,
};
const ANTHROPIC_STANDARD: ImageInputRule = {
  kind: "anthropic_patches",
  maxEdge: 1568,
  maxTokens: 1568,
};
const GEMINI_3: ImageInputRule = { kind: "fixed", tokens: 1120 };
const GEMINI_OLDER: ImageInputRule = { kind: "gemini_tiles" };

function openai(name: string): ImageInputRule {
  // A variant without its own row (pro, mini, nano) reads images like its base model.
  return (
    OPENAI[name] ??
    OPENAI[name.replace(/-(?:pro|mini|nano)$/, "")] ??
    OPENAI_BENCHMARK
  );
}

function anthropic(name: string): ImageInputRule {
  const version = /^claude-[a-z]+-(\d+)(?:-(\d+))?$/.exec(name);
  // Ids that name no version (effort, thinking, unlisted) use the family benchmark,
  // Claude Opus 5.5.
  if (!version) return ANTHROPIC_HIGH;
  const major = Number(version[1]),
    minor = Number(version[2] ?? 0);
  return major > 4 || (major === 4 && minor >= 7)
    ? ANTHROPIC_HIGH
    : ANTHROPIC_STANDARD;
}

function google(name: string): ImageInputRule {
  // Gemini 2.5 and the first Nano Banana (Gemini 2.5 Flash Image) predate Gemini 3;
  // every other Gemini id, including unnamed ones, uses the Gemini 3.8 Flash benchmark.
  return /^gemini-2-/.test(name) || name === "gemini-nano-banana"
    ? GEMINI_OLDER
    : GEMINI_3;
}

/**
 * The image rule for the model that answered. Perplexity uses the answering model's
 * vendor; its own routes and other vendors use the OpenAI rule (B2). NotebookLM reads
 * images as sources, which are not counted (A5).
 */
export function imageInputRule(
  site: Site,
  model: ModelId | null,
): ImageInputRule | null {
  if (site === "notebooklm") return null;
  const name = model?.startsWith(`${site}-`)
    ? model.slice(site.length + 1)
    : null;
  if (site === "chatgpt") return name ? openai(name) : OPENAI_BENCHMARK;
  if (site === "claude") return anthropic(model ?? "");
  if (site === "gemini") return google(model ?? "");
  if (name === null) return OPENAI_BENCHMARK;
  if (name.startsWith("claude-")) return anthropic(name);
  if (name === "unlisted-anthropic") return ANTHROPIC_HIGH;
  if (name.startsWith("gemini-")) return google(name);
  if (name === "unlisted-google") return GEMINI_3;
  return /^(?:gpt-|o\d)/.test(name) ? openai(name) : OPENAI_BENCHMARK;
}

/** Rounds to the nearest integer and a half to the even one (banker's rounding). */
function roundHalfEven(value: number): number {
  const floor = Math.floor(value),
    rest = value - floor;
  if (rest !== 0.5) return rest < 0.5 ? floor : floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** Scales the long side to the limit; integer arithmetic keeps it exactly at the limit. */
function fitWithin(width: number, height: number, limit: number) {
  if (width <= limit && height <= limit) return { width, height };
  return width >= height
    ? {
        width: limit,
        height: Math.max(1, Math.floor((height * limit) / width)),
      }
    : {
        width: Math.max(1, Math.floor((width * limit) / height)),
        height: limit,
      };
}

const cover = (width: number, height: number, side: number) =>
  Math.ceil(width / side) * Math.ceil(height / side);

/** OpenAI patch tokens: fit the side limit, then the patch budget, then the multiplier. */
export function openaiPatchTokens(
  size: { width: number; height: number },
  rule: Extract<ImageInputRule, { kind: "openai_patches" }>,
): number {
  let { width, height } = fitWithin(size.width, size.height, rule.maxDimension);
  let count = cover(width, height, 32);
  const budget =
    rule.budget ?? (count > OPENAI_PATCH_LIMIT ? OPENAI_PATCH_LIMIT : null);
  if (budget !== null && count > budget) {
    const shrink = Math.sqrt((32 * 32 * budget) / (width * height));
    const scaledWidth = (width * shrink) / 32,
      scaledHeight = (height * shrink) / 32;
    const adjusted =
      shrink *
      Math.min(
        Math.floor(scaledWidth) / scaledWidth,
        Math.floor(scaledHeight) / scaledHeight,
      );
    width = Math.max(1, Math.floor(width * adjusted));
    height = Math.max(1, Math.floor(height * adjusted));
    count = cover(width, height, 32);
  }
  // The multiplier is in hundredths; ceil(count * m / 100) in integers is exact.
  return Math.ceil((count * rule.multiplier) / 100);
}

/** OpenAI tile tokens for high and auto detail. */
export function openaiTileTokens(
  size: { width: number; height: number },
  rule: Extract<ImageInputRule, { kind: "openai_tiles" }>,
): number {
  let { width, height } = fitWithin(size.width, size.height, 2048);
  if (Math.min(width, height) > 768)
    ({ width, height } =
      width <= height
        ? { width: 768, height: Math.floor((height * 768) / width) }
        : { width: Math.floor((width * 768) / height), height: 768 });
  return rule.base + cover(width, height, 512) * rule.tile;
}

/**
 * The size Claude scales an image to before counting its 28-pixel patches, for integer
 * sizes of at least 1 pixel.
 *
 * Anthropic's Vision guide: an image larger than the model's edge limit, or needing more
 * patches than its token limit, is scaled down with its aspect ratio kept until it is
 * within both. A side is read as whole patches, so it is within the edge limit when its
 * length rounded up to 28 pixels is. The result is the longest long edge below the
 * original whose short side, scaled to match, is within both limits. The short side is
 * rounded half to even and never below 1 pixel; profile vendor-image-rules-1 records
 * sizes with this rounding, so changing it needs a new profile id.
 */
export function anthropicResizedSize(
  width: number,
  height: number,
  maxEdge: number,
  maxTokens: number,
): { width: number; height: number } {
  const withinLimits = (w: number, h: number) =>
    Math.ceil(w / 28) * 28 <= maxEdge &&
    Math.ceil(h / 28) * 28 <= maxEdge &&
    cover(w, h, 28) <= maxTokens;
  if (withinLimits(width, height)) return { width, height };
  const landscape = width >= height;
  const long = landscape ? width : height,
    short = landscape ? height : width;
  const ratio = long / short;
  const shortSide = (edge: number) => Math.max(1, roundHalfEven(edge / ratio));
  // An edge longer than the last whole patch within the edge limit can never fit, so the
  // walk starts there. Both sides and the patch count only grow with the edge, so the
  // first edge that fits on the way down is the longest one. Edges are at most a few
  // thousand pixels, so the walk stays short.
  let edge = Math.min(long - 1, Math.floor(maxEdge / 28) * 28);
  while (edge > 1 && !withinLimits(edge, shortSide(edge))) edge--;
  edge = Math.max(edge, 1);
  return landscape
    ? { width: edge, height: shortSide(edge) }
    : { width: shortSide(edge), height: edge };
}

/** Tokens of one uploaded image, or null when the rule needs a size the page hides. */
export function imageInputTokens(
  rule: ImageInputRule,
  size: ImageSize,
): number | null {
  if (rule.kind === "fixed") return rule.tokens;
  if (size.width === null || size.height === null) return null;
  const known = { width: size.width, height: size.height };
  switch (rule.kind) {
    case "openai_patches":
      return openaiPatchTokens(known, rule);
    case "openai_tiles":
      return openaiTileTokens(known, rule);
    case "anthropic_patches": {
      const resized = anthropicResizedSize(
        known.width,
        known.height,
        rule.maxEdge,
        rule.maxTokens,
      );
      return cover(resized.width, resized.height, 28);
    }
    case "gemini_tiles":
      return known.width <= 384 && known.height <= 384
        ? 258
        : cover(known.width, known.height, 768) * 258;
  }
}

/** One image's tokens as a measurement; the detail level the site uses is unknown. */
export function imageInputMeasurement(
  rule: ImageInputRule | null,
  size: ImageSize,
): TokenMeasurement {
  const tokens = rule ? imageInputTokens(rule, size) : null;
  return tokens === null
    ? {
        value: null,
        evidence: "unknown",
        scope: "provider_defined_subset",
        completeness: "unknown",
        profile_id: null,
        reason: rule
          ? "image_dimensions_unknown"
          : "media_processing_unobserved",
      }
    : {
        value: String(tokens),
        evidence: "heuristic_estimate",
        scope: "provider_defined_subset",
        completeness: "complete_for_scope",
        profile_id: IMAGE_INPUT_PROFILE_ID,
        reason: "image_settings_unknown",
      };
}

/**
 * All uploaded images of one request. No images is not applicable rather than zero; an
 * image whose size the page hides leaves the total partial instead of silently lower.
 */
export function imageInputTotal(
  measurements: readonly TokenMeasurement[],
): TokenMeasurement {
  if (!measurements.length)
    return {
      value: null,
      evidence: "not_applicable",
      scope: "provider_defined_subset",
      completeness: "unknown",
      profile_id: null,
      reason: "not_applicable",
    };
  const known = measurements.filter((m) => m.value !== null);
  if (!known.length) return measurements[0]!;
  const missing = measurements.find((m) => m.value === null);
  return {
    value: known.reduce((sum, m) => sum + BigInt(m.value!), 0n).toString(),
    evidence: "heuristic_estimate",
    scope: "provider_defined_subset",
    completeness: missing ? "partial" : "complete_for_scope",
    profile_id: IMAGE_INPUT_PROFILE_ID,
    reason: missing ? missing.reason : "image_settings_unknown",
  };
}
