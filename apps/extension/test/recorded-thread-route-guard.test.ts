import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  THREAD_HISTORY_CHANNEL,
  type ThreadHistoryMessage,
} from "@footprint/adapters";
import { Ledger } from "@footprint/ledger";
import { records } from "../../../packages/ledger/test/factory";
import { Coordinator } from "../lib/coordinator";
import { RouteAuthorities } from "../lib/route-authority";
import { hmacIdentity } from "../lib/ownership";
import { unavailableCount } from "./counting-fixture";

async function setup(t: test.TestContext) {
  const db = await Ledger.open("thread-native-" + crypto.randomUUID());
  const c = new Coordinator(db, {
    hasConsent: async () => true,
    count: unavailableCount,
    sendDisplay: async () => {},
  });
  await c.whenReady();
  const threadId = crypto.randomUUID(),
    frontend = crypto.randomUUID();
  let url = "https://www.perplexity.ai/search/" + threadId;
  let prove = async () => ({ current: true });
  const routes = new RouteAuthorities({
    extensionId: "test",
    getTab: async (id) => ({ id, url }),
    hasPermission: async () => true,
    confirm: () => prove(),
  });
  const sender = {
    id: "test",
    frameId: 0,
    tab: { id: 8 },
    documentId: "native-document",
    documentLifecycle: "active",
    url,
  };
  const binding = {
    documentNonce: crypto.randomUUID(),
    navigationNonce: crypto.randomUUID(),
    captureId: null,
  };
  const start: ThreadHistoryMessage = {
    channel: THREAD_HISTORY_CHANNEL,
    event: "start" as const,
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    site: "perplexity" as const,
    threadId,
    page: null,
  };
  const page = {
    ...start,
    event: "page" as const,
    page: { requestIds: [frontend], hasNextPage: false },
  };
  const scope = await c.currentScope();
  const ownership = (await c.ledger.readOwnershipHistory())!.eras.at(-1)!;
  const pair = records();
  pair[0].site = "perplexity";
  pair[0].provider_request_key = await hmacIdentity(
    ownership.secret,
    "perplexity",
    "request",
    frontend,
  );
  await c.ledger.commitCapture({ scope, observations: pair });
  t.after(() => {
    routes.invalidateAll();
    c.threads.invalidateAll();
    c.engines.dispose();
    db.close();
  });
  const run = (message: typeof start | typeof page) =>
    routes.run(sender, binding, "perplexity", threadId, (guard) =>
      c.threads.receive(message, binding, sender, guard),
    );
  return {
    db,
    c,
    routes,
    start,
    page,
    run,
    hint: () =>
      routes.updated(8, { status: "loading" }, () => c.invalidateDisplay(8)),
    change: () => {
      url = "https://www.perplexity.ai/search/" + crypto.randomUUID();
    },
    setProof: (fn: typeof prove) => {
      prove = fn;
    },
  };
}

for (const changed of [false, true]) {
  test(`recorded-thread start ${changed ? "rejects real navigation" : "waits for a benign hint"} during ownership read`, async (t) => {
    const h = await setup(t);
    const original = h.c.ledger.readOwnershipHistory.bind(h.c.ledger);
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let hint: Promise<void> | undefined;
    h.c.ledger.readOwnershipHistory = async () => {
      const value = await original();
      h.setProof(async () => {
        await gate;
        return { current: true };
      });
      hint = h.hint();
      entered();
      return value;
    };
    const result = h.run(h.start).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await started;
    if (changed) h.change();
    release();
    await hint;
    const outcome = await result;
    if (changed) assert.ok("error" in outcome);
    else {
      assert.ok("value" in outcome);
      assert.deepEqual(outcome.value, { observed: false });
    }
    assert.equal((await h.db.all("thread_relations")).length, 0);
  });
}

for (const repeated of [false, true]) {
  test(`recorded-thread transaction ${repeated ? "bounds repeated route-proof retries" : "retries a benign pending proof atomically"}`, async (t) => {
    const h = await setup(t);
    await h.run(h.start);
    const original = h.c.ledger.linkRecordedThread.bind(h.c.ledger);
    let attempts = 0;
    h.c.ledger.linkRecordedThread = async (...args) => {
      attempts++;
      if (attempts === 1 || repeated) {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        h.setProof(async () => {
          await gate;
          return { current: true };
        });
        const hint = h.hint();
        try {
          return await original(...args);
        } finally {
          assert.equal((await h.db.all("thread_relations")).length, 0);
          release();
          await hint;
        }
      }
      return original(...args);
    };
    if (repeated) {
      await assert.rejects(h.run(h.page), /route_pending/);
      assert.equal(attempts, 3);
      assert.equal((await h.db.all("thread_relations")).length, 0);
    } else {
      assert.deepEqual(await h.run(h.page), { observed: true });
      assert.equal(attempts, 2);
      assert.equal((await h.db.all("thread_relations")).length, 1);
    }
  });
}
