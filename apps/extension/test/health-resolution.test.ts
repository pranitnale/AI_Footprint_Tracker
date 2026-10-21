import { archivedEstimation } from "./archived-engine-fixture";
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { REASON_CODES, type ReasonCode } from "@footprint/contracts";
import { Ledger } from "@footprint/ledger";
import { initialSnapshot } from "@footprint/adapters";
import { Coordinator } from "../lib/coordinator";
import {
  HealthReporter,
  OPEN_PROBLEM_MS,
  SOLVED_BY,
  codesSolvedBy,
  combineHealthAt,
  isOpenProblem,
  persistedHealth,
  problemState,
  solveHealth,
  type HealthSuccess,
} from "../lib/health";
import { countByTextLength, unavailableCount } from "./counting-fixture";

// Owner decision of 16 October 2026: a saved problem closes as soon as the same kind of work
// succeeds again, problems not seen for 3 days move to Earlier problems, nothing is deleted.

test("every mapped code is a reason code, notes close only by time and every other code by a later read reply", () => {
  for (const code of Object.keys(SOLVED_BY))
    assert.ok(REASON_CODES.includes(code as ReasonCode), code);
  // Notes nothing in this browser can fix, and the composer check, never close by a success.
  const closing = new Set((["reply_read", "reply_counted", "estimate_made", "record_saved", "totals_built", "synced", "policy_checked", "connected", "deletions_applied"] as const).flatMap(codesSolvedBy));
  for (const code of ["revision_conflict", "retention_expired", "historical_timing_conflict", "composer_anchor_missing"] as const) {
    assert.equal(SOLVED_BY[code], undefined, code);
    assert.ok(!closing.has(code), code);
  }
  // Owner decision of 16 October 2026, evening: when the tracker works again nothing stays open.
  for (const code of ["request_identity_ambiguous", "dependency_missing", "unknown_model", "capture_limit_exceeded"] as const)
    assert.ok(codesSolvedBy("reply_read").includes(code), code);
  for (const code of REASON_CODES)
    if (!["revision_conflict", "retention_expired", "historical_timing_conflict", "composer_anchor_missing"].includes(code))
      assert.ok(closing.has(code), `${code} never closes by a success`);
  const successes: HealthSuccess[] = [
    "reply_read",
    "reply_counted",
    "estimate_made",
    "record_saved",
    "totals_built",
    "synced",
    "policy_checked",
    "connected",
    "deletions_applied",
  ];
  for (const success of successes)
    assert.ok(codesSolvedBy(success).length > 0, success);
  assert.deepEqual([...codesSolvedBy("synced")], ["sync_delayed", "payload_rejected"]);
  assert.deepEqual(
    [...codesSolvedBy("connected")].sort(),
    ["auth_reconnect_required", "enrollment_revoked"],
  );
});

test("a problem is open until it is solved or not seen for 3 days", () => {
  const now = Date.UTC(2026, 9, 16, 12);
  assert.equal(problemState({ lastAt: now - 1000, resolvedAt: null }, now), "unresolved");
  assert.equal(
    problemState({ lastAt: now - OPEN_PROBLEM_MS, resolvedAt: null }, now),
    "unresolved",
  );
  assert.equal(
    problemState({ lastAt: now - OPEN_PROBLEM_MS - 1, resolvedAt: null }, now),
    "inactive",
  );
  assert.equal(problemState({ lastAt: now - 1000, resolvedAt: now - 500 }, now), "resolved");
  // Seen again after the success: open again.
  assert.equal(
    problemState({ lastAt: now - 100, resolvedAt: now - 500 }, now),
    "unresolved",
  );
  const rows = persistedHealth(
    [
      { code: "sync_delayed", at: now - 1000, firstAt: now - 5000, lastAt: now - 1000, count: 3, resolvedAt: now - 10 },
      { code: "revision_conflict", at: now - OPEN_PROBLEM_MS - 60_000, count: 1 },
      { code: "revision_conflict_unknown", at: now },
      { code: "payload_rejected", at: now - 60_000 },
    ],
    now,
  );
  assert.deepEqual(
    rows.map((row) => [row.code, row.state, row.resolvedAt, row.count]),
    [
      ["sync_delayed", "resolved", now - 10, 3],
      ["revision_conflict", "inactive", null, 1],
      ["payload_rejected", "unresolved", null, 1],
    ],
  );
  assert.deepEqual(
    rows.filter(isOpenProblem).map((row) => row.code),
    ["payload_rejected"],
  );
});

test("a memory copy seen after the saved success keeps the joined problem open", () => {
  const now = Date.UTC(2026, 9, 16, 12);
  const saved = persistedHealth(
    [{ code: "storage_write_failed", at: now - 5000, lastAt: now - 5000, resolvedAt: now - 4000 }],
    now,
  );
  const memory = {
    ...saved[0]!,
    at: now - 1000,
    firstAt: now - 1000,
    lastAt: now - 1000,
    count: 1,
    persistence: "memory" as const,
    resolvedAt: null,
    state: "unresolved" as const,
  };
  const [joined] = combineHealthAt(now, saved, [memory]);
  assert.equal(joined!.state, "unresolved");
  assert.equal(joined!.resolvedAt, now - 4000);
  assert.equal(joined!.count, 2);
  const [solved] = combineHealthAt(now, saved, [{ ...memory, lastAt: now - 4500, resolvedAt: now - 4200 }]);
  assert.equal(solved!.state, "resolved");
  assert.equal(solved!.resolvedAt, now - 4000);
});

test("memory problems close for their namespace only, and come back when reported again", () => {
  const health = new HealthReporter(async () => {});
  health.report("sync_delayed", "company:one");
  health.report("sync_delayed", "company:two");
  health.report("storage_write_failed");
  health.resolve("company:one", ["sync_delayed", "storage_write_failed"]);
  assert.equal(health.list("company:one").find((v) => v.code === "sync_delayed")!.state, "resolved");
  assert.equal(health.list("company:two").find((v) => v.code === "sync_delayed")!.state, "unresolved");
  // Reported without a namespace by any failing handler; this success proves nothing about it.
  assert.equal(health.list("company:one").find((v) => v.code === "storage_write_failed")!.state, "unresolved");
  health.report("sync_delayed", "company:one");
  const again = health.list("company:one").find((v) => v.code === "sync_delayed")!;
  assert.equal(again.state, "unresolved");
  assert.equal(again.resolvedAt, null);
  assert.equal(again.count, 2);
});

test("closing problems never fails the work that succeeded", async () => {
  const asked: (readonly ReasonCode[])[] = [];
  await solveHealth({}, "personal:x", "synced");
  await solveHealth(
    {
      resolveHealth: async () => {
        throw new DOMException("PRIVATE", "InvalidStateError");
      },
    },
    "personal:x",
    "record_saved",
  );
  await solveHealth(
    { resolveHealth: async (_namespace, codes) => void asked.push(codes) },
    "personal:x",
    ["reply_read", "record_saved"],
    ["partial_capture"],
  );
  assert.equal(asked.length, 1);
  assert.ok(asked[0]!.includes("storage_write_failed"));
  assert.ok(asked[0]!.includes("protocol_unsupported"));
  assert.ok(!asked[0]!.includes("partial_capture"));
});

const sender = {
  tab: { id: 1 },
  frameId: 0,
  documentId: "document-one",
  url: "https://claude.ai/new",
};
const dispatch = (): any => ({
  timing: null,
  channel: "ai-footprint-observation-v1",
  version: 1,
  id: crypto.randomUUID(),
  revision: 1,
  event: "dispatch",
  site: "claude",
  at: new Date().toISOString(),
  dispatch: {
    site: "claude",
    action: "send",
    input: "private input",
    conversationId: crypto.randomUUID(),
    parentId: null,
    requestId: crypto.randomUUID(),
    model: "claude-fable-5-1",
    attachments: 0,
    imageEditParentId: null,
  },
  snapshot: initialSnapshot(),
  failure: null,
});
const end = (sent: any, failure: string | null = null): any => ({
  ...sent,
  revision: 2,
  event: "end",
  dispatch: null,
  snapshot: {
    ...initialSnapshot(),
    text: "synthetic answer",
    outputId: crypto.randomUUID(),
    started: true,
    state: "completed",
  },
  failure,
});

async function setup(count = countByTextLength) {
  const db = await Ledger.open("health-resolution-" + crypto.randomUUID());
  const health = new HealthReporter(async () => {});
  // As the background wires it.
  db.onHealthResolved((namespace, codes) => health.resolve(namespace, codes));
  const coordinator = new Coordinator(db, {
    estimation: archivedEstimation,
    count,
    hasConsent: async () => true,
    sendDisplay: async () => {},
    health,
    transport: async () => {
      throw new Error("personal mode must remain local");
    },
  });
  await coordinator.whenReady();
  const scope = await coordinator.currentScope();
  const states = async () =>
    Object.fromEntries(
      (await coordinator.trackingHealth()).health
        .filter((issue) => issue.scope === "current")
        .map((issue) => [issue.code, issue.state]),
    );
  return {
    db,
    health,
    coordinator,
    scope,
    states,
    close() {
      coordinator.history.invalidate();
      coordinator.engines.dispose();
      db.close();
    },
  };
}

test("a live reply that was read, counted, estimated and saved closes the problems of that work", async () => {
  const f = await setup();
  try {
    for (const code of [
      "capture_hook_missing",
      "protocol_unsupported",
      "capture_body_missing",
      "clock_skew",
      "tokenizer_unavailable",
      "estimate_unavailable",
      "storage_write_failed",
      "revision_conflict",
      "sync_delayed",
      "policy_unavailable",
    ] as const)
      await f.db.health(f.scope.namespace, code);
    f.health.report("partial_capture", f.scope.namespace);
    const before = await f.db.list<any>("health", f.scope.namespace);
    const sent = dispatch();
    await f.coordinator.capture(sent, sender);
    // A send alone proves nothing yet.
    assert.equal((await f.states()).capture_hook_missing, "unresolved");
    await f.coordinator.capture(end(sent), sender);
    assert.deepEqual(await f.states(), {
      capture_hook_missing: "resolved",
      protocol_unsupported: "resolved",
      capture_body_missing: "resolved",
      clock_skew: "resolved",
      tokenizer_unavailable: "resolved",
      estimate_unavailable: "resolved",
      storage_write_failed: "resolved",
      partial_capture: "resolved",
      // Other kinds of work: a final refusal closes by time, sync and rules by their own success.
      revision_conflict: "unresolved",
      sync_delayed: "unresolved",
      policy_unavailable: "unresolved",
    });
    // Nothing was deleted and the counts stay.
    const after = await f.db.list<any>("health", f.scope.namespace);
    assert.equal(after.length, before.length);
    for (const row of before)
      assert.equal(after.find((next) => next.key === row.key)!.count, row.count);
  } finally {
    f.close();
  }
});

test("a reply whose own capture failed keeps capture problems open but closes storage ones", async () => {
  const f = await setup();
  try {
    await f.db.health(f.scope.namespace, "protocol_unsupported");
    await f.db.health(f.scope.namespace, "storage_write_failed");
    const sent = dispatch();
    await f.coordinator.capture(sent, sender);
    await f.coordinator.capture(end(sent, "capture_interrupted"), sender);
    const states = await f.states();
    assert.equal(states.protocol_unsupported, "unresolved");
    assert.equal(states.partial_capture, "unresolved");
    assert.equal(states.storage_write_failed, "resolved");
  } finally {
    f.close();
  }
});

test("a reply the tokenizer could not count keeps the counting problem open", async () => {
  const f = await setup(unavailableCount);
  try {
    await f.db.health(f.scope.namespace, "protocol_unsupported");
    const sent = dispatch();
    await f.coordinator.capture(sent, sender);
    await f.coordinator.capture(end(sent), sender);
    const states = await f.states();
    assert.equal(states.tokenizer_unavailable, "unresolved");
    assert.equal(states.protocol_unsupported, "resolved");
  } finally {
    f.close();
  }
});

test("a reply that lost part of its stream earlier keeps that problem open while closing others", async () => {
  const f = await setup();
  try {
    await f.db.health(f.scope.namespace, "protocol_unsupported");
    const sent = dispatch();
    await f.coordinator.capture(sent, sender);
    const done = end(sent);
    await f.coordinator.capture(
      { ...done, event: "progress", failure: "capture_interrupted", snapshot: { ...done.snapshot, state: "generating" } },
      sender,
    );
    await f.coordinator.capture({ ...done, revision: 3 }, sender);
    const states = await f.states();
    assert.equal(states.protocol_unsupported, "resolved");
    // The reply itself carries partial_capture, so it is no proof that capture works again.
    assert.equal(states.partial_capture, "unresolved");
  } finally {
    f.close();
  }
});

test("built dashboard totals close earlier totals problems, and a problem seen again reopens", async () => {
  const f = await setup();
  try {
    await f.db.health(f.scope.namespace, "aggregate_inconsistent");
    await f.db.health(f.scope.namespace, "ledger_integrity_failed");
    const dashboard = await f.coordinator.dashboard();
    const issue = (code: string) => dashboard.health.find((v) => v.code === code)!;
    assert.equal(issue("aggregate_inconsistent").state, "resolved");
    assert.equal(issue("ledger_integrity_failed").state, "resolved");
    assert.ok(issue("aggregate_inconsistent").resolvedAt! >= issue("aggregate_inconsistent").lastAt);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await f.db.health(f.scope.namespace, "aggregate_inconsistent");
    const states = await f.states();
    assert.equal(states.aggregate_inconsistent, "unresolved");
    assert.equal(states.ledger_integrity_failed, "resolved");
  } finally {
    f.close();
  }
});
