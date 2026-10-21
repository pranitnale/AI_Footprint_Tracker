import {
  canonicalJson,
  EstimationEnvelopeSchema,
  OriginalEstimateResultSchema,
  parseObservation,
} from "@footprint/contracts";
import type { Ledger } from "./index";
import type {
  ApplicationRepository,
  CaptureCommit,
  StoredEstimate,
  TrackingCheckpoint,
  SummaryVersion,
} from "./repository-contracts";
import { createIndexedDbSessionRepositories } from "./indexeddb-session";
import {
  checkedHistoryRow,
  checkpointCompanyKey,
  checkpointContentKey,
  type HistoryRow,
  type OutboxRow,
} from "./ledger-support";
import { checkedScope } from "./estimation-storage";
import { estimateAttemptIdentity } from "./capture-validation";

function storedEstimate(value: unknown): StoredEstimate | undefined {
  if (value === undefined || value === null) return undefined;
  const envelope = EstimationEnvelopeSchema.safeParse(value);
  if (envelope.success) return envelope.data;
  const legacy = OriginalEstimateResultSchema.safeParse(value);
  if (legacy.success) return legacy.data;
  throw new Error("ledger_integrity_failed");
}
async function commitCapture(
  ledger: Ledger,
  input: CaptureCommit,
): Promise<void> {
  const { guard, ...payload } = input;
  const command: CaptureCommit = structuredClone(payload);
  if (guard) {
    const { requestFileMetadata, ...rest } = guard;
    command.guard = structuredClone(rest);
    if (requestFileMetadata) {
      const { validNow, ...source } = requestFileMetadata;
      command.guard.requestFileMetadata = {
        ...structuredClone(source),
        validNow,
      };
    }
  }
  checkedScope(command.scope);
  const metadata: Array<{
    store: "provider_key_map" | "local_estimates" | "estimation_originals";
    value: { key: string; [key: string]: unknown };
  }> = [];
  if (command.checkpoint) {
    const checkpoint = command.checkpoint;
    const request = parseObservation(checkpoint.request),
      attempt = parseObservation(checkpoint.attempt);
    if (
      checkpoint.namespace !== command.scope.namespace ||
      canonicalJson(checkpoint.scope) !== canonicalJson(command.scope) ||
      request.kind !== "request" ||
      attempt.kind !== "attempt" ||
      attempt.request_id !== request.request_id ||
      typeof checkpoint.key !== "string" ||
      checkpoint.key.length < 1 ||
      checkpoint.key.length > 512
    )
      throw new Error("policy_unavailable");
    // Malformed company and content keys are rejected before anything is written.
    checkpointCompanyKey(checkpoint, request);
    checkpointContentKey(checkpoint);
    metadata.push({ store: "provider_key_map", value: { ...checkpoint } });
  }
  for (const untrusted of command.archivedEstimates ?? []) {
    const estimate = storedEstimate(untrusted);
    if (!estimate || estimate.view !== "original")
      throw new Error("payload_rejected");
    const envelope = estimate.schema_version === "3.0.0" ? estimate : null;
    if (envelope && envelope.source.family !== "live")
      throw new Error("payload_rejected");
    const attemptId =
      envelope?.source.family === "live"
        ? envelope.source.attempt_id
        : (estimate as ReturnType<typeof OriginalEstimateResultSchema.parse>)
            .attempt_id;
    const revision =
      envelope?.source.family === "live"
        ? envelope.source.attempt_revision
        : (estimate as ReturnType<typeof OriginalEstimateResultSchema.parse>)
            .observation_revision;
    const methodId = envelope
      ? envelope.requested_method.method_id
      : (estimate as ReturnType<typeof OriginalEstimateResultSchema.parse>)
          .method_id;
    metadata.push({
      store: "local_estimates",
      value: {
        key: `${command.scope.namespace}:${attemptId}:${revision}:${methodId}:original`,
        namespace: command.scope.namespace,
        estimate,
      },
    });
  }
  for (const estimate of command.originals ?? [])
    metadata.push({
      store: "estimation_originals",
      value: { key: "validated-original", estimate },
    });
  if (command.currentEstimate) {
    if (
      command.currentEstimate.estimate !== null &&
      estimateAttemptIdentity(command.currentEstimate.estimate).id !==
        command.currentEstimate.attemptId
    )
      throw new Error("stale_estimation_result");
    metadata.push({
      store: "local_estimates",
      value: {
        key: `current:${command.scope.namespace}:${command.currentEstimate.attemptId}`,
        namespace: command.scope.namespace,
        selection: "current",
        estimate:
          command.currentEstimate.estimate === null
            ? null
            : storedEstimate(command.currentEstimate.estimate),
      },
    });
  }
  await ledger.commit(
    command.scope,
    command.observations,
    metadata,
    command.guard,
    {
      checkpoint: command.checkpoint,
      currentEstimate: command.currentEstimate,
    },
  );
}

/** Adapt existing atomic operations without exposing their table or index layout to consumers. */
export function createIndexedDbRepository(
  ledger: Ledger,
): ApplicationRepository {
  return {
    ...createIndexedDbSessionRepositories(ledger),
    estimation: ledger.estimation,
    capture: (scope, observations, originals) =>
      commitCapture(ledger, { scope, observations, originals }),
    checkpoint: (id) => ledger.get<TrackingCheckpoint>("provider_key_map", id),
    commitCapture: (command) => commitCapture(ledger, command),
    coalesceProviderIdentity: ledger.coalesceProviderIdentity.bind(ledger),
    completedAttempt: ledger.completedAttempt.bind(ledger),
    recoverInterrupted: ledger.recoverInterrupted.bind(ledger),
    getRecord: ledger.getRecord.bind(ledger),
    getRecords: ledger.getRecords.bind(ledger),
    scanRequests: async (namespace, consume, filter) => {
      await (filter?.threadKey
        ? ledger.scanThreadRequests(namespace, filter.threadKey, consume)
        : filter?.conversationKey
          ? ledger.scanIndex(
              "requests",
              "conversation",
              [namespace, filter.conversationKey],
              consume,
            )
          : filter?.between
            ? ledger.scanRecordsBetween(
                namespace,
                "request",
                filter.between,
                consume,
              )
            : ledger.scanRecords(namespace, "request", consume));
    },
    scanAttempts: async (namespace, consume, filter) => {
      await (filter?.requestId
        ? ledger.scanIndex(
            "attempts",
            "parent",
            [namespace, filter.requestId],
            consume,
          )
        : filter?.between
          ? ledger.scanRecordsBetween(
              namespace,
              "attempt",
              filter.between,
              consume,
            )
          : ledger.scanRecords(namespace, "attempt", consume));
    },
    currentEstimate: async (namespace, id) =>
      storedEstimate(
        (
          await ledger.get<{ estimate: unknown }>(
            "local_estimates",
            `current:${namespace}:${id}`,
          )
        )?.estimate,
      ),
    pendingRevision: async (namespace, kind, id, revision) => {
      const row = await ledger.get<OutboxRow>(
        "outbox",
        `${namespace}:${kind}:${id}:${revision}`,
      );
      return !!row && !row.quarantined;
    },
    publicationSnapshot: async (...args) => {
      const snapshot = await ledger.publicationSnapshot(...args);
      const withoutKey = (value: any) => {
        if (!value) return undefined;
        const { key: _, ...domain } = value;
        return domain;
      };
      return {
        ...snapshot,
        credentials: withoutKey(snapshot.credentials),
        personal: withoutKey(snapshot.personal),
      };
    },
    summaryVersion: async (namespace) => {
      const row = await ledger.get<SummaryVersion>(
        "dashboard_cache",
        `epoch:${namespace}`,
      );
      return {
        version: row?.version ?? 0,
        erasureVersion: row?.erasureVersion ?? 0,
        threadRejectionVersion: row?.threadRejectionVersion ?? 0,
      };
    },
    readSummary: (id) => ledger.get("dashboard_cache", id),
    cacheSummary: ledger.cacheSummary.bind(ledger),
    serverSnapshot: ledger.serverSnapshot.bind(ledger),
    claimMonthly: ledger.claimMonthly.bind(ledger),
    claimPersonalMonthly: ledger.claimPersonalMonthly.bind(ledger),
    claimMonthlyView: ledger.claimMonthlyView.bind(ledger),
    lastClaimedMonth: async (namespace) =>
      (await ledger.get<{ month: string }>("policy", `monthly:${namespace}`))
        ?.month ?? null,
    pendingErasure: ledger.pendingErasure.bind(ledger),
    readDerived: ledger.readDerived.bind(ledger),
    writeDerived: ledger.writeDerived.bind(ledger),
    updateDerivedGuidance: ledger.updateDerivedGuidance.bind(ledger),
    queue: ledger.queue.bind(ledger),
    pending: ledger.pending.bind(ledger),
    pendingCount: ledger.pendingCount.bind(ledger),
    refusedCount: ledger.refusedCount.bind(ledger),
    queuedRecord: ledger.queuedRecord.bind(ledger),
    acknowledge: ledger.acknowledge.bind(ledger),
    retry: ledger.retry.bind(ledger),
    reconcile: ledger.reconcile.bind(ledger),
    eraseFamily: ledger.eraseFamily.bind(ledger),
    applyRange: ledger.applyRange.bind(ledger),
    eraseNamespace: ledger.eraseNamespace.bind(ledger),
    flagOrganizationMarkers: ledger.flagOrganizationMarkers.bind(ledger),
    releaseFlaggedMarker: ledger.releaseFlaggedMarker.bind(ledger),
    resumePendingCleanup: ledger.resumePendingCleanup.bind(ledger),
    findHistoryMessage: async (scope, id) => {
      checkedScope(scope);
      if (!/^[a-f0-9]{64}$/.test(id) || id.length !== 64)
        throw new Error("payload_rejected");
      const row = await ledger.get<HistoryRow>(
        "history_records",
        `${scope.namespace}:history:${id}`,
      );
      if (
        row &&
        (row.namespace !== scope.namespace || row.record.message_key !== id)
      )
        throw new Error("ledger_integrity_failed");
      return row ? checkedHistoryRow(row) : undefined;
    },
    historyCoverage: (scope, id) =>
      ledger.get("history_coverage", `${scope.namespace}:${id}`),
    commitHistory: ledger.commitHistory.bind(ledger),
    coworkCheckpoint: ledger.coworkCheckpoint.bind(ledger),
    liveReplyContents: ledger.liveReplyContents.bind(ledger),
    requeueHistory: ledger.requeueHistory.bind(ledger),
    historyPage: ledger.historyPage.bind(ledger),
    pendingHistory: ledger.pendingHistory.bind(ledger),
    acknowledgeHistory: ledger.acknowledgeHistory.bind(ledger),
    historyQueued: ledger.historyQueued.bind(ledger),
    pendingHistoryCoverage: ledger.pendingHistoryCoverage.bind(ledger),
    historyLiveOverlap: ledger.historyLiveOverlap.bind(ledger),
    historyErased: ledger.historyErased.bind(ledger),
    findHistoryMessages: ledger.findHistoryMessages.bind(ledger),
    historyRowFlags: ledger.historyRowFlags.bind(ledger),
    linkRecordedThread: ledger.linkRecordedThread.bind(ledger),
    threadAnswer: ledger.threadAnswer.bind(ledger),
    pendingThreadLinks: ledger.pendingThreadLinks.bind(ledger),
    acknowledgeThreadLinks: ledger.acknowledgeThreadLinks.bind(ledger),
    rejectThreadLinks: ledger.rejectThreadLinks.bind(ledger),
    threadRelationVersions: ledger.threadRelationVersions.bind(ledger),
  };
}
