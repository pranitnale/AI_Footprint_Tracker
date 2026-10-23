import { archivedEstimation } from "./archived-engine-fixture";
import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { countByTextLength, unavailableCount } from "./counting-fixture";
import { Ledger, historyAuthority, type Scope } from "@footprint/ledger";
import {
  FILE_COVERAGE_REASONS,
  HistoryPageSchema,
  canonicalJson,
  historyNumericPayloadHash,
  type HistoryPage,
} from "@footprint/contracts";
import { estimateHistoricalText } from "@footprint/estimator";
import { Coordinator } from "../lib/coordinator";
import {
  HISTORY_CAPTURE_CHANNEL,
  type HistoryCaptureMessage,
} from "../lib/history-capture";
import { CLAUDE_STREAM_CHANNEL } from "../lib/claude-history-message";
import { PROVIDER_STREAM_CHANNEL } from "../lib/provider-history-message";
import {
  historyPage,
  historyWorker,
  historySender,
  historyBinding,
  historyConversation,
} from "./history-fixture";
import {
  hmacIdentity,
  transitionOwnership,
  type OwnershipHistory,
} from "../lib/ownership";

async function setup(count?: (job: any) => Promise<any>) {
  const db = await Ledger.open("history-" + crypto.randomUUID());
  const c = new Coordinator(db, {
    estimation: archivedEstimation,
    count: count ?? (async () => ({})),
    hasConsent: async () => true,
    hasSiteConsent: async () => true,
    sendDisplay: async () => {},
    transport: async () => {
      throw new TypeError("synthetic offline");
    },
  });
  await c.whenReady();
  return { db, c };
}
async function receive(c: Coordinator, page = historyPage()) {
  const binding = historyBinding(),
    id = crypto.randomUUID();
  const sender =
    page.site === "chatgpt"
      ? {
          ...historySender,
          url: `https://chatgpt.com/c/${page.conversationId}`,
        }
      : historySender;
  const common: Omit<HistoryCaptureMessage, "event" | "page"> = {
    channel: HISTORY_CAPTURE_CHANNEL,
    id,
    site: page.site,
    conversationId: page.conversationId,
    observedAt: page.observedAt,
  };
  assert.deepEqual(
    await c.history.receive(
      { ...common, event: "start", page: null },
      binding,
      sender,
    ),
    { accepted: true },
  );
  assert.deepEqual(
    await c.history.receive(
      { ...common, event: "page", page },
      binding,
      sender,
    ),
    { accepted: true },
  );
}

for (const source of ["embedded", "requested"] as const)
  test(`unavailable ${source} history is never marked current`, async () => {
    const f = await setup();
    try {
      const scope = await connect(f);
      const unavailable = {
        ...(await f.c.history.local(scope)),
        status: "unavailable" as const,
      };
      f.c.company.threadRequest = async () => ({
        deletion_epoch: 0,
        history: unavailable,
      });
      const view = await f.c.history.view(
        scope,
        "a".repeat(64),
        { calculationView: "original" },
        source === "embedded" ? unavailable : undefined,
      );
      assert.equal(view.server?.status, "unavailable");
      assert.equal(view.server_status, "unavailable");
    } finally {
      f.c.engines.dispose();
      f.db.close();
    }
  });

test("route invalidation while counting cannot persist a late historical page", async () => {
  let valid = true;
  const guard = {
    check: () => {
      if (!valid) throw new Error("partial_capture");
    },
    verify: async () => {
      guard.check();
    },
  };
  const f = await setup(async () => {
    valid = false;
    return {};
  });
  try {
    const page = historyPage(),
      binding = historyBinding();
    const common: Omit<HistoryCaptureMessage, "event" | "page"> = {
      channel: HISTORY_CAPTURE_CHANNEL,
      id: crypto.randomUUID(),
      site: page.site,
      conversationId: page.conversationId,
      observedAt: page.observedAt,
    };
    await f.c.history.receive(
      { ...common, event: "start", page: null },
      binding,
      historySender,
      guard,
    );
    await assert.rejects(
      f.c.history.receive(
        { ...common, event: "page", page },
        binding,
        historySender,
        guard,
      ),
      /partial_capture/,
    );
    assert.equal((await f.db.all("history_records")).length, 0);
    assert.equal((await f.db.all("history_outbox")).length, 0);
  } finally {
    f.db.close();
  }
});

test("navigation before a streamed Claude finish leaves no partial numeric history", async () => {
  let current = true;
  const guard = {
    check: () => {
      if (!current) throw new Error("partial_capture");
    },
    verify: async () => {
      guard.check();
    },
  };
  const f = await setup(async (job) => unavailableCount(job));
  const page = historyPage();
  const binding = historyBinding();
  const common = {
    id: crypto.randomUUID(),
    site: "claude" as const,
    conversationId: page.conversationId,
    observedAt: page.observedAt,
  };
  try {
    await f.c.history.receive(
      {
        ...common,
        channel: HISTORY_CAPTURE_CHANNEL,
        event: "start",
        page: null,
      },
      binding,
      historySender,
      guard,
    );
    const rows = page.messages.map((message, index) => ({
      message: {
        ...message,
        parentSourceId: null,
        parentRole: null,
        promptSourceId: message.role === "prompt" ? message.sourceId : null,
      },
      parentId:
        message.parentSourceId ?? "00000000-0000-4000-8000-000000000000",
      index,
      untruncated: true,
    }));
    assert.deepEqual(
      await f.c.history.receiveStream(
        {
          ...common,
          channel: CLAUDE_STREAM_CHANNEL,
          event: "batch",
          rows,
          leafId: null,
          rowCount: null,
          model: null,
        },
        binding,
        historySender,
        guard,
      ),
      { accepted: true },
    );
    assert.equal((await f.db.all("history_records")).length, 0);
    current = false;
    await assert.rejects(
      f.c.history.receiveStream(
        {
          ...common,
          channel: CLAUDE_STREAM_CHANNEL,
          event: "finish",
          rows: null,
          leafId: page.selectedLeafId!,
          rowCount: 2,
          model: null,
        },
        binding,
        historySender,
        guard,
      ),
      /partial_capture/,
    );
    assert.equal((await f.db.all("history_records")).length, 0);
  } finally {
    f.c.history.invalidate();
    f.c.engines.dispose();
    f.db.close();
  }
});

test("B5 a streamed Claude read gives every saved message the chat's model, research text included", async () => {
  const f = await setup(countByTextLength);
  const page = historyPage();
  const binding = historyBinding();
  const common = {
    id: crypto.randomUUID(),
    site: "claude" as const,
    conversationId: page.conversationId,
    observedAt: page.observedAt,
  };
  try {
    await f.c.history.receive(
      { ...common, channel: HISTORY_CAPTURE_CHANNEL, event: "start", page: null },
      binding,
      historySender,
    );
    const rows = page.messages.map((message, index) => ({
      message: {
        ...message,
        parentSourceId: null,
        parentRole: null,
        promptSourceId: message.role === "prompt" ? message.sourceId : null,
        // The research queries arrive before the chat's model in this read.
        ...(message.role === "response"
          ? {
              thinking: "",
              toolInput: "brief",
              intermediate: "",
              toolOutput: "",
              components: [
                {
                  role: "research" as const,
                  model: null,
                  text: "query",
                  outputTokens: null,
                },
              ],
              coverageReasons: ["research_work_unobserved" as const],
            }
          : {}),
      },
      parentId:
        message.parentSourceId ?? "00000000-0000-4000-8000-000000000000",
      index,
      untruncated: true,
    }));
    for (const event of ["batch", "finish"] as const)
      assert.deepEqual(
        await f.c.history.receiveStream(
          {
            ...common,
            channel: CLAUDE_STREAM_CHANNEL,
            event,
            rows: event === "batch" ? rows : null,
            leafId: event === "finish" ? page.selectedLeafId! : null,
            rowCount: event === "finish" ? 2 : null,
            model: event === "finish" ? "claude-opus-5-5" : null,
          } as any,
          binding,
          historySender,
        ),
        { accepted: true },
      );
    const records = (await f.db.all<{ record: any }>("history_records")).map(
      (row) => row.record,
    );
    assert.deepEqual(
      records.map((record) => record.model_id),
      ["claude-opus-5-5", "claude-opus-5-5"],
    );
    const reply = records.find((record) => record.role === "response");
    assert.deepEqual(
      reply.generation.text_components.map((c: any) => [c.role, c.model_id]),
      [["research", "claude-opus-5-5"]],
    );
    assert.ok(reply.coverage_reasons.includes("research_work_unobserved"));
  } finally {
    f.c.history.invalidate();
    f.c.engines.dispose();
    f.db.close();
  }
});

test("a streamed Claude chat whose first prompt was edited proves its first request", async () => {
  // The edited first prompt starts the selected branch at the root with index 2; the
  // original prompt and reply (index 0 and 1) sit on the replaced branch (live, 13 Oct 2026).
  const f = await setup(countByTextLength);
  const page = historyPage();
  const binding = historyBinding();
  const common = {
    id: crypto.randomUUID(),
    site: "claude" as const,
    conversationId: page.conversationId,
    observedAt: page.observedAt,
  };
  try {
    await f.c.history.receive(
      { ...common, channel: HISTORY_CAPTURE_CHANNEL, event: "start", page: null },
      binding,
      historySender,
    );
    const rows = page.messages.map((message, index) => ({
      message: {
        ...message,
        parentSourceId: null,
        parentRole: null,
        promptSourceId: message.role === "prompt" ? message.sourceId : null,
      },
      parentId:
        message.parentSourceId ?? "00000000-0000-4000-8000-000000000000",
      index: index + 2,
      untruncated: true,
    }));
    for (const event of ["batch", "finish"] as const)
      assert.deepEqual(
        await f.c.history.receiveStream(
          {
            ...common,
            channel: CLAUDE_STREAM_CHANNEL,
            event,
            rows: event === "batch" ? rows : null,
            leafId: event === "finish" ? page.selectedLeafId! : null,
            rowCount: event === "finish" ? 2 : null,
            model: event === "finish" ? "claude-opus-5-5" : null,
          } as any,
          binding,
          historySender,
        ),
        { accepted: true },
      );
    const scope = await f.c.currentScope();
    const conversation = (await f.db.historyPage(scope, undefined))[0]!.record
      .conversation_key;
    assert.equal(
      (await f.c.history.local(scope, conversation)).first_request_verified,
      true,
    );
    // The view names the replies' model for Details, outside the shared summary schema.
    const view = await f.c.history.localView(scope, conversation);
    assert.deepEqual(view.models, ["claude-opus-5-5"]);
    assert.equal("models" in view.local, false);
  } finally {
    f.c.history.invalidate();
    f.c.engines.dispose();
    f.db.close();
  }
});

test("a corrupt streamed ChatGPT finish cannot save partial numeric history", async () => {
  const f = await setup(async (job) => unavailableCount(job));
  const page = historyPage();
  const binding = historyBinding();
  const sender = {
    ...historySender,
    url: `https://chatgpt.com/c/${page.conversationId}`,
  };
  const common = {
    id: crypto.randomUUID(),
    site: "chatgpt" as const,
    conversationId: page.conversationId,
    observedAt: page.observedAt,
  };
  try {
    await f.c.history.receive(
      { ...common, channel: HISTORY_CAPTURE_CHANNEL, event: "start", page: null },
      binding,
      sender,
    );
    const rows = page.messages.map((source) => ({
      message: {
        ...source,
        requestId: source.role === "prompt" ? source.sourceId : null,
        liveAttemptId: source.role === "response" ? source.sourceId : null,
        promptSourceId: source.role === "prompt" ? source.sourceId : null,
        parentSourceId: null,
        parentRole: null,
      },
      requestRef: "00000000-0000-4000-8000-000000000099",
      parentRef: null,
    }));
    assert.deepEqual(await f.c.history.receiveStream(
      {
        ...common,
        channel: PROVIDER_STREAM_CHANNEL,
        event: "batch",
        rows,
        meta: null,
      },
      binding,
      sender,
    ), { accepted: true });
    assert.equal((await f.db.all("history_records")).length, 0);
    await assert.rejects(f.c.history.receiveStream(
      {
        ...common,
        channel: PROVIDER_STREAM_CHANNEL,
        event: "finish",
        rows: null,
        meta: {
          messageCount: 3,
          firstRequestVerified: true,
          rootSourceId: rows[0]!.message.sourceId,
          selectedLeafId: rows[1]!.message.sourceId,
          branchScope: "loaded_messages",
          hasEarlier: false,
          hasLater: false,
        },
      },
      binding,
      sender,
    ), /history_unsupported/);
    assert.equal((await f.db.all("history_records")).length, 0);
  } finally {
    f.c.history.invalidate();
    f.c.engines.dispose();
    f.db.close();
  }
});

for (const invalidated of [false, true])
  test(`a pending native route proof during counting ${invalidated ? "rejects a real navigation" : "preserves benign work"}`, async () => {
    let pending = false;
    let valid = true;
    let counts = 0;
    const guard = {
      checkActivity: () => {
        if (!valid) throw new Error("partial_capture");
      },
      check: () => {
        guard.checkActivity();
        if (pending) throw new Error("route_pending");
      },
      verify: async () => {
        if (pending && invalidated) valid = false;
        pending = false;
        guard.checkActivity();
      },
    };
    const f = await setup(async () => {
      counts++;
      pending = true;
      return {};
    });
    try {
      const page = historyPage(),
        binding = historyBinding();
      const common: Omit<HistoryCaptureMessage, "event" | "page"> = {
        channel: HISTORY_CAPTURE_CHANNEL,
        id: crypto.randomUUID(),
        site: page.site,
        conversationId: page.conversationId,
        observedAt: page.observedAt,
      };
      await f.c.history.receive(
        { ...common, event: "start", page: null },
        binding,
        historySender,
        guard,
      );
      const work = f.c.history.receive(
        { ...common, event: "page", page },
        binding,
        historySender,
        guard,
      );
      if (invalidated) await assert.rejects(work, /partial_capture/);
      else assert.deepEqual(await work, { accepted: true });
      assert.equal(counts, 2, "each message is counted once");
      assert.equal(
        (await f.db.all("history_records")).length,
        invalidated ? 0 : 2,
      );
    } finally {
      f.c.engines.dispose();
      f.db.close();
    }
  });

for (const repeated of [false, true])
  test(`history commit retries native route verification ${repeated ? "at most three times" : "without recounting"}`, async () => {
    let pending = false;
    let counts = 0;
    let commits = 0;
    const guard = {
      checkActivity: () => {},
      check: () => {
        if (pending) throw new Error("route_pending");
      },
      verify: async () => {
        pending = false;
      },
    };
    const f = await setup(async () => {
      counts++;
      return {};
    });
    const commit = f.c.ledger.commitHistory.bind(f.c.ledger);
    f.c.ledger.commitHistory = (...args) => {
      commits++;
      if (repeated || commits === 1) pending = true;
      return commit(...args);
    };
    try {
      const page = historyPage(),
        binding = historyBinding();
      const common: Omit<HistoryCaptureMessage, "event" | "page"> = {
        channel: HISTORY_CAPTURE_CHANNEL,
        id: crypto.randomUUID(),
        site: page.site,
        conversationId: page.conversationId,
        observedAt: page.observedAt,
      };
      await f.c.history.receive(
        { ...common, event: "start", page: null },
        binding,
        historySender,
        guard,
      );
      const work = f.c.history.receive(
        { ...common, event: "page", page },
        binding,
        historySender,
        guard,
      );
      if (repeated) await assert.rejects(work, /route_pending/);
      else assert.deepEqual(await work, { accepted: true });
      assert.equal(counts, 2, "route retries reuse the two counted messages");
      assert.equal(commits, repeated ? 3 : 2);
      assert.equal(
        (await f.db.all("history_records")).length,
        repeated ? 0 : 2,
      );
    } finally {
      f.c.ledger.commitHistory = commit;
      f.c.engines.dispose();
      f.db.close();
    }
  });
async function connect(f: Awaited<ReturnType<typeof setup>>, previous?: any) {
  const namespace =
    previous?.namespace ??
    `company:${crypto.randomUUID()}:${crypto.randomUUID()}`;
  const era = previous?.enrollment_era.id ?? crypto.randomUUID();
  const scope: Scope = { namespace, mode: "company", era };
  const history = (await f.db.get<OwnershipHistory>(
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
      device_id: previous?.device_id ?? crypto.randomUUID(),
      access_token: "synthetic-access",
      refresh_token: "synthetic-refresh",
      user_hmac_key: "b".repeat(64),
      access_expires_at: new Date(Date.now() + 600000).toISOString(),
      enrollment_era: { id: era, start: new Date().toISOString(), end: null },
      policy: {
        policy_version: "1.0.0",
        pause_mode: "user_controlled",
        deletion_epoch: 0,
        timezone: "UTC",
      },
    },
    transitionOwnership(history, {
      scope,
      secret: "b".repeat(64),
      policyVersion: "1.0.0",
    }) as any,
  ]);
  return scope;
}

test("reconnect uploads original-era history only for the same company user and installation", async () => {
  const f = await setup();
  try {
    const initial = await connect(f);
    const originalCredentials = (await f.c.company.credentials())!;
    await receive(f.c);
    f.c.history.invalidate();
    const original = await f.db.pendingHistory(initial);
    const receipts = original.map((row) => ({
      message_key: row.record.message_key,
      payload_hash: row.hash,
      status: "applied" as const,
    }));
    await f.c.company.disconnect();
    await receive(f.c);
    assert.equal((await f.db.pendingHistory(initial)).length, 0);
    const personal = await f.c.currentScope();
    assert.equal((await f.db.historyPage(personal, undefined)).length, 2);
    for (const change of [
      {
        namespace: `company:${crypto.randomUUID()}:${originalCredentials.user_id}`,
      },
      {
        namespace: `company:${originalCredentials.company_id}:${crypto.randomUUID()}`,
      },
      { device_id: crypto.randomUUID() },
    ]) {
      const unrelated = await connect(f, {
        ...originalCredentials,
        ...change,
        enrollment_era: { id: crypto.randomUUID() },
      });
      assert.equal((await f.db.pendingHistory(unrelated)).length, 0);
      assert.equal((await f.db.pendingHistoryCoverage(unrelated)).length, 0);
      await f.db.acknowledgeHistory(unrelated, receipts);
      assert.equal((await f.db.all("history_outbox")).length, 2);
    }
    const reconnected = await connect(f, {
      ...originalCredentials,
      enrollment_era: { id: crypto.randomUUID() },
    });
    assert.notEqual(reconnected.era, initial.era);
    assert.deepEqual(
      (await f.db.pendingHistory(reconnected)).map((row) => row.record),
      original.map((row) => row.record),
    );
    assert.equal((await f.db.pendingHistoryCoverage(reconnected)).length, 1);
    assert.equal(
      (await f.c.history.local(reconnected, undefined, {}, true))
        .observed_response_count,
      "1",
    );
    const submitted: HistoryPage[] = [];
    f.c.company.threadRequest = async (_scope, _path, input) => {
      const page = HistoryPageSchema.parse(input);
      submitted.push(page);
      return { schema_version: "3.0.0", deletion_epoch: 0, results: receipts };
    };
    await f.c.history.sync();
    assert.equal(submitted.length, 1);
    assert.deepEqual(
      submitted[0].messages,
      original.map((row) => row.record),
    );
    assert.equal((await f.db.pendingHistory(reconnected)).length, 0);
    assert.equal((await f.db.pendingHistoryCoverage(reconnected)).length, 0);
    assert.equal((await f.db.historyPage(personal, undefined)).length, 2);
  } finally {
    f.c.history.invalidate();
    f.db.close();
  }
});

test("obsolete history queues reset without reassigning saved enrollment credentials", async () => {
  const name = "history-device-migration-" + crypto.randomUUID();
  const namespace = `company:${crypto.randomUUID()}:${crypto.randomUUID()}`;
  const device = crypto.randomUUID();
  const saved = [
    {
      key: "credentials",
      namespace,
      device_id: device,
      enrollment_era: { id: "current" },
    },
    {
      key: "reconnect:https://old.example",
      namespace,
      device_id: device,
      enrollment_era: { id: "prior" },
    },
    {
      key: "reconnect:https://ambiguous-a.example",
      namespace,
      device_id: device,
      enrollment_era: { id: "ambiguous" },
    },
    {
      key: "reconnect:https://ambiguous-b.example",
      namespace,
      device_id: crypto.randomUUID(),
      enrollment_era: { id: "ambiguous" },
    },
  ];
  const rows = ["current", "prior", "ambiguous", "unproved"].map((era) => ({
    key: era,
    namespace,
    era,
  }));
  rows.push({
    key: "other-user",
    namespace: `company:${crypto.randomUUID()}:${crypto.randomUUID()}`,
    era: "current",
  });
  await new Promise<void>((resolve, reject) => {
    const open = indexedDB.open(name, 10);
    open.onupgradeneeded = () => {
      const policy = open.result.createObjectStore("policy", {
        keyPath: "key",
      });
      for (const row of saved) policy.put(row);
      for (const name of ["history_outbox", "history_coverage"]) {
        const store = open.result.createObjectStore(name, { keyPath: "key" });
        for (const row of rows) store.put(row);
      }
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      open.result.close();
      resolve();
    };
  });
  const db = await Ledger.open(name);
  try {
    for (const store of ["history_outbox", "history_coverage"] as const) {
      assert.deepEqual(await db.all(store), []);
    }
    for (const credential of saved)
      assert.deepEqual(await db.get("policy", credential.key), credential);
  } finally {
    db.close();
  }
});

test("Personal history is never queued on Connect and bounded history sync drains every connected chunk", async () => {
  const f = await setup();
  try {
    await receive(f.c);
    const personal = await f.c.currentScope();
    const scope = await connect(f);
    assert.equal((await f.db.pendingHistory(scope)).length, 0);
    assert.equal((await f.db.historyPage(personal, undefined)).length, 2);
    await receive(f.c, historyPage(220));
    f.c.history.invalidate();
    const sizes: number[] = [];
    f.c.company.threadRequest = async (_scope, _path, input) => {
      const page = HistoryPageSchema.parse(input);
      sizes.push(page.messages.length);
      assert.equal(JSON.stringify(page).includes("erasureKey"), false);
      return {
        schema_version: "3.0.0",
        deletion_epoch: 0,
        results: page.messages.map((m) => ({
          message_key: m.message_key,
          payload_hash: historyNumericPayloadHash(m),
          status: "applied",
        })),
      };
    };
    await f.c.history.sync();
    assert.deepEqual(sizes, [100, 100, 20]);
    assert.equal((await f.db.pendingHistory(scope)).length, 0);
    assert.equal((await f.db.pendingHistoryCoverage(scope)).length, 0);
    assert.equal(
      (await f.c.history.local(scope)).observed_response_count,
      "110",
    );
  } finally {
    f.c.history.invalidate();
    f.db.close();
  }
});

test("history receipt validation is atomic and stale acknowledgements preserve newer queued evidence", async () => {
  const f = await setup();
  try {
    const scope = await connect(f);
    await receive(f.c);
    f.c.history.invalidate();
    const queued = await f.db.pendingHistory(scope);
    const good = queued.map((row) => ({
      message_key: row.record.message_key,
      payload_hash: historyNumericPayloadHash(row.record),
      status: "applied" as const,
    }));
    f.c.company.threadRequest = async () => ({
      schema_version: "3.0.0",
      deletion_epoch: 0,
      results: [good[0], { ...good[1], payload_hash: "0".repeat(64) }],
    });
    await assert.rejects(f.c.history.sync(), /payload_rejected/);
    assert.equal((await f.db.pendingHistory(scope)).length, 2);
    const coverage = (await f.db.get<{ page: HistoryPage }>(
      "history_coverage",
      `${scope.namespace}:${queued[0].record.conversation_key}`,
    ))!.page;
    const improved = {
      ...queued[0].record,
      provider_attempt_key: "c".repeat(64),
    };
    const snapshot = await f.db.publicationSnapshot(scope.namespace);
    await f.db.commitHistory(
      scope,
      { ...coverage, messages: [improved] },
      {
        authority: historyAuthority(snapshot),
        erasureVersion: snapshot.erasureVersion,
        estimates: { [improved.message_key]: estimateHistoricalText(improved) },
      },
      () => true,
    );
    await f.db.acknowledgeHistory(scope, good);
    const remaining = await f.db.pendingHistory(scope);
    assert.equal(remaining.length, 1);
    assert.equal(
      remaining[0].record.provider_attempt_key,
      improved.provider_attempt_key,
    );
    await f.db.acknowledgeHistory(scope, [
      {
        message_key: improved.message_key,
        payload_hash: historyNumericPayloadHash(improved),
        status: "erased",
      },
    ]);
    assert.equal((await f.db.pendingHistory(scope)).length, 0);
    assert.equal((await f.db.historyPage(scope, undefined)).length, 1);
    assert.equal(await f.db.historyErased(scope, improved), true);
  } finally {
    f.c.history.invalidate();
    f.db.close();
  }
});

test("obsolete usage reset retains deletion protection without interpreting old marker shapes", async () => {
  const name = "history-upgrade-" + crypto.randomUUID();
  const end = "2026-01-01T00:00:00.000Z";
  const company = `company:${crypto.randomUUID()}:${crypto.randomUUID()}`;
  const personal = `personal:${crypto.randomUUID()}`;
  const markers = [
    {
      key: `range:${company}:0:all:${end}`,
      namespace: company,
      range: true,
      start: null,
      end,
      epoch: 0,
    },
    {
      key: `range:${company}:1:2025-01-01T00:00:00.000Z:${end}`,
      namespace: company,
      range: true,
      start: "2025-01-01T00:00:00.000Z",
      end,
      epoch: 1,
    },
    {
      key: `range:${personal}:0:all:${end}`,
      namespace: personal,
      range: true,
      start: null,
      end,
      epoch: 0,
    },
    {
      key: `range:${company}:2:ambiguous:${end}`,
      namespace: company,
      range: true,
      start: null,
      end,
      epoch: 2,
    },
  ];
  await new Promise<void>((resolve, reject) => {
    const open = indexedDB.open(name, 9);
    open.onupgradeneeded = () => {
      const store = open.result.createObjectStore("deletion_markers", {
        keyPath: "key",
      });
      for (const marker of markers) store.put(marker);
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      open.result.close();
      resolve();
    };
  });
  const db = await Ledger.open(name);
  try {
    for (const marker of markers)
      assert.deepEqual(await db.get("deletion_markers", marker.key), marker);
  } finally {
    db.close();
  }
});
test("actual worker history persists dates and numeric assessments without live observations, survives restart and deduplicates reload", async () => {
  const worker = historyWorker(),
    f = await setup(worker.count);
  try {
    const page = historyPage();
    await receive(f.c, page);
    await receive(f.c, { ...page, observedAt: new Date().toISOString() });
    const scope = await f.c.currentScope(),
      rows = await f.db.historyPage(scope, undefined);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].record.tokens.value, "1");
    assert.equal((await f.db.all("requests")).length, 0);
    assert.equal((await f.db.all("attempts")).length, 0);
    assert.equal((await f.db.all("outbox")).length, 0);
    assert.equal(JSON.stringify(rows).includes("hello"), false);
    assert.equal(JSON.stringify(rows).includes(historyConversation), false);
    const view = await f.c.routeSummary(
      "claude",
      historyConversation,
      historyBinding(),
    );
    assert.equal(view.history.local.prompt_count, "1");
    assert.equal(view.history.local.response_count, "1");
    assert.equal(view.history.local.calculated_message_count, "2");
    assert.equal(view.history.local.first_request_verified, true);
    assert.equal(view.history.server_status, "personal");
    assert.ok(view.history.local.resources.some((r) => r.value !== null));
    const restarted = new Coordinator(f.db, {
      estimation: archivedEstimation,
      count: unavailableCount,
      hasConsent: async () => true,
      sendDisplay: async () => {},
    });
    await restarted.whenReady();
    const again = await restarted.routeSummary(
      "claude",
      historyConversation,
      historyBinding(),
    );
    assert.deepEqual(again.history.local, view.history.local);
  } finally {
    f.db.close();
    await worker.close();
  }
});
test("more than100 historical messages persist through bounded chunks and changing branch excludes abandoned children", async () => {
  const f = await setup();
  try {
    await receive(f.c, historyPage(220));
    const scope = await f.c.currentScope();
    assert.equal((await f.db.historyPage(scope, undefined)).length, 100);
    const view = await f.c.routeSummary(
      "claude",
      historyConversation,
      historyBinding(),
    );
    assert.equal(view.history.local.prompt_count, "110");
    assert.equal(view.history.local.response_count, "110");
    assert.equal(view.history.local.first_request_verified, true);
    const shorter = historyPage(2);
    await receive(f.c, shorter);
    const selected = await f.c.routeSummary(
      "claude",
      historyConversation,
      historyBinding(),
    );
    assert.equal(selected.history.local.response_count, "1");
    const all = await f.c.history.local(scope);
    assert.equal(all.response_count, "110");
  } finally {
    f.db.close();
  }
});
test("age retention preserves historical rows while explicit range erases unknown dates, and a chat read again after the erasure counts again", async () => {
  const f = await setup();
  try {
    const page = historyPage();
    page.messages[1].occurredAt = null;
    page.messages[1].dateBasis = "unknown";
    await receive(f.c, page);
    const scope = await f.c.currentScope();
    await f.db.applyRange(scope, null, "2025-01-01T00:00:00.000Z", 0, true);
    assert.equal((await f.db.historyPage(scope, undefined)).length, 2);
    await f.db.applyRange(
      scope,
      "2019-01-01T00:00:00.000Z",
      "2021-01-01T00:00:00.000Z",
      1,
    );
    assert.equal((await f.db.historyPage(scope, undefined)).length, 0);
    // The page read before the erasure stays out.
    await receive(f.c, page);
    assert.equal((await f.db.historyPage(scope, undefined)).length, 0);
    // An erasure is a clean slate (owner decision of 22 October 2026): read again, it counts.
    await receive(f.c, {
      ...page,
      observedAt: new Date(Date.now() + 1000).toISOString(),
    });
    assert.equal((await f.db.historyPage(scope, undefined)).length, 2);
  } finally {
    f.db.close();
  }
});
test("erasure while counting cannot recreate history", async () => {
  let release!: () => void, entered!: () => void;
  const enteredPromise = new Promise<void>((r) => (entered = r));
  const f = await setup(async () => {
    entered();
    await new Promise<void>((r) => (release = r));
    return {};
  });
  try {
    const work = receive(f.c);
    const rejected = assert.rejects(
      work,
      /policy_unavailable|record_erased|history_unavailable|history_cancelled/,
    );
    await enteredPromise;
    await f.db.applyRange(
      await f.c.currentScope(),
      null,
      "2025-01-01T00:00:00.000Z",
      1,
    );
    release();
    await rejected;
    assert.equal((await f.db.all("history_records")).length, 0);
  } finally {
    f.db.close();
  }
});

test("real Personal clear rotates scope and starts from scratch: erased history imports again", async () => {
  const f = await setup();
  try {
    const page = historyPage();
    await receive(f.c, page);
    const old = await f.c.currentScope();
    assert.equal((await f.db.historyPage(old, undefined)).length, 2);
    await f.c.clearPersonal();
    const scope = await f.c.currentScope();
    assert.notEqual(scope.namespace, old.namespace);
    assert.equal((await f.db.historyPage(scope, undefined)).length, 0);
    assert.equal((await f.db.historyPage(old, undefined)).length, 0);
    await receive(f.c, { ...page, observedAt: new Date().toISOString() });
    assert.equal((await f.db.historyPage(scope, undefined)).length, 2);
    assert.equal(
      (await f.db.all("deletion_markers")).some((marker: any) =>
        String(marker.key).startsWith("history-personal-erased:"),
      ),
      false,
    );
    const unrelated = historyPage();
    unrelated.messages = unrelated.messages.map((m, i) => ({
      ...m,
      sourceId: "10000000" + m.sourceId.slice(8),
      parentSourceId: i
        ? "10000000" + unrelated.messages[i - 1].sourceId.slice(8)
        : null,
      promptSourceId: "10000000" + m.promptSourceId!.slice(8),
    }));
    unrelated.rootSourceId = unrelated.messages[0].sourceId;
    unrelated.selectedLeafId = unrelated.messages[1].sourceId;
    unrelated.branchSourceIds = unrelated.messages.map((m) => m.sourceId);
    await receive(f.c, unrelated);
    const rows = await f.db.historyPage(scope, undefined);
    assert.equal(rows.length, 4);
    assert.equal(JSON.stringify(rows).includes("erasureKey"), false);
  } finally {
    f.db.close();
  }
});
test("loaded-message root proof survives partial pages and microsecond range filters walk branch before selecting dates", async () => {
  const f = await setup();
  try {
    const page = historyPage(4);
    page.messages[0].occurredAt = "2026-01-01T00:00:00.000001Z";
    page.messages[1].occurredAt = "2026-01-01T00:00:00.999999Z";
    page.messages[2].occurredAt = page.messages[3].occurredAt =
      "2026-02-01T00:00:00.000Z";
    await receive(f.c, page);
    const scope = await f.c.currentScope(),
      all = await f.db.historyPage(scope, undefined),
      conversation = all[0].record.conversation_key;
    const jan = await f.c.history.local(scope, conversation, {
      start: "2026-01-01T00:00:00.000Z",
      end: "2026-01-01T00:00:01.000Z",
    });
    assert.equal(jan.observed_prompt_count, "1");
    assert.equal(jan.observed_response_count, "1");
    const edge = await f.c.history.local(scope, conversation, {
      start: "2026-01-01T00:00:00.000Z",
      end: "2026-01-01T00:00:00.000001Z",
    });
    assert.equal(edge.observed_prompt_count, "0");
    const loaded = {
      ...page,
      site: "chatgpt" as const,
      messages: page.messages.map((message) => ({
        ...message,
        requestId: message.role === "prompt" ? message.sourceId : null,
        liveAttemptId: message.role === "response" ? message.sourceId : null,
      })),
      observedAt: new Date().toISOString(),
      branchScope: "loaded_messages" as const,
      selectedLeafId: null,
      branchSourceIds: null,
    };
    await receive(f.c, loaded);
    const chatConversation = (await f.db.historyPage(scope, undefined)).find(
      (row) => row.record.site === "chatgpt",
    )!.record.conversation_key;
    assert.equal(
      (await f.c.history.local(scope, chatConversation)).first_request_verified,
      true,
    );
    await receive(f.c, {
      ...loaded,
      observedAt: new Date().toISOString(),
      firstRequestVerified: false,
      rootSourceId: null,
    });
    assert.equal(
      (await f.c.history.local(scope, chatConversation)).first_request_verified,
      true,
    );
  } finally {
    f.db.close();
  }
});

test("exact microsecond range deletion holds within its scope, a chat read again after it counts again, and a later Personal clear starts from scratch", async () => {
  const f = await setup();
  try {
    const page = historyPage(4);
    page.messages[0].occurredAt = "2026-01-01T00:00:00.000001Z";
    page.messages[1].occurredAt = "2026-01-01T00:00:01.000000Z";
    page.messages[2].occurredAt = page.messages[3].occurredAt =
      "2026-02-01T00:00:00.000Z";
    await receive(f.c, page);
    const scope = await f.c.currentScope();
    await f.db.applyRange(
      scope,
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:01.000Z",
      1,
    );
    assert.equal((await f.db.historyPage(scope, undefined)).length, 3);
    await receive(f.c, page);
    assert.equal((await f.db.historyPage(scope, undefined)).length, 3);
    // An erasure is a clean slate (owner decision of 22 October 2026): read again, it counts.
    await receive(f.c, {
      ...page,
      observedAt: new Date(Date.now() + 1000).toISOString(),
    });
    assert.equal((await f.db.historyPage(scope, undefined)).length, 4);
    // The range marker belonged to the old scope; a full Personal clear keeps nothing back.
    await f.c.clearPersonal();
    await receive(f.c, { ...page, observedAt: new Date().toISOString() });
    assert.equal(
      (await f.db.historyPage(await f.c.currentScope(), undefined)).length,
      page.messages.length,
    );
  } finally {
    f.db.close();
  }
});

test("W11 saved copies are named like their live captures, and a key that arrives later uploads an unchanged chat once more", async () => {
  const f = await setup();
  try {
    const scope = await connect(f);
    const server = historyServer(f);
    server.online = false;
    const page = historyPage();
    // The Claude reader names a reply by its own id, as its live capture does.
    page.messages[1]!.liveAttemptId = page.messages[1]!.sourceId;
    // Saved before the server handed out a company key: no keys and no key list.
    await receive(f.c, page);
    await settleScheduledUpload(f);
    const unnamed = await f.db.pendingHistory(scope);
    assert.equal(unnamed.length, 2);
    assert.ok(unnamed.every((row) => !row.companyKey));
    server.online = true;
    await f.c.history.sync();
    const submitted = server.submitted;
    assert.equal(submitted.length, 1);
    assert.equal(submitted[0]!.company_dedup_keys, undefined);
    assert.deepEqual(await f.db.pendingHistory(scope), []);
    // A refresh hands out the key; reopening the unchanged chat names its messages and
    // queues them once more, so the company can count them once.
    const KEY = W11_KEY;
    await handOutCompanyKey(f, KEY);
    server.online = false;
    await receive(f.c, { ...page, observedAt: new Date().toISOString() });
    await settleScheduledUpload(f);
    const queued = await f.db.pendingHistory(scope);
    const byRole = new Map(queued.map((row) => [row.record.role, row]));
    assert.equal(queued.length, 2);
    assert.equal(
      byRole.get("prompt")!.companyKey,
      await hmacIdentity(
        KEY,
        "claude",
        "company-request",
        page.messages[0]!.sourceId,
      ),
    );
    assert.equal(
      byRole.get("response")!.companyKey,
      await hmacIdentity(
        KEY,
        "claude",
        "company-attempt",
        page.messages[1]!.sourceId,
      ),
    );
    // The messages themselves are unchanged; the key travels beside them.
    assert.deepEqual(
      queued.map((row) => row.record),
      submitted[0]!.messages,
    );
    assert.ok(queued.every((row) => row.record.company_dedup_key === null));
    server.online = true;
    await f.c.history.sync();
    assert.equal(submitted.length, 2);
    assert.deepEqual(
      Object.fromEntries(
        submitted[1]!.company_dedup_keys!.map((entry) => [
          entry.message_key,
          entry.company_dedup_key,
        ]),
      ),
      Object.fromEntries(
        queued.map((row) => [row.record.message_key, row.companyKey]),
      ),
    );
    // Reopened once more, nothing is queued again.
    await receive(f.c, { ...page, observedAt: new Date().toISOString() });
    assert.deepEqual(await f.db.pendingHistory(scope), []);
    await f.c.history.sync();
    assert.equal(submitted.filter((p) => p.messages.length).length, 2);
  } finally {
    f.c.history.invalidate();
    f.c.engines.dispose();
    f.db.close();
  }
});

/**
 * Answers a history upload as the server does while online, and keeps every page it
 * received. Offline, an upload fails as without a network and the messages stay queued.
 */
function historyServer(f: Awaited<ReturnType<typeof setup>>) {
  const server = { online: true, submitted: [] as HistoryPage[] };
  f.c.company.threadRequest = async (_scope, _path, input) => {
    if (!server.online) throw new TypeError("synthetic offline");
    const page = HistoryPageSchema.parse(input);
    // The server refuses a page over 256 KiB.
    assert.ok(new TextEncoder().encode(canonicalJson(page)).length <= 262144);
    server.submitted.push(page);
    return {
      schema_version: "3.0.0",
      deletion_epoch: 0,
      results: page.messages.map((m) => ({
        message_key: m.message_key,
        payload_hash: historyNumericPayloadHash(m),
        status: "applied",
      })),
    };
  };
  return server;
}
/**
 * A saved page schedules an upload for the next turn. Lets it run (and fail while the
 * server is offline), so the test, not the timer, decides when messages go up.
 */
async function settleScheduledUpload(f: Awaited<ReturnType<typeof setup>>) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await f.c.history.sync().catch(() => {});
}
const W11_KEY = Buffer.from("w11-synthetic-company-key-32byte").toString(
  "base64url",
);
async function handOutCompanyKey(
  f: Awaited<ReturnType<typeof setup>>,
  key: string | null,
) {
  const credentials = await f.db.get<any>("policy", "credentials");
  await f.db.policyTransaction([{ ...credentials, company_dedup_key: key }]);
}

test("W11 saved keys go only to a server that currently hands out a company key", async () => {
  const f = await setup();
  try {
    const scope = await connect(f);
    const server = historyServer(f);
    server.online = false;
    await handOutCompanyKey(f, W11_KEY);
    const page = historyPage();
    page.messages[1]!.liveAttemptId = page.messages[1]!.sourceId;
    await receive(f.c, page);
    await settleScheduledUpload(f);
    const queued = await f.db.pendingHistory(scope);
    assert.equal(queued.length, 2);
    assert.ok(queued.every((row) => row.companyKey));
    // The server stopped handing out the key before the upload.
    await handOutCompanyKey(f, null);
    server.online = true;
    await f.c.history.sync();
    assert.equal(server.submitted.length, 1);
    assert.equal(server.submitted[0]!.messages.length, 2);
    assert.equal(server.submitted[0]!.company_dedup_keys, undefined);
  } finally {
    f.c.history.invalidate();
    f.c.engines.dispose();
    f.db.close();
  }
});

test("W11 a saved page over the server's limit leaves its last messages for the next upload", async () => {
  const f = await setup();
  try {
    const scope = await connect(f);
    const server = historyServer(f);
    server.online = false;
    await handOutCompanyKey(f, W11_KEY);
    await receive(f.c, historyPage());
    await settleScheduledUpload(f);
    const prompt = (await f.db.pendingHistory(scope)).find(
      (row) => row.record.role === "prompt",
    )!;
    // Prompts with many attached files make a page of 100 messages far over the limit.
    const file = {
      origin: "new_upload" as const,
      extraction_profile_id: "observed-inline-file-text-v1" as const,
      page_count: 200,
      tokens: {
        value: "123456789",
        evidence: "heuristic_estimate" as const,
        scope: "extracted_file_text" as const,
        completeness: "partial" as const,
        profile_id: "o200k-base-4.0.0-reference" as const,
        reason: "tokenizer_mapping_unverified" as const,
      },
      missing: [...FILE_COVERAGE_REASONS],
    };
    const rows = Array.from({ length: 100 }, (_, index) => {
      const record = {
        ...prompt.record,
        message_key: (index + 1).toString(16).padStart(64, "0"),
        inline_file_text: Array.from({ length: 16 }, () => file),
      };
      return {
        ...prompt,
        record,
        hash: historyNumericPayloadHash(record),
        companyKey: (index + 1).toString(16).padStart(64, "f"),
      };
    });
    // The coordinator and its history service share one repository.
    const queue = f.c.ledger.pendingHistory;
    let served = false;
    f.c.ledger.pendingHistory = async (target) =>
      served ? queue(target) : ((served = true), rows.map((r) => ({ ...r })));
    server.online = true;
    await f.c.history.sync();
    f.c.ledger.pendingHistory = queue;
    const first = server.submitted[0]!;
    assert.ok(first.messages.length > 1 && first.messages.length < 100);
    // The page keeps its first messages in order, each with its key beside it.
    assert.deepEqual(
      first.messages.map((m) => m.message_key),
      rows.slice(0, first.messages.length).map((r) => r.record.message_key),
    );
    assert.deepEqual(
      first.company_dedup_keys!.map((e) => e.company_dedup_key),
      rows.slice(0, first.messages.length).map((r) => r.companyKey),
    );
  } finally {
    f.c.history.invalidate();
    f.c.engines.dispose();
    f.db.close();
  }
});

test("usage breakdown splits saved history by day, tool and chat with the totals' own accumulator", async () => {
  const f = await setup();
  try {
    await receive(f.c, historyPage(40));
    const scope = await f.c.currentScope();
    const total = await f.c.history.local(scope);
    const breakdown = await f.c.usageBreakdown({ bucket: "day", timezone: "UTC" });
    assert.ok(breakdown.history, "saved history must be available");
    assert.deepEqual(breakdown.history.total, total);
    const add = (summaries: Record<string, { prompt_count: string; response_count: string; calculated_message_count: string }>, key: "prompt_count" | "response_count" | "calculated_message_count") =>
      Object.values(summaries).reduce((n, s) => n + BigInt(s[key]), 0n).toString();
    for (const split of ["sites", "chats", "buckets"] as const)
      for (const key of ["prompt_count", "response_count", "calculated_message_count"] as const)
        assert.equal(add(breakdown.history[split], key), total[key], `${split} ${key}`);
    assert.deepEqual(Object.keys(breakdown.history.sites), ["claude"]);
    assert.equal(Object.keys(breakdown.history.chats).length, 1);
  } finally {
    f.db.close();
  }
});

test("Details compares the open chat with the other chats through the dashboard breakdown", async () => {
  const f = await setup(countByTextLength);
  try {
    const page = historyPage(40);
    const recent = new Date(Date.now() - 60_000).toISOString();
    page.messages = page.messages.map((m) => ({ ...m, occurredAt: recent }));
    await receive(f.c, page);
    const result = await f.c.chatComparison("claude", page.conversationId);
    // The chat's saved history is found under the key the page's conversation id gives it.
    assert.equal(result.chats, 1);
    assert.ok(result.thisChat !== null && result.thisChat > 0);
    assert.equal(result.averageWh, result.thisChat);
    assert.equal(result.thisBin, 6);
    // One chat has no others to compare with, so no percentage is invented.
    assert.equal(result.smallerShare, null);
    assert.equal(result.scenario, "midpoint");
    const other = await f.c.chatComparison("claude", "00000000-0000-4000-8000-0000000000ff");
    assert.equal(other.thisChat, null);
    assert.equal(other.chats, 1);
    await assert.rejects(f.c.chatComparison("claude", "../not-a-chat"), /payload_rejected/);
  } finally {
    f.db.close();
  }
});
