import {
  EcoLogitsFallbackPolicySchema,
  EngineIdSchema,
  EnginePreferenceRecordSchema,
  type EcoLogitsFallbackPolicy,
  type EngineId,
  type EnginePreferenceRecord,
  type SelectionBasis,
  type UpstreamProfileReference,
} from "@footprint/contracts";
import { deepFreeze } from "./bundle";

export type EngineChoice =
  | {
      status: "selected";
      engine: EngineId;
      preference: EnginePreferenceRecord | null;
    }
  | {
      status: "unavailable";
      reason: "invalid_preference" | "engine_unavailable";
    };

/** Preference is installation-owned; a build default cannot overwrite an explicit choice. */
export function resolveEngineChoice(
  buildDefault: EngineId,
  storedPreference: unknown,
  available: readonly EngineId[] = ["original", "ecologits"],
): EngineChoice {
  const defaultResult = EngineIdSchema.safeParse(buildDefault);
  if (!defaultResult.success)
    return { status: "unavailable", reason: "engine_unavailable" };
  const parsed =
    storedPreference === null || storedPreference === undefined
      ? null
      : EnginePreferenceRecordSchema.safeParse(storedPreference);
  if (parsed && !parsed.success)
    return { status: "unavailable", reason: "invalid_preference" };
  const preference = parsed?.data ?? null;
  const engine =
    !preference || preference.preference === "build_default"
      ? defaultResult.data
      : preference.preference;
  return available.includes(engine)
    ? { status: "selected", engine, preference }
    : { status: "unavailable", reason: "engine_unavailable" };
}

export type ModelProfileResolution =
  | {
      kind: "upstream";
      selection: "direct_mapping" | "model_override" | "provider_flagship";
      profile: UpstreamProfileReference;
      basis: SelectionBasis;
    }
  | {
      kind: "original";
      reason: "model_override" | "provider_policy" | "unknown_provider_policy";
    }
  | {
      kind: "unavailable";
      reason:
        | "profile_absent"
        | "provider_unknown"
        | "model_override"
        | "provider_policy"
        | "model_provider_conflict"
        | "unsupported_workload";
    };

export interface ProfileCatalog {
  has(profile: UpstreamProfileReference): boolean;
}
export type DirectModelMappings = Readonly<
  Record<string, UpstreamProfileReference>
>;

function own<T>(
  record: Readonly<Record<string, T>>,
  key: string | null,
): T | undefined {
  return key !== null && Object.hasOwn(record, key) ? record[key] : undefined;
}

/** No ranking by date/name/energy and no implicit switch to a different provider. */
export function resolveModelProfile(
  input: {
    modelId: string | null;
    provider: string | null;
    workload: "text" | "video";
  },
  directMappings: DirectModelMappings,
  policy: Readonly<EcoLogitsFallbackPolicy>,
  catalog: ProfileCatalog,
): ModelProfileResolution {
  const choose = (
    profile: UpstreamProfileReference,
    selection: "direct_mapping" | "model_override" | "provider_flagship",
    basis: SelectionBasis,
  ): ModelProfileResolution => {
    if (profile.workload !== input.workload)
      return { kind: "unavailable", reason: "unsupported_workload" };
    if (input.provider !== null && profile.provider !== input.provider)
      return { kind: "unavailable", reason: "model_provider_conflict" };
    if (!catalog.has(profile))
      return { kind: "unavailable", reason: "profile_absent" };
    return { kind: "upstream", selection, profile: { ...profile }, basis };
  };
  // A family benchmark stands in for a model the site did not name, or for a label the
  // registry does not know yet; Details names which of the two applies.
  const benchmarkBasis: SelectionBasis =
    input.modelId === null ? "model_not_named" : "model_not_in_library";
  const override = own(policy.model_overrides, input.modelId);
  if (override) {
    if (override.strategy === "original_engine")
      return { kind: "original", reason: "model_override" };
    if (override.strategy === "unavailable")
      return { kind: "unavailable", reason: "model_override" };
    return choose(override.profile, "model_override", override.basis);
  }
  const direct = own(directMappings, input.modelId);
  if (direct && catalog.has(direct))
    return choose(direct, "direct_mapping", "exact_record");
  const fallback = own(policy.provider_defaults, input.provider);
  if (!fallback) {
    const unknown = policy.unknown_provider;
    if (unknown.strategy === "original_engine")
      return { kind: "original", reason: "unknown_provider_policy" };
    if (unknown.strategy === "unavailable")
      return { kind: "unavailable", reason: "provider_unknown" };
    // An explicit benchmark profile for sites whose host provider is not identified.
    return choose(unknown.profile, "provider_flagship", benchmarkBasis);
  }
  if (fallback.strategy === "original_engine")
    return { kind: "original", reason: "provider_policy" };
  if (fallback.strategy === "unavailable")
    return { kind: "unavailable", reason: "provider_policy" };
  return choose(fallback.profile, "provider_flagship", benchmarkBasis);
}

export function validateProfilePolicy(
  input: unknown,
  catalog: ProfileCatalog,
  requiredProviders: readonly string[],
): Readonly<EcoLogitsFallbackPolicy> {
  const policy = EcoLogitsFallbackPolicySchema.parse(input);
  if (
    requiredProviders.some(
      (provider) => !Object.hasOwn(policy.provider_defaults, provider),
    )
  ) {
    throw new Error("method_update_invalid");
  }
  for (const rule of [
    ...Object.values(policy.provider_defaults),
    ...Object.values(policy.model_overrides),
    policy.unknown_provider,
  ]) {
    if ("profile" in rule && !catalog.has(rule.profile))
      throw new Error("method_update_invalid");
  }
  // Snapshot policy at admission so asynchronous work cannot observe an in-place edit.
  return deepFreeze(policy);
}
