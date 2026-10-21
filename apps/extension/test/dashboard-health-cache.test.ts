import { archivedEstimation } from "./archived-engine-fixture";
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { unavailableCount } from "./counting-fixture";
import test from "node:test";
import { Ledger } from "@footprint/ledger";
import { records } from "../../../packages/ledger/test/factory";
import { Coordinator } from "../lib/coordinator";
import { HealthReporter } from "../lib/health";
import { transitionOwnership, type OwnershipHistory } from "../lib/ownership";

async function setup() {
  const ledger = await Ledger.open("dashboard-health-" + crypto.randomUUID());
  const health = new HealthReporter(async () => {});
  const coordinator = new Coordinator(ledger, {
    estimation: archivedEstimation,
    count: unavailableCount,
    hasConsent: async () => true,
    sendDisplay: async () => {},
    health,
  });
  await coordinator.whenReady();
  return {
    ledger,
    health,
    coordinator,
    scope: await coordinator.currentScope(),
  };
}
async function move(f: Awaited<ReturnType<typeof setup>>) {
  const history = (await f.ledger.get<OwnershipHistory>(
    "policy",
    "ownership-history",
  ))!;
  await f.ledger.policyTransaction([
    transitionOwnership(history, {
      scope: { namespace: "personal:other", mode: "personal", era: null },
      secret: "b".repeat(64),
      policyVersion: "1.0.0",
    }) as any,
  ]);
}
async function bounded<T>(work: Promise<T>, stage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Dashboard test timed out: ${stage}`)),
          5000,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

test("dirty Original dashboard supplies bounded refresh hint and returns clean totals after the same build completes", async () => {
  const f = await setup();
  const original = f.coordinator.ledger.cacheSummary.bind(f.coordinator.ledger);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let rebuild: Promise<void> | undefined;
  try {
    // An explicit view holds the cache identity fixed while testing same-build reuse.
    const filters = { site: "claude", calculationView: "original" as const };
    const first = await bounded(
      f.coordinator.dashboard(filters),
      "initial Original view",
    );
    assert.equal(first.summary.requests, 0);
    await f.ledger.commit(f.scope, records());
    let builds = 0;
    f.coordinator.ledger.cacheSummary = (...args) => {
      builds++;
      const held = (args[2] as { requests: number }).requests === 1;
      const work = (async () => {
        if (held) await gate;
        await original(...args);
      })();
      if (held) rebuild = work;
      return work;
    };
    const stale = await bounded(
      f.coordinator.dashboard(filters),
      "stale Original view",
    );
    assert.equal(stale.aggregate_status, "rebuilding");
    assert.equal(stale.refreshAfterMs, 250);
    assert.equal(stale.summary.requests, 0);
    const repeated = await bounded(
      f.coordinator.dashboard(filters),
      "same-build reuse",
    );
    assert.equal(repeated.aggregate_status, "rebuilding");
    assert.equal(builds, 1);
    const other = await bounded(
      f.coordinator.dashboard({ ...filters, site: "chatgpt" }),
      "independent filter",
    );
    assert.equal(other.summary.requests, 0);
    assert.equal(other.aggregate_status, "current");
    assert.ok(rebuild, "the intended cache write must be intercepted");
    release();
    await bounded(rebuild, "Original cache write");
    f.coordinator.ledger.cacheSummary = original;
    const fresh = await bounded(
      f.coordinator.dashboard(filters),
      "refreshed Original view",
    );
    assert.equal(fresh.aggregate_status, "current");
    assert.equal(fresh.refreshAfterMs, null);
    assert.equal(fresh.summary.requests, 1);
    assert.equal(fresh.scopeToken, first.scopeToken);
  } finally {
    release();
    f.coordinator.ledger.cacheSummary = original;
    if (rebuild)
      await bounded(
        rebuild.catch(() => {}),
        "Original cleanup",
      );
    f.coordinator.history.invalidate();
    f.coordinator.engines.dispose();
    f.ledger.close();
  }
});

test("a completed default calculation can publish while an older dashboard cache build is held", async () => {
  const f = await setup();
  const original = f.coordinator.ledger.cacheSummary.bind(f.coordinator.ledger);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const heldStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  let heldKey: string | null = null;
  let heldWrite: Promise<void> | undefined;
  const writtenKeys = new Set<string>();
  try {
    await bounded(
      f.coordinator.dashboard({ site: "claude" }),
      "initial default view",
    );
    await f.coordinator.ledger.commitCapture({
      scope: f.scope,
      observations: records(),
    });
    f.coordinator.ledger.cacheSummary = (...args) => {
      if (
        heldKey === null &&
        (args[2] as { requests: number }).requests === 1
      ) {
        heldKey = args[1];
        heldWrite = gate.then(() => original(...args));
        started();
        return heldWrite;
      }
      return original(...args).then(() => {
        writtenKeys.add(args[1]);
      });
    };
    const stale = await bounded(
      f.coordinator.dashboard({ site: "claude" }),
      "pending default view",
    );
    assert.equal(stale.aggregate_status, "rebuilding");
    assert.equal(stale.summary.requests, 0);
    assert.equal(stale.calculation.view, "original");
    assert.equal(stale.calculation.pending, true);
    await bounded(heldStarted, "old generation cache write starts");
    assert.ok(
      heldWrite,
      "the old generation must still have a held cache write",
    );
    await bounded(
      f.coordinator.engines.maintainLocal(),
      "default recalculation",
    );
    const fresh = await bounded(
      f.coordinator.dashboard({ site: "claude" }),
      "new default generation",
    );
    assert.equal(fresh.aggregate_status, "current");
    assert.equal(fresh.summary.requests, 1);
    assert.equal(fresh.calculation.view, "recalculated");
    assert.equal(fresh.calculation.pending, false);
    assert.ok([...writtenKeys].some((key) => key !== heldKey));
    release();
    await assert.rejects(
      bounded(heldWrite, "superseded cache write"),
      /aggregate_inconsistent/,
    );
    const retained = await bounded(
      f.coordinator.dashboard({ site: "claude" }),
      "retained new generation",
    );
    assert.equal(retained.summary.requests, 1);
    assert.equal(retained.calculation.methodHash, fresh.calculation.methodHash);
  } finally {
    release();
    f.coordinator.ledger.cacheSummary = original;
    if (heldWrite)
      await bounded(
        heldWrite.catch(() => {}),
        "default cleanup",
      );
    f.coordinator.history.invalidate();
    f.coordinator.engines.dispose();
    f.ledger.close();
  }
});
test("dashboard build rejects a scope transition before caching or publishing", async () => {
  const f = await setup();
  try {
    const scan = f.ledger.scanRecords.bind(f.ledger);
    let moved = false;
    f.ledger.scanRecords = async (...args) => {
      const result = await scan(...args);
      if (!moved) {
        moved = true;
        await move(f);
      }
      return result;
    };
    await assert.rejects(f.coordinator.dashboard(), /policy_unavailable/);
    assert.equal(
      (await f.ledger.list<any>("dashboard_cache", f.scope.namespace)).filter(
        (row) => row.key.startsWith("summary:"),
      ).length,
      0,
    );
    assert.equal((await f.coordinator.dashboard()).summary.requests, 0);
  } finally {
    f.ledger.close();
  }
});
// Live QA of 19 October 2026: the dashboard and Settings showed "could not load" for as long as
// a reply streamed, because each progress commit moved the figures during every build.
test("the dashboard loads while a streaming reply commits new figures during every build", async () => {
  const f = await setup();
  const view = f.coordinator.history.view.bind(f.coordinator.history);
  let streaming = true;
  let commits = 0;
  try {
    f.coordinator.history.view = (async (...args: Parameters<typeof view>) => {
      const result = await view(...args);
      if (streaming) {
        commits++;
        await f.coordinator.ledger.commitCapture({ scope: f.scope, observations: records() });
      }
      return result;
    }) as typeof f.coordinator.history.view;
    const first = await bounded(
      f.coordinator.dashboard(),
      "dashboard without a saved summary while a reply streams",
    );
    assert.equal(first.aggregate_status, "rebuilding");
    assert.equal(first.refreshAfterMs, 2000);
    assert.ok(commits >= 3, "every attempt saw new figures");
    const again = await bounded(
      f.coordinator.dashboard(),
      "dashboard with a saved summary while a reply streams",
    );
    assert.equal(again.aggregate_status, "rebuilding");
    assert.equal(again.scopeToken, first.scopeToken);
    assert.equal(typeof again.settings, "object");
    streaming = false;
    await bounded(f.coordinator.engines.maintainLocal(), "calculation");
    let settled = await bounded(f.coordinator.dashboard(), "after the reply");
    for (let read = 0; settled.aggregate_status !== "current" && read < 5; read++) {
      await bounded(f.coordinator.engines.maintainLocal(), "calculation");
      settled = await bounded(f.coordinator.dashboard(), "after the reply");
    }
    assert.equal(settled.aggregate_status, "current");
    assert.equal(settled.summary.requests, commits);
  } finally {
    streaming = false;
    f.coordinator.history.view = view;
    f.coordinator.history.invalidate();
    f.coordinator.engines.dispose();
    f.ledger.close();
  }
});
test("independent tracking health retains memory failures when totals or durable health are unreadable", async () => {
  const f = await setup();
  try {
    await f.ledger.health(f.scope.namespace, "partial_capture");
    await f.ledger.health("company:PRIVATE_OTHER", "protocol_unsupported");
    f.health.report("tokenizer_unavailable", f.scope.namespace);
    f.health.report("capture_hook_missing", "company:PRIVATE_OTHER");
    const initial = await f.coordinator.trackingHealth();
    assert.equal(initial.status, "available");
    assert.deepEqual(
      initial.health.map((v) => v.code),
      ["partial_capture", "tokenizer_unavailable"],
    );
    assert.ok(!JSON.stringify(initial).includes("PRIVATE_OTHER"));
    const list = f.ledger.list.bind(f.ledger);
    f.ledger.list = async <T>(
      store: Parameters<Ledger["list"]>[0],
      ...args: [string, number?]
    ) => {
      if (store === "health")
        throw new DOMException("PRIVATE_ERROR", "InvalidStateError");
      return list<T>(store, ...args);
    };
    const unavailable = await f.coordinator.trackingHealth();
    assert.equal(unavailable.status, "unavailable");
    assert.equal(unavailable.scopeToken, initial.scopeToken);
    assert.ok(
      unavailable.health.some((v) => v.code === "storage_write_failed"),
    );
    assert.ok(
      unavailable.health.some((v) => v.code === "tokenizer_unavailable"),
    );
    assert.ok(!JSON.stringify(unavailable).includes("PRIVATE_ERROR"));
  } finally {
    f.ledger.close();
  }
});
test("health read cannot publish diagnostics from an obsolete scope", async () => {
  const f = await setup();
  try {
    await f.ledger.health(f.scope.namespace, "partial_capture");
    const list = f.ledger.list.bind(f.ledger);
    f.ledger.list = async <T>(
      store: Parameters<Ledger["list"]>[0],
      ...args: [string, number?]
    ) => {
      const result = await list<T>(store, ...args);
      if (store === "health") await move(f);
      return result;
    };
    await assert.rejects(f.coordinator.trackingHealth(), /policy_unavailable/);
  } finally {
    f.ledger.close();
  }
});
