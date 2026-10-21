import { geminiHistoryFrames } from "@footprint/adapters";
import type { OwnReadProvider } from "./own-read-page";

/**
 * The tracker's own read of a Gemini chat that the page showed again without its history
 * request (returning to a chat in the same document, seen live 13 October 2026). See
 * `own-read.ts` for when it runs.
 *
 * Only the newest ten turns are read, as the page reads them when it opens a chat; the
 * continuation Gemini uses for older turns is not read by the tracker's history reader today.
 */

/** The page's three values the request needs, from its `WIZ_global_data` object. */
export interface GeminiPageValues {
  /** Build label, sent as `bl`. */
  cfb2h?: unknown;
  /** Session id, sent as `f.sid`. */
  FdrFJe?: unknown;
  /** Request token, sent as `at`. Held only for the request, never stored. */
  SNlM0e?: unknown;
}

const text = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 512;

/**
 * The page's own history request for the ten newest turns (captured live on 13 October
 * 2026). A secondary account's `/u/N` prefix and the page's own path are kept as the page
 * sends them (G17).
 */
export function geminiOwnReadRequest(
  origin: string,
  pathname: string,
  conversationId: string,
  values: GeminiPageValues | null | undefined,
  language: string,
  requestNumber: number,
): { url: URL; body: string } | null {
  if (
    !values ||
    !text(values.cfb2h) ||
    !text(values.FdrFJe) ||
    !text(values.SNlM0e) ||
    !/^c_[0-9a-f]{16}$/.test(conversationId)
  )
    return null;
  const prefix = /^\/u\/\d{1,3}(?=\/)/.exec(pathname)?.[0] ?? "";
  const query = new URLSearchParams({
    rpcids: "hNvQHb",
    "source-path": pathname,
    bl: values.cfb2h,
    "f.sid": values.FdrFJe,
    hl: language || "en",
    _reqid: String(requestNumber),
    rt: "c",
  });
  const request = JSON.stringify([
    [
      [
        "hNvQHb",
        JSON.stringify([conversationId, 10, null, 1, [1], [4], null, 1]),
        null,
        "generic",
      ],
    ],
  ]);
  return {
    url: new URL(`${prefix}/_/BardChatUi/data/batchexecute?${query}`, origin),
    body: `f.req=${encodeURIComponent(request)}&at=${encodeURIComponent(values.SNlM0e)}&`,
  };
}

/**
 * Gemini answers an unknown chat with HTTP 200 and an error frame instead of the history
 * (seen live 13 October 2026). This follows Google's usual batch error row, an hNvQHb row
 * with no payload and status 5 (not found) in its sixth field.
 */
function geminiNotFound(body: string): boolean {
  if (!body.startsWith(")]}'")) return false;
  for (const line of body.slice(4).split(/\r?\n/)) {
    if (!line.startsWith("[")) continue;
    let rows: unknown;
    try {
      rows = JSON.parse(line);
    } catch {
      continue;
    }
    if (!Array.isArray(rows)) continue;
    for (const row of rows)
      if (
        Array.isArray(row) &&
        row[0] === "wrb.fr" &&
        row[1] === "hNvQHb" &&
        row[2] == null &&
        Array.isArray(row[5]) &&
        row[5][0] === 5
      )
        return true;
  }
  return false;
}

/** Whether the frames hold turns of this chat, as the history reader needs them. */
export function readableGeminiChat(body: string, conversationId: string) {
  let value: unknown;
  try {
    value = geminiHistoryFrames(body);
  } catch {
    return false;
  }
  const rows = Array.isArray(value) ? value[0] : null;
  return (
    Array.isArray(rows) &&
    rows.length > 0 &&
    rows.every(
      (row) => Array.isArray(row) && Array.isArray(row[0]) && row[0][0] === conversationId,
    )
  );
}

export function geminiOwnRead(deps: {
  origin: string;
  /** Read in the page world at request time; the token is not kept. */
  pageValues: () => GeminiPageValues | null | undefined;
  language: () => string;
  /** Draws the request number (`_reqid`), as the page's own requests carry one. */
  random?: () => number;
}): OwnReadProvider {
  const random = deps.random ?? Math.random;
  return {
    site: "gemini",
    async run(context) {
      const request = geminiOwnReadRequest(
        deps.origin,
        context.pathname,
        context.conversationId,
        deps.pageValues(),
        deps.language(),
        100000 + Math.floor(random() * 900000),
      );
      if (!request) return { kind: "no_session" };
      const result = await context.read(
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
        (body) => {
          if (readableGeminiChat(body, context.conversationId))
            return { ok: true, info: null };
          return {
            ok: false,
            outcome: geminiNotFound(body) ? { kind: "not_found" } : { kind: "invalid" },
          };
        },
      );
      return result.ok ? { kind: "read" } : result.outcome;
    },
  };
}
