import type { Site } from "@footprint/capture-core";
import { historyRequestConversation } from "./history-route";
import { chatgptOwnRead } from "./chatgpt-own-read";
import { claudeOwnRead } from "./claude-own-read";
import { geminiOwnRead, type GeminiPageValues } from "./gemini-own-read";
import { notebooklmOwnRead } from "./notebooklm-own-read";
import { perplexityOwnRead } from "./perplexity-own-read";
import { createOwnReadPage, type OwnReadProvider } from "./own-read-page";

type HistoryObserve = (
  url: URL,
  method: string,
  promise: Promise<Response> | null,
  observedAt: number,
  body?: unknown,
  rejected?: "admission" | "metadata",
  cloned?: boolean,
) => unknown;

/** The page's cookies, read with the getter taken now so a page override never runs. */
function cookieReader() {
  const getter =
    typeof Document === "undefined"
      ? undefined
      : Object.getOwnPropertyDescriptor(Document.prototype, "cookie")?.get;
  return () => {
    try {
      return getter && typeof document !== "undefined"
        ? String(Reflect.apply(getter, document, []))
        : "";
    } catch {
      return "";
    }
  };
}

/** One local storage value, read with the getter taken now so a page override never runs. */
function storageReader(key: string) {
  const getItem =
    typeof Storage === "undefined" ? undefined : Storage.prototype.getItem;
  return () => {
    try {
      const value = getItem ? Reflect.apply(getItem, window.localStorage, [key]) : null;
      return typeof value === "string" ? value : null;
    } catch {
      return null;
    }
  };
}

/** The page's language, as Google's own requests send it in `hl`. */
const pageLanguage = () =>
  typeof document === "undefined" ? "" : document.documentElement?.lang ?? "";

/**
 * Google's page values (`WIZ_global_data`) at request time. They live in the page world;
 * the request token among them is used for one request and never kept.
 */
const googlePageValues = (): GeminiPageValues | null => {
  try {
    const value = (window as unknown as { WIZ_global_data?: unknown })
      .WIZ_global_data;
    return value && typeof value === "object" ? (value as GeminiPageValues) : null;
  } catch {
    return null;
  }
};

function providerFor(site: Site, origin: string): OwnReadProvider | null {
  const cookie = cookieReader();
  if (site === "claude") return claudeOwnRead({ origin, cookie });
  if (site === "chatgpt") return chatgptOwnRead({ origin });
  if (site === "gemini")
    return geminiOwnRead({
      origin,
      pageValues: googlePageValues,
      language: pageLanguage,
    });
  if (site === "notebooklm")
    return notebooklmOwnRead({
      origin,
      pageValues: googlePageValues,
      language: pageLanguage,
    });
  if (site === "perplexity")
    return perplexityOwnRead({
      origin,
      storedAccount: storageReader("pplx-last-active-account"),
      cookie,
    });
  return null;
}

/**
 * Installs the tracker's own read in the page world (see `own-read.ts`). Every history read
 * the page makes, by fetch or XHR, passes the history reader's `observe`; wrapping it lets a
 * page read stop or prevent the tracker's read of the same chat. The tracker's own answers
 * go to the unwrapped reader, so they are never taken for the page's.
 */
export function installOwnRead(deps: {
  site: Site;
  historyText: { observe: HistoryObserve };
  /** Perplexity's thread reader, which sees every saved thread the page reads. */
  threadHistory?: {
    start(input: string, init: { method: string }): ((result: Promise<Response>) => void) | null;
  };
  fetch: typeof fetch;
  enabled: () => boolean;
}) {
  const provider = providerFor(deps.site, location.origin);
  if (!provider) return null;
  const observeHistory = deps.historyText.observe;
  const page = createOwnReadPage({
    provider,
    origin: location.origin,
    fetch: (input, init) => Reflect.apply(deps.fetch, window, [input, init]),
    observe: (url, method, response, observedAt, body) => {
      if (!deps.enabled()) return;
      observeHistory(url, method, response, observedAt, body);
      deps.threadHistory?.start(url.href, { method })?.(response);
    },
    readConversation: (url, method, body) =>
      historyRequestConversation(deps.site, url, method, body),
    pathname: () => location.pathname,
    visible: () =>
      typeof document === "undefined" || document.visibilityState === "visible",
    whenVisible: (callback) => {
      if (typeof document === "undefined") {
        callback();
        return () => {};
      }
      const listener = () => {
        if (document.visibilityState !== "visible") return;
        document.removeEventListener("visibilitychange", listener);
        callback();
      };
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
    enabled: deps.enabled,
  });
  deps.historyText.observe = (url, method, promise, observedAt, body, rejected, cloned) => {
    try {
      // A read turned away unread (busy read slots, or seen too late) neither stops the
      // tracker's read nor makes it unnecessary: the history reader never had that answer.
      if (deps.enabled()) page.pageRead(url, method, body, rejected !== undefined);
    } catch {}
    return observeHistory(url, method, promise, observedAt, body, rejected, cloned);
  };
  return page;
}
