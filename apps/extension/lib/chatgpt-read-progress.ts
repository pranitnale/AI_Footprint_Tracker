/**
 * How far the tracker's own read of a long ChatGPT chat got, kept between openings (14 Oct
 * 2026). A chat with more than 200 prompts needs more than the 20 pages one opening may read,
 * so each opening continues below the oldest page an earlier one read, until the chat's start.
 *
 * Only ids and numbers are kept: the first message id of the oldest page read, the newest
 * message time of the read stretch and a page count per day. They live in the extension's own
 * storage under the scope's namespace and the chat's keyed conversation identity, are erased
 * with the scope's records, and are trusted only while the saved prompt they name still exists
 * (`Coordinator.chatgptReadProgress`).
 */

/** Pages one chat may read in one UTC day, the newest page of each opening included. */
export const CHATGPT_DAY_PAGE_LIMIT = 200;

export type ChatgptReadProgress = {
  /**
   * The first message of the oldest page read so far, so the next read asks for the turns
   * before it; null when no stretch is kept.
   */
  before: string | null;
  /**
   * The latest message time (seconds) on the newest page when that stretch was read. A
   * later read that reaches a message at or before it has joined the stretch; null when the
   * page showed no time.
   */
  top: number | null;
  /** Days since 1970 (UTC) and the pages read that day, for the daily ceiling. */
  day: number;
  pages: number;
};

/** What the content script hands the page world's read: where to continue and how much. */
export type ChatgptResume = {
  before: string | null;
  top: number | null;
  /** Pages this run may read before the daily ceiling. */
  budget: number;
};

/** What the page world reports after each page: the stretch to keep and pages read so far. */
export type ChatgptReadReport = {
  before: string | null;
  top: number | null;
  pages: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Message times are seconds since 1970; this bound is far past any real chat.
const TIME_LIMIT = 1e11;
const DAY_MS = 86_400_000;

const exact = (value: object, keys: string) =>
  Object.keys(value).sort().join(",") === keys;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const cursor = (value: unknown): value is string | null =>
  value === null || (typeof value === "string" && UUID.test(value));
const time = (value: unknown): value is number | null =>
  value === null ||
  (typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= TIME_LIMIT);
const count = (value: unknown, limit: number): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= limit;

export const chatgptDay = (now: number) => Math.floor(now / DAY_MS);

export function validChatgptReadProgress(
  value: unknown,
): value is ChatgptReadProgress {
  return (
    record(value) &&
    exact(value, "before,day,pages,top") &&
    cursor(value.before) &&
    time(value.top) &&
    // A stretch without its start point has no use for a time.
    (value.before !== null || value.top === null) &&
    count(value.day, 1_000_000) &&
    count(value.pages, CHATGPT_DAY_PAGE_LIMIT)
  );
}

export function validChatgptResume(value: unknown): value is ChatgptResume {
  return (
    record(value) &&
    exact(value, "before,budget,top") &&
    cursor(value.before) &&
    time(value.top) &&
    (value.before !== null || value.top === null) &&
    count(value.budget, CHATGPT_DAY_PAGE_LIMIT)
  );
}

export function validChatgptReadReport(
  value: unknown,
): value is ChatgptReadReport {
  return (
    record(value) &&
    exact(value, "before,pages,top") &&
    cursor(value.before) &&
    time(value.top) &&
    (value.before !== null || value.top === null) &&
    count(value.pages, CHATGPT_DAY_PAGE_LIMIT)
  );
}

/** Pages already read today, from the kept progress. */
export const chatgptPagesToday = (
  progress: ChatgptReadProgress | null,
  now: number,
) => (progress && progress.day === chatgptDay(now) ? progress.pages : 0);

/**
 * The resume values for a run, or null when nothing is kept and the whole day is left (the
 * page world then starts at the newest page with the full allowance).
 */
export function chatgptResume(
  progress: ChatgptReadProgress | null,
  now: number,
): ChatgptResume | null {
  const used = chatgptPagesToday(progress, now);
  if (!progress?.before && used === 0) return null;
  return {
    before: progress?.before ?? null,
    top: progress?.before ? progress.top : null,
    budget: CHATGPT_DAY_PAGE_LIMIT - used,
  };
}

/** The progress to keep after a report of a run that started with `usedBefore` pages today. */
export function chatgptProgressAfter(
  report: ChatgptReadReport,
  usedBefore: number,
  now: number,
): ChatgptReadProgress {
  return {
    before: report.before,
    top: report.before ? report.top : null,
    day: chatgptDay(now),
    pages: Math.min(CHATGPT_DAY_PAGE_LIMIT, usedBefore + report.pages),
  };
}

/** The part of `browser.storage.local` the store uses, so tests can pass a map. */
export interface KeyValueArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export const CHATGPT_PROGRESS_KEY = "chatgpt-read-progress";
/** Chats kept at most; the least recently read are dropped first. */
export const CHATGPT_PROGRESS_CHATS = 500;
const CONVERSATION_KEY = /^[a-f0-9]{64}$/;

type Stored = {
  namespace: string;
  chats: Record<string, ChatgptReadProgress & { at: number }>;
};

function validStored(value: unknown): value is Stored {
  if (
    !record(value) ||
    !exact(value, "chats,namespace") ||
    typeof value.namespace !== "string" ||
    !record(value.chats)
  )
    return false;
  return Object.entries(value.chats).every(([key, entry]) => {
    if (!CONVERSATION_KEY.test(key) || !record(entry)) return false;
    const { at, ...progress } = entry;
    return Number.isSafeInteger(at) && validChatgptReadProgress(progress);
  });
}

/**
 * One storage entry for the current scope's namespace. A namespace other than the stored one
 * finds nothing and replaces it on its first write, so a rotated or erased scope never reads
 * another scope's progress.
 */
export function createChatgptProgressStore(
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
    const value = (await area.get(CHATGPT_PROGRESS_KEY))[CHATGPT_PROGRESS_KEY];
    return validStored(value) && value.namespace === namespace ? value : null;
  };
  return {
    read: (namespace: string, conversationKey: string) =>
      serial(async (): Promise<ChatgptReadProgress | null> => {
        const entry = (await load(namespace))?.chats[conversationKey];
        if (!entry) return null;
        const { at: _at, ...progress } = entry;
        return progress;
      }),
    write: (
      namespace: string,
      conversationKey: string,
      progress: ChatgptReadProgress,
    ) =>
      serial(async () => {
        if (
          !CONVERSATION_KEY.test(conversationKey) ||
          !validChatgptReadProgress(progress)
        )
          throw new Error("payload_rejected");
        const stored = (await load(namespace)) ?? { namespace, chats: {} };
        const chats = { ...stored.chats };
        delete chats[conversationKey];
        chats[conversationKey] = { ...progress, at: now() };
        const kept = Object.entries(chats)
          .sort((a, b) => b[1].at - a[1].at)
          .slice(0, CHATGPT_PROGRESS_CHATS);
        await area.set({
          [CHATGPT_PROGRESS_KEY]: { namespace, chats: Object.fromEntries(kept) },
        });
      }),
    /** Removes the progress of `namespace`, as a full erase of its records does. */
    erase: (namespace: string) =>
      serial(async () => {
        const value = (await area.get(CHATGPT_PROGRESS_KEY))[CHATGPT_PROGRESS_KEY];
        if (value === undefined) return;
        if (!validStored(value) || value.namespace === namespace)
          await area.remove(CHATGPT_PROGRESS_KEY);
      }),
  };
}

export type ChatgptProgressStore = ReturnType<typeof createChatgptProgressStore>;

/** A store kept in memory, for tests and when the extension's storage is not passed. */
export function memoryKeyValueArea(): KeyValueArea & { values: Map<string, unknown> } {
  const values = new Map<string, unknown>();
  return {
    values,
    async get(key) {
      return values.has(key) ? { [key]: structuredClone(values.get(key)) } : {};
    },
    async set(items) {
      for (const [key, value] of Object.entries(items))
        values.set(key, structuredClone(value));
    },
    async remove(key) {
      values.delete(key);
    },
  };
}
