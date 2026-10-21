import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Ledger } from "@footprint/ledger";
import { initialSnapshot } from "@footprint/adapters";
import type { CountRequest } from "@footprint/tokenizers";
import { Coordinator } from "../lib/coordinator";
import { CHANNEL } from "../lib/bridge";
import { HISTORY_CAPTURE_CHANNEL } from "../lib/history-capture";
import { countByTextLength } from "./counting-fixture";
import {
  historyPage,
  historyBinding,
  historySender,
  historyConversation,
} from "./history-fixture";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function setup(t: TestContext) {
  const db = await Ledger.open(`coalescing-${crypto.randomUUID()}`);
  const displays: any[] = [];
  let gate: Promise<void> | null = null;
  const c = new Coordinator(db, {
    // Live counting runs inside frame processing, so a closed gate holds a frame.
    count: async (job: CountRequest) => {
      if (gate) await gate;
      return countByTextLength(job);
    },
    hasConsent: async () => true,
    hasSiteConsent: async () => true,
    sendDisplay: async (_, display) => {
      displays.push(display);
    },
    transport: async () => {
      throw new Error("Personal capture must remain local");
    },
  });
  t.after(() => {
    c.history.invalidate();
    c.engines.dispose();
    db.close();
  });
  await c.whenReady();
  const processed: number[] = [];
  const process = (c as any).process.bind(c);
  (c as any).process = async (message: any, ...rest: unknown[]) => {
    processed.push(message.revision);
    return process(message, ...rest);
  };
  const hold = () => {
    let release!: () => void;
    gate = new Promise<void>((resolve) => (release = resolve));
    return () => {
      gate = null;
      release();
    };
  };
  const queues = () => ({
    queued: (c as any).queued,
    queuedBytes: (c as any).queuedBytes,
    waiting: (c as any).captureWaiting.size,
    progress: (c as any).queuedProgress.size,
  });
  return { c, db, displays, processed, hold, queues };
}

function reply(captureId = crypto.randomUUID()) {
  const binding = { ...historyBinding(), captureId };
  let text = "";
  const frame = (
    revision: number,
    event: "dispatch" | "progress" | "end",
    state = event === "end" ? "completed" : "generating",
  ) => {
    if (event !== "dispatch") text += `Synthetic reply part ${revision}. `;
    return {
      channel: CHANNEL,
      version: 1,
      id: captureId,
      revision,
      event,
      site: "claude",
      at: new Date().toISOString(),
      dispatch:
        event === "dispatch"
          ? {
              site: "claude",
              action: "send",
              input: "Synthetic question",
              conversationId: historyConversation,
              parentId: null,
              requestId: crypto.randomUUID(),
              model: null,
              attachments: 0,
              imageEditParentId: null,
            }
          : null,
      snapshot:
        event === "dispatch"
          ? initialSnapshot()
          : {
              ...initialSnapshot(),
              started: true,
              state,
              outputId: "00000000-0000-4000-8000-00000000fffe",
              text,
            },
      failure: null,
      timing: null,
    };
  };
  return { binding, frame, captureId };
}

const settle = (promises: Array<Promise<unknown>>) =>
  Promise.all(
    promises.map((promise) =>
      promise.then(
        (value) => value,
        (error: Error) => `rejected:${error.message}`,
      ),
    ),
  );

test("waiting progress frames merge into the newest revision and earlier callers resolve as superseded", async (t) => {
  const f = await setup(t);
  const r = reply();
  const release = f.hold();
  const calls = [f.c.capture(r.frame(1, "dispatch"), historySender, r.binding)];
  await tick();
  for (const revision of [2, 3, 4])
    calls.push(f.c.capture(r.frame(revision, "progress"), historySender, r.binding));
  release();
  assert.deepEqual(await settle(calls), [
    "processed",
    "superseded",
    "superseded",
    "processed",
  ]);
  assert.deepEqual(f.processed, [1, 4]);
  await f.c.settleConversationDisplays();
  assert.deepEqual(f.queues(), { queued: 0, queuedBytes: 0, waiting: 0, progress: 0 });
});

test("an end frame replaces a waiting progress frame and is never merged away", async (t) => {
  const f = await setup(t);
  const r = reply();
  const release = f.hold();
  const calls = [f.c.capture(r.frame(1, "dispatch"), historySender, r.binding)];
  await tick();
  calls.push(f.c.capture(r.frame(2, "progress"), historySender, r.binding));
  calls.push(f.c.capture(r.frame(3, "end"), historySender, r.binding));
  // A later progress frame can never move ahead of the queued end.
  calls.push(f.c.capture(r.frame(4, "progress"), historySender, r.binding));
  release();
  assert.deepEqual(await settle(calls), [
    "processed",
    "superseded",
    "processed",
    "processed",
  ]);
  assert.deepEqual(f.processed, [1, 3, 4]);
  await f.c.settleConversationDisplays();
  assert.deepEqual(f.queues(), { queued: 0, queuedBytes: 0, waiting: 0, progress: 0 });
});

test("a long generation never reports buffer_overflow and replays no stale revisions", async (t) => {
  const f = await setup(t);
  const r = reply();
  const release = f.hold();
  const calls = [f.c.capture(r.frame(1, "dispatch"), historySender, r.binding)];
  await tick();
  for (let revision = 2; revision <= 41; revision++)
    calls.push(f.c.capture(r.frame(revision, "progress"), historySender, r.binding));
  calls.push(f.c.capture(r.frame(42, "end"), historySender, r.binding));
  release();
  const outcomes = await settle(calls);
  assert.ok(outcomes.every((outcome) => outcome === "processed" || outcome === "superseded"));
  assert.deepEqual(f.processed, [1, 42]);
  await f.c.settleConversationDisplays();
  assert.equal(f.displays.at(-1).state, "completed");
  assert.deepEqual(f.queues(), { queued: 0, queuedBytes: 0, waiting: 0, progress: 0 });
});

test("global overload rejects new progress heads while dispatch, end and running captures keep their reserve", async (t) => {
  const f = await setup(t);
  const release = f.hold();
  const replies = Array.from({ length: 16 }, () => reply());
  const calls = replies.map((r) =>
    f.c.capture(r.frame(1, "dispatch"), historySender, r.binding),
  );
  await tick();
  assert.equal(f.queues().queued, 16);
  const stranger = reply();
  await assert.rejects(
    f.c.capture(stranger.frame(2, "progress"), historySender, stranger.binding),
    /buffer_overflow/,
  );
  const late = reply();
  calls.push(f.c.capture(late.frame(1, "dispatch"), historySender, late.binding));
  calls.push(f.c.capture(replies[0]!.frame(2, "progress"), historySender, replies[0]!.binding));
  calls.push(f.c.capture(replies[0]!.frame(3, "end"), historySender, replies[0]!.binding));
  release();
  const outcomes = await settle(calls);
  assert.ok(outcomes.every((outcome) => !String(outcome).startsWith("rejected")));
  await f.c.settleConversationDisplays();
  assert.deepEqual(f.queues(), { queued: 0, queuedBytes: 0, waiting: 0, progress: 0 });
});

test("a merged frame's failure rejects only the caller whose frame ran", async (t) => {
  const f = await setup(t);
  const process = (f.c as any).process;
  (f.c as any).process = async (message: any, ...rest: unknown[]) => {
    if (message.revision === 4) {
      f.processed.push(message.revision);
      throw new Error("storage_write_failed");
    }
    return process(message, ...rest);
  };
  const r = reply();
  const release = f.hold();
  const calls = [f.c.capture(r.frame(1, "dispatch"), historySender, r.binding)];
  await tick();
  for (const revision of [2, 3, 4])
    calls.push(f.c.capture(r.frame(revision, "progress"), historySender, r.binding));
  release();
  assert.deepEqual(await settle(calls), [
    "processed",
    "superseded",
    "superseded",
    "rejected:storage_write_failed",
  ]);
  await f.c.settleConversationDisplays();
  assert.deepEqual(f.queues(), { queued: 0, queuedBytes: 0, waiting: 0, progress: 0 });
});

test("a streaming reply skips a display only while a newer frame waits and the last one is recent", async (t) => {
  const f = await setup(t);
  const r = reply();
  const key = `capture:${historySender.tab.id}:${historySender.documentId}:${r.captureId}`;
  await f.c.capture(r.frame(1, "dispatch"), historySender, r.binding);
  const shown = f.displays.length;
  let release = f.hold();
  const second = f.c.capture(r.frame(2, "progress"), historySender, r.binding);
  await tick();
  const third = f.c.capture(r.frame(3, "progress"), historySender, r.binding);
  release();
  await Promise.all([second, third]);
  assert.deepEqual(f.processed, [1, 2, 3]);
  assert.equal(
    f.displays.length,
    shown + 1,
    "the frame followed by a newer one within the interval is not shown",
  );
  // After the interval, a frame is shown even though a newer one is waiting.
  release = f.hold();
  const fourth = f.c.capture(r.frame(4, "progress"), historySender, r.binding);
  await tick();
  (f.c as any).lastPublishAt.set(key, Date.now() - 5000);
  const fifth = f.c.capture(r.frame(5, "progress"), historySender, r.binding);
  release();
  await Promise.all([fourth, fifth]);
  assert.equal(f.displays.length, shown + 3);
  // A frame followed by the end frame is never shown; the end frame always is.
  release = f.hold();
  const sixth = f.c.capture(r.frame(6, "progress"), historySender, r.binding);
  await tick();
  (f.c as any).lastPublishAt.set(key, Date.now() - 5000);
  const end = f.c.capture(r.frame(7, "end"), historySender, r.binding);
  release();
  await Promise.all([sixth, end]);
  await f.c.settleConversationDisplays();
  assert.equal(f.displays.length, shown + 4);
  assert.equal(f.displays.at(-1).state, "completed");
});

async function importHistory(c: Coordinator) {
  const page = historyPage();
  const binding = historyBinding();
  const history = {
    channel: HISTORY_CAPTURE_CHANNEL,
    id: crypto.randomUUID(),
    site: "claude",
    conversationId: historyConversation,
    observedAt: page.observedAt,
  } as const;
  await c.history.receive({ ...history, event: "start", page: null }, binding, historySender);
  await c.history.receive({ ...history, event: "page", page }, binding, historySender);
  await c.engines.maintainLocal();
}

test("live frames publish after recalculation, so ready history stays visible", async (t) => {
  const f = await setup(t);
  await importHistory(f.c);
  const r = reply();
  await f.c.capture(r.frame(1, "dispatch"), historySender, r.binding);
  await f.c.capture(r.frame(2, "progress"), historySender, r.binding);
  await f.c.capture(r.frame(3, "end"), historySender, r.binding);
  await f.c.settleConversationDisplays();
  assert.ok(f.displays.length >= 3);
  for (const display of f.displays) {
    assert.equal(display.calculationPending, false);
    assert.equal(display.history.local.status, "available");
  }
});

test("a capture display that waited for recalculation is republished when the result publishes", async (t) => {
  const f = await setup(t);
  await importHistory(f.c);
  const settle = t.mock.method(f.c.engines, "settleLocal", async () => {});
  const maintain = t.mock.method(f.c.engines, "maintainLocal", async () => {});
  const r = reply();
  await f.c.capture(r.frame(1, "dispatch"), historySender, r.binding);
  await f.c.capture(r.frame(2, "end"), historySender, r.binding);
  await f.c.settleConversationDisplays();
  const waiting = f.displays.at(-1);
  assert.equal(waiting.calculationPending, true);
  assert.equal(waiting.history.local.status, "unavailable");
  settle.mock.restore();
  maintain.mock.restore();
  const shown = f.displays.length;
  // A frame still waiting for this reply publishes newer figures itself.
  const release = f.hold();
  const late = f.c.capture(r.frame(3, "end"), historySender, r.binding);
  await tick();
  (f.c as any).calculationDirty = true;
  (f.c as any).wakeFileDisplays();
  await tick();
  assert.equal(f.displays.length, shown, "a republish never overtakes a newer frame");
  release();
  await late;
  await f.c.engines.maintainLocal();
  await f.c.settleConversationDisplays();
  const settled = f.displays.at(-1);
  assert.equal(settled.calculationPending, false);
  assert.equal(settled.history.local.status, "available");
  assert.equal((f.c as any).pendingCalc.size, 0);
});

test("a newer progress frame never moves ahead of upload work queued behind the waiting one", async (t) => {
  const f = await setup(t);
  const r = reply();
  const key = `capture:${historySender.tab.id}:${historySender.documentId}:${r.captureId}`;
  const order: string[] = [];
  const process = (f.c as any).process;
  (f.c as any).process = async (message: any, ...rest: unknown[]) => {
    order.push(`frame ${message.revision}`);
    return process(message, ...rest);
  };
  const release = f.hold();
  const calls = [f.c.capture(r.frame(1, "dispatch"), historySender, r.binding)];
  await tick();
  calls.push(f.c.capture(r.frame(2, "progress"), historySender, r.binding));
  // Uploaded-file work shares the capture's chain and must keep its place.
  const flights = (f.c as any).flights as Map<string, Promise<void>>;
  const upload = flights
    .get(key)!
    .catch(() => {})
    .then(() => {
      order.push("upload");
    });
  flights.set(key, upload);
  calls.push(f.c.capture(r.frame(3, "progress"), historySender, r.binding));
  release();
  assert.deepEqual(await settle(calls), ["processed", "superseded", "processed"]);
  assert.deepEqual(order, ["frame 1", "upload", "frame 3"]);
  await f.c.settleConversationDisplays();
  assert.deepEqual(f.queues(), { queued: 0, queuedBytes: 0, waiting: 0, progress: 0 });
});

test("an end frame arriving while a progress frame settles makes that progress display unnecessary", async (t) => {
  const f = await setup(t);
  const r = reply();
  await f.c.capture(r.frame(1, "dispatch"), historySender, r.binding);
  const shown = f.displays.length;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const settle = f.c.engines.settleLocal.bind(f.c.engines);
  let waiting = 0;
  t.mock.method(f.c.engines, "settleLocal", async (ms: number) => {
    if (waiting++ === 0) await gate;
    return settle(ms);
  });
  (f.c as any).lastPublishAt.clear();
  const progress = f.c.capture(r.frame(2, "progress"), historySender, r.binding);
  await tick();
  const end = f.c.capture(r.frame(3, "end"), historySender, r.binding);
  release();
  await Promise.all([progress, end]);
  await f.c.settleConversationDisplays();
  assert.deepEqual(f.processed, [1, 2, 3]);
  assert.equal(f.displays.length, shown + 1, "only the end frame is shown");
  assert.equal(f.displays.at(-1).state, "completed");
});
