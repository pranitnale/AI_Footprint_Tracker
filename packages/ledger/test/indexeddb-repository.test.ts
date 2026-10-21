import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { Ledger } from "../src/index";
import { records, scope } from "./factory";
import { repositoryContract } from "./repository-contract-cases";
repositoryContract("IndexedDB domain repository", async (t) => {
  const db = await Ledger.open(crypto.randomUUID());
  t.after(() => db.close());
  const original = IDBObjectStore.prototype.put;
  t.after(() => {
    IDBObjectStore.prototype.put = original;
  });
  return {
    repository: db.application,
    failNextCapture() {
      IDBObjectStore.prototype.put = function (
        value: unknown,
        key?: IDBValidKey,
      ) {
        if (this.name === "provider_key_map") {
          IDBObjectStore.prototype.put = original;
          throw Error("contract_write_failed");
        }
        return original.call(this, value, key);
      };
    },
  };
});
test("domain capture retains an explicit null current pointer without inventing an estimate", async (t) => {
  const db = await Ledger.open(crypto.randomUUID());
  t.after(() => db.close());
  const pair = records();
  await db.application.commitCapture({
    scope,
    observations: pair,
    currentEstimate: { attemptId: pair[1].attempt_id, estimate: null },
  });
  const stored = await db.get<{ estimate: unknown }>(
    "local_estimates",
    `current:${scope.namespace}:${pair[1].attempt_id}`,
  );
  assert.equal(stored?.estimate, null);
  assert.equal(
    await db.application.currentEstimate(scope.namespace, pair[1].attempt_id),
    undefined,
  );
  assert.equal(await db.application.pendingCount(scope.namespace), 2);
});
