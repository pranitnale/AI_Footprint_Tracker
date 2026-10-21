import { request, completed } from "../src/ledger-support";

/** Frozen version-11 table/index layout, preceding estimation storage. No production migration imports. */
export const v11Stores = [
  "requests",
  "attempts",
  "measurements",
  "local_estimates",
  "provider_key_map",
  "outbox",
  "sync_receipts",
  "health",
  "policy",
  "deletion_markers",
  "dashboard_cache",
  "context_snapshots",
  "guidance_preferences",
  "schema_migrations",
  "thread_relations",
  "method_catalogs",
  "history_records",
  "history_coverage",
  "history_outbox",
] as const;
const indexes: Record<string, Record<string, string[]>> = {
  requests: {
    occurred: ["namespace", "record.dispatched_at"],
    conversation: ["namespace", "record.conversation_key"],
    provider: ["namespace", "record.provider_request_key"],
  },
  attempts: {
    provider: ["namespace", "record.provider_attempt_key"],
    parent: ["namespace", "record.request_id"],
  },
  measurements: { parent: ["namespace", "record.request_id"] },
  provider_key_map: { parent: ["namespace", "request.request_id"] },
  local_estimates: {
    selection: ["namespace", "selection"],
    attempt: ["namespace", "estimate.attempt_id"],
  },
  outbox: { eligible: ["namespace", "nextAt"] },
  context_snapshots: {
    basisRequest: ["namespace", "source.requestId"],
    basisAttempt: ["namespace", "source.attemptId"],
  },
  guidance_preferences: {
    basisRequest: ["namespace", "source.requestId"],
    basisAttempt: ["namespace", "source.attemptId"],
  },
  thread_relations: {
    thread: ["namespace", "threadKey"],
    request: ["namespace", "requestId"],
    pending: ["namespace", "pending", "nextAt"],
  },
  history_records: {
    conversation: ["namespace", "record.conversation_key"],
    liveRequest: ["namespace", "record.provider_request_key"],
    liveAttempt: ["namespace", "record.provider_attempt_key"],
  },
  history_coverage: {
    pending: ["namespace", "era", "pending"],
    devicePending: ["namespace", "deviceId", "pending"],
  },
  history_outbox: {
    eligible: ["namespace", "era", "nextAt"],
    deviceEligible: ["namespace", "deviceId", "nextAt"],
  },
};
export async function openV11(name: string) {
  const opening = indexedDB.open(name, 11);
  opening.onupgradeneeded = () => {
    for (const name of v11Stores) {
      const store = opening.result.createObjectStore(name, { keyPath: "key" });
      store.createIndex("namespace", "namespace");
      for (const [index, path] of Object.entries(indexes[name] ?? {}))
        store.createIndex(index, path);
    }
  };
  return request(opening);
}
export async function snapshotV11(db: IDBDatabase) {
  const tx = db.transaction([...v11Stores], "readonly"),
    done = completed(tx),
    result: Record<string, unknown[]> = {};
  for (const name of v11Stores)
    result[name] = await request(tx.objectStore(name).getAll());
  await done;
  return result;
}
