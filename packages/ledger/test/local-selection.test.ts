import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import {
  emptyGeneration,
  historyResponseParts,
  canonicalJson,
  payloadHash,
  UNAVAILABLE_ADMISSION_METHOD_ID,
  calculationInputHash,
  HistoryMessageSchema,
  HistoryPageSchema,
  historyNumericPayloadHash,
  type HistoryMessage,
} from "@footprint/contracts";
import { Ledger, historyAuthority, type Scope } from "../src/index";
import { records, scope } from "./factory";
import { completed, request } from "../src/ledger-support";
import {
  inputKey,
  scopeKey,
  ESTIMATION_STORES,
} from "../src/estimation-storage";
import {
  createMethodRegistry,
  LocalEstimateExecutor,
  estimateHistoricalText,
} from "../../estimator/src/index";
import configuration from "../../../config/estimation.build.json";
import mappings from "../../../config/estimation.mappings.json";
import media from "../../../config/estimation.media.json";
import { openV11, snapshotV11, v11Stores } from "./v11-fixture";

const methods = createMethodRegistry(configuration, mappings, media),
  executor = new LocalEstimateExecutor(methods);
const current = { ...scope, era: "era-2" };
async function seed(db: Ledger, owner: Scope = scope) {
  const pair = records();
  const original = await executor.estimate({
    family: "live",
    request: pair[0],
    attempt: pair[1],
  });
  await db.capture(owner, pair, [original]);
  return { pair, original };
}
async function authorize(
  db: Ledger,
  owner: Scope = current,
  old: Scope[] = [scope],
  device = "renewed-device",
) {
  await db.put("policy", {
    key: "credentials",
    namespace: owner.namespace,
    device_id: device,
    enrollment_era: { id: owner.era },
    enrollment_state: "active",
    method_public_key: "key-1",
  });
  await db.put("policy", {
    key: "ownership-history",
    eras: [
      ...old.map((scope, i) => ({ scope, start: i, end: i + 1 })),
      { scope: owner, start: old.length, end: null },
    ],
  });
}
async function finish(db: Ledger, owner: Scope = scope) {
  const job = await db.estimation.start({
    scope: owner,
    target: methods.ecologits,
    selectionRevision: 1,
  });
  const page = await db.estimation.page(job.id);
  for (const input of page.inputs) {
    const result = await executor.estimate(
      input.family === "live"
        ? {
            family: "live",
            request: input.request,
            attempt: input.attempt,
            history: input.history,
          }
        : { family: "history", record: input.history },
      {
        view: "recalculated",
        methodId: methods.ecologits.method_id,
        originalMethodHash: input.originalMethodHash!,
      },
    );
    assert.equal(
      await db.estimation.commitResult({
        jobId: job.id,
        inputKey: input.key,
        sequence: input.sequence,
        result,
      }),
      "applied",
    );
  }
  return db.estimation.promote(job.id);
}
function historyRecord(pair = records()): HistoryMessage {
  return HistoryMessageSchema.parse({
    schema_version: "3.0.0",
    kind: "history_message",
    timing: null,
    message_key: "b".repeat(64),
    role: "response",
    conversation_key: pair[0].conversation_key,
    key_version: "1",
    site: pair[0].site,
    parent_key: null,
    prompt_key: null,
    provider_request_key: null,
    provider_attempt_key: pair[1].provider_attempt_key,
    occurred_at: pair[0].dispatched_at,
    date_basis: "message_created",
    observed_at: new Date().toISOString(),
    model_id: null,
    proposed_method_id: methods.original.method_id,
    company_dedup_key: null,
    proposed_method_hash: methods.original.method_hash,
    tokens: pair[1].tokens.answer_output,
    inline_file_text: null,
    parts: historyResponseParts(pair[1].tokens.answer_output),
    generation: emptyGeneration(),
    text_complete: true,
    coverage_reasons: ["history_only"],
  });
}
async function importHistory(db: Ledger, owner: Scope, record: HistoryMessage) {
  const page = HistoryPageSchema.parse({
    schema_version: "3.0.0",
    site: record.site,
    conversation_key: record.conversation_key,
    observed_at: record.observed_at,
    deletion_epoch: 0,
    branch_scope: "loaded_messages",
    selected_leaf_key: null,
    branch_message_keys: null,
    root_message_key: null,
    first_request_verified: false,
    has_earlier: null,
    has_later: null,
    messages: [record],
  });
  const snapshot = await db.publicationSnapshot(owner.namespace);
  const envelope = await executor.estimate({ family: "history", record });
  await db.commitHistory(
    owner,
    page,
    {
      authority: historyAuthority(snapshot),
      erasureVersion: snapshot.erasureVersion,
      estimates: { [record.message_key]: estimateHistoricalText(record) },
      envelopes: { [record.message_key]: envelope },
    },
    () => true,
  );
}

test("liveResult gives in one read what liveInput and resultFor give for the input it finds", async () => {
  const db = await Ledger.open(crypto.randomUUID());
  try {
    await authorize(db, scope, []);
    const linked = records();
    linked[1].provider_attempt_key = "d".repeat(64);
    await db.capture(scope, linked, [
      await executor.estimate({ family: "live", request: linked[0], attempt: linked[1] }),
    ]);
    await importHistory(db, scope, historyRecord(linked));
    const { pair: plain } = await seed(db);
    const { pair: erased } = await seed(db);
    // Before the recalculation, after it, and for a method without results.
    const compare = async (attemptId: string, methodHash: string) => {
      const input = await db.estimation.liveInput(scope, attemptId);
      const expected = input
        ? { input, result: await db.estimation.resultFor(scope, input.source, methodHash) }
        : null;
      assert.equal(
        canonicalJson(await db.estimation.liveResult(scope, attemptId, methodHash)),
        canonicalJson(expected),
      );
      return expected;
    };
    for (const pair of [linked, plain])
      assert.equal((await compare(pair[1].attempt_id, methods.ecologits.method_hash))?.result, null);
    await finish(db, scope);
    await db.eraseFamily(scope.namespace, erased[0].request_id);
    for (const pair of [linked, plain]) {
      const read = await compare(pair[1].attempt_id, methods.ecologits.method_hash);
      assert.ok(read?.result, "the recalculated result is found");
      await compare(pair[1].attempt_id, "e".repeat(64));
    }
    assert.ok((await compare(linked[1].attempt_id, methods.ecologits.method_hash))?.input.history);
    assert.equal(await compare(erased[1].attempt_id, methods.ecologits.method_hash), null);
    assert.equal(await compare(crypto.randomUUID(), methods.ecologits.method_hash), null);
    // The page reads answer as the single reads do, in the order asked.
    const ids = [plain[1].attempt_id, crypto.randomUUID(), linked[1].attempt_id, erased[1].attempt_id];
    assert.equal(
      canonicalJson(await db.estimation.liveResults(scope, ids, methods.ecologits.method_hash)),
      canonicalJson(
        await Promise.all(ids.map((id) => db.estimation.liveResult(scope, id, methods.ecologits.method_hash))),
      ),
    );
    assert.deepEqual(await db.estimation.liveResults(scope, [], methods.ecologits.method_hash), []);
    await assert.rejects(db.estimation.liveResults(scope, ["not-an-id"], methods.ecologits.method_hash), /payload_rejected/);
    const requests = [plain[0].request_id, crypto.randomUUID(), linked[0].request_id];
    assert.deepEqual(
      await db.getRecords(scope.namespace, "request", requests),
      await Promise.all(requests.map((id) => db.getRecord(scope.namespace, "request", id))),
    );
    await assert.rejects(db.getRecords(scope.namespace, "request", Array(201).fill(plain[0].request_id)), /payload_rejected/);
    await assert.rejects(db.estimation.liveResult(scope, "not-an-id", methods.ecologits.method_hash), /payload_rejected/);
  } finally {
    db.close();
  }
});

test("authorized cross-era history and live views contribute one execution and ignore ungranted lookalikes", async () => {
  const db = await Ledger.open(crypto.randomUUID());
  try {
    await authorize(db, scope, []);
    const pair = records();
    pair[1].provider_attempt_key = "d".repeat(64);
    await db.capture(scope, pair, [
      await executor.estimate({
        family: "live",
        request: pair[0],
        attempt: pair[1],
      }),
    ]);
    await authorize(db);
    await importHistory(db, current, historyRecord(pair));
    await finish(db, scope);
    await finish(db, current);
    for (const view of ["original", "selected"] as const) {
      const rows = [
        ...(await db.estimation.viewPage({ scope, view })).rows,
        ...(await db.estimation.viewPage({ scope: current, view })).rows,
      ];
      assert.equal(rows.filter((row) => row.contributes).length, 1);
      assert.equal(
        rows.find((row) => row.input?.family === "history")?.contributes,
        false,
      );
    }
    await authorize(db, current, []);
    assert.equal(
      (await db.estimation.viewPage({ scope: current, view: "selected" }))
        .rows[0].contributes,
      true,
    );
  } finally {
    db.close();
  }
});

test("history reconnect reimport preserves one source era, original bytes, cached inputs and duplicate-after-ACK semantics", async () => {
  const db = await Ledger.open(crypto.randomUUID());
  try {
    await authorize(db, scope, []);
    const record = historyRecord();
    await importHistory(db, scope, record);
    await finish(db, scope);
    const originals = canonicalJson(await db.all("estimation_originals")),
      inputs = canonicalJson(await db.all("estimation_inputs"));
    const first = (await db.all<any>("history_records"))[0];
    await authorize(db);
    await importHistory(db, current, {
      ...record,
      observed_at: new Date().toISOString(),
    });
    assert.equal((await db.all("history_records")).length, 1);
    assert.equal((await db.all("estimation_inputs")).length, 1);
    assert.equal((await db.all<any>("history_records"))[0].era, scope.era);
    assert.equal(
      (await db.all<any>("history_records"))[0].lastImportEra,
      current.era,
    );
    assert.equal(canonicalJson(await db.all("estimation_inputs")), inputs);
    assert.equal(
      canonicalJson(await db.all("estimation_originals")),
      originals,
    );
    const queued = (await db.all<any>("history_outbox"))[0];
    assert.equal(queued.era, current.era);
    assert.equal(queued.deviceId, "renewed-device");
    assert.equal((await db.pendingHistory(current)).length, 1);
    await db.acknowledgeHistory(current, [
      {
        message_key: record.message_key,
        payload_hash: historyNumericPayloadHash(record),
        status: "accepted",
      } as any,
    ]);
    assert.equal((await db.pendingHistory(current)).length, 0);
    await importHistory(db, current, {
      ...record,
      observed_at: new Date().toISOString(),
    });
    assert.equal((await db.pendingHistory(current)).length, 0);
    assert.equal(canonicalJson(await db.all("estimation_inputs")), inputs);
    const refined = {
      ...record,
      observed_at: new Date().toISOString(),
      model_id: "claude-sonnet-4-6" as const,
    };
    await importHistory(db, current, refined);
    const latest = (await db.all<any>("history_records"))[0];
    assert.equal(latest.era, scope.era);
    assert.deepEqual(latest.original, first.original);
    assert.equal(latest.record.model_id, refined.model_id);
    assert.equal((await db.all("estimation_inputs")).length, 1);
    assert.equal((await db.estimation.state(scope)).pending, 1);
    await finish(db, scope);
    const vector = await db.estimation.localSelectionState(current);
    assert.equal(
      vector.members.reduce((n, m) => n + m.inputCount, 0),
      1,
    );
    assert.equal(
      vector.members.reduce((n, m) => n + (m.selected?.unavailable ?? 0), 0),
      0,
    );
    for (const original of JSON.parse(originals))
      assert.deepEqual(
        await db.get("estimation_originals", original.key),
        original,
      );
    await db.applyRange(current, null, null, 1);
    assert.equal((await db.all("history_records")).length, 0);
    assert.equal((await db.all("estimation_originals")).length, 0);
  } finally {
    db.close();
  }
});

test("current local authority recalculates known prior eras after device change without changing sources or upload queues", async () => {
  const db = await Ledger.open(crypto.randomUUID());
  try {
    const old = await seed(db);
    await seed(db, current);
    const before = canonicalJson({
      sources: await db.all("measurements"),
      outbox: await db.all("outbox"),
      originals: await db.all("estimation_originals"),
    });
    await authorize(db);
    const state = await db.estimation.localSelectionState(current);
    assert.equal(state.execution, "local_only");
    assert.equal(state.status, "ready");
    assert.deepEqual(
      state.members.map((m) => [m.scope.era, m.inputCount]),
      [
        ["era-2", 1],
        ["era-1", 1],
      ],
    );
    assert.equal(
      (await db.estimation.liveInput(current, old.pair[1].attempt_id))?.scope
        .era,
      "era-1",
    );
    await finish(db);
    await finish(db, current);
    assert.equal(
      (
        await db.estimation.resultFor(
          current,
          old.original.source,
          methods.ecologits.method_hash,
        )
      )?.view,
      "recalculated",
    );
    assert.equal(
      canonicalJson({
        sources: await db.all("measurements"),
        outbox: await db.all("outbox"),
        originals: await db.all("estimation_originals"),
      }),
      before,
    );
    assert.equal(
      (await db.estimation.localSelectionState(current)).members.every(
        (m) => m.selected && m.pending === 0,
      ),
      true,
    );
  } finally {
    db.close();
  }
});

test("renewed local read authority reuses complete results while unfinished generations remain stale", async () => {
  const db = await Ledger.open(crypto.randomUUID());
  try {
    await seed(db);
    await authorize(db, scope, [], "device-1");
    await finish(db);
    const incomplete = await db.estimation.start({
      scope,
      target: methods.ecologits,
      selectionRevision: 1,
    });
    const cached = canonicalJson(await db.all("estimation_results"));
    await authorize(db);
    assert.equal(await db.estimation.resume(scope), null);
    await assert.rejects(db.estimation.promote(incomplete.id), /stale/);
    assert.equal(
      (await db.estimation.state(scope)).selected?.status,
      "complete",
    );
    const renewed = await db.estimation.start({
      scope,
      target: methods.ecologits,
      selectionRevision: 1,
    });
    assert.equal(renewed.snapshotTotal, 0);
    await db.estimation.promote(renewed.id);
    assert.equal(canonicalJson(await db.all("estimation_results")), cached);
  } finally {
    db.close();
  }
});

test("calculation vector is stable during page progress and invalidates atomically on promotion, preference, source, erasure and trust rotation", async () => {
  const db = await Ledger.open(crypto.randomUUID());
  try {
    const { pair } = await seed(db);
    await authorize(db);
    const job = await db.estimation.start({
      scope,
      target: methods.ecologits,
      selectionRevision: 1,
    });
    let state = await db.estimation.localSelectionState(current);
    const check = () =>
      db.publicationSnapshot(scope.namespace, undefined, undefined, undefined, {
        authorityScope: current,
        localSelectionToken: state.token,
      });
    assert.equal((await check()).calculationCurrent, true);
    const page = await db.estimation.page(job.id),
      input = page.inputs[0];
    if (input.family !== "live") throw Error("test fixture");
    const result = await executor.estimate(
      {
        family: "live",
        request: input.request,
        attempt: input.attempt,
        history: input.history,
      },
      {
        view: "recalculated",
        methodId: methods.ecologits.method_id,
        originalMethodHash: input.originalMethodHash!,
      },
    );
    await db.estimation.commitResult({
      jobId: job.id,
      inputKey: input.key,
      sequence: input.sequence,
      result,
    });
    assert.equal((await check()).calculationCurrent, true);
    await db.estimation.promote(job.id);
    assert.equal((await check()).calculationCurrent, false);
    state = await db.estimation.localSelectionState(current);
    await db.write(scope, { ...pair[1], revision: 2 });
    assert.equal((await check()).calculationCurrent, false);
    state = await db.estimation.localSelectionState(current);
    await db.estimation.compareAndSetPreference(null, {
      schema_version: "1.0.0",
      preference: "ecologits",
      selection_revision: 1,
      updated_at: new Date().toISOString(),
    });
    assert.equal((await check()).calculationCurrent, false);
    state = await db.estimation.localSelectionState(current);
    const credentials = await db.get<any>("policy", "credentials");
    await db.put("policy", { ...credentials, method_public_key: "rotated" });
    assert.equal((await check()).calculationCurrent, false);
    state = await db.estimation.localSelectionState(current);
    await db.eraseFamily(scope.namespace, pair[0].request_id);
    assert.equal((await check()).calculationCurrent, false);
  } finally {
    db.close();
  }
});

test("unproved eras remain counted as partial and foreign/current-revoked authority cannot read or run them", async () => {
  const db = await Ledger.open(crypto.randomUUID());
  try {
    const hidden = await seed(db, { ...scope, era: "unknown-era" });
    await seed(db);
    await authorize(db);
    const partial = await db.estimation.localSelectionState(current);
    assert.equal(partial.status, "partial");
    assert.equal(partial.unprovableCount, 1);
    assert.equal(
      await db.estimation.liveInput(current, hidden.pair[1].attempt_id),
      null,
    );
    await assert.rejects(
      db.estimation.start({
        scope: { ...scope, era: "unknown-era" },
        target: methods.ecologits,
        selectionRevision: 1,
      }),
      /policy_unavailable/,
    );
    assert.equal(
      (await db.estimation.localSelectionState(scope)).status,
      "unavailable",
    );
    const credentials = await db.get<any>("policy", "credentials");
    for (const enrollment_state of ["revoked", "reconnect_needed"]) {
      await db.put("policy", { ...credentials, enrollment_state });
      assert.equal(
        (await db.estimation.localSelectionState(current)).status,
        "unavailable",
      );
      assert.equal(
        await db.estimation.localSelectionCurrent(current, partial.token),
        false,
      );
    }
    await authorize(
      db,
      { ...scope, namespace: "company:foreign", era: "foreign" },
      [],
    );
    assert.equal(
      (await db.estimation.localSelectionState(current)).members.length,
      0,
    );
    assert.equal(
      (await db.estimation.viewPage({ scope, view: "original" })).rows.length,
      0,
    );
  } finally {
    db.close();
  }
});

test("bounded local selection directory exposes overflow without an empty complete view", async () => {
  const db = await Ledger.open(crypto.randomUUID());
  try {
    const scopes = Array.from({ length: 66 }, (_, i) => ({
      ...scope,
      era: `era-${i + 10}`,
    }));
    for (const owner of scopes) await seed(db, owner);
    await authorize(db, current, scopes);
    const state = await db.estimation.localSelectionState(current);
    assert.equal(state.status, "partial");
    assert.equal(state.scopeLimitExceeded, true);
    assert.equal(state.members.length, 64);
    assert.equal(state.unprovableCount, 3);
  } finally {
    db.close();
  }
});

test("latest schema discards obsolete unknown-era usage and calculated results", async () => {
  const name = crypto.randomUUID();
  let old = await openV11(name);
  old.close();
  const opening = indexedDB.open(name, 12);
  const pair = records(),
    sourceScope = { ...scope, era: null };
  opening.onupgradeneeded = () => {
    const db = opening.result,
      tx = opening.transaction!;
    for (const name of ESTIMATION_STORES) {
      const store = db.createObjectStore(name, { keyPath: "key" });
      store.createIndex("namespace", "namespace");
    }
    const inputs = tx.objectStore("estimation_inputs");
    inputs.createIndex("sequence", ["scopeKey", "sequence"]);
    inputs.createIndex("dependency", "dependencies", { multiEntry: true });
    inputs.createIndex("scope", "scopeKey");
    const originals = tx.objectStore("estimation_originals");
    originals.createIndex("input", "inputKey");
    originals.createIndex("source", ["inputKey", "sourceHash"]);
    const results = tx.objectStore("estimation_results");
    results.createIndex("input", "inputKey");
    results.createIndex("job", "jobId");
    results.createIndex("method", ["scopeKey", "methodHash"]);
    for (const record of pair) {
      const key = `${scope.namespace}:${record.kind}:${record.kind === "request" ? record.request_id : record.attempt_id}`;
      const row = {
        key,
        namespace: scope.namespace,
        era: null,
        record,
        hash: payloadHash(record),
      };
      tx.objectStore(record.kind === "request" ? "requests" : "attempts").put(
        row,
      );
      tx.objectStore("measurements").put({ ...row, key: key + ":1" });
    }
    tx.objectStore("schema_migrations").put({
      key: "schema-12",
      version: 12,
      at: 12,
    });
    tx.objectStore("estimation_results").put({
      key: "retained-v12",
      namespace: scope.namespace,
      storedBytes: "unchanged",
    });
  };
  old = await request(opening);
  const before = await snapshotV11(old);
  const beforeResult = await request(
    old
      .transaction("estimation_results")
      .objectStore("estimation_results")
      .getAll(),
  );
  old.close();
  const db = await Ledger.open(name);
  try {
    for (const store of [
      "requests",
      "attempts",
      "measurements",
      "estimation_inputs",
      "estimation_results",
    ] as const)
      assert.deepEqual(await db.all(store), [], store);
    await authorize(db);
    assert.equal(
      await db.estimation.liveInput(current, pair[1].attempt_id),
      null,
    );
  } finally {
    db.close();
  }
});

test("reserved unavailable admission is the only missing lineage that can produce a selected local result", async () => {
  const db = await Ledger.open(crypto.randomUUID());
  try {
    const pair = records();
    pair[1].proposed_method_id = UNAVAILABLE_ADMISSION_METHOD_ID;
    await db.capture(scope, pair);
    let input = await db.estimation.liveInput(scope, pair[1].attempt_id);
    assert.equal(input?.originalMethodState, "not_admitted");
    const job = await db.estimation.start({
      scope,
      target: methods.ecologits,
      selectionRevision: 1,
    });
    const result = await executor.estimate(
      { family: "live", request: pair[0], attempt: pair[1] },
      {
        view: "recalculated",
        methodId: methods.ecologits.method_id,
        originalMethodHash: null,
        originalMethodMissing: true,
      } as any,
    );
    assert.equal(result.original_method_hash, null);
    assert.ok(result.reasons.includes("original_method_missing"));
    assert.equal(
      await db.estimation.commitResult({
        jobId: job.id,
        inputKey: input!.key,
        sequence: input!.sequence,
        result,
      }),
      "applied",
    );
    await db.estimation.promote(job.id);
    const old = records();
    await db.capture(scope, old);
    input = await db.estimation.liveInput(scope, old[1].attempt_id);
    assert.equal(input?.originalMethodState, "unavailable");
    const unavailableInputs = [input!];
    const recorded = await seed(db);
    await db.write(scope, {
      ...recorded.pair[1],
      revision: 2,
      proposed_method_id: UNAVAILABLE_ADMISSION_METHOD_ID,
      company_dedup_key: null,
    });
    input = await db.estimation.liveInput(scope, recorded.pair[1].attempt_id);
    assert.equal(input?.originalMethodState, "unavailable");
    unavailableInputs.push(input!);
    const catchup = await db.estimation.start({
      scope,
      target: methods.ecologits,
      selectionRevision: 1,
    });
    for (const unadmitted of unavailableInputs) {
      const forged = { ...result, source: unadmitted.source };
      forged.input_hash = calculationInputHash(forged);
      await assert.rejects(
        db.estimation.commitResult({
          jobId: catchup.id,
          inputKey: unadmitted.key,
          sequence: unadmitted.sequence,
          result: forged,
        }),
        /method_update_invalid/,
      );
    }
    assert.equal((await db.estimation.page(catchup.id)).job.processed, 0);
  } finally {
    db.close();
  }
});

test("invalid preference still permits coherent Original publication under a current read grant", async () => {
  const db = await Ledger.open(crypto.randomUUID());
  try {
    const { pair, original } = await seed(db);
    await authorize(db);
    const corruption = (db as any).db.transaction(
      "engine_preferences",
      "readwrite",
    );
    const corruptDone = completed(corruption);
    corruption.objectStore("engine_preferences").put({
      key: "installation",
      record: { selection_revision: 8, preference: "invalid secret text" },
    });
    await corruptDone;
    const state = await db.estimation.localSelectionState(current);
    assert.equal(state.status, "unavailable");
    assert.equal(state.members.length, 2);
    assert.equal(
      await db.estimation.localSelectionCurrent(current, state.token),
      true,
    );
    const published = await db.publicationSnapshot(
      current.namespace,
      undefined,
      undefined,
      undefined,
      { authorityScope: current, localSelectionToken: state.token },
    );
    assert.equal(published.calculationCurrent, true);
    const archived = await db.estimation.originalForLive(current, {
      attemptId: pair[1].attempt_id,
      attemptRevision: 1,
      attemptHash: payloadHash(pair[1]),
    });
    assert.deepEqual(archived?.result, original);
    await db.estimation.repairPreference(8, "ecologits");
    assert.equal(
      await db.estimation.localSelectionCurrent(current, state.token),
      false,
    );
  } finally {
    db.close();
  }
});

test("saved Personal data remains readable through company fallback while calculation and erased-scope grants stay closed", async () => {
  const db = await Ledger.open(crypto.randomUUID());
  const personal: Scope = {
    namespace: "personal:fallback-reader",
    mode: "personal",
    era: null,
  };
  try {
    const { pair, original } = await seed(db, personal);
    await db.put("policy", {
      key: "personal",
      namespace: personal.namespace,
      secret: "saved-personal-secret",
    });
    await authorize(db, current, [personal, scope]);
    const view = await db.estimation.localSelectionState(personal);
    assert.equal(view.status, "ready");
    assert.equal(view.members[0].inputCount, 1);
    assert.equal(
      await db.estimation.localSelectionCurrent(personal, view.token),
      true,
    );
    assert.equal(
      (
        await db.estimation.originalForLive(personal, {
          attemptId: pair[1].attempt_id,
          attemptRevision: 1,
          attemptHash: payloadHash(pair[1]),
        })
      )?.result.input_hash,
      original.input_hash,
    );
    assert.equal(
      (await db.estimation.viewPage({ scope: personal, view: "original" })).rows
        .length,
      1,
    );
    await assert.rejects(
      db.estimation.start({
        scope: personal,
        target: methods.ecologits,
        selectionRevision: 1,
      }),
      /policy_unavailable/,
    );
    const credentials = await db.get<any>("policy", "credentials");
    await db.put("policy", { ...credentials, enrollment_state: "revoked" });
    assert.equal(
      await db.estimation.localSelectionCurrent(personal, view.token),
      false,
    );
    const fallback = await db.estimation.localSelectionState(personal);
    assert.equal(
      await db.estimation.localSelectionCurrent(personal, fallback.token),
      true,
    );
    const company = await db.estimation.localSelectionState(current);
    assert.equal(
      await db.estimation.localSelectionCurrent(current, company.token),
      false,
    );
    await db.eraseNamespace(current.namespace);
    const after = await db.estimation.localSelectionState(personal);
    assert.equal(after.members[0].inputCount, 1);
    assert.equal(
      await db.estimation.localSelectionCurrent(personal, after.token),
      true,
    );
    await db.put("policy", {
      key: "ownership-history",
      eras: [
        { scope: personal, start: 0, end: 1 },
        {
          scope: { ...personal, namespace: "personal:other" },
          start: 1,
          end: null,
        },
      ],
    });
    assert.equal(
      (await db.estimation.viewPage({ scope: personal, view: "original" })).rows
        .length,
      1,
    );
    await db.put("deletion_markers", {
      key: `history-cleanup:${personal.namespace}:request:${pair[0].request_id}`,
      namespace: personal.namespace,
      era: null,
      keys: [],
    });
    const pending = await db.estimation.localSelectionState(personal);
    assert.equal(
      await db.estimation.localSelectionCurrent(personal, pending.token),
      false,
    );
    await db.remove(
      "deletion_markers",
      `history-cleanup:${personal.namespace}:request:${pair[0].request_id}`,
    );
    await db.eraseNamespace(personal.namespace);
    const erased = await db.estimation.localSelectionState(personal);
    assert.equal(
      await db.estimation.localSelectionCurrent(personal, erased.token),
      false,
    );
  } finally {
    db.close();
  }
});
