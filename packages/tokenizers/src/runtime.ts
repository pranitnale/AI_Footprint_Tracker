import { TokenMeasurementSchema } from "@footprint/contracts";
import { BUNDLED_TOKENIZER_MANIFEST } from "./manifest";
import {
  DEFAULT_TOKENIZER_PROFILE_ID,
  profileFor,
  validateCountResponse,
  type CountRequest,
  type CountResponse,
  type TokenizerManifest,
} from "./protocol";

export interface CountingRuntime {
  readonly selection: Readonly<{ implementationId: string; profileId: string }>;
  readonly manifest: TokenizerManifest;
}

const selector = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(value);
const exactKeys = (value: object, names: string[]) =>
  Object.keys(value).sort().join(",") === names.sort().join(",");
const invalid = (): never => {
  throw new Error("tokenizer_manifest_invalid");
};

/** Trusted composition supplies metadata, never a worker reply or a page-selected module URL. */
export function snapshotTokenizerManifest(
  value: TokenizerManifest,
): TokenizerManifest {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !selector(value.id) ||
    !Array.isArray(value.profiles) ||
    value.profiles.length < 1 ||
    value.profiles.length > 16 ||
    (!exactKeys(value, ["id", "profiles"]) &&
      !exactKeys(value, ["id", "profiles", "count"])) ||
    ("count" in value && typeof value.count !== "function")
  )
    invalid();
  const profiles = value.profiles.map((profile) => {
    if (
      !profile ||
      typeof profile !== "object" ||
      Array.isArray(profile) ||
      !exactKeys(profile, ["profileId", "encoding", "assetHash"]) ||
      !selector(profile.profileId) ||
      !selector(profile.encoding) ||
      typeof profile.assetHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(profile.assetHash) ||
      !TokenMeasurementSchema.safeParse({
        value: "0",
        evidence: "heuristic_estimate",
        scope: "observed_text",
        completeness: "complete_for_scope",
        profile_id: profile.profileId,
        reason: "tokenizer_mapping_unverified",
      }).success
    )
      invalid();
    return Object.freeze({
      profileId: profile.profileId,
      encoding: profile.encoding,
      assetHash: profile.assetHash,
    });
  });
  if (
    new Set(profiles.map((profile) => profile.profileId)).size !==
    profiles.length
  )
    invalid();
  return Object.freeze({ id: value.id, profiles: Object.freeze(profiles) });
}

export function createCountingRuntime(
  manifest: TokenizerManifest,
  profileId: string,
): CountingRuntime {
  const snapshot = snapshotTokenizerManifest(manifest);
  if (!profileFor(snapshot, profileId)) invalid();
  return Object.freeze({
    selection: Object.freeze({ implementationId: snapshot.id, profileId }),
    manifest: snapshot,
  });
}

export function snapshotCountingRuntime(
  value: CountingRuntime,
): CountingRuntime {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !exactKeys(value, ["selection", "manifest"]) ||
    !value.selection ||
    typeof value.selection !== "object" ||
    Array.isArray(value.selection) ||
    !exactKeys(value.selection, ["implementationId", "profileId"]) ||
    value.selection.implementationId !== value.manifest?.id
  )
    invalid();
  return createCountingRuntime(value.manifest, value.selection.profileId);
}

export const DEFAULT_COUNTING_RUNTIME = createCountingRuntime(
  BUNDLED_TOKENIZER_MANIFEST,
  DEFAULT_TOKENIZER_PROFILE_ID,
);

export function validCountResponse(
  value: unknown,
  request: CountRequest,
  implementation: TokenizerManifest = BUNDLED_TOKENIZER_MANIFEST,
): value is CountResponse {
  return validateCountResponse(value, request, implementation);
}
