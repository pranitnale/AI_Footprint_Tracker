import {
  canonicalJson,
  EstimationEnvelopeSchema,
  parseObservation,
  payloadHash,
  type AttemptObservation,
  type EstimationEnvelope,
  type RequestObservation,
} from "@footprint/contracts";
import {
  attemptErasureKey,
  request,
  type RecordRow,
  type Scope,
} from "./ledger-support";
import { checkedScope, inputKey } from "./estimation-storage";
import { localScopeAllowed } from "./local-selection";

const uuidPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const validId = (value: unknown): value is string =>
  typeof value === "string" && value.length === 36 && uuidPattern.test(value);

function checkedObservation(
  row: RecordRow | undefined,
  scope: Scope,
  key: string,
  kind: "request" | "attempt",
  id: string,
  revision?: number,
  hash?: string,
) {
  if (
    !row ||
    row.key !== key ||
    row.namespace !== scope.namespace ||
    row.era !== scope.era
  )
    throw new Error("ledger_integrity_failed");
  let observation;
  try {
    observation = parseObservation(row.record);
  } catch {
    throw new Error("ledger_integrity_failed");
  }
  if (
    observation.kind !== kind ||
    (observation.kind === "attempt"
      ? observation.attempt_id
      : observation.request_id) !== id ||
    payloadHash(observation) !== row.hash ||
    (revision !== undefined && observation.revision !== revision) ||
    (hash !== undefined && row.hash !== hash)
  )
    throw new Error("ledger_integrity_failed");
  return observation;
}

async function currentRequestChain(
  tx: IDBTransaction,
  scope: Scope,
  requestId: string,
): Promise<RequestObservation[] | null> {
  const chain: RequestObservation[] = [];
  const seen = new Set<string>();
  let id = requestId;
  for (let depth = 0; depth < 64; depth++) {
    if (seen.has(id)) return null;
    seen.add(id);
    if (
      await request(
        tx.objectStore("deletion_markers").get(`${scope.namespace}:${id}`),
      )
    )
      return null;
    const key = `${scope.namespace}:request:${id}`;
    const row: RecordRow | undefined = await request(
      tx.objectStore("requests").get(key),
    );
    if (!row) return null;
    const observation = checkedObservation(row, scope, key, "request", id);
    if (observation.kind !== "request") return null;
    chain.push(observation);
    if (row.aliasOf === undefined) return chain;
    if (!validId(row.aliasOf)) throw new Error("ledger_integrity_failed");
    id = row.aliasOf;
  }
  return null;
}

async function rangeErased(
  tx: IDBTransaction,
  scope: Scope,
  observations: RequestObservation[],
): Promise<boolean> {
  const prefix = `range:${scope.namespace}:`;
  const cursor = tx
    .objectStore("deletion_markers")
    .openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
  return new Promise((resolve, reject) => {
    cursor.onerror = () => reject(cursor.error);
    cursor.onsuccess = () => {
      const entry = cursor.result;
      if (!entry) return resolve(false);
      const marker = entry.value;
      if (
        observations.some(
          (observation) =>
            (!marker.start || observation.dispatched_at >= marker.start) &&
            (!marker.end || observation.dispatched_at < marker.end),
        )
      )
        return resolve(true);
      entry.continue();
    };
  });
}

/**
 * Read an immutable original for the exact current attempt inside the caller's
 * transaction. Archived request revisions remain unchanged after later edits or
 * aliasing. Missing authority or erased/superseded records return null; damaged
 * archived evidence fails visibly. This helper does not complete the transaction.
 */
export async function originalForLive(
  tx: IDBTransaction,
  currentAuthorityScope: Scope,
  selector: {
    attemptId: string;
    attemptRevision: number;
    attemptHash: string;
  },
): Promise<{
  result: EstimationEnvelope;
  request: RequestObservation;
  attempt: AttemptObservation;
} | null> {
  checkedScope(currentAuthorityScope);
  if (
    !validId(selector.attemptId) ||
    !Number.isInteger(selector.attemptRevision) ||
    selector.attemptRevision < 1 ||
    selector.attemptRevision > 2147483647 ||
    typeof selector.attemptHash !== "string" ||
    selector.attemptHash.length !== 64 ||
    !/^[a-f0-9]{64}$/.test(selector.attemptHash)
  )
    throw new Error("payload_rejected");
  const currentKey = `${currentAuthorityScope.namespace}:attempt:${selector.attemptId}`;
  const current: RecordRow | undefined = await request(
    tx.objectStore("attempts").get(currentKey),
  );
  if (!current || current.aliasOf) return null;
  const scope: Scope = { ...currentAuthorityScope, era: current.era };
  if (
    !(await localScopeAllowed(tx, currentAuthorityScope, scope)) ||
    (await request(
      tx
        .objectStore("deletion_markers")
        .get(attemptErasureKey(scope.namespace, selector.attemptId)),
    ))
  )
    return null;
  const attempt = checkedObservation(
    current,
    scope,
    currentKey,
    "attempt",
    selector.attemptId,
  );
  if (
    attempt.kind !== "attempt" ||
    attempt.revision !== selector.attemptRevision ||
    current.hash !== selector.attemptHash
  )
    return null;
  const chain = await currentRequestChain(tx, scope, attempt.request_id);
  if (!chain) return null;

  const key = inputKey(scope, "live", selector.attemptId);
  const originals = await request(
    tx
      .objectStore("estimation_originals")
      .index("attemptSource")
      .getAll([key, selector.attemptRevision, selector.attemptHash], 2),
  );
  if (originals.length === 0) return null;
  let original = originals[0];
  if (originals.length > 1) {
    const pointerKey = `current:${scope.namespace}:${selector.attemptId}`;
    const pointer = await request(
      tx.objectStore("local_estimates").get(pointerKey),
    );
    const parsedPointer = EstimationEnvelopeSchema.safeParse(pointer?.estimate);
    if (
      pointer?.key !== pointerKey ||
      pointer.namespace !== scope.namespace ||
      pointer.selection !== "current" ||
      !parsedPointer.success ||
      parsedPointer.data.view !== "original" ||
      parsedPointer.data.source.family !== "live" ||
      parsedPointer.data.source.attempt_id !== selector.attemptId ||
      parsedPointer.data.source.attempt_revision !== selector.attemptRevision ||
      parsedPointer.data.source.attempt_hash !== selector.attemptHash
    )
      return null;
    const pointerResult = parsedPointer.data;
    const archivedKey = `${key}:${payloadHash(pointerResult.source)}:${pointerResult.requested_method.method_hash}`;
    original = await request(
      tx.objectStore("estimation_originals").get(archivedKey),
    );
    if (
      !original ||
      canonicalJson(original.result) !== canonicalJson(pointerResult)
    )
      return null;
  }
  const parsed = EstimationEnvelopeSchema.safeParse(original.result);
  if (!parsed.success || parsed.data.source.family !== "live")
    throw new Error("ledger_integrity_failed");
  const result = parsed.data;
  const source = parsed.data.source;
  const sourceHash = payloadHash(source);
  if (
    result.view !== "original" ||
    original.namespace !== scope.namespace ||
    original.inputKey !== key ||
    original.sourceHash !== sourceHash ||
    original.key !==
      `${key}:${sourceHash}:${result.requested_method.method_hash}` ||
    source.attempt_id !== attempt.attempt_id ||
    source.attempt_revision !== attempt.revision ||
    source.attempt_hash !== current.hash
  )
    throw new Error("ledger_integrity_failed");

  const requestKey = `${scope.namespace}:request:${source.request_id}:${source.request_revision}`;
  const attemptKey = `${currentKey}:${source.attempt_revision}`;
  const archivedRequest = checkedObservation(
    await request(tx.objectStore("measurements").get(requestKey)),
    scope,
    requestKey,
    "request",
    source.request_id,
    source.request_revision,
    source.request_hash,
  );
  const archivedAttempt = checkedObservation(
    await request(tx.objectStore("measurements").get(attemptKey)),
    scope,
    attemptKey,
    "attempt",
    source.attempt_id,
    source.attempt_revision,
    source.attempt_hash,
  );
  if (archivedRequest.kind !== "request" || archivedAttempt.kind !== "attempt")
    throw new Error("ledger_integrity_failed");
  const binding = source.canonical_request_binding;
  if (source.request_id === archivedAttempt.request_id) {
    if (binding) throw new Error("ledger_integrity_failed");
  } else if (
    !binding ||
    binding.observed_request_id !== archivedAttempt.request_id ||
    binding.canonical_request_id !== source.request_id ||
    binding.relation_hash !==
      payloadHash({
        kind: "canonical_request_alias",
        observed_request_id: archivedAttempt.request_id,
        canonical_request_id: source.request_id,
      })
  )
    throw new Error("ledger_integrity_failed");
  if (!chain.some((entry) => entry.request_id === source.request_id))
    return null;
  if (await rangeErased(tx, scope, [...chain, archivedRequest])) return null;
  return { result, request: archivedRequest, attempt: archivedAttempt };
}
