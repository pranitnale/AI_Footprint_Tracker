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

/**
 * Whether a page of a resumed read holds a counted result that names a prompt the read has
 * not seen. Such a prompt was sent before the place the read resumed from, queued while the
 * turn before it was still running, so its saved chat messages would never be named. `seen`
 * collects the ids of the user messages read so far, those a turn handoff carried included.
 * Ids only; no text is read.
 */
export function coworkMissedPrompt(value: unknown, seen: Set<string>): boolean {
  const data = (value as { data: unknown[] }).data;
  for (const event of data) {
    const payload = (event as { payload?: unknown } | null)?.payload;
    if (!payload || typeof payload !== "object") continue;
    const { type, uuid, request, modelUsage, user_message_uuids, user_message_uuid } =
      payload as Record<string, any>;
    if (type === "user") {
      if (typeof uuid === "string") seen.add(uuid);
    } else if (type === "control_request") {
      if (Array.isArray(request?.messages))
        for (const message of request.messages)
          if (typeof message?.uuid === "string") seen.add(message.uuid);
    } else if (
      type === "result" &&
      // A result with empty counters ran no model and stands for no turn.
      modelUsage &&
      typeof modelUsage === "object" &&
      Object.keys(modelUsage).length
    ) {
      const named: unknown[] = Array.isArray(user_message_uuids)
        ? user_message_uuids
        : user_message_uuid !== undefined
          ? [user_message_uuid]
          : [];
      if (named.some((id) => typeof id === "string" && !seen.has(id))) return true;
    }
  }
  return false;
}

/** Where a resumed read starts: the sequence number of the last event already counted. */
export const coworkResume = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 1;

export async function coworkOwnRead(
  context: OwnReadContext,
  origin: string,
  pageDelay: () => number,
): Promise<OwnReadOutcome> {
  // A session counted before is read on from its last counted event. A cursor is the
  // sequence number already seen, and an empty page means nothing new (probe of 22 Nov 2026).
  let cursor: number | null = coworkResume(context.resume) ? context.resume : null;
  // A resumed read goes back to the first event once, when it meets a prompt it has not seen.
  const resumed = { now: cursor !== null, missed: false };
  const seen = new Set<string>();
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
        const value = JSON.parse(text);
        const page = coworkEventsPage(value, after);
        if (page && resumed.now && coworkMissedPrompt(value, seen)) {
          // This page is not handed to the reader; the pages from the first event are.
          resumed.missed = true;
          return { ok: false, outcome: { kind: "invalid" } };
        }
        return page ? { ok: true, info: page } : { ok: false, outcome: { kind: "invalid" } };
      },
    );
    if (resumed.missed) {
      resumed.now = resumed.missed = false;
      seen.clear();
      cursor = null;
      continue;
    }
    if (!result.ok) return result.outcome;
    if (result.info.events < COWORK_PAGE_EVENTS || result.info.last === null)
      return { kind: "read" };
    cursor = result.info.last;
  }
}
