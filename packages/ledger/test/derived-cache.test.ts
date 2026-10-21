import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { Ledger, digest, type DerivedSource } from "../src/index";
import { records } from "./factory";

const scope = {
  namespace: "personal:derived-test",
  mode: "personal" as const,
  era: null,
};
async function basis(pair: ReturnType<typeof records>): Promise<DerivedSource> {
  return {
    requestId: pair[0].request_id,
    requestRevision: pair[0].revision,
    requestHash: await digest(pair[0]),
    attemptId: pair[1].attempt_id,
    attemptRevision: pair[1].revision,
    attemptHash: await digest(pair[1]),
  };
}
const keys = {
  contextKey: scope.namespace + ":output",
  guidanceKey: scope.namespace + ":guidance",
};
const values = {
  context: {
    key: keys.contextKey,
    value: { tokens: "800", branchId: "branch", at: 1 },
  },
  guidance: {
    key: keys.guidanceKey,
    value: { state: { dismissed: false, snoozedUntil: 0 } },
  },
};
const actionKey = (source: DerivedSource) =>
  `${keys.guidanceKey}#${source.requestHash}.${source.attemptHash}`;
async function seed() {
  const db = await Ledger.open("derived-" + crypto.randomUUID()),
    pair = records();
  await db.commit(scope, pair);
  const source = await basis(pair),
    guard = { erasureVersion: 0, dependencies: [] };
  assert.equal(
    await db.writeDerived(scope.namespace, source, guard, values),
    true,
  );
  return { db, pair, source, guard };
}

test("exact canonical revisions govern derived reads, indexed correction cleanup and delayed actions", async () => {
  const { db, pair, source, guard } = await seed();
  try {
    await db.put("policy", { key: "settings", budget: 1000 });
    assert.equal(
      (await db.readDerived<any, any>(scope.namespace, keys)).context!.value
        .tokens,
      "800",
    );
    const updated = [
      { ...pair[0], revision: 2 },
      { ...pair[1], revision: 2 },
    ] as typeof pair;
    await db.commit(scope, updated);
    assert.equal((await db.all("context_snapshots")).length, 0);
    assert.equal((await db.all("guidance_preferences")).length, 0);
    assert.equal(
      await db.writeDerived(scope.namespace, source, guard, values),
      false,
    );
    const replacement = await basis(updated);
    assert.equal(
      await db.writeDerived(scope.namespace, replacement, guard, values),
      true,
    );
    assert.equal(
      await db.updateDerivedGuidance(
        scope.namespace,
        actionKey(source),
        "dismiss",
      ),
      false,
    );
    assert.equal(
      await db.updateDerivedGuidance(
        "personal:another",
        actionKey(replacement),
        "snooze",
      ),
      false,
    );
    assert.equal(
      (await db.readDerived<any, any>(scope.namespace, keys)).guidance!.value
        .state.dismissed,
      false,
    );
    assert.equal(
      await db.updateDerivedGuidance(
        scope.namespace,
        actionKey(replacement),
        "dismiss",
      ),
      true,
    );
    assert.equal(
      await db.updateDerivedGuidance(
        scope.namespace,
        actionKey(replacement),
        "snooze",
        100,
      ),
      true,
    );
    const read = await db.readDerived<any, any>(scope.namespace, keys);
    assert.equal(read.guidance!.value.state.dismissed, true);
    assert.equal(read.guidance!.value.state.snoozedUntil, 86400100);
    assert.deepEqual(await db.get("policy", "settings"), {
      key: "settings",
      budget: 1000,
    });
  } finally {
    db.close();
  }
});

test("erasure generation prevents a delayed writer or guidance action from resurrecting caches", async () => {
  const { db, pair, source } = await seed();
  try {
    const read = await db.readDerived(scope.namespace, keys);
    await db.eraseFamily(scope.namespace, pair[0].request_id);
    assert.equal(
      await db.writeDerived(
        scope.namespace,
        source,
        { erasureVersion: read.erasureVersion, dependencies: [] },
        values,
      ),
      false,
    );
    assert.equal(
      await db.updateDerivedGuidance(
        scope.namespace,
        actionKey(source),
        "dismiss",
      ),
      false,
    );
    assert.equal(
      await db.updateDerivedGuidance(
        scope.namespace,
        actionKey(source),
        "snooze",
      ),
      false,
    );
    await assert.rejects(
      db.put("context_snapshots", {
        key: keys.contextKey,
        namespace: scope.namespace,
        tokens: "800",
      }),
      /derived_write_requires_guard/,
    );
    assert.equal((await db.all("context_snapshots")).length, 0);
    assert.equal((await db.all("guidance_preferences")).length, 0);
  } finally {
    db.close();
  }
});

test("parent read dependencies are validated in the same transaction as observation commit", async () => {
  const { db, pair, source } = await seed();
  try {
    const read = await db.readDerived(scope.namespace, keys),
      child = records();
    await db.eraseFamily(scope.namespace, pair[0].request_id);
    await assert.rejects(
      db.commit(scope, child, [], {
        erasureVersion: read.erasureVersion,
        dependencies: [source],
      }),
      /derived_dependency_changed/,
    );
    assert.equal((await db.rows(scope.namespace)).length, 0);
    await db.commit(scope, child);
    assert.equal(
      await db.writeDerived(
        scope.namespace,
        await basis(child),
        { erasureVersion: read.erasureVersion, dependencies: [source] },
        values,
      ),
      false,
    );
    assert.equal((await db.rows(scope.namespace)).length, 2);
  } finally {
    db.close();
  }
});

for (const change of ["alias", "reconcile", "provider_alias"] as const)
  test(`${change} invalidates attributed derived rows without modifying original measurements`, async () => {
    const { db, pair } = await seed();
    try {
      const hashes = (await db.all<any>("measurements")).map((row) => row.hash);
      if (change === "reconcile") {
        const newer = { ...pair[0], revision: 2 };
        await db.reconcile(scope.namespace, newer, await digest(newer));
      } else {
        const other = records();
        other[0].dispatched_at = "2020-01-01T00:00:00.000Z";
        if (change === "provider_alias") {
          pair[0].provider_request_key = "a".repeat(64);
          pair[0].revision++;
          await db.commit(scope, pair);
          await db.writeDerived(
            scope.namespace,
            await basis(pair),
            { erasureVersion: 0, dependencies: [] },
            values,
          );
          other[0].provider_request_key = pair[0].provider_request_key;
        }
        await db.commit(scope, other);
        if (change === "alias")
          await db.markAlias(
            scope.namespace,
            "request",
            pair[0].request_id,
            other[0].request_id,
          );
        else
          await db.coalesceProviderIdentity(
            scope.namespace,
            "request",
            pair[0].provider_request_key!,
          );
      }
      assert.equal((await db.all("context_snapshots")).length, 0);
      assert.equal((await db.all("guidance_preferences")).length, 0);
      const after = (await db.all<any>("measurements")).map((row) => row.hash);
      for (const hash of hashes) assert.ok(after.includes(hash));
    } finally {
      db.close();
    }
  });

test("unattributed legacy caches are cleared on upgrade while independent settings survive", async () => {
  const name = "legacy-derived-" + crypto.randomUUID();
  const old = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(name, 6);
    open.onupgradeneeded = () => {
      for (const store of [
        "context_snapshots",
        "guidance_preferences",
        "policy",
      ]) {
        const table = open.result.createObjectStore(store, { keyPath: "key" });
        table.createIndex("namespace", "namespace");
        table.put({
          key: store === "policy" ? "settings" : scope.namespace + ":legacy",
          namespace: scope.namespace,
          budget: 1000,
          tokens: "800",
        });
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  old.close();
  const db = await Ledger.open(name);
  try {
    assert.equal((await db.all("context_snapshots")).length, 0);
    assert.equal((await db.all("guidance_preferences")).length, 0);
    assert.equal((await db.get<any>("policy", "settings"))!.budget, 1000);
    // Simulate a restored malformed cache independently of the now-guarded public API.
    const tx = (db as any).db.transaction("context_snapshots", "readwrite");
    tx.objectStore("context_snapshots").put({
      key: keys.contextKey,
      namespace: scope.namespace,
      tokens: "999",
    });
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    assert.equal(
      (await db.readDerived(scope.namespace, keys)).context,
      undefined,
    );
    assert.equal((await db.all("context_snapshots")).length, 0);
  } finally {
    db.close();
  }
});
