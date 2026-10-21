import { archivedEstimation } from "./archived-engine-fixture";
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { Ledger } from "@footprint/ledger";
import {
  ChatgptSession,
  initialSnapshot,
  parseDispatch,
  parseHistoryText,
  type HistoryTextPage,
} from "@footprint/adapters";
import { prepareObservation } from "@footprint/estimator";
import { Coordinator } from "../lib/coordinator";
import { HISTORY_CAPTURE_CHANNEL } from "../lib/history-capture";
import { combinedUsage } from "../lib/history-presentation";
import { countByTextLength } from "./counting-fixture";

// I4 (5 Oct 2026): a ChatGPT image job that runs apart from the stream. The live stream
// ends at the job's start with one assistant message; the saved chat then keeps that
// message, under the same id, as the job's tool message with the image.
const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const conversation = uid(42);
const sender = {
  tab: { id: 91 },
  frameId: 0,
  documentId: "synthetic-image-job",
  url: `https://chatgpt.com/c/${conversation}`,
};

function saved(running = false): HistoryTextPage {
  const at = 1767261600;
  const messages = [
    {
      id: uid(1),
      author: { role: "system" },
      content: { content_type: "text", parts: [""] },
      status: "finished_successfully",
      recipient: "all",
      create_time: at,
      metadata: { is_visually_hidden_from_conversation: true },
    },
    {
      id: uid(2),
      author: { role: "user" },
      content: { content_type: "text", parts: ["Draw a circle"] },
      status: "finished_successfully",
      recipient: "all",
      create_time: at + 1,
      metadata: { request_id: uid(9001) },
    },
    {
      id: uid(3),
      author: { role: "tool", name: "t2uay3k.sj1i4kz" },
      content: {
        content_type: "multimodal_text",
        parts: running
          ? []
          : [
              {
                content_type: "image_asset_pointer",
                asset_pointer: "file-service://asset",
                width: 1254,
                height: 1254,
                metadata: {
                  generation: {
                    gen_id: "gen-1",
                    parent_gen_id: null,
                    width: 1254,
                    height: 1254,
                  },
                  dalle: {
                    gen_id: "gen-1",
                    parent_gen_id: null,
                    edit_op: null,
                  },
                },
              },
            ],
      },
      status: "finished_successfully",
      recipient: "all",
      channel: "final",
      create_time: at + 2,
      update_time: at + 20,
      metadata: {
        parent_id: uid(2),
        async_source: "image-job",
        ghostrider: { status: running ? "intermediate" : "final" },
        image_gen_title: "Circle",
      },
    },
    ...(running
      ? []
      : [
          {
            id: uid(4),
            author: { role: "assistant" },
            content: {
              content_type: "reasoning_recap",
              content: "Thought for 10s",
            },
            status: "finished_successfully",
            end_turn: false,
            recipient: "all",
            create_time: at + 21,
            update_time: at + 22,
            metadata: {
              parent_id: uid(77),
              request_id: uid(9002),
              model_slug: "gpt-5-4-auto-thinking",
            },
          },
        ]),
  ];
  return parseHistoryText(
    "chatgpt",
    {
      conversation_id: conversation,
      messages,
      current_node: messages.at(-1)!.id,
      page_info: {
        start_cursor: messages[0]!.id,
        end_cursor: messages.at(-1)!.id,
        has_previous_page: false,
        has_next_page: false,
      },
      context_truncation_continuation: null,
    },
    conversation,
    new Date().toISOString(),
  );
}

async function receive(c: Coordinator, page: HistoryTextPage) {
  const binding = {
    documentNonce: crypto.randomUUID(),
    navigationNonce: crypto.randomUUID(),
    captureId: null,
  };
  const common = {
    channel: HISTORY_CAPTURE_CHANNEL as typeof HISTORY_CAPTURE_CHANNEL,
    id: crypto.randomUUID(),
    site: page.site,
    conversationId: page.conversationId,
    observedAt: page.observedAt,
  };
  await c.history.receive(
    { ...common, event: "start", page: null },
    binding,
    sender,
  );
  await c.history.receive({ ...common, event: "page", page }, binding, sender);
}

async function create() {
  const db = await Ledger.open(`image-job-${crypto.randomUUID()}`);
  const displays: any[] = [];
  const c = new Coordinator(db, {
    estimation: archivedEstimation,
    count: countByTextLength,
    hasConsent: async () => true,
    hasSiteConsent: async () => true,
    sendDisplay: async (_tabId, display) => {
      displays.push(display);
    },
    transport: async () => {
      throw new TypeError("synthetic offline");
    },
  });
  await c.whenReady();
  await c.engines.admission();
  const current = await db.estimation.readPreference();
  if (current?.preference !== "ecologits")
    await c.engines.select({
      preference: "ecologits",
      expectedRevision: current?.selection_revision ?? null,
    });
  return { db, c, displays };
}

async function settle(c: Coordinator) {
  for (let i = 0; i < 20; i++) {
    await c.engines.maintainLocal();
    const state = await c.engines.status();
    if (state.local.status === "complete" && state.local.pending === 0) return;
    if (state.local.status === "failed")
      throw new Error(`calculation failed: ${state.reason}`);
  }
  throw new Error("calculation did not converge");
}

/** The live capture as the page ends it: the stream completed, the job still runs. */
async function live(c: Coordinator) {
  const id = crypto.randomUUID(),
    at = new Date().toISOString();
  // The tab's own binding, so the capture is the reply the tab shows.
  const binding = {
    documentNonce: crypto.randomUUID(),
    navigationNonce: crypto.randomUUID(),
    captureId: id,
  };
  const common = {
    channel: "ai-footprint-observation-v1",
    version: 1,
    id,
    site: "chatgpt",
    at,
    failure: null,
    timing: null,
  };
  await c.capture(
    {
      ...common,
      event: "dispatch",
      revision: 1,
      dispatch: parseDispatch(
        "chatgpt",
        new URL("https://chatgpt.com/backend-api/f/conversation"),
        JSON.stringify({
          action: "next",
          conversation_id: conversation,
          parent_message_id: uid(1),
          model: "gpt-5-5",
          messages: [
            {
              id: uid(2),
              author: { role: "user" },
              content: { content_type: "text", parts: ["Draw a circle"] },
            },
          ],
        }),
      ),
      snapshot: initialSnapshot(),
    },
    sender,
    binding,
  );
  const session = new ChatgptSession();
  session.frame({
    event: "delta",
    data: "",
    value: {
      p: "",
      o: "add",
      v: {
        conversation_id: conversation,
        message: {
          id: uid(3),
          author: { role: "assistant" },
          recipient: "all",
          content: { content_type: "thoughts", thoughts: [] },
          status: "in_progress",
          end_turn: false,
          metadata: { async_source: "image-job", parent_id: uid(2) },
        },
      },
    },
  });
  // The stream's served model differs from the one the saved chat names (5 Oct 2026).
  session.frame({
    event: "message",
    data: "",
    value: {
      type: "server_ste_metadata",
      metadata: { model_slug: "gpt-5-6-thinking" },
    },
  });
  session.frame({
    event: "message",
    data: "",
    value: { type: "message_stream_complete" },
  });
  assert.equal(session.awaitingAsync(), true);
  await c.capture(
    {
      ...common,
      event: "end",
      revision: 2,
      dispatch: null,
      snapshot: { ...session.snapshot(), state: "interrupted_unconfirmed" },
    },
    sender,
    binding,
  );
}

/** The figures the tab's bar shows now. */
function shown(displays: any[]) {
  const last = displays.filter((d) => d.target === "footprint-display").at(-1);
  return last
    ? combinedUsage(last.conversation?.server ?? last.summary, last.history)
    : null;
}

test("I4 a live image job whose image arrives in the saved chat counts the image once, on the live reply", async () => {
  const f = await create();
  try {
    await live(f.c);
    await settle(f.c);
    const scope = await f.c.currentScope();
    const attempt = (await f.db.rows(scope.namespace)).find(
      (row) => row.record.kind === "attempt",
    )!.record;
    if (attempt.kind !== "attempt") throw new Error("attempt missing");
    // The live stream showed no image, so the reply has none yet.
    const before = await f.db.estimation.liveInput(scope, attempt.attempt_id);
    assert.equal(before?.history, undefined);
    assert.deepEqual(
      prepareObservation({ ...before!, family: "live" }).media,
      [],
    );
    // While the job runs, the saved chat holds no reply to join.
    await receive(f.c, saved(true));
    await settle(f.c);
    await receive(f.c, saved());
    await settle(f.c);
    const linked = await f.db.estimation.liveInput(scope, attempt.attempt_id);
    assert.ok(linked?.history);
    assert.deepEqual(prepareObservation({ ...linked, family: "live" }).media, [
      {
        kind: "image",
        model_id: null,
        count: "1",
        width: 1254,
        height: 1254,
        outcome: "returned",
      },
    ]);
    // The live reply names only the model that was asked for, so the model the saved
    // chat says answered is the one estimated.
    assert.equal(linked.attempt.model_evidence, "request_field");
    assert.notEqual(linked.history.model_id, linked.attempt.model_id);
    assert.equal(
      prepareObservation({ ...linked, family: "live" }).modelId,
      linked.history.model_id,
    );
    const view = await f.c.routeSummary("chatgpt", conversation);
    // The saved prompt and reply are the live ones: one request, matched, nothing left
    // waiting for a match.
    assert.equal(view.history.local.matched_live_message_count, "2");
    assert.equal(view.history.local.unresolved_overlap_message_count, "0");
    const combined = combinedUsage(view.summary, view.history)!;
    assert.equal(combined.requests, "1");
    // One image: 2.907 Wh of IT energy times a PUE of 1.2 (own calculation); the reply
    // wrote no text.
    assert.ok(combined.energy.value !== null);
    assert.ok(
      Math.abs(Number(combined.energy.value) - 0.0034884) < 1e-9,
      String(combined.energy.value),
    );
    // A later read of the same chat changes nothing.
    await receive(f.c, saved());
    await settle(f.c);
    const again = await f.c.routeSummary("chatgpt", conversation);
    assert.deepEqual(combinedUsage(again.summary, again.history), combined);
  } finally {
    await f.c.settleConversationDisplays();
    f.c.engines.dispose();
    f.db.close();
  }
});

test("I4 the bar shows the image once the page's read of the saved chat brings it, without a reload", async () => {
  const f = await create();
  try {
    await live(f.c);
    await settle(f.c);
    await f.c.settleConversationDisplays();
    // The reply ended with its job still running: nothing saved yet, and no image.
    const first = f.displays
      .filter((d) => d.target === "footprint-display")
      .at(-1);
    assert.equal(first.history.local.status, "empty");
    assert.ok(!(Number(first.summary.metrics.energy.value ?? 0) > 0.003));
    // The page polls the saved chat while the job runs, then once more when it is done.
    await receive(f.c, saved(true));
    await receive(f.c, saved());
    for (let pass = 0; pass < 3; pass++) {
      await f.c.settleConversationDisplays();
      await settle(f.c);
    }
    await f.c.settleConversationDisplays();
    const bar = shown(f.displays)!;
    assert.equal(bar.requests, "1");
    assert.ok(
      Math.abs(Number(bar.energy.value) - 0.0034884) < 1e-9,
      String(bar.energy.value),
    );
  } finally {
    await f.c.settleConversationDisplays();
    f.c.engines.dispose();
    f.db.close();
  }
});
