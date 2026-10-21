export const THREAD_HISTORY_CHANNEL = "ai-footprint-thread-history-v1";
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const isThreadId = (value: unknown): value is string =>
  typeof value === "string" && uuid.test(value);
export interface ThreadHistoryPage {
  requestIds: string[];
  hasNextPage: boolean;
}
export interface ThreadHistoryMessage {
  channel: typeof THREAD_HISTORY_CHANNEL;
  event: "start" | "page";
  id: string;
  at: string;
  site: "perplexity";
  threadId: string;
  page: ThreadHistoryPage | null;
}
/** The thread a page shows: a search thread or a Computer task (14 Oct 2026). */
export function perplexityThreadRoute(pathname: string): string | null {
  const match = /^\/(?:search|computer\/tasks)\/([^/]+)$/.exec(pathname);
  return match && isThreadId(match[1]) ? match[1] : null;
}
/** Retrieved thread membership is independent of the provider's context and backend IDs. */
export function parsePerplexityHistory(
  value: unknown,
  threadId: string,
): ThreadHistoryPage | null {
  if (!isThreadId(threadId) || !value || typeof value !== "object") return null;
  const body = value as any;
  if (
    !Array.isArray(body.entries) ||
    typeof body.has_next_page !== "boolean"
  )
    return null;
  const ids = new Set<string>();
  for (const entry of body.entries) {
    if (
      !entry ||
      typeof entry !== "object" ||
      entry.thread_url_slug !== threadId ||
      !isThreadId(entry.frontend_uuid) ||
      entry.uuid !== entry.frontend_uuid
    )
      return null;
    ids.add(entry.frontend_uuid);
  }
  return { requestIds: [...ids], hasNextPage: body.has_next_page };
}
export function validateThreadHistory(
  value: unknown,
): value is ThreadHistoryMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as ThreadHistoryMessage;
  if (
    Object.keys(v).sort().join(",") !==
      "at,channel,event,id,page,site,threadId" ||
    v.channel !== THREAD_HISTORY_CHANNEL ||
    v.site !== "perplexity" ||
    !isThreadId(v.threadId) ||
    typeof v.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      v.id,
    ) ||
    typeof v.at !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v.at) ||
    !Number.isFinite(Date.parse(v.at))
  )
    return false;
  if (v.event === "start") return v.page === null;
  return (
    v.event === "page" &&
    !!v.page &&
    Object.keys(v.page).sort().join(",") === "hasNextPage,requestIds" &&
    typeof v.page.hasNextPage === "boolean" &&
    Array.isArray(v.page.requestIds) &&
    v.page.requestIds.every(isThreadId) &&
    new Set(v.page.requestIds).size === v.page.requestIds.length
  );
}
