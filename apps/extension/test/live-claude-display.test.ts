import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { Ledger } from "@footprint/ledger";
import { initialSnapshot } from "@footprint/adapters";
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

test("each completed Claude reply publishes increasing totals and keeps previously calculated history", async (t) => {
  const db = await Ledger.open(`live-claude-${crypto.randomUUID()}`);
  const displays: any[] = [];
  const c = new Coordinator(db, {
    count: countByTextLength,
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
  const page = historyPage();
  const binding = historyBinding();
  const history = {
    channel: HISTORY_CAPTURE_CHANNEL,
    id: crypto.randomUUID(),
    site: "claude",
    conversationId: historyConversation,
    observedAt: page.observedAt,
  } as const;
  await c.history.receive(
    { ...history, event: "start", page: null },
    binding,
    historySender,
  );
  await c.history.receive(
    { ...history, event: "page", page },
    binding,
    historySender,
  );
  await c.engines.maintainLocal();
  const before = await c.routeSummary("claude", historyConversation);
  assert.equal(before.history.local.status, "available");
  // A live revision can arrive while background recalculation is still queued.
  const maintainLocal = c.engines.maintainLocal.bind(c.engines);
  t.mock.method(c.engines, "maintainLocal", async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    await maintainLocal();
  });
  let previousEnergy = 0;
  for (let index = 1; index <= 3; index++) {
    const captureId = crypto.randomUUID();
    const capturedBinding = { ...binding, captureId };
    const dispatch = {
      channel: CHANNEL,
      version: 1,
      id: captureId,
      revision: 1,
      event: "dispatch",
      site: "claude",
      at: new Date().toISOString(),
      dispatch: {
        site: "claude",
        action: "send",
        input: `Synthetic question ${index}`,
        conversationId: historyConversation,
        parentId: null,
        requestId: crypto.randomUUID(),
        model: null,
        attachments: 0,
        imageEditParentId: null,
      },
      snapshot: initialSnapshot(),
      failure: null,
      timing: null,
    };
    await c.capture(dispatch, historySender, capturedBinding);
    await c.capture(
      {
        ...dispatch,
        revision: 2,
        event: "end",
        dispatch: null,
        snapshot: {
          ...initialSnapshot(),
          started: true,
          state: "completed",
          outputId: crypto.randomUUID(),
          text: "Synthetic reply",
        },
      },
      historySender,
      capturedBinding,
    );
    await c.settleConversationDisplays();
    const display = displays.at(-1);
    assert.equal(display.summary.requests, index);
    assert.equal(
      display.history.local.status,
      "available",
      "A new live revision must not hide ready history",
    );
    assert.equal(display.history.local.prompt_count, "1");
    assert.equal(display.history.local.response_count, "1");
    const energy = Number(display.summary.metrics.energy.value);
    assert.ok(
      energy > previousEnergy,
      "Each completed answer adds its resource estimate",
    );
    previousEnergy = energy;
  }
});
