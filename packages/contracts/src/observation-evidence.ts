import { canonicalJson } from "./canonical";
import {
  composeOutputTotal,
  OUTPUT_PARTS,
  type AttemptObservation,
  type HistoryMessage,
  type OutputPart,
  type RequestObservation,
  type TimingEvidence,
  type TokenMeasurement,
} from "./index";

type SavedModel = Pick<HistoryMessage, "site" | "model_id">;

/**
 * A saved Gemini turn names the model that answered it, while its live reply carries the
 * label of the chat's mode. They differ on tool turns: a video turn is saved as "Gemini
 * Omni 1.1 Flash" and streamed as "3.6 Thinking", also when its job fails and leaves no
 * video (seen 5 Oct 2026). A Gemini reply id (`rc_` and 16 hex digits) names one reply,
 * so the id decides the link and the saved label names the model.
 */
const geminiTurnLabel = (history: SavedModel): boolean =>
  history.site === "gemini";

/**
 * Whether a saved reply's model contradicts its live capture. Claude history names only
 * the chat's current model (B5), so a reply answered by another model (an earlier
 * selection or a fallback) is still the same reply; its id decides. A live model taken
 * from the request or the page's controls is the one asked for, not the one that
 * answered, so it contradicts nothing (5 Oct 2026: ChatGPT ran an image turn on
 * gpt-5-4-auto-thinking while gpt-5-6-thinking was selected). A Gemini reply's live label
 * is the chat's mode, so it contradicts nothing either.
 */
export function historyModelConflicts(
  history: SavedModel,
  attempt: Pick<AttemptObservation, "model_id" | "model_evidence">,
): boolean {
  return (
    history.site !== "claude" &&
    history.model_id !== null &&
    attempt.model_id !== null &&
    attempt.model_evidence === "response_field" &&
    !geminiTurnLabel(history) &&
    history.model_id !== attempt.model_id
  );
}

/**
 * The model of a live reply with its saved copy: the model the live reply names when it
 * answered, else the one its saved copy names, else the one that was asked for. Claude
 * history names the chat's model, not the reply's (B5), so it never replaces a live one.
 * A Gemini turn's saved label wins over its live mode label, so a linked turn is
 * estimated as its saved copy alone would be.
 */
export function linkedReplyModel(
  attempt: Pick<AttemptObservation, "model_id" | "model_evidence">,
  history?: SavedModel,
): AttemptObservation["model_id"] {
  if (
    history &&
    history.site !== "claude" &&
    history.model_id !== null &&
    (attempt.model_evidence !== "response_field" || geminiTurnLabel(history))
  )
    return history.model_id;
  return attempt.model_id ?? history?.model_id ?? null;
}

/** Ownership and uniqueness are checked by the repository; this checks the supplied workload binding. */
export function assertLinkedHistory(
  request: RequestObservation,
  attempt: AttemptObservation,
  history: HistoryMessage,
): void {
  const sameConversation =
    request.conversation_key === history.conversation_key ||
    (request.site === "perplexity" &&
      request.provider_request_key !== null &&
      request.provider_request_key === history.provider_request_key);
  if (
    history.role !== "response" ||
    history.site !== request.site ||
    !sameConversation ||
    attempt.provider_attempt_key === null ||
    attempt.provider_attempt_key !== history.provider_attempt_key ||
    request.coverage_reasons.includes("request_identity_ambiguous") ||
    attempt.coverage_reasons.includes("request_identity_ambiguous") ||
    historyModelConflicts(history, attempt)
  )
    throw new Error("dependency_missing");
}

/** The saved part of a linked reply; every saved reply names its parts. */
function historyPart(
  history: HistoryMessage,
  part: OutputPart,
): TokenMeasurement | null {
  return history.parts?.[part] ?? null;
}

/**
 * Visible history can complete a stopped live count, and a saved reply that grew after
 * the stream ended (research reports, late results) replaces the shorter live count.
 * It never replaces a larger live count or a different counting profile.
 */
export function selectPartMeasurement(
  live: TokenMeasurement,
  history?: HistoryMessage,
  part: OutputPart = "answer_output",
): TokenMeasurement {
  const saved = history ? historyPart(history, part) : null;
  if (
    !history ||
    !saved ||
    saved.scope !== "observed_text" ||
    !history.text_complete ||
    saved.value === null ||
    saved.completeness !== "complete_for_scope"
  )
    return live;
  if (live.value === null) return saved;
  if (
    live.scope === "observed_text" &&
    live.evidence === saved.evidence &&
    live.profile_id === saved.profile_id &&
    BigInt(saved.value) >= BigInt(live.value)
  )
    return saved;
  return live;
}

/** Kept for callers that select the visible reply alone. */
export function selectAnswerMeasurement(
  live: TokenMeasurement,
  history?: HistoryMessage,
): TokenMeasurement {
  return selectPartMeasurement(live, history, "answer_output");
}

function selectedParts(
  attempt: AttemptObservation,
  history?: HistoryMessage,
): Record<OutputPart, TokenMeasurement> {
  return Object.fromEntries(
    OUTPUT_PARTS.map((part) => [
      part,
      selectPartMeasurement(attempt.tokens[part], history, part),
    ]),
  ) as Record<OutputPart, TokenMeasurement>;
}

/**
 * The provider's own count of the reply: the live report first, then the linked saved
 * one (Cowork saves exact totals with each reply). It includes work no page shows.
 */
function reportedOutput(
  attempt: AttemptObservation,
  history?: HistoryMessage,
): TokenMeasurement | null {
  const live = attempt.tokens.output_total;
  if (
    live.evidence === "provider_reported" &&
    live.scope === "provider_request" &&
    live.value !== null
  )
    return live;
  const saved = history?.tokens;
  return saved?.evidence === "provider_reported" && saved.value !== null
    ? saved
    : null;
}

/** Provider-reported totals win; otherwise the parts are selected one by one and added. */
export function selectOutputMeasurement(
  attempt: AttemptObservation,
  history?: HistoryMessage,
): TokenMeasurement {
  return (
    reportedOutput(attempt, history) ??
    composeOutputTotal(selectedParts(attempt, history))
  );
}

/**
 * A research run reports its own task span, which covers the visible report better than
 * the short launching stream. Otherwise complete live timing wins over saved timing.
 */
export function selectTimingEvidence(
  attempt: AttemptObservation | null,
  history?: HistoryMessage,
): TimingEvidence | null {
  const savedComplete =
    !!history?.text_complete &&
    !history.coverage_reasons.includes("historical_timing_conflict") &&
    history.timing?.completeness === "complete_for_scope";
  if (savedComplete && history!.timing!.scope === "research_task")
    return history!.timing;
  if (
    attempt?.state === "completed" &&
    attempt.timing?.completeness === "complete_for_scope"
  )
    return attempt.timing;
  if (savedComplete) return history!.timing;
  return null;
}

/** Return a projection for counting; never mutate the saved observation or its hash. */
export function projectAttemptEvidence(
  attempt: AttemptObservation,
  history?: HistoryMessage,
): AttemptObservation {
  const parts = selectedParts(attempt, history);
  const output_total =
    reportedOutput(attempt, history) ?? composeOutputTotal(parts);
  const tokens = { ...attempt.tokens, ...parts, output_total };
  if (canonicalJson(tokens) === canonicalJson(attempt.tokens)) return attempt;
  return { ...attempt, tokens };
}
