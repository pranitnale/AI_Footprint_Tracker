import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import {
  canonicalJson,
  EstimationEnvelopeSchema,
  UNAVAILABLE_ADMISSION_METHOD_ID,
} from "@footprint/contracts";
import { Ledger, type Scope } from "../src/index";
import { records } from "./factory";
import {
  createMethodRegistry,
  LocalEstimateExecutor,
} from "../../estimator/src/index";
import configuration from "../../../config/estimation.build.json";
import mappings from "../../../config/estimation.mappings.json";
import media from "../../../config/estimation.media.json";

const methods = createMethodRegistry(configuration, mappings, media);
const executor = new LocalEstimateExecutor(methods);
const personal: Scope = {
  namespace: "personal:admission-cache",
  mode: "personal",
  era: null,
};

async function open(t: TestContext) {
  const db = await Ledger.open(`admission-cache-${crypto.randomUUID()}`);
  t.after(() => db.close());
  await db.put("policy", {
    key: "personal",
    namespace: personal.namespace,
    secret: "synthetic-local-test-secret",
  });
  await db.put("policy", {
    key: "ownership-history",
    eras: [{ scope: personal, start: 0, end: null }],
  });
  return db;
}

const start = (db: Ledger) =>
  db.estimation.start({
    scope: personal,
    target: methods.ecologits,
    selectionRevision: 1,
  });

test("cache admission rejects stale calculation tokens without changing observation epoch or replacing saved bytes", async (t) => {
  const db = await open(t);
  const pair = records();
  const original = await executor.estimate({
    family: "live",
    request: pair[0],
    attempt: pair[1],
  });
  await db.capture(personal, pair, [original]);
  const epochKey = `epoch:${personal.namespace}`;
  const epoch = await db.get<{ key: string; version: number }>(
    "dashboard_cache",
    epochKey,
  );
  assert.ok(epoch);
  const cacheKey = `${personal.namespace}:summary:all`;
  const initial = await db.estimation.localSelectionState(personal);
  assert.equal(initial.status, "ready");
  const guard = (token: string) => ({
    authorityScope: personal,
    localSelectionToken: token,
  });
  await db.cacheSummary(
    personal.namespace,
    cacheKey,
    { total: 1 },
    epoch.version,
    guard(initial.token),
  );
  assert.equal(
    (await db.get<any>("dashboard_cache", cacheKey)).calculationToken,
    initial.token,
  );

  async function replaceWithFreshToken(staleToken: string, total: number) {
    const saved = canonicalJson(await db.get("dashboard_cache", cacheKey));
    const fresh = await db.estimation.localSelectionState(personal);
    assert.notEqual(fresh.token, staleToken);
    assert.deepEqual(await db.get("dashboard_cache", epochKey), epoch);
    await assert.rejects(
      db.cacheSummary(
        personal.namespace,
        cacheKey,
        { total: -1 },
        epoch!.version,
        guard(staleToken),
      ),
      /aggregate_inconsistent/,
    );
    assert.equal(
      canonicalJson(await db.get("dashboard_cache", cacheKey)),
      saved,
    );
    await db.cacheSummary(
      personal.namespace,
      cacheKey,
      { total },
      epoch!.version,
      guard(fresh.token),
    );
    const cache = await db.get<any>("dashboard_cache", cacheKey);
    assert.deepEqual(cache.summary, { total });
    assert.equal(cache.calculationToken, fresh.token);
    assert.deepEqual(
      (await db.all<{ key: string }>("dashboard_cache"))
        .filter((row) => row.key !== epochKey)
        .map((row) => row.key),
      [cacheKey],
    );
    return fresh.token;
  }

  const job = await start(db);
  const runningToken = await replaceWithFreshToken(initial.token, 2);
  const input = (await db.estimation.page(job.id)).inputs[0];
  assert.ok(input && input.family === "live");
  assert.ok(input.originalMethodHash);
  const recalculated = await executor.estimate(
    {
      family: "live",
      request: input.request,
      attempt: input.attempt,
      canonicalRequestBinding: input.source.canonical_request_binding,
    },
    {
      view: "recalculated",
      methodId: methods.ecologits.method_id,
      originalMethodHash: input.originalMethodHash,
    },
  );
  assert.equal(
    await db.estimation.commitResult({
      jobId: job.id,
      inputKey: input.key,
      sequence: input.sequence,
      result: recalculated,
    }),
    "applied",
  );
  await db.estimation.promote(job.id);
  const publishedToken = await replaceWithFreshToken(runningToken, 3);

  assert.equal(
    await db.estimation.compareAndSetPreference(null, {
      schema_version: "1.0.0",
      preference: "original",
      selection_revision: 1,
      updated_at: "2026-09-15T12:00:00.000Z",
    }),
    true,
  );
  await replaceWithFreshToken(publishedToken, 4);

  await db.cacheSummary(
    personal.namespace,
    cacheKey,
    { total: 5 },
    epoch.version,
  );
  const compatible = await db.get<any>("dashboard_cache", cacheKey);
  assert.deepEqual(compatible.summary, { total: 5 });
  assert.equal(Object.hasOwn(compatible, "calculationToken"), false);
  assert.deepEqual(await db.get("dashboard_cache", epochKey), epoch);
  assert.equal((await db.all("dashboard_cache")).length, 2);
});

test("local summaries cached before per-reply image references are rebuilt", async (t) => {
  const db = await open(t);
  const pair = records();
  const original = await executor.estimate({
    family: "live",
    request: pair[0],
    attempt: pair[1],
  });
  await db.capture(personal, pair, [original]);
  const epoch = await db.get<{ key: string; version: number }>(
    "dashboard_cache",
    `epoch:${personal.namespace}`,
  );
  const cacheKey = `${personal.namespace}:summary:all`;
  await db.cacheSummary(
    personal.namespace,
    cacheKey,
    { total: 5 },
    epoch!.version,
  );
  const saved = await db.get<any>("dashboard_cache", cacheKey);
  assert.equal(saved.summaryFormatVersion, 3);
  // An older build cached summaries without per-reply image references (W12 review).
  const raw = (db as unknown as { db: IDBDatabase }).db;
  await new Promise<void>((resolve, reject) => {
    const tx = raw.transaction("dashboard_cache", "readwrite");
    tx.objectStore("dashboard_cache").put({
      ...saved,
      summaryFormatVersion: 2,
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  assert.equal(await db.get("dashboard_cache", cacheKey), undefined);
});

test("a later unavailable-admission marker cannot replace earlier proposed or uncertain immutable admission", async (t) => {
  for (const earlierProposal of [methods.original.method_id, null]) {
    await t.test(
      earlierProposal === null
        ? "earlier null proposal"
        : "earlier known proposal",
      async (subtest) => {
        const db = await open(subtest);
        const pair = records();
        pair[1].proposed_method_id = earlierProposal;
        await db.capture(personal, pair);
        const earlier = await db.estimation.liveInput(
          personal,
          pair[1].attempt_id,
        );
        assert.equal(earlier?.originalMethodState, "unavailable");
        assert.equal(earlier?.originalMethodHash, null);
        const firstMeasurementKey = `${personal.namespace}:attempt:${pair[1].attempt_id}:1`;
        const firstMeasurement = canonicalJson(
          await db.get("measurements", firstMeasurementKey),
        );
        await db.write(personal, {
          ...pair[1],
          revision: 2,
          proposed_method_id: UNAVAILABLE_ADMISSION_METHOD_ID,
          company_dedup_key: null,
        });
        const current = await db.estimation.liveInput(
          personal,
          pair[1].attempt_id,
        );
        assert.ok(current);
        assert.equal(current.attempt.revision, 2);
        assert.equal(
          current.attempt.proposed_method_id,
          UNAVAILABLE_ADMISSION_METHOD_ID,
        );
        assert.equal(current.originalMethodState, "unavailable");
        assert.equal(current.originalMethodHash, null);
        const job = await start(db);
        const result = await executor.estimate(
          {
            family: "live",
            request: current.request,
            attempt: current.attempt,
            canonicalRequestBinding: current.source.canonical_request_binding,
          },
          {
            view: "recalculated",
            methodId: methods.ecologits.method_id,
            originalMethodMissing: true,
          },
        );
        EstimationEnvelopeSchema.parse(result);
        assert.equal(result.original_method_hash, null);
        assert.ok(result.reasons.includes("original_method_missing"));
        await assert.rejects(
          db.estimation.commitResult({
            jobId: job.id,
            inputKey: current.key,
            sequence: current.sequence,
            result,
          }),
          /method_update_invalid/,
        );
        assert.equal((await db.estimation.page(job.id)).job.processed, 0);
        assert.equal((await db.all("estimation_results")).length, 0);
        assert.equal((await db.all("estimation_originals")).length, 0);
        assert.equal(
          canonicalJson(await db.get("measurements", firstMeasurementKey)),
          firstMeasurement,
        );
      },
    );
  }
});

test("unavailable-admission markers at every immutable revision permit a genuine result without an original hash", async (t) => {
  const db = await open(t);
  const pair = records();
  pair[1].proposed_method_id = UNAVAILABLE_ADMISSION_METHOD_ID;
  await db.capture(personal, pair);
  for (const revision of [2, 3])
    await db.write(personal, { ...pair[1], revision });
  const before = canonicalJson(await db.all("measurements"));
  const input = await db.estimation.liveInput(personal, pair[1].attempt_id);
  assert.ok(input);
  assert.equal(input.attempt.revision, 3);
  assert.equal(input.originalMethodState, "not_admitted");
  assert.equal(input.originalMethodHash, null);
  assert.equal((await db.all("local_estimates")).length, 0);
  assert.equal((await db.all("estimation_originals")).length, 0);
  const job = await start(db);
  const result = await executor.estimate(
    {
      family: "live",
      request: input.request,
      attempt: input.attempt,
      canonicalRequestBinding: input.source.canonical_request_binding,
    },
    {
      view: "recalculated",
      methodId: methods.ecologits.method_id,
      originalMethodMissing: true,
    },
  );
  EstimationEnvelopeSchema.parse(result);
  assert.equal(result.original_method_hash, null);
  assert.ok(result.reasons.includes("original_method_missing"));
  assert.equal(
    await db.estimation.commitResult({
      jobId: job.id,
      inputKey: input.key,
      sequence: input.sequence,
      result,
    }),
    "applied",
  );
  await db.estimation.promote(job.id);
  const selected = await db.estimation.viewPage({
    scope: personal,
    view: "selected",
  });
  assert.equal(selected.rows.length, 1);
  assert.equal(selected.rows[0].state, "selected");
  assert.deepEqual(selected.rows[0].result, result);
  assert.equal(canonicalJson(await db.all("measurements")), before);
});
