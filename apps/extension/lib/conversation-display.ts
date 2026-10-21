export function hasPendingConversation(
  pending: unknown,
  pendingObservationCount?: unknown,
) {
  const explicit = String(pendingObservationCount ?? "");
  if (/^(0|[1-9]\d*)$/.test(explicit)) return BigInt(explicit) > 0n;
  if (!pending || typeof pending !== "object") return false;
  const counts = pending as { requests?: unknown; attempts?: unknown };
  return [counts.requests, counts.attempts].some((value) => {
    const text = String(value ?? "");
    return /^(0|[1-9]\d*)$/.test(text) && BigInt(text) > 0n;
  });
}

/**
 * The bar's local figures. Organization mode is local-first (owner, 13 Oct 2026): the bar shows
 * this browser's figures with no sync wording, and only Details says what they cover.
 */
export function localConversationPresentation(
  mode: "personal" | "company",
  conversation: { offline?: boolean } | null | undefined,
  localText: string,
  localStatus: string,
) {
  return {
    text: localText,
    status: localStatus,
    explanation:
      mode !== "company"
        ? "Personal mode keeps these records on this device."
        : conversation?.offline
          ? "The organization server cannot be reached, so these figures cover this browser profile only. Updates are sent when the connection returns."
          : "These figures cover this browser profile. Your organization's copy of this conversation is updated in the background.",
  };
}

/** Whole-number text as a BigInt, or null when it is missing or not a count. */
function count(value: unknown): bigint | null {
  const text = String(value ?? "");
  return /^(0|[1-9]\d*)$/.test(text) ? BigInt(text) : null;
}

/**
 * Whether the bar shows the organization's synced copy of a chat instead of this browser's
 * figures. Organization mode is local-first (owner, 13 Oct 2026): the synced copy is used only
 * when it adds requests this browser does not have (another browser of the same member) and
 * holds everything this browser recorded. It never replaces local figures with an emptier
 * copy, a copy missing local updates still waiting to upload, or an older cached copy, unless
 * this browser has no request at all for the chat. One set is shown, never both added, so a
 * request counted locally and on the server counts once.
 */
export function preferSyncedFigures(input: {
  /** Requests recorded live in this browser and requests in its loaded saved history. */
  localRequests: unknown;
  localHistoryRequests: unknown;
  syncedRequests: unknown;
  syncedHistoryRequests: unknown;
  /** Whether the local and synced saved-history summaries are available. */
  localHistory: boolean;
  syncedHistory: boolean;
  /** Local updates of this chat still waiting to upload. */
  pending: boolean;
  /** The synced copy was read from the server just now, not from a cache or while offline. */
  current: boolean;
}): boolean {
  const local = count(input.localRequests);
  const synced = count(input.syncedRequests);
  if (local === null || synced === null) return false;
  const localTotal =
    local + (input.localHistory ? (count(input.localHistoryRequests) ?? 0n) : 0n);
  const syncedTotal =
    synced +
    (input.syncedHistory ? (count(input.syncedHistoryRequests) ?? 0n) : 0n);
  // With no request here, the synced copy hides nothing, and the bar never shows zero
  // instead of the member's synced requests.
  if (localTotal === 0n) return syncedTotal > 0n;
  // Local updates still waiting to upload are missing from the synced copy, and saved history
  // this browser loaded that the server does not have yet must not disappear behind it (live,
  // 13 Oct 2026: Req 0 and Unknown after connecting).
  if (input.pending || (input.localHistory && !input.syncedHistory)) return false;
  return input.current && syncedTotal > localTotal;
}
export function tokenPairText(input: string, output: string): string {
  const pairedOutput = input.startsWith("≈ ")
    ? output.replace(/^≈ /, "")
    : output;
  return `In/Out tokens - ${input}/${pairedOutput}`;
}
