import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { Ledger } from "@footprint/ledger";
import { scanSummary } from "../lib/summary-scan";
import { records } from "../../../packages/ledger/test/factory";
test("P01 all-recorded-time aggregation exceeds 10k with 200-row pages and bounded fast cache", async (t) => {
  const db = await Ledger.open("large-" + crypto.randomUUID());
  const scope = {
    namespace: "personal:large-history",
    mode: "personal" as const,
    era: null,
  };
  const count = 10050;
  for (let offset = 0; offset < count; offset += 100) {
    const batch = [];
    for (let i = offset; i < Math.min(count, offset + 100); i++)
      batch.push(...records());
    await db.commit(scope, batch);
  }
  let largestPage = 0;
  const original = db.scanRecords.bind(db);
  db.scanRecords = async (namespace, kind, consume) =>
    original(namespace, kind, (rows) => {
      largestPage = Math.max(largestPage, rows.length);
      return consume(rows);
    });
  const started = performance.now();
  const summary = await scanSummary(db, scope.namespace);
  const buildMs = performance.now() - started;
  assert.equal(summary.requests, count);
  assert.equal(summary.attempts, count);
  assert.equal(summary.tokens.answer.value, String(count * 100));
  assert.equal(summary.metrics.energy.value, null);
  assert.equal(largestPage, 200);
  const epoch = await db.get<{ version: number }>(
    "dashboard_cache",
    `epoch:${scope.namespace}`,
  );
  for (let i = 0; i < 20; i++)
    await db.cacheSummary(
      scope.namespace,
      `cache-${i}`,
      summary,
      epoch!.version,
    );
  const before = performance.now();
  const cached = await db.get<any>("dashboard_cache", "cache-19");
  const cacheMs = performance.now() - before;
  assert.equal(cached.summary.requests, count);
  assert.ok(cacheMs < 500);
  assert.ok(
    (await db.list("dashboard_cache", scope.namespace, 100)).length <= 17,
  );
  t.diagnostic(
    `10050 request families; scan ${buildMs.toFixed(1)} ms; cached read ${cacheMs.toFixed(2)} ms; largest page ${largestPage}; 16 cached summaries + epoch.`,
  );
  db.close();
});
