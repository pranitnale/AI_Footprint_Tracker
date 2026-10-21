import type {
  CoworkCumulative,
  GeneratedComponent,
  HistoryTextMessage,
  HistoryTextPage,
} from "@footprint/adapters";
import { timingEvidence } from "@footprint/capture-core";

/** The cumulative counters of the latest Cowork result saved for a session (local only). */
export type CoworkCheckpoint = CoworkCumulative;

const COMPONENTS = 16;

/** A model label without its date or context-size suffix, for matching the session model. */
const modelBase = (label: string) =>
  label.replace(/\[[^\]]*\]$/, "").replace(/-\d{8}$/, "");

/**
 * Whether the session's counters restarted since the checkpoint: a model it saved is gone
 * or counts less, or the API time went down. Every counter starts again from zero then.
 */
function restarted(current: CoworkCumulative, saved: CoworkCheckpoint) {
  if (
    current.apiMs !== null &&
    saved.apiMs !== null &&
    current.apiMs < saved.apiMs
  )
    return true;
  return saved.models.some((model) => {
    const now = current.models.find((entry) => entry.model === model.model);
    return (
      !now ||
      now.output < model.output ||
      (now.reasoning !== null &&
        model.reasoning !== null &&
        now.reasoning < model.reasoning)
    );
  });
}

/**
 * One Cowork turn's own counts from the cumulative per-model counters (owner, 2 Oct,
 * question 14). They include side calls and sub-agents, so the main model's count is the
 * reply's exact total and each other model becomes a side-call component with its own
 * exact count. The API time difference is the reply's timing. Without a base, the counts
 * also hold every earlier turn the page did not load.
 */
function turn(
  message: HistoryTextMessage,
  current: CoworkCumulative,
  base: CoworkCheckpoint | null,
): HistoryTextMessage {
  const counts = current.models.map((model) => {
    const before = base?.models.find((entry) => entry.model === model.model);
    const output = model.output - (before?.output ?? 0);
    // A thinking count is exact only when both counters report it.
    const reasoning =
      model.reasoning === null || (before && before.reasoning === null)
        ? null
        : model.reasoning - (before?.reasoning ?? 0);
    return {
      model: model.model,
      output,
      reasoning: reasoning !== null && reasoning <= output ? reasoning : null,
    };
  });
  // The model the session ran the turn with, else the one that wrote the most.
  const session = message.modelId;
  const main =
    counts.find((count) => count.model === session) ??
    (session
      ? counts.find((count) => modelBase(count.model) === modelBase(session))
      : undefined) ??
    counts.reduce((largest, count) =>
      count.output > largest.output ? count : largest,
    );
  const others = counts
    .filter((count) => count !== main && count.output > 0)
    .sort((a, b) => b.output - a.output);
  const components: GeneratedComponent[] = others
    .slice(0, COMPONENTS)
    .map((count) => ({
      role: "side_calls",
      model: count.model,
      text: null,
      outputTokens: count.output,
    }));
  const reasons = new Set(message.coverageReasons ?? []);
  if (others.length > COMPONENTS) reasons.add("side_calls_unobserved");
  const apiMs =
    current.apiMs === null
      ? null
      : base === null
        ? current.apiMs
        : base.apiMs === null
          ? null
          : current.apiMs - base.apiMs;
  const next: HistoryTextMessage = {
    ...message,
    modelId: main.model,
    usage: {
      output: main.output,
      input: null,
      cacheRead: null,
      cacheWrite: null,
      reasoning: main.reasoning,
    },
    components,
    timing:
      apiMs !== null && message.complete
        ? timingEvidence(apiMs / 1000, "cowork_history")
        : null,
  };
  if (reasons.size) next.coverageReasons = [...reasons];
  return next;
}

/**
 * The Cowork results of a page as replies with their own counts. A result newer than the
 * checkpoint gets the difference to it, so the first result saved for a session carries the
 * turns the page did not load; a result at or before the checkpoint is already inside a
 * saved count and is left out. Prompts stay. Each reply keeps its counters, which become
 * the checkpoint once the reply is saved.
 */
export function coworkTurns(
  page: HistoryTextPage,
  checkpoint: CoworkCheckpoint | null,
): HistoryTextPage {
  let saved = checkpoint;
  const results = page.messages
    .filter((message) => message.cumulative)
    .sort((a, b) => a.cumulative!.sequence - b.cumulative!.sequence);
  const replies = new Map<HistoryTextMessage, HistoryTextMessage>();
  for (const message of results) {
    const current = message.cumulative!;
    if (saved && current.sequence <= saved.sequence) continue;
    const base = saved && !restarted(current, saved) ? saved : null;
    replies.set(message, turn(message, current, base));
    saved = current;
  }
  const messages: HistoryTextMessage[] = [];
  for (const message of page.messages)
    if (!message.cumulative) messages.push(message);
    else if (replies.has(message)) messages.push(replies.get(message)!);
  return { ...page, messages };
}

/** Source ids of the page's results already inside a saved count (at or before the checkpoint). */
export function coworkCounted(
  page: HistoryTextPage,
  checkpoint: CoworkCheckpoint | null,
): string[] {
  if (!checkpoint) return [];
  return page.messages
    .filter(
      (message) =>
        message.cumulative &&
        message.cumulative.sequence <= checkpoint.sequence,
    )
    .map((message) => message.sourceId);
}

/** The checkpoint after saving these messages: the counters of the newest result among them. */
export function coworkCheckpointAfter(
  messages: ReadonlyArray<Pick<HistoryTextMessage, "cumulative">>,
): CoworkCheckpoint | null {
  let latest: CoworkCheckpoint | null = null;
  for (const message of messages)
    if (
      message.cumulative &&
      (!latest || message.cumulative.sequence > latest.sequence)
    )
      latest = message.cumulative;
  return latest;
}
