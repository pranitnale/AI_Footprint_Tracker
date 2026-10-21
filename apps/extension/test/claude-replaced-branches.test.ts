import { archivedEstimation } from "./archived-engine-fixture";
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { Ledger } from "@footprint/ledger";
import {
  ClaudeSession,
  initialSnapshot,
  parseHistoryText,
  type ClaudeHistoryRow,
} from "@footprint/adapters";
import { Coordinator } from "../lib/coordinator";
import { HISTORY_CAPTURE_CHANNEL } from "../lib/history-capture";
import { CLAUDE_STREAM_CHANNEL } from "../lib/claude-history-message";
import { ClaudeHistoryStream } from "../lib/claude-history-stream";
import { combinedUsage } from "../lib/history-presentation";
import { countByTextLength } from "./counting-fixture";
import { claudeTokenCount } from "@footprint/contracts";
import { PACKAGED_CLAUDE_TOKEN_FACTOR } from "../lib/claude-token-factor";

/** Out of saved Claude replies: each reply's count times the Claude token factor, rounded on its own. */
const claudeOut = (...counts: number[]) =>
  String(
    counts.reduce(
      (sum, n) => sum + Number(claudeTokenCount(String(n), PACKAGED_CLAUDE_TOKEN_FACTOR)),
      0,
    ),
  );
const EDITED_OUT = claudeOut(4, 6, ...Array(9).fill(1));

// Req counts every request in a chat, including those on branches an edit or a regeneration
// replaced (owner rule of 26 Sep 2026). claude.ai's `tree=True` read holds every branch, so
// each saved message is imported once, whatever branch it is on (14 Oct 2026).

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const conversation = uuid(950);
const ROOT = uuid(0);
const sender = {
  tab: { id: 82 },
  frameId: 0,
  documentId: "synthetic-branches",
  url: `https://claude.ai/chat/${conversation}`,
};

type Row = {
  id: number;
  human: boolean;
  parent: number | null;
  index: number;
  text: string;
  truncated?: boolean;
};

function chat(rows: Row[], leaf: number) {
  return {
    uuid: conversation,
    model: "claude-opus-4-8",
    current_leaf_message_uuid: uuid(leaf),
    chat_messages: rows.map((row) => ({
      uuid: uuid(row.id),
      sender: row.human ? "human" : "assistant",
      index: row.index,
      parent_message_uuid: row.parent === null ? ROOT : uuid(row.parent),
      truncated: row.truncated ?? false,
      created_at: `2020-01-01T12:${String(row.index).padStart(2, "0")}:00.000000Z`,
      stop_reason: row.human ? null : "end_turn",
      content: [{ type: "text", text: row.text }],
    })),
  };
}

/**
 * The live example of 14 Oct 2026: the first prompt was edited, so the original prompt and
 * reply (index 0 and 1) sit on a replaced branch, and the selected branch holds ten prompts.
 */
/** One prompt answered, then regenerated (a `retry_completion` of the same prompt). */
function regenerated() {
  return chat(
    [
      { id: 1, human: true, parent: null, index: 0, text: "query" },
      { id: 2, human: false, parent: 1, index: 1, text: "first" },
      { id: 3, human: false, parent: 1, index: 2, text: "regenerated" },
    ],
    3,
  );
}

function editedFirstPrompt() {
  const rows: Row[] = [
    { id: 1, human: true, parent: null, index: 0, text: "query" },
    { id: 2, human: false, parent: 1, index: 1, text: "aaaa" },
    { id: 3, human: true, parent: null, index: 2, text: "query" },
    { id: 4, human: false, parent: 3, index: 3, text: "bbbbbb" },
  ];
  for (let turn = 1; turn < 10; turn++) {
    const prompt = 3 + turn * 2;
    rows.push(
      { id: prompt, human: true, parent: prompt - 1, index: prompt - 1, text: "query" },
      { id: prompt + 1, human: false, parent: prompt, index: prompt, text: "c" },
    );
  }
  return chat(rows, 22);
}

async function create() {
  const db = await Ledger.open(`claude-branches-${crypto.randomUUID()}`);
  const c = new Coordinator(db, {
    estimation: archivedEstimation,
    count: countByTextLength,
    hasConsent: async () => true,
    hasSiteConsent: async () => true,
    sendDisplay: async () => {},
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
  return { db, c };
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

const binding = () => ({
  documentNonce: crypto.randomUUID(),
  navigationNonce: crypto.randomUUID(),
  captureId: null,
});

/** The whole-body reader (`claudeHistory`). */
async function receivePage(c: Coordinator, body: unknown) {
  const observedAt = new Date().toISOString();
  const page = parseHistoryText("claude", body, conversation, observedAt);
  const common = {
    channel: HISTORY_CAPTURE_CHANNEL,
    id: crypto.randomUUID(),
    site: "claude",
    conversationId: conversation,
    observedAt,
  } as const;
  const bound = binding();
  assert.deepEqual(
    await c.history.receive({ ...common, event: "start", page: null }, bound, sender),
    { accepted: true },
  );
  assert.deepEqual(
    await c.history.receive({ ...common, event: "page", page }, bound, sender),
    { accepted: true },
  );
}

/** The streamed reader the page's own reads use (`ClaudeHistoryStream`). */
async function receiveStream(c: Coordinator, body: unknown) {
  const observedAt = new Date().toISOString();
  const common = {
    id: crypto.randomUUID(),
    site: "claude" as const,
    conversationId: conversation,
    observedAt,
  };
  const bound = binding();
  assert.deepEqual(
    await c.history.receive(
      { ...common, channel: HISTORY_CAPTURE_CHANNEL, event: "start", page: null },
      bound,
      sender,
    ),
    { accepted: true },
  );
  const batches: ClaudeHistoryRow[][] = [];
  const stream = new ClaudeHistoryStream(async (rows) => {
    batches.push(rows);
  });
  await stream.write(new TextEncoder().encode(JSON.stringify(body)));
  const end = await stream.finish(conversation);
  for (const rows of batches)
    assert.deepEqual(
      await c.history.receiveStream(
        {
          ...common,
          channel: CLAUDE_STREAM_CHANNEL,
          event: "batch",
          rows,
          leafId: null,
          rowCount: null,
          model: null,
        } as any,
        bound,
        sender,
      ),
      { accepted: true },
    );
  assert.deepEqual(
    await c.history.receiveStream(
      {
        ...common,
        channel: CLAUDE_STREAM_CHANNEL,
        event: "finish",
        rows: null,
        ...end,
      } as any,
      bound,
      sender,
    ),
    { accepted: true },
  );
}

async function view(c: Coordinator) {
  await settle(c);
  const route = await c.routeSummary("claude", conversation);
  return { route, combined: combinedUsage(route.summary, route.history)! };
}

for (const [reader, receive] of [
  ["whole read", receivePage],
  ["streamed read", receiveStream],
] as const) {
  test(`claude replaced branches (${reader}): an edited first prompt counts Req 11 with both replies' output`, async () => {
    const f = await create();
    try {
      await receive(f.c, editedFirstPrompt());
      const { route, combined } = await view(f.c);
      assert.equal(route.history.local.prompt_count, "11");
      assert.equal(route.history.local.response_count, "11");
      assert.match(combined.requests, /^(≈ )?11$/);
      // 4 + 6 + 9 × 1 characters of replies, one token each in this counting fixture, each
      // reply times 1.56 (6 + 9 + 9 × 2 = 33).
      assert.equal(combined.output.value, EDITED_OUT);
      // The selected branch still proves the first request and names the selected leaf.
      assert.equal(route.history.local.first_request_verified, true);
      assert.equal(route.history.local.branch_scope, "loaded_messages");
      const scope = await f.c.currentScope();
      const rows = await f.db.historyPage(scope, undefined);
      assert.equal(rows.length, 22, "each message once");
      const coverage = await f.c.ledger.historyCoverage(scope, rows[0]!.record.conversation_key);
      const leaf = rows.find(
        (row) => row.record.message_key === coverage!.page.selected_leaf_key,
      )!;
      assert.equal(leaf.record.role, "response");
      assert.equal(leaf.record.occurred_at, "2020-01-01T12:21:00.000000Z");
      // The replaced reply is linked to its own prompt.
      const original = rows.find((row) => row.record.occurred_at === "2020-01-01T12:01:00.000000Z")!;
      const originalPrompt = rows.find((row) => row.record.occurred_at === "2020-01-01T12:00:00.000000Z")!;
      assert.equal(original.record.parent_key, originalPrompt.record.message_key);
      assert.equal(original.record.prompt_key, originalPrompt.record.message_key);
      // Reading the chat again counts nothing twice.
      await receive(f.c, editedFirstPrompt());
      const again = await view(f.c);
      assert.equal(again.route.history.local.prompt_count, "11");
      assert.equal(again.combined.output.value, EDITED_OUT);
    } finally {
      await f.c.settleConversationDisplays();
      f.c.engines.dispose();
      f.db.close();
    }
  });

  test(`claude replaced branches (${reader}): a regenerated reply counts one more Req and both replies' output`, async () => {
    const f = await create();
    try {
      await receive(f.c, regenerated());
      const { route, combined } = await view(f.c);
      // Req counts requests: the prompt's send and the retry that regenerated its reply.
      assert.equal(route.history.local.prompt_count, "2");
      assert.equal(route.history.local.observed_prompt_count, "1");
      assert.equal(route.history.local.response_count, "2");
      assert.match(combined.requests, /^(≈ )?2$/);
      assert.equal(combined.output.value, claudeOut("first".length, "regenerated".length));
      assert.equal(route.history.local.first_request_verified, true);
      // Reading the chat again counts nothing twice.
      await receive(f.c, regenerated());
      const again = await view(f.c);
      assert.equal(again.route.history.local.prompt_count, "2");
      assert.match(again.combined.requests, /^(≈ )?2$/);
    } finally {
      await f.c.settleConversationDisplays();
      f.c.engines.dispose();
      f.db.close();
    }
  });

  test(`claude replaced branches (${reader}): the first-request proof follows the selected branch only`, async () => {
    const f = await create();
    try {
      // A truncated message on a replaced branch leaves the proof alone.
      const replaced = editedFirstPrompt();
      replaced.chat_messages[1]!.truncated = true;
      await receive(f.c, replaced);
      assert.equal((await view(f.c)).route.history.local.first_request_verified, true);
    } finally {
      await f.c.settleConversationDisplays();
      f.c.engines.dispose();
      f.db.close();
    }
    const g = await create();
    try {
      // One on the selected branch leaves the start unproven, as before.
      const selected = editedFirstPrompt();
      selected.chat_messages[3]!.truncated = true;
      await receive(g.c, selected);
      const { route } = await view(g.c);
      assert.equal(route.history.local.first_request_verified, false);
      assert.equal(route.history.local.prompt_count, "11");
    } finally {
      await g.c.settleConversationDisplays();
      g.c.engines.dispose();
      g.db.close();
    }
  });
}

/** A live capture of the original first reply, before the prompt was edited. */
async function liveOriginalReply(c: Coordinator) {
  await liveReply(c, { action: "send", parent: ROOT, reply: 2, prompt: 1, text: "aaaa" });
}

/**
 * A live Claude reply: a send (`completion`) or a regeneration (`retry_completion`, whose
 * dispatch the page world names "regenerate"). The stream names the saved reply's uuid.
 */
async function liveReply(
  c: Coordinator,
  reply: {
    action: "send" | "regenerate";
    parent: string;
    reply: number;
    prompt: number;
    text: string;
  },
) {
  const id = crypto.randomUUID(),
    at = new Date().toISOString();
  const common = {
    channel: "ai-footprint-observation-v1",
    version: 1,
    id,
    site: "claude",
    at,
    failure: null,
  };
  await c.capture(
    {
      ...common,
      event: "dispatch",
      revision: 1,
      timing: null,
      dispatch: {
        site: "claude",
        action: reply.action,
        input: reply.action === "send" ? "query" : null,
        conversationId: conversation,
        parentId: reply.parent,
        requestId: uuid(700 + reply.reply),
        model: "claude-opus-4-8",
        attachments: null,
        imageEditParentId: null,
      },
      snapshot: initialSnapshot(),
    },
    sender,
  );
  const session = new ClaudeSession();
  const frame = (value: unknown) =>
    session.frame({ value } as Parameters<ClaudeSession["frame"]>[0]);
  frame({
    type: "message_start",
    message: {
      id: `msg_live_${reply.reply}`,
      uuid: uuid(reply.reply),
      parent_uuid: uuid(reply.prompt),
      model: "claude-opus-4-8",
    },
  });
  frame({
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: reply.text },
  });
  frame({ type: "message_delta", delta: { stop_reason: "end_turn" } });
  frame({ type: "message_stop" });
  await c.capture(
    {
      ...common,
      event: "end",
      revision: 2,
      dispatch: null,
      snapshot: session.snapshot(),
      timing: {
        duration_seconds: "5",
        source: "browser_request",
        scope: "request",
        completeness: "complete_for_scope",
        profile_version: "timing-observation-1",
      },
    },
    sender,
  );
}

test("claude replaced branches: a reply recorded live and later seen on a replaced branch counts once", async () => {
  const f = await create();
  try {
    await liveOriginalReply(f.c);
    await receiveStream(f.c, editedFirstPrompt());
    const { route, combined } = await view(f.c);
    assert.match(combined.requests, /^(≈ )?11$/);
    assert.equal(combined.output.value, EDITED_OUT);
    assert.equal(route.history.local.matched_live_message_count, "2");
  } finally {
    await f.c.settleConversationDisplays();
    f.c.engines.dispose();
    f.db.close();
  }
});

for (const [reader, receive] of [
  ["whole read", receivePage],
  ["streamed read", receiveStream],
] as const) {
  test(`claude replaced branches (${reader}): a regeneration recorded live and saved counts once`, async () => {
    // Only the regeneration was recorded live: the live retry is its request, and the saved
    // prompt stands for the original send.
    const f = await create();
    try {
      await liveReply(f.c, {
        action: "regenerate",
        parent: uuid(1),
        reply: 3,
        prompt: 1,
        text: "regenerated",
      });
      await receive(f.c, regenerated());
      const { route, combined } = await view(f.c);
      assert.match(combined.requests, /^(≈ )?2$/);
      assert.equal(combined.output.value, claudeOut("first".length, "regenerated".length));
      assert.equal(route.history.local.matched_live_message_count, "1");
      assert.equal(route.history.local.prompt_count, "1");
    } finally {
      await f.c.settleConversationDisplays();
      f.c.engines.dispose();
      f.db.close();
    }
    // Both the send and the regeneration were recorded live: history adds no request.
    const g = await create();
    try {
      await liveReply(g.c, { action: "send", parent: ROOT, reply: 2, prompt: 1, text: "first" });
      await liveReply(g.c, {
        action: "regenerate",
        parent: uuid(1),
        reply: 3,
        prompt: 1,
        text: "regenerated",
      });
      await receive(g.c, regenerated());
      const { route, combined } = await view(g.c);
      assert.equal(combined.requests, "2");
      assert.equal(combined.output.value, claudeOut("first".length, "regenerated".length));
      assert.equal(route.history.local.matched_live_message_count, "3");
      assert.equal(route.history.local.prompt_count, "0");
    } finally {
      await g.c.settleConversationDisplays();
      g.c.engines.dispose();
      g.db.close();
    }
  });
}
