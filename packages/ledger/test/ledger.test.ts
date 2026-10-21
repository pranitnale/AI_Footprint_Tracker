import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Ledger, digest } from "../src/index";
import { scope, records, withOutputTotal } from "./factory";
const open = () => Ledger.open("test-" + crypto.randomUUID());
test("L01 L03 revisions and company outbox commit together; personal has no outbox", async () => {
  const db = await open();
  const [r, a] = records();
  await db.commit(
    scope,
    [r, a],
    [
      {
        store: "provider_key_map",
        value: { key: "checkpoint", namespace: scope.namespace, revision: 1 },
      },
    ],
  );
  assert.equal((await db.rows(scope.namespace)).length, 2);
  assert.equal((await db.queue(scope.namespace)).length, 2);
  const local = {
    namespace: "personal:abc",
    mode: "personal" as const,
    era: null,
  };
  await db.commit(local, [r, a]);
  assert.equal((await db.queue(local.namespace)).length, 0);
  db.close();
});
test("L02 strict persistence rejects content and missing parent without partial writes", async () => {
  const db = await open();
  const [r, a] = records();
  await assert.rejects(
    db.commit(scope, [r, { ...a, answer: "PRIVATE_MARKER" }]),
  );
  assert.equal((await db.rows(scope.namespace)).length, 0);
  await assert.rejects(db.write(scope, a), /dependency_missing/);
  assert.equal((await db.queue(scope.namespace)).length, 0);
  db.close();
});
test("L04 crash/reopen idempotency preserves checkpoint and revision conflict is atomic", async () => {
  const name = "restart-" + crypto.randomUUID();
  let db = await Ledger.open(name);
  const [r, a] = records();
  await db.commit(
    scope,
    [r, a],
    [
      {
        store: "provider_key_map",
        value: {
          key: "checkpoint",
          namespace: scope.namespace,
          captureRevision: 7,
        },
      },
    ],
  );
  db.close();
  db = await Ledger.open(name);
  await db.commit(scope, [r, a]);
  assert.equal((await db.queue(scope.namespace)).length, 2);
  await assert.rejects(
    db.commit(scope, [
      { ...r, revision: 2 },
      {
        ...a,
        tokens: withOutputTotal({
          ...a.tokens,
          answer_output: { ...a.tokens.answer_output, value: "50" },
        }),
      },
    ]),
    /revision_conflict/,
  );
  assert.equal(
    (await db.rows(scope.namespace)).find((x) => x.record.kind === "request")!
      .record.revision,
    1,
  );
  assert.equal(
    (await db.get<any>("provider_key_map", "checkpoint")).captureRevision,
    7,
  );
  db.close();
});
test("L05 final downward correction replaces contribution, preserves history and ACK hash ownership", async () => {
  const db = await open();
  const [r, a] = records();
  await db.commit(scope, [r, a]);
  const initial = await db.queue(scope.namespace);
  const corrected = {
    ...a,
    revision: 2,
    tokens: withOutputTotal({
      ...a.tokens,
      answer_output: { ...a.tokens.answer_output, value: "25" },
    }),
  };
  await db.write(scope, corrected);
  const ack = {
    kind: "attempt" as const,
    id: a.attempt_id,
    revision: 1,
    server_record_version: 1,
    status: "applied" as const,
    payload_hash: "0".repeat(64),
  };
  await db.acknowledge(scope.namespace, "batch", [ack], initial);
  assert.equal((await db.queue(scope.namespace)).length, 3);
  await db.acknowledge(
    scope.namespace,
    "batch",
    [{ ...ack, payload_hash: await digest(a) }],
    initial,
  );
  const remaining = await db.queue(scope.namespace);
  assert.equal(remaining.length, 2);
  assert.ok(remaining.some((row) => row.revision === 2));
  assert.equal(
    (await db.rows(scope.namespace)).find((x) => x.record.kind === "attempt")!
      .record.revision,
    2,
  );
  db.close();
});
test("L06 Y03 retry timing and partial acknowledgements keep unconfirmed rows", async () => {
  const db = await open();
  const values = records();
  await db.commit(scope, values);
  const rows = await db.queue(scope.namespace);
  await db.retry(rows, 60000, () => 0);
  assert.equal((await db.queue(scope.namespace)).length, 0);
  assert.equal((await db.pending(scope.namespace)).length, 2);
  assert.ok(
    (await db.pending(scope.namespace)).every(
      (r) => r.nextAt >= Date.now() + 59000,
    ),
  );
  db.close();
});
test("D01 family erasure removes revisions/outbox and blocks resurrection, later requests remain writable", async () => {
  const db = await open();
  const [r, a] = records();
  await db.commit(scope, [r, a]);
  await db.eraseFamily(scope.namespace, r.request_id);
  assert.equal((await db.rows(scope.namespace)).length, 0);
  assert.equal((await db.queue(scope.namespace)).length, 0);
  await assert.rejects(
    db.commit(scope, [{ ...r, revision: 2 }]),
    /record_erased/,
  );
  await db.commit(scope, records());
  assert.equal((await db.rows(scope.namespace)).length, 2);
  db.close();
});
test("L09 same IDs remain independent across local/company namespaces", async () => {
  const db = await open();
  const data = records();
  const other = { ...scope, namespace: "company:other" };
  await db.commit(scope, data);
  await db.commit(other, data);
  await db.eraseNamespace(scope.namespace);
  assert.equal((await db.rows(other.namespace)).length, 2);
  db.close();
});
