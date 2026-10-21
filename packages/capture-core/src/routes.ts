import type { Site } from "./index";

export type RouteSite =
  "chatgpt" | "claude" | "gemini" | "perplexity" | "notebooklm";
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const uuidId = new RegExp("^" + uuid + "$");
// Claude Cowork sessions open at claude.ai/cowork/{id}; their ids are `cse_` plus letters
// and digits (24 seen on 1 Oct 2026). They are Claude conversations of their own kind.
const cowork = "cse_[A-Za-z0-9]{16,64}";
// ChatGPT project and GPT chats open under their gizmo: /g/g-p-{id}-{slug}/c/{id} for a
// project and /g/g-{id}-{slug}/c/{id} for a GPT (G5). The chat id is the same as at /c/.
const gizmo = "g-[A-Za-z0-9][A-Za-z0-9._~%-]{0,255}";
const coworkId = new RegExp("^" + cowork + "$");
// Gemini serves a secondary Google account under /u/{index}/ and a Gem's chats under
// /gem/{gem id}/ (G17, 3 Oct 2026); the chat id is the same in every form.
const geminiRoute =
  /^(?:\/u\/\d{1,3})?\/(?:app|gem\/[A-Za-z0-9_-]{1,128})\/([0-9a-f]{16})$/;

/** The path of Gemini's reply stream, without an account prefix. */
export const GEMINI_STREAM_PATH =
  "/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";

/**
 * A Gemini request path without the /u/{index} prefix a secondary Google account adds to
 * every request (G17), so one check covers every signed-in account.
 */
export function geminiRequestPath(pathname: string): string {
  return pathname.replace(/^\/u\/\d{1,3}(?=\/)/, "");
}

/**
 * Since October 2026 a new ChatGPT chat opens at /c/local-chatgpt:<id> (also under a GPT or
 * project) and moves to /c/<uuid> once ChatGPT names it (seen live 12 Oct 2026). The local id
 * is not the chat's, so this address is no conversation route.
 */
export function isProvisionalChatgptRoute(pathname: string): boolean {
  return /^(?:\/g\/[^/]{1,256})?\/c\/local-chatgpt(?::|%3[aA])[^/]{1,256}$/.test(
    pathname,
  );
}

const unsavedChatgptRoute = new RegExp("^/uc/(" + uuid + ")$");

/**
 * ChatGPT used without an account moves a new chat from / to /uc/<id> once the reply's stream
 * names it (seen live 20 Oct 2026). The chat is not saved: reloading the address opens an empty
 * chat at /, and no request reads it back. It is a conversation of its own, counted only from
 * what the tracker sees live, so nothing waits for or asks for its saved copy.
 */
export function isUnsavedChatgptRoute(pathname: string): boolean {
  return unsavedChatgptRoute.test(pathname);
}

/** NotebookLM's batch RPC path; a secondary account adds `?authuser=N`, not a prefix. */
export const NOTEBOOKLM_BATCH_PATH = "/_/LabsTailwindUi/data/batchexecute";
/**
 * NotebookLM's chat stream. The method name is from the page (1 Oct 2026); the service
 * segment before it is from public reverse-engineering notes, so any one segment is taken.
 */
export function isNotebooklmChatPath(pathname: string): boolean {
  return /^\/_\/LabsTailwindUi\/data\/[A-Za-z0-9._]{1,160}\/GenerateFreeFormStreamed$/.test(
    pathname,
  );
}

/** Whether a Claude conversation id names a Cowork session rather than a chat. */
export function isCoworkSessionId(value: unknown): value is string {
  return typeof value === "string" && coworkId.test(value);
}

export function isRouteConversationId(
  site: Site,
  value: unknown,
): value is string {
  if (typeof value !== "string") return false;
  if (site === "claude") return uuidId.test(value) || coworkId.test(value);
  return site === "gemini"
    ? /^c_[0-9a-f]{16}$/.test(value)
    : (site === "chatgpt" || site === "perplexity" || site === "notebooklm") &&
        uuidId.test(value);
}

/** Only observed route-to-wire relations belong here. A reopened route creates no usage. */
export function parseConversationRoute(
  site: Site,
  pathname: string,
): { site: RouteSite; conversationId: string } | null {
  if (site === "perplexity") {
    // A Perplexity Computer task opens at /computer/tasks/{id} and is a thread like any
    // other: the page reads it with /rest/thread/{id} (seen 14 Oct 2026).
    const match = new RegExp(
      "^/(?:search|computer/tasks)/(" + uuid + ")$",
    ).exec(pathname);
    // This route selects separately verified recorded-thread links, never a conversation-key alias.
    return match ? { site, conversationId: match[1]! } : null;
  }
  if (site === "gemini") {
    const match = geminiRoute.exec(pathname);
    // The observed hNvQHb history argument and generation IDs retain this prefix.
    return match ? { site, conversationId: "c_" + match[1] } : null;
  }
  if (site === "claude") {
    const match =
      new RegExp("^/chat/(" + uuid + ")$").exec(pathname) ??
      new RegExp("^/cowork/(" + cowork + ")$").exec(pathname);
    return match ? { site, conversationId: match[1]! } : null;
  }
  if (site === "chatgpt") {
    const match =
      new RegExp("^(?:/g/" + gizmo + ")?/c/(" + uuid + ")$").exec(pathname) ??
      unsavedChatgptRoute.exec(pathname);
    return match ? { site, conversationId: match[1]! } : null;
  }
  if (site === "notebooklm") {
    // A notebook is the conversation: its chat, Studio items and guides count together.
    const match = new RegExp("^/notebook/(" + uuid + ")$").exec(pathname);
    return match ? { site, conversationId: match[1]! } : null;
  }
  return null;
}
