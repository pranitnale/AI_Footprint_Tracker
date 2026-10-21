import {
  EngineBuildConfigurationSchema,
  EngineMethodIdentitySchema,
  EcoLogitsMethodDefinitionSchema,
  MediaPolicySchema,
  ModelMappingsSchema,
  payloadHash,
  type EcoLogitsMethodDefinition,
  type EngineBuildConfiguration,
  type EngineMethodIdentity,
  type MediaPolicy,
  type ModelMappings,
  type Site,
} from "@footprint/contracts";
import { ECOLOGITS_IDENTITY } from "@footprint/ecologits-core/identity";
import {
  BASELINE_BUNDLE,
  BASELINE_METHOD_ID,
  BASELINE_METHOD_HASH,
  deepFreeze,
} from "../bundle";

export const DIRECTLY_IDENTIFIED_PROVIDERS = [
  "openai",
  "anthropic",
  "google_genai",
] as const;
/** Perplexity serves models of many vendors, so its replies name no provider by site. */
export function observedProvider(site: Site): string | null {
  return site === "chatgpt"
    ? "openai"
    : site === "claude"
      ? "anthropic"
      : site === "gemini" || site === "notebooklm"
        ? "google_genai"
        : null;
}

export const ORIGINAL_METHOD_IDENTITY: Readonly<EngineMethodIdentity> =
  deepFreeze(
    EngineMethodIdentitySchema.parse({
      engine_id: "original",
      implementation_version: BASELINE_BUNDLE.equation_id,
      method_id: BASELINE_METHOD_ID,
      method_hash: BASELINE_METHOD_HASH,
      source_version: null,
      source_commit: null,
      catalog_hash: payloadHash(BASELINE_BUNDLE.profiles),
      profile_policy_hash: payloadHash(BASELINE_BUNDLE.profiles),
      environment_policy_hash: payloadHash(BASELINE_BUNDLE.scenario),
      product_scope: "operational-only",
    }),
  );

export interface MethodRegistry {
  readonly build: Readonly<EngineBuildConfiguration>;
  readonly mappings: Readonly<ModelMappings>;
  readonly media: Readonly<MediaPolicy>;
  readonly ecoDefinition: Readonly<EcoLogitsMethodDefinition>;
  readonly original: Readonly<EngineMethodIdentity>;
  readonly ecologits: Readonly<EngineMethodIdentity>;
  get(methodId: string): Readonly<EngineMethodIdentity> | null;
}

/** The build default is a preference, so it is intentionally outside the scientific method hash. */
export function createMethodRegistry(
  buildInput: unknown,
  mappingsInput: unknown,
  mediaInput: unknown,
): MethodRegistry {
  const build = deepFreeze(EngineBuildConfigurationSchema.parse(buildInput));
  const mappings = deepFreeze(ModelMappingsSchema.parse(mappingsInput));
  const media = deepFreeze(MediaPolicySchema.parse(mediaInput));
  const definition = deepFreeze(
    EcoLogitsMethodDefinitionSchema.parse({
      schema_version: "1.0.0",
      engine_id: "ecologits",
      core: ECOLOGITS_IDENTITY,
      mappings,
      fallback: build.ecologits_fallback,
      media,
      product_policy: "operational-only-output-1",
      latency_policy: "observed-live-then-history-then-modeled-1",
      environment_policy: "upstream-provider-default-assumed",
      water_total_policy: "upstream-wcf-1",
      original_fallback: {
        method_id: BASELINE_METHOD_ID,
        method_hash: BASELINE_METHOD_HASH,
      },
    }),
  );
  const methodHash = payloadHash(definition);
  const ecologits = deepFreeze(
    EngineMethodIdentitySchema.parse({
      engine_id: "ecologits",
      implementation_version: definition.core.core_version,
      method_id: `ecologits-${definition.core.upstream_version}-${methodHash}`,
      method_hash: methodHash,
      source_version: definition.core.upstream_version,
      source_commit: definition.core.requested_git_commit,
      catalog_hash: definition.core.catalog_sha256,
      profile_policy_hash: payloadHash({
        mappings: definition.mappings,
        fallback: definition.fallback,
        media: definition.media,
      }),
      environment_policy_hash: payloadHash({
        catalog: definition.core.catalog_sha256,
        environment: definition.environment_policy,
        water: definition.water_total_policy,
      }),
      product_scope: "operational-only",
    }),
  );
  return Object.freeze({
    build,
    mappings,
    media,
    ecoDefinition: definition,
    original: ORIGINAL_METHOD_IDENTITY,
    ecologits,
    get(methodId: string) {
      return methodId === ORIGINAL_METHOD_IDENTITY.method_id
        ? ORIGINAL_METHOD_IDENTITY
        : methodId === ecologits.method_id
          ? ecologits
          : null;
    },
  });
}
