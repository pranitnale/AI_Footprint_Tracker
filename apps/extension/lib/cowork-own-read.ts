import { coworkRequest } from "@footprint/adapters";
import { isCoworkSessionId } from "@footprint/capture-core";
import type { OwnReadOutcome } from "./own-read";
import type { OwnReadContext } from "./own-read-page";

/**
 * The tracker's own read of a Claude Cowork session (owner decision of 14 October 2026).
 * When the session's start was not proven from the page's own event reads (start proof of
 * 26fbc03) or the page read none, the page world reads the session's events from the
 * first one, page by page, as the page's own list request does, and hands each page to the
 * Cowork event reader. See `own-read.ts` for when it runs.
 */

/** Events per page, as the page asks for them since 6 October 2026. */
export const COWORK_PAGE_EVENTS = 500;
/** At most this many pages per run. */
export const COWORK_PAGE_LIMIT = 20;
/** The API version the events endpoint requires (400 without it). */
const API_VERSION = "2023-06-01";

/** A page of the session's events, oldest first; later pages start after `cursor`. */
export function coworkEventsUrl(
  origin: string,
  session: string,
  cursor: number | null = null,
): URL | null {
  if (!isCoworkSessionId(session)) return null;
  return new URL(
    `/v1/code/sessions/${session}/events?limit=${COWORK_PAGE_EVENTS}&sort_order=asc` +
      (cursor === null ? "" : `&cursor=${cursor}`),
    origin,
  );
}

const sequenceOf = (value: unknown): number | null => {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^[1-9][0-9]{0,14}$/.test(value)
        ? Number(value)
        : null;
  return number !== null && Number.isSafeInteger(number) && number >= 1 ? number : null;
};

/**
 * A page of events as the Cowork reader takes it: `{data: [...]}` whose events carry their
 * sequence numbers in order. The number of events and the last sequence number tell
 * whether a later page exists and where it starts.
 */
export function coworkEventsPage(
  value: unknown,
  after: number | null,
): { events: number; last: number | null } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = (value as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length > COWORK_PAGE_EVENTS) return null;
  let last = after;
  for (const event of data) {
    const sequence =
      event && typeof event === "object"
        ? sequenceOf((event as { sequence_num?: unknown }).sequence_num)
        : null;
    if (sequence === null || (last !== null && sequence <= last)) return null;
    last = sequence;
  }
  return { events: data.length, last };
}

/** Whether a page request reads the session's events list (not its live stream). */
export function coworkListSession(url: URL, method: string): string | null {
  const request = coworkRequest(url, method);
  return request?.kind === "events" ? request.session : null;
}

export async function coworkOwnRead(
  context: OwnReadContext,
  origin: string,
  pageDelay: () => number,
): Promise<OwnReadOutcome> {
  let cursor: number | null = null;
  for (let pages = 0; ; pages++) {
    if (pages >= COWORK_PAGE_LIMIT) return { kind: "read_partly" };
    if (pages > 0) {
      context.progress();
      if (!(await context.pause(pageDelay()))) return { kind: "navigated" };
    }
    const url = coworkEventsUrl(origin, context.conversationId, cursor);
    if (!url) return { kind: "invalid" };
    const after = cursor;
    const result = await context.read(
      url,
      {
        method: "GET",
        credentials: "include",
        headers: { "anthropic-version": API_VERSION },
      },
      (text) => {
        const page = coworkEventsPage(JSON.parse(text), after);
        return page ? { ok: true, info: page } : { ok: false, outcome: { kind: "invalid" } };
      },
    );
    if (!result.ok) return result.outcome;
    if (result.info.events < COWORK_PAGE_EVENTS || result.info.last === null)
      return { kind: "read" };
    cursor = result.info.last;
  }
}
