import { payloadHash } from "@footprint/contracts";
import type { CaptureCommit, StoredEstimate } from "./repository-contracts";
import { request, type Scope, type RecordRow } from "./ledger-support";

export type CaptureMetadataGuard = Pick<
  CaptureCommit,
  "checkpoint" | "currentEstimate"
>;
export function estimateAttemptIdentity(estimate: StoredEstimate) {
  if (estimate.schema_version === "3.0.0") {
    if (estimate.source.family !== "live") throw new Error("payload_rejected");
    return {
      id: estimate.source.attempt_id,
      revision: estimate.source.attempt_revision,
      hash: estimate.source.attempt_hash,
    };
  }
  return {
    id: estimate.attempt_id,
    revision: estimate.observation_revision,
    hash: estimate.observation_hash,
  };
}
/** Validate metadata against the transaction's staged observations, including unchanged counterparts. */
export async function validateCaptureMetadata(
  tx: IDBTransaction,
  scope: Scope,
  metadata: CaptureMetadataGuard,
): Promise<void> {
  const matches = async (
    kind: "request" | "attempt",
    id: string,
    revision?: number,
    hash?: string,
  ) => {
    const row: RecordRow | undefined = await request(
      tx
        .objectStore(kind === "request" ? "requests" : "attempts")
        .get(`${scope.namespace}:${kind}:${id}`),
    );
    return (
      !!row &&
      row.namespace === scope.namespace &&
      row.era === scope.era &&
      (revision === undefined || row.record.revision === revision) &&
      (hash === undefined || row.hash === hash) &&
      payloadHash(row.record) === row.hash
    );
  };
  const checkpoint = metadata.checkpoint;
  if (
    checkpoint &&
    (!(await matches(
      "request",
      checkpoint.request.request_id,
      checkpoint.request.revision,
      payloadHash(checkpoint.request),
    )) ||
      !(await matches(
        "attempt",
        checkpoint.attempt.attempt_id,
        checkpoint.attempt.revision,
        payloadHash(checkpoint.attempt),
      )))
  )
    throw new Error("stale_estimation_result");
  const current = metadata.currentEstimate;
  if (current) {
    const identity =
      current.estimate === null
        ? null
        : estimateAttemptIdentity(current.estimate);
    if (
      (identity && identity.id !== current.attemptId) ||
      !(await matches(
        "attempt",
        current.attemptId,
        identity?.revision,
        identity?.hash,
      ))
    )
      throw new Error("stale_estimation_result");
  }
}
