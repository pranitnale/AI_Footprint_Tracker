import {
  claudeFactorFor,
  claudeTextComponents,
  claudeTokenFields,
  ClaudeTokenFactorSchema,
  type AttemptObservation,
  type Site,
  type TokenFields,
  type TokenMeasurement,
} from "@footprint/contracts";
import media from "../../../config/estimation.media.json";

/**
 * The packaged method's Claude token factor (owner decision of 15 October 2026). Token
 * figures always use it, for old and new records alike, because stored counts stay what
 * the tokenizer measured; estimates use the factor of their own method. The server sums
 * token figures with the same factor (`packaged_claude_token_factor`).
 */
export const PACKAGED_CLAUDE_TOKEN_FACTOR = ClaudeTokenFactorSchema.parse(
  media.claude_token_factor,
);

/**
 * The context a reply's chat holds after it (reconstructed input plus the answer), as the
 * context advice and Details show it: with the factor for Claude text. The context the
 * ledger keeps for the next turn stays the tokenizer's count, so the factor is applied once.
 */
export function countedContext(
  site: Site,
  modelId: string | null,
  tokens: TokenFields,
): string | null {
  const counted = claudeTokenFields(
    tokens,
    claudeFactorFor(site, modelId, PACKAGED_CLAUDE_TOKEN_FACTOR),
  );
  return counted.logical_input_total.value !== null &&
    counted.answer_output.value !== null
    ? (
        BigInt(counted.logical_input_total.value) +
        BigInt(counted.answer_output.value)
      ).toString()
    : null;
}

/**
 * One reply's token fields and the output of other models in it, as the token figures
 * count them: Claude text with the factor, part by part, its output total their sum.
 */
export function countedReplyTokens(
  site: Site,
  modelId: string | null,
  tokens: TokenFields,
  generation: Pick<AttemptObservation["generation"], "text_components">,
): { tokens: TokenFields; components: TokenMeasurement[] } {
  return {
    tokens: claudeTokenFields(
      tokens,
      claudeFactorFor(site, modelId, PACKAGED_CLAUDE_TOKEN_FACTOR),
    ),
    components: claudeTextComponents(
      site,
      generation.text_components,
      PACKAGED_CLAUDE_TOKEN_FACTOR,
    ).map((component) => component.tokens),
  };
}
