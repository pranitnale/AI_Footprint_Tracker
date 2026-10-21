import { completed, request } from "./ledger-support";

const pendingPrefix = "history-cleanup:";
const namespacePattern = /^(personal|company):[a-z0-9:-]{1,160}$/;
const uuidPattern =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;

type CleanupActions = {
  eraseFamily(namespace: string, requestId: string): Promise<unknown>;
  eraseAttemptAliases(
    namespace: string,
    attemptId: string,
    era: string | null,
  ): Promise<unknown>;
};

function pendingRange(): IDBKeyRange {
  return IDBKeyRange.bound(pendingPrefix, "history-cleanup;", false, true);
}

function checkedMarker(key: IDBValidKey, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("ledger_integrity_failed");
  const marker = value as Record<string, unknown>;
  if (
    typeof key !== "string" ||
    marker.key !== key ||
    typeof marker.namespace !== "string" ||
    namespacePattern.exec(marker.namespace)?.[0] !== marker.namespace
  )
    throw new Error("ledger_integrity_failed");
  const namespace = marker.namespace;
  const prefix = `${pendingPrefix}${namespace}:`;
  const target = key.startsWith(prefix) ? key.slice(prefix.length) : "";
  const [kind, id, extra] = target.split(":");
  if (
    (kind !== "request" && kind !== "attempt") ||
    !id ||
    id.length !== 36 ||
    !uuidPattern.test(id) ||
    extra !== undefined ||
    (marker.era !== null &&
      (typeof marker.era !== "string" ||
        marker.era.length === 0 ||
        marker.era.length > 256)) ||
    !Array.isArray(marker.keys)
  )
    throw new Error("ledger_integrity_failed");
  for (const entry of marker.keys) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      (entry[0] !== "request" && entry[0] !== "attempt") ||
      typeof entry[1] !== "string" ||
      entry[1].length !== 64 ||
      !/^[a-f0-9]{64}$/.test(entry[1])
    )
      throw new Error("ledger_integrity_failed");
  }
  return { namespace, kind, id, era: marker.era as string | null };
}

/**
 * Resume at most 32 durable, already-authorized cleanup targets. Null eras retain
 * legacy unknown scope. Actions own marker removal; failures propagate for retry.
 * `processed` counts completed actions; `pending` includes any malformed marker.
 */
export async function resumePendingCleanup(
  db: IDBDatabase,
  actions: CleanupActions,
  limit = 32,
): Promise<{ processed: number; pending: boolean }> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 32)
    throw new RangeError("cleanup_limit_invalid");

  const selection = db.transaction("deletion_markers", "readonly");
  const [keys] = await Promise.all([
    request(
      selection
        .objectStore("deletion_markers")
        .getAllKeys(pendingRange(), limit),
    ),
    completed(selection),
  ]);
  let processed = 0;
  for (const key of keys) {
    const read = db.transaction("deletion_markers", "readonly");
    const [value] = await Promise.all([
      request(read.objectStore("deletion_markers").get(key)),
      completed(read),
    ]);
    // An earlier family cleanup may already have removed this descendant.
    if (value === undefined) continue;
    const marker = checkedMarker(key, value);
    if (marker.kind === "request")
      await actions.eraseFamily(marker.namespace, marker.id);
    else
      await actions.eraseAttemptAliases(
        marker.namespace,
        marker.id,
        marker.era,
      );
    processed++;
  }

  const remaining = db.transaction("deletion_markers", "readonly");
  const [cursor] = await Promise.all([
    request(
      remaining.objectStore("deletion_markers").openKeyCursor(pendingRange()),
    ),
    completed(remaining),
  ]);
  return { processed, pending: cursor !== null };
}
