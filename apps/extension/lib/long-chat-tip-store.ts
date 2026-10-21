import type { KeyValueArea } from "./chatgpt-read-progress";
import type { LongChatTipAction, LongChatTipState } from "./long-chat-tip";

/**
 * Chats whose long-chat tip the person closed with its cross, or snoozed from Details
 * (16 October 2026). A closed tip stays closed for that chat; other chats still show theirs.
 *
 * Only keyed conversation identities and times are kept, never a chat's address. They live
 * in the extension's own storage under the scope's namespace, like the ChatGPT read progress,
 * and a full erase of the scope's records removes them (`Coordinator.clearPersonal`).
 */

export const LONG_CHAT_TIP_KEY = "long-chat-tip";
/** Chats kept at most; the least recently changed are dropped first. */
export const LONG_CHAT_TIP_CHATS = 5000;
export const TIP_SNOOZE_MS = 86_400_000;
const CONVERSATION_KEY = /^[a-f0-9]{64}$/;

type Entry = LongChatTipState & { at: number };
type Stored = { namespace: string; chats: Record<string, Entry> };

function validEntry(value: unknown): value is Entry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return (
    Object.keys(entry).sort().join(",") === "at,closed,snoozedUntil" &&
    typeof entry.closed === "boolean" &&
    (entry.snoozedUntil === null || Number.isSafeInteger(entry.snoozedUntil)) &&
    Number.isSafeInteger(entry.at)
  );
}

function validStored(value: unknown): value is Stored {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const stored = value as Record<string, unknown>;
  if (
    Object.keys(stored).sort().join(",") !== "chats,namespace" ||
    typeof stored.namespace !== "string" ||
    typeof stored.chats !== "object" ||
    stored.chats === null ||
    Array.isArray(stored.chats)
  )
    return false;
  return Object.entries(stored.chats).every(
    ([key, entry]) => CONVERSATION_KEY.test(key) && validEntry(entry),
  );
}

/**
 * One storage entry for the current scope's namespace. Another namespace finds nothing and
 * replaces the entry on its first write, so a rotated or erased scope never reads it.
 */
export function createLongChatTipStore(
  area: KeyValueArea,
  now: () => number = Date.now,
) {
  // Writes read, change and write the one entry, so they run one at a time.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work, work);
    queue = run.catch(() => {});
    return run;
  };
  const load = async (namespace: string): Promise<Stored | null> => {
    const value = (await area.get(LONG_CHAT_TIP_KEY))[LONG_CHAT_TIP_KEY];
    return validStored(value) && value.namespace === namespace ? value : null;
  };
  const state = (entry: Entry | undefined): LongChatTipState =>
    entry
      ? { closed: entry.closed, snoozedUntil: entry.snoozedUntil }
      : { closed: false, snoozedUntil: null };
  return {
    read: (namespace: string, conversationKey: string) =>
      serial(async () => state((await load(namespace))?.chats[conversationKey])),
    write: (namespace: string, conversationKey: string, action: LongChatTipAction) =>
      serial(async (): Promise<LongChatTipState> => {
        if (!CONVERSATION_KEY.test(conversationKey) || (action !== "close" && action !== "snooze"))
          throw new Error("payload_rejected");
        const stored = (await load(namespace)) ?? { namespace, chats: {} };
        const chats = { ...stored.chats };
        const before = state(chats[conversationKey]);
        delete chats[conversationKey];
        const at = now();
        const next: LongChatTipState =
          action === "close"
            ? { closed: true, snoozedUntil: before.snoozedUntil }
            : { closed: before.closed, snoozedUntil: at + TIP_SNOOZE_MS };
        chats[conversationKey] = { ...next, at };
        const kept = Object.entries(chats)
          .sort((a, b) => b[1].at - a[1].at)
          .slice(0, LONG_CHAT_TIP_CHATS);
        await area.set({
          [LONG_CHAT_TIP_KEY]: { namespace, chats: Object.fromEntries(kept) },
        });
        return next;
      }),
    /** Removes the closed tips of `namespace`, as a full erase of its records does. */
    erase: (namespace: string) =>
      serial(async () => {
        const value = (await area.get(LONG_CHAT_TIP_KEY))[LONG_CHAT_TIP_KEY];
        if (value === undefined) return;
        if (!validStored(value) || value.namespace === namespace)
          await area.remove(LONG_CHAT_TIP_KEY);
      }),
  };
}

export type LongChatTipStore = ReturnType<typeof createLongChatTipStore>;
