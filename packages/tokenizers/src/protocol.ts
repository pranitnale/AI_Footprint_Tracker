import {
  TokenMeasurementSchema,
  unknownMeasurement,
  type TokenMeasurement,
} from "@footprint/contracts";

export const DEFAULT_TOKENIZER_IMPLEMENTATION_ID = "gpt-tokenizer-4.0.0";
export const DEFAULT_TOKENIZER_PROFILE_ID = "o200k-base-4.0.0-reference";
export const COUNT_LIMITS = Object.freeze({
  jobId: 128,
  modelId: 256,
  fieldTextUnits: 2_097_152,
  fieldTextBytes: 8 * 1024 * 1024,
  inlineFileTextUnits: 262_144,
  // Six text fields, up to 16 inline files and up to 16 other-model components.
  fields: 38,
  pendingJobs: 16,
  timeoutMs: 20_000,
});

export type CountField =
  | "input"
  | "answer"
  | "thinking"
  | "tool_input"
  | "intermediate"
  | "tool_output"
  | `file_${number}`
  | `component_${number}`;
export type CountFailureReason =
  | "payload_rejected"
  | "capture_limit_exceeded"
  | "tokenizer_unavailable"
  | "tokenizer_timeout"
  | "stale_tokenizer_response"
  | "cancelled"
  | "busy"
  | "duplicate_job"
  | "worker_unavailable";
export type TokenizerProfile = {
  profileId: string;
  encoding: string;
  assetHash: string;
};
export type TokenJob = {
  text: string;
  modelId: string | null;
  profileId?: string;
  jobId: string;
  revision: number;
};
export type TokenResult = {
  jobId: string;
  revision: number;
  measurement: TokenMeasurement;
  assetHash: string | null;
  profileId: string | null;
  encoding: string | null;
  modelExactness: "unverified";
  status: "counted" | "unavailable";
};
export interface TokenizerManifest {
  readonly id: string;
  readonly profiles: readonly TokenizerProfile[];
}
export interface TokenizerImplementation extends TokenizerManifest {
  count(job: TokenJob): Promise<TokenResult>;
}
export type CountRequest = {
  jobId: string;
  revision: number;
  modelId: string | null;
  implementationId: string;
  profileId: string;
  fields: Partial<Record<CountField, string>>;
};
export type CountResponse = {
  jobId: string;
  revision: number;
  implementationId: string | null;
  profileId: string | null;
  status: "counted" | "partial" | "unavailable" | "cancelled";
  reason: CountFailureReason | null;
  counts: Partial<Record<CountField, TokenResult>>;
};
export type CountCommand =
  | { type: "count"; request: CountRequest }
  | { type: "cancel"; jobId: string; revision: number };

const encoder = new TextEncoder();
const failureReasons = new Set<CountFailureReason>([
  "payload_rejected",
  "capture_limit_exceeded",
  "tokenizer_unavailable",
  "tokenizer_timeout",
  "stale_tokenizer_response",
  "cancelled",
  "busy",
  "duplicate_job",
  "worker_unavailable",
]);

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}
export function validCountIdentity(jobId: unknown, revision: unknown): boolean {
  return (
    typeof jobId === "string" &&
    jobId.length > 0 &&
    jobId.length <= COUNT_LIMITS.jobId &&
    !/[\u0000-\u001f\u007f]/.test(jobId) &&
    Number.isSafeInteger(revision) &&
    Number(revision) >= 1
  );
}
export function isCountField(value: string): value is CountField {
  return (
    value === "input" ||
    value === "answer" ||
    value === "thinking" ||
    value === "tool_input" ||
    value === "intermediate" ||
    value === "tool_output" ||
    /^(?:file|component)_([0-9]|1[0-5])$/.test(value)
  );
}
function validSelector(value: unknown): value is string {
  return (
    typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(value)
  );
}
export function validateCountRequest(
  value: unknown,
): asserts value is CountRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("payload_rejected");
  const request = value as CountRequest;
  if (
    !exactKeys(request, [
      "fields",
      "implementationId",
      "jobId",
      "modelId",
      "profileId",
      "revision",
    ]) ||
    !validCountIdentity(request.jobId, request.revision) ||
    (request.modelId !== null &&
      (typeof request.modelId !== "string" ||
        request.modelId.length > COUNT_LIMITS.modelId)) ||
    !validSelector(request.implementationId) ||
    !validSelector(request.profileId) ||
    !request.fields ||
    typeof request.fields !== "object" ||
    Array.isArray(request.fields)
  )
    throw new Error("payload_rejected");
  const fields = Object.entries(request.fields);
  if (fields.length < 1 || fields.length > COUNT_LIMITS.fields)
    throw new Error("payload_rejected");
  let totalUnits = 0;
  for (const [field, text] of fields) {
    if (!isCountField(field) || typeof text !== "string")
      throw new Error("payload_rejected");
    totalUnits += text.length;
  }
  // Input, answer and thinking are each bounded like one capture text; all other
  // generated text of a reply shares twice that bound (GENERATED_TEXT_LIMITS).
  if (
    totalUnits >
    5 * COUNT_LIMITS.fieldTextUnits + COUNT_LIMITS.inlineFileTextUnits
  )
    throw new Error("capture_limit_exceeded");
}
export function validateCountCommand(
  value: unknown,
): asserts value is CountCommand {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("payload_rejected");
  const command = value as CountCommand;
  if (command.type === "count") {
    if (!exactKeys(command, ["request", "type"]))
      throw new Error("payload_rejected");
    validateCountRequest(command.request);
    return;
  }
  if (
    command.type !== "cancel" ||
    !exactKeys(command, ["jobId", "revision", "type"]) ||
    !validCountIdentity(command.jobId, command.revision)
  )
    throw new Error("payload_rejected");
}

export function unavailableCountResponse(
  identity: Pick<CountRequest, "jobId" | "revision">,
  reason: CountFailureReason,
  selection: {
    implementationId?: string | null;
    profileId?: string | null;
  } = {},
): CountResponse {
  return {
    jobId: identity.jobId,
    revision: identity.revision,
    implementationId: selection.implementationId ?? null,
    profileId: selection.profileId ?? null,
    status: reason === "cancelled" ? "cancelled" : "unavailable",
    reason,
    counts: {},
  };
}
export function unavailableTokenResult(
  job: Pick<TokenJob, "jobId" | "revision">,
  reason: "tokenizer_unavailable" | "capture_limit_exceeded",
): TokenResult {
  return {
    jobId: job.jobId,
    revision: job.revision,
    measurement: unknownMeasurement(reason),
    assetHash: null,
    profileId: null,
    encoding: null,
    modelExactness: "unverified",
    status: "unavailable",
  };
}
export function profileFor(
  implementation: TokenizerManifest,
  profileId: string,
): TokenizerProfile | null {
  const matches = implementation.profiles.filter(
    (profile) => profile.profileId === profileId,
  );
  return matches.length === 1 ? matches[0] : null;
}

export function validTokenResult(
  value: unknown,
  job: TokenJob,
  profile: TokenizerProfile,
): value is TokenResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as TokenResult;
  if (
    !exactKeys(result, [
      "assetHash",
      "encoding",
      "jobId",
      "measurement",
      "modelExactness",
      "profileId",
      "revision",
      "status",
    ]) ||
    result.jobId !== job.jobId ||
    result.revision !== job.revision ||
    result.modelExactness !== "unverified"
  )
    return false;
  const measurement = TokenMeasurementSchema.safeParse(result.measurement);
  if (result.status === "counted") {
    if (
      !measurement.success ||
      measurement.data.value === null ||
      !/^(0|[1-9][0-9]*)$/.test(measurement.data.value) ||
      BigInt(measurement.data.value) >
        BigInt(encoder.encode(job.text).byteLength) ||
      (job.text.length > 0 && BigInt(measurement.data.value) === 0n)
    )
      return false;
    return (
      result.assetHash === profile.assetHash &&
      result.profileId === profile.profileId &&
      result.encoding === profile.encoding &&
      measurement.data.evidence === "heuristic_estimate" &&
      measurement.data.scope === "observed_text" &&
      measurement.data.completeness === "complete_for_scope" &&
      measurement.data.profile_id === profile.profileId &&
      measurement.data.reason === "tokenizer_mapping_unverified"
    );
  }
  return (
    result.status === "unavailable" &&
    measurement.success &&
    measurement.data.value === null &&
    measurement.data.evidence === "unknown" &&
    measurement.data.scope === "observed_text" &&
    measurement.data.completeness === "unknown" &&
    measurement.data.profile_id === null &&
    (measurement.data.reason === "tokenizer_unavailable" ||
      measurement.data.reason === "capture_limit_exceeded") &&
    result.assetHash === null &&
    result.profileId === null &&
    result.encoding === null
  );
}

export function validateCountResponse(
  value: unknown,
  request: CountRequest,
  implementation: TokenizerManifest,
): value is CountResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const response = value as CountResponse;
  if (
    !exactKeys(response, [
      "counts",
      "implementationId",
      "jobId",
      "profileId",
      "reason",
      "revision",
      "status",
    ]) ||
    response.jobId !== request.jobId ||
    response.revision !== request.revision ||
    !response.counts ||
    typeof response.counts !== "object" ||
    Array.isArray(response.counts)
  )
    return false;
  const entries = Object.entries(response.counts);
  if (response.status === "counted" || response.status === "partial") {
    const profile = profileFor(implementation, request.profileId);
    if (
      response.implementationId !== request.implementationId ||
      response.profileId !== request.profileId ||
      request.implementationId !== implementation.id ||
      !profile ||
      entries.length !== Object.keys(request.fields).length ||
      (response.status === "counted" && response.reason !== null) ||
      (response.status === "partial" &&
        response.reason !== "tokenizer_unavailable" &&
        response.reason !== "capture_limit_exceeded")
    )
      return false;
    let counted = 0;
    let unavailable = 0;
    const valid = entries.every(([field, result]) => {
      const text = request.fields[field as CountField];
      if (typeof text !== "string" || !isCountField(field)) return false;
      const job = {
        text,
        modelId: request.modelId,
        profileId: request.profileId,
        jobId: `${request.jobId}:${field}`,
        revision: request.revision,
      };
      if (!validTokenResult(result, job, profile)) return false;
      if (result.status === "counted") counted++;
      else unavailable++;
      return true;
    });
    return (
      valid &&
      (response.status === "counted"
        ? counted === entries.length
        : counted > 0 && unavailable > 0)
    );
  }
  return (
    entries.length === 0 &&
    (response.status === "unavailable" || response.status === "cancelled") &&
    typeof response.reason === "string" &&
    failureReasons.has(response.reason) &&
    (response.status === "cancelled") === (response.reason === "cancelled") &&
    (response.implementationId === null ||
      response.implementationId === request.implementationId) &&
    (response.profileId === null || response.profileId === request.profileId)
  );
}
