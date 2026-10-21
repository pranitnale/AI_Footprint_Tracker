import { openDatabase } from "../src/database";
import { STORES } from "../src/ledger-support";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import {
  emptyGeneration,
  historyResponseParts,
  canonicalJson,
  payloadHash,
  historyNumericPayloadHash,
  HistoryMessageSchema,
} from "@footprint/contracts";
import { Ledger, historyAuthority } from "../src/index";
import { completed, request } from "../src/ledger-support";
import {
  initializeEstimationIndexes,
  touchInput,
} from "../src/estimation-storage";
import { openV11, snapshotV11, v11Stores } from "./v11-fixture";
import { records, scope } from "./factory";
import {
  createMethodRegistry,
  LocalEstimateExecutor,
  estimateAttempt,
  estimateHistoricalText,
  BASELINE_METHOD_ID,
  BASELINE_METHOD_HASH,
} from "../../estimator/src/index";
import configuration from "../../../config/estimation.build.json";
import mappings from "../../../config/estimation.mappings.json";
import media from "../../../config/estimation.media.json";
const methods = createMethodRegistry(configuration, mappings, media),
  executor = new LocalEstimateExecutor(methods);
const historical = () =>
  HistoryMessageSchema.parse({
    schema_version: "3.0.0",
    kind: "history_message",
    timing: null,
    message_key: "b".repeat(64),
    role: "response",
    conversation_key: "c".repeat(64),
    key_version: "1",
    site: "claude",
    parent_key: null,
    prompt_key: null,
    provider_request_key: null,
    provider_attempt_key: null,
    occurred_at: "2020-01-01T00:00:00.000001Z",
    date_basis: "message_created",
    observed_at: "2026-09-14T16:00:00.000Z",
    model_id: null,
    proposed_method_id: BASELINE_METHOD_ID,
    company_dedup_key: null,
    proposed_method_hash: BASELINE_METHOD_HASH,
    tokens: records()[1].tokens.answer_output,
    inline_file_text: null,
    parts: historyResponseParts(records()[1].tokens.answer_output),
    generation: emptyGeneration(),
    text_complete: true,
    coverage_reasons: ["history_only"],
  });
async function populate(name: string, current = false) {
  const db = current ? await openDatabase(name) : await openV11(name),
    pair = records(),
    history = historical(),
    estimate = estimateAttempt(pair[1]);
  const tx = db.transaction(
      current ? [...STORES] : [...v11Stores],
      "readwrite",
    ),
    done = completed(tx);
  for (const record of pair) {
    const key = `${scope.namespace}:${record.kind}:${record.kind === "request" ? record.request_id : record.attempt_id}`;
    const row = {
      key,
      namespace: scope.namespace,
      era: scope.era,
      record,
      hash: payloadHash(record),
    };
    tx.objectStore(record.kind === "request" ? "requests" : "attempts").put(
      row,
    );
    tx.objectStore("measurements").put({ ...row, key: key + ":1" });
    tx.objectStore("outbox").put({
      key: key + ":1",
      namespace: scope.namespace,
      kind: record.kind,
      id: record.kind === "request" ? record.request_id : record.attempt_id,
      revision: 1,
      hash: row.hash,
      createdAt: 1,
      nextAt: 0,
      attempts: 0,
      quarantined: null,
    });
  }
  tx.objectStore("local_estimates").put({
    key: `${scope.namespace}:${pair[1].attempt_id}:1:${estimate.method_id}:original`,
    namespace: scope.namespace,
    estimate,
  });
  tx.objectStore("local_estimates").put({
    key: `current:${scope.namespace}:${pair[1].attempt_id}`,
    namespace: scope.namespace,
    selection: "current",
    estimate,
  });
  const key = `${scope.namespace}:history:${history.message_key}`;
  tx.objectStore("history_records").put({
    key,
    namespace: scope.namespace,
    era: scope.era,
    record: history,
    original: history,
    hash: historyNumericPayloadHash(history),
    status: "current",
    estimate: estimateHistoricalText(history),
    originalEstimate: estimateHistoricalText(history),
  });
  tx.objectStore("history_outbox").put({
    key,
    namespace: scope.namespace,
    era: scope.era,
    deviceId: "fixture-device",
    record: history,
    hash: historyNumericPayloadHash(history),
    nextAt: 0,
  });
  tx.objectStore("method_catalogs").put({
    key: "archived-method",
    namespace: scope.namespace,
    bundle: {
      method_hash: BASELINE_METHOD_HASH,
      signature: "fixture-retained-verbatim",
    },
  });
  tx.objectStore("policy").put({ key: "settings", value: { paused: false } });
  tx.objectStore("schema_migrations").put({
    key: "schema-11",
    version: 11,
    at: 1,
  });
  if (current) {
    await touchInput(tx, scope, "live", pair[1].attempt_id);
    await touchInput(tx, scope, "history", history.message_key);
  }
  await done;
  return { db, pair, history, before: await snapshotV11(db) };
}

test("obsolete usage is reset, session settings survive and old clients cannot reopen", async () => {
  const name = "reset-" + crypto.randomUUID(),
    seed = await populate(name);
  seed.db.close();
  const db = await Ledger.open(name);
  try {
    for (const store of [
      "requests",
      "attempts",
      "measurements",
      "history_records",
      "outbox",
      "history_outbox",
      "method_catalogs",
      "estimation_inputs",
      "estimation_originals",
    ] as const)
      assert.deepEqual(await db.all(store), [], store);
    assert.deepEqual(await db.get("policy", "settings"), {
      key: "settings",
      value: { paused: false },
    });
    await assert.rejects(request(indexedDB.open(name, 11)), /VersionError/);
  } finally {
    db.close();
  }
});

test("W5 version 16 records survive the upgrade that adds Cowork checkpoints", async () => {
  const name = "keep-16-" + crypto.randomUUID();
  const opening = indexedDB.open(name, 16);
  opening.onupgradeneeded = () => {
    for (const store of STORES)
      if (store !== "cowork_checkpoints")
        opening.result
          .createObjectStore(store, { keyPath: "key" })
          .createIndex("namespace", "namespace");
  };
  const old = await request(opening);
  const history = historical();
  const key = `${scope.namespace}:history:${history.message_key}`;
  const tx = old.transaction(["history_records", "policy"], "readwrite"),
    done = completed(tx);
  tx.objectStore("history_records").put({
    key,
    namespace: scope.namespace,
    era: scope.era,
    record: history,
    original: history,
    hash: historyNumericPayloadHash(history),
    status: "current",
    estimate: estimateHistoricalText(history),
    originalEstimate: estimateHistoricalText(history),
  });
  tx.objectStore("policy").put({ key: "settings", value: { paused: false } });
  await done;
  old.close();
  const db = await Ledger.open(name);
  try {
    assert.deepEqual(
      (await db.all<{ key: string }>("history_records")).map((row) => row.key),
      [key],
    );
    assert.deepEqual(await db.all("cowork_checkpoints"), []);
    assert.equal(
      (await db.get<{ version: number }>("schema_migrations", "schema-21"))
        ?.version,
      21,
    );
  } finally {
    db.close();
  }
});

test("version 18 sends each record's newest refused revision once more and drops the superseded ones", async () => {
  // 14 Oct 2026: the organization server refused every revision of a ChatGPT reply after the
  // one that named it by its thoughts. It now accepts the finished revision, so the update
  // releases those rows once.
  const name = "release-refused-" + crypto.randomUUID();
  const opening = indexedDB.open(name, 17);
  opening.onupgradeneeded = () => {
    for (const store of STORES)
      opening.result
        .createObjectStore(store, { keyPath: "key" })
        .createIndex("namespace", "namespace");
  };
  const old = await request(opening);
  const row = (
    id: string,
    revision: number,
    quarantined: string | null,
    kind = "attempt",
  ) => ({
    key: `${scope.namespace}:${kind}:${id}:${revision}`,
    namespace: scope.namespace,
    kind,
    id,
    revision,
    hash: "h".repeat(64),
    createdAt: revision,
    nextAt: Date.now() + 3_600_000,
    attempts: 3,
    quarantined,
  });
  const rows = [
    // A reply whose answer revisions were both refused.
    row("reply", 4, "revision_conflict"),
    row("reply", 5, "revision_conflict"),
    // A refused revision that a newer, still pending revision supersedes.
    row("superseded", 1, "revision_conflict"),
    row("superseded", 2, null),
    // A record the server refused for another reason stays refused.
    row("rejected", 1, "payload_rejected", "request"),
  ];
  const tx = old.transaction("outbox", "readwrite"),
    done = completed(tx);
  for (const value of rows) tx.objectStore("outbox").put(value);
  await done;
  old.close();
  const db = await Ledger.open(name);
  try {
    const kept = new Map(
      (await db.all<(typeof rows)[number]>("outbox")).map((value) => [
        value.key,
        value,
      ]),
    );
    assert.deepEqual(
      [...kept.keys()].sort(),
      [rows[1], rows[3], rows[4]].map((value) => value.key).sort(),
    );
    const released = kept.get(rows[1]!.key)!;
    assert.equal(released.quarantined, null);
    assert.equal(released.nextAt, 0);
    assert.equal(released.attempts, 0);
    assert.deepEqual(kept.get(rows[3]!.key), rows[3]);
    assert.deepEqual(kept.get(rows[4]!.key), rows[4]);
    // Released revisions wait to upload; the other refusal is reported as refused.
    assert.equal(await db.pendingCount(scope.namespace), 2);
    assert.equal(await db.refusedCount(scope.namespace), 1);
  } finally {
    db.close();
  }
});

test("version 19 sends each saved message the server reported as a conflict once more", async () => {
  // 14 Oct 2026: the organization server reported a saved message as a conflict when a
  // second browser of the member proposed another estimation release for it. It now keeps
  // the stored copy's method, so the update sends those rows once more.
  const name = "resend-server-conflicts-" + crypto.randomUUID();
  const opening = indexedDB.open(name, 18);
  opening.onupgradeneeded = () => {
    for (const store of STORES)
      opening.result
        .createObjectStore(store, { keyPath: "key" })
        .createIndex("namespace", "namespace");
  };
  const old = await request(opening);
  const device = "00000000-0000-4000-8000-000000000099";
  const saved = (letter: string, status: string, serverConflict?: true) => {
    const record = HistoryMessageSchema.parse({
      ...historical(),
      message_key: letter.repeat(64),
    });
    return {
      key: `${scope.namespace}:history:${record.message_key}`,
      namespace: scope.namespace,
      era: scope.era,
      lastImportEra: scope.era,
      record,
      original: record,
      hash: historyNumericPayloadHash(record),
      status,
      ...(serverConflict ? { serverConflict } : {}),
      estimate: estimateHistoricalText(record),
      originalEstimate: estimateHistoricalText(record),
    };
  };
  const rows = [
    // Reported by the server: sent once more.
    saved("d", "conflict", true),
    // Reported by the server, with a newer read already waiting: that read is sent.
    saved("e", "conflict", true),
    // A conflict this browser found itself, and a current row: nothing to send.
    saved("f", "conflict"),
    saved("a", "current"),
  ];
  const waiting = {
    key: rows[1]!.key,
    namespace: scope.namespace,
    era: scope.era,
    deviceId: device,
    hash: "w".repeat(64),
    record: rows[1]!.record,
    nextAt: 0,
  };
  const tx = old.transaction(
      ["history_records", "history_outbox", "policy"],
      "readwrite",
    ),
    done = completed(tx);
  for (const value of rows) tx.objectStore("history_records").put(value);
  tx.objectStore("history_outbox").put(waiting);
  tx.objectStore("policy").put({
    key: "credentials",
    namespace: scope.namespace,
    device_id: device,
  });
  await done;
  old.close();
  const db = await Ledger.open(name);
  try {
    const queued = new Map(
      (await db.all<typeof waiting>("history_outbox")).map((value) => [
        value.key,
        value,
      ]),
    );
    assert.deepEqual(
      [...queued.keys()].sort(),
      [rows[0]!.key, rows[1]!.key].sort(),
    );
    assert.deepEqual(queued.get(rows[0]!.key), {
      key: rows[0]!.key,
      namespace: scope.namespace,
      era: scope.era,
      deviceId: device,
      hash: rows[0]!.hash,
      record: rows[0]!.record,
      nextAt: 0,
    });
    assert.deepEqual(queued.get(rows[1]!.key), waiting);
    // The rows stay as they are until the server answers.
    assert.deepEqual(
      (await db.all<(typeof rows)[number]>("history_records")).map((row) => [
        row.key,
        row.status,
        row.serverConflict,
      ]),
      rows
        .map((row) => [row.key, row.status, row.serverConflict])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
    assert.equal(
      (await db.get<{ version: number }>("schema_migrations", "schema-21"))
        ?.version,
      21,
    );
  } finally {
    db.close();
  }
});

test("version 20 counts waiting and refused revisions on an index built from the saved outbox", async () => {
  // 15 Oct 2026: the dashboard loaded the whole outbox twice to count it. A version 19 outbox
  // must give the same counts once the update has indexed its refused revisions.
  const name = "refused-index-" + crypto.randomUUID();
  const opening = indexedDB.open(name, 19);
  opening.onupgradeneeded = () => {
    for (const store of STORES)
      opening.result
        .createObjectStore(store, { keyPath: "key" })
        .createIndex("namespace", "namespace");
  };
  const old = await request(opening);
  const other = "personal:00000000-0000-4000-8000-000000000077";
  const row = (namespace: string, id: string, quarantined?: string | null) => ({
    key: `${namespace}:attempt:${id}:1`,
    namespace,
    kind: "attempt",
    id,
    revision: 1,
    hash: "h".repeat(64),
    createdAt: 1,
    nextAt: 0,
    attempts: 0,
    ...(quarantined === undefined ? {} : { quarantined }),
  });
  const tx = old.transaction("outbox", "readwrite"),
    done = completed(tx);
  for (const value of [
    row(scope.namespace, "waiting", null),
    // Rows written before the field existed count as waiting, as they did.
    row(scope.namespace, "older"),
    row(scope.namespace, "refused", "payload_rejected"),
    row(scope.namespace, "conflict", "revision_conflict"),
    row(other, "elsewhere", "payload_rejected"),
    row(other, "elsewhere-waiting", null),
  ])
    tx.objectStore("outbox").put(value);
  await done;
  old.close();
  const db = await Ledger.open(name);
  try {
    assert.equal(await db.pendingCount(scope.namespace), 2);
    assert.equal(await db.refusedCount(scope.namespace), 2);
    assert.equal(await db.pendingCount(other), 1);
    assert.equal(await db.refusedCount(other), 1);
    assert.equal(await db.pendingCount("personal:none"), 0);
    assert.equal(await db.refusedCount("personal:none"), 0);
    assert.equal(
      (await db.get<{ version: number }>("schema_migrations", "schema-21"))
        ?.version,
      21,
    );
  } finally {
    db.close();
  }
});

test("version 21 indexes saved attempts by start time and a period scan reads only that period", async () => {
  // 16 Oct 2026: a 30-day total read every attempt and request of the namespace. A version 20
  // database must give the same rows, in the same key order, through the new time index.
  const name = "period-index-" + crypto.randomUUID();
  const opening = indexedDB.open(name, 20);
  opening.onupgradeneeded = () => {
    for (const store of STORES) {
      const created = opening.result.createObjectStore(store, { keyPath: "key" });
      created.createIndex("namespace", "namespace");
      if (store === "requests")
        created.createIndex("occurred", ["namespace", "record.dispatched_at"]);
    }
  };
  const old = await request(opening);
  const other = "personal:00000000-0000-4000-8000-000000000078";
  const row = (namespace: string, kind: "request" | "attempt", id: string, at: string) => ({
    key: `${namespace}:${kind}:${id}`,
    namespace,
    era: null,
    record:
      kind === "request"
        ? { kind, request_id: id, dispatched_at: at }
        : { kind, attempt_id: id, started_at: at },
  });
  const times = [
    "2026-09-01T00:00:00.000Z",
    "2026-09-14T22:59:59.999Z",
    "2026-09-14T23:00:00.000Z",
    "2026-09-20T12:00:00.000Z",
    "2026-10-01T00:00:00.000Z",
    "2026-10-15T10:00:00.000Z",
  ];
  // Ids out of time order, so key order and time order differ.
  const ids = ["f", "c", "a", "e", "b", "d"];
  const tx = old.transaction(["requests", "attempts"], "readwrite"),
    done = completed(tx);
  for (const [index, at] of times.entries())
    for (const kind of ["request", "attempt"] as const) {
      tx.objectStore(`${kind}s`).put(row(scope.namespace, kind, ids[index]!, at));
      tx.objectStore(`${kind}s`).put(row(other, kind, ids[index]!, at));
    }
  await done;
  old.close();
  const db = await Ledger.open(name);
  try {
    assert.equal(
      (await db.get<{ version: number }>("schema_migrations", "schema-21"))
        ?.version,
      21,
    );
    const keys = async (scan: (consume: (rows: Array<{ key: string }>) => void) => Promise<unknown>) => {
      const seen: string[] = [];
      await scan((rows) => {
        for (const row of rows) seen.push(row.key);
      });
      return seen;
    };
    for (const kind of ["request", "attempt"] as const)
      for (const period of [
        { start: "2026-09-14T23:00:00.000Z", end: "2026-10-15T10:00:00.000Z" },
        { start: "2026-09-14T23:00:00.000Z" },
        { end: "2026-09-14T23:00:00.000Z" },
        {},
        { start: "2026-10-16T00:00:00.000Z" },
        { start: "2026-10-01T00:00:00.000Z", end: "2026-09-01T00:00:00.000Z" },
      ]) {
        const full = await keys((consume) => db.scanRecords(scope.namespace, kind, consume));
        const expected = full.filter((key) => {
          const at = times[ids.indexOf(key.split(":").at(-1)!)]!;
          return (!period.start || at >= period.start) && (!period.end || at < period.end);
        });
        assert.deepEqual(
          await keys((consume) => db.scanRecordsBetween(scope.namespace, kind, period, consume)),
          expected,
          `${kind} ${JSON.stringify(period)}`,
        );
      }
  } finally {
    db.close();
  }
});

test("ST03 aborted upgrade rolls back the schema and inputs before a clean retry", async () => {
  const name = "abort-upgrade-" + crypto.randomUUID(),
    seed = await populate(name);
  seed.db.close();
  const opening = indexedDB.open(name, 12);
  opening.onupgradeneeded = () => {
    const tx = opening.transaction!;
    for (const name of [
      "estimation_inputs",
      "estimation_state",
      "estimation_jobs",
      "estimation_results",
      "estimation_originals",
      "engine_preferences",
    ]) {
      const store = opening.result.createObjectStore(name, { keyPath: "key" });
      store.createIndex("namespace", "namespace");
    }
    initializeEstimationIndexes(tx);
    tx.abort();
  };
  await assert.rejects(request(opening), /AbortError/);
  const old = await openV11(name);
  assert.equal(old.version, 11);
  assert.deepEqual(await snapshotV11(old), seed.before);
  old.close();
  const recovered = await Ledger.open(name);
  try {
    assert.equal((await recovered.all("estimation_inputs")).length, 0);
    assert.equal(
      (
        await recovered.estimation.start({
          scope,
          target: methods.original,
          selectionRevision: 1,
        })
      ).snapshotTotal,
      0,
    );
  } finally {
    recovered.close();
  }
});

test("ST14 history survives live age retention but range/profile erasure removes its new views and originals", async () => {
  const name = "retention-" + crypto.randomUUID(),
    seed = await populate(name, true);
  seed.db.close();
  const db = await Ledger.open(name);
  try {
    const job = await db.estimation.start({
      scope,
      target: methods.ecologits,
      selectionRevision: 1,
    });
    const page = await db.estimation.page(job.id);
    for (const input of page.inputs)
      await db.estimation.markUnavailable({
        jobId: job.id,
        inputKey: input.key,
        sequence: input.sequence,
        reason: "method_unsupported",
      });
    await db.estimation.promote(job.id);
    await db.applyRange(scope, null, "2026-09-11T00:00:00.000Z", 1, true);
    assert.equal((await db.historyPage(scope, undefined)).length, 1);
    assert.equal((await db.all("estimation_inputs")).length, 1);
    assert.equal((await db.all("estimation_results")).length, 1);
    await db.applyRange(scope, null, null, 2, false);
    assert.equal((await db.historyPage(scope, undefined)).length, 0);
    assert.equal((await db.all("estimation_inputs")).length, 0);
    await db.eraseNamespace(scope.namespace);
    assert.equal((await db.all("estimation_state")).length, 0);
    assert.ok((await db.all("deletion_markers")).length > 0);
  } finally {
    db.close();
  }
});

test("ST13 historical envelope admission is atomic, pins its method and excludes verified live overlap from contributions", async () => {
  const db = await Ledger.open("history-envelope-" + crypto.randomUUID());
  try {
    const credentials = {
      key: "credentials",
      namespace: scope.namespace,
      device_id: "fixture-device",
      enrollment_era: { id: scope.era },
      enrollment_state: "active",
    };
    await db.put("policy", credentials);
    await db.put("policy", {
      key: "ownership-history",
      eras: [{ scope, start: 0, end: null }],
    });
    const pair = records();
    pair[1].provider_attempt_key = "d".repeat(64);
    pair[1].attempt_id = "00000000-0000-4000-8000-000000000004";
    const original = await executor.estimate({
      family: "live",
      request: pair[0],
      attempt: pair[1],
    });
    await db.capture(scope, pair, [original]);
    const originalBytes = canonicalJson(await db.all("estimation_originals"));
    for (let i = 1; i <= 3; i++) {
      const alias = {
        ...pair[1],
        attempt_id: `00000000-0000-4000-8000-00000000000${i}`,
      };
      const result = await executor.estimate({
        family: "live",
        request: pair[0],
        attempt: alias,
      });
      await db.capture(scope, [alias], [result]);
      await db.markAlias(
        scope.namespace,
        "attempt",
        alias.attempt_id,
        pair[1].attempt_id,
      );
    }
    assert.equal((await db.all("estimation_originals")).length, 4);

    const history = {
      ...historical(),
      conversation_key: pair[0].conversation_key,
      provider_attempt_key: pair[1].provider_attempt_key,
    };
    const { HistoryPageSchema } = await import("@footprint/contracts");
    const page = HistoryPageSchema.parse({
      schema_version: "3.0.0",
      site: "claude",
      conversation_key: history.conversation_key,
      observed_at: history.observed_at,
      deletion_epoch: 0,
      branch_scope: "loaded_messages",
      selected_leaf_key: null,
      branch_message_keys: null,
      root_message_key: null,
      first_request_verified: false,
      has_earlier: null,
      has_later: null,
      messages: [history],
    });
    const envelope = await executor.estimate({
      family: "history",
      record: history,
    });
    const routing = await db.publicationSnapshot(scope.namespace);
    const expected = {
      authority: historyAuthority(routing),
      erasureVersion: routing.erasureVersion,
      estimates: { [history.message_key]: estimateHistoricalText(history) },
      envelopes: { [history.message_key]: envelope },
      healthCodes: [
        "method_unsupported",
        "method_unsupported",
      ] as import("@footprint/contracts").ReasonCode[],
    };
    await assert.rejects(
      db.commitHistory(
        scope,
        page,
        {
          ...expected,
          envelopes: {
            [history.message_key]: { ...envelope, input_hash: "f".repeat(64) },
          },
        },
        () => true,
      ),
    );
    assert.equal((await db.all("history_records")).length, 0);
    assert.equal((await db.all("health")).length, 0);
    assert.equal((await db.all("history_outbox")).length, 0);
    assert.equal((await db.all("estimation_originals")).length, 4);
    await db.commitHistory(scope, page, expected, () => true);
    const health = await db.all<any>("health");
    assert.equal(health.length, 1);
    assert.equal(health[0].count, 1);
    assert.equal(health[0].code, "method_unsupported");
    const views = await db.estimation.viewPage({ scope, view: "original" });
    assert.equal(views.rows.length, 2);
    assert.equal(views.rows.filter((row) => row.contributes).length, 1);
    assert.equal(
      canonicalJson(
        await db.estimation.resultFor(
          scope,
          envelope.source,
          methods.original.method_hash,
        ),
      ),
      canonicalJson(envelope),
    );
    const stored = canonicalJson(await db.all("history_records"));
    const conflicting = {
      ...history,
      proposed_method_id: methods.ecologits.method_id,
      company_dedup_key: null,
      proposed_method_hash: methods.ecologits.method_hash,
    };
    await assert.rejects(
      db.commitHistory(
        scope,
        { ...page, messages: [conflicting] },
        expected,
        () => true,
      ),
      /method_admission_conflict/,
    );
    assert.equal(canonicalJson(await db.all("history_records")), stored);
    // A saved total is its parts' sum, so the larger answer changes both.
    const grownAnswer = { ...history.tokens, value: "101" };
    const changed = {
      ...history,
      text_complete: true,
      tokens: grownAnswer,
      parts: historyResponseParts(grownAnswer),
    };
    const secondEnvelope = await executor.estimate({
      family: "history",
      record: changed,
    });
    await db.commitHistory(
      scope,
      { ...page, messages: [changed] },
      {
        ...expected,
        estimates: { [history.message_key]: estimateHistoricalText(changed) },
        envelopes: { [history.message_key]: secondEnvelope },
      },
      () => true,
    );
    const row = (await db.historyPage(scope, undefined))[0];
    assert.equal(canonicalJson(row.original), canonicalJson(history));
    assert.equal(
      canonicalJson(row.originalEstimate),
      canonicalJson(estimateHistoricalText(history)),
    );
  } finally {
    db.close();
  }
});

for (const aliasOnly of [false, true])
  test(`linked-history erasure resumes after interruption with ${aliasOnly ? "an attempt-only alias" : "a direct canonical family"}`, async () => {
    const name = "history-erasure-resume-" + crypto.randomUUID();
    let db = await Ledger.open(name);
    try {
      await db.put("policy", {
        key: "credentials",
        namespace: scope.namespace,
        device_id: "fixture-device",
        enrollment_era: { id: scope.era },
        enrollment_state: "active",
      });
      await db.put("policy", {
        key: "ownership-history",
        eras: [{ scope, start: 0, end: null }],
      });
      const pair = records();
      pair[1].provider_attempt_key = "d".repeat(64);
      const original = await executor.estimate({
        family: "live",
        request: pair[0],
        attempt: pair[1],
      });
      await db.capture(scope, pair, [original]);
      let erasedRequest = pair[0].request_id;
      if (aliasOnly) {
        const canonical = records();
        await db.capture(scope, canonical, [
          await executor.estimate({
            family: "live",
            request: canonical[0],
            attempt: canonical[1],
          }),
        ]);
        await db.markAlias(
          scope.namespace,
          "attempt",
          pair[1].attempt_id,
          canonical[1].attempt_id,
        );
        erasedRequest = canonical[0].request_id;
      }
      const history = {
        ...historical(),
        conversation_key: pair[0].conversation_key,
        provider_attempt_key: pair[1].provider_attempt_key,
      };
      const { HistoryPageSchema } = await import("@footprint/contracts");
      const page = HistoryPageSchema.parse({
        schema_version: "3.0.0",
        site: "claude",
        conversation_key: history.conversation_key,
        observed_at: history.observed_at,
        deletion_epoch: 0,
        branch_scope: "loaded_messages",
        selected_leaf_key: null,
        branch_message_keys: null,
        root_message_key: null,
        first_request_verified: false,
        has_earlier: null,
        has_later: null,
        messages: [history],
      });
      const envelope = await executor.estimate({
          family: "history",
          record: history,
        }),
        snapshot = await db.publicationSnapshot(scope.namespace);
      const expected = {
        authority: historyAuthority(snapshot),
        erasureVersion: snapshot.erasureVersion,
        estimates: { [history.message_key]: estimateHistoricalText(history) },
        envelopes: { [history.message_key]: envelope },
      };
      await db.commitHistory(scope, page, expected, () => true);
      (db as any).eraseHistoryLinks = async () => {
        throw new Error("history cleanup interrupted");
      };
      await assert.rejects(
        db.eraseFamily(scope.namespace, erasedRequest),
        /history cleanup interrupted/,
      );
      assert.equal((await db.all("history_records")).length, 1);
      assert.equal((await db.historyPage(scope, undefined)).length, 0);
      assert.equal(
        (await db.estimation.viewPage({ scope, view: "original" })).rows.length,
        0,
      );
      assert.equal(
        await db.estimation.resultFor(
          scope,
          envelope.source,
          methods.original.method_hash,
        ),
        null,
      );
      assert.equal((await db.pendingHistory(scope)).length, 0);
      assert.equal(
        (await db.publicationSnapshot(scope.namespace)).erasing,
        true,
      );
      db.close();
      db = await Ledger.open(name);
      const recovery = await db.resumePendingCleanup();
      assert.ok(recovery.processed > 0);
      assert.equal(recovery.pending, false);
      assert.equal((await db.all("history_records")).length, 0);
      assert.equal((await db.all("estimation_originals")).length, 0);
      assert.equal((await db.all("requests")).length, aliasOnly ? 1 : 0);
      assert.equal(
        (await db.publicationSnapshot(scope.namespace)).erasing,
        false,
      );
      assert.equal(
        (await db.all<any>("deletion_markers")).filter((row) =>
          row.key.startsWith("history-cleanup:"),
        ).length,
        0,
      );
      const current = await db.publicationSnapshot(scope.namespace);
      await db.commitHistory(
        scope,
        page,
        {
          ...expected,
          authority: historyAuthority(current),
          erasureVersion: current.erasureVersion,
        },
        () => true,
      );
      assert.equal((await db.all("history_records")).length, 0);
    } finally {
      db.close();
    }
  });
