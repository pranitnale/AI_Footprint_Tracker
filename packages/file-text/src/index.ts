import {
  BUNDLED_TOKENIZER,
  countText,
  profileFor,
  validTokenResult,
  type TokenizerImplementation,
} from "@footprint/tokenizers/worker";
import { extractDocx } from "./docx";
import { extractPdf } from "./pdf";
import { extractOffice } from "./office";
import {
  checkCancelled,
  EXTRACTION_PROFILE,
  fileTokenizerSelection,
  FileFailure,
  TextBudget,
  unavailable,
  validateFileJob,
  type AccessibleFileJob,
  type FileCountResult,
} from "./types";

export * from "./types";

/** Only the packaged file worker calls this. Raw data and extracted text never leave that worker. */
export async function countAccessibleFile(
  job: AccessibleFileJob,
  options: {
    signal?: AbortSignal;
    pdfWorkerSrc?: string;
    tokenizer?: TokenizerImplementation;
  } = {},
): Promise<FileCountResult> {
  validateFileJob(job);
  const inputBytes = job.bytes.byteLength;
  try {
    checkCancelled(options.signal);
    const bytes = new Uint8Array(job.bytes),
      output = new TextBudget();
    let pages: number | null = null,
      textParts = 1,
      externalFontMapping = false;
    if (job.kind === "text") {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      for (
        let position = 0;
        position < bytes.length || position === 0;
        position += 16384
      ) {
        checkCancelled(options.signal);
        try {
          output.append(
            decoder.decode(bytes.subarray(position, position + 16384), {
              stream: position + 16384 < bytes.length,
            }),
          );
        } catch (error) {
          if (error instanceof FileFailure) throw error;
          throw new FileFailure("invalid_utf8");
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    } else if (job.kind === "docx")
      textParts = await extractDocx(bytes, output, options.signal);
    else if (job.kind === "xlsx" || job.kind === "pptx") {
      textParts = await extractOffice(bytes, job.kind, output, options.signal);
      if (job.kind === "pptx") pages = textParts;
    } else {
      const pdf = await extractPdf(
        bytes,
        output,
        options.signal,
        options.pdfWorkerSrc,
      );
      pages = pdf.pages;
      textParts = pdf.pages;
      externalFontMapping = pdf.externalFontMapping;
    }
    checkCancelled(options.signal);
    const extracted = output.finish();
    if (job.kind !== "text" && !extracted.trim())
      throw new FileFailure("no_extractable_text");
    const tokenizer = options.tokenizer ?? BUNDLED_TOKENIZER;
    const selection = fileTokenizerSelection(job);
    const profile = profileFor(tokenizer, selection.profileId);
    if (tokenizer.id !== selection.implementationId || !profile)
      throw new FileFailure("tokenizer_unavailable");
    const tokenJob = {
      text: extracted,
      jobId: job.jobId,
      revision: job.revision,
      modelId: null,
      profileId: selection.profileId,
    };
    const counted = await countText(tokenJob, tokenizer);
    checkCancelled(options.signal);
    if (
      counted.status !== "counted" ||
      !validTokenResult(counted, tokenJob, profile)
    )
      throw new FileFailure("tokenizer_unavailable");
    return {
      jobId: job.jobId,
      revision: job.revision,
      kind: job.kind,
      status: "counted",
      reason: null,
      inputBytes,
      extractedTextBytes: output.size,
      pages,
      textParts,
      tokens: counted.measurement.value,
      scope: "extracted_file_text",
      tokenizerProfile: counted.profileId,
      tokenizerAssetHash: counted.assetHash,
      evidence: "heuristic_estimate",
      modelExactness: "unverified",
      extractionProfile: EXTRACTION_PROFILE,
      coverage: "complete_for_extraction_profile",
      missing: [
        "provider_processing",
        "ocr",
        "image_encoding",
        "retrieval_selection",
        ...(job.kind !== "text"
          ? ["layout_and_drawing_text" as const, "rendered_visibility" as const]
          : []),
        ...(job.kind === "xlsx" ? ["formula_recalculation" as const] : []),
        ...(externalFontMapping ? ["external_font_mapping" as const] : []),
      ],
      association: "unassociated",
      telemetryAllowed: false,
    };
  } catch (error) {
    return {
      ...unavailable(
        job,
        error instanceof FileFailure ? error.code : "malformed_file",
      ),
      inputBytes,
    };
  }
}
