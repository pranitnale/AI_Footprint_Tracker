import {
  HISTORY_LIMITS,
  NOTEBOOKLM_CHAT_RPC,
  NOTEBOOKLM_ITEM_RPC,
  NOTEBOOKLM_SESSIONS_RPC,
  NOTEBOOKLM_STUDIO_RPC,
  notebooklmId,
} from "@footprint/adapters";
import {
  geminiRequestPath,
  isRouteConversationId,
  NOTEBOOKLM_BATCH_PATH,
  parseConversationRoute,
  type Site,
} from "@footprint/capture-core";

/** Gemini's batch RPC path, without the account prefix of a secondary account (G17). */
export const GEMINI_HISTORY_PATH = "/_/BardChatUi/data/batchexecute";
const GEMINI_HISTORY_ARGS = JSON.stringify([10, null, 1, [1], [4], null, 1]);

/** Whether a Gemini batch URL names only the history RPC. */
export function geminiHistoryRpc(url: URL): boolean {
  const rpcs = url.searchParams.getAll("rpcids");
  return rpcs.length === 1 && rpcs[0] === "hNvQHb";
}

/** The Studio list filter the page sends (1 and 3 Oct 2026): every item except suggestions. */
const NOTEBOOKLM_STUDIO_FILTER =
  'NOT artifact.status = "ARTIFACT_STATUS_SUGGESTED"';

const NOTEBOOKLM_HISTORY_RPCS: ReadonlySet<unknown> = new Set([
  NOTEBOOKLM_STUDIO_RPC,
  NOTEBOOKLM_ITEM_RPC,
  NOTEBOOKLM_SESSIONS_RPC,
  NOTEBOOKLM_CHAT_RPC,
]);

/**
 * Whether a NotebookLM batch URL names only one saved-state read: the Studio list, an
 * opened item, the chat session list or a page of chat turns.
 */
export function notebooklmHistoryRpc(url: URL): boolean {
  const rpcs = url.searchParams.getAll("rpcids");
  return (
    url.pathname === NOTEBOOKLM_BATCH_PATH &&
    rpcs.length === 1 &&
    NOTEBOOKLM_HISTORY_RPCS.has(rpcs[0])
  );
}

/** Most turns the page asks for in one chat read; it asked for 20 (14 Oct 2026). */
const NOTEBOOKLM_CHAT_PAGE = 100;

/**
 * The session and continuation a chat read names: `[ctx, null, null, sessionId, 20]`, and
 * the older-page token as a sixth argument when the user scrolls up (14 Oct 2026).
 */
function notebooklmChatArgs(
  args: unknown[],
): { session: string; older: unknown } | null {
  return (args.length === 5 || args.length === 6) &&
    Array.isArray(args[0]) &&
    args[1] === null &&
    args[2] === null &&
    notebooklmId(args[3]) &&
    Number.isSafeInteger(args[4]) &&
    (args[4] as number) > 0 &&
    (args[4] as number) <= NOTEBOOKLM_CHAT_PAGE
    ? { session: args[3], older: args[5] ?? null }
    : null;
}

/** Whether a value names the notebook, at most a few arrays deep. */
function namesNotebook(value: unknown, notebook: string, depth = 0): boolean {
  if (value === notebook) return true;
  return (
    depth < 4 &&
    Array.isArray(value) &&
    value.some((item) => namesNotebook(item, notebook, depth + 1))
  );
}

/** The arguments of a batch request's one RPC, or null. */
function batchArgs(body: string, rpc: string): unknown[] | null {
  const form = new URLSearchParams(body);
  if (form.getAll("f.req").length !== 1) return null;
  const requests = JSON.parse(form.get("f.req")!);
  if (
    !Array.isArray(requests) ||
    requests.length !== 1 ||
    !Array.isArray(requests[0]) ||
    requests[0].length > 16
  )
    return null;
  const rows = requests[0].filter(
    (row: unknown) => Array.isArray(row) && row[0] === rpc,
  );
  if (rows.length !== 1 || typeof rows[0][1] !== "string") return null;
  const args = JSON.parse(rows[0][1]);
  return Array.isArray(args) ? args : null;
}

/**
 * The notebook a Studio read belongs to. The list names its notebook; an opened item names
 * only itself, so its notebook is the page the request was sent from (`source-path`).
 */
function notebooklmRequestNotebook(url: URL, body: string): string | null {
  const rpc = url.searchParams.get("rpcids")!;
  const args = batchArgs(body, rpc);
  if (!args) return null;
  if (rpc === NOTEBOOKLM_STUDIO_RPC)
    return args.length === 3 &&
      args[2] === NOTEBOOKLM_STUDIO_FILTER &&
      isRouteConversationId("notebooklm", args[1])
      ? (args[1] as string)
      : null;
  const paths = url.searchParams.getAll("source-path");
  const page =
    paths.length === 1
      ? (parseConversationRoute("notebooklm", paths[0]!)?.conversationId ?? null)
      : null;
  // The chat reads name their session or notebook, not always both; the page they are
  // sent from names the notebook (14 Oct 2026).
  if (rpc === NOTEBOOKLM_CHAT_RPC)
    return notebooklmChatArgs(args) ? page : null;
  if (rpc === NOTEBOOKLM_SESSIONS_RPC)
    return page && namesNotebook(args, page) ? page : null;
  // Since 5 Oct 2026 (seen live) the page adds a block of client options after the item's
  // id; it does not change which item is read.
  const options =
    args.length === 1 || (args.length === 2 && Array.isArray(args[1]));
  return options && notebooklmId(args[0]) ? page : null;
}

/**
 * The chat session a NotebookLM chat read names, from its read kind
 * (`historyReadKind`), or null for any other read.
 */
export function notebooklmChatSession(kind: string): string | null {
  const [rpc, session] = kind.split(":");
  return rpc === NOTEBOOKLM_CHAT_RPC && notebooklmId(session) ? session : null;
}

/** A short digest that keeps two older-page tokens apart as read kinds. */
function digest(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++)
    hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0") + value.length.toString(16);
}

/**
 * Whether a ChatGPT read is an earlier page of a chat: the page loads the newest turns
 * first and earlier ones, before the first message it shows, when the user scrolls up
 * (seen 5 Oct 2026). Its body names neither the chat nor its selected message.
 */
export function chatgptEarlierPage(url: URL): boolean {
  const before = url.searchParams.getAll("before");
  return (
    /^\/backend-api\/conversations\/[^/]+\/messages$/.test(url.pathname) &&
    before.length === 1 &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      before[0]!,
    )
  );
}

/**
 * Which saved state a read returns, when one conversation has several: NotebookLM's
 * Studio list or one opened item, or one earlier page of a ChatGPT chat. Other reads
 * return the chat's newest state ("").
 */
export function historyReadKind(site: Site, url: URL, body?: unknown): string {
  if (site === "chatgpt" && chatgptEarlierPage(url))
    return "before:" + url.searchParams.get("before");
  if (site !== "notebooklm" || !notebooklmHistoryRpc(url)) return "";
  const rpc = url.searchParams.get("rpcids")!;
  if (rpc === NOTEBOOKLM_STUDIO_RPC || typeof body !== "string") return rpc;
  try {
    const args = batchArgs(body, rpc);
    // Each page of a chat session is its own read: the newest page, and each older page
    // by its token, so a later read never replaces a waiting page of other turns.
    if (rpc === NOTEBOOKLM_CHAT_RPC) {
      const chat = args && notebooklmChatArgs(args);
      return chat
        ? rpc +
            ":" +
            chat.session +
            (chat.older === null ? "" : ":" + digest(JSON.stringify(chat.older)))
        : rpc;
    }
    return notebooklmId(args?.[0]) ? rpc + ":" + args![0] : rpc;
  } catch {
    return rpc;
  }
}

/**
 * The conversation a host history read asks for, taken from the request itself.
 * Providers can issue this request a few milliseconds before the address bar
 * changes, so the current route is not a reliable source for the id.
 */
export function historyRequestConversation(
  site: Site,
  url: URL,
  method: string,
  body?: unknown,
): string | null {
  if (site === "notebooklm") {
    if (
      method !== "POST" ||
      !notebooklmHistoryRpc(url) ||
      typeof body !== "string" ||
      body.length > HISTORY_LIMITS.responseBytes
    )
      return null;
    try {
      return notebooklmRequestNotebook(url, body);
    } catch {
      return null;
    }
  }
  if (site === "gemini") {
    if (
      method !== "POST" ||
      geminiRequestPath(url.pathname) !== GEMINI_HISTORY_PATH ||
      typeof body !== "string" ||
      body.length > HISTORY_LIMITS.responseBytes
    )
      return null;
    try {
      const form = new URLSearchParams(body);
      if (form.getAll("f.req").length !== 1) return null;
      const requests = JSON.parse(form.get("f.req")!);
      if (
        !Array.isArray(requests) ||
        requests.length !== 1 ||
        !Array.isArray(requests[0]) ||
        requests[0].length > 16
      )
        return null;
      const rows = requests[0].filter(
        (row: unknown) => Array.isArray(row) && row[0] === "hNvQHb",
      );
      if (rows.length !== 1 || typeof rows[0][1] !== "string") return null;
      const args = JSON.parse(rows[0][1]);
      return Array.isArray(args) &&
        args.length === 8 &&
        JSON.stringify(args.slice(1)) === GEMINI_HISTORY_ARGS &&
        isRouteConversationId("gemini", args[0])
        ? args[0]
        : null;
    } catch {
      return null;
    }
  }
  if (method !== "GET") return null;
  const match =
    site === "claude"
      ? /^\/api\/organizations\/[0-9a-f-]{36}\/chat_conversations\/([0-9a-f-]{36})$/.exec(
          url.pathname,
        )
      : site === "chatgpt"
        ? (/^\/backend-api\/conversations\/([^/]+)$/.exec(url.pathname) ??
          (chatgptEarlierPage(url)
            ? /^\/backend-api\/conversations\/([^/]+)\/messages$/.exec(
                url.pathname,
              )
            : null))
        : site === "perplexity"
          ? /^\/rest\/thread\/([^/]+)$/.exec(url.pathname)
          : null;
  const id = match?.[1];
  return isRouteConversationId(site, id) ? id : null;
}

/**
 * Calls waiting checks when the address may have changed, only while something waits.
 * The Navigation API reports pushState synchronously where it exists; a 50 ms poll
 * covers browsers without it and bounds each wait's deadline.
 */
export function createRouteWatch() {
  const candidate = (globalThis as { navigation?: unknown }).navigation;
  const navigation =
    candidate instanceof EventTarget ? (candidate as EventTarget) : null;
  const add = EventTarget.prototype.addEventListener,
    remove = EventTarget.prototype.removeEventListener;
  const checks = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  const run = () => {
    for (const check of [...checks]) {
      try {
        check();
      } catch {}
    }
    if (!checks.size) stop();
  };
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
    if (navigation)
      try {
        Reflect.apply(remove, navigation, ["currententrychange", run]);
      } catch {}
  };
  return {
    watch(check: () => void) {
      checks.add(check);
      if (!timer) {
        timer = setInterval(run, 50);
        if (navigation)
          try {
            Reflect.apply(add, navigation, ["currententrychange", run]);
          } catch {}
      }
      return () => {
        checks.delete(check);
        if (!checks.size) stop();
      };
    },
    clear() {
      checks.clear();
      stop();
    },
  };
}
