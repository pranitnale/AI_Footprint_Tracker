import {
  isThreadId,
  perplexityThreadRoute,
  THREAD_HISTORY_CHANNEL,
  type ThreadHistoryMessage,
} from "@footprint/adapters";
import { JSONParser } from "@streamparser/json";
import { createRouteWatch } from "./history-route";

// Perplexity can request a thread just before its address bar changes. A request
// for another thread waits this long for the route and otherwise emits nothing.
const PENDING_MAX_MS = 5000;
const PENDING_AFTER_RESPONSE_MS = 1000;
const PENDING_LIMIT = 4;

/** Only a bounded cloned branch of an already-issued provider request is observed. */
export function createThreadHistoryObserver(
  emit: (message: ThreadHistoryMessage) => void,
) {
  const active = new Map<
    string,
    { cancel: () => void; bound: () => boolean }
  >();
  const count = (bound: boolean) =>
    [...active.values()].filter((item) => item.bound() === bound).length;
  const routes = createRouteWatch();
  const cloneResponse = Response.prototype.clone;
  const cancelStream = ReadableStream.prototype.cancel;
  return {
    start(input: RequestInfo | URL, init?: RequestInit) {
      // Waiting reads have their own cap so prefetches cannot block the chat being opened.
      if (count(true) >= 2) return null;
      let target: URL;
      try {
        target = new URL(
          input instanceof Request ? input.url : String(input),
          location.href,
        );
      } catch {
        return null;
      }
      const method =
        init?.method ?? (input instanceof Request ? input.method : "GET");
      const threadId = /^\/rest\/thread\/([^/]+)$/.exec(target.pathname)?.[1];
      if (
        !threadId ||
        !isThreadId(threadId) ||
        typeof method !== "string" ||
        method.toUpperCase() !== "GET" ||
        target.origin !== location.origin ||
        target.username ||
        target.password
      )
        return null;
      const id = crypto.randomUUID(),
        at = new Date().toISOString(),
        startedAt = Date.now();
      let pathname = location.pathname,
        bound = false;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
        held: Response | null = null,
        cancelled = false,
        unwatch = () => {};
      const stop = () => {
        cancelled = true;
        unwatch();
        void reader?.cancel().catch(() => {});
        // An unread clone buffers the whole response, so cancel it explicitly.
        if (held?.body && !reader)
          void Reflect.apply(cancelStream, held.body, []).catch(() => {});
        held = null;
        active.delete(id);
      };
      const current = perplexityThreadRoute(location.pathname) === threadId;
      if (!current)
        while (count(false) >= PENDING_LIMIT)
          [...active.values()].find((item) => !item.bound())!.cancel();
      active.set(id, { cancel: stop, bound: () => bound });
      let timeout: ReturnType<typeof setTimeout>;
      const renew = () => {
        clearTimeout(timeout);
        timeout = setTimeout(stop, 30000);
      };
      renew();
      const bind = () => {
        bound = true;
        pathname = location.pathname;
        emit({
          channel: THREAD_HISTORY_CHANNEL,
          event: "start",
          id,
          at,
          site: "perplexity",
          threadId,
          page: null,
        });
      };
      if (current) bind();
      const read = async (clone: Response) => {
        if (cancelled || location.pathname !== pathname) return;
        reader = clone.body!.getReader();
        held = null;
        const parser = new JSONParser({
          paths: ["$.entries.*", "$.has_next_page"],
          keepStack: false,
          stringBufferSize: 65536,
        });
        const ids = new Set<string>();
        let hasNext: boolean | null = null;
        let count = 0;
        parser.onValue = ({ value, key, stack }) => {
          if (stack.length === 1 && key === "has_next_page") {
            if (typeof value !== "boolean")
              throw new Error("history_unsupported");
            hasNext = value;
          } else if (
            stack.length === 2 &&
            stack[1]?.key === "entries" &&
            typeof key === "number"
          ) {
            const entry = value as Record<string, unknown>;
            if (
              !entry ||
              typeof entry !== "object" ||
              entry.thread_url_slug !== threadId ||
              !isThreadId(entry.frontend_uuid) ||
              entry.uuid !== entry.frontend_uuid
            )
              throw new Error("history_unsupported");
            ids.add(entry.frontend_uuid);
            count++;
          }
        };
        for (;;) {
          const part = await reader.read();
          if (cancelled || location.pathname !== pathname) return;
          if (part.done) break;
          renew();
          for (let offset = 0; offset < part.value.length; offset += 65536) {
            parser.write(part.value.subarray(offset, offset + 65536));
            if (offset > 0 && offset % (65536 * 8) === 0)
              await new Promise<void>((resolve) => setTimeout(resolve, 0));
          }
        }
        if (!parser.isEnded) parser.end();
        if (
          parser.isEnded &&
          count > 0 &&
          hasNext !== null &&
          !cancelled &&
          location.pathname === pathname
        )
          emit({
            channel: THREAD_HISTORY_CHANNEL,
            event: "page",
            id,
            at,
            site: "perplexity",
            threadId,
            page: { requestIds: [...ids], hasNextPage: hasNext },
          });
      };
      return (promise: Promise<Response>) => {
        let settledAt: number | null = null;
        // Clone before the host's own reader can consume the body.
        const early = promise.then((response) => {
          settledAt = Date.now();
          if (
            cancelled ||
            !response.ok ||
            !response.body ||
            (response.url && new URL(response.url).origin !== target.origin)
          )
            return null;
          held = Reflect.apply(cloneResponse, response, []) as Response;
          return held;
        });
        const finish = () => {
          clearTimeout(timeout);
          stop();
        };
        const proceed = (clone: Response | null) =>
          clone ? read(clone) : undefined;
        if (bound) {
          void early.then(proceed).catch(() => {}).finally(finish);
          return;
        }
        const check = () => {
          if (cancelled) return;
          if (perplexityThreadRoute(location.pathname) === threadId) {
            unwatch();
            bind();
            void early.then(proceed).catch(() => {}).finally(finish);
            return;
          }
          const deadline = Math.min(
            startedAt + PENDING_MAX_MS,
            (settledAt ?? startedAt + PENDING_MAX_MS) +
              PENDING_AFTER_RESPONSE_MS,
          );
          if (Date.now() >= deadline) finish();
        };
        unwatch = routes.watch(check);
        void early.then(check, finish);
      };
    },
    cancel() {
      for (const item of [...active.values()]) item.cancel();
      active.clear();
      routes.clear();
    },
  };
}
