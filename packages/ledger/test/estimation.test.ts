import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import {
  composeOutputTotal,
  canonicalJson,
  payloadHash,
  calculationInputHash,
  HistoryMessageSchema,
  historyNumericPayloadHash,
  type EstimationEnvelope,
} from "@footprint/contracts";
import {
  Ledger,
  historyAuthority,
  type EstimationInput,
  type EstimationRepository,
  type Scope,
} from "../src/index";
import { records, scope } from "./factory";
import configuration from "../../../config/estimation.build.json";
import mappings from "../../../config/estimation.mappings.json";
import media from "../../../config/estimation.media.json";
import {
  createMethodRegistry,
  LocalEstimateExecutor,
  estimateAttempt,
  estimateHistoricalText,
} from "../../estimator/src/index";
import { completed, request } from "../src/ledger-support";

const methods = createMethodRegistry(configuration, mappings, media),
  executor = new LocalEstimateExecutor(methods);
/** Test-only policy: the shipped policy never routes to the original engine. */
const legacyMethods = createMethodRegistry(
    {
      ...configuration,
      ecologits_fallback: {
        ...configuration.ecologits_fallback,
        unknown_provider: { strategy: "original_engine" as const },
      },
    },
    mappings,
    media,
  ),
  legacyExecutor = new LocalEstimateExecutor(legacyMethods);
const personal: Scope = {
  namespace: "personal:ledger-estimation",
  mode: "personal",
  era: null,
};
const open = () => Ledger.open("estimation-" + crypto.randomUUID());
const numeric = (input: EstimationInput) =>
  input.family === "live"
    ? {
        family: "live" as const,
        request: input.request,
        attempt: input.attempt,
        history: input.family === "live" ? input.history : undefined,
        canonicalRequestBinding: input.source.canonical_request_binding,
      }
    : { family: "history" as const, record: input.history };
async function seed(db: Ledger, owner: Scope = scope) {
  const pair = records();
  const original = await executor.estimate({
    family: "live",
    request: pair[0],
    attempt: pair[1],
  });
  await db.commit(owner, pair, [
    {
      store: "local_estimates",
      value: {
        key: `current:${owner.namespace}:${pair[1].attempt_id}`,
        namespace: owner.namespace,
        selection: "current",
        estimate: original,
      },
    },
    {
      store: "local_estimates",
      value: {
        key: `${owner.namespace}:${pair[1].attempt_id}:1:${original.requested_method.method_id}:original`,
        namespace: owner.namespace,
        estimate: original,
      },
    },
  ]);
  return { pair, original };
}
const start = (db: Ledger, owner: Scope = scope) =>
  db.estimation.start({
    scope: owner,
    target: methods.ecologits,
    selectionRevision: 1,
  });
const calculated = (input: EstimationInput) =>
  executor.estimate(numeric(input), {
    methodId: methods.ecologits.method_id,
    view: "recalculated",
    originalMethodHash: input.originalMethodHash!,
  });
async function finish(db: Ledger, jobId: string) {
  for (let count = 0; count < 100; count++) {
    const page = await db.estimation.page(jobId, 2);
    for (const input of page.inputs)
      assert.equal(
        await db.estimation.commitResult({
          jobId,
          inputKey: input.key,
          sequence: input.sequence,
          result: await calculated(input),
        }),
        "applied",
      );
    if ((await db.estimation.page(jobId, 2)).done)
      return db.estimation.promote(jobId);
  }
  throw new Error("job did not finish");
}

test("ST02 genuine envelope2 capture validates atomically and keeps compatibility rows and original bytes", async () => {
  const db = await open();
  try {
    const { pair, original } = await seed(db),
      before = canonicalJson(await db.all("measurements"));
    assert.equal(
      (await db.currentEstimates<any>(scope.namespace))[0].estimate
        .schema_version,
      "3.0.0",
    );
    assert.equal(
      canonicalJson((await db.all<any>("estimation_originals"))[0].result),
      canonicalJson(original),
    );
    const job = await start(db);
    await finish(db, job.id);
    assert.equal(canonicalJson(await db.all("measurements")), before);
    assert.equal(
      canonicalJson((await db.all<any>("estimation_originals"))[0].result),
      canonicalJson(original),
    );
    const selected = await db.estimation.viewPage({ scope, view: "selected" });
    assert.equal(selected.rows.length, 1);
    assert.equal(selected.rows[0].state, "selected");
    assert.equal(
      selected.rows[0].result!.requested_method.engine_id,
      "ecologits",
    );
    assert.equal((await db.pending(scope.namespace)).length, 2);
    assert.deepEqual(
      await db.estimation.resultFor(
        scope,
        original.source,
        methods.ecologits.method_hash,
      ),
      selected.rows[0].result,
    );
    assert.equal(
      (await db.getRecord(scope.namespace, "attempt", pair[1].attempt_id))
        ?.hash,
      payloadHash(pair[1]),
    );
  } finally {
    db.close();
  }
});

test("PR19 bounded jobs resume after reopen; partial or out-of-order work cannot promote", async () => {
  const name = "restart-" + crypto.randomUUID();
  let db = await Ledger.open(name);
  try {
    await seed(db);
    await seed(db);
    await seed(db);
    const job = await start(db),
      page = await db.estimation.page(job.id, 2);
    assert.equal(page.inputs.length, 2);
    assert.equal(page.done, false);
    await assert.rejects(
      db.estimation.promote(job.id),
      /recalculation_incomplete/,
    );
    const second = page.inputs[1];
    const result = await calculated(second);
    await db.estimation.commitResult({
      jobId: job.id,
      inputKey: second.key,
      sequence: second.sequence,
      result,
    });
    db.close();
    db = await Ledger.open(name);
    assert.equal((await db.estimation.resume(scope))?.id, job.id);
    const retry = await db.estimation.page(job.id, 2);
    assert.equal(retry.inputs[0].key, page.inputs[0].key);
    assert.equal(
      await db.estimation.commitResult({
        jobId: job.id,
        inputKey: second.key,
        sequence: second.sequence,
        result,
      }),
      "duplicate",
    );
    await finish(db, job.id);
    assert.equal(
      (await db.estimation.viewPage({ scope, view: "selected" })).rows.filter(
        (row) => row.state === "selected",
      ).length,
      3,
    );
  } finally {
    db.close();
  }
});

test("PR20 same-key corrections behind a cursor and new observations become explicit incremental work", async () => {
  const db = await open();
  try {
    const first = await seed(db);
    await seed(db);
    const job = await start(db),
      page = await db.estimation.page(job.id, 1),
      input = page.inputs[0];
    await db.estimation.commitResult({
      jobId: job.id,
      inputKey: input.key,
      sequence: input.sequence,
      result: await calculated(input),
    });
    assert.equal(input.family, "live");
    if (input.family !== "live") throw 0;
    const changed = { ...input.attempt, revision: 2 };
    await db.write(scope, changed);
    await seed(db);
    assert.equal(
      await db.estimation.commitResult({
        jobId: job.id,
        inputKey: input.key,
        sequence: input.sequence,
        result: await calculated(input),
      }),
      "stale",
    );
    const completed = await finish(db, job.id);
    assert.equal(completed.pending, 2);
    assert.equal(completed.processed, 1);
    assert.equal(completed.snapshotTotal, 1);
    const view = await db.estimation.viewPage({ scope, view: "selected" });
    assert.equal(view.rows.filter((row) => row.state === "pending").length, 2);
    assert.equal((await db.pending(scope.namespace)).length, 7);
    const incremental = await start(db);
    await finish(db, incremental.id);
    assert.equal(
      (await db.estimation.viewPage({ scope, view: "selected" })).rows.filter(
        (row) => row.state === "selected",
      ).length,
      3,
    );
  } finally {
    db.close();
  }
});

test("BE preference compare-and-set races, supersession and cancellation reject late publication", async () => {
  const db = await open();
  try {
    await seed(db);
    const job = await start(db),
      input = (await db.estimation.page(job.id)).inputs[0],
      result = await calculated(input);
    const preference = {
      schema_version: "1.0.0" as const,
      preference: "ecologits" as const,
      selection_revision: 1,
      updated_at: "2026-09-15T12:00:00.000Z",
    };
    assert.deepEqual(
      (
        await Promise.all([
          db.estimation.compareAndSetPreference(null, preference),
          db.estimation.compareAndSetPreference(null, {
            ...preference,
            preference: "original",
          }),
        ])
      ).sort(),
      [false, true],
    );
    assert.equal(
      await db.estimation.commitResult({
        jobId: job.id,
        inputKey: input.key,
        sequence: input.sequence,
        result,
      }),
      "stale",
    );
    await assert.rejects(db.estimation.promote(job.id), /stale/);
    await assert.rejects(
      db.estimation.compareAndSetPreference(1, {
        ...preference,
        selection_revision: 3,
      }),
      /revision_conflict/,
    );
    const replacement = await start(db);
    await db.estimation.cancel(replacement.id);
    assert.equal(await db.estimation.resume(scope), null);
    assert.equal((await db.all("estimation_results")).length, 0);
    assert.equal((await db.all("estimation_originals")).length, 1);
  } finally {
    db.close();
  }
});

test("ST02 injected quota failure rolls back observations, originals, cursor and outbox together", async () => {
  const db = await open();
  const prototype = IDBObjectStore.prototype,
    put = prototype.put;
  try {
    prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
      if (this.name === "estimation_originals")
        throw new DOMException("fixture full", "QuotaExceededError");
      return put.apply(this, args);
    };
    await assert.rejects(seed(db), /fixture full/);
    prototype.put = put;
    for (const name of [
      "requests",
      "attempts",
      "measurements",
      "outbox",
      "local_estimates",
      "estimation_inputs",
      "estimation_originals",
    ] as const)
      assert.equal((await db.all(name)).length, 0, name);
    await seed(db);
    const job = await start(db),
      input = (await db.estimation.page(job.id)).inputs[0],
      result = await calculated(input);
    prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
      if (this.name === "estimation_jobs")
        throw new DOMException("fixture full", "QuotaExceededError");
      return put.apply(this, args);
    };
    await assert.rejects(
      db.estimation.commitResult({
        jobId: job.id,
        inputKey: input.key,
        sequence: input.sequence,
        result,
      }),
      /fixture full/,
    );
    prototype.put = put;
    assert.equal((await db.estimation.resume(scope))?.processed, 0);
    assert.equal((await db.all("estimation_results")).length, 0);
    await finish(db, job.id);
    assert.equal((await db.pending(scope.namespace)).length, 2);
  } finally {
    prototype.put = put;
    db.close();
  }
});

test("PR17 wrong source, method, self-consistent forged alias and input hash cannot publish", async () => {
  const db = await open();
  try {
    const { pair } = await seed(db);
    const other = await seed(db);
    const job = await start(db),
      input = (await db.estimation.page(job.id)).inputs[0],
      result = await calculated(input);
    await assert.rejects(
      db.estimation.commitResult({
        jobId: job.id,
        inputKey: input.key,
        sequence: input.sequence,
        result: { ...result, input_hash: "f".repeat(64) },
      }),
    );
    const wrongMethod: EstimationEnvelope = structuredClone(result);
    wrongMethod.requested_method.method_hash = "f".repeat(64);
    wrongMethod.input_hash = calculationInputHash(wrongMethod);
    await assert.rejects(
      db.estimation.commitResult({
        jobId: job.id,
        inputKey: input.key,
        sequence: input.sequence,
        result: wrongMethod,
      }),
      /method_update_invalid|complete method identity/,
    );
    const forged: EstimationEnvelope = structuredClone(result);
    if (forged.source.family !== "live") throw 0;
    const target =
      forged.source.request_id === pair[0].request_id ? other.pair[0] : pair[0];
    forged.source.canonical_request_binding = {
      observed_request_id: forged.source.request_id,
      canonical_request_id: target.request_id,
      relation_hash: payloadHash({
        kind: "canonical_request_alias",
        observed_request_id: forged.source.request_id,
        canonical_request_id: target.request_id,
      }),
    };
    forged.source.request_id = target.request_id;
    forged.source.request_hash = payloadHash(target);
    forged.input_hash = calculationInputHash(forged);
    assert.equal(
      await db.estimation.commitResult({
        jobId: job.id,
        inputKey: input.key,
        sequence: input.sequence,
        result: forged,
      }),
      "stale",
    );
    assert.equal((await db.estimation.resume(scope))?.processed, 0);
  } finally {
    db.close();
  }
});

test("ST12 canonical alias chains bind actual scoped request bytes without changing attempt bytes", async () => {
  const db = await open();
  try {
    const a = await seed(db),
      b = await seed(db),
      c = await seed(db),
      before = canonicalJson(await db.all("measurements"));
    await db.markAlias(
      scope.namespace,
      "request",
      a.pair[0].request_id,
      b.pair[0].request_id,
    );
    await db.markAlias(
      scope.namespace,
      "request",
      b.pair[0].request_id,
      c.pair[0].request_id,
    );
    const prepared = await db.estimation.liveInput(scope, a.pair[1].attempt_id);
    assert.equal(prepared?.source.request_id, c.pair[0].request_id);
    assert.equal(prepared?.attempt.request_id, a.pair[0].request_id);
    assert.equal(
      await db.estimation.liveInput(
        { ...scope, era: "another-era" },
        a.pair[1].attempt_id,
      ),
      null,
    );
    assert.equal((await db.all("estimation_jobs")).length, 0);
    const job = await start(db),
      page = await db.estimation.page(job.id),
      input = page.inputs.find(
        (row) =>
          row.family === "live" &&
          row.attempt.attempt_id === a.pair[1].attempt_id,
      )!;
    assert.ok(input && input.family === "live");
    if (input.family !== "live") throw 0;
    assert.equal(input.source.request_id, c.pair[0].request_id);
    assert.equal(input.attempt.request_id, a.pair[0].request_id);
    assert.equal(input.source.attempt_hash, payloadHash(a.pair[1]));
    const result = await calculated(input);
    await db.write(scope, { ...c.pair[0], revision: 2 });
    assert.equal(
      await db.estimation.commitResult({
        jobId: job.id,
        inputKey: input.key,
        sequence: input.sequence,
        result,
      }),
      "stale",
    );
    const oldRows = JSON.parse(before) as any[];
    const after = await db.all<any>("measurements");
    for (const old of oldRows)
      assert.equal(
        canonicalJson(after.find((row) => row.key === old.key)),
        canonicalJson(old),
      );
    const again = await start(db);
    await finish(db, again.id);
  } finally {
    db.close();
  }
});

test("ST07 deletion removes every result variant and makes outstanding generations unavailable", async () => {
  const db = await open();
  try {
    const { pair, original } = await seed(db);
    const job = await start(db);
    await finish(db, job.id);
    await db.write(scope, { ...pair[1], revision: 2 });
    const running = await start(db),
      input = (await db.estimation.page(running.id)).inputs[0],
      result = await calculated(input);
    await db.eraseFamily(scope.namespace, pair[0].request_id);
    for (const name of [
      "estimation_results",
      "estimation_originals",
      "estimation_jobs",
      "estimation_inputs",
      "local_estimates",
    ] as const)
      assert.equal((await db.all(name)).length, 0, name);
    assert.equal(
      await db.estimation.commitResult({
        jobId: running.id,
        inputKey: input.key,
        sequence: input.sequence,
        result,
      }),
      "stale",
    );
    await assert.rejects(db.capture(scope, pair, [original]), /record_erased/);
    assert.equal(
      await db.estimation.resultFor(
        scope,
        original.source,
        methods.original.method_hash,
      ),
      null,
    );
  } finally {
    db.close();
  }
});

test("ST14 ST15 installation preference stays local and ownership/era changes block stale jobs", async () => {
  const db = await open();
  try {
    await seed(db, personal);
    assert.equal((await db.all("outbox")).length, 0);
    const job = await start(db, personal),
      input = (await db.estimation.page(job.id)).inputs[0],
      result = await calculated(input);
    await db.put("policy", {
      key: "ownership-history",
      eras: [{ scope, start: 0, end: null }],
    });
    assert.equal(
      await db.estimation.commitResult({
        jobId: job.id,
        inputKey: input.key,
        sequence: input.sequence,
        result,
      }),
      "stale",
    );
    assert.equal(
      (await db.estimation.viewPage({ scope, view: "original" })).rows.length,
      0,
    );
    assert.equal((await db.all("outbox")).length, 0);
    assert.equal((await db.all("estimation_originals")).length, 1);
    await db.remove("policy", "ownership-history");
    const company = await seed(db);
    await assert.rejects(
      db.write({ ...scope, era: "era-2" }, { ...company.pair[1], revision: 2 }),
      /policy_unavailable/,
    );
    const companyJob = await start(db);
    await db.put("policy", {
      key: "credentials",
      namespace: scope.namespace,
      enrollment_era: { id: "era-2" },
      enrollment_state: "active",
    });
    assert.equal(await db.estimation.resume(scope), null);
    await assert.rejects(db.estimation.promote(companyJob.id), /stale/);
  } finally {
    db.close();
  }
});

test("PR16 unavailable source and absent original implementation are durable terminal outcomes", async () => {
  const db = await open();
  try {
    const pair = records();
    await db.commit(scope, pair);
    const job = await start(db),
      page = await db.estimation.page(job.id);
    assert.equal(page.inputs[0].originalMethodHash, null);
    const input = page.inputs[0];
    await db.estimation.markUnavailable({
      jobId: job.id,
      inputKey: input.key,
      sequence: input.sequence,
      reason: "original_method_missing",
    });
    const done = await db.estimation.promote(job.id);
    assert.equal(done.unavailable, 1);
    assert.equal(
      (await db.estimation.viewPage({ scope, view: "selected" })).rows[0].state,
      "unavailable",
    );
    const second = records();
    await db.commit(scope, second);
    await db.markAlias(
      scope.namespace,
      "request",
      pair[0].request_id,
      second[0].request_id,
    );
    await db.markAlias(
      scope.namespace,
      "request",
      second[0].request_id,
      pair[0].request_id,
    );
    const next = await start(db),
      missing = await db.estimation.page(next.id);
    assert.equal(missing.unavailable.length, 2);
    assert.equal(missing.done, true);
  } finally {
    db.close();
  }
});

test("PR20 incremental catch-up reuses 101 immutable results without scanning or cloning a completed generation", async () => {
  const db = await open();
  try {
    for (let i = 0; i < 101; i++) await seed(db, personal);
    const initial = await start(db, personal);
    const firstPage = await db.estimation.page(initial.id, 100);
    const template = await calculated(firstPage.inputs[0]);
    const fakeEngine = async (
      input: EstimationInput,
    ): Promise<EstimationEnvelope> => {
      const result: EstimationEnvelope = {
        ...structuredClone(template),
        source: input.source,
        original_method_hash: input.originalMethodHash,
      };
      result.input_hash = calculationInputHash(result);
      return result;
    };
    for (;;) {
      const page = await db.estimation.page(initial.id, 100);
      for (const input of page.inputs)
        await db.estimation.commitResult({
          jobId: initial.id,
          inputKey: input.key,
          sequence: input.sequence,
          result: await fakeEngine(input),
        });
      if (page.done) break;
    }
    await db.estimation.promote(initial.id);
    const old = await db.all<any>("estimation_results");
    assert.equal(old.length, 101);
    const newcomer = await seed(db, personal);
    const incremental = await start(db, personal);
    assert.equal(incremental.snapshotTotal, 1);
    assert.equal(incremental.cursor, initial.watermark);
    const only = await db.estimation.page(incremental.id, 100);
    assert.equal(only.inputs.length, 1);
    const input = only.inputs[0],
      result = await fakeEngine(input);
    await db.estimation.commitResult({
      jobId: incremental.id,
      inputKey: input.key,
      sequence: input.sequence,
      result,
    });
    assert.equal(
      await db.estimation.resultFor(
        personal,
        input.source,
        methods.ecologits.method_hash,
      ),
      null,
    );
    assert.equal((await db.estimation.state(personal)).pending, 1);
    await db.estimation.promote(incremental.id);
    const after = await db.all<any>("estimation_results");
    assert.equal(after.length, 102);
    for (const row of old)
      assert.equal(
        canonicalJson(after.find((value) => value.key === row.key)),
        canonicalJson(row),
      );
    assert.deepEqual(
      await db.estimation.resultFor(
        personal,
        input.source,
        methods.ecologits.method_hash,
      ),
      result,
    );
    assert.equal((await db.estimation.state(personal)).pending, 0);
    const idle = await start(db, personal);
    assert.equal(idle.snapshotTotal, 0);
    assert.equal((await db.estimation.page(idle.id)).inputs.length, 0);
    await db.estimation.cancel(idle.id);
    assert.equal((await db.all("estimation_results")).length, 102);
    assert.ok(newcomer.original);
  } finally {
    db.close();
  }
});

test("BE calculation publication advances independently of observation epochs and recorded-page coverage", async () => {
  const db = await open();
  try {
    const pair = records();
    pair[1].tokens.answer_output.value = "0";
    pair[1].tokens.output_total = composeOutputTotal(pair[1].tokens);
    const original = await executor.estimate({
      family: "live",
      request: pair[0],
      attempt: pair[1],
    });
    await db.capture(scope, pair, [original]);
    const job = await start(db),
      input = (await db.estimation.page(job.id)).inputs[0];
    const result = await calculated(input);
    assert.equal(result.status, "unavailable");
    await db.estimation.commitResult({
      jobId: job.id,
      inputKey: input.key,
      sequence: input.sequence,
      result,
    });
    assert.equal((await db.estimation.resume(scope))!.unavailable, 1);
    const before = await db.publicationSnapshot(scope.namespace);
    const coverage = {
      key: `coverage:${scope.namespace}`,
      namespace: scope.namespace,
      observedPageRequests: 5,
      version: before.version,
      erasureVersion: before.erasureVersion,
    };
    await db.put("dashboard_cache", coverage);
    const linksBefore = canonicalJson(await db.all("thread_relations"));
    const initialVersion = (await db.estimation.state(scope))
      .publicationVersion;
    const assertObserved = async () => {
      assert.deepEqual(await db.publicationSnapshot(scope.namespace), before);
      assert.equal(
        canonicalJson(await db.all("thread_relations")),
        linksBefore,
      );
      assert.deepEqual(await db.get("dashboard_cache", coverage.key), coverage);
    };
    await db.estimation.promote(job.id);
    const promoted = (await db.estimation.state(scope)).publicationVersion;
    assert.equal(promoted, initialVersion + 1);
    await assertObserved();
    await db.estimation.compareAndSetPreference(null, {
      schema_version: "1.0.0",
      preference: "original",
      selection_revision: 1,
      updated_at: "2026-09-15T12:00:00.000Z",
    });
    const changed = (await db.estimation.state(scope)).publicationVersion;
    assert.equal(changed, promoted + 1);
    await assertObserved();
    const next = await start(db);
    await db.estimation.cancel(next.id);
    assert.equal(
      (await db.estimation.state(scope)).publicationVersion,
      changed + 1,
    );
    await assertObserved();
  } finally {
    db.close();
  }
});

test("PR17 returning to an earlier ownership scope does not revive its interrupted generation", async () => {
  const db = await open();
  try {
    await db.put("policy", { key: "personal", namespace: personal.namespace });
    await db.put("policy", {
      key: "ownership-history",
      eras: [{ scope: personal, start: 0, end: null }],
    });
    await seed(db, personal);
    const job = await start(db, personal),
      input = (await db.estimation.page(job.id)).inputs[0],
      result = await calculated(input);
    await db.put("policy", {
      key: "ownership-history",
      eras: [
        { scope: personal, start: 0, end: 1 },
        { scope, start: 1, end: 2 },
        { scope: personal, start: 2, end: null },
      ],
    });
    assert.equal(
      await db.estimation.commitResult({
        jobId: job.id,
        inputKey: input.key,
        sequence: input.sequence,
        result,
      }),
      "stale",
    );
    const replacement = await start(db, personal);
    assert.notEqual(replacement.id, job.id);
  } finally {
    db.close();
  }
});

test("ST12 malformed reconciliation envelope cannot partially replace canonical observations or outbox", async () => {
  const db = await open();
  try {
    const { pair, original } = await seed(db),
      before = canonicalJson(await db.all("measurements")),
      queue = canonicalJson(await db.pending(scope.namespace));
    const corrected = { ...pair[1], revision: 2 };
    await assert.rejects(
      db.reconcile(
        scope.namespace,
        corrected,
        payloadHash(corrected),
        undefined,
        undefined,
        { ...original, input_hash: "f".repeat(64) },
      ),
    );
    assert.equal(canonicalJson(await db.all("measurements")), before);
    assert.equal(canonicalJson(await db.pending(scope.namespace)), queue);
    await db.eraseFamily(scope.namespace, pair[0].request_id);
    await assert.rejects(
      db.reconcile(scope.namespace, pair[0], payloadHash(pair[0])),
      /record_erased/,
    );
  } finally {
    db.close();
  }
});

test("AR05 a bounded orchestrator can substitute both the repository and executor through narrow contracts", async () => {
  const db = await open();
  try {
    await seed(db);
    const job = await start(db),
      page = await db.estimation.page(job.id),
      result = await calculated(page.inputs[0]);
    type WorkerStorage = Pick<
      EstimationRepository,
      "page" | "commitResult" | "promote"
    >;
    const run = async (
      storage: WorkerStorage,
      engine: (input: EstimationInput) => Promise<EstimationEnvelope>,
    ) => {
      const next = await storage.page(job.id, 1);
      for (const input of next.inputs)
        await storage.commitResult({
          jobId: job.id,
          inputKey: input.key,
          sequence: input.sequence,
          result: await engine(input),
        });
      return storage.promote(job.id);
    };
    const accepted: EstimationEnvelope[] = [];
    const fake: WorkerStorage = {
      page: async () => structuredClone(page),
      commitResult: async (input) => {
        accepted.push(input.result);
        return "applied";
      },
      promote: async () => ({ ...job, status: "complete", processed: 1 }),
    };
    assert.equal((await run(fake, async () => result)).status, "complete");
    assert.deepEqual(accepted, [result]);
    assert.equal(
      (await run(db.estimation, async () => result)).status,
      "complete",
    );
    assert.equal((await db.estimation.state(scope)).selected?.processed, 1);
  } finally {
    db.close();
  }
});

test("cancelling a published incremental view clears inherited results and allows a clean restart", async () => {
  const db = await open();
  try {
    await seed(db);
    const initial = await start(db);
    await finish(db, initial.id);
    await seed(db);
    const incremental = await start(db);
    await finish(db, incremental.id);
    await db.estimation.cancel(incremental.id);
    assert.equal((await db.all("estimation_results")).length, 0);
    const restart = await start(db);
    assert.equal(restart.snapshotTotal, 2);
    await finish(db, restart.id);
    assert.equal(
      (await db.estimation.viewPage({ scope, view: "selected" })).rows.filter(
        (row) => row.state === "selected",
      ).length,
      2,
    );
  } finally {
    db.close();
  }
});

test("an unavailable older executor cannot erase a validated family method pin when later numeric revisions arrive", async () => {
  const db = await open();
  try {
    const pair = records();
    pair[1].proposed_method_id = methods.original.method_id;
    const original = await executor.estimate({
      family: "live",
      request: pair[0],
      attempt: pair[1],
    });
    await db.capture(scope, pair, [original]);
    const next = { ...pair[1], revision: 2 };
    await db.commit(
      scope,
      [next],
      [
        {
          store: "local_estimates",
          value: {
            key: `current:${scope.namespace}:${next.attempt_id}`,
            namespace: scope.namespace,
            selection: "current",
            estimate: null,
          },
        },
      ],
    );
    const job = await start(db),
      input = (await db.estimation.page(job.id)).inputs[0];
    assert.equal(
      input.originalMethodHash,
      original.requested_method.method_hash,
    );
    assert.equal(input.family === "live" && input.source.attempt_revision, 2);
    assert.equal(
      (await db.currentEstimates<any>(scope.namespace))[0].estimate,
      null,
    );
    await db.estimation.commitResult({
      jobId: job.id,
      inputKey: input.key,
      sequence: input.sequence,
      result: await calculated(input),
    });
    await db.estimation.promote(job.id);
    assert.equal(
      canonicalJson((await db.all<any>("estimation_originals"))[0].result),
      canonicalJson(original),
    );
    const bad: EstimationEnvelope = {
      ...structuredClone(original),
      requested_method: {
        ...original.requested_method,
        method_id: "different",
      },
      effective_method: {
        ...original.effective_method,
        method_id: "different",
      },
    };
    bad.input_hash = calculationInputHash(bad);
    await assert.rejects(db.capture(scope, [], [bad]));
  } finally {
    db.close();
  }
});

test("a separately arriving authentic original reopens missing-lineage work as an incremental input", async () => {
  const db = await open();
  try {
    const pair = records();
    await db.commit(scope, pair);
    const job = await start(db),
      input = (await db.estimation.page(job.id)).inputs[0];
    await db.estimation.markUnavailable({
      jobId: job.id,
      inputKey: input.key,
      sequence: input.sequence,
      reason: "original_method_missing",
    });
    await db.estimation.promote(job.id);
    const original = await executor.estimate({
      family: "live",
      request: pair[0],
      attempt: pair[1],
    });
    await db.capture(scope, [], [original]);
    assert.equal((await db.estimation.state(scope)).pending, 1);
    const next = await start(db);
    assert.equal(next.snapshotTotal, 1);
    await finish(db, next.id);
    assert.equal(
      (await db.estimation.viewPage({ scope, view: "selected" })).rows[0].state,
      "selected",
    );
  } finally {
    db.close();
  }
});

test("review regression: cancelling a selected base supersedes its active incremental dependent", async () => {
  const db = await open();
  try {
    await seed(db);
    const base = await start(db);
    await finish(db, base.id);
    await seed(db);
    const incremental = await start(db),
      input = (await db.estimation.page(incremental.id)).inputs[0];
    await db.estimation.commitResult({
      jobId: incremental.id,
      inputKey: input.key,
      sequence: input.sequence,
      result: await calculated(input),
    });
    await db.estimation.cancel(base.id);
    assert.equal(await db.estimation.resume(scope), null);
    await assert.rejects(
      db.estimation.promote(incremental.id),
      /stale_estimation_result/,
    );
    assert.equal((await db.estimation.state(scope)).selected, null);
    const retry = await start(db);
    assert.equal(retry.snapshotTotal, 2);
    await finish(db, retry.id);
    assert.equal(
      (await db.estimation.viewPage({ scope, view: "selected" })).rows.filter(
        (row) => row.state === "selected",
      ).length,
      2,
    );
  } finally {
    db.close();
  }
});

test("review regression: an envelope cannot replace a validated legacy family method pin", async () => {
  const db = await open();
  try {
    const pair = records(),
      legacy = estimateAttempt(pair[1]);
    await db.commit(scope, pair, [
      {
        store: "local_estimates",
        value: {
          key: `${scope.namespace}:${pair[1].attempt_id}:1:${legacy.method_id}:original`,
          namespace: scope.namespace,
          estimate: legacy,
        },
      },
    ]);
    const before = await db.estimation.liveInput(scope, pair[1].attempt_id),
      bytes = canonicalJson(await db.all("local_estimates"));
    const other = await executor.estimate(
      { family: "live", request: pair[0], attempt: pair[1] },
      { methodId: methods.ecologits.method_id },
    );
    await assert.rejects(
      db.capture(scope, [], [other]),
      /method_admission_conflict/,
    );
    assert.equal(
      (await db.estimation.liveInput(scope, pair[1].attempt_id))
        ?.originalMethodHash,
      before?.originalMethodHash,
    );
    assert.equal(canonicalJson(await db.all("local_estimates")), bytes);
    assert.equal((await db.all("estimation_originals")).length, 0);
  } finally {
    db.close();
  }
});

test("review regression: reused method IDs and hashes reject conflicting full identities without replacing selection", async () => {
  const db = await open();
  try {
    await seed(db);
    const job = await start(db);
    await finish(db, job.id);
    const before = await db.estimation.state(scope);
    for (const change of [
      { implementation_version: "conflicting-version" },
      { method_id: "different-id" },
      { method_hash: "f".repeat(64) },
    ])
      await assert.rejects(
        db.estimation.start({
          scope,
          target: { ...methods.ecologits, ...change },
          selectionRevision: 1,
        }),
        /method_update_invalid|complete method identity/,
      );
    assert.deepEqual(await db.estimation.state(scope), before);
    const next = await start(db);
    assert.equal(next.snapshotTotal, 0);
    assert.equal((await db.estimation.page(next.id)).done, true);
    await db.estimation.promote(next.id);
  } finally {
    db.close();
  }
});

for (const erase of ["family", "range", "retention-no-match"] as const)
  test(`review regression: ${erase} cleanup reuses unaffected selected results`, async () => {
    const db = await open();
    try {
      const first = await seed(db, personal);
      const second = await seed(db, personal);
      const third = await seed(db, personal);
      await db.write(personal, {
        ...first.pair[0],
        revision: 2,
        dispatched_at: "2020-01-01T00:00:00.000Z",
      });
      const job = await start(db, personal);
      await finish(db, job.id);
      const old = await db.all<any>("estimation_results");
      if (erase === "family")
        await db.eraseFamily(personal.namespace, first.pair[0].request_id);
      else
        await db.applyRange(
          personal,
          null,
          erase === "range"
            ? "2021-01-01T00:00:00.000Z"
            : "2019-01-01T00:00:00.000Z",
          1,
          true,
        );
      const survivors = erase === "retention-no-match" ? 3 : 2;
      const after = await db.all<any>("estimation_results");
      assert.equal(after.length, survivors);
      for (const row of after)
        assert.equal(
          canonicalJson(row),
          canonicalJson(old.find((value) => value.key === row.key)),
        );
      const next = await start(db, personal);
      assert.equal(next.snapshotTotal, 0);
      assert.equal((await db.estimation.page(next.id)).inputs.length, 0);
      await db.estimation.promote(next.id);
      assert.equal(
        (
          await db.estimation.viewPage({ scope: personal, view: "selected" })
        ).rows.filter((row) => row.state === "selected").length,
        survivors,
      );
    } finally {
      db.close();
    }
  });

test("review regression: a recomputed input hash cannot authorize forged effective method metadata", async () => {
  const db = await open();
  try {
    await seed(db);
    const job = await start(db),
      input = (await db.estimation.page(job.id)).inputs[0];
    const result: EstimationEnvelope = structuredClone(await calculated(input));
    result.effective_method.implementation_version = "forged-effective-version";
    result.input_hash = calculationInputHash(result);
    await assert.rejects(
      db.estimation.commitResult({
        jobId: job.id,
        inputKey: input.key,
        sequence: input.sequence,
        result,
      }),
      /method_update_invalid|complete method identity/,
    );
    assert.equal((await db.estimation.resume(scope))?.processed, 0);
    assert.equal((await db.all("estimation_results")).length, 0);
    await finish(db, job.id);
  } finally {
    db.close();
  }
});

test("review regression: canonical erasure removes retained original envelopes through request and attempt alias chains", async () => {
  const db = await open();
  try {
    const oldest = await seed(db),
      middle = await seed(db),
      canonical = await seed(db),
      unrelated = await seed(db);
    await db.markAlias(
      scope.namespace,
      "request",
      oldest.pair[0].request_id,
      middle.pair[0].request_id,
    );
    await db.markAlias(
      scope.namespace,
      "request",
      middle.pair[0].request_id,
      canonical.pair[0].request_id,
    );
    await db.markAlias(
      scope.namespace,
      "attempt",
      oldest.pair[1].attempt_id,
      middle.pair[1].attempt_id,
    );
    await db.markAlias(
      scope.namespace,
      "attempt",
      middle.pair[1].attempt_id,
      canonical.pair[1].attempt_id,
    );
    assert.equal((await db.all("estimation_originals")).length, 4);
    await db.eraseFamily(scope.namespace, canonical.pair[0].request_id);
    assert.equal((await db.all("estimation_originals")).length, 1);
    assert.equal((await db.all("requests")).length, 1);
    assert.equal((await db.all("attempts")).length, 1);
    assert.equal((await db.all("measurements")).length, 2);
    assert.equal(
      canonicalJson((await db.all<any>("estimation_originals"))[0].result),
      canonicalJson(unrelated.original),
    );
    for (const family of [oldest, middle, canonical])
      await assert.rejects(
        db.capture(scope, family.pair, [family.original]),
        /record_erased/,
      );
  } finally {
    db.close();
  }
});

test("review regression: original fallback requires the job-pinned full child identity", async () => {
  const db = await open();
  try {
    const pair = records();
    pair[0].site = "perplexity";
    pair[0].model_id = "perplexity-unlisted";
    pair[1].model_id = "perplexity-unlisted";
    const original = await legacyExecutor.estimate({
      family: "live",
      request: pair[0],
      attempt: pair[1],
    });
    await db.capture(scope, pair, [original]);
    const unbound = await db.estimation.start({
        scope,
        target: legacyMethods.ecologits,
        selectionRevision: 1,
      }),
      input = (await db.estimation.page(unbound.id)).inputs[0];
    const result = await legacyExecutor.estimate(numeric(input), {
      methodId: legacyMethods.ecologits.method_id,
      view: "recalculated",
      originalMethodHash: input.originalMethodHash!,
    });
    assert.equal(result.selection.kind, "original_fallback");
    await assert.rejects(
      db.estimation.commitResult({
        jobId: unbound.id,
        inputKey: input.key,
        sequence: input.sequence,
        result,
      }),
      /method_update_invalid/,
    );
    const bound = await db.estimation.start({
      scope,
      target: legacyMethods.ecologits,
      fallbackMethod: legacyMethods.original,
      selectionRevision: 1,
    });
    assert.notEqual(bound.id, unbound.id);
    const forged: EstimationEnvelope = structuredClone(result);
    forged.effective_method.implementation_version = "forged-effective-version";
    forged.input_hash = calculationInputHash(forged);
    await assert.rejects(
      db.estimation.commitResult({
        jobId: bound.id,
        inputKey: input.key,
        sequence: input.sequence,
        result: forged,
      }),
      /method_update_invalid/,
    );
    assert.equal((await db.estimation.resume(scope))?.processed, 0);
    assert.equal(
      await db.estimation.commitResult({
        jobId: bound.id,
        inputKey: input.key,
        sequence: input.sequence,
        result,
      }),
      "applied",
    );
    await db.estimation.promote(bound.id);
    assert.deepEqual(
      (
        await db.estimation.resultFor(
          scope,
          input.source,
          legacyMethods.ecologits.method_hash,
        )
      )?.effective_method,
      legacyMethods.original,
    );
  } finally {
    db.close();
  }
});

test("review regression: attempt-only alias erasure preserves independent requests and unrelated attempts", async () => {
  const db = await open();
  try {
    const old = await seed(db),
      middle = await seed(db),
      canonical = await seed(db);
    const sibling = { ...old.pair[1], attempt_id: crypto.randomUUID() };
    const siblingOriginal = await executor.estimate({
      family: "live",
      request: old.pair[0],
      attempt: sibling,
    });
    await db.capture(scope, [sibling], [siblingOriginal]);
    await db.markAlias(
      scope.namespace,
      "attempt",
      old.pair[1].attempt_id,
      middle.pair[1].attempt_id,
    );
    await db.markAlias(
      scope.namespace,
      "attempt",
      middle.pair[1].attempt_id,
      canonical.pair[1].attempt_id,
    );
    const beforeOld = canonicalJson(
      await db.getRecord(scope.namespace, "request", old.pair[0].request_id),
    );
    const beforeMiddle = canonicalJson(
      await db.getRecord(scope.namespace, "request", middle.pair[0].request_id),
    );
    await db.eraseFamily(scope.namespace, canonical.pair[0].request_id);
    assert.equal((await db.all("requests")).length, 2);
    assert.equal((await db.all("attempts")).length, 1);
    assert.equal((await db.all("estimation_originals")).length, 1);
    assert.equal(
      canonicalJson(
        await db.getRecord(scope.namespace, "request", old.pair[0].request_id),
      ),
      beforeOld,
    );
    assert.equal(
      canonicalJson(
        await db.getRecord(
          scope.namespace,
          "request",
          middle.pair[0].request_id,
        ),
      ),
      beforeMiddle,
    );
    assert.equal(
      canonicalJson((await db.all<any>("estimation_originals"))[0].result),
      canonicalJson(siblingOriginal),
    );
    for (const pair of [old.pair, middle.pair]) {
      await assert.rejects(
        db.write(scope, { ...pair[1], revision: 2 }),
        /record_erased/,
      );
      await assert.rejects(
        db.commit(scope, [{ ...pair[1], revision: 2 }]),
        /record_erased/,
      );
      await assert.rejects(
        db.reconcile(scope.namespace, pair[1], payloadHash(pair[1])),
        /record_erased/,
      );
    }
  } finally {
    db.close();
  }
});

test("attempt-alias erasure resumes through persisted reverse edges after interruption", async () => {
  const db = await open();
  const put = IDBObjectStore.prototype.put;
  try {
    const old = await seed(db),
      middle = await seed(db),
      canonical = await seed(db);
    await db.markAlias(
      scope.namespace,
      "attempt",
      old.pair[1].attempt_id,
      middle.pair[1].attempt_id,
    );
    await db.markAlias(
      scope.namespace,
      "attempt",
      middle.pair[1].attempt_id,
      canonical.pair[1].attempt_id,
    );
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if (
        this.name === "deletion_markers" &&
        args[0]?.attemptId === old.pair[1].attempt_id
      )
        throw new Error("interrupted alias cleanup");
      return put.apply(this, args);
    };
    await assert.rejects(
      db.eraseFamily(scope.namespace, canonical.pair[0].request_id),
      /interrupted alias cleanup/,
    );
    IDBObjectStore.prototype.put = put;
    assert.equal(
      await db.getRecord(scope.namespace, "attempt", middle.pair[1].attempt_id),
      undefined,
    );
    await db.eraseFamily(scope.namespace, canonical.pair[0].request_id);
    assert.equal((await db.all("estimation_originals")).length, 0);
    assert.equal((await db.all("attempts")).length, 0);
    assert.equal((await db.all("requests")).length, 2);
  } finally {
    IDBObjectStore.prototype.put = put;
    db.close();
  }
});

async function corruptPreference(db: Ledger, record: unknown) {
  const tx = (db as any).db.transaction(
      "engine_preferences",
      "readwrite",
    ) as IDBTransaction,
    done = completed(tx);
  tx.objectStore("engine_preferences").put({ key: "installation", record });
  await done;
}

test("invalid preference state is sanitized while originals and numerical capture remain available", async () => {
  const db = await open();
  try {
    const { original } = await seed(db),
      job = await start(db);
    await finish(db, job.id);
    const observations = canonicalJson(await db.all("measurements")),
      originals = canonicalJson(await db.all("estimation_originals"));
    await corruptPreference(db, {
      schema_version: "1.0.0",
      preference: "removed_engine",
      selection_revision: 7,
      updated_at: "2026-09-15T12:00:00.000Z",
    });
    assert.deepEqual(await db.estimation.readPreferenceState(), {
      status: "invalid",
      revision: 7,
    });
    await assert.rejects(db.estimation.readPreference());
    assert.equal(await db.estimation.resume(scope), null);
    assert.equal((await db.estimation.state(scope)).selected, null);
    const view = await db.estimation.viewPage({ scope, view: "original" });
    assert.deepEqual(view.rows[0].result, original);
    assert.deepEqual(
      await db.estimation.resultFor(
        scope,
        original.source,
        original.requested_method.method_hash,
      ),
      original,
    );
    const epoch = await db.publicationSnapshot(scope.namespace),
      version = (await db.estimation.state(scope)).publicationVersion;
    const repair = await db.estimation.repairPreference(7, "original");
    assert.equal(repair?.selection_revision, 8);
    assert.deepEqual(await db.estimation.readPreferenceState(), {
      status: "valid",
      revision: 8,
      record: repair,
    });
    assert.equal(canonicalJson(await db.all("measurements")), observations);
    assert.equal(
      canonicalJson(await db.all("estimation_originals")),
      originals,
    );
    assert.deepEqual(await db.publicationSnapshot(scope.namespace), epoch);
    assert.equal(
      (await db.estimation.state(scope)).publicationVersion,
      version + 1,
    );
  } finally {
    db.close();
  }
});

test("explicit preference repairs cannot overwrite a concurrent valid choice", async () => {
  const db = await open();
  try {
    await corruptPreference(db, {
      schema_version: "1.0.0",
      preference: "removed_engine",
      selection_revision: 7,
      updated_at: "2026-09-15T12:00:00.000Z",
    });
    const outcomes = await Promise.all([
      db.estimation.repairPreference(7, "original"),
      db.estimation.repairPreference(7, "ecologits"),
    ]);
    assert.equal(outcomes.filter(Boolean).length, 1);
    const chosen = outcomes.find(Boolean)!;
    assert.deepEqual(await db.estimation.readPreference(), chosen);
    assert.equal(
      await db.estimation.repairPreference(
        chosen.selection_revision,
        "build_default",
      ),
      null,
    );
    assert.deepEqual(await db.estimation.readPreference(), chosen);
  } finally {
    db.close();
  }
});

test("unusable preference revisions recover above durable jobs and invalidate their old generations", async () => {
  const db = await open();
  try {
    await seed(db);
    for (let revision = 1; revision <= 9; revision++)
      assert.equal(
        await db.estimation.compareAndSetPreference(
          revision === 1 ? null : revision - 1,
          {
            schema_version: "1.0.0",
            preference: "ecologits",
            selection_revision: revision,
            updated_at: "2026-09-15T12:00:00.000Z",
          },
        ),
        true,
      );
    const job = await db.estimation.start({
        scope,
        target: methods.ecologits,
        selectionRevision: 9,
      }),
      input = (await db.estimation.page(job.id)).inputs[0],
      result = await calculated(input);
    await corruptPreference(db, {
      schema_version: "1.0.0",
      preference: "removed_engine",
      selection_revision: "not-a-revision",
      updated_at: "invalid",
    });
    await db.remove("policy", "engine-preference-revision");
    assert.deepEqual(await db.estimation.readPreferenceState(), {
      status: "invalid",
      revision: null,
    });
    const repaired = await db.estimation.repairPreference(null, "ecologits");
    assert.equal(repaired?.selection_revision, 10);
    assert.equal(
      await db.estimation.commitResult({
        jobId: job.id,
        inputKey: input.key,
        sequence: input.sequence,
        result,
      }),
      "stale",
    );
    assert.equal((await db.all("estimation_originals")).length, 1);
    assert.equal((await db.pending(scope.namespace)).length, 2);
  } finally {
    db.close();
  }
});

test("failed preference repair rolls back invalid state and all existing results", async () => {
  const db = await open(),
    put = IDBObjectStore.prototype.put;
  try {
    await seed(db);
    const job = await start(db);
    await finish(db, job.id);
    await corruptPreference(db, {
      schema_version: "1.0.0",
      preference: "removed_engine",
      selection_revision: 7,
      updated_at: "invalid",
    });
    const results = canonicalJson(await db.all("estimation_results"));
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if (this.name === "estimation_state")
        throw new DOMException("fixture full", "QuotaExceededError");
      return put.apply(this, args);
    };
    await assert.rejects(
      db.estimation.repairPreference(7, "original"),
      /fixture full/,
    );
    IDBObjectStore.prototype.put = put;
    assert.deepEqual(await db.estimation.readPreferenceState(), {
      status: "invalid",
      revision: 7,
    });
    assert.equal(canonicalJson(await db.all("estimation_results")), results);
    await corruptPreference(db, {
      schema_version: "1.0.0",
      preference: "removed_engine",
      selection_revision: 2147483647,
      updated_at: "invalid",
    });
    await assert.rejects(
      db.estimation.repairPreference(2147483647, "original"),
      /revision_conflict/,
    );
    assert.deepEqual(await db.estimation.readPreferenceState(), {
      status: "invalid",
      revision: 2147483647,
    });
  } finally {
    IDBObjectStore.prototype.put = put;
    db.close();
  }
});
