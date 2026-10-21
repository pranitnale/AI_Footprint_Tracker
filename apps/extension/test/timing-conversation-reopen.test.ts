import { archivedEstimation } from "./archived-engine-fixture";
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { Ledger } from "@footprint/ledger";
import {
  ClaudeSession,
  parseHistoryText,
  initialSnapshot,
  type HistoryTextPage,
} from "@footprint/adapters";
import { prepareObservation } from "@footprint/estimator";
import { Coordinator } from "../lib/coordinator";
import { HISTORY_CAPTURE_CHANNEL } from "../lib/history-capture";
import { combinedUsage } from "../lib/history-presentation";
import { countByTextLength } from "./counting-fixture";
import { SummaryAccumulator } from "../lib/summary-scan";
import { transitionOwnership, type OwnershipHistory } from "../lib/ownership";
import { HistorySummarySchema, claudeTokenCount } from "@footprint/contracts";
import { PACKAGED_CLAUDE_TOKEN_FACTOR } from "../lib/claude-token-factor";

/**
 * Figures of this Claude chat: every prompt ("query") and reply ("hello") is 5 counted
 * tokens, each times the Claude token factor and rounded on its own (8), then added.
 */
const claudeTokens = (messages: number) =>
  String(messages * Number(claudeTokenCount("5", PACKAGED_CLAUDE_TOKEN_FACTOR)));

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const conversation = uuid(900),
  root = uuid(0);
const sender = {
  tab: { id: 81 },
  frameId: 0,
  documentId: "synthetic-timing",
  url: `https://claude.ai/chat/${conversation}`,
};
function history(pairCount: number, finalText = "hello"): HistoryTextPage {
  const chat_messages = [];
  for (let index = 0; index < pairCount * 2; index++) {
    const assistant = index % 2 === 1;
    chat_messages.push({
      uuid: uuid(index + 1),
      sender: assistant ? "assistant" : "human",
      index,
      parent_message_uuid: index === 0 ? root : uuid(index),
      truncated: false,
      created_at: "2020-01-01T12:00:00.000000Z",
      stop_reason: assistant ? "end_turn" : null,
      content: [
        {
          type: "text",
          text: assistant ? (index === 21 ? finalText : "older") : "query",
          ...(assistant
            ? {
                start_timestamp: "2020-01-01T12:00:01.000000Z",
                stop_timestamp: "2020-01-01T12:00:04.000000Z",
              }
            : {}),
        },
      ],
    });
  }
  return parseHistoryText(
    "claude",
    {
      uuid: conversation,
      current_leaf_message_uuid: uuid(pairCount * 2),
      chat_messages,
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
async function create(name: string, onDisplay?: (display: any) => void) {
  const db = await Ledger.open(name);
  const displays: any[] = [];
  const c = new Coordinator(db, {
    estimation: archivedEstimation,
    count: countByTextLength,
    hasConsent: async () => true,
    hasSiteConsent: async () => true,
    sendDisplay: async (_tabId, display) => {
      displays.push(display);
      onDisplay?.(display);
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
async function live(c: Coordinator, complete = true) {
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
        action: "send",
        input: "query",
        conversationId: conversation,
        parentId: uuid(20),
        requestId: uuid(700),
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
      id: "msg_live_only_identity",
      uuid: uuid(22),
      parent_uuid: uuid(21),
      model: "claude-opus-4-8",
    },
  });
  frame({
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: complete ? "hello" : "he" },
  });
  if (complete) {
    frame({ type: "message_delta", delta: { stop_reason: "end_turn" } });
    frame({ type: "message_stop" });
  }
  const snapshot = session.snapshot();
  await c.capture(
    {
      ...common,
      event: "end",
      revision: 2,
      dispatch: null,
      snapshot: complete
        ? snapshot
        : { ...snapshot, state: "interrupted_unconfirmed" },
      timing: complete
        ? {
            duration_seconds: "5",
            source: "browser_request",
            scope: "request",
            completeness: "complete_for_scope",
            profile_version: "timing-observation-1",
          }
        : null,
    },
    sender,
  );
}

for (const order of ["live-first", "history-first"] as const) {
  test(`ten old requests plus one live request stay eleven after reload and restart (${order})`, async () => {
    const name = `timing-reopen-${crypto.randomUUID()}`;
    let f = await create(name);
    try {
      await receive(f.c, history(10));
      if (order === "history-first") await receive(f.c, history(11));
      await live(f.c);
      await receive(f.c, history(11));
      await settle(f.c);
      const first = await f.c.routeSummary("claude", conversation);
      const combined = combinedUsage(first.summary, first.history)!;
      assert.equal(combined.requests, "≈ 11");
      assert.equal(combined.output.value, claudeTokens(11));
      assert.equal(first.history.local.matched_live_message_count, "2");
      const scope = await f.c.currentScope();
      const rows = await f.db.rows(scope.namespace);
      const attempt = rows.find((row) => row.record.kind === "attempt")!.record;
      if (attempt.kind !== "attempt") throw new Error("attempt missing");
      const linked = await f.db.estimation.liveInput(scope, attempt.attempt_id);
      assert.ok(linked?.history);
      assert.equal(
        prepareObservation({ ...linked, family: "live" }).timing
          ?.duration_seconds,
        "5",
      );
      await receive(f.c, history(11));
      await settle(f.c);
      const again = await f.c.routeSummary("claude", conversation);
      assert.deepEqual(combinedUsage(again.summary, again.history), combined);
      await f.c.settleConversationDisplays();
      f.c.engines.dispose();
      f.db.close();
      f = await create(name);
      await receive(f.c, history(11));
      await settle(f.c);
      const reopened = await f.c.routeSummary("claude", conversation);
      assert.deepEqual(
        combinedUsage(reopened.summary, reopened.history),
        combined,
      );
      const persisted = await f.db.estimation.liveInput(
        await f.c.currentScope(),
        attempt.attempt_id,
      );
      assert.equal(persisted?.attempt.timing?.duration_seconds, "5");
    } finally {
      await f.c.settleConversationDisplays();
      f.c.engines.dispose();
      f.db.close();
    }
  });
}

test("disputed historical timing keeps both responses and their tokens after repeated imports", async () => {
  const f = await create(`timing-conflict-${crypto.randomUUID()}`);
  try {
    await receive(f.c, history(2));
    await settle(f.c);
    const first = await f.c.routeSummary("claude", conversation);
    assert.equal(
      combinedUsage(first.summary, first.history)?.output.value,
      claudeTokens(2),
    );
    const changed = history(2);
    assert.ok(changed.messages[1].timing);
    changed.messages[1].timing.duration_seconds = "4";
    await receive(f.c, changed);
    await settle(f.c);
    const scope = await f.c.currentScope();
    const responses = (
      await f.db.application.historyPage(scope, undefined)
    ).filter((row) => row.record.role === "response");
    assert.equal(responses.length, 2);
    assert.ok(responses.every((row) => row.status !== "conflict"));
    const disputed = responses.find((row) =>
      row.record.coverage_reasons.includes("historical_timing_conflict"),
    );
    assert.ok(disputed);
    assert.equal(disputed.record.timing, null);
    assert.equal(disputed.original.timing?.duration_seconds, "3");
    assert.equal(
      prepareObservation({ family: "history", record: disputed.record }).timing,
      null,
    );
    for (const page of [history(2), changed]) {
      await receive(f.c, page);
      await settle(f.c);
      const view = await f.c.routeSummary("claude", conversation);
      const combined = combinedUsage(view.summary, view.history)!;
      assert.equal(combined.requests, "2");
      assert.equal(combined.output.value, claudeTokens(2));
      assert.equal(view.history.local.response_count, "2");
      const retained = await f.db.application.findHistoryMessage(
        scope,
        disputed.record.message_key,
      );
      assert.equal(retained?.record.timing, null);
      assert.ok(
        retained?.record.coverage_reasons.includes(
          "historical_timing_conflict",
        ),
      );
    }
  } finally {
    await f.c.settleConversationDisplays();
    f.c.engines.dispose();
    f.db.close();
  }
});

test("partial live output is filled from the matching historical answer without another contribution", async () => {
  const f = await create(`timing-partial-${crypto.randomUUID()}`);
  try {
    await receive(f.c, history(10));
    await live(f.c, false);
    await receive(f.c, history(11));
    await settle(f.c);
    const view = await f.c.routeSummary("claude", conversation),
      combined = combinedUsage(view.summary, view.history)!;
    assert.equal(combined.requests, "≈ 11");
    assert.equal(combined.output.value, claudeTokens(11));
    const scope = await f.c.currentScope();
    const rows = await f.db.rows(scope.namespace);
    const attempt = rows.find((row) => row.record.kind === "attempt")!.record;
    if (attempt.kind !== "attempt") throw new Error("attempt missing");
    assert.equal(attempt.tokens.answer_output.value, "2");
    const linked = await f.db.estimation.liveInput(scope, attempt.attempt_id);
    assert.ok(linked?.history);
    const selected = prepareObservation({ ...linked, family: "live" });
    assert.equal(selected.output.value, "5");
    assert.equal(selected.timing?.duration_seconds, "3");
    assert.equal(selected.timing?.source, "claude_history");
    const withoutLiveProof = {
      ...linked.attempt,
      execution_evidence: "none" as const,
    };
    assert.equal(
      prepareObservation({
        ...linked,
        attempt: withoutLiveProof,
        family: "live",
      }).ineligibleReason,
      null,
    );
    const totals = new SummaryAccumulator({ calculationView: "recalculated" });
    totals.attempt(
      withoutLiveProof,
      linked.request,
      undefined,
      undefined,
      linked.history,
    );
    assert.equal(totals.result().attempts, 1);
    const original = await f.c.engines.executor.estimate(
      { ...linked, family: "live" },
      { methodId: f.c.engines.methods.original.method_id },
    );
    const explicit = await f.c.dashboard({
      calculationView: "recalculated",
      methodId: f.c.engines.methods.original.method_id,
    });
    assert.equal(
      explicit.summary.metrics.energy.value,
      original.metrics.energy.value,
    );
  } finally {
    await f.c.settleConversationDisplays();
    f.c.engines.dispose();
    f.db.close();
  }
});

test("a completed duplicate capture survives both request and attempt aliases before reopening", async () => {
  const f = await create(`timing-double-alias-${crypto.randomUUID()}`);
  try {
    await receive(f.c, history(10));
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    const at = new Date().toISOString();
    const common = {
      channel: "ai-footprint-observation-v1",
      version: 1,
      site: "claude",
      at,
      failure: null,
      timing: null,
    };
    for (const id of ids) {
      await f.c.capture(
        {
          ...common,
          id,
          event: "dispatch",
          revision: 1,
          dispatch: {
            site: "claude",
            action: "send",
            input: "query",
            conversationId: conversation,
            parentId: uuid(20),
            requestId: uuid(700),
            model: "claude-opus-4-8",
            attachments: null,
            imageEditParentId: null,
          },
          snapshot: initialSnapshot(),
        },
        sender,
      );
      await f.c.capture(
        {
          ...common,
          id,
          event: "progress",
          revision: 2,
          dispatch: null,
          snapshot: {
            ...initialSnapshot(),
            started: true,
            outputId: uuid(22),
            text: "he",
          },
        },
        sender,
      );
    }
    const scope = await f.c.currentScope();
    const before = await f.db.rows(scope.namespace);
    assert.ok(
      before.some((row) => row.record.kind === "request" && row.aliasOf),
    );
    assert.ok(
      before.some((row) => row.record.kind === "attempt" && row.aliasOf),
    );
    await f.c.capture(
      {
        ...common,
        id: ids[1],
        event: "end",
        revision: 3,
        dispatch: null,
        snapshot: {
          ...initialSnapshot(),
          started: true,
          outputId: uuid(22),
          text: "hello",
          state: "completed",
        },
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
    await receive(f.c, history(11));
    await settle(f.c);
    const view = await f.c.routeSummary("claude", conversation),
      combined = combinedUsage(view.summary, view.history)!;
    assert.equal(combined.requests, "≈ 11");
    assert.equal(combined.output.value, claudeTokens(11));
    const rows = await f.db.rows(scope.namespace);
    const current = rows.find(
      (row) => row.record.kind === "attempt" && !row.aliasOf,
    )!.record;
    if (current.kind !== "attempt") throw new Error("attempt missing");
    assert.equal(current.state, "completed");
    assert.equal(current.timing?.duration_seconds, "5");
    const linked = await f.db.estimation.liveInput(scope, current.attempt_id);
    assert.ok(linked?.originalMethodHash);
    assert.equal(linked?.originalMethodState, "recorded");
  } finally {
    await f.c.settleConversationDisplays();
    f.c.engines.dispose();
    f.db.close();
  }
});

for (const engine of ["ecologits", "original"] as const)
  test(`completed capture publishes saved history without another provider history response (${engine})`, async () => {
    const f = await create(`timing-published-history-${crypto.randomUUID()}`);
    try {
      if (engine === "original") {
        const preference = await f.db.estimation.readPreference();
        await f.c.engines.select({
          preference: engine,
          expectedRevision: preference!.selection_revision,
        });
      }
      await receive(f.c, history(10));
      await settle(f.c);
      const originalRows = await f.db.application.historyPage(
        await f.c.currentScope(),
        undefined,
      );
      const originals = originalRows.map((row) => ({
        record: row.original,
        estimate: row.originalEstimate,
      }));
      await live(f.c);
      await settle(f.c);
      await f.c.settleConversationDisplays();
      const display = f.displays.findLast(
        (value) => value.state === "completed",
      );
      assert.ok(display, "completed capture must publish a display");
      assert.ok(
        display.history,
        "live publication must include the saved history snapshot",
      );
      const combined = combinedUsage(display.summary, display.history)!;
      assert.equal(combined.requests, "\u2248 11");
      assert.equal(combined.input.value, claudeTokens(11));
      assert.equal(combined.output.value, claudeTokens(11));
      const routed = await f.c.routeSummary("claude", conversation);
      assert.deepEqual(combined, combinedUsage(routed.summary, routed.history));
      assert.deepEqual(
        (
          await f.db.application.historyPage(
            await f.c.currentScope(),
            undefined,
          )
        ).map((row) => ({
          record: row.original,
          estimate: row.originalEstimate,
        })),
        originals,
      );
    } finally {
      await f.c.settleConversationDisplays();
      f.c.engines.dispose();
      f.db.close();
    }
  });

async function connectCompany(f: Awaited<ReturnType<typeof create>>) {
  const namespace = `company:${crypto.randomUUID()}:${crypto.randomUUID()}`;
  const scope = {
    namespace,
    mode: "company" as const,
    era: crypto.randomUUID(),
  };
  const ownership = (await f.db.get<OwnershipHistory>(
    "policy",
    "ownership-history",
  ))!;
  await f.db.policyTransaction([
    {
      key: "credentials",
      namespace,
      origin: "https://company.example",
      company_id: namespace.split(":")[1],
      user_id: namespace.split(":")[2],
      device_id: crypto.randomUUID(),
      access_token: "synthetic-access",
      refresh_token: "synthetic-refresh",
      user_hmac_key: "b".repeat(64),
      access_expires_at: new Date(Date.now() + 600000).toISOString(),
      enrollment_era: {
        id: scope.era,
        start: new Date().toISOString(),
        end: null,
      },
      policy: {
        policy_version: "1.0.0",
        pause_mode: "user_controlled",
        deletion_epoch: 0,
        timezone: "UTC",
      },
    },
    transitionOwnership(ownership, {
      scope,
      secret: "b".repeat(64),
      policyVersion: "1.0.0",
    }) as any,
  ]);
  return scope;
}

test("capture publishes coherent local company history while a server history view is blocked", async () => {
  let displayReady!: (display: any) => void;
  const displayed = new Promise<any>((resolve) => {
    displayReady = resolve;
  });
  const f = await create(
    `timing-company-history-${crypto.randomUUID()}`,
    (display) => {
      if (display.state === "completed") displayReady(display);
    },
  );
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const fetching = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const request = f.c.company.threadRequest.bind(f.c.company);
  let remote: Promise<unknown> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const scope = await connectCompany(f);
    await receive(f.c, history(1));
    await settle(f.c);
    const key = (await f.db.application.historyPage(scope, undefined))[0]!
      .record.conversation_key;
    f.c.company.threadRequest = async (...args) => {
      if (
        String(args[1]).includes("/history/") &&
        String(args[1]).includes("/summary")
      ) {
        entered();
        await blocked;
        throw new TypeError("synthetic server unavailable");
      }
      return request(...args);
    };
    remote = f.c.history.view(scope, key).catch(() => undefined);
    await fetching;
    await live(f.c);
    await settle(f.c);
    const display = await Promise.race([
      displayed,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("capture waited for organization history")),
          2000,
        );
      }),
    ]);
    assert.equal(display.mode, "company");
    assert.equal(display.conversation.source, "local");
    assert.equal(display.conversation.server, null);
    assert.equal(display.history.server, null);
    assert.equal(display.history.server_status, "unavailable");
    assert.equal(
      combinedUsage(display.summary, display.history)?.requests,
      "\u2248 2",
    );
  } finally {
    if (timeout) clearTimeout(timeout);
    release();
    await remote;
    f.c.company.threadRequest = request;
    await f.c.settleConversationDisplays();
    f.c.engines.dispose();
    f.db.close();
  }
});

test("erasure during local history publication cannot send the pre-erasure history", async () => {
  const f = await create(`timing-publication-erasure-${crypto.randomUUID()}`);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const reading = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const localView = f.c.history.localView.bind(f.c.history);
  let capture: Promise<void> | undefined;
  try {
    await receive(f.c, history(1));
    await settle(f.c);
    f.c.history.localView = async (...args) => {
      const view = await localView(...args);
      entered();
      await blocked;
      return view;
    };
    capture = live(f.c).catch(() => undefined);
    await reading;
    await f.db.eraseNamespace((await f.c.currentScope()).namespace);
    release();
    await capture;
    await f.c.settleConversationDisplays();
    assert.equal(
      f.displays.some(
        (display) => display.history?.local.observed_prompt_count === "1",
      ),
      false,
    );
  } finally {
    release();
    await capture;
    f.c.history.localView = localView;
    await f.c.settleConversationDisplays();
    f.c.engines.dispose();
    f.db.close();
  }
});

test("capture with no imported history retains its live-only totals", async () => {
  const f = await create(`timing-empty-history-${crypto.randomUUID()}`);
  try {
    await live(f.c);
    await settle(f.c);
    await f.c.settleConversationDisplays();
    const display = f.displays.findLast((value) => value.state === "completed");
    assert.equal(display.summary.requests, 1);
    assert.equal(display.summary.tokens.answer.value, claudeTokens(1));
    assert.equal(display.history.local.status, "empty");
    assert.equal(combinedUsage(display.summary, display.history), null);
  } finally {
    await f.c.settleConversationDisplays();
    f.c.engines.dispose();
    f.db.close();
  }
});

for (const change of ["engine", "routing"] as const)
  test(`${change} change during history publication discards the earlier snapshot`, async () => {
    const f = await create(
      `timing-publication-${change}-${crypto.randomUUID()}`,
    );
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const localView = f.c.history.localView.bind(f.c.history);
    let capture: Promise<void> | undefined;
    let stale: Awaited<ReturnType<typeof localView>> | undefined;
    try {
      await receive(f.c, history(1));
      await settle(f.c);
      f.c.history.localView = async (...args) => {
        const view = await localView(...args);
        if (!stale) {
          stale = view;
          entered();
          await blocked;
        }
        return view;
      };
      capture = live(f.c).catch(() => undefined);
      await reading;
      if (change === "engine") {
        const preference = await f.db.estimation.readPreference();
        await f.c.engines.select({
          preference: "original",
          expectedRevision: preference!.selection_revision,
        });
      } else await connectCompany(f);
      release();
      await capture;
      await f.c.settleConversationDisplays();
      assert.ok(stale);
      assert.equal(
        f.displays.some((display) => display.history === stale),
        false,
      );
      if (change === "routing")
        assert.equal(
          f.displays.some(
            (display) => display.history?.local.observed_prompt_count === "1",
          ),
          false,
        );
    } finally {
      release();
      await capture;
      f.c.history.localView = localView;
      await f.c.settleConversationDisplays();
      f.c.engines.dispose();
      f.db.close();
    }
  });

for (const localHistoryCount of [0, 1])
  for (const historyStatus of [
    "available",
    "empty",
    "unavailable",
    "missing",
  ] as const)
    for (const change of historyStatus === "available"
      ? (["none", "engine", "erasure", "routing"] as const)
      : (["none"] as const))
      test(`paired server publication: ${localHistoryCount} local historical requests, ${historyStatus} server history, late ${change} change`, async () => {
        const f = await create(
          `timing-paired-server-${change}-${crypto.randomUUID()}`,
        );
        let release!: () => void;
        const blocked = new Promise<void>((resolve) => {
          release = resolve;
        });
        let entered!: () => void;
        const fetching = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const authorized = f.c.company.authorized.bind(f.c.company);
        const request = f.c.company.threadRequest.bind(f.c.company);
        const sync = f.c.company.sync.bind(f.c.company);
        const historyView = f.c.history.view.bind(f.c.history);
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          const scope = await connectCompany(f);
          if (localHistoryCount) await receive(f.c, history(localHistoryCount));
          await settle(f.c);
          const local = await f.c.history.localView(scope, undefined, {
            calculationView: "original",
          });
          const serverCount = historyStatus === "empty" ? "0" : "3";
          const messageCount = historyStatus === "empty" ? "0" : "6";
          const serverHistory = HistorySummarySchema.parse({
            ...local.local,
            status: historyStatus === "missing" ? "unavailable" : historyStatus,
            observed_prompt_count: serverCount,
            observed_response_count: serverCount,
            prompt_count: serverCount,
            response_count: serverCount,
            dated_message_count: messageCount,
            undated_message_count: "0",
            calculated_message_count: "0",
            uncalculated_message_count: messageCount,
            matched_live_message_count: "0",
            unresolved_overlap_message_count: messageCount,
            conflicting_message_count: "0",
            tokens: [],
            resources: [],
          });
          f.c.company.authorized = async (...args) => {
            if (
              String(args[0]).includes("/conversations/") &&
              String(args[0]).includes("/summary")
            ) {
              const params = new URL(String(args[0]), "https://company.example")
                .searchParams;
              const methodId = params.get("method_id");
              return {
                aggregate_status: "current",
                request_count: "9",
                attempt_count: "9",
                tokens: [],
                resources: [],
                ...(historyStatus === "missing"
                  ? {}
                  : { history: serverHistory }),
                calculation_view: params.get("calculation_view") ?? "original",
                ...(methodId
                  ? {
                      method_id: methodId,
                      method_hash:
                        f.c.engines.methods.get(methodId)!.method_hash,
                      recalculation_job_id: "a".repeat(64),
                    }
                  : {}),
              };
            }
            return authorized(...args);
          };
          f.c.company.threadRequest = async (...args) => {
            if (
              String(args[1]).includes("/history/") &&
              String(args[1]).includes("/summary")
            ) {
              assert.fail(
                "live publication must use the embedded history snapshot",
              );
            }
            return request(...args);
          };
          f.c.company.sync = async () => {};
          f.c.history.view = async (...args) => {
            if (args[3]) {
              entered();
              await blocked;
            }
            return historyView(...args);
          };
          await live(f.c);
          await settle(f.c);
          if (historyStatus !== "missing")
            await Promise.race([
              fetching,
              new Promise<never>((_resolve, reject) => {
                timeout = setTimeout(
                  () =>
                    reject(new Error("remote conversation was not requested")),
                  2000,
                );
              }),
            ]);
          const first = f.displays.findLast(
            (display) => display.state === "completed",
          );
          assert.ok(first);
          assert.equal(first.conversation.server, null);
          assert.equal(first.conversation.source, "local");
          assert.equal(
            combinedUsage(first.summary, first.history)?.requests,
            localHistoryCount ? "\u2248 2" : undefined,
          );
          const boundary = f.displays.length;
          if (change === "engine") {
            const preference = await f.db.estimation.readPreference();
            await f.c.engines.select({
              preference: "original",
              expectedRevision: preference!.selection_revision,
            });
          } else if (change === "erasure")
            await f.db.eraseNamespace(scope.namespace);
          else if (change === "routing") await connectCompany(f);
          release();
          await f.c.settleConversationDisplays();
          const later = f.displays.slice(boundary);
          if (change === "none") {
            if (
              historyStatus === "missing" ||
              historyStatus === "unavailable"
            ) {
              assert.equal(
                later.some((display) => display.conversation.server),
                false,
              );
              const latest = later.at(-1) ?? first;
              assert.equal(latest.summary.requests, 1);
              assert.equal(
                combinedUsage(latest.summary, latest.history)?.requests,
                localHistoryCount ? "\u2248 2" : undefined,
              );
              const reopened = await f.c.routeSummary("claude", conversation);
              assert.equal(reopened.conversation.server, null);
              assert.equal(
                combinedUsage(reopened.summary, reopened.history)?.requests,
                localHistoryCount ? "\u2248 2" : undefined,
              );
              return;
            }
            const paired = later.findLast(
              (display) => display.conversation.server,
            );
            assert.ok(
              paired,
              "validated server live and history snapshots should replace the local fallback",
            );
            assert.equal(paired.conversation.source, "server");
            assert.equal(paired.history.server_status, "current");
            assert.equal(paired.conversation.server.request_count, "9");
            assert.equal(
              combinedUsage(paired.conversation.server, paired.history)
                ?.requests,
              historyStatus === "empty" ? undefined : "\u2248 12",
            );
            const reopened = await f.c.routeSummary("claude", conversation);
            assert.equal(reopened.conversation.server.request_count, "9");
            assert.equal(
              combinedUsage(reopened.conversation.server, reopened.history)
                ?.requests,
              historyStatus === "empty" ? undefined : "\u2248 12",
            );
          } else if (change === "engine") {
            assert.ok(
              later.every(
                (display) =>
                  display.summary.calculation.methodHash !==
                  f.c.engines.methods.ecologits.method_hash,
              ),
            );
          } else {
            assert.equal(
              later.some(
                (display) =>
                  display.conversation.server || display.history?.server,
              ),
              false,
            );
          }
        } finally {
          if (timeout) clearTimeout(timeout);
          release();
          await f.c.settleConversationDisplays();
          f.c.company.authorized = authorized;
          f.c.company.threadRequest = request;
          f.c.company.sync = sync;
          f.c.history.view = historyView;
          f.c.engines.dispose();
          f.db.close();
        }
      });
