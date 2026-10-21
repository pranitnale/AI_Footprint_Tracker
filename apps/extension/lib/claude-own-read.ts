import { isCoworkSessionId } from "@footprint/capture-core";
import { coworkListSession, coworkOwnRead } from "./cowork-own-read";
import { historyRequestConversation } from "./history-route";
import { OWN_READ_PAGE_SPACING_MS, type OwnReadProvider } from "./own-read-page";

/**
 * The tracker's own read of a claude.ai chat that the page showed from its client cache
 * (owner decision, option 5, 13 October 2026), or of a Cowork session whose start the page's
 * reads did not show (`cowork-own-read.ts`). See `own-read.ts` for when it runs.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);
const ORGANIZATION_PATH = /^\/api\/organizations\/([^/]+)\//;

/**
 * The page's own conversation request, with its parameters in the page's order (captured
 * live on 13 October 2026). `tree=True` returns every branch; without it only the selected
 * branch arrives.
 */
export function claudeOwnReadUrl(
  origin: string,
  organizationId: string,
  conversationId: string,
): URL | null {
  if (!isUuid(organizationId) || !isUuid(conversationId)) return null;
  return new URL(
    `/api/organizations/${organizationId}/chat_conversations/${conversationId}` +
      "?tree=True&rendering_mode=messages&render_all_tools=true" +
      "&include_inline_comparison=true&consistency=strong",
    origin,
  );
}

/** The organization in claude.ai's `lastActiveOrg` cookie, when it holds a UUID. */
export function lastActiveOrganization(cookie: string): string | null {
  for (const part of cookie.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name !== "lastActiveOrg") continue;
    try {
      const id = decodeURIComponent(value.join("="));
      return isUuid(id) ? id : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Mirrors the checks `ClaudeHistoryStream.finish` makes on the whole chat, so an answer the
 * reader would refuse falls back to "History not loaded" instead of a history problem.
 */
export function readableClaudeChat(value: unknown, conversationId: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const chat = value as Record<string, unknown>;
  const leaf = chat.current_leaf_message_uuid;
  return (
    chat.uuid === conversationId &&
    typeof leaf === "string" &&
    Array.isArray(chat.chat_messages) &&
    chat.chat_messages.some(
      (row) =>
        !!row && typeof row === "object" && (row as { uuid?: unknown }).uuid === leaf,
    )
  );
}

export function claudeOwnRead(deps: {
  origin: string;
  cookie: () => string;
  /** The wait before each later page of Cowork events; `OWN_READ_PAGE_SPACING_MS` by default. */
  pageDelay?: () => number;
}): OwnReadProvider {
  // The organization this page's own API requests use; the cookie is the fallback.
  let organization: string | null = null;
  const pageDelay = deps.pageDelay ?? (() => OWN_READ_PAGE_SPACING_MS);
  return {
    site: "claude",
    learn(url) {
      const id = ORGANIZATION_PATH.exec(url.pathname)?.[1];
      if (isUuid(id)) organization = id;
    },
    // A Cowork session's events list counts as the page's read of it; its live stream and
    // sends do not.
    pageReadConversation: (url, method, body) =>
      coworkListSession(url, method) ??
      historyRequestConversation("claude", url, method, body),
    async run(context) {
      if (isCoworkSessionId(context.conversationId))
        return coworkOwnRead(context, deps.origin, pageDelay);
      const url = claudeOwnReadUrl(
        deps.origin,
        organization ?? lastActiveOrganization(deps.cookie()) ?? "",
        context.conversationId,
      );
      if (!url) return { kind: "no_session" };
      // Only method and credentials: no page headers such as device or session ids.
      const result = await context.read(
        url,
        { method: "GET", credentials: "include" },
        (text, response) =>
          /^application\/json\b/i.test(response.headers.get("content-type") ?? "") &&
          readableClaudeChat(JSON.parse(text), context.conversationId)
            ? { ok: true, info: null }
            : { ok: false, outcome: { kind: "invalid" } },
      );
      return result.ok ? { kind: "read" } : result.outcome;
    },
  };
}
