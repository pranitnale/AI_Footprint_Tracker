import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import {
  calculationInputHash,
  canonicalJson,
  payloadHash,
  type EstimationEnvelope,
} from "@footprint/contracts";
import { Ledger, type Scope } from "../src/index";
import { completed, request } from "../src/ledger-support";
import {
  estimationTransactionStores,
  inputKey,
} from "../src/estimation-storage";
import { originalForLive } from "../src/original-live";
import { records, scope } from "./factory";
import {
  createMethodRegistry,
  LocalEstimateExecutor,
} from "../../estimator/src/index";
import configuration from "../../../config/estimation.build.json";
import mappings from "../../../config/estimation.mappings.json";
import media from "../../../config/estimation.media.json";

const executor = new LocalEstimateExecutor(
  createMethodRegistry(configuration, mappings, media),
);
const personal: Scope = {
  namespace: "personal:original-live",
  mode: "personal",
  era: null,
};
const native = (db: Ledger) => (db as unknown as { db: IDBDatabase }).db;

async function open(t: TestContext) {
  const db = await Ledger.open(`original-live-${crypto.randomUUID()}`);
  t.after(() => db.close());
  return db;
}

async function seed(db: Ledger, owner = personal) {
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
  ]);
  return { pair, original };
}

const selector = (attempt: ReturnType<typeof records>[1]) => ({
  attemptId: attempt.attempt_id,
  attemptRevision: attempt.revision,
  attemptHash: payloadHash(attempt),
});

async function read(
  db: Ledger,
  attempt: ReturnType<typeof records>[1],
  authority = personal,
) {
  const tx = native(db).transaction(estimationTransactionStores, "readonly");
  const [value] = await Promise.all([
    originalForLive(tx, authority, selector(attempt)),
    completed(tx),
  ]);
  return value;
}

async function mutate(
  db: Ledger,
  store: string,
  key: string,
  change: (value: any) => any,
) {
  const tx = native(db).transaction(store, "readwrite");
  const done = completed(tx);
  const objectStore = tx.objectStore(store);
  const value = await request(objectStore.get(key));
  const changed = change(value);
  objectStore.delete(key);
  if (changed !== undefined) objectStore.put(changed);
  await done;
}

const originalKey = (owner: Scope, result: EstimationEnvelope) => {
  assert.equal(result.source.family, "live");
  if (result.source.family !== "live") throw new Error("invalid test source");
  return `${inputKey(owner, "live", result.source.attempt_id)}:${payloadHash(result.source)}:${result.requested_method.method_hash}`;
};

test("public original API and original view retain archived proof after request-only revision", async (t) => {
  const db = await open(t);
  const { pair, original } = await seed(db);
  const archived = canonicalJson(await db.all("estimation_originals"));
  const measurements = await db.all<{ key: string }>("measurements");
  await db.write(personal, {
    ...pair[0],
    revision: 2,
    ended_at: "2026-09-10T10:01:00.000Z",
  });

  const found = await db.estimation.originalForLive(
    personal,
    selector(pair[1]),
  );
  assert.deepEqual(found, {
    result: original,
    request: pair[0],
    attempt: pair[1],
  });
  const view = await db.estimation.viewPage({
    scope: personal,
    view: "original",
  });
  assert.equal(view.rows.length, 1);
  assert.equal(view.rows[0].state, "original");
  assert.equal(view.rows[0].contributes, true);
  assert.deepEqual(view.rows[0].result, original);
  assert.deepEqual(view.rows[0].original, original);
  assert.equal(
    (await db.getRecord(personal.namespace, "request", pair[0].request_id))
      ?.record.revision,
    2,
  );
  assert.equal(canonicalJson(await db.all("estimation_originals")), archived);
  for (const measurement of measurements)
    assert.equal(
      canonicalJson(await db.get("measurements", measurement.key)),
      canonicalJson(measurement),
    );
});

test("public original views resolve current authority for a retained prior enrollment era", async (t) => {
  const db = await open(t);
  const { pair, original } = await seed(db, scope);
  await db.write(scope, { ...pair[0], revision: 2 });
  const current = { ...scope, era: "era-2" };
  await db.put("policy", {
    key: "ownership-history",
    eras: [
      { scope, start: 0, end: 1 },
      { scope: current, start: 1, end: null },
    ],
  });
  await db.put("policy", {
    key: "credentials",
    namespace: current.namespace,
    device_id: "device-1",
    enrollment_era: { id: current.era },
    enrollment_state: "active",
  });
  const before = canonicalJson({
    originals: await db.all("estimation_originals"),
    measurements: await db.all("measurements"),
  });
  assert.deepEqual(
    await db.estimation.originalForLive(current, selector(pair[1])),
    {
      result: original,
      request: pair[0],
      attempt: pair[1],
    },
  );
  assert.equal(
    await db.estimation.originalForLive(scope, selector(pair[1])),
    null,
  );
  const view = await db.estimation.viewPage({ scope, view: "original" });
  assert.equal(view.rows.length, 1);
  assert.equal(view.rows[0].state, "original");
  assert.deepEqual(view.rows[0].result, original);
  assert.deepEqual(view.rows[0].original, original);
  assert.equal(
    canonicalJson({
      originals: await db.all("estimation_originals"),
      measurements: await db.all("measurements"),
    }),
    before,
  );
});

test("original lookup preserves archived request bytes after a request-only revision", async (t) => {
  const db = await open(t);
  const { pair, original } = await seed(db);
  const archiveBefore = canonicalJson(await db.all("estimation_originals"));
  await db.write(personal, {
    ...pair[0],
    revision: 2,
    ended_at: "2026-09-10T10:01:00.000Z",
  });
  const found = await read(db, pair[1]);
  assert.deepEqual(found, {
    result: original,
    request: pair[0],
    attempt: pair[1],
  });
  assert.equal(found?.request.revision, 1);
  assert.equal(
    canonicalJson(await db.all("estimation_originals")),
    archiveBefore,
  );
});

test("original lookup follows the current alias chain without rewriting archived sources", async (t) => {
  const db = await open(t);
  const first = await seed(db);
  const second = await seed(db);
  const third = await seed(db);
  await db.markAlias(
    personal.namespace,
    "request",
    first.pair[0].request_id,
    second.pair[0].request_id,
  );
  await db.markAlias(
    personal.namespace,
    "request",
    second.pair[0].request_id,
    third.pair[0].request_id,
  );
  assert.deepEqual(await read(db, first.pair[1]), {
    result: first.original,
    request: first.pair[0],
    attempt: first.pair[1],
  });
  await db.put("deletion_markers", {
    key: `${personal.namespace}:${third.pair[0].request_id}`,
    namespace: personal.namespace,
  });
  assert.equal(await read(db, first.pair[1]), null);
});

test("an original admitted through a canonical alias retains its archived binding", async (t) => {
  const db = await open(t);
  const observed = records();
  const canonical = records();
  await db.commit(personal, [...observed, ...canonical]);
  await db.markAlias(
    personal.namespace,
    "request",
    observed[0].request_id,
    canonical[0].request_id,
  );
  const input = await db.estimation.liveInput(personal, observed[1].attempt_id);
  assert.ok(input);
  const original = await executor.estimate({
    family: "live",
    request: input.request,
    attempt: input.attempt,
    canonicalRequestBinding: input.source.canonical_request_binding,
  });
  await db.capture(personal, [], [original]);
  await db.write(personal, { ...canonical[0], revision: 2 });
  assert.deepEqual(await read(db, observed[1]), {
    result: original,
    request: canonical[0],
    attempt: observed[1],
  });
});

test("exact current attempt identity is required and superseded or aliased attempts are unavailable", async (t) => {
  const db = await open(t);
  const { pair } = await seed(db);
  assert.equal(await read(db, { ...pair[1], revision: 2 }), null);
  assert.equal(
    await read(db, { ...pair[1], ended_at: "2026-09-10T10:01:00.000Z" }),
    null,
  );
  const updated = { ...pair[1], revision: 2 };
  await db.write(personal, updated);
  assert.equal(await read(db, pair[1]), null);
  assert.equal(await read(db, updated), null);
  const other = await seed(db);
  await db.markAlias(
    personal.namespace,
    "attempt",
    pair[1].attempt_id,
    other.pair[1].attempt_id,
  );
  assert.equal(await read(db, updated), null);
});

test("missing originals and broken current parent chains return no original", async (t) => {
  const db = await open(t);
  const pair = records();
  await db.commit(personal, pair);
  assert.equal(await read(db, pair[1]), null);
  const first = await seed(db);
  const second = await seed(db);
  await db.markAlias(
    personal.namespace,
    "request",
    first.pair[0].request_id,
    second.pair[0].request_id,
  );
  await db.markAlias(
    personal.namespace,
    "request",
    second.pair[0].request_id,
    first.pair[0].request_id,
  );
  assert.equal(await read(db, first.pair[1]), null);
  await mutate(
    db,
    "requests",
    `${personal.namespace}:request:${first.pair[0].request_id}`,
    () => undefined,
  );
  assert.equal(await read(db, first.pair[1]), null);
});

test("namespace, family, attempt and pending-cleanup erasure guards block archived originals", async (t) => {
  for (const kind of ["namespace", "request", "attempt", "cleanup"] as const) {
    await t.test(kind, async (subtest) => {
      const db = await open(subtest);
      const { pair } = await seed(db);
      const keys = {
        namespace: personal.namespace,
        request: `${personal.namespace}:${pair[0].request_id}`,
        attempt: `attempt-erased:${personal.namespace}:${pair[1].attempt_id}`,
        cleanup: `history-cleanup:${personal.namespace}:request:${pair[0].request_id}`,
      };
      await db.put("deletion_markers", {
        key: keys[kind],
        namespace: personal.namespace,
      });
      assert.equal(await read(db, pair[1]), null);
    });
  }
});

test("range erasure checks archived dates as well as current request dates", async (t) => {
  const db = await open(t);
  const { pair } = await seed(db);
  await db.write(personal, {
    ...pair[0],
    revision: 2,
    dispatched_at: "2026-09-12T10:00:00.000Z",
  });
  const range = {
    key: `range:${personal.namespace}:test`,
    namespace: personal.namespace,
    status: "complete",
    start: "2026-09-11T00:00:00.000Z",
    end: "2026-09-12T00:00:00.000Z",
  };
  await db.put("deletion_markers", range);
  assert.ok(await read(db, pair[1]));
  await db.put("deletion_markers", {
    ...range,
    start: "2026-09-10T00:00:00.000Z",
    end: "2026-09-11T00:00:00.000Z",
  });
  assert.equal(await read(db, pair[1]), null);
  await db.put("deletion_markers", {
    ...range,
    start: "2026-09-12T00:00:00.000Z",
    end: "2026-09-13T00:00:00.000Z",
  });
  assert.equal(await read(db, pair[1]), null);
});

test("original reads use a current local grant for the stored historical era", async (t) => {
  const db = await open(t);
  const { pair, original } = await seed(db, scope);
  const current = { ...scope, era: "era-2" };
  await db.put("policy", {
    key: "ownership-history",
    eras: [
      { scope, start: 0, end: 1 },
      { scope: current, start: 1, end: null },
    ],
  });
  await db.put("policy", {
    key: "credentials",
    namespace: current.namespace,
    device_id: "device-1",
    enrollment_era: { id: current.era },
    enrollment_state: "active",
  });
  assert.deepEqual(await read(db, pair[1], current), {
    result: original,
    request: pair[0],
    attempt: pair[1],
  });
  assert.equal(await read(db, pair[1], scope), null);
  assert.equal(
    await read(db, pair[1], { ...current, namespace: "company:other" }),
    null,
  );
  await db.put("policy", {
    key: "ownership-history",
    eras: [{ scope: current, start: 1, end: null }],
  });
  assert.equal(await read(db, pair[1], current), null);
});

test("a valid current pointer chooses among several exact-attempt originals using bounded lookups", async (t) => {
  const db = await open(t);
  const { pair } = await seed(db);
  let latest: EstimationEnvelope | undefined;
  let latestRequest = pair[0];
  for (const revision of [2, 3]) {
    latestRequest = { ...pair[0], revision };
    latest = await executor.estimate({
      family: "live",
      request: latestRequest,
      attempt: pair[1],
    });
    await db.commit(
      personal,
      [latestRequest],
      [
        {
          store: "local_estimates",
          value: {
            key: `current:${personal.namespace}:${pair[1].attempt_id}`,
            namespace: personal.namespace,
            selection: "current",
            estimate: latest,
          },
        },
      ],
    );
  }
  const getAll = IDBIndex.prototype.getAll;
  let lookups = 0;
  t.mock.method(
    IDBIndex.prototype,
    "getAll",
    function (
      this: IDBIndex,
      query?: IDBValidKey | IDBKeyRange | null,
      count?: number,
    ) {
      if (this.name === "attemptSource") {
        assert.deepEqual(query, [
          inputKey(personal, "live", pair[1].attempt_id),
          pair[1].revision,
          payloadHash(pair[1]),
        ]);
        assert.equal(count, 2);
        lookups++;
      }
      return getAll.call(this, query, count);
    },
  );
  assert.deepEqual(await read(db, pair[1]), {
    result: latest,
    request: latestRequest,
    attempt: pair[1],
  });
  assert.equal(lookups, 1);
  assert.equal((await db.all("estimation_originals")).length, 3);
  await db.remove(
    "local_estimates",
    `current:${personal.namespace}:${pair[1].attempt_id}`,
  );
  assert.equal(await read(db, pair[1]), null);
});

test("a forged compatibility pointer cannot select an unarchived envelope", async (t) => {
  const db = await open(t);
  const { pair } = await seed(db);
  const updated = { ...pair[0], revision: 2 };
  const latest = await executor.estimate({
    family: "live",
    request: updated,
    attempt: pair[1],
  });
  await db.capture(personal, [updated], [latest]);
  const pointerKey = `current:${personal.namespace}:${pair[1].attempt_id}`;
  await mutate(db, "local_estimates", pointerKey, (row) => ({
    ...row,
    estimate: { ...latest, execution_origin: "organization" },
  }));
  assert.equal(await read(db, pair[1]), null);
});

test("missing or forged immutable measurements fail visibly", async (t) => {
  const changes: Array<[string, (row: any) => any]> = [
    ["missing row", () => undefined],
    ["missing hash", (row) => ({ ...row, hash: undefined })],
    ["forged hash", (row) => ({ ...row, hash: "f".repeat(64) })],
    [
      "changed numeric bytes",
      (row) => ({ ...row, record: { ...row.record, revision: 99 } }),
    ],
    ["wrong namespace", (row) => ({ ...row, namespace: "personal:other" })],
    ["wrong era", (row) => ({ ...row, era: "another-era" })],
  ];
  for (const kind of ["request", "attempt"] as const) {
    for (const [name, change] of changes) {
      await t.test(`${kind}: ${name}`, async (subtest) => {
        const db = await open(subtest);
        const { pair } = await seed(db);
        const id = kind === "request" ? pair[0].request_id : pair[1].attempt_id;
        await mutate(
          db,
          "measurements",
          `${personal.namespace}:${kind}:${id}:1`,
          change,
        );
        await assert.rejects(read(db, pair[1]), /ledger_integrity_failed/);
      });
    }
  }
});

test("forged archived envelope metadata or source hashes fail visibly", async (t) => {
  const changes: Array<[string, (row: any) => any]> = [
    ["missing source hash", (row) => ({ ...row, sourceHash: undefined })],
    ["forged source hash", (row) => ({ ...row, sourceHash: "f".repeat(64) })],
    ["wrong namespace", (row) => ({ ...row, namespace: "personal:other" })],
    ["wrong primary key", (row) => ({ ...row, key: `${row.key}:forged` })],
    [
      "invalid envelope input hash",
      (row) => ({
        ...row,
        result: { ...row.result, input_hash: "f".repeat(64) },
      }),
    ],
    [
      "forged archived request hash",
      (row) => {
        const result = {
          ...row.result,
          source: { ...row.result.source, request_hash: "f".repeat(64) },
        };
        result.input_hash = calculationInputHash(result);
        return {
          ...row,
          key: originalKey(personal, result),
          sourceHash: payloadHash(result.source),
          result,
        };
      },
    ],
    [
      "invented alias binding",
      (row) => {
        const result = {
          ...row.result,
          source: {
            ...row.result.source,
            canonical_request_binding: {
              observed_request_id: row.result.source.request_id,
              canonical_request_id: row.result.source.request_id,
              relation_hash: "f".repeat(64),
            },
          },
        };
        result.input_hash = calculationInputHash(result);
        return {
          ...row,
          key: originalKey(personal, result),
          sourceHash: payloadHash(result.source),
          result,
        };
      },
    ],
  ];
  for (const [name, change] of changes) {
    await t.test(name, async (subtest) => {
      const db = await open(subtest);
      const { pair, original } = await seed(db);
      await mutate(
        db,
        "estimation_originals",
        originalKey(personal, original),
        change,
      );
      await assert.rejects(read(db, pair[1]), /ledger_integrity_failed/);
    });
  }
});

test("self-consistent forged alias source outside the current chain stays unavailable", async (t) => {
  const db = await open(t);
  const first = await seed(db);
  const unrelated = await seed(db);
  await mutate(
    db,
    "estimation_originals",
    originalKey(personal, first.original),
    (row) => {
      const source = {
        ...row.result.source,
        request_id: unrelated.pair[0].request_id,
        request_revision: unrelated.pair[0].revision,
        request_hash: payloadHash(unrelated.pair[0]),
        canonical_request_binding: {
          observed_request_id: first.pair[0].request_id,
          canonical_request_id: unrelated.pair[0].request_id,
          relation_hash: payloadHash({
            kind: "canonical_request_alias",
            observed_request_id: first.pair[0].request_id,
            canonical_request_id: unrelated.pair[0].request_id,
          }),
        },
      };
      const result = { ...row.result, source };
      result.input_hash = calculationInputHash(result);
      return {
        ...row,
        key: originalKey(personal, result),
        sourceHash: payloadHash(source),
        result,
      };
    },
  );
  assert.equal(await read(db, first.pair[1]), null);
});
