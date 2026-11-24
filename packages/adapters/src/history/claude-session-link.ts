import { isCoworkSessionId } from "@footprint/capture-core";
import { historyUUID, record } from "./common";

/*
 * Since 18 Nov 2026 claude.ai shows chats and Cowork sessions at /chat/<uuid>. A chat made or
 * continued since then is backed by a session (`cse_...`) whose events hold Claude's own token
 * counts. Two answers the page loads by itself say which session backs which chat: a row of
 * the chat list (`workspace_session_id`) and the session object's `bard-conversation:<uuid>`
 * tag. Only these two prove a link; a session request that merely happens while a chat is
 * shown does not. Ids and counts are read, nothing else.
 */

export type ClaudeSessionLink = { chat: string; session: string };
/** Claude's own running totals for a session; a count the object lacks is null. */
export type ClaudeSessionTotals = {
  output: number;
  input: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
};

const SESSION_PATH = /^\/v1\/code\/sessions\/(cse_[A-Za-z0-9]{16,64})$/;
const LIST_PATH =
  /^\/api\/organizations\/[0-9a-f-]{36}\/chat_conversations_v2$/;
const CHAT_TAG = /^bard-conversation:(.{36})$/;
// The page asks for 30 rows at a time; a longer list is read up to this bound.
const LIST_ROWS = 512;
const TAGS = 256;
const COUNT_LIMIT = 1_000_000_000_000;

const count = (value: unknown): number | null =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= COUNT_LIMIT
    ? (value as number)
    : null;

/** Whether a value is Claude's totals in exactly this shape, with every count in range. */
export function validClaudeSessionTotals(
  value: unknown,
): value is ClaudeSessionTotals {
  return (
    record(value) &&
    Object.keys(value).sort().join(",") === "cacheRead,cacheWrite,input,output" &&
    count(value.output) !== null &&
    [value.input, value.cacheRead, value.cacheWrite].every(
      (part) => part === null || count(part) !== null,
    )
  );
}

/** Whether a page request answers with link facts: the chat list, or one session's object. */
export function claudeLinkRequest(
  url: URL,
  method: string,
): { kind: "list" } | { kind: "session"; session: string } | null {
  if (method !== "GET") return null;
  const session = SESSION_PATH.exec(url.pathname);
  if (session) return { kind: "session", session: session[1]! };
  return LIST_PATH.test(url.pathname) ? { kind: "list" } : null;
}

const READ_SESSION_PATH =
  "/claudeai-rpc/anthropic.bard.api.v1alpha.ConversationService/ReadCoworkSession";
// The request is a few dozen bytes and the answer under a hundred; larger ones are not read.
const READ_SESSION_REQUEST_BYTES = 4096;
export const CLAUDE_READ_SESSION_ANSWER_BYTES = 65536;
const SESSION_IN_BYTES = /cse_[A-Za-z0-9]{16,64}/g;
const UUID_IN_BYTES =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** Whether a page request asks Claude for a Cowork session by its id. */
export function claudeReadSessionRequest(url: URL, method: string): boolean {
  return method === "POST" && url.pathname === READ_SESSION_PATH;
}

/**
 * The link a `ReadCoworkSession` call of the page proves (probe of 22 Nov 2026). A Cowork
 * session from before the merge has no chat list row and no chat tag. When it is opened from
 * the list, at `/cowork/<session>`, the page asks for it by its id and the answer holds the
 * address the page then shows it at, `/chat/<uuid>`. Both bodies are protobuf; the ids are
 * found as plain text, without a schema. Null unless the request holds exactly one session id
 * and the answer exactly one uuid. Ids only; nothing else is read.
 */
export function claudeReadSessionLink(
  request: Uint8Array,
  answer: Uint8Array,
): ClaudeSessionLink | null {
  if (
    request.length > READ_SESSION_REQUEST_BYTES ||
    answer.length > CLAUDE_READ_SESSION_ANSWER_BYTES
  )
    return null;
  // One character per byte, so the ids, which are plain ASCII, are found unchanged.
  const text = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);
  const sessions = new Set(text(request).match(SESSION_IN_BYTES) ?? []);
  const chats = new Set(text(answer).match(UUID_IN_BYTES) ?? []);
  if (sessions.size !== 1 || chats.size !== 1) return null;
  const [session] = sessions;
  const [chat] = chats;
  return isCoworkSessionId(session) && historyUUID(chat)
    ? { chat: chat as string, session: session as string }
    : null;
}

/**
 * The chats a list answer links to a session. A chat or a session that the list pairs with
 * two different partners is left out: a wrong link would show another session's figures.
 */
export function claudeChatListLinks(value: unknown): ClaudeSessionLink[] {
  const rows = Array.isArray(value)
    ? value
    : record(value) && Array.isArray(value.data)
      ? value.data
      : null;
  if (!rows) return [];
  const sessions = new Map<string, string>();
  const chats = new Map<string, string>();
  const unclear = new Set<string>();
  for (const row of rows.slice(0, LIST_ROWS)) {
    if (
      !record(row) ||
      !historyUUID(row.uuid) ||
      !isCoworkSessionId(row.workspace_session_id) ||
      // A row that says it was not upgraded contradicts its own session id.
      row.workspace_upgraded === false
    )
      continue;
    const chat = row.uuid;
    const session = row.workspace_session_id;
    if ((sessions.get(chat) ?? session) !== session) unclear.add(chat);
    if ((chats.get(session) ?? chat) !== chat) {
      unclear.add(chat);
      unclear.add(chats.get(session)!);
    }
    if (!sessions.has(chat)) sessions.set(chat, session);
    if (!chats.has(session)) chats.set(session, chat);
  }
  return [...sessions]
    .filter(([chat]) => !unclear.has(chat))
    .map(([chat, session]) => ({ chat, session }));
}

/**
 * What a session object says about the session the request named: the chat its tags name,
 * when they name exactly one, and Claude's running totals. The object arrives plain or inside
 * `response_shape` (seen 22 Nov 2026). Null when it is not that session's object.
 */
export function claudeSessionObject(
  value: unknown,
  session: string,
): { chat: string | null; totals: ClaudeSessionTotals | null } | null {
  if (!isCoworkSessionId(session) || !record(value)) return null;
  const body = record(value.response_shape) ? value.response_shape : value;
  if (isCoworkSessionId(body.id) && body.id !== session) return null;
  const named = new Set<string>();
  if (Array.isArray(body.tags))
    for (const tag of body.tags.slice(0, TAGS)) {
      const chat = typeof tag === "string" ? CHAT_TAG.exec(tag)?.[1] : null;
      if (historyUUID(chat)) named.add(chat);
    }
  const usage = record(body.external_metadata)
    ? body.external_metadata.usage
    : null;
  const output = record(usage) ? count(usage.output_tokens) : null;
  return {
    chat: named.size === 1 ? [...named][0]! : null,
    totals:
      output === null
        ? null
        : {
            output,
            input: count(usage.input_tokens),
            cacheRead: count(usage.cache_read_tokens),
            cacheWrite: count(usage.cache_write_tokens),
          },
  };
}
