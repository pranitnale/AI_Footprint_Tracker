import { siteForHost } from "@footprint/capture-core";
import { OWN_READ_PAUSE_MAX_MS, isOwnReadSite, type OwnReadSite } from "./own-read";

/**
 * The own-read pause shared by the tabs of one site (lib/own-read.ts). A 429 or 5xx in one tab
 * pauses own reads in that site's other tabs too. The background keeps one time per site in
 * session storage: a number only, never a chat id or content, gone when the browser closes.
 * Session storage stays closed to content scripts, so a tab reaches it only through the
 * `own-read-pause` message: `{ site }` asks for the time, `{ site, until }` stores one.
 */
export const OWN_READ_PAUSE_TARGET = "own-read-pause";
const KEY_PREFIX = "own-read-pause:";

/** The content script's side, for `createOwnReadScheduler({ sharedPause })`. */
export function ownReadSharedPause(
  site: OwnReadSite,
  send: (message: unknown) => Promise<unknown>,
) {
  // A failed message leaves the pause to this tab alone; reads are never held by it, and a
  // message that throws at once (a reloaded extension) turns into a rejection here.
  return {
    get: async () => send({ target: OWN_READ_PAUSE_TARGET, site }),
    set: (until: number) => {
      try {
        void send({ target: OWN_READ_PAUSE_TARGET, site, until }).catch(() => {});
      } catch {}
    },
  };
}

/** The part of `browser.storage.session` the store uses, so tests can pass a map. */
export interface PauseStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

interface PauseSender {
  id?: string;
  url?: string;
  tab?: { id?: number };
  frameId?: number;
}

/**
 * The background's side. `answer` returns undefined for a message it refuses: one not from the
 * top frame of an HTTPS page of the named site in this extension, or not in the exact shape.
 */
export function createOwnReadPauses(env: {
  /** Read lazily, so a browser without session storage fails only the message. */
  storage: () => PauseStorage;
  runtimeId: string;
  now?: () => number;
}) {
  const now = env.now ?? Date.now;
  // Sets of the same site run one after another, so a later time is never overwritten.
  let queue: Promise<unknown> = Promise.resolve();
  // A stored time counts only while it is ahead and at most the longest pause ahead (a
  // provider's Retry-After can ask for more than the usual five minutes), so a wrong value
  // cannot hold reads for longer than a day.
  const current = async (site: OwnReadSite) => {
    const key = KEY_PREFIX + site;
    const value = (await env.storage().get(key))[key];
    const at = now();
    if (typeof value !== "number" || !Number.isFinite(value) || value <= at) return null;
    return Math.min(value, at + OWN_READ_PAUSE_MAX_MS);
  };
  const store = async (site: OwnReadSite, until: number) => {
    const at = now();
    if (!Number.isFinite(until) || until <= at) return current(site);
    const next = Math.max(
      (await current(site)) ?? 0,
      Math.min(until, at + OWN_READ_PAUSE_MAX_MS),
    );
    await env.storage().set({ [KEY_PREFIX + site]: next });
    return next;
  };
  return {
    answer(message: any, sender: PauseSender): Promise<number | null> | undefined {
      if (message?.target !== OWN_READ_PAUSE_TARGET) return;
      const site = message.site;
      const keys = Object.keys(message).sort().join(",");
      try {
        const url = new URL(sender.url ?? "");
        if (
          sender.id !== env.runtimeId ||
          sender.tab?.id == null ||
          sender.frameId !== 0 ||
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.port ||
          !isOwnReadSite(site) ||
          siteForHost(url.hostname) !== site ||
          !(
            keys === "site,target" ||
            (keys === "site,target,until" && typeof message.until === "number")
          )
        )
          return;
      } catch {
        return;
      }
      const run = queue.then(() =>
        keys === "site,target" ? current(site) : store(site, message.until),
      );
      queue = run.catch(() => {});
      return run.catch(() => null);
    },
  };
}
