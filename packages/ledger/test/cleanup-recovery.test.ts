import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { resumePendingCleanup } from "../src/cleanup-recovery";
import { completed, request } from "../src/ledger-support";

const namespace = "personal:local";
const companyNamespace = "company:tenant:user";
const id = (number: number) =>
  `00000000-0000-4000-8000-${number.toString(16).padStart(12, "0")}`;
const key = (scope: string, kind: string, target: string) =>
  `history-cleanup:${scope}:${kind}:${target}`;
const marker = (
  scope = namespace,
  kind = "request",
  target = id(1),
  era: string | null = null,
) => ({
  key: key(scope, kind, target),
  namespace: scope,
  era,
  keys: [["request", "a".repeat(64)]],
});

async function open(name = `cleanup-recovery-${crypto.randomUUID()}`) {
  const opening = indexedDB.open(name, 1);
  opening.onupgradeneeded = () => {
    // Explicit keys let the integrity tests model corrupt key/value bindings.
    opening.result.createObjectStore("deletion_markers");
  };
  return request(opening);
}

async function put(db: IDBDatabase, value: unknown, primaryKey: string) {
  const tx = db.transaction("deletion_markers", "readwrite");
  tx.objectStore("deletion_markers").put(value, primaryKey);
  await completed(tx);
}

async function remove(db: IDBDatabase, ...keys: string[]) {
  const tx = db.transaction("deletion_markers", "readwrite");
  for (const primaryKey of keys)
    tx.objectStore("deletion_markers").delete(primaryKey);
  await completed(tx);
}

async function get(db: IDBDatabase, primaryKey: string) {
  const tx = db.transaction("deletion_markers", "readonly");
  const [value] = await Promise.all([
    request(tx.objectStore("deletion_markers").get(primaryKey)),
    completed(tx),
  ]);
  return value;
}

function actions(db: IDBDatabase, calls: unknown[][] = []) {
  return {
    async eraseFamily(scope: string, requestId: string) {
      calls.push(["request", scope, requestId]);
      await remove(db, key(scope, "request", requestId));
    },
    async eraseAttemptAliases(
      scope: string,
      attemptId: string,
      era: string | null,
    ) {
      calls.push(["attempt", scope, attemptId, era]);
      await remove(db, key(scope, "attempt", attemptId));
    },
  };
}

test("cleanup resumes after close and reopen with exact namespace and attempt era", async (t) => {
  let db = await open();
  const name = db.name;
  const pending = [
    marker(namespace, "request", id(1)),
    marker(namespace, "attempt", id(1)),
    marker(companyNamespace, "request", id(1), "era-1"),
    marker(companyNamespace, "attempt", id(1), "era-2"),
    marker(companyNamespace, "attempt", id(2), null),
  ];
  for (const entry of pending) await put(db, entry, entry.key);
  const unrelated = { key: `${namespace}:${id(1)}`, namespace };
  await put(db, unrelated, unrelated.key);
  db.close();
  db = await open(name);
  t.after(() => db.close());

  const calls: unknown[][] = [];
  assert.deepEqual(await resumePendingCleanup(db, actions(db, calls)), {
    processed: 5,
    pending: false,
  });
  assert.deepEqual(calls, [
    ["attempt", companyNamespace, id(1), "era-2"],
    ["attempt", companyNamespace, id(2), null],
    ["request", companyNamespace, id(1)],
    ["attempt", namespace, id(1), null],
    ["request", namespace, id(1)],
  ]);
  assert.deepEqual(await get(db, unrelated.key), unrelated);
  assert.deepEqual(await resumePendingCleanup(db, actions(db, calls)), {
    processed: 0,
    pending: false,
  });
  assert.equal(calls.length, 5);
});

test("cleanup respects the requested limit and the default maximum of 32", async (t) => {
  const db = await open();
  t.after(() => db.close());
  for (let index = 1; index <= 35; index++) {
    const entry = marker(namespace, "request", id(index));
    await put(db, entry, entry.key);
  }
  const calls: unknown[][] = [];
  assert.deepEqual(await resumePendingCleanup(db, actions(db, calls), 2), {
    processed: 2,
    pending: true,
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(await resumePendingCleanup(db, actions(db, calls)), {
    processed: 32,
    pending: true,
  });
  assert.equal(calls.length, 34);
  assert.deepEqual(await resumePendingCleanup(db, actions(db, calls), 1), {
    processed: 1,
    pending: false,
  });
  assert.equal(calls.length, 35);
});

test("invalid limits reject without dispatch or deletion", async (t) => {
  const db = await open();
  t.after(() => db.close());
  const entry = marker();
  await put(db, entry, entry.key);
  const calls: unknown[][] = [];
  for (const limit of [0, -1, 33, 1.5, NaN, Infinity])
    await assert.rejects(
      resumePendingCleanup(db, actions(db, calls), limit),
      /cleanup_limit_invalid/,
    );
  assert.equal(calls.length, 0);
  assert.deepEqual(await get(db, entry.key), entry);
});

test("selection and marker read transactions finish before cleanup writes begin", async (t) => {
  const db = await open();
  t.after(() => db.close());
  const entry = marker();
  await put(db, entry, entry.key);
  const activeReads = new Set<IDBTransaction>();
  const transaction = db.transaction.bind(db);
  t.mock.method(
    db,
    "transaction",
    (
      stores: string | string[],
      mode?: IDBTransactionMode,
      options?: IDBTransactionOptions,
    ) => {
      const tx = transaction(stores, mode, options);
      if (tx.mode === "readonly") {
        activeReads.add(tx);
        tx.addEventListener("complete", () => activeReads.delete(tx));
      }
      return tx;
    },
  );
  const cleanup = actions(db);
  cleanup.eraseFamily = async () => {
    assert.equal(activeReads.size, 0);
    await remove(db, entry.key);
  };
  assert.deepEqual(await resumePendingCleanup(db, cleanup), {
    processed: 1,
    pending: false,
  });
  assert.equal(activeReads.size, 0);
});

test("a nested marker removed by earlier cleanup is neither dispatched nor counted", async (t) => {
  const db = await open();
  t.after(() => db.close());
  const root = marker();
  const descendant = marker(namespace, "request", id(2));
  await put(db, root, root.key);
  await put(db, descendant, descendant.key);
  const calls: unknown[][] = [];
  const cleanup = actions(db, calls);
  cleanup.eraseFamily = async (scope, requestId) => {
    calls.push(["request", scope, requestId]);
    await remove(db, root.key, descendant.key);
  };
  assert.deepEqual(await resumePendingCleanup(db, cleanup), {
    processed: 1,
    pending: false,
  });
  assert.deepEqual(calls, [["request", namespace, id(1)]]);
});

test("transient cleanup failure stays visible and retains the marker for retry", async (t) => {
  const db = await open();
  t.after(() => db.close());
  const entry = marker(companyNamespace, "attempt", id(1), "era-1");
  await put(db, entry, entry.key);
  const failure = new Error("storage_write_failed");
  const cleanup = actions(db);
  cleanup.eraseAttemptAliases = async () => {
    throw failure;
  };
  await assert.rejects(
    resumePendingCleanup(db, cleanup),
    (error) => error === failure,
  );
  assert.deepEqual(await get(db, entry.key), entry);
  assert.deepEqual(await resumePendingCleanup(db, actions(db)), {
    processed: 1,
    pending: false,
  });
});

test("successful callbacks that retain their marker still report pending work", async (t) => {
  const db = await open();
  t.after(() => db.close());
  const entry = marker();
  await put(db, entry, entry.key);
  const cleanup = actions(db);
  cleanup.eraseFamily = async () => {};
  assert.deepEqual(await resumePendingCleanup(db, cleanup), {
    processed: 1,
    pending: true,
  });
  assert.deepEqual(await get(db, entry.key), entry);
});

test("malformed markers never authorize a cleanup action", async (t) => {
  const valid = marker();
  const invalid: Array<[string, unknown, string?]> = [
    ["null marker", null],
    ["primitive marker", "invalid"],
    ["different primary key", valid, key(namespace, "request", id(2))],
    ["different namespace", { ...valid, namespace: "personal:other" }],
    ["invalid namespace", marker("personal:UPPER")],
    ["namespace with trailing newline", marker("personal:local\n")],
    ["unsupported namespace", marker("team:local")],
    ["empty namespace", marker("personal:")],
    ["long namespace", marker(`personal:${"a".repeat(161)}`)],
    ["invalid kind", marker(namespace, "history")],
    ["invalid ID", marker(namespace, "request", "not-a-uuid")],
    ["ID with trailing newline", marker(namespace, "request", `${id(1)}\n`)],
    [
      "invalid UUID variant",
      marker(namespace, "request", "00000000-0000-4000-0000-000000000001"),
    ],
    ["extra key suffix", { ...valid, key: `${valid.key}:other` }],
    ["missing era", { ...valid, era: undefined }],
    ["empty company era", marker(companyNamespace, "request", id(1), "")],
    ["invalid company era", { ...marker(companyNamespace), era: 1 }],
    [
      "long company era",
      marker(companyNamespace, "request", id(1), "e".repeat(257)),
    ],
    ["missing stable keys", { ...valid, keys: undefined }],
    ["sparse stable keys", { ...valid, keys: new Array(1) }],
    [
      "invalid stable key kind",
      { ...valid, keys: [["history", "a".repeat(64)]] },
    ],
    [
      "invalid stable key hash",
      { ...valid, keys: [["request", "provider-id"]] },
    ],
    [
      "stable key hash with trailing newline",
      { ...valid, keys: [["request", `${"a".repeat(64)}\n`]] },
    ],
    [
      "extra stable key tuple item",
      { ...valid, keys: [["request", "a".repeat(64), "other"]] },
    ],
  ];
  for (const [name, value, primaryKey] of invalid) {
    await t.test(name, async (subtest) => {
      const db = await open();
      subtest.after(() => db.close());
      const storedKey =
        primaryKey ?? (value as { key?: string } | null)?.key ?? valid.key;
      await put(db, value, storedKey);
      const calls: unknown[][] = [];
      await assert.rejects(
        resumePendingCleanup(db, actions(db, calls)),
        /ledger_integrity_failed/,
      );
      assert.equal(calls.length, 0);
      assert.deepEqual(await get(db, storedKey), value);
    });
  }
});

test("a selected marker changed by an earlier action is validated again", async (t) => {
  const db = await open();
  t.after(() => db.close());
  const first = marker();
  const second = marker(namespace, "request", id(2));
  await put(db, first, first.key);
  await put(db, second, second.key);
  const calls: unknown[][] = [];
  const cleanup = actions(db, calls);
  cleanup.eraseFamily = async (scope, requestId) => {
    calls.push(["request", scope, requestId]);
    await remove(db, first.key);
    await put(db, { ...second, namespace: "personal:other" }, second.key);
  };
  await assert.rejects(
    resumePendingCleanup(db, cleanup),
    /ledger_integrity_failed/,
  );
  assert.deepEqual(calls, [["request", namespace, id(1)]]);
  assert.equal((await get(db, second.key)).namespace, "personal:other");
});
