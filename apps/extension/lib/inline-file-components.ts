import {
  ExtractedFileTextComponentSchema,
  TokenMeasurementSchema,
  type ExtractedFileTextComponent,
} from "@footprint/contracts";
import { type TokenizerManifest } from "@footprint/tokenizers/metadata";
import { PACKAGED_COUNTING_RUNTIME } from "./counting-config";

export function knownCount(
  value: unknown,
  expected: { jobId: string; revision: number } | undefined,
  byteLength: number,
  manifest: TokenizerManifest = PACKAGED_COUNTING_RUNTIME.manifest,
): value is Record<string, any> {
  if (!expected || !value || typeof value !== "object" || Array.isArray(value))
    return false;
  const result = value as Record<string, any>;
  if (
    Object.keys(result).sort().join(",") !==
      "assetHash,encoding,jobId,measurement,modelExactness,profileId,revision,status" ||
    result.jobId !== expected.jobId ||
    result.revision !== expected.revision ||
    result.status !== "counted" ||
    result.modelExactness !== "unverified"
  )
    return false;
  const profile = manifest.profiles.find(
    (profile) =>
      profile.encoding === result.encoding &&
      profile.profileId === result.profileId &&
      profile.assetHash === result.assetHash,
  );
  const measurement = TokenMeasurementSchema.safeParse(result.measurement);
  // The counting contract bounds admitted numeric results by the supplied UTF-8 byte length.
  return (
    !!profile &&
    measurement.success &&
    measurement.data.value !== null &&
    BigInt(measurement.data.value) <= BigInt(byteLength) &&
    (byteLength === 0 || BigInt(measurement.data.value) > 0n) &&
    measurement.data.scope === "observed_text" &&
    measurement.data.evidence === "heuristic_estimate" &&
    measurement.data.completeness === "complete_for_scope" &&
    measurement.data.profile_id === result.profileId &&
    measurement.data.reason === "tokenizer_mapping_unverified"
  );
}

/** IDs identify request positions, not files or their contents. Only numerical results leave this function. */
export function inlineFileComponents(
  texts: string[] | null,
  counts: unknown,
  previous: ExtractedFileTextComponent[] | null,
  componentIds: string[] = [],
  expected?: { jobId: string; revision: number },
  manifest: TokenizerManifest = PACKAGED_COUNTING_RUNTIME.manifest,
): ExtractedFileTextComponent[] | null {
  if (texts === null) return null;
  return texts.map((text, index) => {
    const prior = previous?.[index];
    const component: ExtractedFileTextComponent = {
      component_id:
        componentIds[index] ??
        (prior?.extraction_profile_id === "observed-inline-file-text-v1"
          ? prior.component_id
          : crypto.randomUUID()),
      origin: "unknown_origin",
      extraction_profile_id: "observed-inline-file-text-v1",
      page_count: null,
      tokens: {
        value: null,
        evidence: "unknown",
        scope: "extracted_file_text",
        completeness: "unknown",
        profile_id: null,
        reason: "tokenizer_unavailable",
      },
      missing: [
        "provider_processing",
        "ocr",
        "image_encoding",
        "retrieval_selection",
      ],
    };
    const counted =
      counts && typeof counts === "object" && !Array.isArray(counts)
        ? (counts as Record<string, unknown>)[`file_${index}`]
        : undefined;
    if (
      knownCount(
        counted,
        expected
          ? { ...expected, jobId: `${expected.jobId}:file_${index}` }
          : undefined,
        new TextEncoder().encode(text).byteLength,
        manifest,
      )
    ) {
      const result = ExtractedFileTextComponentSchema.safeParse({
        ...component,
        tokens: {
          value: counted.measurement.value,
          evidence: "heuristic_estimate",
          scope: "extracted_file_text",
          completeness: "complete_for_scope",
          profile_id: counted.profileId,
          reason: "tokenizer_mapping_unverified",
        },
      });
      if (result.success) return result.data;
    }
    return component;
  });
}
