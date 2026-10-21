import { formatInteger } from "@footprint/ui/formatters";

/**
 * The long-chat tip above the chat box (owner decision of 16 October 2026). It has two
 * triggers, each with its own switch in Settings:
 *
 * - Requests (on by default at 50): the chat has at least this many requests, counted as the
 *   bar's Req counts them, every branch included.
 * - Tokens (off by default): the chat's active context is more than half of the model's
 *   context or of the custom token limit (`settings.budget`), as decided by `contextGuidance`.
 *   It is off by default because the context sizes of the tools are not all known.
 *
 * The tip shows when any switched-on trigger is met, until the person closes it for that
 * chat (`long-chat-tip-store.ts`).
 */

export const DEFAULT_TIP_REQUEST_LIMIT = 50;
export const MAX_TIP_REQUEST_LIMIT = 10_000;

export type LongChatTipSettings = {
  contextTipRequests: boolean;
  contextTipRequestLimit: number;
  contextTipTokens: boolean;
};

/** The stored fields this reads; older installations have only `contextTip` or nothing. */
export type StoredTipSettings = {
  contextTip?: unknown;
  contextTipRequests?: unknown;
  contextTipRequestLimit?: unknown;
  contextTipTokens?: unknown;
};

export function validTipRequestLimit(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= 1 &&
    (value as number) <= MAX_TIP_REQUEST_LIMIT
  );
}

/**
 * The tip settings with every field explicit. Installations from before 16 October 2026
 * stored only `contextTip` (absent meant on): a person who had turned the tip off keeps both
 * triggers off; everyone else gets the new defaults. The custom token limit is a separate
 * field and is kept either way, so it applies again when Tokens is switched on.
 */
export function longChatTipSettings(stored: StoredTipSettings): LongChatTipSettings {
  const turnedOff = stored.contextTip === false;
  return {
    contextTipRequests:
      typeof stored.contextTipRequests === "boolean"
        ? stored.contextTipRequests
        : !turnedOff,
    contextTipRequestLimit: validTipRequestLimit(stored.contextTipRequestLimit)
      ? stored.contextTipRequestLimit
      : DEFAULT_TIP_REQUEST_LIMIT,
    contextTipTokens:
      typeof stored.contextTipTokens === "boolean" ? stored.contextTipTokens : false,
  };
}

/** The request count that shows the tip, or null when the Requests trigger is off. */
export function tipRequestLimit(settings: LongChatTipSettings): number | null {
  return settings.contextTipRequests ? settings.contextTipRequestLimit : null;
}

export type LongChatTipReason = "tokens" | "requests";

/**
 * Which trigger shows the tip, or null. `tokens` is the token trigger's own decision, already
 * off when the Tokens switch is off; it wins when both are met because it keeps the wording and
 * the Details link of the context advice. `requests` is the chat's request count as a decimal
 * string (null when unknown) and `requestLimit` the Requests trigger (null when off).
 */
export function longChatTipReason(input: {
  tokens: boolean;
  requests: string | null;
  requestLimit: number | null;
}): LongChatTipReason | null {
  if (input.tokens) return "tokens";
  if (input.requestLimit === null || !validTipRequestLimit(input.requestLimit))
    return null;
  if (input.requests === null || !/^\d+$/.test(input.requests)) return null;
  return BigInt(input.requests) >= BigInt(input.requestLimit) ? "requests" : null;
}

/**
 * The tip's words. It names its reason without claiming a saving: the estimate does not model
 * input length, so it cannot say a new chat uses less (CONTRACTS.md, context guidance).
 */
export function longChatTipText(
  reason: LongChatTipReason,
  requests: string | null,
  approximate = false,
): string {
  if (reason === "tokens" || requests === null)
    return "Long chat · for a new topic, consider a fresh conversation.";
  const count = `${approximate ? "about " : ""}${formatInteger(requests)} request${requests === "1" ? "" : "s"}`;
  return `Long chat (${count}) · for a new topic, consider a fresh conversation.`;
}

/** A chat's closed or snoozed tip (`long-chat-tip-store.ts`). */
export type LongChatTipState = {
  closed: boolean;
  /** Milliseconds since 1970 until which the tip stays hidden, or null. */
  snoozedUntil: number | null;
};

export type LongChatTipAction = "close" | "snooze";

/** Whether the tip may show for a chat in this state at `now`. */
export function tipOpen(state: LongChatTipState, now: number): boolean {
  return !state.closed && now >= (state.snoozedUntil ?? 0);
}

/** A reply from the background, or null when it is not a state (an older or failed reply). */
export function parseLongChatTipState(value: unknown): LongChatTipState | null {
  if (typeof value !== "object" || value === null) return null;
  const state = value as Record<string, unknown>;
  return typeof state.closed === "boolean" &&
    (state.snoozedUntil === null || Number.isSafeInteger(state.snoozedUntil))
    ? { closed: state.closed, snoozedUntil: state.snoozedUntil as number | null }
    : null;
}
