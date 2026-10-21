import {
  NOTEBOOKLM_CHAT_RPC,
  NOTEBOOKLM_SESSIONS_RPC,
  notebooklmChatSessions,
  notebooklmHistoryFrames,
  parseHistoryText,
} from "@footprint/adapters";
import { NOTEBOOKLM_BATCH_PATH } from "@footprint/capture-core";
import type { GeminiPageValues } from "./gemini-own-read";
import { historyRequestConversation } from "./history-route";
import type { OwnReadOutcome } from "./own-read";
import {
  OWN_READ_PAGE_SPACING_MS,
  type OwnReadContext,
  type OwnReadProvider,
} from "./own-read-page";

/**
 * The tracker's own read of a notebook's saved chat (owner decision of 14 October 2026).
 * NotebookLM lists a notebook's chat sessions (`hPTbtc`) and reads their turns (`khqZz`) only
 * the first time the notebook opens in a document; reopened later in the same tab, the chat
 * shows without either read. The page world then sends both reads itself, copying the
 * requests the page made earlier in this document. See `own-read.ts` for when it runs.
 */

/** At most this many pages of turns per run, every session together. */
export const NOTEBOOKLM_PAGE_LIMIT = 20;
/** Turns per page, as the page asks for them (14 Oct 2026). */
const PAGE_TURNS = 20;
const TOKEN_LIMIT = 4096;

/** What the page's own requests showed, kept in this page's memory only. */
interface Learned {
  /** The session list's arguments and the notebook they named. */
  sessions: { args: unknown[]; notebook: string } | null;
  /** The first argument of the page's chat reads. */
  context: unknown[] | null;
  /** The account index the page adds (`authuser`), or null without one. */
  authuser: string | null;
}

/** The one RPC's arguments of a batch body, or null. */
function batchArgs(body: unknown, rpc: string): unknown[] | null {
  if (typeof body !== "string") return null;
  try {
    const form = new URLSearchParams(body);
    if (form.getAll("f.req").length !== 1) return null;
    const requests = JSON.parse(form.get("f.req")!);
    const row = Array.isArray(requests) && Array.isArray(requests[0]) && requests[0].length === 1
      ? requests[0][0]
      : null;
    if (!Array.isArray(row) || row[0] !== rpc || typeof row[1] !== "string") return null;
    const args = JSON.parse(row[1]);
    return Array.isArray(args) ? args : null;
  } catch {
    return null;
  }
}

/** Replaces one notebook id with another wherever the arguments name it. */
function renamed(value: unknown, from: string, to: string, depth = 0): unknown {
  if (value === from) return to;
  return Array.isArray(value) && depth < 6
    ? value.map((item) => renamed(item, from, to, depth + 1))
    : value;
}

const single = (url: URL, key: string) => {
  const values = url.searchParams.getAll(key);
  return values.length === 1 ? values[0]! : null;
};

/** A NotebookLM batch request for one RPC, as the page sends it. */
export function notebooklmOwnReadRequest(
  origin: string,
  pathname: string,
  rpc: string,
  args: unknown[],
  values: GeminiPageValues | null | undefined,
  language: string,
  authuser: string | null,
  requestNumber: number,
): { url: URL; body: string } | null {
  const text = (value: unknown): value is string =>
    typeof value === "string" && value.length > 0 && value.length <= 512;
  if (!values || !text(values.cfb2h) || !text(values.FdrFJe) || !text(values.SNlM0e))
    return null;
  const query = new URLSearchParams({
    rpcids: rpc,
    "source-path": pathname,
    bl: values.cfb2h,
    "f.sid": values.FdrFJe,
    hl: language || "en",
    _reqid: String(requestNumber),
  });
  if (authuser !== null) query.set("authuser", authuser);
  query.set("rt", "c");
  const request = JSON.stringify([[[rpc, JSON.stringify(args), null, "generic"]]]);
  return {
    url: new URL(`${NOTEBOOKLM_BATCH_PATH}?${query}`, origin),
    body: `f.req=${encodeURIComponent(request)}&at=${encodeURIComponent(values.SNlM0e)}&`,
  };
}

/** The older-page token of a chat page, or null on its oldest page. */
export function notebooklmContinuation(
  body: string | ReturnType<typeof notebooklmHistoryFrames>,
): unknown {
  const read = typeof body === "string" ? notebooklmHistoryFrames(body) : body;
  const value = Array.isArray(read.value) ? read.value : null;
  const token = value?.[1];
  return token === undefined || token === null ? null : token;
}

export function notebooklmOwnRead(deps: {
  origin: string;
  pageValues: () => GeminiPageValues | null | undefined;
  language: () => string;
  /** Draws the request number (`_reqid`), as the page's own requests carry one. */
  random?: () => number;
  /** The wait before each older page; `OWN_READ_PAGE_SPACING_MS` by default. */
  pageDelay?: () => number;
}): OwnReadProvider {
  const random = deps.random ?? Math.random;
  const pageDelay = deps.pageDelay ?? (() => OWN_READ_PAGE_SPACING_MS);
  const learned: Learned = { sessions: null, context: null, authuser: null };
  const rpcOf = (url: URL) =>
    url.pathname === NOTEBOOKLM_BATCH_PATH ? single(url, "rpcids") : null;

  async function run(context: OwnReadContext): Promise<OwnReadOutcome> {
    const notebook = context.conversationId;
    if (!learned.sessions || !learned.context) return { kind: "no_request" };
    const send = <T>(
      rpc: string,
      args: unknown[],
      check: (text: string) => T | null,
    ) => {
      const request = notebooklmOwnReadRequest(
        deps.origin,
        context.pathname,
        rpc,
        args,
        deps.pageValues(),
        deps.language(),
        learned.authuser,
        100000 + Math.floor(random() * 900000),
      );
      if (!request) return Promise.resolve(null);
      return context.read<T>(
        request.url,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
            "x-same-domain": "1",
          },
          body: request.body,
        },
        (text) => {
          const info = check(text);
          return info === null
            ? { ok: false, outcome: { kind: "invalid" } }
            : { ok: true, info };
        },
      );
    };
    const sessionArgs = renamed(
      learned.sessions.args,
      learned.sessions.notebook,
      notebook,
    ) as unknown[];
    const listed = await send(NOTEBOOKLM_SESSIONS_RPC, sessionArgs, (text) =>
      notebooklmChatSessions(text),
    );
    if (!listed) return { kind: "no_session" };
    if (!listed.ok) return listed.outcome;
    let pages = 0;
    for (const session of listed.info) {
      let older: unknown = null;
      do {
        if (pages >= NOTEBOOKLM_PAGE_LIMIT) return { kind: "read_partly" };
        // Each request after the session list renews the content script's wait for an answer.
        context.progress();
        if (pages > 0 && !(await context.pause(pageDelay()))) return { kind: "navigated" };
        pages++;
        const args: unknown[] = [learned.context, null, null, session, PAGE_TURNS];
        if (older !== null) args.push(older);
        const page = await send(NOTEBOOKLM_CHAT_RPC, args, (text) => {
          const read = notebooklmHistoryFrames(text);
          if (read.rpc !== NOTEBOOKLM_CHAT_RPC) return null;
          // The same checks the history reader makes, so a page it would refuse falls back.
          const parsed = parseHistoryText(
            "notebooklm",
            { ...read, session, sessions: listed.info },
            notebook,
            new Date().toISOString(),
          );
          if (parsed.status === "unsupported") return null;
          // The frames were decoded once above; the token is read from them.
          return { older: notebooklmContinuation(read) };
        });
        if (!page) return { kind: "no_session" };
        if (!page.ok) return page.outcome;
        older = page.info.older;
        if (older !== null && JSON.stringify(older).length > TOKEN_LIMIT)
          return { kind: "invalid" };
      } while (older !== null);
    }
    return { kind: "read" };
  }

  return {
    site: "notebooklm",
    learn(url, method, body) {
      const rpc = rpcOf(url);
      if (method !== "POST" || (rpc !== NOTEBOOKLM_SESSIONS_RPC && rpc !== NOTEBOOKLM_CHAT_RPC))
        return;
      const args = batchArgs(body, rpc);
      if (!args) return;
      const notebook = historyRequestConversation("notebooklm", url, method, body);
      if (!notebook) return;
      if (rpc === NOTEBOOKLM_SESSIONS_RPC) learned.sessions = { args, notebook };
      else if (Array.isArray(args[0]) && JSON.stringify(args[0]).length <= TOKEN_LIMIT)
        learned.context = args[0];
      const authuser = url.searchParams.getAll("authuser");
      learned.authuser =
        authuser.length === 1 && /^\d{1,3}$/.test(authuser[0]!) ? authuser[0]! : null;
    },
    // Only the chat reads mean the page read the saved chat; its Studio list polls do not.
    pageReadCounts: (url) => {
      const rpc = rpcOf(url);
      return rpc === NOTEBOOKLM_SESSIONS_RPC || rpc === NOTEBOOKLM_CHAT_RPC;
    },
    run,
  };
}
