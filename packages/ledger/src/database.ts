import { historyNumericPayloadHash } from "@footprint/contracts";
import {
  STORES,
  derivedStores,
  request,
  type HistoryRow,
  type OutboxRow,
} from "./ledger-support";
import { initializeEstimationIndexes } from "./estimation-storage";
export async function openDatabase(name: string): Promise<IDBDatabase> {
  const r = indexedDB.open(name, 21);
  r.onupgradeneeded = (event) => {
    for (const store of STORES) {
      const objectStore = r.result.objectStoreNames.contains(store)
        ? r.transaction!.objectStore(store)
        : r.result.createObjectStore(store, { keyPath: "key" });
      if (!objectStore.indexNames.contains("namespace"))
        objectStore.createIndex("namespace", "namespace");
      if (
        store === "history_records" &&
        !objectStore.indexNames.contains("conversation")
      )
        objectStore.createIndex("conversation", [
          "namespace",
          "record.conversation_key",
        ]);
      if (
        store === "history_records" &&
        !objectStore.indexNames.contains("prompt")
      )
        objectStore.createIndex("prompt", ["namespace", "record.prompt_key"]);
      if (
        store === "history_records" &&
        !objectStore.indexNames.contains("liveRequest")
      ) {
        objectStore.createIndex("liveRequest", [
          "namespace",
          "record.provider_request_key",
        ]);
        objectStore.createIndex("liveAttempt", [
          "namespace",
          "record.provider_attempt_key",
        ]);
      }
      if (
        store === "history_outbox" &&
        !objectStore.indexNames.contains("eligible")
      )
        objectStore.createIndex("eligible", ["namespace", "era", "nextAt"]);
      if (
        store === "history_coverage" &&
        !objectStore.indexNames.contains("pending")
      )
        objectStore.createIndex("pending", ["namespace", "era", "pending"]);
      if (
        store === "history_outbox" &&
        !objectStore.indexNames.contains("deviceEligible")
      )
        objectStore.createIndex("deviceEligible", [
          "namespace",
          "deviceId",
          "nextAt",
        ]);
      if (
        store === "history_coverage" &&
        !objectStore.indexNames.contains("devicePending")
      )
        objectStore.createIndex("devicePending", [
          "namespace",
          "deviceId",
          "pending",
        ]);
      if (
        store === "thread_relations" &&
        !objectStore.indexNames.contains("thread")
      ) {
        objectStore.createIndex("thread", ["namespace", "threadKey"]);
        objectStore.createIndex("request", ["namespace", "requestId"]);
        objectStore.createIndex("pending", ["namespace", "pending", "nextAt"]);
      }
      if (
        derivedStores.includes(store as any) &&
        !objectStore.indexNames.contains("basisRequest")
      ) {
        // Unattributed legacy context cannot be safely reused after erasure or correction.
        objectStore.clear();
        objectStore.createIndex("basisRequest", [
          "namespace",
          "source.requestId",
        ]);
        objectStore.createIndex("basisAttempt", [
          "namespace",
          "source.attemptId",
        ]);
      }
      if (store === "outbox" && !objectStore.indexNames.contains("eligible"))
        objectStore.createIndex("eligible", ["namespace", "nextAt"]);
      // Version 20 (15 Oct 2026). A waiting revision has no refusal reason (null), and null is
      // no key, so this index holds exactly the refused revisions. The dashboard counts them
      // here instead of loading the whole outbox, which grows with every capture while the
      // organization server cannot be reached. Creating it indexes the existing rows.
      if (store === "outbox" && !objectStore.indexNames.contains("refused"))
        objectStore.createIndex("refused", ["namespace", "quarantined"]);
      if (store === "requests" && !objectStore.indexNames.contains("occurred"))
        objectStore.createIndex("occurred", [
          "namespace",
          "record.dispatched_at",
        ]);
      if (
        store === "requests" &&
        !objectStore.indexNames.contains("conversation")
      )
        objectStore.createIndex("conversation", [
          "namespace",
          "record.conversation_key",
        ]);
      if (store === "requests" && !objectStore.indexNames.contains("provider"))
        objectStore.createIndex("provider", [
          "namespace",
          "record.provider_request_key",
        ]);
      if (store === "attempts" && !objectStore.indexNames.contains("provider"))
        objectStore.createIndex("provider", [
          "namespace",
          "record.provider_attempt_key",
        ]);
      if (store === "attempts" && !objectStore.indexNames.contains("parent"))
        objectStore.createIndex("parent", ["namespace", "record.request_id"]);
      // Version 21 (16 Oct 2026). A period's totals read its attempts through this index
      // (and its requests through "occurred") instead of every attempt of the namespace.
      // Creating it indexes the existing rows.
      if (store === "attempts" && !objectStore.indexNames.contains("started"))
        objectStore.createIndex("started", [
          "namespace",
          "record.started_at",
        ]);
      if (
        store === "measurements" &&
        !objectStore.indexNames.contains("parent")
      )
        objectStore.createIndex("parent", ["namespace", "record.request_id"]);
      if (
        store === "provider_key_map" &&
        !objectStore.indexNames.contains("parent")
      )
        objectStore.createIndex("parent", ["namespace", "request.request_id"]);
      if (
        store === "local_estimates" &&
        !objectStore.indexNames.contains("selection")
      )
        objectStore.createIndex("selection", ["namespace", "selection"]);
      if (
        store === "local_estimates" &&
        !objectStore.indexNames.contains("attempt")
      )
        objectStore.createIndex("attempt", [
          "namespace",
          "estimate.attempt_id",
        ]);
    }
    const estimates = r.transaction!.objectStore("local_estimates");
    if (!estimates.indexNames.contains("envelopeAttempt"))
      estimates.createIndex("envelopeAttempt", [
        "namespace",
        "estimate.source.attempt_id",
      ]);
    initializeEstimationIndexes(r.transaction!);
    // Version 17 only adds the Cowork checkpoint store, so records of version 16 stay. The
    // tracking schema change resets local records once (owner, 2 Oct, question 16).
    if (event.oldVersion > 0 && event.oldVersion < 16) {
      // Preproduction observations are discarded rather than interpreted under a new schema.
      const preserved = new Set([
        "policy",
        "engine_preferences",
        "deletion_markers",
        "guidance_preferences",
      ]);
      for (const store of STORES)
        if (!preserved.has(store)) r.transaction!.objectStore(store).clear();
      const policy = r.transaction!.objectStore("policy");
      const cursor = policy.openCursor();
      const sessionKeys = new Set([
        "settings",
        "personal",
        "installation",
        "ownership-history",
        "credentials",
        "pending-connection",
        "pending-policy",
        "refresh-operation",
      ]);
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        const key = String(row.key);
        if (
          !sessionKeys.has(key) &&
          !["reconnect:", "deletion-epoch:", "deletion-receipt:"].some(
            (prefix) => key.startsWith(prefix),
          )
        )
          row.delete();
        row.continue();
      };
    }
    if (event.oldVersion >= 16 && event.oldVersion < 18)
      releaseRefusedRevisions(r.transaction!.objectStore("outbox"));
    if (event.oldVersion >= 16 && event.oldVersion < 19)
      resendServerConflicts(r.transaction!);
    r.transaction!.objectStore("schema_migrations").put({
      key: "schema-21",
      version: 21,
      at: Date.now(),
    });
  };
  const db = await request(r);
  db.onversionchange = () => db.close();
  return db;
}

/**
 * Version 18 (14 Oct 2026). Until then a ChatGPT reply that thought first was named by its
 * thoughts and then by its answer, and the organization server refused every revision after
 * the first that carried a name. Those revisions stayed quarantined as revision_conflict. The
 * server now accepts the finished revision of such a reply, so the newest refused revision of
 * each record is sent once more. Older refused revisions of a record are superseded by a newer
 * one and are dropped from the outbox; the records themselves stay. A revision refused again
 * is quarantined again and stays reported as refused.
 */
function releaseRefusedRevisions(outbox: IDBObjectStore) {
  const all = outbox.getAll();
  all.onsuccess = () => {
    const rows = all.result as OutboxRow[];
    const record = (row: OutboxRow) => `${row.namespace}:${row.kind}:${row.id}`;
    const newest = new Map<string, number>();
    for (const row of rows)
      newest.set(record(row), Math.max(newest.get(record(row)) ?? 0, row.revision));
    for (const row of rows) {
      if (row.quarantined !== "revision_conflict") continue;
      if (row.revision < newest.get(record(row))!) outbox.delete(row.key);
      else outbox.put({ ...row, quarantined: null, attempts: 0, nextAt: 0 });
    }
  };
}

/**
 * Version 19 (15 Oct 2026). Until then the organization server treated the estimation
 * release a browser proposed for a saved message as part of the message. A second browser
 * of the same member, a reinstall or a newer release that uploaded the same saved message
 * was told "conflict", and the message left every total. The server now keeps the stored
 * copy's method, so each saved message it reported as a conflict is sent once more. The row
 * stays a conflict until the server accepts the copy (acknowledgeHistory); a real conflict
 * is reported again and stays.
 */
function resendServerConflicts(transaction: IDBTransaction) {
  const read = transaction.objectStore("policy").get("credentials");
  read.onsuccess = () => {
    const credentials = read.result;
    // Without a connection nothing can be sent; the rows stay as they are.
    if (
      typeof credentials?.device_id !== "string" ||
      typeof credentials.namespace !== "string"
    )
      return;
    const outbox = transaction.objectStore("history_outbox");
    const cursor = transaction
      .objectStore("history_records")
      .index("namespace")
      .openCursor(IDBKeyRange.only(credentials.namespace));
    cursor.onsuccess = () => {
      const entry = cursor.result;
      if (!entry) return;
      const row = entry.value as HistoryRow;
      if (row.serverConflict) {
        const queued = outbox.get(row.key);
        queued.onsuccess = () => {
          // A newer read already waiting to upload is sent instead.
          if (!queued.result)
            outbox.put({
              key: row.key,
              namespace: row.namespace,
              era: row.lastImportEra ?? row.era,
              deviceId: credentials.device_id,
              hash: historyNumericPayloadHash(row.record),
              record: row.record,
              nextAt: 0,
            });
        };
      }
      entry.continue();
    };
  };
}
