import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Ledger } from "@footprint/ledger";
import { initialSnapshot } from "@footprint/adapters";
import { composeOutputTotal } from "@footprint/contracts";
import { records } from "../../../packages/ledger/test/factory";
import { Coordinator } from "../lib/coordinator";
import { CHANNEL } from "../lib/bridge";
import { SummaryAccumulator } from "../lib/summary-scan";
import * as overview from "../lib/details-overview";
import { NOT_ESTIMATED_DETAIL, estimationKind } from "../lib/dash/model-estimation";
import { countByTextLength } from "./counting-fixture";

// Live QA of 19 Oct 2026: a ChatGPT reply (GPT-6 Astra Pro) stopped while ChatGPT was still
// thinking showed Req 1, In/Out 24/0 and Unknown electricity, carbon and water, and Details
// gave no reason. These tests pin the state behind it and the count Details explains it from.

async function coordinator(t: TestContext) {
  const db = await Ledger.open(`stopped-reply-${crypto.randomUUID()}`);
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
  return { c, displays };
}

/** One ChatGPT reply: dispatch, a started frame without answer text, then its end. */
async function reply(
  t: TestContext,
  end: { state: "cancelled" | "completed"; text: string },
  /** Runs with the coordinator once the reply ended, for checks beyond the chat's summary. */
  after?: (c: Coordinator) => Promise<void>,
) {
  const { c, displays } = await coordinator(t);
  const conversationId = crypto.randomUUID();
  const captureId = crypto.randomUUID();
  const sender = {
    tab: { id: 31 },
    frameId: 0,
    documentId: `stopped-reply-${captureId}`,
    url: `https://chatgpt.com/c/${conversationId}`,
  };
  const binding = {
    documentNonce: crypto.randomUUID(),
    navigationNonce: crypto.randomUUID(),
    captureId,
  };
  const frame = (
    revision: number,
    event: "dispatch" | "progress" | "end",
    snapshot: Record<string, unknown>,
  ) => ({
    channel: CHANNEL,
    version: 1,
    id: captureId,
    revision,
    event,
    site: "chatgpt",
    at: new Date().toISOString(),
    dispatch:
      event === "dispatch"
        ? {
            site: "chatgpt",
            action: "send",
            input: "A synthetic question of 24 chars",
            conversationId,
            parentId: null,
            requestId: crypto.randomUUID(),
            model: null,
            attachments: 0,
            imageEditParentId: null,
          }
        : null,
    snapshot: { ...initialSnapshot(), ...snapshot },
    failure: null,
    timing: null,
  });
  const started = {
    started: true,
    conversationId,
    model: "gpt-6-astra",
    outputId: "00000000-0000-4000-8000-00000000c0de",
    text: "",
  };
  await c.capture(frame(1, "dispatch", {}) as any, sender, binding);
  await c.capture(frame(2, "progress", started) as any, sender, binding);
  await c.capture(
    frame(3, "end", { ...started, state: end.state, text: end.text }) as any,
    sender,
    binding,
  );
  const last = displays.filter((display) => display.summary).at(-1);
  assert.ok(last, "the reply was published");
  await after?.(c);
  return last.summary;
}

test("a reply stopped before any answer is cancelled with 0 output tokens and no electricity estimate, and its chat summary counts it", async (t) => {
  const summary = await reply(t, { state: "cancelled", text: "" });
  assert.equal(summary.requests, 1);
  assert.equal(summary.outcomes.cancelled, 1);
  assert.equal(summary.tokens.output.value, "0");
  assert.equal(summary.metrics.energy.value, null);
  assert.equal(summary.metrics.energy.unknown, 1);
  // The estimate exists: its text component is unavailable, because there is no output.
  const main = summary.estimation.lines.find((line: any) => line.role === "main");
  assert.ok(main, "the reply has an estimate");
  assert.equal(main.unavailable, 1);
  assert.equal(summary.stoppedWithoutAnswer, 1);
});

// QA of 19 Oct 2026: on Tools and models a model used only for such a reply showed Unknown
// electricity beside "Own record" while its tool had a value. The reply has an estimate whose
// electricity is unavailable, so it names no record selection for the model table.
test("a model whose only reply was stopped before any answer reads Not estimated, with the reason", async (t) => {
  await reply(t, { state: "cancelled", text: "" }, async (c) => {
    const view = await c.usageBreakdown({ bucket: "day", timezone: "UTC" });
    const models = Object.keys(view.models);
    assert.equal(models.length, 1, "the reply's model has a row");
    const part = view.models[models[0]!]!;
    assert.equal(part.requests, 1);
    assert.equal(part.metrics.energy.value, null);
    assert.deepEqual(part.selections, [], "no selection without an electricity figure");
    assert.deepEqual(estimationKind(view as any, models[0]!), {
      label: "Not estimated",
      tone: "other",
      detail: NOT_ESTIMATED_DETAIL,
    });
  });
});

test("an answered reply and a reply stopped after some answer text are not listed as stopped without an answer", async (t) => {
  const answered = await reply(t, { state: "completed", text: "A finished synthetic answer." });
  assert.equal(answered.stoppedWithoutAnswer, 0);
  const partial = await reply(t, { state: "cancelled", text: "A partial synthetic answer" });
  assert.equal(partial.outcomes.cancelled, 1);
  assert.notEqual(partial.tokens.output.value, "0");
  assert.equal(partial.stoppedWithoutAnswer, 0);
});

test("the summary counts only stopped replies with 0 output and no electricity figure, outside the dashboard's answers", () => {
  const totals = new SummaryAccumulator();
  const add = (state: "cancelled" | "completed", output: string) => {
    const [request, attempt] = records();
    attempt.state = state;
    attempt.tokens.answer_output = { ...attempt.tokens.answer_output, value: output };
    attempt.tokens.output_total = composeOutputTotal(attempt.tokens);
    totals.request(request);
    totals.attempt(attempt, request, undefined);
  };
  add("cancelled", "0");
  add("cancelled", "0");
  add("completed", "0");
  add("cancelled", "100");
  assert.equal(totals.stoppedReplies(), 2);
  assert.equal("stoppedWithoutAnswer" in totals.result(), false);
});

test("the Details entry names stopped replies in plain words, and none for none", () => {
  assert.equal(overview.stoppedRepliesStatus(0, "ChatGPT"), null);
  assert.deepEqual(overview.stoppedRepliesStatus(1, "ChatGPT"), {
    chip: "Stopped reply not estimated",
    text: "A reply was stopped before any answer was written, so it has no output tokens to estimate from. The model may already have been thinking, but ChatGPT does not show that work, so the tracker cannot estimate it either. The reply's electricity, carbon and water are left out of the figures, not counted as zero.",
    tone: "warn",
  });
  const two = overview.stoppedRepliesStatus(2, "Claude")!;
  assert.equal(two.chip, "Stopped replies not estimated");
  assert.match(two.text, /^2 replies were stopped before any answer was written, so they have no output tokens/);
  assert.match(two.text, /but Claude does not show that work/);
  assert.doesNotMatch(`${two.chip} ${two.text}`, /—/);
});
