import assert from "node:assert/strict";
import {
  OWN_READ_CHANNEL,
  createOwnReadScheduler,
  isOwnReadConnect,
  type OwnReadOutcome,
  type OwnReadRequest,
  type OwnReadSite,
} from "../lib/own-read";
import {
  createOwnReadPage,
  type OwnReadContext,
  type OwnReadProvider,
} from "../lib/own-read-page";
import { historyRequestConversation } from "../lib/history-route";
import { siteForHost } from "@footprint/capture-core";

export const ORIGINS: Record<OwnReadSite, string> = {
  claude: "https://claude.ai",
  chatgpt: "https://chatgpt.com",
  gemini: "https://gemini.google.com",
  perplexity: "https://www.perplexity.ai",
  notebooklm: "https://notebook.google.com",
};

export const json = (
  body: string,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(body, {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

export const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// Ports a test opened. A failed test can leave one listening, which would keep the run open,
// so test files close them all at the end (`after(closePorts)`).
const openPorts = new Set<MessagePort>();
export function channel() {
  const made = new MessageChannel();
  openPorts.add(made.port1);
  openPorts.add(made.port2);
  return made;
}
export function closePorts() {
  for (const port of openPorts) port.close();
  openPorts.clear();
}

/**
 * Hands a private port to an installed page capture as the content script does, and returns
 * the content script's end, on which read requests are sent.
 */
export function connectPage(win: EventTarget, origin: string): MessagePort {
  const link = channel();
  const event = new Event("message");
  Object.assign(event, {
    source: win,
    origin,
    data: { channel: OWN_READ_CHANNEL, connect: true },
    ports: [link.port2],
  });
  win.dispatchEvent(event);
  return link.port1;
}

/** Sends one read request on the private port and resolves with its outcome. */
export function askOverLink(link: MessagePort, message: Record<string, unknown>) {
  const ports = channel();
  const answered = new Promise<any>((resolve) => {
    ports.port1.onmessage = (event) => {
      if (
        event.data?.stage ||
        event.data?.pending ||
        (event.data && "resume" in event.data)
      )
        return;
      ports.port1.close();
      resolve(event.data.outcome);
    };
  });
  link.postMessage({ channel: OWN_READ_CHANNEL, ...message }, [ports.port2]);
  return answered;
}

/**
 * The content script's scheduler with a fake clock, timers, page and visibility. Requests the
 * scheduler sends on its private port are recorded at once in `posted`, with the answer port
 * each one carries; `connects` holds the private ports it handed to the page.
 */
export function scheduler(
  site: OwnReadSite,
  pathname: (conversationId: string) => string,
  options: {
    visible?: boolean;
    random?: number;
    sharedPause?: Parameters<typeof createOwnReadScheduler>[0]["sharedPause"];
    allowed?: Parameters<typeof createOwnReadScheduler>[0]["allowed"];
  } = {},
) {
  let clock = 1_000_000;
  let visibility = options.visible === false ? "hidden" : "visible";
  const timers = new Map<number, { at: number; run: () => void }>();
  let nextTimer = 1;
  const posted: Array<{ message: any; port: MessagePort }> = [];
  const connects: MessagePort[] = [];
  class RecordingChannel {
    port1: MessagePort;
    port2: MessagePort;
    constructor() {
      const made = channel();
      this.port1 = made.port1;
      this.port2 = made.port2;
      const forward = made.port1.postMessage.bind(made.port1);
      made.port1.postMessage = ((message: any, transfer?: any) => {
        if (message?.channel === OWN_READ_CHANNEL) {
          assert.equal(transfer?.length, 1);
          posted.push({ message, port: transfer[0] });
        } else forward(message, transfer);
      }) as MessagePort["postMessage"];
    }
  }
  const listeners = new Set<() => void>();
  const random = Math.random;
  // The default delay draws from Math.random when each read is scheduled.
  if (options.random !== undefined) Math.random = () => options.random!;
  const read = createOwnReadScheduler({
    site,
    window: {
      location: { origin: ORIGINS[site] },
      setTimeout: ((run: () => void, ms: number) => {
        const id = nextTimer++;
        timers.set(id, { at: clock + ms, run });
        return id;
      }) as any,
      clearTimeout: ((id: number) => timers.delete(id)) as any,
      postMessage: ((message: any, origin: string, transfer: MessagePort[]) => {
        assert.equal(origin, ORIGINS[site]);
        assert.equal(transfer.length, 1);
        assert.ok(isOwnReadConnect(message), "only the private port goes over the window");
        connects.push(transfer[0]!);
      }) as any,
    },
    MessageChannel: RecordingChannel as unknown as typeof MessageChannel,
    sharedPause: options.sharedPause,
    allowed: options.allowed,
    document: {
      get visibilityState() {
        return visibility as DocumentVisibilityState;
      },
      addEventListener: (_type: string, listener: () => void) =>
        listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) =>
        listeners.delete(listener),
    } as any,
    now: () => clock,
  });
  let changes = 0;
  let needed = true;
  const request = (
    navigation: string,
    conversationId: string,
    extra: Pick<OwnReadRequest, "resume" | "resumed" | "mode"> = {},
  ) =>
    read.request({
      navigation,
      pathname: pathname(conversationId),
      stillNeeded: () => needed,
      changed: () => changes++,
      ...extra,
    });
  const advance = (ms: number) => {
    clock += ms;
    for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at))
      if (timer.at <= clock && timers.has(id)) {
        timers.delete(id);
        timer.run();
      }
  };
  // Delivery over a MessagePort takes a turn of Node's event loop, longer under load, so a
  // reply waits until the scheduler reacted.
  const send = async (value: unknown, done: () => boolean) => {
    posted.at(-1)!.port.postMessage(value);
    for (let i = 0; i < 400 && !done(); i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
  };
  return {
    read,
    request,
    advance,
    reply: (outcome: OwnReadOutcome) => {
      const before = changes;
      return send({ outcome }, () => changes !== before);
    },
    /** Progress renews the reply timer; `renewed` says when the scheduler took it. */
    progress: (renewed: () => boolean) => send({ pending: true }, renewed),
    posted,
    connects,
    /** When the latest pending timer fires, on the fake clock. */
    latestTimer: () => Math.max(0, ...[...timers.values()].map((timer) => timer.at)),
    get changes() {
      return changes;
    },
    setNeeded(value: boolean) {
      needed = value;
    },
    show() {
      visibility = "visible";
      for (const listener of [...listeners]) listener();
    },
    hide() {
      visibility = "hidden";
    },
    listeners,
    close() {
      Math.random = random;
      read.stop();
      for (const { port } of posted) port.close();
    },
  };
}

/**
 * A provider run's context without timers: every pause is recorded and returns at once, and
 * each request is answered by `answer`. Used to check the waits a provider asks for.
 */
export function recordingContext(
  conversationId: string,
  pathname: string,
  answer: (url: URL, init: RequestInit) => Response | Promise<Response>,
) {
  const pauses: number[] = [];
  const urls: string[] = [];
  const context: OwnReadContext = {
    conversationId,
    pathname,
    resume: undefined,
    active: () => true,
    progress: () => {},
    report: () => {},
    pause: async (ms) => {
      pauses.push(ms);
      return true;
    },
    async fetchPrivate(url, init) {
      urls.push(url.href);
      const response = await answer(url, init);
      return { status: response.status, headers: response.headers, text: await response.text() };
    },
    async read(url, init, check) {
      urls.push(url.href);
      const response = await answer(url, init);
      return check(await response.clone().text(), response);
    },
  };
  return { context, pauses, urls };
}

type Answer = Response | Error | Promise<Response>;

/** The page world's runner with one provider, a fake fetch and a recorded history path. */
export function pageWorld(
  provider: OwnReadProvider,
  conversationId: string,
  pathname: string,
  options: {
    responses?: Answer[] | ((input: string, init: RequestInit) => Answer);
    visible?: boolean;
    now?: () => number;
    byteLimit?: number;
  } = {},
) {
  const site = provider.site;
  const origin = ORIGINS[site];
  const fetches: Array<{ input: string; init: RequestInit }> = [];
  const observed: Array<{
    url: URL;
    method: string;
    response: Promise<Response>;
    body?: string;
  }> = [];
  const state = {
    pathname,
    visible: options.visible ?? true,
    enabled: true,
  };
  const visibleListeners = new Set<() => void>();
  const queue = Array.isArray(options.responses) ? [...options.responses] : [];
  const page = createOwnReadPage({
    provider,
    origin,
    fetch: (input, init) => {
      fetches.push({ input, init });
      const next =
        typeof options.responses === "function"
          ? options.responses(input, init)
          : queue.shift();
      if (next === undefined) return Promise.reject(new Error("no answer"));
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(next);
    },
    observe: (url, method, response, _observedAt, body) =>
      observed.push({ url, method, response, body }),
    readConversation: (url, method, body) =>
      historyRequestConversation(siteForHost(new URL(origin).hostname)!, url, method, body),
    pathname: () => state.pathname,
    visible: () => state.visible,
    whenVisible: (callback) => {
      visibleListeners.add(callback);
      return () => visibleListeners.delete(callback);
    },
    enabled: () => state.enabled,
    now: options.now,
    byteLimit: options.byteLimit,
  });
  const ask = (id = conversationId, extra: Record<string, unknown> = {}) => {
    const ports = channel();
    const pending: unknown[] = [];
    const stages: unknown[] = [];
    // Progress reports (ChatGPT's read progress), in order.
    const reports: any[] = [];
    const answer = new Promise<OwnReadOutcome>((resolve) => {
      ports.port1.onmessage = (event) => {
        if (event.data?.pending) {
          pending.push(event.data);
          return;
        }
        if (event.data?.stage) {
          stages.push(event.data.stage);
          return;
        }
        if (event.data && "resume" in event.data) {
          reports.push(event.data.resume);
          return;
        }
        ports.port1.close();
        resolve(event.data.outcome);
      };
    });
    assert.equal(
      page.receive({ channel: OWN_READ_CHANNEL, site, conversationId: id, ...extra }, [
        ports.port2,
      ]),
      true,
    );
    return Object.assign(answer, { pending, stages, reports });
  };
  return {
    page,
    fetches,
    observed,
    state,
    ask,
    show() {
      state.visible = true;
      for (const listener of [...visibleListeners]) listener();
    },
  };
}
