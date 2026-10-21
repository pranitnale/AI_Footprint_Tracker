import { openDatabase } from "../src/database";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { canonicalJson, payloadHash } from "@footprint/contracts";
import {
  createMethodRegistry,
  LocalEstimateExecutor,
} from "../../estimator/src/index";
import configuration from "../../../config/estimation.build.json";
import mappings from "../../../config/estimation.mappings.json";
import media from "../../../config/estimation.media.json";
import { Ledger, type Scope } from "../src/index";
import { completed, request } from "../src/ledger-support";
import { records } from "./factory";
import { createV13, snapshotV13, v13Stores } from "./v13-fixture";
const methods = createMethodRegistry(configuration, mappings, media),
  executor = new LocalEstimateExecutor(methods);
const scope: Scope = {
  namespace: "personal:v13-proof-upgrade",
  mode: "personal",
  era: null,
};
async function populate(name: string, current = false) {
  const db = current ? await openDatabase(name) : await createV13(name),
    pair = records();
  pair[1].proposed_method_id = methods.ecologits.method_id;
  const original = await executor.estimate(
    { family: "live", request: pair[0], attempt: pair[1] },
    { methodId: methods.ecologits.method_id },
  );
  const tx = db.transaction(v13Stores, "readwrite"),
    done = completed(tx);
  // Opaque existing metadata is also retained byte-for-byte, even when unrelated to the new index.
  for (const name of v13Stores)
    tx.objectStore(name).put({
      key: `untouched:${name}`,
      value: { retained: [1, 2, 3], tag: name },
    });
  for (const record of pair) {
    const id =
        record.kind === "request" ? record.request_id : record.attempt_id,
      key = `${scope.namespace}:${record.kind}:${id}`;
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
  const scopeKey = canonicalJson(scope),
    inputKey = `${scopeKey}:live:${pair[1].attempt_id}`;
  tx.objectStore("estimation_inputs").put({
    key: inputKey,
    namespace: scope.namespace,
    era: null,
    scopeKey,
    family: "live",
    id: pair[1].attempt_id,
    sequence: 7,
    dependencies: [`${scope.namespace}:${pair[0].request_id}`],
    originalMethodHash: methods.ecologits.method_hash,
    originalMethodId: methods.ecologits.method_id,
  });
  tx.objectStore("estimation_state").put({
    key: scopeKey,
    namespace: scope.namespace,
    sequence: 7,
    generation: 3,
    publicationVersion: 2,
    activeJob: null,
    selectedJob: null,
  });
  const sourceHash = payloadHash(original.source);
  tx.objectStore("estimation_originals").put({
    key: `${inputKey}:${sourceHash}:${methods.ecologits.method_hash}`,
    namespace: scope.namespace,
    inputKey,
    sourceHash,
    result: original,
  });
  tx.objectStore("local_estimates").put({
    key: `current:${scope.namespace}:${pair[1].attempt_id}`,
    namespace: scope.namespace,
    selection: "current",
    estimate: original,
  });
  tx.objectStore("engine_preferences").put({
    key: "installation",
    record: {
      schema_version: "1.0.0",
      preference: "build_default",
      selection_revision: 1,
      updated_at: "2026-09-15T00:00:00.000Z",
    },
  });
  tx.objectStore("policy").put({
    key: "personal",
    namespace: scope.namespace,
    secret: "a".repeat(64),
  });
  tx.objectStore("policy").put({
    key: "ownership-history",
    eras: [
      {
        scope,
        start: 0,
        end: null,
        secret: "a".repeat(64),
        policyVersion: "1.0.0",
      },
    ],
  });
  tx.objectStore("schema_migrations").put({
    key: "schema-13",
    version: 13,
    at: 123,
  });
  await done;
  const before = await snapshotV13(db);
  db.close();
  return before;
}
test("version13 usage and original proofs are discarded while the engine preference survives", async () => {
  const name = crypto.randomUUID();
  await populate(name);
  const ledger = await Ledger.open(name);
  try {
    assert.deepEqual(await ledger.all("estimation_inputs"), []);
    assert.deepEqual(await ledger.all("estimation_originals"), []);
    assert.equal(
      (await ledger.estimation.readPreference())?.preference,
      "build_default",
    );
    assert.equal(
      (await ledger.get<any>("policy", "personal")).namespace,
      scope.namespace,
    );
  } finally {
    ledger.close();
  }
});

test("aborted version13-to14 index upgrade preserves the old schema/data and permits clean retry", async () => {
  const name = crypto.randomUUID(),
    before = await populate(name),
    create = IDBObjectStore.prototype.createIndex;
  let injected = false;
  IDBObjectStore.prototype.createIndex = function (...args) {
    const index = create.apply(this, args);
    if (this.name === "estimation_inputs" && args[0] === "originalMethod") {
      injected = true;
      const tx = this.transaction;
      queueMicrotask(() => tx.abort());
    }
    return index;
  };
  try {
    await assert.rejects(Ledger.open(name));
  } finally {
    IDBObjectStore.prototype.createIndex = create;
  }
  assert.equal(injected, true);
  const old = await request(indexedDB.open(name, 13));
  assert.equal(old.version, 13);
  assert.equal(
    old
      .transaction("estimation_inputs")
      .objectStore("estimation_inputs")
      .indexNames.contains("originalMethod"),
    false,
  );
  assert.deepEqual(await snapshotV13(old), before);
  old.close();
  const ledger = await Ledger.open(name);
  try {
    assert.deepEqual(await ledger.all("estimation_inputs"), []);
    assert.equal(
      (await ledger.estimation.state(scope)).uniformOriginalMethodHash,
      null,
    );
  } finally {
    ledger.close();
  }
});
test("uniform proof reads indexed keys and counts without loading historical source payloads", async () => {
  const name = crypto.randomUUID();
  await populate(name, true);
  const ledger = await Ledger.open(name);
  const methodsToBlock = ["get", "getAll", "openCursor"] as const;
  const blocked = new Set([
    "requests",
    "attempts",
    "measurements",
    "local_estimates",
    "history_records",
    "estimation_originals",
    "estimation_inputs",
  ]);
  const restore: Array<() => void> = [];
  for (const method of methodsToBlock) {
    const oldStore = IDBObjectStore.prototype[method],
      oldIndex = IDBIndex.prototype[method];
    (IDBObjectStore.prototype as any)[method] = function (...args: unknown[]) {
      if (blocked.has(this.name)) throw Error("source payload read");
      return (oldStore as Function).apply(this, args);
    };
    (IDBIndex.prototype as any)[method] = function (...args: unknown[]) {
      if (blocked.has(this.objectStore.name))
        throw Error("source payload read");
      return (oldIndex as Function).apply(this, args);
    };
    restore.push(() => {
      (IDBObjectStore.prototype as any)[method] = oldStore;
      (IDBIndex.prototype as any)[method] = oldIndex;
    });
  }
  try {
    assert.equal(
      (await ledger.estimation.state(scope)).uniformOriginalMethodHash,
      methods.ecologits.method_hash,
    );
    assert.equal(
      (await ledger.estimation.localSelectionState(scope)).members[0]
        .uniformOriginalMethodHash,
      methods.ecologits.method_hash,
    );
  } finally {
    for (const reset of restore) reset();
    ledger.close();
  }
});
