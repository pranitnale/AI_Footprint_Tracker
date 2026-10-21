import { openV11, v11Stores } from "./v11-fixture";
import { completed, request } from "../src/ledger-support";

// Frozen version-13 schema additions. Do not call the current migration here.
const additions = [
  "estimation_inputs",
  "estimation_state",
  "estimation_jobs",
  "estimation_results",
  "estimation_originals",
  "engine_preferences",
] as const;
export const v13Stores = [...v11Stores, ...additions];
export async function createV13(name: string): Promise<IDBDatabase> {
  const baseline = await openV11(name);
  baseline.close();
  const opening = indexedDB.open(name, 13);
  opening.onupgradeneeded = () => {
    const db = opening.result,
      tx = opening.transaction!;
    for (const name of additions) {
      const store = db.createObjectStore(name, { keyPath: "key" });
      store.createIndex("namespace", "namespace");
    }
    const inputs = tx.objectStore("estimation_inputs");
    inputs.createIndex("sequence", ["scopeKey", "sequence"]);
    inputs.createIndex("dependency", "dependencies", { multiEntry: true });
    inputs.createIndex("scope", "scopeKey");
    const results = tx.objectStore("estimation_results");
    results.createIndex("input", "inputKey");
    results.createIndex("job", "jobId");
    results.createIndex("method", ["scopeKey", "methodHash"]);
    const originals = tx.objectStore("estimation_originals");
    originals.createIndex("input", "inputKey");
    originals.createIndex("source", ["inputKey", "sourceHash"]);
    originals.createIndex("attemptSource", [
      "inputKey",
      "result.source.attempt_revision",
      "result.source.attempt_hash",
    ]);
    tx.objectStore("local_estimates").createIndex("envelopeAttempt", [
      "namespace",
      "estimate.source.attempt_id",
    ]);
  };
  return request(opening);
}
export async function snapshotV13(db: IDBDatabase) {
  const tx = db.transaction(v13Stores, "readonly"),
    done = completed(tx);
  const entries = await Promise.all(
    v13Stores.map(
      async (name) =>
        [name, await request(tx.objectStore(name).getAll())] as const,
    ),
  );
  await done;
  return Object.fromEntries(entries);
}
