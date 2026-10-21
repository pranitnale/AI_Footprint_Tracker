import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import {
  Ledger,
  createMemoryRepository,
  healthSolved,
  type HealthRepository,
  type StoredHealth,
} from "../src/index";
import { createIndexedDbSessionRepositories } from "../src/indexeddb-session";

// Owner decision of 16 October 2026: a saved problem closes when the same kind of work
// succeeds again, and nothing is deleted.
const namespace = "personal:health-resolution";

interface Harness {
  health: HealthRepository;
  /** Health store writes since the harness opened. */
  writes(): number;
  /** Opens the same storage again, as after a browser restart, where the backend has one. */
  reopen?(): Promise<HealthRepository>;
}

async function indexedDb(t: TestContext): Promise<Harness> {
  const name = `health-resolution-${crypto.randomUUID()}`;
  let ledger = await Ledger.open(name);
  let writes = 0;
  const watch = (target: Ledger) => {
    const transaction = (target as any).transaction.bind(target);
    (target as any).transaction = (
      stores: string | string[],
      mode: IDBTransactionMode,
    ) => {
      const names = typeof stores === "string" ? [stores] : stores;
      if (mode === "readwrite" && names.includes("health")) writes++;
      return transaction(stores, mode);
    };
  };
  watch(ledger);
  t.after(() => ledger.close());
  return {
    health: createIndexedDbSessionRepositories(ledger),
    writes: () => writes,
    async reopen() {
      ledger.close();
      ledger = await Ledger.open(name);
      watch(ledger);
      return createIndexedDbSessionRepositories(ledger);
    },
  };
}
async function memory(_t: TestContext): Promise<Harness> {
  let writes = 0;
  const repository = createMemoryRepository({
    beforeCommit(operation) {
      if (operation === "health") writes++;
    },
  });
  return { health: repository, writes: () => writes };
}

const row = async (health: HealthRepository, code: string) =>
  (await health.listHealth(namespace)).find((entry) => entry.code === code) as
    | StoredHealth
    | undefined;
const pause = () => new Promise((resolve) => setTimeout(resolve, 5));

for (const [label, open] of [
  ["IndexedDB", indexedDb],
  ["Memory", memory],
] as const) {
  test(`${label}: a solved problem keeps its row, times and count`, async (t) => {
    const h = await open(t);
    await h.health.health(namespace, "sync_delayed");
    await h.health.health(namespace, "sync_delayed");
    const before = (await row(h.health, "sync_delayed"))!;
    await pause();
    const closed = await h.health.resolveHealth(namespace, [
      "sync_delayed",
      "storage_write_failed",
    ]);
    assert.deepEqual(closed, ["sync_delayed"]);
    const after = (await row(h.health, "sync_delayed"))!;
    assert.equal(after.count, 2);
    assert.equal(after.firstAt, before.firstAt);
    assert.equal(after.lastAt, before.lastAt);
    assert.ok(after.resolvedAt! >= after.lastAt!);
    assert.ok(healthSolved(after));
    // A code that was never reported gets no row.
    assert.equal(await row(h.health, "storage_write_failed"), undefined);
    assert.equal((await h.health.listHealth(namespace)).length, 1);
    if (h.reopen) {
      const reopened = await h.reopen();
      const kept = (await row(reopened, "sync_delayed"))!;
      assert.equal(kept.resolvedAt, after.resolvedAt);
      assert.equal(kept.count, 2);
    }
  });

  test(`${label}: a problem that comes back after it was solved is open again`, async (t) => {
    const h = await open(t);
    await h.health.health(namespace, "partial_capture");
    await h.health.resolveHealth(namespace, ["partial_capture"]);
    assert.ok(healthSolved((await row(h.health, "partial_capture"))!));
    await pause();
    await h.health.health(namespace, "partial_capture");
    const reopened = (await row(h.health, "partial_capture"))!;
    assert.equal(healthSolved(reopened), false);
    assert.equal(reopened.count, 2);
    // It closes again with the next success.
    assert.deepEqual(
      await h.health.resolveHealth(namespace, ["partial_capture"]),
      ["partial_capture"],
    );
  });

  test(`${label}: a success writes nothing when no matching problem is open`, async (t) => {
    const h = await open(t);
    await h.health.health(namespace, "sync_delayed");
    await h.health.health("personal:other", "storage_write_failed");
    const start = h.writes();
    // Nothing reported for these codes in this namespace.
    assert.deepEqual(
      await h.health.resolveHealth(namespace, [
        "storage_write_failed",
        "tokenizer_unavailable",
      ]),
      [],
    );
    assert.deepEqual(await h.health.resolveHealth(namespace, []), []);
    assert.equal(h.writes(), start);
    await h.health.resolveHealth(namespace, ["sync_delayed"]);
    assert.equal(h.writes(), start + 1);
    // Already solved: no second write.
    await h.health.resolveHealth(namespace, ["sync_delayed"]);
    assert.equal(h.writes(), start + 1);
    // Another namespace's problem stays open.
    assert.equal(
      healthSolved(
        (await h.health.listHealth("personal:other")).find(
          (entry) => entry.code === "storage_write_failed",
        )!,
      ),
      false,
    );
  });

  test(`${label}: listeners hear every resolution and invalid codes are refused`, async (t) => {
    const h = await open(t);
    const heard: [string, readonly string[]][] = [];
    const stop = h.health.onHealthResolved((space, codes) =>
      heard.push([space, codes]),
    );
    await h.health.resolveHealth(namespace, ["sync_delayed", "sync_delayed"]);
    stop();
    await h.health.resolveHealth(namespace, ["policy_unavailable"]);
    assert.deepEqual(heard, [[namespace, ["sync_delayed"]]]);
    await assert.rejects(
      h.health.resolveHealth(namespace, ["PRIVATE_TEXT" as any]),
    );
  });
}
