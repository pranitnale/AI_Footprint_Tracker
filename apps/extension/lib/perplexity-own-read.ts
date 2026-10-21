import type { OwnReadProvider } from "./own-read-page";

/**
 * The tracker's own read of a Perplexity thread that the page showed without its thread
 * request (full page loads, back and forward, reopening a thread in the same document; seen
 * live 13 October 2026). See `own-read.ts` for when it runs.
 *
 * Only the first page (the newest 20 entries and the thread's first entry) is read; later
 * pages of a long thread are left to the page, as when the person scrolls.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const API_VERSION = "2.18";

/**
 * The block kinds the page asks for, in the page's order (all 26, captured live on 14 October
 * 2026). Sending the same list keeps our read identical to the page's, so the answer has the
 * same blocks the history reader already understands.
 */
export const PERPLEXITY_BLOCK_USE_CASES = [
  "answer_modes",
  "media_items",
  "inline_entity_cards",
  "place_widgets",
  "finance_widgets",
  "news_widgets",
  "shopping_widgets",
  "search_result_widgets",
  "inline_images",
  "inline_assets",
  "placeholder_cards",
  "diff_blocks",
  "entity_group_v2",
  "refinement_filters",
  "canvas_mode",
  "maps_preview",
  "answer_tabs",
  "preserve_latex",
  "in_context_suggestions",
  "pending_followups",
  "inline_claims",
  "unified_assets",
  "workflow_steps",
  "workflow_widgets",
  "navigation_results",
  "background_agents",
] as const;

/** The page's own thread request (captured live on 13 October 2026). */
export function perplexityOwnReadUrl(origin: string, threadId: string): URL | null {
  if (!UUID.test(threadId)) return null;
  const query = new URLSearchParams({
    with_parent_info: "true",
    with_schematized_response: "true",
    version: API_VERSION,
    source: "default",
    limit: "20",
    offset: "0",
    from_first: "false",
    with_first_entry: "true",
    with_latest_entry: "false",
  });
  for (const useCase of PERPLEXITY_BLOCK_USE_CASES)
    query.append("supported_block_use_cases", useCase);
  return new URL(`/rest/thread/${threadId}?${query}`, origin);
}

/**
 * The account the page is signed in to. Without it Perplexity refuses the read (403
 * `VIEW_THREAD_NOT_ALLOWED`). The page keeps it in local storage and a readable cookie.
 */
export function perplexityAccount(stored: string | null, cookie: string): string | null {
  const clean = (value: string | null | undefined) => {
    if (!value) return null;
    let id = value.trim();
    try {
      id = decodeURIComponent(id);
    } catch {
      return null;
    }
    id = id.replace(/^"(.*)"$/, "$1");
    return UUID.test(id) ? id : null;
  };
  const fromStorage = clean(stored);
  if (fromStorage) return fromStorage;
  for (const part of cookie.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === "__Host-pplx-last-active-account") return clean(value.join("="));
  }
  return null;
}

/** The checks the thread reader makes on the whole page before it reads entries. */
export function readablePerplexityThread(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const thread = value as Record<string, unknown>;
  return (
    thread.status === "success" &&
    Array.isArray(thread.entries) &&
    thread.entries.length > 0 &&
    typeof thread.has_next_page === "boolean"
  );
}

export function perplexityOwnRead(deps: {
  origin: string;
  /** `pplx-last-active-account` from local storage, read at request time. */
  storedAccount: () => string | null;
  cookie: () => string;
}): OwnReadProvider {
  return {
    site: "perplexity",
    async run(context) {
      const url = perplexityOwnReadUrl(deps.origin, context.conversationId);
      const account = perplexityAccount(deps.storedAccount(), deps.cookie());
      if (!url || !account) return { kind: "no_session" };
      const result = await context.read(
        url,
        {
          method: "GET",
          credentials: "same-origin",
          headers: {
            "x-app-apiclient": "default",
            "x-app-apiversion": API_VERSION,
            "x-pplx-account": account,
          },
        },
        (text) =>
          readablePerplexityThread(JSON.parse(text))
            ? { ok: true, info: null }
            : { ok: false, outcome: { kind: "invalid" } },
      );
      return result.ok ? { kind: "read" } : result.outcome;
    },
  };
}
