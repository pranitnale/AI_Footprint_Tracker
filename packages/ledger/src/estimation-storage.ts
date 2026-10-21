import {
  canonicalJson,
  payloadHash,
  parseObservation,
  historyNumericPayloadHash,
  HistoryMessageSchema,
  EstimationEnvelopeSchema,
  OriginalEstimateResultSchema,
  compareHistoricalInstants,
  EngineMethodIdentitySchema,
  UNAVAILABLE_ADMISSION_METHOD_ID,
  type EngineMethodIdentity,
  type EstimationEnvelope,
  type HistoryMessage,
} from "@footprint/contracts";
import {
  request,
  attemptErasureKey,
  hasPendingPurge,
  type Scope,
  type RecordRow,
  type HistoryRow,
} from "./ledger-support";
import type {
  EstimationInput,
  RecalculationJob,
  UnavailableReason,
} from "./estimation-contracts";
import { localReadMemberAllowed } from "./local-selection";
import { uniqueLiveHistoryMatch } from "./live-history-link";

export const ESTIMATION_STORES = [
  "estimation_inputs",
  "estimation_state",
  "estimation_jobs",
  "estimation_results",
  "estimation_originals",
  "engine_preferences",
] as const;
export const estimationTransactionStores = [
  ...ESTIMATION_STORES,
  "requests",
  "attempts",
  "history_records",
  "measurements",
  "local_estimates",
  "deletion_markers",
  "dashboard_cache",
  "policy",
];
export const scopeKey = (scope: Scope) => canonicalJson(scope);
export function checkedScope(scope: Scope): Scope {
  if (
    !scope ||
    Object.keys(scope).length !== 3 ||
    !["personal", "company"].includes(scope.mode) ||
    typeof scope.namespace !== "string" ||
    /^(personal|company):[a-z0-9:-]{1,160}$/.exec(scope.namespace)?.[0] !==
      scope.namespace ||
    !scope.namespace.startsWith(scope.mode + ":") ||
    (scope.mode === "company"
      ? typeof scope.era !== "string" ||
        /^[A-Za-z0-9:_-]{1,160}$/.exec(scope.era)?.[0] !== scope.era
      : scope.era !== null)
  )
    throw new Error("policy_unavailable");
  return scope;
}
export interface InputRow {
  key: string;
  namespace: string;
  era: string | null;
  scopeKey: string;
  family: "live" | "history";
  id: string;
  sequence: number;
  dependencies: string[];
  originalMethodHash?: string;
  originalMethodId?: string;
  originalEvidenceCurrent?: 0 | 1;
  resolvedSourceHash?: string | null;
}
export interface StateRow {
  key: string;
  namespace: string;
  sequence: number;
  generation: number;
  publicationVersion: number;
  activeJob: string | null;
  selectedJob: string | null;
}
export type JobRow = RecalculationJob & {
  key: string;
  namespace: string;
  scopeKey: string;
  authority: string;
  baseWatermark: number;
};
export type ResultRow = {
  key: string;
  namespace: string;
  inputKey: string;
  jobId: string;
  scopeKey: string;
  methodHash: string;
  sequence: number;
  result: EstimationEnvelope | null;
  reason?: UnavailableReason;
};
export function inputKey(scope: Scope, family: "live" | "history", id: string) {
  return `${scopeKey(scope)}:${family}:${id}`;
}
async function requestDependencies(
  tx: IDBTransaction,
  scope: Scope,
  id: string | undefined,
): Promise<string[]> {
  const dependencies: string[] = [];
  for (let depth = 0; id && depth < 64; depth++) {
    const key = `${scope.namespace}:${id}`;
    if (dependencies.includes(key)) break;
    dependencies.push(key);
    const parent: RecordRow | undefined = await request(
      tx.objectStore("requests").get(`${scope.namespace}:request:${id}`),
    );
    id = parent?.era === scope.era ? parent.aliasOf : undefined;
  }
  return dependencies;
}
export const resultKey = (jobId: string, key: string) => `${jobId}:${key}`;
export async function stateFor(
  tx: IDBTransaction,
  scope: Scope,
): Promise<StateRow> {
  const saved = await request(
    tx.objectStore("estimation_state").get(scopeKey(scope)),
  );
  return saved
    ? { ...saved, publicationVersion: saved.publicationVersion ?? 0 }
    : {
        key: scopeKey(scope),
        namespace: scope.namespace,
        sequence: 0,
        generation: 0,
        publicationVersion: 0,
        activeJob: null,
        selectedJob: null,
      };
}
export async function eachCursor(
  store: IDBObjectStore | IDBIndex,
  range: IDBKeyRange | null,
  visit: (value: any) => Promise<void> | void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const cursor = store.openCursor(range);
    cursor.onerror = () => reject(cursor.error);
    cursor.onsuccess = () => {
      const row = cursor.result;
      if (!row) return resolve();
      void (async () => {
        await visit(row.value);
        row.continue();
      })().catch(reject);
    };
  });
}
export function initializeEstimationIndexes(tx: IDBTransaction) {
  const inputs = tx.objectStore("estimation_inputs");
  if (!inputs.indexNames.contains("sequence"))
    inputs.createIndex("sequence", ["scopeKey", "sequence"]);
  if (!inputs.indexNames.contains("dependency"))
    inputs.createIndex("dependency", "dependencies", { multiEntry: true });
  if (!inputs.indexNames.contains("scope"))
    inputs.createIndex("scope", "scopeKey");
  if (!inputs.indexNames.contains("originalEvidence"))
    inputs.createIndex("originalEvidence", [
      "scopeKey",
      "originalEvidenceCurrent",
    ]);
  if (!inputs.indexNames.contains("originalMethod"))
    inputs.createIndex("originalMethod", ["scopeKey", "originalMethodHash"]);
  for (const name of ["estimation_results", "estimation_originals"]) {
    const store = tx.objectStore(name);
    if (!store.indexNames.contains("input"))
      store.createIndex("input", "inputKey");
    if (name === "estimation_originals" && !store.indexNames.contains("source"))
      store.createIndex("source", ["inputKey", "sourceHash"]);
    if (
      name === "estimation_originals" &&
      !store.indexNames.contains("attemptSource")
    )
      store.createIndex("attemptSource", [
        "inputKey",
        "result.source.attempt_revision",
        "result.source.attempt_hash",
      ]);
    if (name === "estimation_results" && !store.indexNames.contains("job"))
      store.createIndex("job", "jobId");
    if (name === "estimation_results" && !store.indexNames.contains("method"))
      store.createIndex("method", ["scopeKey", "methodHash"]);
  }
}
export async function writable(
  tx: IDBTransaction,
  scope: Scope,
): Promise<boolean> {
  return (
    !(await request(tx.objectStore("deletion_markers").get(scope.namespace))) &&
    !(await hasPendingPurge(tx, scope.namespace))
  );
}
export async function historyRowErased(
  tx: IDBTransaction,
  row: HistoryRow,
): Promise<boolean> {
  const keys = [
    row.namespace,
    row.key,
    ...(row.record.provider_request_key
      ? [
          `history-live:${row.namespace}:request:${row.record.provider_request_key}`,
        ]
      : []),
    ...(row.record.provider_attempt_key
      ? [
          `history-live:${row.namespace}:attempt:${row.record.provider_attempt_key}`,
        ]
      : []),
  ];
  for (const key of keys)
    if (await request(tx.objectStore("deletion_markers").get(key))) return true;
  let erased = false;
  await eachCursor(
    tx.objectStore("deletion_markers"),
    IDBKeyRange.bound(
      `range:${row.namespace}:`,
      `range:${row.namespace}:\uffff`,
    ),
    (marker) => {
      if (
        !marker.retention &&
        (row.record.occurred_at === null ||
          ((!marker.start ||
            compareHistoricalInstants(row.record.occurred_at, marker.start) >=
              0) &&
            (!marker.end ||
              compareHistoricalInstants(row.record.occurred_at, marker.end) <
                0)))
      )
        erased = true;
    },
  );
  return erased;
}
export async function legacyOriginal(
  tx: IDBTransaction,
  row: InputRow,
  attemptHash?: string,
): Promise<ReturnType<typeof OriginalEstimateResultSchema.parse> | null> {
  let chosen: ReturnType<typeof OriginalEstimateResultSchema.parse> | null =
    null;
  let conflict = false;
  await eachCursor(
    tx.objectStore("local_estimates").index("attempt"),
    IDBKeyRange.only([row.namespace, row.id]),
    async (value) => {
      const parsed = OriginalEstimateResultSchema.safeParse(value.estimate);
      if (
        !parsed.success ||
        parsed.data.view !== "original" ||
        (attemptHash && parsed.data.observation_hash !== attemptHash)
      )
        return;
      const measurement: RecordRow | undefined = await request(
        tx
          .objectStore("measurements")
          .get(
            `${row.namespace}:attempt:${row.id}:${parsed.data.observation_revision}`,
          ),
      );
      if (
        !measurement ||
        measurement.era !== row.era ||
        measurement.hash !== parsed.data.observation_hash ||
        payloadHash(measurement.record) !== measurement.hash ||
        measurement.record.kind !== "attempt" ||
        (measurement.record.proposed_method_id &&
          measurement.record.proposed_method_id !== parsed.data.method_id)
      )
        return;
      if (
        chosen &&
        (chosen.method_hash !== parsed.data.method_hash ||
          chosen.method_id !== parsed.data.method_id)
      )
        conflict = true;
      if (
        !chosen ||
        parsed.data.observation_revision < chosen.observation_revision
      )
        chosen = parsed.data;
    },
  );
  return conflict ? null : chosen;
}
export async function originalForSource(
  tx: IDBTransaction,
  row: InputRow,
  source: EstimationEnvelope["source"],
): Promise<EstimationEnvelope | null> {
  const value = await request(
    tx
      .objectStore("estimation_originals")
      .index("source")
      .get([row.key, payloadHash(source)]),
  );
  return value ? EstimationEnvelopeSchema.parse(value.result) : null;
}
async function alwaysUnadmitted(
  tx: IDBTransaction,
  row: InputRow,
): Promise<boolean> {
  const prefix = `${row.namespace}:attempt:${row.id}:`;
  return new Promise((resolve, reject) => {
    let found = false;
    const cursor = tx
      .objectStore("measurements")
      .openCursor(IDBKeyRange.bound(prefix, prefix + "\uffff"));
    cursor.onerror = () => reject(cursor.error);
    cursor.onsuccess = () => {
      const entry = cursor.result;
      if (!entry) return resolve(found);
      const measurement = entry.value as RecordRow;
      try {
        const observation = parseObservation(measurement.record);
        // A later admission marker cannot erase any earlier proposal or uncertain legacy admission.
        if (
          measurement.namespace !== row.namespace ||
          measurement.era !== row.era ||
          observation.kind !== "attempt" ||
          observation.attempt_id !== row.id ||
          measurement.key !== prefix + observation.revision ||
          payloadHash(observation) !== measurement.hash ||
          observation.proposed_method_id !== UNAVAILABLE_ADMISSION_METHOD_ID
        )
          return resolve(false);
      } catch {
        return resolve(false);
      }
      found = true;
      entry.continue();
    };
  });
}
export async function resolveInput(
  tx: IDBTransaction,
  row: InputRow,
  includeHistory = true,
  allowAlias = false,
  observedRequestSource = false,
): Promise<EstimationInput | null> {
  const scope: Scope = {
    namespace: row.namespace,
    mode: row.namespace.startsWith("company:") ? "company" : "personal",
    era: row.era,
  };
  if (!(await writable(tx, scope))) return null;
  const common = { key: row.key, scope, sequence: row.sequence };
  if (row.family === "history") {
    const stored: HistoryRow | undefined = await request(
      tx
        .objectStore("history_records")
        .get(`${row.namespace}:history:${row.id}`),
    );
    if (
      !stored ||
      stored.era !== row.era ||
      stored.status !== "current" ||
      stored.record.role !== "response" ||
      (await historyRowErased(tx, stored))
    )
      return null;
    const history = HistoryMessageSchema.parse(stored.record);
    if (historyNumericPayloadHash(history) !== stored.hash)
      throw new Error("ledger_integrity_failed");
    return {
      ...common,
      family: "history",
      source: {
        family: "history",
        message_key: history.message_key,
        observation_hash: stored.hash,
      },
      history,
      originalMethodHash: stored.original.proposed_method_hash,
      originalMethodState: "recorded",
    };
  }
  if (
    await request(
      tx
        .objectStore("deletion_markers")
        .get(attemptErasureKey(row.namespace, row.id)),
    )
  )
    return null;
  const stored: RecordRow | undefined = await request(
    tx.objectStore("attempts").get(`${row.namespace}:attempt:${row.id}`),
  );
  if (!stored || (stored.aliasOf && !allowAlias) || stored.era !== row.era)
    return null;
  const attempt = parseObservation(stored.record);
  if (attempt.kind !== "attempt" || payloadHash(attempt) !== stored.hash)
    throw new Error("ledger_integrity_failed");
  const seen = new Set<string>();
  let id = attempt.request_id;
  let parent: RecordRow | undefined;
  const requestChain: RecordRow[] = [];
  for (let depth = 0; depth < 64; depth++) {
    if (seen.has(id)) return null;
    seen.add(id);
    if (
      await request(
        tx.objectStore("deletion_markers").get(`${row.namespace}:${id}`),
      )
    )
      return null;
    parent = await request(
      tx.objectStore("requests").get(`${row.namespace}:request:${id}`),
    );
    if (!parent || parent.namespace !== row.namespace || parent.era !== row.era)
      return null;
    const checked = parseObservation(parent.record);
    if (
      checked.kind !== "request" ||
      checked.request_id !== id ||
      payloadHash(checked) !== parent.hash
    )
      throw new Error("ledger_integrity_failed");
    requestChain.push(parent);
    if (!parent.aliasOf) break;
    id = parent.aliasOf;
    parent = undefined;
  }
  if (!parent) return null;
  // Original capture envelopes may bind the actual observed request even after it becomes an alias.
  if (observedRequestSource) {
    parent = requestChain[0]!;
    id = attempt.request_id;
  }
  const sourceRequest = parseObservation(parent.record);
  if (
    sourceRequest.kind !== "request" ||
    sourceRequest.request_id !== id ||
    payloadHash(sourceRequest) !== parent.hash
  )
    throw new Error("ledger_integrity_failed");
  let removed = false;
  await eachCursor(
    tx.objectStore("deletion_markers"),
    IDBKeyRange.bound(
      `range:${row.namespace}:`,
      `range:${row.namespace}:\uffff`,
    ),
    (marker) => {
      if (
        requestChain.some(
          (entry) =>
            entry.record.kind === "request" &&
            (!marker.start || entry.record.dispatched_at >= marker.start) &&
            (!marker.end || entry.record.dispatched_at < marker.end),
        )
      )
        removed = true;
    },
  );
  if (removed) return null;
  const linked = includeHistory
    ? await linkedHistory(
        tx,
        scope,
        attempt.attempt_id,
        attempt.provider_attempt_key,
      )
    : null;
  const legacy = row.originalMethodHash ? null : await legacyOriginal(tx, row);
  const proposed = attempt.proposed_method_id;
  const pinnedMethodId = row.originalMethodId ?? legacy?.method_id ?? null;
  const originalMethodHash =
    proposed && pinnedMethodId && proposed !== pinnedMethodId
      ? null
      : (row.originalMethodHash ?? legacy?.method_hash ?? null);
  const explicitlyUnadmitted =
    proposed === UNAVAILABLE_ADMISSION_METHOD_ID &&
    !row.originalMethodHash &&
    !row.originalMethodId &&
    !legacy &&
    !(await request(
      tx.objectStore("estimation_originals").index("input").count(row.key),
    )) &&
    !(await request(
      tx
        .objectStore("local_estimates")
        .index("attempt")
        .count([row.namespace, row.id]),
    )) &&
    !(await request(
      tx
        .objectStore("local_estimates")
        .index("envelopeAttempt")
        .count([row.namespace, row.id]),
    )) &&
    (await alwaysUnadmitted(tx, row));
  return {
    ...common,
    family: "live",
    request: sourceRequest,
    attempt,
    ...(linked ? { history: linked.record } : {}),
    originalMethodHash,
    originalMethodState: originalMethodHash
      ? "recorded"
      : explicitlyUnadmitted
        ? "not_admitted"
        : "unavailable",
    source: {
      family: "live",
      request_id: id,
      request_revision: sourceRequest.revision,
      request_hash: parent.hash,
      attempt_id: attempt.attempt_id,
      attempt_revision: attempt.revision,
      attempt_hash: stored.hash,
      ...(linked
        ? {
            history_binding: {
              message_key: linked.record.message_key,
              observation_hash: linked.hash,
            },
          }
        : {}),
      ...(id !== attempt.request_id
        ? {
            canonical_request_binding: {
              observed_request_id: attempt.request_id,
              canonical_request_id: id,
              relation_hash: payloadHash({
                kind: "canonical_request_alias",
                observed_request_id: attempt.request_id,
                canonical_request_id: id,
              }),
            },
          }
        : {}),
    },
  };
}

export async function matchingLiveInput(
  tx: IDBTransaction,
  scope: Scope,
  history: HistoryMessage,
): Promise<{
  request: import("@footprint/contracts").RequestObservation;
  attempt?: import("@footprint/contracts").AttemptObservation;
  input?: Extract<EstimationInput, { family: "live" }>;
} | null> {
  if (!(await localReadMemberAllowed(tx, scope))) return null;
  if (history.role === "prompt" && !history.provider_request_key) {
    const responses: HistoryRow[] = await request(
      tx
        .objectStore("history_records")
        .index("prompt")
        .getAll([scope.namespace, history.message_key]),
    );
    const matches = new Map<
      string,
      { request: import("@footprint/contracts").RequestObservation }
    >();
    for (const row of responses) {
      if (
        row.status !== "current" ||
        row.record.role !== "response" ||
        row.record.conversation_key !== history.conversation_key ||
        row.record.prompt_key !== history.message_key ||
        !(await localReadMemberAllowed(tx, { ...scope, era: row.era })) ||
        (await historyRowErased(tx, row))
      )
        continue;
      if (
        historyNumericPayloadHash(HistoryMessageSchema.parse(row.record)) !==
        row.hash
      )
        throw new Error("ledger_integrity_failed");
      const match = await matchingLiveInput(tx, scope, row.record);
      if (match && ["send", "edit_and_send"].includes(match.request.action))
        matches.set(match.request.request_id, { request: match.request });
    }
    return matches.size === 1 ? [...matches.values()][0]! : null;
  }
  const stable =
    history.role === "prompt"
      ? history.provider_request_key
      : history.provider_attempt_key;
  if (!stable) return null;
  if (history.role === "response") {
    const rows: HistoryRow[] = await request(
      tx
        .objectStore("history_records")
        .index("liveAttempt")
        .getAll([scope.namespace, stable]),
    );
    let count = 0;
    for (const row of rows)
      if (
        row.status === "current" &&
        row.record.role === "response" &&
        row.record.site === history.site &&
        row.record.conversation_key === history.conversation_key &&
        (await localReadMemberAllowed(tx, { ...scope, era: row.era })) &&
        !(await historyRowErased(tx, row))
      )
        count++;
    if (count > 1) return null;
  }
  const kind = history.role === "prompt" ? "requests" : "attempts";
  const candidates: Array<{
    request: import("@footprint/contracts").RequestObservation;
    attempt?: import("@footprint/contracts").AttemptObservation;
    input?: Extract<EstimationInput, { family: "live" }>;
  }> = [];
  await eachCursor(
    tx.objectStore(kind).index("provider"),
    IDBKeyRange.only([scope.namespace, stable]),
    async (stored: RecordRow) => {
      if (
        stored.aliasOf ||
        !(await localReadMemberAllowed(tx, { ...scope, era: stored.era }))
      )
        return;
      if (stored.record.kind === "request") {
        if (payloadHash(parseObservation(stored.record)) !== stored.hash)
          throw new Error("ledger_integrity_failed");
        let erased = false;
        await eachCursor(
          tx.objectStore("deletion_markers"),
          IDBKeyRange.bound(
            `range:${scope.namespace}:`,
            `range:${scope.namespace}:\uffff`,
          ),
          (marker) => {
            if (
              stored.record.kind === "request" &&
              (!marker.start || stored.record.dispatched_at >= marker.start) &&
              (!marker.end || stored.record.dispatched_at < marker.end)
            )
              erased = true;
          },
        );
        if (
          !erased &&
          !(await request(
            tx
              .objectStore("deletion_markers")
              .get(`${scope.namespace}:${stored.record.request_id}`),
          ))
        )
          candidates.push({ request: stored.record });
      } else {
        const row: InputRow | undefined = await request(
          tx
            .objectStore("estimation_inputs")
            .get(
              inputKey(
                { ...scope, era: stored.era },
                "live",
                stored.record.attempt_id,
              ),
            ),
        );
        const live = row ? await resolveInput(tx, row, false) : null;
        if (live?.family === "live")
          candidates.push({
            request: live.request,
            attempt: live.attempt,
            input: live,
          });
      }
    },
  );
  return uniqueLiveHistoryMatch(history, candidates);
}

async function linkedHistory(
  tx: IDBTransaction,
  scope: Scope,
  attemptId: string,
  providerKey: string | null,
): Promise<HistoryRow | null> {
  if (!providerKey || !(await localReadMemberAllowed(tx, scope))) return null;
  const rows: HistoryRow[] = await request(
    tx
      .objectStore("history_records")
      .index("liveAttempt")
      .getAll([scope.namespace, providerKey]),
  );
  const matches: HistoryRow[] = [];
  for (const row of rows) {
    if (
      row.status !== "current" ||
      row.record.role !== "response" ||
      !(await localReadMemberAllowed(tx, { ...scope, era: row.era })) ||
      (await historyRowErased(tx, row))
    )
      continue;
    const history = HistoryMessageSchema.parse(row.record);
    if (historyNumericPayloadHash(history) !== row.hash)
      throw new Error("ledger_integrity_failed");
    const live = await matchingLiveInput(tx, scope, history);
    if (live?.attempt?.attempt_id === attemptId) matches.push(row);
  }
  return matches.length === 1 ? matches[0]! : null;
}

/** All candidates must be invalidated when evidence changes, including ambiguous links. */
export async function touchHistoryLinks(
  tx: IDBTransaction,
  scope: Scope,
  history: HistoryMessage,
): Promise<void> {
  if (!history.provider_attempt_key) return;
  await eachCursor(
    tx.objectStore("attempts").index("provider"),
    IDBKeyRange.only([scope.namespace, history.provider_attempt_key]),
    async (row: RecordRow) => {
      if (!row.aliasOf && row.record.kind === "attempt")
        await touchInput(
          tx,
          { ...scope, era: row.era },
          "live",
          row.record.attempt_id,
        );
    },
  );
}

/** Changes move beyond the active snapshot watermark, including revisions behind its cursor. */
export async function touchInput(
  tx: IDBTransaction,
  scope: Scope,
  family: "live" | "history",
  id: string,
  remove = false,
  eraseOriginals = true,
): Promise<void> {
  if (family === "history") {
    const dependents: InputRow[] = await request(
      tx
        .objectStore("estimation_inputs")
        .index("dependency")
        .getAll(`history:${scope.namespace}:${id}`),
    );
    for (const linked of dependents)
      await touchInput(tx, { ...scope, era: linked.era }, "live", linked.id);
  }
  const key = inputKey(scope, family, id),
    store = tx.objectStore("estimation_inputs");
  const old: InputRow | undefined = await request(store.get(key));
  const pin = old?.originalMethodHash
    ? old
    : remove
      ? {}
      : await archivedOriginalPin(tx, key);
  const state = await stateFor(tx, scope);
  const results: ResultRow[] = await request(
    tx.objectStore("estimation_results").index("input").getAll(key),
  );
  for (const result of results)
    tx.objectStore("estimation_results").delete(result.key);
  if (state.selectedJob && old) {
    const selected: JobRow | undefined = await request(
      tx.objectStore("estimation_jobs").get(state.selectedJob),
    );
    if (
      selected &&
      old.sequence > selected.baseWatermark &&
      old.sequence <= selected.watermark
    ) {
      const previous = results.find(
        (result) =>
          result.methodHash === selected.target.method_hash &&
          result.sequence === old.sequence,
      );
      selected.snapshotTotal--;
      if (previous) {
        selected.processed--;
        if (!previous.result || previous.result.status === "unavailable")
          selected.unavailable--;
      }
      tx.objectStore("estimation_jobs").put(selected);
    }
  }
  if (state.activeJob) {
    const job: JobRow | undefined = await request(
      tx.objectStore("estimation_jobs").get(state.activeJob),
    );
    if (job && job.status === "running") {
      if (
        old &&
        old.sequence > job.baseWatermark &&
        old.sequence <= job.watermark
      ) {
        job.snapshotTotal--;
        const counted = results.find(
          (value) => value.jobId === job.id && value.sequence === old.sequence,
        );
        if (counted) {
          job.processed--;
          if (!counted.result || counted.result.status === "unavailable")
            job.unavailable--;
        }
      }
      if (!old || old.sequence <= job.watermark) job.pending += remove ? 0 : 1;
      else if (remove) job.pending = Math.max(0, job.pending - 1);
      tx.objectStore("estimation_jobs").put(job);
    }
  }
  if (remove) {
    store.delete(key);
    if (eraseOriginals)
      await eachCursor(
        tx.objectStore("estimation_originals").index("input"),
        IDBKeyRange.only(key),
        (row) => {
          tx.objectStore("estimation_originals").delete(row.key);
        },
      );
  } else {
    const attempt =
      family === "live"
        ? await request(
            tx.objectStore("attempts").get(`${scope.namespace}:attempt:${id}`),
          )
        : null;
    const dependencies = await requestDependencies(
      tx,
      scope,
      attempt?.record.request_id,
    );
    if (attempt?.record.provider_attempt_key) {
      const histories: HistoryRow[] = await request(
        tx
          .objectStore("history_records")
          .index("liveAttempt")
          .getAll([scope.namespace, attempt.record.provider_attempt_key]),
      );
      for (const history of histories)
        dependencies.push(
          `history:${scope.namespace}:${history.record.message_key}`,
        );
    }
    store.put({
      key,
      namespace: scope.namespace,
      era: scope.era,
      scopeKey: scopeKey(scope),
      family,
      id,
      sequence: ++state.sequence,
      dependencies,
      ...(pin?.originalMethodHash
        ? {
            originalMethodHash: pin.originalMethodHash,
            originalMethodId: pin.originalMethodId,
          }
        : {}),
    } satisfies InputRow);
  }
  tx.objectStore("estimation_state").put(state);
  if (!remove) await refreshOriginalEvidence(tx, key);
}
export async function touchObservation(
  tx: IDBTransaction,
  scope: Scope,
  record: RecordRow["record"],
): Promise<void> {
  if (record.kind === "attempt")
    return touchInput(tx, scope, "live", record.attempt_id);
  await eachCursor(
    tx.objectStore("estimation_inputs").index("dependency"),
    IDBKeyRange.only(`${scope.namespace}:${record.request_id}`),
    async (row) => {
      if (row.era === scope.era) await touchInput(tx, scope, "live", row.id);
    },
  );
  await eachCursor(
    tx.objectStore("attempts").index("parent"),
    IDBKeyRange.only([scope.namespace, record.request_id]),
    async (row) => {
      if (
        row.era === scope.era &&
        !row.aliasOf &&
        !(await request(
          tx
            .objectStore("estimation_inputs")
            .get(inputKey(scope, "live", row.record.attempt_id)),
        ))
      )
        await touchInput(tx, scope, "live", row.record.attempt_id);
    },
  );
}
export async function touchAliases(
  tx: IDBTransaction,
  namespace: string,
): Promise<void> {
  await eachCursor(
    tx.objectStore("attempts").index("namespace"),
    IDBKeyRange.only(namespace),
    async (row: RecordRow) => {
      if (row.record.kind === "attempt")
        await touchInput(
          tx,
          {
            namespace,
            mode: namespace.startsWith("company:") ? "company" : "personal",
            era: row.era,
          },
          "live",
          row.record.attempt_id,
          !!row.aliasOf,
          false,
        );
    },
  );
}
/** Erasure cancels candidate work; unchanged completed results remain reusable. */
export async function invalidateEstimationJobs(
  tx: IDBTransaction,
  namespace: string,
): Promise<void> {
  await eachCursor(
    tx.objectStore("estimation_state").index("namespace"),
    IDBKeyRange.only(namespace),
    async (state: StateRow) => {
      if (state.activeJob && state.activeJob !== state.selectedJob) {
        await eachCursor(
          tx.objectStore("estimation_results").index("job"),
          IDBKeyRange.only(state.activeJob),
          (row) => {
            tx.objectStore("estimation_results").delete(row.key);
          },
        );
        tx.objectStore("estimation_jobs").delete(state.activeJob);
      }
      const remaining = await request(
        tx.objectStore("estimation_inputs").index("scope").count(state.key),
      );
      if (!remaining && state.selectedJob)
        tx.objectStore("estimation_jobs").delete(state.selectedJob);
      tx.objectStore("estimation_state").put({
        ...state,
        activeJob: null,
        selectedJob: remaining ? state.selectedJob : null,
        generation: state.generation + 1,
        publicationVersion: (state.publicationVersion ?? 0) + 1,
      });
    },
  );
}
/** A cache hash cannot acquire a different method identity after admission. */
export async function admitMethodIdentity(
  tx: IDBTransaction,
  identity: EngineMethodIdentity,
): Promise<void> {
  const method = EngineMethodIdentitySchema.parse(identity),
    store = tx.objectStore("policy");
  const keys = [
    `estimation-method-id:${method.method_id}`,
    `estimation-method-hash:${method.method_hash}`,
  ];
  let registered = true;
  for (const key of keys) {
    const old = await request(store.get(key));
    if (!old) registered = false;
    else if (
      canonicalJson(EngineMethodIdentitySchema.parse(old.identity)) !==
      canonicalJson(method)
    )
      throw new Error("method_update_invalid");
  }
  if (registered) return;
  // Earlier version-12 jobs predate the registry and still constrain the accepted identity.
  await eachCursor(tx.objectStore("estimation_jobs"), null, (job: JobRow) => {
    if (
      (job.target.method_id === method.method_id ||
        job.target.method_hash === method.method_hash) &&
      canonicalJson(job.target) !== canonicalJson(method)
    )
      throw new Error("method_update_invalid");
  });
  for (const key of keys) store.put({ key, identity: method });
}
export async function storeOriginal(
  tx: IDBTransaction,
  scope: Scope,
  untrusted: unknown,
): Promise<void> {
  const result = EstimationEnvelopeSchema.parse(untrusted);
  if (result.view !== "original") throw new Error("payload_rejected");
  const key = inputKey(
    scope,
    result.source.family,
    result.source.family === "live"
      ? result.source.attempt_id
      : result.source.message_key,
  );
  let row: InputRow | undefined = await request(
    tx.objectStore("estimation_inputs").get(key),
  );
  const attemptRow: RecordRow | undefined =
    result.source.family === "live"
      ? await request(
          tx
            .objectStore("attempts")
            .get(`${scope.namespace}:attempt:${result.source.attempt_id}`),
        )
      : undefined;
  if (!row && attemptRow?.aliasOf && attemptRow.era === scope.era) {
    row = {
      key,
      namespace: scope.namespace,
      era: scope.era,
      scopeKey: scopeKey(scope),
      family: "live",
      id: result.source.family === "live" ? result.source.attempt_id : "",
      sequence: 0,
      dependencies: [],
      ...(await archivedOriginalPin(tx, key)),
    };
  }
  const input = row
    ? await resolveInput(
        tx,
        row,
        result.source.family !== "live" || !!result.source.history_binding,
        true,
        result.source.family === "live" &&
          result.source.canonical_request_binding === undefined &&
          result.source.history_binding === undefined &&
          attemptRow?.record.kind === "attempt" &&
          result.source.request_id === attemptRow.record.request_id,
      )
    : null;
  if (!input || canonicalJson(input.source) !== canonicalJson(result.source))
    throw new Error("stale_estimation_result");
  if (
    input.family === "history" &&
    (input.history.proposed_method_hash !==
      result.requested_method.method_hash ||
      input.history.proposed_method_id !== result.requested_method.method_id)
  )
    throw new Error("method_update_invalid");
  const legacy =
    input.family === "live" && !row!.originalMethodHash
      ? await legacyOriginal(tx, row!)
      : null;
  const pinnedHash =
    row!.originalMethodHash ?? legacy?.method_hash ?? input.originalMethodHash;
  const pinnedId =
    row!.originalMethodId ??
    legacy?.method_id ??
    (input.family === "history" ? input.history.proposed_method_id : null);
  if (
    (pinnedHash && pinnedHash !== result.requested_method.method_hash) ||
    (pinnedId && pinnedId !== result.requested_method.method_id)
  )
    throw new Error("method_admission_conflict");
  await admitMethodIdentity(tx, result.requested_method);
  await admitMethodIdentity(tx, result.effective_method);
  if (
    row!.originalMethodHash &&
    (row!.originalMethodHash !== result.requested_method.method_hash ||
      row!.originalMethodId !== result.requested_method.method_id)
  )
    throw new Error("method_admission_conflict");
  if (
    input.family === "live" &&
    input.attempt.proposed_method_id &&
    input.attempt.proposed_method_id !== result.requested_method.method_id
  )
    throw new Error("method_admission_conflict");
  if (!row!.originalMethodHash && !attemptRow?.aliasOf) {
    // A separately arriving authentic original can unblock a previously terminal missing-lineage input.
    await touchInput(tx, scope, row!.family, row!.id);
    const latest = await request(tx.objectStore("estimation_inputs").get(key));
    tx.objectStore("estimation_inputs").put({
      ...latest,
      originalMethodHash: result.requested_method.method_hash,
      originalMethodId: result.requested_method.method_id,
    });
  }
  const originalKey = `${key}:${payloadHash(result.source)}:${result.requested_method.method_hash}`;
  const store = tx.objectStore("estimation_originals"),
    old = await request(store.get(originalKey));
  if (old && canonicalJson(old.result) !== canonicalJson(result))
    throw new Error("revision_conflict");
  if (!old)
    store.put({
      key: originalKey,
      namespace: scope.namespace,
      inputKey: key,
      sourceHash: payloadHash(result.source),
      result,
    });
  if (attemptRow?.aliasOf)
    await touchInput(tx, scope, "live", row!.id, true, false);
  else await refreshOriginalEvidence(tx, key);
}

async function archivedOriginalPin(
  tx: IDBTransaction,
  key: string,
): Promise<Pick<InputRow, "originalMethodHash" | "originalMethodId">> {
  const rows = await request(
    tx.objectStore("estimation_originals").index("input").getAll(key),
  );
  let pin: Pick<InputRow, "originalMethodHash" | "originalMethodId"> = {};
  for (const row of rows) {
    const result = EstimationEnvelopeSchema.parse(row.result);
    const sourceHash = payloadHash(result.source);
    if (
      row.inputKey !== key ||
      row.sourceHash !== sourceHash ||
      row.key !==
        `${key}:${sourceHash}:${result.requested_method.method_hash}` ||
      result.view !== "original"
    )
      throw new Error("ledger_integrity_failed");
    if (
      pin.originalMethodHash &&
      pin.originalMethodHash !== result.requested_method.method_hash
    )
      throw new Error("method_admission_conflict");
    pin = {
      originalMethodHash: result.requested_method.method_hash,
      originalMethodId: result.requested_method.method_id,
    };
  }
  return pin;
}
export async function refreshOriginalEvidence(
  tx: IDBTransaction,
  key: string,
): Promise<void> {
  const row: InputRow | undefined = await request(
    tx.objectStore("estimation_inputs").get(key),
  );
  if (!row) return;
  const input = await resolveInput(tx, row);
  const sourceHash = input ? payloadHash(input.source) : null;
  const originals = sourceHash
    ? await request(
        tx
          .objectStore("estimation_originals")
          .index("source")
          .getAll([key, sourceHash]),
      )
    : [];
  const current = originals.some(
    (original) =>
      original.result.view === "original" &&
      original.result.requested_method.method_hash ===
        input?.originalMethodHash &&
      canonicalJson(original.result.source) === canonicalJson(input?.source),
  );
  tx.objectStore("estimation_inputs").put({
    ...row,
    originalEvidenceCurrent: current ? 1 : 0,
    resolvedSourceHash: sourceHash,
  });
}

export async function refreshHistoryAuthority(
  tx: IDBTransaction,
): Promise<void> {
  await eachCursor(
    tx.objectStore("estimation_inputs"),
    null,
    async (row: InputRow) => {
      if (
        row.family !== "live" ||
        !row.dependencies.some((key) => key.startsWith("history:"))
      )
        return;
      const input = await resolveInput(tx, row),
        hash = input ? payloadHash(input.source) : null;
      if (hash !== (row.resolvedSourceHash ?? null)) {
        const scope: Scope = {
          namespace: row.namespace,
          era: row.era,
          mode: row.namespace.startsWith("personal:") ? "personal" : "company",
        };
        await touchInput(tx, scope, "live", row.id);
      }
    },
  );
}
