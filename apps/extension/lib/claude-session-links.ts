import {
  claudeChatListLinks,
  claudeLinkRequest,
  claudeReadSessionLink,
  claudeReadSessionRequest,
  claudeSessionObject,
  CLAUDE_READ_SESSION_ANSWER_BYTES,
  validClaudeSessionTotals,
  type ClaudeSessionLink,
  type ClaudeSessionTotals,
} from "@footprint/adapters";
import {
  isCoworkSessionId,
  parseConversationRoute,
  routeShows,
} from "@footprint/capture-core";
import type { KeyValueArea } from "./chatgpt-read-progress";
import type { CoworkNatives } from "./cowork-history";

/**
 * Which session backs which Claude chat (18 Nov 2026: claude.ai shows chats and Cowork
 * sessions at /chat/<uuid>, and a session's events hold Claude's own token counts).
 *
 * The page world reads the answers that prove a link from the page's own requests (a chat
 * list row, a session object's chat tag, and for a Cowork session from before the merge the
 * page's ReadCoworkSession call) and posts ids and Claude's running totals to the
 * content script. The content script passes the link of the open chat to the background, which
 * keeps it under the scope's namespace and the chat's keyed identity, so a session page is
 * admitted at its chat's address, also after the background's service worker restarted.
 * Nothing is fetched here, and no text is read.
 */

export { validClaudeSessionTotals };
export const CLAUDE_LINK_CHANNEL = "ai-footprint-claude-link-v1";
/**
 * Links the page world, the content script and the background each keep, and the most one
 * message holds; the least recently learned go first.
 */
export const CLAUDE_LINKS_KEPT = 512;
/** Sessions whose totals the page world and the content script keep. */
export const CLAUDE_TOTALS_KEPT = 64;
// A list of 30 rows or one session object is far smaller; a larger body is not read.
const BODY_BYTES = 2 * 1048576;

export type ClaudeLinkTotals = ClaudeSessionTotals & { session: string };
export interface ClaudeLinkFacts {
  channel: typeof CLAUDE_LINK_CHANNEL;
  /** The content script's probe nonce, as on the Cowork send signal. */
  nonce: string;
  links: ClaudeSessionLink[];
  totals: ClaudeLinkTotals | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: object, keys: string) =>
  Object.keys(value).sort().join(",") === keys;
const validLink = (value: unknown): value is ClaudeSessionLink =>
  record(value) &&
  exact(value, "chat,session") &&
  typeof value.chat === "string" &&
  UUID.test(value.chat) &&
  isCoworkSessionId(value.session);

export function validateClaudeLinkFacts(
  value: unknown,
  nonce: string,
): value is ClaudeLinkFacts {
  if (!record(value) || !exact(value, "channel,links,nonce,totals")) return false;
  const { totals } = value;
  if (totals !== null) {
    if (!record(totals) || !isCoworkSessionId(totals.session)) return false;
    const { session: _session, ...counts } = totals;
    if (!validClaudeSessionTotals(counts)) return false;
  }
  return (
    value.channel === CLAUDE_LINK_CHANNEL &&
    value.nonce === nonce &&
    Array.isArray(value.links) &&
    value.links.length <= CLAUDE_LINKS_KEPT &&
    value.links.every(validLink) &&
    (value.links.length > 0 || totals !== null)
  );
}

/** Reads a response copy up to `limit` bytes; undefined when it is larger or broken. */
async function boundedBytes(
  response: Response,
  natives: CoworkNatives,
  limit: number,
): Promise<Uint8Array | undefined> {
  if (!response.ok || !response.body) {
    if (response.body)
      void Reflect.apply(natives.cancelStream, response.body, []).catch(() => {});
    return undefined;
  }
  const reader = Reflect.apply(
    natives.getReader,
    response.body,
    [],
  ) as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await Reflect.apply(natives.read, reader, []);
      if (part.done) break;
      if (!(part.value instanceof Uint8Array)) return undefined;
      size += part.value.length;
      if (size > limit) return undefined;
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.length;
    }
    return bytes;
  } catch {
    return undefined;
  } finally {
    // A copy not read to its end would hold the rest of the answer.
    void Reflect.apply(natives.cancel, reader, []).catch(() => {});
  }
}

/** Reads a response copy as JSON up to the body bound; undefined when it is larger or broken. */
async function boundedJson(
  response: Response,
  natives: CoworkNatives,
): Promise<unknown> {
  const bytes = await boundedBytes(response, natives, BODY_BYTES);
  try {
    return bytes && JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

/**
 * The page world's link facts, from the page's own chat list and session object requests.
 * `post` returns whether the content script could be told; facts it could not be told yet are
 * posted by `announce`, which the capture runtime calls when a content script introduces itself.
 */
export function createClaudeSessionLinks(
  post: (facts: Pick<ClaudeLinkFacts, "links" | "totals">) => boolean,
  natives: CoworkNatives,
) {
  /** Chat to session, least recently learned first. */
  const sessions = new Map<string, string>();
  /** Claude's latest totals per session. */
  const totals = new Map<string, ClaudeSessionTotals>();
  const keep = <T>(map: Map<string, T>, key: string, value: T, limit: number) => {
    map.delete(key);
    map.set(key, value);
    while (map.size > limit) map.delete(map.keys().next().value!);
  };
  /** Keeps the link. A session backs one chat, so the latest proof replaces another chat's. */
  const link = (chat: string, session: string) => {
    for (const [other, kept] of sessions)
      if (kept === session && other !== chat) sessions.delete(other);
    keep(sessions, chat, session, CLAUDE_LINKS_KEPT);
  };
  const tell = (links: ClaudeSessionLink[], total: ClaudeLinkTotals | null) => {
    // Nothing to say sends nothing.
    if (!links.length && !total) return;
    try {
      post({ links, totals: total });
    } catch {}
  };
  async function read(
    request: NonNullable<ReturnType<typeof claudeLinkRequest>>,
    promise: Promise<Response>,
  ) {
    let value: unknown;
    try {
      // Cloned before the page's own reader can take the body.
      const copy = await promise.then(
        (response) =>
          Reflect.apply(natives.cloneResponse, response, []) as Response,
      );
      value = await boundedJson(copy, natives);
    } catch {
      return;
    }
    if (value === undefined) return;
    if (request.kind === "list") {
      const links = claudeChatListLinks(value);
      for (const row of links) link(row.chat, row.session);
      tell(links, null);
      return;
    }
    const facts = claudeSessionObject(value, request.session);
    if (!facts) return;
    if (facts.chat) link(facts.chat, request.session);
    if (facts.totals)
      keep(totals, request.session, facts.totals, CLAUDE_TOTALS_KEPT);
    tell(
      facts.chat ? [{ chat: facts.chat, session: request.session }] : [],
      facts.totals ? { session: request.session, ...facts.totals } : null,
    );
  }
  /**
   * The bytes of a request body, copied. The answer arrives later, and a page script could
   * rewrite the buffer meanwhile to pair the answer's address with another session.
   */
  const copied = (body: unknown): Uint8Array | null => {
    const view = ArrayBuffer.isView(body)
      ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
      : body instanceof ArrayBuffer
        ? new Uint8Array(body)
        : null;
    return view && view.length <= CLAUDE_READ_SESSION_ANSWER_BYTES
      ? view.slice()
      : null;
  };
  /** The page asked for a Cowork session by its id; the answer names its chat address. */
  async function readSession(request: Uint8Array, promise: Promise<Response>) {
    let answer: Uint8Array | undefined;
    try {
      const copy = await promise.then(
        (response) =>
          Reflect.apply(natives.cloneResponse, response, []) as Response,
      );
      answer = await boundedBytes(copy, natives, CLAUDE_READ_SESSION_ANSWER_BYTES);
    } catch {
      return;
    }
    const proven = answer ? claudeReadSessionLink(request, answer) : null;
    if (!proven) return;
    link(proven.chat, proven.session);
    tell([proven], null);
  }
  return {
    /**
     * Takes a copy of a link answer of the page. Other requests are left alone. `body` is the
     * request's body, which names the session in a ReadCoworkSession call.
     */
    observe(
      url: URL,
      method: string,
      promise: Promise<Response> | null,
      body?: unknown,
    ): void {
      if (claudeReadSessionRequest(url, method)) {
        const request = promise ? copied(body) : null;
        if (request) void readSession(request, promise!);
        return;
      }
      const request = claudeLinkRequest(url, method);
      if (request && promise) void read(request, promise);
    },
    /**
     * The content script asked for a read of this session at this address. A reload forgets
     * what the page proved, and the content script then has the link confirmed by the
     * background, which kept it. So the session counts as shown here again. Only a session
     * at a chat's address is taken.
     */
    trust(pathname: string, session: string): void {
      const route = parseConversationRoute("claude", pathname)?.conversationId;
      if (route && !isCoworkSessionId(route) && isCoworkSessionId(session))
        link(route, session);
    },
    /** Whether the address shows the conversation: its own route, or its chat's. */
    shows(pathname: string, conversationId: string): boolean {
      const route = parseConversationRoute("claude", pathname)?.conversationId;
      return routeShows(
        "claude",
        pathname,
        conversationId,
        route ? (sessions.get(route) ?? null) : null,
      );
    },
    /** Everything known, for a content script that just introduced itself. */
    announce(): void {
      tell(
        [...sessions].map(([chat, session]) => ({ chat, session })),
        null,
      );
      for (const [session, total] of totals) tell([], { session, ...total });
    },
  };
}

export type ClaudeSessionLinks = ReturnType<typeof createClaudeSessionLinks>;

export const CLAUDE_LINKS_KEY = "claude-session-links";
const KEY = /^[a-f0-9]{64}$/;

/**
 * How long after a Research launch was counted the chat's saved copy stays due. The report is
 * written into the saved reply for minutes after the session's result, and nothing the
 * tracker reads says when it is finished, so a read this long after the launch is taken as
 * holding all of it.
 */
export const CLAUDE_RESEARCH_SETTLED_MS = 60 * 60 * 1000;

/**
 * A kept link: the session's keyed conversation identity and Claude's latest totals.
 * `research`: when a Research launch of the session was last counted, while the chat's saved
 * copy, which alone holds the report, is still due to be read.
 */
export type StoredClaudeLink = {
  session: string;
  totals: ClaudeSessionTotals | null;
  research?: number;
};
type Stored = {
  namespace: string;
  chats: Record<string, StoredClaudeLink & { at: number }>;
};

function validStored(value: unknown): value is Stored {
  if (
    !record(value) ||
    !exact(value, "chats,namespace") ||
    typeof value.namespace !== "string" ||
    !record(value.chats)
  )
    return false;
  return Object.entries(value.chats).every(
    ([key, entry]) =>
      KEY.test(key) &&
      record(entry) &&
      (exact(entry, "at,session,totals") ||
        (exact(entry, "at,research,session,totals") &&
          Number.isSafeInteger(entry.research))) &&
      Number.isSafeInteger(entry.at) &&
      typeof entry.session === "string" &&
      KEY.test(entry.session) &&
      (entry.totals === null || validClaudeSessionTotals(entry.totals)),
  );
}

/**
 * The background's kept links, one storage entry for the current scope's namespace, as the
 * ChatGPT read progress is kept. Keys are keyed identities, never ids. At most
 * CLAUDE_LINKS_KEPT chats are kept; the least recently confirmed go first. A namespace other
 * than the stored one finds nothing, and a full erase removes the entry.
 */
export function createClaudeLinkStore(
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
    const value = (await area.get(CLAUDE_LINKS_KEY))[CLAUDE_LINKS_KEY];
    return validStored(value) && value.namespace === namespace ? value : null;
  };
  return {
    read: (namespace: string, chatKey: string) =>
      serial(async (): Promise<StoredClaudeLink | null> => {
        const entry = (await load(namespace))?.chats[chatKey];
        return entry
          ? {
              session: entry.session,
              totals: entry.totals,
              ...(entry.research === undefined ? {} : { research: entry.research }),
            }
          : null;
      }),
    /**
     * Keeps the link. Totals that are not given keep the ones stored for the same session, so
     * a list row never erases what the session object said.
     */
    write: (
      namespace: string,
      chatKey: string,
      sessionKey: string,
      totals: ClaudeSessionTotals | null,
    ) =>
      serial(async () => {
        if (
          !KEY.test(chatKey) ||
          !KEY.test(sessionKey) ||
          (totals !== null && !validClaudeSessionTotals(totals))
        )
          throw new Error("payload_rejected");
        const stored = (await load(namespace)) ?? { namespace, chats: {} };
        const chats = { ...stored.chats };
        const old = chats[chatKey];
        delete chats[chatKey];
        // A session backs one chat: the latest link replaces another chat's, so a session's
        // pages are never admitted at two addresses.
        for (const [key, entry] of Object.entries(chats))
          if (entry.session === sessionKey) delete chats[key];
        chats[chatKey] = {
          session: sessionKey,
          totals: totals ?? (old?.session === sessionKey ? old.totals : null),
          at: now(),
          ...(old?.session === sessionKey && old.research !== undefined
            ? { research: old.research }
            : {}),
        };
        const kept = Object.entries(chats)
          .sort((a, b) => b[1].at - a[1].at)
          .slice(0, CLAUDE_LINKS_KEPT);
        await area.set({
          [CLAUDE_LINKS_KEY]: { namespace, chats: Object.fromEntries(kept) },
        });
      }),
    /**
     * A Research launch of the chat's session was counted at `at`: the chat's saved copy,
     * which alone holds the report, is due. Nothing is kept for a chat without a link.
     */
    research: (namespace: string, chatKey: string, at: number) =>
      serial(async () => {
        const stored = await load(namespace);
        const entry = stored?.chats[chatKey];
        if (!stored || !entry || !Number.isSafeInteger(at)) return;
        await area.set({
          [CLAUDE_LINKS_KEY]: {
            namespace,
            chats: { ...stored.chats, [chatKey]: { ...entry, research: at } },
          },
        });
      }),
    /**
     * The chat's saved copy was read at `at`. Long enough after the launch it holds the
     * report, and the copy is no longer due.
     */
    textRead: (namespace: string, chatKey: string, at: number) =>
      serial(async () => {
        const stored = await load(namespace);
        const entry = stored?.chats[chatKey];
        if (
          !stored ||
          entry?.research === undefined ||
          at - entry.research < CLAUDE_RESEARCH_SETTLED_MS
        )
          return;
        const { research: _settled, ...rest } = entry;
        await area.set({
          [CLAUDE_LINKS_KEY]: {
            namespace,
            chats: { ...stored.chats, [chatKey]: rest },
          },
        });
      }),
    /** Removes the links of `namespace`, as a full erase of its records does. */
    erase: (namespace: string) =>
      serial(async () => {
        const value = (await area.get(CLAUDE_LINKS_KEY))[CLAUDE_LINKS_KEY];
        if (value === undefined) return;
        if (!validStored(value) || value.namespace === namespace)
          await area.remove(CLAUDE_LINKS_KEY);
      }),
  };
}

export type ClaudeLinkStore = ReturnType<typeof createClaudeLinkStore>;
