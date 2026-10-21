import {
  BUNDLED_TOKENIZER_MANIFEST,
  DEFAULT_TOKENIZER_IMPLEMENTATION_ID,
  DEFAULT_TOKENIZER_PROFILE_ID,
  profileFor,
  type TokenizerManifest,
  type CountingRuntime,
} from "@footprint/tokenizers/metadata";

export const FILE_LIMITS = Object.freeze({
  inputBytes: 25 * 1024 * 1024,
  textBytes: 8 * 1024 * 1024,
  pages: 200,
  zipEntries: 512,
  zipExpandedBytes: 32 * 1024 * 1024,
  zipEntryBytes: 8 * 1024 * 1024,
  zipRatio: 200,
  xmlDepth: 128,
  cells: 50000,
  sheets: 64,
  timeoutMs: 30_000,
});

export type FileKind = "text" | "pdf" | "docx" | "xlsx" | "pptx";
export type FileFailureCode =
  | "invalid_job"
  | "input_limit"
  | "text_limit"
  | "page_limit"
  | "zip_limit"
  | "unsupported_file"
  | "encrypted_file"
  | "malformed_file"
  | "truncated_file"
  | "invalid_utf8"
  | "unsafe_xml"
  | "macros_unsupported"
  | "no_extractable_text"
  | "cancelled"
  | "timeout"
  | "busy"
  | "worker_unavailable"
  | "tokenizer_unavailable";
export class FileFailure extends Error {
  constructor(public readonly code: FileFailureCode) {
    super(code);
  }
}
export interface AccessibleFileJob {
  jobId: string;
  revision: number;
  kind: FileKind;
  bytes: ArrayBuffer;
  tokenizerImplementationId?: string;
  tokenizerProfileId?: string;
}
export interface FileCountResult {
  jobId: string;
  revision: number;
  kind: FileKind;
  status: "counted" | "unavailable" | "cancelled";
  reason: FileFailureCode | null;
  inputBytes: number;
  extractedTextBytes: number | null;
  pages: number | null;
  textParts: number | null;
  tokens: string | null;
  scope: "extracted_file_text";
  tokenizerProfile: string | null;
  tokenizerAssetHash: string | null;
  evidence: "heuristic_estimate" | "unknown";
  modelExactness: "unverified";
  extractionProfile: string;
  coverage: "complete_for_extraction_profile" | "unavailable";
  missing: Array<
    | "provider_processing"
    | "ocr"
    | "image_encoding"
    | "retrieval_selection"
    | "layout_and_drawing_text"
    | "rendered_visibility"
    | "formula_recalculation"
    | "external_font_mapping"
  >;
  association: "unassociated";
  telemetryAllowed: false;
}
export const EXTRACTION_PROFILE = "local-file-text-utf8-pdfjs6.3.289-opc-v1";
export function fileTokenizerSelection(
  job: AccessibleFileJob,
  fallback: CountingRuntime["selection"] = {
    implementationId: DEFAULT_TOKENIZER_IMPLEMENTATION_ID,
    profileId: DEFAULT_TOKENIZER_PROFILE_ID,
  },
) {
  return {
    implementationId:
      job.tokenizerImplementationId ?? fallback.implementationId,
    profileId: job.tokenizerProfileId ?? fallback.profileId,
  };
}
export function withFileTokenizerSelection(
  job: AccessibleFileJob,
  counting: CountingRuntime,
): AccessibleFileJob {
  const selection = fileTokenizerSelection(job, counting.selection);
  return {
    ...job,
    tokenizerImplementationId: selection.implementationId,
    tokenizerProfileId: selection.profileId,
  };
}
export function validateFileJob(
  value: unknown,
): asserts value is AccessibleFileJob {
  if (!value || typeof value !== "object") throw new FileFailure("invalid_job");
  const job = value as AccessibleFileJob;
  if (
    ![
      "bytes,jobId,kind,revision",
      "bytes,jobId,kind,revision,tokenizerImplementationId,tokenizerProfileId",
    ].includes(Object.keys(job).sort().join(",")) ||
    typeof job.jobId !== "string" ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(job.jobId) ||
    !Number.isSafeInteger(job.revision) ||
    job.revision < 1 ||
    !["text", "pdf", "docx", "xlsx", "pptx"].includes(job.kind) ||
    !(job.bytes instanceof ArrayBuffer) ||
    (job.tokenizerImplementationId !== undefined &&
      (typeof job.tokenizerImplementationId !== "string" ||
        !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(job.tokenizerImplementationId))) ||
    (job.tokenizerProfileId !== undefined &&
      (typeof job.tokenizerProfileId !== "string" ||
        !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(job.tokenizerProfileId)))
  )
    throw new FileFailure("invalid_job");
  if (job.bytes.byteLength > FILE_LIMITS.inputBytes)
    throw new FileFailure("input_limit");
}
export function unavailable(
  job: Pick<AccessibleFileJob, "jobId" | "revision" | "kind"> & {
    bytes?: ArrayBuffer;
  },
  reason: FileFailureCode,
): FileCountResult {
  return {
    jobId: job.jobId,
    revision: job.revision,
    kind: job.kind,
    status: reason === "cancelled" ? "cancelled" : "unavailable",
    reason,
    inputBytes: job.bytes?.byteLength ?? 0,
    extractedTextBytes: null,
    pages: null,
    textParts: null,
    tokens: null,
    scope: "extracted_file_text",
    tokenizerProfile: null,
    tokenizerAssetHash: null,
    evidence: "unknown",
    modelExactness: "unverified",
    extractionProfile: EXTRACTION_PROFILE,
    coverage: "unavailable",
    missing: [
      "provider_processing",
      "ocr",
      "image_encoding",
      "retrieval_selection",
    ],
    association: "unassociated",
    telemetryAllowed: false,
  };
}
export function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new FileFailure("cancelled");
}
export function validFileResult(
  value: unknown,
  job: AccessibleFileJob,
  tokenizer: TokenizerManifest = BUNDLED_TOKENIZER_MANIFEST,
): value is FileCountResult {
  if (!value || typeof value !== "object") return false;
  const result = value as FileCountResult;
  const keys = Object.keys(unavailable(job, "worker_unavailable"))
    .sort()
    .join(",");
  const missing = [
    "provider_processing",
    "ocr",
    "image_encoding",
    "retrieval_selection",
    "layout_and_drawing_text",
    "rendered_visibility",
    "formula_recalculation",
    "external_font_mapping",
  ];
  if (
    Object.keys(result).sort().join(",") !== keys ||
    result.jobId !== job.jobId ||
    result.revision !== job.revision ||
    result.kind !== job.kind ||
    result.scope !== "extracted_file_text" ||
    result.association !== "unassociated" ||
    result.telemetryAllowed !== false ||
    result.modelExactness !== "unverified" ||
    result.extractionProfile !== EXTRACTION_PROFILE ||
    !Number.isSafeInteger(result.inputBytes) ||
    result.inputBytes < 0 ||
    result.inputBytes > FILE_LIMITS.inputBytes ||
    !Array.isArray(result.missing) ||
    result.missing.length > missing.length ||
    result.missing.some((reason) => !missing.includes(reason))
  )
    return false;
  for (const [number, max] of [
    [result.extractedTextBytes, FILE_LIMITS.textBytes],
    [result.pages, FILE_LIMITS.pages],
    [result.textParts, FILE_LIMITS.zipEntries],
  ])
    if (
      number !== null &&
      (!Number.isSafeInteger(number) || number! < 0 || number! > max!)
    )
      return false;
  const selection = fileTokenizerSelection(job);
  const tokenizerProfile = profileFor(tokenizer, selection.profileId);
  if (result.status === "counted")
    return (
      result.reason === null &&
      typeof result.tokens === "string" &&
      /^(0|[1-9][0-9]{0,7})$/.test(result.tokens) &&
      Number(result.tokens) <= FILE_LIMITS.textBytes &&
      tokenizer.id === selection.implementationId &&
      tokenizerProfile !== null &&
      result.tokenizerProfile === selection.profileId &&
      result.tokenizerAssetHash === tokenizerProfile.assetHash &&
      result.evidence === "heuristic_estimate" &&
      result.coverage === "complete_for_extraction_profile"
    );
  return (
    ["unavailable", "cancelled"].includes(result.status) &&
    result.tokens === null &&
    result.tokenizerProfile === null &&
    result.tokenizerAssetHash === null &&
    result.evidence === "unknown" &&
    result.coverage === "unavailable" &&
    [
      "invalid_job",
      "input_limit",
      "text_limit",
      "page_limit",
      "zip_limit",
      "unsupported_file",
      "encrypted_file",
      "malformed_file",
      "truncated_file",
      "invalid_utf8",
      "unsafe_xml",
      "macros_unsupported",
      "no_extractable_text",
      "cancelled",
      "timeout",
      "busy",
      "worker_unavailable",
      "tokenizer_unavailable",
    ].includes(result.reason ?? "")
  );
}
export class TextBudget {
  private pieces: string[] = [];
  size = 0;
  append(text: string) {
    this.size += new TextEncoder().encode(text).byteLength;
    if (this.size > FILE_LIMITS.textBytes) throw new FileFailure("text_limit");
    this.pieces.push(text);
  }
  finish() {
    return this.pieces.join("");
  }
}
