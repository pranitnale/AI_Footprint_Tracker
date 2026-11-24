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
 * Whether any model wrote since the checkpoint. A session's counters only grow. A result in
 * which no model ran repeats them, with an API time of its own (live check of 23 Nov 2026,
 * after a Research report note); taken for a restart and counted from zero, it added the
 * whole session a second time. So once a checkpoint exists nothing is counted from zero.
 */
function wrote(current: CoworkCumulative, saved: CoworkCheckpoint) {
  return current.models.some(
    (model) =>
      model.output >
      (saved.models.find((entry) => entry.model === model.model)?.output ?? 0),
  );
}

/**
 * One Cowork turn's own counts from the cumulative per-model counters (owner, 2 Oct,
 * question 14). They include side calls and sub-agents, so the main model's count is the
 * reply's exact total and each other model becomes a side-call component with its own
 * exact count. The API time difference is the reply's timing. Without a base, the counts
 * also hold every earlier turn the page did not load. The turn's input is the difference of
 * the three input counters, added over all models (owner decision of 23 Nov 2026).
 */
function turn(
  message: HistoryTextMessage,
  current: CoworkCumulative,
  base: CoworkCheckpoint | null,
): HistoryTextMessage {
  const counts = current.models.map((model) => {
    const before = base?.models.find((entry) => entry.model === model.model);
    // A counter below the checkpoint's was never seen; it adds nothing, not the session.
    const output = Math.max(0, model.output - (before?.output ?? 0));
    // A thinking count is exact only when both counters report it.
    const reasoning =
      model.reasoning === null || (before && before.reasoning === null)
        ? null
        : model.reasoning - (before?.reasoning ?? 0);
    return {
      model: model.model,
      output,
      reasoning:
        reasoning !== null && reasoning >= 0 && reasoning <= output
          ? reasoning
          : null,
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
        : // An API time below the checkpoint's is no duration of this turn.
          base.apiMs === null || current.apiMs < base.apiMs
          ? null
          : current.apiMs - base.apiMs;
  // The input is exact only when this result reports the three counters and the base does
  // too (a checkpoint saved before 23 Nov 2026 has none), and none of them went down.
  const now = current.inputs;
  const before = base ? base.inputs : { fresh: 0, cacheWrite: 0, cacheRead: 0 };
  const read =
    now && before
      ? {
          fresh: now.fresh - before.fresh,
          cacheWrite: now.cacheWrite - before.cacheWrite,
          cacheRead: now.cacheRead - before.cacheRead,
        }
      : null;
  const input =
    read && Object.values(read).every((value) => value >= 0) ? read : null;
  const next: HistoryTextMessage = {
    ...message,
    modelId: main.model,
    usage: {
      output: main.output,
      input: input?.fresh ?? null,
      cacheRead: input?.cacheRead ?? null,
      cacheWrite: input?.cacheWrite ?? null,
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
 * the checkpoint once the reply is saved. A result in which no model wrote since the
 * checkpoint adds no reply, and the prompt it names is no request: both are left out and
 * the checkpoint stays, so the result after it is measured from the same counters.
 *
 * The turn in which Claude converted a chat (`handoff`) adds no reply and no request
 * either, because the chat's saved reply already counts it by its text. Its counters still
 * hold what the session wrote, so the base moves past them (`coworkHandedOver` gives the
 * checkpoint to save) and the next turn counts only its own output.
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
  // The prompts named by results that add nothing, and by every other result.
  const idle = new Set<string>();
  const answered = new Set<string>();
  for (const message of results) {
    const current = message.cumulative!;
    if (message.handoff) {
      if (message.promptSourceId) idle.add(message.promptSourceId);
      if (!saved || current.sequence > saved.sequence) saved = current;
      continue;
    }
    const named =
      saved && current.sequence > saved.sequence && !wrote(current, saved)
        ? idle
        : answered;
    if (message.promptSourceId) named.add(message.promptSourceId);
    if (named === idle || (saved && current.sequence <= saved.sequence))
      continue;
    replies.set(message, turn(message, current, saved));
    saved = current;
  }
  const messages: HistoryTextMessage[] = [];
  for (const message of page.messages)
    if (message.cumulative) {
      if (replies.has(message)) messages.push(replies.get(message)!);
    } else if (!idle.has(message.sourceId) || answered.has(message.sourceId))
      messages.push(message);
  // The converting turn's prompt is the session's proven first request. Left out, it can
  // no longer prove the start; the chat's saved copy proves the chat's own start.
  if (
    page.rootSourceId !== null &&
    !messages.some(
      (message) =>
        message.sourceId === page.rootSourceId && message.role === "prompt",
    )
  )
    return {
      ...page,
      messages,
      firstRequestVerified: false,
      rootSourceId: null,
      hasEarlier: null,
    };
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
        !message.handoff &&
        message.cumulative.sequence <= checkpoint.sequence,
    )
    .map((message) => message.sourceId);
}

/**
 * The counters of the page's newest converting turn past the checkpoint, or null. That turn
 * is saved as no reply, so the checkpoint is moved past it with the page's first batch,
 * also when the page holds nothing else to save.
 */
export function coworkHandedOver(
  page: HistoryTextPage,
  checkpoint: CoworkCheckpoint | null,
): CoworkCheckpoint | null {
  return coworkCheckpointAfter(
    page.messages.filter(
      (message) =>
        message.handoff &&
        (!checkpoint || message.cumulative!.sequence > checkpoint.sequence),
    ),
  );
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
