import { archivedEstimation, settleStartup } from "./archived-engine-fixture";
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { Ledger } from "@footprint/ledger";
import { initialSnapshot } from "@footprint/adapters";
import { countWithBundledTokenizer } from "./counting-fixture";
import { Coordinator } from "../lib/coordinator";
import {
  CAPTURE_RETRY_DELAYS_MS,
  captureAnswer,
  captureSendThrew,
} from "../lib/capture-delivery";

test("capture delivery: answers that mean not ready are tried again, refusals never", () => {
  assert.deepEqual(CAPTURE_RETRY_DELAYS_MS, [1000, 3000]);
  assert.deepEqual(captureAnswer({ ok: true }), {
    kind: "delivered",
    superseded: false,
  });
  assert.deepEqual(captureAnswer({ ok: true, superseded: true }), {
    kind: "delivered",
    superseded: true,
  });
  // No answer: the listener was missing or the worker stopped before answering.
  assert.deepEqual(captureAnswer(undefined), { kind: "not_ready", code: undefined });
  assert.deepEqual(captureAnswer(null), { kind: "not_ready", code: undefined });
  assert.deepEqual(captureSendThrew(), {
    kind: "not_ready",
    code: "ledger_integrity_failed",
  });
  for (const code of [
    "storage_write_failed",
    "buffer_overflow",
    "aggregate_inconsistent",
    "ledger_integrity_failed",
  ])
    assert.deepEqual(captureAnswer({ ok: false, code }), { kind: "not_ready", code });
  for (const code of [
    "capture_hook_missing",
    "payload_rejected",
    "request_identity_ambiguous",
    "policy_unavailable",
    "deletion_in_progress",
    "record_erased",
    "revision_conflict",
    "capture_limit_exceeded",
    "clock_skew",
  ])
    assert.deepEqual(captureAnswer({ ok: false, code }), { kind: "refused", code });
  // A malformed acknowledgement is not a delivery and is not sent again.
  assert.deepEqual(captureAnswer({}), { kind: "refused", code: undefined });
  assert.deepEqual(captureAnswer({ enabled: false }), {
    kind: "refused",
    code: undefined,
  });
  assert.deepEqual(captureAnswer("ok"), { kind: "refused", code: undefined });
});

async function setup() {
  const db = await Ledger.open("capture-delivery-" + crypto.randomUUID());
  const displays: any[] = [];
  const worker = () =>
    new Coordinator(db, {
      estimation: archivedEstimation,
      hasConsent: async () => true,
      hasSiteConsent: async () => true,
      count: countWithBundledTokenizer,
      sendDisplay: async (_, display) => {
        displays.push(display);
      },
      transport: (async () => {
        throw new Error("synthetic offline");
      }) as typeof fetch,
    });
  const c = worker();
  await settleStartup(c);
  const conversationId = crypto.randomUUID();
  const sender = {
    tab: { id: 31 },
    frameId: 0,
    documentId: "synthetic-delivery-document",
    url: "https://chatgpt.com/c/" + conversationId,
  };
  const id = crypto.randomUUID();
  const binding = {
    documentNonce: crypto.randomUUID(),
    navigationNonce: crypto.randomUUID(),
    captureId: id,
  };
  const base = {
    channel: "ai-footprint-observation-v1",
    version: 1,
    id,
    site: "chatgpt",
    at: new Date().toISOString(),
    failure: null,
    timing: null,
  };
  const dispatch: any = {
    ...base,
    revision: 1,
    event: "dispatch",
    dispatch: {
      action: "send",
      attachments: null,
      conversationId,
      imageEditParentId: null,
      input: "Synthetic prompt for a delivery test.",
      model: null,
      parentId: null,
      requestId: crypto.randomUUID(),
      site: "chatgpt",
    },
    snapshot: null,
  };
  const reply = (event: "progress" | "end", revision: number, text: string): any => ({
    ...base,
    revision,
    event,
    dispatch: null,
    snapshot: {
      ...initialSnapshot(),
      started: true,
      state: event === "end" ? "completed" : "generating",
      text,
      conversationId,
      outputId: id,
    },
  });
  const rows = async () =>
    JSON.stringify([await db.all("requests"), await db.all("attempts")]);
  const shown = () =>
    displays.filter((display) => display.displayBinding?.captureId === id);
  return { db, c, worker, sender, binding, dispatch, reply, rows, shown };
}

test("capture delivery: a frame delivered again, also after its answer was lost or the worker restarted, counts once", async () => {
  const f = await setup();
  let restarted: Coordinator | null = null;
  try {
    await f.c.capture(f.dispatch, f.sender, f.binding);
    const dispatched = await f.rows();
    // The answer to the dispatch was lost, so the page sends it again.
    await f.c.capture(f.dispatch, f.sender, f.binding);
    assert.equal(await f.rows(), dispatched);
    await f.c.capture(f.reply("progress", 2, "Synthetic"), f.sender, f.binding);
    const end = f.reply("end", 3, "Synthetic answer for a delivery test.");
    await f.c.capture(end, f.sender, f.binding);
    await f.c.settleConversationDisplays();
    const ended = await f.rows();
    const [requests, attempts] = JSON.parse(ended);
    assert.equal(requests.length, 1);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].record.state, "completed");
    assert.equal(f.shown().at(-1).summary.requests, 1);
    // The end again, one after the other and twice at the same time.
    await f.c.capture(end, f.sender, f.binding);
    await Promise.all([
      f.c.capture(end, f.sender, f.binding),
      f.c.capture(end, f.sender, f.binding),
    ]);
    assert.equal(await f.rows(), ended);
    // An older frame sent again after the end changes nothing either.
    await f.c.capture(f.reply("progress", 2, "Synthetic"), f.sender, f.binding);
    assert.equal(await f.rows(), ended);
    // A restarted worker reads what the frame saved, so a repeat sent to it is skipped too.
    restarted = f.worker();
    await restarted.whenReady();
    await restarted.capture(end, f.sender, f.binding);
    await restarted.capture(f.dispatch, f.sender, f.binding);
    assert.equal(await f.rows(), ended);
    await f.c.settleConversationDisplays();
    assert.equal(f.shown().at(-1).summary.requests, 1);
  } finally {
    await restarted?.settleConversationDisplays();
    restarted?.engines.dispose();
    await f.c.settleConversationDisplays();
    f.db.close();
  }
});

test("capture delivery: an end that ran before its dispatch is counted when it is sent again after it", async () => {
  const f = await setup();
  try {
    const end = f.reply("end", 3, "Synthetic answer for a delivery test.");
    // The dispatch failed and waits to be sent again, but the end got through first.
    await f.c.capture(end, f.sender, f.binding);
    assert.deepEqual(JSON.parse(await f.rows()), [[], []]);
    assert.ok(
      (await f.db.all<any>("health")).some((row) =>
        JSON.stringify(row).includes("capture_body_missing"),
      ),
    );
    await f.c.capture(f.dispatch, f.sender, f.binding);
    await f.c.capture(end, f.sender, f.binding);
    await f.c.settleConversationDisplays();
    const [requests, attempts] = JSON.parse(await f.rows());
    assert.equal(requests.length, 1);
    assert.equal(attempts.length, 1);
    const attempt = attempts[0].record;
    assert.equal(attempt.state, "completed");
    assert.notEqual(attempt.tokens.answer_output.value, null);
    assert.equal(f.shown().at(-1).summary.requests, 1);
  } finally {
    await f.c.settleConversationDisplays();
    f.db.close();
  }
});
