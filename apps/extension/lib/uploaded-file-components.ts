import {
  ExtractedFileTextComponentSchema,
  canonicalJson,
  type ExtractedFileTextComponent,
  type ReasonCode,
} from "@footprint/contracts";
import {
  EXTRACTION_PROFILE,
  type FileFailureCode,
} from "@footprint/file-text/types";
import type { Scope } from "@footprint/ledger";
import type { FileReceiptRead } from "./file-grant-broker";
import { validFileReceiptResult } from "./file-receipt-result";
import { fileUuid, validFileSpec } from "./file-relay-protocol";
import type { TokenizerManifest } from "@footprint/tokenizers/metadata";
import { PACKAGED_COUNTING_RUNTIME } from "./counting-config";
export type UploadedFileIdentity = { fileHandle: string; componentId: string };
function reason(code: FileFailureCode | null | undefined): ReasonCode {
  if (code === "timeout") return "tokenizer_timeout";
  if (
    code &&
    ["input_limit", "text_limit", "page_limit", "zip_limit"].includes(code)
  )
    return "capture_limit_exceeded";
  if (
    !code ||
    ["busy", "worker_unavailable", "tokenizer_unavailable"].includes(code)
  )
    return "tokenizer_unavailable";
  return "partial_capture";
}
/** Only validated numeric receipts are projected. Local handle-to-component identity never enters the observation. */
export function uploadedFileComponent(
  fileHandle: string,
  componentId: string,
  receipt: FileReceiptRead,
  scope: Scope,
  dispatchedAt: string,
  manifest: TokenizerManifest = PACKAGED_COUNTING_RUNTIME.manifest,
): ExtractedFileTextComponent | null {
  if (
    !fileUuid(fileHandle) ||
    !fileUuid(componentId) ||
    !receipt.basis ||
    !receipt.spec ||
    !validFileSpec(receipt.spec) ||
    receipt.spec.fileHandle !== fileHandle ||
    !fileUuid(receipt.spec.jobId) ||
    receipt.spec.revision !== 1 ||
    typeof receipt.validNow !== "function" ||
    !receipt.validNow() ||
    canonicalJson(receipt.basis.scope) !== canonicalJson(scope) ||
    receipt.observedAt === null ||
    !Number.isSafeInteger(receipt.observedAt) ||
    receipt.observedAt < receipt.basis.ownershipStart ||
    receipt.observedAt > Date.parse(dispatchedAt) ||
    receipt.status === "expired" ||
    receipt.status === "pending"
  )
    return null;
  const result = receipt.result;
  if (result) {
    if (
      (receipt.status === "complete") !== (result.status === "counted") ||
      !validFileReceiptResult(
        result,
        {
          jobId: receipt.spec.jobId,
          revision: 1,
          kind: receipt.spec.kind,
          bytes: new ArrayBuffer(0),
          tokenizerImplementationId: receipt.spec.tokenizerImplementationId,
          tokenizerProfileId: receipt.spec.tokenizerProfileId,
        },
        receipt.spec.size,
        receipt.spec.textBytes ?? undefined,
        manifest,
      )
    )
      return null;
  } else return null;
  const known = result?.status === "counted";
  const missing: ExtractedFileTextComponent["missing"] = result
    ? [...result.missing]
    : [
        "provider_processing",
        "ocr",
        "image_encoding",
        "retrieval_selection",
        ...(receipt.spec.kind !== "text"
          ? ["layout_and_drawing_text" as const, "rendered_visibility" as const]
          : []),
        ...(receipt.spec.kind === "xlsx"
          ? ["formula_recalculation" as const]
          : []),
      ];
  const component: ExtractedFileTextComponent = {
    component_id: componentId,
    origin: "new_upload",
    extraction_profile_id: EXTRACTION_PROFILE,
    page_count: known ? result.pages : null,
    tokens: known
      ? {
          value: result.tokens,
          evidence: "heuristic_estimate",
          scope: "extracted_file_text",
          completeness: "complete_for_scope",
          profile_id: result.tokenizerProfile as any,
          reason: "tokenizer_mapping_unverified",
        }
      : {
          value: null,
          evidence: "unknown",
          scope: "extracted_file_text",
          completeness: "unknown",
          profile_id: null,
          reason: reason(result?.reason),
        },
    missing,
  };
  const parsed = ExtractedFileTextComponentSchema.safeParse(component);
  return parsed.success ? parsed.data : null;
}
