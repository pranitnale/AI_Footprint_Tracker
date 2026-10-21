import type {
  ModelOverride,
  UpstreamProfileReference,
} from "@footprint/contracts";

/**
 * Owner decision of 13 October 2026, replacing the provider-flagship rule of 16 September: a
 * model the registry does not list yet is estimated with the highest version of the same family
 * in the EcoLogits catalog, not with the provider's flagship. An unknown Claude Haiku 5.5 was
 * estimated as Claude Opus 5.5, about 40 times the Haiku 4.5 figure.
 *
 * Each family lists the registry ids that labels of that family become when the registry does
 * not know the version, and the record names of the family in the catalog. The stand-ins are
 * written into `config/estimation.build.json` as model overrides by
 * `tools/estimation-family-stand-ins.ts`, so the extension and the server read one table and the
 * method hash changes with it. A catalog that adds a newer version makes the check fail until
 * the table is generated again.
 *
 * A GPT family's Pro ids (`chatgpt-gpt-sol-pro-unlisted`) are the same family model with Pro
 * reasoning, so they share the family's stand-in (owner correction of 14 October 2026).
 */
export type ModelFamily = {
  readonly family: string;
  readonly provider: string;
  /** Registry ids of unknown labels of this family, one per site that names such models. */
  readonly ids: readonly string[];
  /**
   * Record names of this family with a major and an optional minor version. Dated snapshots,
   * aliases and variants such as `-codex`, `-image` or `-customtools` do not match.
   */
  readonly record: RegExp;
};

export const MODEL_FAMILIES: readonly ModelFamily[] = Object.freeze([
  {
    family: "claude-haiku",
    provider: "anthropic",
    ids: ["claude-haiku-unlisted", "perplexity-claude-haiku-unlisted"],
    record: /^claude-haiku-(\d+)(?:-(\d{1,2}))?$/,
  },
  {
    family: "claude-sonnet",
    provider: "anthropic",
    ids: ["claude-sonnet-unlisted", "perplexity-claude-sonnet-unlisted"],
    record: /^claude-sonnet-(\d+)(?:-(\d{1,2}))?$/,
  },
  {
    family: "claude-opus",
    provider: "anthropic",
    ids: ["claude-opus-unlisted", "perplexity-claude-opus-unlisted"],
    record: /^claude-opus-(\d+)(?:-(\d{1,2}))?$/,
  },
  {
    family: "claude-fable",
    provider: "anthropic",
    ids: ["claude-fable-unlisted", "perplexity-claude-fable-unlisted"],
    record: /^claude-fable-(\d+)(?:-(\d{1,2}))?$/,
  },
  {
    family: "gpt-sol",
    provider: "openai",
    ids: [
      "chatgpt-gpt-sol-unlisted",
      "perplexity-gpt-sol-unlisted",
      "chatgpt-gpt-sol-pro-unlisted",
      "perplexity-gpt-sol-pro-unlisted",
    ],
    record: /^gpt-(\d+)(?:\.(\d+))?-sol$/,
  },
  {
    family: "gpt-astra",
    provider: "openai",
    ids: [
      "chatgpt-gpt-astra-unlisted",
      "perplexity-gpt-astra-unlisted",
      "chatgpt-gpt-astra-pro-unlisted",
      "perplexity-gpt-astra-pro-unlisted",
    ],
    record: /^gpt-(\d+)(?:\.(\d+))?-astra$/,
  },
  {
    family: "gpt-luna",
    provider: "openai",
    ids: [
      "chatgpt-gpt-luna-unlisted",
      "perplexity-gpt-luna-unlisted",
      "chatgpt-gpt-luna-pro-unlisted",
      "perplexity-gpt-luna-pro-unlisted",
    ],
    record: /^gpt-(\d+)(?:\.(\d+))?-luna$/,
  },
  {
    family: "gpt-terra",
    provider: "openai",
    ids: [
      "chatgpt-gpt-terra-unlisted",
      "perplexity-gpt-terra-unlisted",
      "chatgpt-gpt-terra-pro-unlisted",
      "perplexity-gpt-terra-pro-unlisted",
    ],
    record: /^gpt-(\d+)(?:\.(\d+))?-terra$/,
  },
  {
    family: "gemini-flash",
    provider: "google_genai",
    ids: ["gemini-flash-unlisted", "perplexity-gemini-flash-unlisted"],
    record: /^gemini-(\d+)(?:\.(\d+))?-flash(?:-preview)?$/,
  },
  // Flash-Lite is a smaller model than Flash, so it is a family of its own.
  {
    family: "gemini-flash-lite",
    provider: "google_genai",
    ids: [
      "gemini-flash-lite-unlisted",
      "perplexity-gemini-flash-lite-unlisted",
    ],
    record: /^gemini-(\d+)(?:\.(\d+))?-flash-lite(?:-preview)?$/,
  },
  {
    family: "gemini-pro",
    provider: "google_genai",
    ids: ["gemini-pro-unlisted", "perplexity-gemini-pro-unlisted"],
    record: /^gemini-(\d+)(?:\.(\d+))?-pro(?:-preview)?$/,
  },
]);

/**
 * Owner decision of 14 October 2026, replacing the rule of 239a5e6e that left them unlisted: an
 * unknown variant of a model, such as `gpt-7-pro`, `gpt-6-luna-mini` or Gemini 3 Pro Image, is
 * estimated with the same variant of the highest version in the catalog (GPT-5.5 Pro for a GPT
 * Pro without a family today). When the catalog has no version of that variant, the highest
 * model of the same kind and vendor stands in: the newest image model for an image variant, and
 * Claude Haiku for a Claude mini, nano or lite variant, as Anthropic's catalog records have no
 * small variants. A stand-in is never of another vendor. Variants with neither (an OpenAI or Claude image model,
 * a Claude Pro) keep the site's unlisted id and the provider default.
 *
 * A variant id is shared by every family of its vendor: GPT Luna mini and GPT Sol mini are both
 * `chatgpt-gpt-mini-unlisted`. A Pro after a GPT family name is not a variant: owner correction
 * of 14 October 2026, "gpt-6-sol-pro is not a different underlying model from GPT-6 Sol. It is
 * GPT-6 Sol running with reasoning.mode set to pro", so it uses the family's ids (MODEL_FAMILIES).
 */
export type ModelVariant = {
  readonly variant: string;
  readonly provider: string;
  /** Registry ids of unknown labels of this variant, one per site that names such models. */
  readonly ids: readonly string[];
  /**
   * Record names of this variant with a major and an optional minor version. Absent when only
   * the kind applies (an image model whose size the label does not name).
   */
  readonly record?: RegExp;
  /** Record names of the same kind and vendor, used only when no record of the variant exists. */
  readonly kind?: RegExp;
};

const GPT_FAMILY = "(?:-(?:sol|astra|luna|terra))?";
const gptVariant = (variant: string) =>
  new RegExp(`^gpt-(\\d+)(?:\\.(\\d+))?${GPT_FAMILY}-${variant}$`);
const GEMINI_IMAGE = /^gemini-(\d+)(?:\.(\d+))?-[a-z-]*image(?:-preview)?$/;

export const MODEL_VARIANTS: readonly ModelVariant[] = Object.freeze([
  {
    variant: "gpt-pro",
    provider: "openai",
    ids: ["chatgpt-gpt-pro-unlisted", "perplexity-gpt-pro-unlisted"],
    // Only Pro records without a family name are Pro models of their own; a family Pro record
    // would be that family model with Pro reasoning (see above).
    record: /^gpt-(\d+)(?:\.(\d+))?-pro$/,
  },
  {
    variant: "gpt-mini",
    provider: "openai",
    ids: ["chatgpt-gpt-mini-unlisted", "perplexity-gpt-mini-unlisted"],
    record: gptVariant("mini"),
  },
  {
    variant: "gpt-nano",
    provider: "openai",
    ids: ["chatgpt-gpt-nano-unlisted", "perplexity-gpt-nano-unlisted"],
    record: gptVariant("nano"),
  },
  {
    variant: "gpt-codex",
    provider: "openai",
    ids: ["chatgpt-gpt-codex-unlisted", "perplexity-gpt-codex-unlisted"],
    record: gptVariant("codex"),
  },
  {
    variant: "claude-small",
    provider: "anthropic",
    ids: ["claude-small-unlisted", "perplexity-claude-small-unlisted"],
    record: /^claude-[a-z]+-(\d+)(?:-(\d{1,2}))?-(?:mini|nano|lite)$/,
    kind: /^claude-haiku-(\d+)(?:-(\d{1,2}))?$/,
  },
  {
    variant: "gemini-pro-image",
    provider: "google_genai",
    ids: ["gemini-pro-image-unlisted", "perplexity-gemini-pro-image-unlisted"],
    record: /^gemini-(\d+)(?:\.(\d+))?-pro-image(?:-preview)?$/,
    kind: GEMINI_IMAGE,
  },
  {
    variant: "gemini-flash-image",
    provider: "google_genai",
    ids: [
      "gemini-flash-image-unlisted",
      "perplexity-gemini-flash-image-unlisted",
    ],
    record: /^gemini-(\d+)(?:\.(\d+))?-flash-image(?:-preview)?$/,
    kind: GEMINI_IMAGE,
  },
  // An image model whose label names no Pro or Flash size, such as a Flash-Lite image model.
  {
    variant: "gemini-image",
    provider: "google_genai",
    ids: ["gemini-image-unlisted", "perplexity-gemini-image-unlisted"],
    kind: GEMINI_IMAGE,
  },
]);

export const FAMILY_STAND_IN_BASIS = "model_family_stand_in" as const;
export const VARIANT_STAND_IN_BASIS = "model_variant_stand_in" as const;
export const KIND_STAND_IN_BASIS = "model_kind_stand_in" as const;

type CatalogModel = { readonly provider: string; readonly name: string };
type Version = { major: number; minor: number; name: string };

/**
 * The record of the highest version that `pattern` matches among the provider's catalog records.
 * Equal versions prefer the shorter name, so a release wins over its `-preview`.
 */
function newest(
  provider: string,
  pattern: RegExp,
  models: Iterable<CatalogModel>,
): string | null {
  let best: Version | null = null;
  for (const model of models) {
    if (model.provider !== provider) continue;
    const match = pattern.exec(model.name);
    if (!match) continue;
    const candidate = {
      major: Number(match[1]),
      minor: Number(match[2] ?? 0),
      name: model.name,
    };
    if (!best || compare(candidate, best) > 0) best = candidate;
  }
  return best?.name ?? null;
}

/**
 * The highest version of the family among the catalog's text records, or null when the catalog
 * has none.
 */
export function familyStandIn(
  family: ModelFamily,
  models: Iterable<CatalogModel>,
): UpstreamProfileReference | null {
  const name = newest(family.provider, family.record, models);
  return name
    ? { provider: family.provider, model_name: name, workload: "text" }
    : null;
}

/**
 * The same variant's highest catalog version, else the highest model of the same kind, with the
 * basis that says which; null when the catalog has neither.
 */
export function variantStandIn(
  variant: ModelVariant,
  models: Iterable<CatalogModel>,
): {
  profile: UpstreamProfileReference;
  basis: typeof VARIANT_STAND_IN_BASIS | typeof KIND_STAND_IN_BASIS;
} | null {
  const list = [...models];
  const profile = (name: string): UpstreamProfileReference => ({
    provider: variant.provider,
    model_name: name,
    workload: "text",
  });
  const same =
    variant.record && newest(variant.provider, variant.record, list);
  if (same) return { profile: profile(same), basis: VARIANT_STAND_IN_BASIS };
  const kind =
    variant.kind && newest(variant.provider, variant.kind, list);
  return kind ? { profile: profile(kind), basis: KIND_STAND_IN_BASIS } : null;
}

/** Every registry id whose override the stand-in table generates. */
export function standInIds(): string[] {
  return [
    ...MODEL_FAMILIES.flatMap((family) => family.ids),
    ...MODEL_VARIANTS.flatMap((variant) => variant.ids),
  ];
}

function compare(a: Version, b: Version): number {
  return (
    a.major - b.major ||
    a.minor - b.minor ||
    b.name.length - a.name.length ||
    (a.name < b.name ? 1 : a.name > b.name ? -1 : 0)
  );
}

/** The model overrides of every family registry id, as the build configuration holds them. */
export function familyStandInOverrides(
  models: Iterable<CatalogModel>,
): Record<string, ModelOverride> {
  const list = [...models];
  const overrides: Record<string, ModelOverride> = {};
  for (const family of MODEL_FAMILIES) {
    const profile = familyStandIn(family, list);
    // A family without any record keeps the provider default; Details then says so.
    if (!profile) continue;
    for (const id of family.ids)
      overrides[id] = {
        strategy: "upstream_profile",
        profile: { ...profile },
        basis: FAMILY_STAND_IN_BASIS,
      };
  }
  return overrides;
}

/**
 * The model overrides of every family and variant registry id, as the build configuration holds
 * them. A variant without any record of its own or of its kind keeps the provider default.
 */
export function standInOverrides(
  models: Iterable<CatalogModel>,
): Record<string, ModelOverride> {
  const list = [...models];
  const overrides = familyStandInOverrides(list);
  for (const variant of MODEL_VARIANTS) {
    const found = variantStandIn(variant, list);
    if (!found) continue;
    for (const id of variant.ids)
      overrides[id] = {
        strategy: "upstream_profile",
        profile: { ...found.profile },
        basis: found.basis,
      };
  }
  return overrides;
}
