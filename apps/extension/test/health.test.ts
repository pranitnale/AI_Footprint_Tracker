import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Ledger } from "@footprint/ledger";
import {
  HealthReporter,
  failureCode,
  failureMessage,
  persistedHealth,
  combineHealth,
  technicalDetail,
} from "../lib/health";
import { records } from "../../../packages/ledger/test/factory";
test("L07 runtime quota failure has visible transient health even when diagnostics cannot persist", async () => {
  const ledger = await Ledger.open("quota-" + crypto.randomUUID());
  let badges = 0;
  const health = new HealthReporter(async () => {
    badges++;
  });
  const original = ledger.commit.bind(ledger);
  ledger.commit = async () => {
    throw new DOMException("PRIVATE storage text", "QuotaExceededError");
  };
  try {
    await ledger.commit(
      { namespace: "personal:test", mode: "personal", era: null },
      records(),
    );
  } catch (error) {
    health.report(error);
  }
  assert.equal(health.list()[0]!.code, "storage_write_failed");
  assert.equal(badges, 1);
  assert.ok(
    failureMessage(health.list()[0]!.code).includes(
      "Recent observations may be missing",
    ),
  );
  assert.ok(!JSON.stringify(health.list()).includes("PRIVATE"));
  ledger.commit = original;
  assert.equal((await ledger.rows("personal:test")).length, 0);
  ledger.close();
});
test("health coalesces durable occurrences and exposes only fixed public fields", async () => {
  const ledger = await Ledger.open("health-count-" + crypto.randomUUID());
  try {
    await Promise.all(
      Array.from({ length: 5 }, () =>
        ledger.health("personal:PRIVATE_ID", "partial_capture"),
      ),
    );
    const rows = await ledger.list<any>("health", "personal:PRIVATE_ID");
    assert.equal(rows[0].count, 5);
    assert.ok(rows[0].firstAt <= rows[0].lastAt);
    const safe = persistedHealth(rows);
    assert.equal(safe[0]!.count, 5);
    assert.equal(safe[0]!.state, "unresolved");
    assert.ok(!JSON.stringify(safe).includes("PRIVATE_ID"));
    assert.deepEqual(persistedHealth([{ code: "PRIVATE_TEXT" }]), []);
  } finally {
    ledger.close();
  }
});
test("a failed diagnostic write retains its cause separately from storage failure without duplicate persisted counts", async () => {
  const ledger = await Ledger.open("health-fallback-" + crypto.randomUUID());
  const health = new HealthReporter(async () => {});
  ledger.onHealthFailure((namespace, code) => {
    health.report(code, namespace);
    if (code !== "storage_write_failed")
      health.report("storage_write_failed", namespace);
  });
  await ledger.health("personal:one", "partial_capture");
  const durable = persistedHealth(await ledger.list("health", "personal:one"));
  ledger.close();
  await assert.rejects(ledger.health("personal:one", "partial_capture"));
  const issues = combineHealth(durable, health.list("personal:one"));
  assert.equal(
    issues.find((issue) => issue.code === "partial_capture")!.count,
    2,
  );
  assert.equal(
    issues.find((issue) => issue.code === "partial_capture")!.persistence,
    "memory",
  );
  assert.ok(issues.some((issue) => issue.code === "storage_write_failed"));
  assert.deepEqual(health.list("company:other"), []);
  assert.deepEqual(health.list(), []);
});
test("memory diagnostics are bounded, scope safe and never cleared by reading", () => {
  const health = new HealthReporter(async () => {});
  health.report("partial_capture", "company:PRIVATE_ONE");
  health.report("tokenizer_unavailable", "company:PRIVATE_TWO");
  health.report("storage_write_failed");
  assert.deepEqual(
    health.list("company:PRIVATE_TWO").map((v) => v.code),
    ["tokenizer_unavailable", "storage_write_failed"],
  );
  assert.ok(
    !JSON.stringify(health.list("company:PRIVATE_ONE")).includes("PRIVATE"),
  );
  for (let index = 0; index < 300; index++)
    health.report("partial_capture", `scope:${index}`);
  assert.ok(health.list().some((v) => v.code === "capture_limit_exceeded"));
  assert.equal(health.list("company:PRIVATE_ONE")[0]!.state, "unresolved");
});
// Live QA of 19 Oct 2026: a totals read that gave up once while a reply was being saved stayed
// on the Tracking page as an open problem for three days, although later reads were consistent.
test("a calculation change that made a read give up closes when a later read is consistent; other problems stay", () => {
  const health = new HealthReporter(async () => {});
  health.report(new Error("aggregate_inconsistent"));
  health.report(new Error("policy_unavailable"));
  health.report("aggregate_inconsistent", "personal:one");
  const state = (code: string, namespace?: string) =>
    health.list(namespace).find((issue) => issue.code === code && (namespace ? true : issue.scope === "extension"))!.state;
  assert.equal(state("aggregate_inconsistent"), "unresolved");
  health.resolveCalculation();
  assert.equal(state("aggregate_inconsistent"), "resolved");
  assert.equal(state("policy_unavailable"), "unresolved", "a failure of another kind stays open");
  assert.equal(
    health.list("personal:one").find((issue) => issue.scope === "current")!.state,
    "unresolved",
    "a problem of a data scope closes only when that scope's work succeeds",
  );
  // A new occurrence after the consistent read is open again.
  health.report(new Error("aggregate_inconsistent"));
  assert.equal(state("aggregate_inconsistent"), "unresolved");
});
test("Failure diagnostics never expose arbitrary exception messages or credentials", async () => {
  const health = new HealthReporter(async () => {
    throw new Error("badge unavailable");
  });
  const code = health.report(new Error("PRIVATE_BEARER_AND_CHAT"));
  await Promise.resolve();
  assert.equal(code, "ledger_integrity_failed");
  assert.ok(!failureMessage(code).includes("PRIVATE"));
  assert.ok(!JSON.stringify(health.list()).includes("PRIVATE"));
});
test("a database that cannot be created on a new profile is a storage failure, not a ledger integrity problem", async () => {
  const factory = globalThis.indexedDB;
  const open = factory.open;
  // Chrome rejects the first open this way when it cannot create the database
  // files, for example when a Windows profile folder path is too long.
  factory.open = (() => {
    const request: any = {
      error: new DOMException(
        "Internal error opening database with version 15",
        "UnknownError",
      ),
    };
    setTimeout(() => request.onerror?.(new Event("error")));
    return request;
  }) as typeof factory.open;
  let failure: unknown;
  try {
    await Ledger.open("new-profile-" + crypto.randomUUID()).then(
      (ledger) => ledger.close(),
      (error) => {
        failure = error;
      },
    );
  } finally {
    factory.open = open;
  }
  assert.ok(failure instanceof DOMException);
  let badges = 0;
  const health = new HealthReporter(async () => {
    badges++;
  });
  // Every waiting message handler receives the same rejection.
  health.report(failure);
  health.report(failure);
  assert.deepEqual(
    health.list().map((issue) => [issue.code, issue.scope, issue.count]),
    [["storage_write_failed", "extension", 1]],
  );
  assert.equal(badges, 2);
  assert.equal(
    failureCode(new DOMException("duplicate key", "ConstraintError")),
    "ledger_integrity_failed",
  );
});
test("the technical detail names the error and hides addresses", () => {
  // Owner, 13 Oct 2026: a screenshot of an error should show its cause.
  assert.equal(
    technicalDetail(new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation")),
    "TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation",
  );
  assert.equal(
    technicalDetail(new Error("GET https://example.org/v1/me?token=abc failed")),
    "Error: GET [address] failed",
  );
  assert.equal(technicalDetail("text"), null);
  assert.ok(technicalDetail(new Error("x".repeat(400)))!.length <= 160);
});
