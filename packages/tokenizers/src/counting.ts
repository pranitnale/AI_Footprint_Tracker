import { BUNDLED_TOKENIZER } from "./bundled";
import {
  COUNT_LIMITS,
  profileFor,
  unavailableCountResponse,
  unavailableTokenResult,
  validCountIdentity,
  validateCountRequest,
  validTokenResult,
  type CountFailureReason,
  type CountField,
  type CountRequest,
  type CountResponse,
  type TokenJob,
  type TokenResult,
  type TokenizerImplementation,
} from "./protocol";

const encoder = new TextEncoder();

// Call inside the packaged worker. No text is persisted, logged, cached or sent to a server.
export async function countText(
  job: TokenJob,
  implementation: TokenizerImplementation = BUNDLED_TOKENIZER,
): Promise<TokenResult> {
  if (
    !job ||
    typeof job !== "object" ||
    typeof job.text !== "string" ||
    (job.modelId !== null && typeof job.modelId !== "string") ||
    !validCountIdentity(job.jobId, job.revision) ||
    (job.profileId !== undefined && typeof job.profileId !== "string")
  )
    throw new Error("payload_rejected");
  return implementation.count(job);
}

export async function countFields(
  request: CountRequest,
  implementation: TokenizerImplementation = BUNDLED_TOKENIZER,
  signal?: AbortSignal,
): Promise<CountResponse> {
  try {
    validateCountRequest(request);
  } catch (error) {
    const reason =
      error instanceof Error && error.message === "capture_limit_exceeded"
        ? "capture_limit_exceeded"
        : "payload_rejected";
    return unavailableCountResponse(request, reason);
  }
  const selection = {
    implementationId: request.implementationId,
    profileId: request.profileId,
  };
  if (signal?.aborted)
    return unavailableCountResponse(request, "cancelled", selection);
  const profile = profileFor(implementation, request.profileId);
  if (request.implementationId !== implementation.id || !profile)
    return unavailableCountResponse(
      request,
      "tokenizer_unavailable",
      selection,
    );
  const entries = Object.entries(request.fields).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  const fileUnits = entries.reduce(
    (sum, [field, text]) => sum + (field.startsWith("file_") ? text.length : 0),
    0,
  );
  const counts: Partial<Record<CountField, TokenResult>> = {};
  let unavailableReason: CountFailureReason | null = null;
  for (const [field, text] of entries) {
    if (signal?.aborted)
      return unavailableCountResponse(request, "cancelled", selection);
    const job = {
      text,
      modelId: request.modelId,
      profileId: request.profileId,
      jobId: `${request.jobId}:${field}`,
      revision: request.revision,
    };
    let result: TokenResult;
    if (
      text.length > COUNT_LIMITS.fieldTextUnits ||
      encoder.encode(text).byteLength > COUNT_LIMITS.fieldTextBytes ||
      (field.startsWith("file_") &&
        fileUnits > COUNT_LIMITS.inlineFileTextUnits)
    ) {
      result = unavailableTokenResult(job, "capture_limit_exceeded");
      unavailableReason = "capture_limit_exceeded";
    } else {
      result = await countText(job, implementation);
      if (result.status !== "counted")
        unavailableReason ??= "tokenizer_unavailable";
    }
    if (signal?.aborted)
      return unavailableCountResponse(request, "cancelled", selection);
    if (!validTokenResult(result, job, profile))
      return unavailableCountResponse(
        request,
        "tokenizer_unavailable",
        selection,
      );
    counts[field as CountField] = result;
  }
  const counted = Object.values(counts).filter(
    (result) => result?.status === "counted",
  ).length;
  if (counted === 0)
    return unavailableCountResponse(
      request,
      unavailableReason ?? "tokenizer_unavailable",
      selection,
    );
  return {
    jobId: request.jobId,
    revision: request.revision,
    implementationId: request.implementationId,
    profileId: request.profileId,
    status: unavailableReason ? "partial" : "counted",
    reason: unavailableReason,
    counts,
  };
}

export function matchesTokenJob(
  result: TokenResult,
  job: Pick<TokenJob, "jobId" | "revision">,
): boolean {
  return result.jobId === job.jobId && result.revision === job.revision;
}
