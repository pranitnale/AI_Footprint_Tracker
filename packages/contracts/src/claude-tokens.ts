import type { ClaudeTokenFactor } from "./engine-policy";
import {
  composeOutputTotal,
  OUTPUT_PARTS,
  TOKEN_FIELDS,
  type HistoryMessage,
  type HistoryParts,
  type Site,
  type TextComponent,
  type TokenFields,
  type TokenMeasurement,
} from "./index";

/**
 * Claude token factor (owner decision of 15 October 2026, `ClaudeTokenFactorSchema`).
 *
 * Stored counts stay what the tracker's tokenizer measured. The factor is applied where
 * figures are made from them: the estimate (only under a method whose definition names
 * the factor, so a method saved earlier keeps its own results) and the token figures in
 * Details, the dashboard and the organization's totals. Old records therefore show the
 * factor as soon as they are summed or recalculated, without a migration, and a later
 * change of the factor is a new method rather than a rewrite of stored counts.
 *
 * Rounding: each counted part is rounded half up on its own (integer arithmetic), and a
 * total is the sum of its rounded parts, so totals stay equal to the sum of their parts.
 * Mirrored by `claude_*` in `packages/contracts/python/footprint_contracts.py`.
 */

/**
 * Whether a message's text was written or read by a Claude model. Every model of
 * claude.ai and Claude Cowork is a Claude model; on Perplexity the registry id names the
 * vendor (`perplexity-claude-*`, the Computer orchestrators included, and the unlisted
 * Anthropic id). Other sites never serve Claude.
 */
export function claudeText(site: Site, modelId: string | null): boolean {
  if (site === "claude") return true;
  return (
    site === "perplexity" &&
    modelId !== null &&
    (modelId.startsWith("perplexity-claude-") ||
      modelId === "perplexity-unlisted-anthropic")
  );
}

/** The factor for a message, or null when its text is not Claude's. */
export function claudeFactorFor(
  site: Site,
  modelId: string | null,
  factor: ClaudeTokenFactor | null | undefined,
): ClaudeTokenFactor | null {
  return factor && claudeText(site, modelId) ? factor : null;
}

/** factor × count, rounded half up, in exact integer arithmetic. */
export function claudeTokenCount(
  value: string,
  factor: Pick<ClaudeTokenFactor, "factor">,
): string {
  const [whole, fraction = ""] = factor.factor.split(".");
  const numerator = BigInt(whole! + fraction);
  const denominator = 10n ** BigInt(fraction.length);
  return (
    (2n * BigInt(value) * numerator + denominator) /
    (2n * denominator)
  ).toString();
}

/**
 * One count with the factor applied. Only a known count of the factor's own tokenizer
 * profile changes: counts the provider reported, image token rules and unknown counts
 * stay as they are.
 */
export function claudeMeasurement<
  M extends Pick<TokenMeasurement, "value" | "profile_id"> & {
    evidence: string;
  },
>(measurement: M, factor: ClaudeTokenFactor | null): M {
  if (
    !factor ||
    measurement.value === null ||
    measurement.evidence !== "heuristic_estimate" ||
    measurement.profile_id !== factor.tokenizer_profile_id
  )
    return measurement;
  return { ...measurement, value: claudeTokenCount(measurement.value, factor) };
}

/**
 * A reply's token fields with the factor applied to each part. The output total is the
 * sum of the corrected parts, as it is the sum of the parts it was stored with; a total
 * the provider reported stays.
 */
export function claudeTokenFields(
  tokens: TokenFields,
  factor: ClaudeTokenFactor | null,
): TokenFields {
  if (!factor) return tokens;
  const corrected = Object.fromEntries(
    TOKEN_FIELDS.map((field) => [field, claudeMeasurement(tokens[field], factor)]),
  ) as TokenFields;
  corrected.output_total =
    tokens.output_total.evidence === "provider_reported"
      ? tokens.output_total
      : composeOutputTotal(corrected);
  return corrected;
}

/** Output of other models in a reply, each corrected when that model is Claude. */
export function claudeTextComponents(
  site: Site,
  components: readonly TextComponent[],
  factor: ClaudeTokenFactor | null | undefined,
): TextComponent[] {
  return components.map((component) => {
    const own = claudeFactorFor(site, component.model_id, factor);
    return own
      ? { ...component, tokens: claudeMeasurement(component.tokens, own) }
      : component;
  });
}

/**
 * A saved message's counts with the factor applied: its parts one by one and its total
 * as their sum (a reply) or as its own corrected count (a prompt). Other models' output
 * and inline file text follow their own model and the message's site.
 */
export function claudeHistoryMessage<
  T extends Pick<
    HistoryMessage,
    | "site"
    | "role"
    | "model_id"
    | "tokens"
    | "parts"
    | "generation"
    | "inline_file_text"
  >,
>(record: T, factor: ClaudeTokenFactor | null | undefined): T {
  if (!factor) return record;
  const own = claudeFactorFor(record.site, record.model_id, factor);
  const parts: HistoryParts | null =
    own && record.parts
      ? (Object.fromEntries(
          Object.entries(record.parts).map(([part, measurement]) => [
            part,
            claudeMeasurement(measurement, own),
          ]),
        ) as HistoryParts)
      : record.parts;
  const tokens =
    !own || record.tokens.evidence === "provider_reported"
      ? record.tokens
      : record.role === "response" && parts
        ? composeOutputTotal(
            Object.fromEntries(
              OUTPUT_PARTS.map((part) => [part, parts[part]]),
            ) as Record<(typeof OUTPUT_PARTS)[number], TokenMeasurement>,
          )
        : claudeMeasurement(record.tokens, own);
  return {
    ...record,
    tokens,
    parts,
    generation: {
      ...record.generation,
      text_components: claudeTextComponents(
        record.site,
        record.generation.text_components,
        factor,
      ),
    },
    inline_file_text:
      own && record.inline_file_text
        ? record.inline_file_text.map((component) => ({
            ...component,
            tokens: claudeMeasurement(component.tokens, own),
          }))
        : record.inline_file_text,
  };
}
