import {
  validFileResult,
  type AccessibleFileJob,
  type FileCountResult,
} from "@footprint/file-text/types";
import { type TokenizerManifest } from "@footprint/tokenizers/metadata";
import { PACKAGED_COUNTING_RUNTIME } from "./counting-config";
export function utf8ExtractedByteLength(bytes: ArrayBuffer): number {
  const view = new Uint8Array(bytes);
  return (
    view.byteLength -
    (view.length >= 3 &&
    view[0] === 0xef &&
    view[1] === 0xbb &&
    view[2] === 0xbf
      ? 3
      : 0)
  );
}
export function validFileReceiptResult(
  result: unknown,
  job: AccessibleFileJob,
  size: number,
  verifiedTextBytes?: number,
  manifest: TokenizerManifest = PACKAGED_COUNTING_RUNTIME.manifest,
): result is FileCountResult {
  if (
    !validFileResult(result, job, manifest) ||
    result.inputBytes !== size ||
    new Set(result.missing).size !== result.missing.length ||
    ![
      "provider_processing",
      "ocr",
      "image_encoding",
      "retrieval_selection",
    ].every((reason) => result.missing.includes(reason as any))
  )
    return false;
  if (result.status === "counted") {
    if (job.kind === "text") {
      const expected = verifiedTextBytes ?? utf8ExtractedByteLength(job.bytes);
      if (
        (verifiedTextBytes === undefined && job.bytes.byteLength !== size) ||
        !Number.isSafeInteger(expected) ||
        (expected !== size && expected !== size - 3) ||
        result.extractedTextBytes !== expected
      )
        return false;
    }
    if (
      job.kind === "text" &&
      (result.pages !== null || result.textParts !== 1)
    )
      return false;
    if (
      ["pdf", "pptx"].includes(job.kind) &&
      (result.pages === null ||
        result.pages < 1 ||
        result.textParts !== result.pages)
    )
      return false;
    if (["docx", "xlsx"].includes(job.kind) && result.pages !== null)
      return false;
    if (
      job.kind !== "text" &&
      (!result.missing.includes("layout_and_drawing_text") ||
        !result.missing.includes("rendered_visibility") ||
        result.textParts === null ||
        result.textParts < 1)
    )
      return false;
    if (
      job.kind === "xlsx" &&
      !result.missing.includes("formula_recalculation")
    )
      return false;
    if (job.kind !== "pdf" && result.missing.includes("external_font_mapping"))
      return false;
    if (job.kind !== "xlsx" && result.missing.includes("formula_recalculation"))
      return false;
    return (
      result.extractedTextBytes !== null &&
      result.textParts !== null &&
      BigInt(result.tokens!) <= BigInt(result.extractedTextBytes) &&
      (result.extractedTextBytes === 0 || BigInt(result.tokens!) > 0n)
    );
  }
  return (
    (result.status === "cancelled"
      ? result.reason === "cancelled"
      : result.reason !== "cancelled") &&
    result.extractedTextBytes === null &&
    result.pages === null &&
    result.textParts === null
  );
}
