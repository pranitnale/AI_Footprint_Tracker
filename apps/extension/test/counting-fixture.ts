import {
  BUNDLED_TOKENIZER,
  countFields,
  profileFor,
  unavailableCountResponse,
  type CountRequest,
  type CountResponse,
} from "@footprint/tokenizers";

export function countWithBundledTokenizer(
  request: CountRequest,
  signal?: AbortSignal,
): Promise<CountResponse> {
  return countFields(request, undefined, signal);
}

export async function unavailableCount(
  request: CountRequest,
): Promise<CountResponse> {
  return unavailableCountResponse(request, "tokenizer_unavailable", {
    implementationId: request.implementationId,
    profileId: request.profileId,
  });
}

/** Keeps legacy test magnitudes while returning the strict production DTO. */
export async function countByTextLength(
  request: CountRequest,
): Promise<CountResponse> {
  return countWithValue(request, (text) => text.length);
}

async function countWithValue(
  request: CountRequest,
  value: (text: string) => number,
): Promise<CountResponse> {
  const profile = profileFor(BUNDLED_TOKENIZER, request.profileId);
  if (!profile || request.implementationId !== BUNDLED_TOKENIZER.id)
    return unavailableCount(request);
  return {
    jobId: request.jobId,
    revision: request.revision,
    implementationId: request.implementationId,
    profileId: request.profileId,
    status: "counted",
    reason: null,
    counts: Object.fromEntries(
      Object.entries(request.fields).map(([field, text]) => [
        field,
        {
          jobId: `${request.jobId}:${field}`,
          revision: request.revision,
          measurement: {
            value: String(value(text!)),
            scope: "observed_text",
            evidence: "heuristic_estimate",
            completeness: "complete_for_scope",
            profile_id: request.profileId as
              "o200k-base-4.0.0-reference" | "cl100k-base-4.0.0-reference",
            reason: "tokenizer_mapping_unverified",
          },
          profileId: request.profileId,
          assetHash: profile.assetHash,
          encoding: profile.encoding,
          modelExactness: "unverified",
          status: "counted",
        },
      ]),
    ),
  };
}
