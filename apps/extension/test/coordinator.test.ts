import { archivedEstimation } from "./archived-engine-fixture";
import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Ledger } from "@footprint/ledger";
import { Coordinator } from "../lib/coordinator";
import { transitionOwnership, type OwnershipHistory } from "../lib/ownership";
import { initialSnapshot } from "@footprint/adapters";
import { countByTextLength } from "./counting-fixture";
const sender = {
  tab: { id: 1 },
  frameId: 0,
  documentId: "document-one",
  url: "https://claude.ai/new",
};
const input = (at: string, id = crypto.randomUUID()): any => ({ timing: null,
  channel: "ai-footprint-observation-v1",
  version: 1,
  id,
  revision: 1,
  event: "dispatch",
  site: "claude",
  at,
  dispatch: {
    site: "claude",
    action: "send",
    input: "private input",
    conversationId: "conversation",
    parentId: null,
    requestId: "dispatch-one",
    model: "claude-fable-5-1",
    attachments: 0,
    imageEditParentId: null,
  },
  snapshot: initialSnapshot(),
  failure: null,
});
const counting = countByTextLength;
for (const boundary of ["route_history", "capture_queue"] as const)
  test(`a default engine change at ${boundary} cannot publish the preceding calculation`, async () => {
    const db = await Ledger.open(
      "calculation-publication-" + crypto.randomUUID(),
    );
    const displays: any[] = [];
    const coordinator = new Coordinator(db, {
    estimation: archivedEstimation,
      count: counting,
      hasConsent: async () => true,
      sendDisplay: async (_, value) => {
        displays.push(value);
      },
      transport: async () => {
        throw new Error("personal mode must remain local");
      },
    });
    try {
      await coordinator.whenReady();
      await coordinator.engineStatus();
      let changed = false;
      const change = async () => {
        if (changed) return;
        changed = true;
        const status = await coordinator.engines.status();
        await coordinator.engines.select({
          preference: "ecologits",
          expectedRevision: status.selectionRevision,
        });
        await coordinator.engines.maintainLocal();
      };
      if (boundary === "capture_queue") {
        const pendingCount = coordinator.ledger.pendingCount.bind(coordinator.ledger);
        coordinator.ledger.pendingCount = async (...args) => {
          const count = await pendingCount(...args);
          await change();
          return count;
        };
      }
      const captured = input(new Date().toISOString());
      captured.dispatch.conversationId = crypto.randomUUID();
      await coordinator.capture(captured, sender);
      let result = displays.at(-1);
      if (boundary === "route_history") {
        const historyView = coordinator.history.localView.bind(coordinator.history);
        coordinator.history.localView = async (...args) => {
          const value = await historyView(...args);
          await change();
          return value;
        };
        result = await coordinator.routeSummary("claude", captured.dispatch.conversationId);
      }
      assert.equal(changed, true);
      assert.equal(result.summary.calculation.view, "recalculated");
      assert.equal(
        result.summary.calculation.methodHash,
        coordinator.engines.methods.ecologits.method_hash,
      );
      assert.equal(result.summary.requests, 1);
    } finally {
      coordinator.engines.dispose();
      db.close();
    }
  });
test("unavailable preference preserves new live numerical observations without selecting a replacement formula", async () => {
  const db = await Ledger.open("unavailable-admission-" + crypto.randomUUID());
  const coordinator = new Coordinator(db, {
    estimation: archivedEstimation,
    count: counting,
    hasConsent: async () => true,
    sendDisplay: async () => {},
    transport: async () => {
      throw new Error("personal mode must remain local");
    },
  });
  try {
    await coordinator.whenReady();
    await coordinator.engineStatus();
    const raw = (db as unknown as { db: IDBDatabase }).db;
    const tx = raw.transaction("engine_preferences", "readwrite");
    tx.objectStore("engine_preferences").put({
      key: "installation",
      record: {
        schema_version: "1.0.0",
        preference: "removed_engine",
        selection_revision: 7,
        updated_at: "2026-09-15T00:00:00.000Z",
      },
    });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    const dispatch = input(new Date().toISOString());
    await coordinator.capture(dispatch, sender);
    await coordinator.capture(
      {
        ...dispatch,
        revision: 2,
        event: "end",
        dispatch: null,
        snapshot: {
          ...initialSnapshot(),
          text: "synthetic answer",
          outputId: "unavailable-answer",
          started: true,
          state: "completed",
        },
      },
      sender,
    );
    const owner = await coordinator.currentScope();
    const rows = await db.rows(owner.namespace);
    const attempt = rows.find((row) => row.record.kind === "attempt")!.record;
    assert.equal(
      attempt.kind === "attempt" && attempt.proposed_method_id,
      "unavailable-admission-v1",
    );
    assert.notEqual(
      attempt.kind === "attempt" && attempt.tokens.answer_output.value,
      null,
    );
    const view = await coordinator.dashboard();
    assert.equal(view.summary.requests, 1);
    assert.equal(view.summary.attempts, 1);
    assert.equal(view.summary.metrics.energy.known, 0);
    assert.equal(view.summary.metrics.energy.unknown, 1);
    assert.equal((await coordinator.engines.status()).effectiveEngine, null);
    assert.equal((await db.all("estimation_originals")).length, 0);
  } finally {
    coordinator.engines.dispose();
    db.close();
  }
});
test("engine selection pins a running capture and changes the next admission without a network call", async () => {
  const db = await Ledger.open("engine-capture-" + crypto.randomUUID());
  let network = 0;
  const coordinator = new Coordinator(db, {
    estimation: archivedEstimation,
    count: counting,
    hasConsent: async () => true,
    sendDisplay: async () => {},
    transport: async () => {
      network++;
      throw new Error("personal capture must stay local");
    },
  });
  try {
    await coordinator.whenReady();
    const initial = await coordinator.engineStatus();
    await coordinator.selectEngine({
      preference: "ecologits",
      expectedRevision: initial.selectionRevision,
    });
    const dispatch = input(new Date().toISOString());
    await coordinator.capture(dispatch, sender);
    const eco = await coordinator.engines.status();
    await coordinator.selectEngine({
      preference: "original",
      expectedRevision: eco.selectionRevision,
    });
    await coordinator.capture(
      {
        ...dispatch,
        revision: 2,
        event: "end",
        dispatch: null,
        snapshot: {
          ...initialSnapshot(),
          text: "synthetic answer",
          outputId: "answer-one",
          started: true,
          state: "completed",
        },
      },
      sender,
    );
    const owner = await coordinator.currentScope();
    const rows = await db.rows(owner.namespace);
    const attempt = rows.find((row) => row.record.kind === "attempt")!.record;
    assert.equal(attempt.kind, "attempt");
    if (attempt.kind !== "attempt") throw new Error("missing attempt");
    assert.equal(attempt.proposed_method_id, eco.method!.method_id);
    const estimates = await db.estimation.viewPage({
      scope: owner,
      view: "original",
    });
    assert.equal(
      estimates.rows[0].result?.requested_method.engine_id,
      "ecologits",
    );
    const next = input(new Date().toISOString());
    next.dispatch.requestId = "dispatch-two";
    await coordinator.capture(next, sender);
    const later = (await db.rows(owner.namespace)).filter(
      (row) =>
        row.record.kind === "attempt" &&
        row.record.attempt_id !== attempt.attempt_id,
    );
    assert.equal(later.length, 1);
    assert.equal(
      later[0].record.kind === "attempt" && later[0].record.proposed_method_id,
      coordinator.engines.methods.original.method_id,
    );
    assert.equal(network, 0);
    await coordinator.engines.maintainLocal();
    const original = await coordinator.dashboard({
      calculationView: "original",
    });
    assert.equal(original.calculation.view, "original");
  } finally {
    coordinator.engines.dispose();
    db.close();
  }
});
test("PE10 real coordinator freezes personal dispatch while counting crosses Connect", async () => {
  const db = await Ledger.open("owner-race-" + crypto.randomUUID());
  let unblock!: () => void;
  let started!: () => void;
  const countingStarted = new Promise<void>((r) => (started = r));
  const barrier = new Promise<void>((r) => (unblock = r));
  let blocked = true;
  let network = 0;
  const coordinator = new Coordinator(db, {
    estimation: archivedEstimation,
    count: async (job) => {
      if (blocked) {
        started();
        await barrier;
        blocked = false;
      }
      return counting(job);
    },
    hasConsent: async () => true,
    sendDisplay: async () => {},
    transport: (async () => {
      network++;
      throw new Error("No company calls authorized by personal capture");
    }) as typeof fetch,
  });
  const personal = await coordinator.currentScope();
  const at = new Date().toISOString();
  const dispatch = input(at);
  const processing = coordinator.capture(dispatch, sender);
  await countingStarted;
  const history = (await db.get<OwnershipHistory>(
    "policy",
    "ownership-history",
  ))!;
  await db.policyTransaction([
    {
      key: "credentials",
      namespace: "company:new",
      device_id: "00000000-0000-4000-8000-000000000021",
      origin: "https://company.example",
      enrollment_era: { id: "era-new", start: at, end: null },
      enrollment_state: "active",
      policy: { policy_version: "1.0.0", deletion_epoch: 0 },
    },
    transitionOwnership(
      history,
      {
        scope: { namespace: "company:new", mode: "company", era: "era-new" },
        secret: "b".repeat(64),
        policyVersion: "1.0.0",
      },
      Date.parse(at) + 1,
    ) as any,
  ]);
  unblock();
  await processing;
  await coordinator.capture(
    {
      ...dispatch,
      revision: 2,
      event: "end",
      dispatch: null,
      snapshot: {
        ...initialSnapshot(),
        text: "answer",
        outputId: "answer-id",
        started: true,
        state: "completed",
      },
    },
    sender,
  );
  const rows = await db.rows(personal.namespace);
  assert.equal(rows.length, 2);
  assert.equal((await db.queue(personal.namespace)).length, 0);
  assert.equal((await db.rows("company:new")).length, 0);
  assert.equal(network, 0);
  const persisted = JSON.stringify([
    ...rows,
    ...(await db.all("provider_key_map")),
  ]);
  assert.ok(!persisted.includes("private input"));
  assert.ok(!persisted.includes("answer-id"));
  db.close();
});
test("Stable branch advice key survives ordinary follow-up and capture revisions", async () => {
  const db = await Ledger.open("branch-" + crypto.randomUUID());
  const displays: any[] = [];
  const coordinator = new Coordinator(db, {
    estimation: archivedEstimation,
    count: counting,
    hasConsent: async () => true,
    sendDisplay: async (_, m) => {
      displays.push(m);
    },
    transport: fetch,
  });
  await coordinator.updateSettings({ budget: 1000 });
  const first = input(new Date().toISOString());
  first.dispatch.input = "a".repeat(600);
  await coordinator.capture(first, sender);
  await coordinator.capture(
    {
      ...first,
      revision: 2,
      event: "end",
      dispatch: null,
      snapshot: {
        ...initialSnapshot(),
        text: "x",
        started: true,
        state: "completed",
        outputId: "first-answer",
      },
    },
    sender,
  );
  const second = input(new Date().toISOString());
  second.dispatch = {
    ...second.dispatch,
    input: "b",
    parentId: "first-answer",
    requestId: "dispatch-two",
  };
  await coordinator.capture(second, sender);
  await coordinator.capture(
    {
      ...second,
      revision: 2,
      event: "end",
      dispatch: null,
      snapshot: {
        ...initialSnapshot(),
        text: "y",
        started: true,
        state: "completed",
        outputId: "second-answer",
      },
    },
    sender,
  );
  const finals = displays.filter((d) => d.activeContext !== null);
  assert.equal(
    finals[0].guidance.key.split("#")[0],
    finals.at(-1).guidance.key.split("#")[0],
  );
  assert.equal(finals[0].guidance.key, finals.at(-1).guidance.key);
  assert.equal(
    finals[0].guidance.state.lastNotice,
    finals.at(-1).guidance.state.lastNotice,
  );
  db.close();
});

test("range display setting defaults to the midpoint scenario, persists and rejects unknown values", async () => {
  const db = await Ledger.open("display-scenario-" + crypto.randomUUID());
  const displays: any[] = [];
  const coordinator = new Coordinator(db, {
    estimation: archivedEstimation,
    count: counting,
    hasConsent: async () => true,
    sendDisplay: async (_, m) => {
      displays.push(m);
    },
    transport: fetch,
  });
  assert.equal((await coordinator.settings()).displayScenario, "midpoint");
  assert.equal(
    (await coordinator.dashboard({})).settings.displayScenario,
    "midpoint",
  );
  await coordinator.updateSettings({ displayScenario: "maximum" });
  assert.equal((await coordinator.settings()).displayScenario, "maximum");
  await assert.rejects(
    coordinator.updateSettings({ displayScenario: "expected" as never }),
    /minimum, midpoint or maximum/,
  );
  assert.equal((await coordinator.settings()).displayScenario, "maximum");
});
