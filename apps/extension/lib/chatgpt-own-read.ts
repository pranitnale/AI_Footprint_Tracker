import { chatgptEarlierPage } from "./history-route";
import type { OwnReadOutcome } from "./own-read";
import {
  OWN_READ_PAGE_SPACING_MS,
  httpOutcome,
  type OwnReadContext,
  type OwnReadProvider,
} from "./own-read-page";
import {
  CHATGPT_DAY_PAGE_LIMIT,
  validChatgptResume,
  type ChatgptReadReport,
} from "./chatgpt-read-progress";

/**
 * The tracker's own read of a ChatGPT chat (owner decision of 13 October 2026). The page
 * loads the newest ten turns and earlier ones only when the person scrolls up, so a long chat
 * stays "Partially loaded". The tracker then reads the newest page and earlier pages, one at a
 * time and in order, with the requests the page's own scroll makes, while the chat stays open
 * and visible. The same run also
 * covers a chat whose first read the page never made. See `own-read.ts` for when it runs.
 *
 * Long chats (14 October 2026): a chat of more than 200 prompts has more than 40 pages. A read
 * continues below the oldest page an earlier opening read (`chatgpt-read-progress.ts`), and
 * while the chat stays open and shown it goes on in batches of 20 pages, a minute apart, up
 * to 200 pages per chat and day.
 */

/** At most this many pages per batch; an opening's first batch includes the newest page. */
export const CHATGPT_PAGE_LIMIT = 20;
/** Between two batches the read waits a minute, counted in steps that end while shown. */
export const CHATGPT_BATCH_PAUSE_MS = 60_000;
/**
 * Each step of the batch pause tells the content script the read goes on, well within its
 * reply time (`OWN_READ_REPLY_MS`).
 */
const BATCH_PAUSE_STEP_MS = 15_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PAGE_QUERY = "num_turns=10&include_has_versions=true";

export function chatgptNewestUrl(origin: string, conversationId: string): URL {
  return new URL(`/backend-api/conversations/${conversationId}?${PAGE_QUERY}`, origin);
}

export function chatgptEarlierUrl(
  origin: string,
  conversationId: string,
  before: string,
): URL {
  return new URL(
    `/backend-api/conversations/${conversationId}/messages?before=${before}&${PAGE_QUERY}`,
    origin,
  );
}

interface PageInfo {
  hasPrevious: boolean;
  cursor: string | null;
  /** The earliest and latest message times on the page (seconds), when it shows any. */
  earliest: number | null;
  latest: number | null;
}

/**
 * The checks the history reader makes before it reads a page's messages. The newest page
 * names its chat; an earlier page names only `messages` and `page_info`.
 */
export function chatgptPageInfo(
  value: unknown,
  conversationId: string,
  earlier: boolean,
): PageInfo | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const page = value as Record<string, any>;
  if (
    (!earlier && page.conversation_id !== conversationId) ||
    !Array.isArray(page.messages) ||
    page.messages.length === 0 ||
    !page.page_info ||
    typeof page.page_info !== "object" ||
    typeof page.page_info.has_previous_page !== "boolean"
  )
    return null;
  const cursor = page.page_info.start_cursor;
  const times = page.messages
    .map((message: any) => message?.create_time)
    .filter(
      (time: unknown): time is number =>
        typeof time === "number" && Number.isFinite(time) && time >= 0 && time <= 1e11,
    );
  return {
    hasPrevious: page.page_info.has_previous_page,
    cursor: typeof cursor === "string" && UUID.test(cursor) ? cursor : null,
    earliest: times.length ? Math.min(...times) : null,
    latest: times.length ? Math.max(...times) : null,
  };
}

/**
 * The session's access token and account id, which ChatGPT requires on these requests
 * (cookies alone give 401). They are read right before the run and dropped when it ends;
 * they are never stored, logged or sent anywhere but ChatGPT.
 */
async function chatgptSession(
  context: OwnReadContext,
  origin: string,
): Promise<{ token: string; account: string } | { outcome: OwnReadOutcome }> {
  const answer = await context.fetchPrivate(new URL("/api/auth/session", origin), {
    method: "GET",
    credentials: "include",
  });
  if ("kind" in answer) return { outcome: answer };
  if (answer.status < 200 || answer.status > 299)
    return { outcome: httpOutcome(answer.status, answer.headers, Date.now()) };
  try {
    // The body was read within the request's time limit; a missing one is no session.
    const session = JSON.parse(answer.text ?? "");
    const token = session?.accessToken;
    const account = session?.account?.id;
    if (
      typeof token === "string" &&
      token.length > 0 &&
      token.length <= 16384 &&
      typeof account === "string" &&
      /^[A-Za-z0-9_-]{1,128}$/.test(account)
    )
      return { token, account };
  } catch {}
  return { outcome: { kind: "no_session" } };
}

/** An answer that says the kept point itself is gone, not that the read could not be made. */
const keptPointGone = (outcome: OwnReadOutcome) =>
  outcome.kind === "invalid" ||
  (outcome.kind === "http" &&
    outcome.status >= 400 &&
    outcome.status < 500 &&
    ![401, 403, 408, 429].includes(outcome.status));

export function chatgptOwnRead(deps: {
  origin: string;
  /** The wait before each earlier page; `OWN_READ_PAGE_SPACING_MS` by default. */
  pageDelay?: () => number;
  /** The wait between two batches; a minute by default. */
  batchDelay?: () => number;
}): OwnReadProvider {
  const pageDelay = deps.pageDelay ?? (() => OWN_READ_PAGE_SPACING_MS);
  const batchDelay = deps.batchDelay ?? (() => CHATGPT_BATCH_PAUSE_MS);
  return {
    site: "chatgpt",
    // The page reads its newest page on its own, often while the tracker reads; only an
    // earlier page means the person is scrolling, so the page now reads the rest itself.
    pageReadCounts: (url) => chatgptEarlierPage(url),
    resume: validChatgptResume,
    async run(context) {
      const resume = validChatgptResume(context.resume) ? context.resume : null;
      const budget = resume ? resume.budget : CHATGPT_DAY_PAGE_LIMIT;
      if (budget < 1) return { kind: "read_partly" };
      // The stretch an earlier opening read: from a message at or before `top` down to the
      // page that starts at `before`.
      const kept =
        resume?.before != null ? { before: resume.before, top: resume.top } : null;
      const session = await chatgptSession(context, deps.origin);
      if ("outcome" in session) return session.outcome;
      const init: RequestInit = {
        method: "GET",
        credentials: "include",
        headers: {
          authorization: `Bearer ${session.token}`,
          "chatgpt-account-id": session.account,
        },
      };
      let pages = 0;
      const page = async (url: URL, earlier: boolean) => {
        const result = await context.read(url, init, (text) => {
          const info = chatgptPageInfo(JSON.parse(text), context.conversationId, earlier);
          return info ? { ok: true, info } : { ok: false, outcome: { kind: "invalid" } };
        });
        if (result.ok) pages++;
        return result;
      };
      const report = (value: Omit<ChatgptReadReport, "pages">) =>
        context.report({
          before: value.before,
          top: value.before ? value.top : null,
          pages,
        });
      // Each request after the first renews the content script's wait for an answer.
      context.progress();
      let result = await page(chatgptNewestUrl(deps.origin, context.conversationId), false);
      if (!result.ok) return result.outcome;
      // The newest message this run saw, which bounds the stretch it reads.
      const top = result.info.latest;
      // Whether this run's pages reach the kept stretch without a gap. Pages are read newest
      // first, so the first page with a message at or before the kept `top` overlaps it, and
      // everything below it down to the kept point was read before. A fresh read has nothing
      // to reach. A stretch without a time is joined at once.
      let joined = kept === null;
      // The `before` the current page was read with; null for the newest page.
      let readWith: string | null = null;
      for (;;) {
        const info = result.info;
        const joining =
          !joined &&
          (kept!.top === null || (info.earliest !== null && info.earliest <= kept!.top));
        if (joining) joined = true;
        if (!info.hasPrevious) {
          // The chat's start: everything from this run's newest page down to here was read.
          // A later read only needs this last page again, if its import did not prove the start.
          report({ before: readWith, top });
          return { kind: "read" };
        }
        const jump = joining && kept !== null;
        const next = jump ? kept!.before : info.cursor;
        if (!next) return { kind: "invalid" };
        // Until this run reaches the kept stretch, the kept point stays the one to continue
        // from; only the page count changes.
        report(joined ? { before: next, top } : kept!);
        if (pages >= budget) return { kind: "read_partly" };
        if (pages % CHATGPT_PAGE_LIMIT === 0) {
          // A batch ended. The next one follows a minute later, only while the chat is shown.
          const wait = batchDelay();
          let waited = 0;
          do {
            context.progress();
            const step = Math.min(BATCH_PAUSE_STEP_MS, wait - waited);
            if (!(await context.pause(step))) return { kind: "navigated" };
            waited += step;
          } while (waited < wait);
        } else {
          context.progress();
          if (!(await context.pause(pageDelay()))) return { kind: "navigated" };
        }
        result = await page(chatgptEarlierUrl(deps.origin, context.conversationId, next), true);
        if (!result.ok) {
          // A kept point ChatGPT no longer knows would fail every later opening the same way,
          // so the next read starts again from the newest page.
          if (jump && keptPointGone(result.outcome)) report({ before: null, top: null });
          return result.outcome;
        }
        readWith = next;
      }
    },
  };
}
