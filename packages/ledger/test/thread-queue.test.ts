import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { Ledger, type OutboxRow } from "../src/index";
import { records, scope } from "./factory";
const thread = "d".repeat(64);
async function seed(db: Ledger, count: number) {
  const keys: string[] = [],
    ids: string[] = [];
  for (let i = 1; i <= count; i++) {
    const r = records()[0];
    r.site = "perplexity";
    r.provider_request_key = i.toString(16).padStart(64, "0");
    keys.push(r.provider_request_key);
    ids.push(r.request_id);
    await db.commit(scope, [r]);
  }
  for (let offset = 0; offset < keys.length; offset += 100)
    await db.linkRecordedThread(
      scope,
      thread,
      keys.slice(offset, offset + 100),
      0,
    );
  return { keys, ids };
}
async function acknowledge(db: Ledger, row: OutboxRow) {
  await db.acknowledge(
    scope.namespace,
    crypto.randomUUID(),
    [
      {
        kind: row.kind,
        id: row.id,
        revision: row.revision,
        payload_hash: row.hash,
        server_record_version: row.revision,
        status: "applied",
      },
    ],
    [row],
  );
}

test("a quarantined 100-row prefix cannot starve an acknowledged 101st link after restart", async () => {
  const name = "thread-fair-" + crypto.randomUUID();
  let db = await Ledger.open(name);
  try {
    const { keys, ids } = await seed(db, 101),
      rows = await db.pending(scope.namespace);
    for (const row of rows)
      if (row.id !== ids[100])
        await db.put("outbox", { ...row, quarantined: "payload_rejected" });
    await acknowledge(
      db,
      rows.find((row) => row.id === ids[100])!,
    );
    assert.deepEqual(await db.pendingThreadLinks(scope.namespace), []);
    const cursor = await db.get<any>(
      "policy",
      `thread-queue-cursor:${scope.namespace}`,
    );
    assert.equal(cursor.after.key, `${scope.namespace}:${keys[99]}`);
    db.close();
    db = await Ledger.open(name);
    const ready = await db.pendingThreadLinks(scope.namespace);
    assert.equal(ready.length, 1);
    assert.equal(ready[0]!.requestId, ids[100]);
    assert.equal((await db.all("thread_relations")).length, 101);
    assert.equal((await db.pending(scope.namespace)).length, 100);
  } finally {
    db.close();
  }
});

test("bounded fair cycles cross multiple held blocks and revisit an earlier late ACK", async () => {
  const db = await Ledger.open("thread-long-fair-" + crypto.randomUUID());
  try {
    const { ids } = await seed(db, 301),
      rows = await db.pending(scope.namespace);
    await acknowledge(
      db,
      rows.find((row) => row.id === ids[300])!,
    );
    assert.deepEqual(await db.pendingThreadLinks(scope.namespace), []);
    await acknowledge(
      db,
      rows.find((row) => row.id === ids[0])!,
    );
    assert.deepEqual(await db.pendingThreadLinks(scope.namespace), []);
    assert.deepEqual(await db.pendingThreadLinks(scope.namespace), []);
    assert.equal(
      (await db.pendingThreadLinks(scope.namespace))[0]!.requestId,
      ids[300],
    );
    assert.equal(
      (await db.pendingThreadLinks(scope.namespace))[0]!.requestId,
      ids[0],
    );
  } finally {
    db.close();
  }
});

test("one failing thread cannot hide another eligible thread in the same bounded page", async () => {
  const db = await Ledger.open("thread-groups-fair-" + crypto.randomUUID());
  try {
    const { keys, ids } = await seed(db, 2),
      rows = await db.pending(scope.namespace);
    const second = (await db.all<any>("thread_relations")).find(
      (row) => row.providerRequestKey === keys[1],
    );
    await db.put("thread_relations", { ...second, threadKey: "e".repeat(64) });
    for (const row of rows) await acknowledge(db, row);
    const first = await db.pendingThreadLinks(scope.namespace);
    assert.equal(first.length, 1);
    assert.equal(first[0]!.requestId, ids[0]);
    // No server ACK or removal of the first thread is needed to advance.
    const next = await db.pendingThreadLinks(scope.namespace);
    assert.equal(next.length, 1);
    assert.equal(next[0]!.requestId, ids[1]);
  } finally {
    db.close();
  }
});

test("erasure resets a persisted cursor and namespace cleanup removes its metadata", async () => {
  const db = await Ledger.open("thread-erased-cursor-" + crypto.randomUUID());
  try {
    const { ids } = await seed(db, 101),
      rows = await db.pending(scope.namespace);
    assert.deepEqual(await db.pendingThreadLinks(scope.namespace), []);
    await db.eraseFamily(scope.namespace, ids[99]!);
    assert.equal(
      await db.get("policy", `thread-queue-cursor:${scope.namespace}`),
      undefined,
    );
    await acknowledge(
      db,
      rows.find((row) => row.id === ids[0])!,
    );
    const next = await db.pendingThreadLinks(scope.namespace);
    assert.equal(next[0]!.requestId, ids[0]);
    await db.eraseNamespace(scope.namespace);
    assert.equal(
      await db.get("policy", `thread-queue-cursor:${scope.namespace}`),
      undefined,
    );
    assert.deepEqual(await db.pendingThreadLinks(scope.namespace), []);
    assert.equal((await db.all("thread_relations")).length, 0);
  } finally {
    db.close();
  }
});

test("range erasure removes the cursor at the same committed boundary as its deleted keys", async () => {
  const db = await Ledger.open("thread-range-cursor-" + crypto.randomUUID());
  try {
    await seed(db, 101);
    await db.pendingThreadLinks(scope.namespace);
    assert.ok(await db.get("policy", `thread-queue-cursor:${scope.namespace}`));
    await db.applyRange(scope, null, "2030-01-01T00:00:00.000Z", 1);
    assert.equal((await db.all("thread_relations")).length, 0);
    assert.equal(
      await db.get("policy", `thread-queue-cursor:${scope.namespace}`),
      undefined,
    );
  } finally {
    db.close();
  }
});
