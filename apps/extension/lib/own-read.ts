import {
  isCoworkSessionId,
  isUnsavedChatgptRoute,
  parseConversationRoute,
} from "@footprint/capture-core";
import type { OwnReadSettingKey } from "./own-read-settings";

export {
  OPEN_SETTINGS_TARGET,
  OWN_READ_SETTING_CHANGED,
  OWN_READ_SETTING_NAMES,
  OWN_READ_SETTING_TARGET,
  ownReadMainSwitchOff,
  ownReadSettingAnswer,
  type OwnReadSettingKey,
} from "./own-read-settings";

/**
 * The tracker's own read of an open chat (owner decisions of 13 October 2026).
 *
 * A provider can show a chat without loading it again (claude.ai's client cache, Perplexity
 * full page loads and back/forward, Gemini returning to a chat in the same document, NotebookLM
 * reopening a notebook), or load only its newest part (ChatGPT until the user scrolls up, a
 * Cowork session whose start was not shown). The page's read can also arrive in a shape the
 * history reader refuses. No saved history then reaches the tracker. In exactly these cases,
 * once per navigation, the page world reads the chat with the request the page itself uses and
 * hands each answer to the ordinary history reader, so the same parser, validation and privacy
 * rules apply (text stays on the device). A read that failed for a network error, a time-out,
 * 429 or 5xx is tried once more, a minute or more later and only while the tab is visible.
 *
 * The read is a setting, "Load full chat history automatically", on by default with a switch per
 * site (owner decision of 17 October 2026, `own-read-settings.ts`). The scheduler asks the
 * background for the site's switch right before every read it hands to the page world, and a
 * running read is stopped as soon as the switch is turned off, so a change applies without
 * reloading anything. Every provider request of an own read starts from this scheduler, so
 * this one check covers every site.
 *
 * This file holds the provider-neutral protocol and the content script's scheduling. The
 * requests are made in the page world (`own-read-page.ts` and one module per provider),
 * because a content script fetch does not behave like the page's own request in every
 * browser (Firefox runs it with the extension's identity).
 */

export const OWN_READ_CHANNEL = "ai-footprint-own-read-v1";
/**
 * A chat that was read, or that the provider does not have, is not read again for this long,
 * even after navigating back. A refused, rate-limited or failed server answer (401, 403, 429,
 * 5xx) pauses every own read this long, or for as long as the provider's Retry-After asks.
 */
export const OWN_READ_COOLDOWN_MS = 5 * 60_000;
/**
 * The longest pause a provider's Retry-After can start (24 hours). It also bounds a pause
 * another tab shares, so a wrong stored time cannot hold reads for longer.
 */
export const OWN_READ_PAUSE_MAX_MS = 24 * 60 * 60_000;
/**
 * The page world answers, or reports progress, within its own request limit; past this
 * without either, the read counts as failed.
 */
export const OWN_READ_REPLY_MS = 45_000;
/** How long the bar keeps its loading state after a read for the import to start. */
export const OWN_READ_IMPORT_START_MS = 10_000;
/**
 * The one more try after a network error, time-out, 429 or 5xx waits at least this long, and
 * past a pause the failure started (owner decision of 14 Oct 2026). A hidden tab waits until
 * it is shown again.
 */
export const OWN_READ_RETRY_MS = 60_000;

export type OwnReadSite =
  | "claude"
  | "chatgpt"
  | "gemini"
  | "perplexity"
  | "notebooklm";

/** The sites whose page world can make an own read. */
const OWN_READ_SITES: ReadonlySet<string> = new Set(["claude", "chatgpt", "gemini", "perplexity", "notebooklm"]);

export type OwnReadOutcome =
  /** Every answer was handed to the history reader. */
  | { kind: "read" }
  /** Some pages were read, then the day's page limit stopped the read (ChatGPT). */
  | { kind: "read_partly" }
  /** The page read the chat itself, so the tracker's read was not needed. */
  | { kind: "page_read" }
  /**
   * `retryAfter`: the wait in milliseconds a 429 or 503 named in its Retry-After header, when
   * it named one; the next own read of the site waits at least this long.
   */
  | { kind: "http"; status: number; shouldRetry: boolean; retryAfter?: number }
  /** The provider answered that it has no such chat (Gemini answers 200 with an error frame). */
  | { kind: "not_found" }
  | { kind: "network" }
  | { kind: "timeout" }
  /** Not this chat in the shape the history reader needs. */
  | { kind: "invalid" }
  /** The answer was larger than the tracker reads itself; it was not held or read. */
  | { kind: "too_large" }
  /** The page did not hold the account or session values the request needs. */
  | { kind: "no_session" }
  /**
   * The page had not made the request the tracker copies in this tab yet (NotebookLM's
   * chat reads), so there was nothing to copy.
   */
  | { kind: "no_request" }
  /** The page world refused: hidden tab, another read running, its rate limit or a stopped tracker. */
  | { kind: "declined" }
  /** The address changed before the answer could be used. */
  | { kind: "navigated" }
  /** The page world never answered. */
  | { kind: "unanswered" };

const SIMPLE_OUTCOMES = new Set([
  "read",
  "read_partly",
  "page_read",
  "not_found",
  "network",
  "timeout",
  "invalid",
  "too_large",
  "no_session",
  "no_request",
  "declined",
  "navigated",
  "unanswered",
]);

export const SITE_NAMES: Record<OwnReadSite, string> = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  perplexity: "Perplexity",
  notebooklm: "NotebookLM",
};

/**
 * The chat at an address that the tracker may read itself: Claude's chats and Cowork
 * sessions, and Perplexity's threads only when addressed by their uuid.
 */
export function ownReadConversation(
  site: OwnReadSite,
  pathname: string,
): string | null {
  // A signed-out ChatGPT chat is never saved, so there is nothing to read (20 Oct 2026).
  if (site === "chatgpt" && isUnsavedChatgptRoute(pathname)) return null;
  return parseConversationRoute(site, pathname)?.conversationId ?? null;
}

/** The switch in Settings that governs a read of this chat: a Cowork session has its own. */
export function ownReadSettingKey(
  site: OwnReadSite,
  conversationId: string,
): OwnReadSettingKey {
  return site === "claude" && isCoworkSessionId(conversationId) ? "cowork" : site;
}

export function isOwnReadSite(site: unknown): site is OwnReadSite {
  return typeof site === "string" && OWN_READ_SITES.has(site);
}

export function validOwnReadOutcome(value: unknown): value is OwnReadOutcome {
  if (!value || typeof value !== "object") return false;
  const outcome = value as Record<string, unknown>;
  const keys = Object.keys(outcome).sort().join(",");
  if (outcome.kind === "http")
    return (
      (keys === "kind,shouldRetry,status" ||
        (keys === "kind,retryAfter,shouldRetry,status" &&
          Number.isSafeInteger(outcome.retryAfter) &&
          (outcome.retryAfter as number) >= 0 &&
          (outcome.retryAfter as number) <= OWN_READ_PAUSE_MAX_MS)) &&
      Number.isInteger(outcome.status) &&
      (outcome.status as number) >= 100 &&
      (outcome.status as number) <= 599 &&
      typeof outcome.shouldRetry === "boolean"
    );
  return keys === "kind" && SIMPLE_OUTCOMES.has(outcome.kind as string);
}

/**
 * Why a chat was not read in this navigation because of an earlier read in the last few
 * minutes: it was read, the provider did not find it or refused it, or it was too large.
 */
type CooldownReason = "read" | "not_found" | "refused" | "too_large";

type NoteOutcome =
  | OwnReadOutcome
  | { kind: "paused" }
  | { kind: "cooldown"; reason: CooldownReason }
  /** The page started loading the chat itself before the read was sent. */
  | { kind: "superseded" }
  /**
   * "Load full chat history" is off for this site, so nothing was requested. Details shows it as
   * its own entry with the way to turn it on (`off`), not as a note.
   */
  | { kind: "off" };

/** Outcomes that leave nothing uncounted: Details explains them but lists no problem. */
const QUIET_OUTCOMES = new Set(["read", "read_partly", "page_read", "superseded"]);

/** Whether a Details note names something that could not be counted. */
export function ownReadFailed(outcome: NoteOutcome): boolean {
  return outcome.kind === "cooldown"
    ? outcome.reason !== "read"
    : !QUIET_OUTCOMES.has(outcome.kind);
}

/** The message that hands the content script's private port to the page world. */
export function isOwnReadConnect(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    Object.keys(value).sort().join(",") === "channel,connect" &&
    (value as { channel?: unknown }).channel === OWN_READ_CHANNEL &&
    (value as { connect?: unknown }).connect === true
  );
}

/** One short line for the coverage section of Details. */
export function ownReadNote(outcome: NoteOutcome, site: OwnReadSite): string | null {
  const name = SITE_NAMES[site];
  const failed = (reason: string) =>
    `The tracker tried to read this chat from ${name} once, but ${reason}.`;
  switch (outcome.kind) {
    case "read":
      return site === "chatgpt"
        ? "ChatGPT had not loaded all of this chat, so the tracker read it from ChatGPT to count it. The text stays on this device."
        : `${name} showed this chat without loading it again, so the tracker read the chat from ${name} once to count it. The text stays on this device.`;
    case "read_partly":
      return `${name} showed only part of this chat. The tracker read more of it from ${name} but stopped at its page limit, so the oldest messages may still be missing. It reads on from there when this chat is open on a later day.`;
    case "http":
      return failed(
        outcome.status === 404
          ? `${name} did not find the chat (status 404)`
          : outcome.status === 401 || outcome.status === 403
            ? `${name} refused the read (status ${outcome.status})`
            : outcome.status === 429
              ? `${name} asked for fewer requests (status 429)`
              : `${name} answered with status ${outcome.status}`,
      );
    case "not_found":
      return failed(`${name} did not find the chat`);
    case "network":
      return failed(`the request did not reach ${name}`);
    case "timeout":
      return failed(`${name} did not answer in time`);
    case "invalid":
      return failed(`${name}'s answer could not be read`);
    case "too_large":
      return failed("the chat is larger than the tracker reads itself, so it was not read");
    case "page_read":
      return `${name} loaded this chat itself, so the tracker did not read it.`;
    case "superseded":
      return `${name} started loading this chat itself, so the tracker did not read it.`;
    case "navigated":
      return failed(
        "the page moved to another address before the read finished, so nothing from it was counted",
      );
    case "cooldown": {
      const again = "so it does not try again until five minutes have passed.";
      switch (outcome.reason) {
        case "read":
          return `The tracker read this chat from ${name} in the last few minutes, so it does not read it again until five minutes have passed.`;
        case "not_found":
          return `${name} did not find this chat when the tracker tried to read it in the last few minutes, ${again}`;
        case "refused":
          return `${name} refused the tracker's read of this chat in the last few minutes, ${again}`;
        case "too_large":
          return `This chat was larger than the tracker reads itself when it tried in the last few minutes, ${again}`;
      }
      return null;
    }
    case "no_session":
      return failed(`the page did not show the account details the request needs`);
    case "no_request":
      return failed(
        `${name} had not read a saved chat in this tab yet, so there was no request to copy. Reloading the page reads it`,
      );
    case "declined":
    case "unanswered":
      return failed("the page could not make the request");
    case "paused":
      return `The tracker did not read this chat from ${name} because ${name} refused or limited an earlier read recently. It tries once when that pause has passed, while this tab is shown.`;
    case "off":
      return null;
    default:
      return null;
  }
}

/**
 * Why the content script asks for the read: "missing", no read of the chat arrived;
 * "after_import", only part of it loaded; "rejected", the history reader refused the page's
 * read; "lost_reply", a live reply's frames never reached the background. Details uses it to
 * say what works instead while "Load full chat history" is off.
 */
export type OwnReadMode = "missing" | "after_import" | "rejected" | "lost_reply";

export interface OwnReadRequest {
  /** The content script's navigation nonce; one read at most per value. */
  navigation: string;
  pathname: string;
  mode?: OwnReadMode;
  /**
   * The page's own read of this chat reached the history reader, which refused it. The page
   * world then reads even though the page just did, unless its request would be the same.
   */
  rejected?: boolean;
  /**
   * The page's recent reads of this chat were not counted (tracking was off then), so the page
   * world reads even though the page just did; the same request may be sent.
   */
  uncounted?: boolean;
  /**
   * Where the page world's read should continue (ChatGPT's kept progress), read just before
   * each request; null or undefined when the read starts at the newest page.
   */
  resume?(): unknown;
  /** The page world reported how far its read got (ChatGPT); the value is not yet checked. */
  resumed?(value: unknown): void;
  /** Whether this navigation still needs the read; checked just before the request. */
  stillNeeded(): boolean;
  /** The read's state changed, so the bar should render again. */
  changed(): void;
}

interface Attempt {
  navigation: string;
  conversationId: string;
  /** The Settings switch that governs this chat's read. */
  key: OwnReadSettingKey;
  request: OwnReadRequest;
  phase: "waiting" | "delayed" | "reading" | "settled";
  outcome: NoteOutcome | null;
  settledAt: number;
  timer: number | null;
  port: MessagePort | null;
  /** The page world reported that the answer is arriving. */
  receiving: boolean;
  unlisten: (() => void) | null;
  /** The one more try after a failure was used or is waiting (`retryAt`). */
  retried: boolean;
  retryAt: number | null;
}

/** Failures worth one more try: the request may well succeed a minute later. */
function retryable(outcome: Attempt["outcome"]): boolean {
  return (
    outcome?.kind === "network" ||
    outcome?.kind === "timeout" ||
    (outcome?.kind === "http" && (outcome.status === 429 || outcome.status >= 500))
  );
}

/**
 * Schedules the own read from the content script. The page world makes the requests and
 * replies on a private port with `{ outcome }`, or `{ pending: true }` while a long read
 * (ChatGPT's earlier pages) is still going.
 */
export function createOwnReadScheduler(env: {
  site: OwnReadSite;
  window: Pick<Window, "postMessage" | "setTimeout" | "clearTimeout"> & {
    location: { origin: string };
  };
  document: Pick<
    Document,
    "visibilityState" | "addEventListener" | "removeEventListener"
  >;
  /**
   * Milliseconds to wait once the tab is visible before the read is sent; none by default.
   * The grace period before the read is asked for already gives the page time to read the
   * chat itself, so no further wait is added.
   */
  delay?: () => number;
  now?: () => number;
  /** The channel constructor; the global one by default. */
  MessageChannel?: typeof MessageChannel;
  /**
   * A pause shared with this site's other tabs (a 429 or 5xx in one tab pauses reads in all),
   * as a time in milliseconds. Only that time is stored. Without it each tab pauses alone.
   */
  sharedPause?: {
    get(): Promise<unknown>;
    set(until: number): void;
  };
  /**
   * Whether "Load full chat history" is on for a switch: true, false, or null when the answer could
   * not be read. Asked right before every read; without it every read is allowed (tests).
   */
  allowed?: (key: OwnReadSettingKey) => Promise<boolean | null>;
}) {
  const now = env.now ?? Date.now;
  const delay = env.delay ?? (() => 0);
  const visible = () => env.document.visibilityState === "visible";
  const Channel = env.MessageChannel ?? MessageChannel;
  // Chats not to read again until the stored time, and a pause for every chat.
  const blocked = new Map<string, { until: number; reason: CooldownReason }>();
  let pausedUntil = 0;
  let attempt: Attempt | null = null;
  let stopped = false;
  // A pause another tab of this site started. A stored time is trusted only up to the longest
  // pause a provider can ask for, so a wrong value cannot stop reads for longer. The latest
  // question is kept: a read goes out right after the grace period, so `send` waits for its
  // answer rather than racing it.
  let sharedPauseLoad: Promise<void> = Promise.resolve();
  const loadSharedPause = () => {
    if (!env.sharedPause) return;
    sharedPauseLoad = env.sharedPause
      .get()
      .then((until) => {
        if (typeof until !== "number" || !Number.isFinite(until)) return;
        pausedUntil = Math.max(
          pausedUntil,
          Math.min(until, now() + OWN_READ_PAUSE_MAX_MS),
        );
      })
      .catch(() => {});
  };
  loadSharedPause();
  // The last answer for each switch, so the bar can tell at once that a read will not be made.
  // It is only a hint: the switch is asked again right before every read.
  const known = new Map<OwnReadSettingKey, boolean>();
  const check = async (key: OwnReadSettingKey): Promise<boolean | null> => {
    if (!env.allowed) return true;
    let on: boolean | null;
    try {
      on = await env.allowed(key);
    } catch {
      on = null;
    }
    if (on === null) known.delete(key);
    else known.set(key, on);
    return on;
  };
  if (env.allowed)
    for (const key of env.site === "claude" ? (["claude", "cowork"] as const) : [env.site])
      void check(key);
  // The private port to the page world, handed over once (`isOwnReadConnect`). Requests go
  // only over it, each with its own answer port, so page scripts never see them.
  let link: MessagePort | null = null;
  const connect = () => {
    if (link) return link;
    const channel = new Channel();
    try {
      env.window.postMessage(
        { channel: OWN_READ_CHANNEL, connect: true },
        env.window.location.origin,
        [channel.port2],
      );
    } catch {
      channel.port1.close();
      channel.port2.close();
      return null;
    }
    link = channel.port1;
    return link;
  };
  connect();

  // With `cancel`, a read the page world may still be running is told to stop, so it makes
  // no more requests and hands nothing more to the history reader.
  const clear = (current: Attempt, cancel = false) => {
    if (current.timer !== null) env.window.clearTimeout(current.timer);
    current.timer = null;
    current.unlisten?.();
    current.unlisten = null;
    if (current.port) {
      if (cancel && current.phase === "reading")
        try {
          current.port.postMessage({ cancel: true });
        } catch {}
      current.port.onmessage = null;
      current.port.close();
    }
    current.port = null;
  };
  const pending = (current: Attempt) =>
    current.phase !== "settled" ||
    ((current.outcome?.kind === "read" ||
      current.outcome?.kind === "read_partly") &&
      now() - current.settledAt < OWN_READ_IMPORT_START_MS);

  // When a pause ends, the bar renders again, which asks for the one read the pause held.
  const wakeAfterPause = (current: Attempt) => {
    current.timer = env.window.setTimeout(
      () => {
        current.timer = null;
        if (attempt === current && !stopped) current.request.changed();
      },
      Math.max(0, pausedUntil - now()),
    );
  };

  const settle = (current: Attempt, outcome: Attempt["outcome"]) => {
    if (current.phase === "settled") return;
    // Only a page world that never answered may still be running the read.
    clear(current, outcome?.kind === "unanswered");
    const at = now();
    current.phase = "settled";
    current.outcome = outcome;
    current.settledAt = at;
    const read = outcome?.kind === "read" || outcome?.kind === "read_partly";
    const block = (reason: CooldownReason) =>
      blocked.set(current.conversationId, { until: at + OWN_READ_COOLDOWN_MS, reason });
    if (read) block("read");
    if (outcome?.kind === "not_found") block("not_found");
    if (outcome?.kind === "too_large") block("too_large");
    if (outcome?.kind === "http") {
      if ([401, 403, 429].includes(outcome.status) || outcome.status >= 500) {
        // A Retry-After longer than the usual pause holds the site's next read until then.
        pausedUntil = Math.max(
          pausedUntil,
          at +
            Math.max(
              OWN_READ_COOLDOWN_MS,
              Math.min(outcome.retryAfter ?? 0, OWN_READ_PAUSE_MAX_MS),
            ),
        );
        env.sharedPause?.set(pausedUntil);
      } else if (outcome.status === 404) block("not_found");
      else if (!outcome.shouldRetry) block("refused");
    }
    if (attempt !== current || stopped) return;
    if (!current.retried && retryable(outcome)) {
      current.retried = true;
      current.retryAt = Math.max(at + OWN_READ_RETRY_MS, pausedUntil);
      current.timer = env.window.setTimeout(() => {
        current.timer = null;
        current.retryAt = null;
        if (attempt !== current || stopped || !current.request.stillNeeded()) {
          if (attempt === current && !stopped) current.request.changed();
          return;
        }
        current.receiving = false;
        waitVisible(current);
        current.request.changed();
      }, current.retryAt - at);
    }
    current.request.changed();
    // A read that never turns into an import falls back to the bar's earlier state.
    if (read)
      current.timer = env.window.setTimeout(() => {
        current.timer = null;
        if (attempt === current && !stopped) current.request.changed();
      }, OWN_READ_IMPORT_START_MS);
  };

  // Turning "Load full chat history" off stops a read at once: the page world is told to cancel,
  // so it sends no further request.
  const switchedOff = (current: Attempt) => {
    if (attempt !== current || stopped || current.phase === "settled") return;
    clear(current, true);
    settle(current, { kind: "off" });
  };

  // Whether the read may go out now; otherwise it settles or waits, as the reason needs.
  const ready = (current: Attempt) => {
    if (attempt !== current || stopped) return false;
    if (!current.request.stillNeeded()) {
      settle(current, { kind: "superseded" });
      return false;
    }
    if (!visible()) {
      waitVisible(current);
      return false;
    }
    // Another tab may have started a pause since this read was scheduled.
    if (now() < pausedUntil) {
      settle(current, { kind: "paused" });
      wakeAfterPause(current);
      return false;
    }
    return true;
  };

  // The setting is asked right before the read goes to the page world, so a switch turned off
  // since the read was scheduled is respected. An unreadable answer sends nothing. The read
  // also waits for the shared pause asked for with the request, so a pause another open tab
  // started (up to a day after a Retry-After) holds it.
  const send = (current: Attempt) => {
    current.timer = null;
    if (!ready(current)) return;
    if (!env.allowed) {
      post(current);
      return;
    }
    void Promise.all([check(current.key), sharedPauseLoad]).then(([on]) => {
      if (attempt !== current || stopped || current.phase !== "delayed") return;
      if (on === false) settle(current, { kind: "off" });
      else if (on === null) settle(current, { kind: "declined" });
      else if (ready(current)) post(current);
    });
  };

  const post = (current: Attempt) => {
    const port = connect();
    if (!port) {
      settle(current, { kind: "unanswered" });
      return;
    }
    current.phase = "reading";
    const channel = new Channel();
    current.port = channel.port1;
    // The page world's reads wait while the tab is hidden, so the reply time runs only while
    // it is shown (ChatGPT's long reads pause between pages and batches).
    const renew = () => {
      if (current.timer !== null) env.window.clearTimeout(current.timer);
      current.unlisten?.();
      current.unlisten = null;
      current.timer = env.window.setTimeout(expire, OWN_READ_REPLY_MS);
    };
    const expire = () => {
      current.timer = null;
      if (visible()) {
        settle(current, { kind: "unanswered" });
        return;
      }
      const onChange = () => {
        if (attempt === current && current.phase === "reading" && visible()) renew();
      };
      env.document.addEventListener("visibilitychange", onChange);
      current.unlisten = () =>
        env.document.removeEventListener("visibilitychange", onChange);
    };
    channel.port1.onmessage = (event: MessageEvent) => {
      if (event.data?.pending === true && Object.keys(event.data).length === 1) {
        renew();
        // A long read (ChatGPT's batches) reports before each further request, so the switch
        // is checked again there too, in case the change notice did not reach this tab.
        void check(current.key).then((on) => {
          if (on === false) switchedOff(current);
        });
        return;
      }
      if (
        event.data &&
        typeof event.data === "object" &&
        Object.keys(event.data).join(",") === "resume"
      ) {
        renew();
        if (attempt === current && !stopped) current.request.resumed?.(event.data.resume);
        return;
      }
      if (event.data?.stage === "receiving" && Object.keys(event.data).length === 1) {
        renew();
        current.receiving = true;
        if (attempt === current && !stopped) current.request.changed();
        return;
      }
      const outcome = event.data?.outcome;
      settle(
        current,
        validOwnReadOutcome(outcome) ? outcome : { kind: "unanswered" },
      );
    };
    renew();
    const resume = current.request.resume?.() ?? null;
    try {
      port.postMessage(
        {
          channel: OWN_READ_CHANNEL,
          site: env.site,
          conversationId: current.conversationId,
          ...(current.request.rejected ? { rejected: true } : {}),
          ...(current.request.uncounted ? { uncounted: true } : {}),
          ...(resume !== null ? { resume } : {}),
        },
        [channel.port2],
      );
    } catch {
      channel.port2.close();
      settle(current, { kind: "unanswered" });
    }
  };

  const schedule = (current: Attempt) => {
    current.phase = "delayed";
    current.timer = env.window.setTimeout(() => send(current), delay());
  };

  // A hidden tab makes no request; the read waits until the person looks at the chat.
  const waitVisible = (current: Attempt) => {
    current.phase = "waiting";
    if (visible()) {
      schedule(current);
      return;
    }
    const onChange = () => {
      if (attempt !== current || !visible()) return;
      current.unlisten?.();
      current.unlisten = null;
      schedule(current);
    };
    env.document.addEventListener("visibilitychange", onChange);
    current.unlisten = () =>
      env.document.removeEventListener("visibilitychange", onChange);
  };

  return {
    /**
     * Called when the bar would show that history is missing. Starts the one read this
     * navigation may make and returns whether the bar should keep its loading state.
     */
    request(request: OwnReadRequest): boolean {
      if (stopped) return false;
      loadSharedPause();
      // A read dropped before sending because the page was importing (ChatGPT's newest page)
      // may be asked for again once that import ended; it made no request. So may a read the
      // page world skipped because the page read the chat itself, once that page read was not
      // counted (NotebookLM reads its saved chat once per document, 14 Oct 2026). A read a
      // pause held is made once when the pause has passed, and a read "Load full chat history" held
      // once the switch is on again.
      if (
        attempt?.navigation === request.navigation &&
        attempt.outcome?.kind !== "superseded" &&
        !(
          request.rejected &&
          !attempt.request.rejected &&
          attempt.outcome?.kind === "page_read"
        ) &&
        !(attempt.outcome?.kind === "paused" && now() >= pausedUntil) &&
        !(attempt.outcome?.kind === "off" && known.get(attempt.key) === true)
      )
        return pending(attempt);
      const conversationId = ownReadConversation(env.site, request.pathname);
      if (!conversationId) return false;
      if (attempt) clear(attempt, true);
      const at = now();
      for (const [id, entry] of blocked) if (entry.until <= at) blocked.delete(id);
      const current: Attempt = {
        navigation: request.navigation,
        conversationId,
        key: ownReadSettingKey(env.site, conversationId),
        request,
        phase: "settled",
        outcome: null,
        settledAt: at,
        timer: null,
        port: null,
        receiving: false,
        unlisten: null,
        retried: false,
        retryAt: null,
      };
      attempt = current;
      // The switch is known to be off: the bar shows at once that nothing will be read.
      if (known.get(current.key) === false) {
        current.outcome = { kind: "off" };
        return false;
      }
      if (at < pausedUntil) {
        current.outcome = { kind: "paused" };
        wakeAfterPause(current);
        return false;
      }
      const cooldown = blocked.get(conversationId);
      if (cooldown) {
        current.outcome = { kind: "cooldown", reason: cooldown.reason };
        return false;
      }
      waitVisible(current);
      return true;
    },
    /** The Details line for this navigation's read, if one was tried, and whether it failed. */
    note(navigation: string): { text: string; failed: boolean } | null {
      if (attempt?.navigation !== navigation || attempt.phase !== "settled")
        return null;
      const outcome = attempt.outcome;
      const text = outcome ? ownReadNote(outcome, env.site) : null;
      return text
        ? {
            text:
              attempt.retryAt !== null
                ? `${text} It tries once more in a minute or more, while this tab is shown.`
                : text,
            failed: ownReadFailed(outcome!),
          }
        : null;
    },
    /**
     * When this navigation's read settled and why it was asked for, or null while none has
     * settled. A failed read is moot once the page's own read of the chat was counted after it.
     */
    settled(navigation: string): { at: number; mode: OwnReadMode } | null {
      return attempt?.navigation === navigation && attempt.phase === "settled"
        ? { at: attempt.settledAt, mode: attempt.request.mode ?? "missing" }
        : null;
    },
    /**
     * The switch and the reason, when this navigation's read was not made because "Count older
     * chats" is off for the site; Details then says what works instead.
     */
    off(navigation: string): { key: OwnReadSettingKey; mode: OwnReadMode } | null {
      return attempt?.navigation === navigation &&
        attempt.phase === "settled" &&
        attempt.outcome?.kind === "off"
        ? { key: attempt.key, mode: attempt.request.mode ?? "missing" }
        : null;
    },
    /**
     * The setting changed in another extension page. A running read whose switch is now off
     * stops at once; a read the switch held is asked for again once it is on.
     */
    settingChanged() {
      if (stopped || !env.allowed) return;
      const keys: OwnReadSettingKey[] =
        env.site === "claude" ? ["claude", "cowork"] : [env.site];
      for (const key of keys)
        void check(key).then((on) => {
          const current = attempt;
          if (!current || stopped || current.key !== key) return;
          if (on === false) switchedOff(current);
          else if (on === true && current.outcome?.kind === "off")
            current.request.changed();
        });
    },
    /** The progress line for Details while the request runs: sending, then receiving. */
    progress(navigation: string): string | null {
      if (attempt?.navigation !== navigation || attempt.phase !== "reading")
        return null;
      return attempt.receiving ? "Receiving data" : "Sending request";
    },
    stop() {
      stopped = true;
      if (attempt) clear(attempt, true);
      attempt = null;
      link?.close();
      link = null;
    },
  };
}
