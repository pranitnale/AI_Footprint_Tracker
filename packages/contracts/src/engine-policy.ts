import { z } from "zod";
import {
  InstantSchema,
  MethodIdentifierSchema,
  OpaqueKeySchema,
} from "./scalars";

export const EngineIdSchema = z.enum(["original", "ecologits"]);
export type EngineId = z.infer<typeof EngineIdSchema>;
/** Records unavailable admission without proposing a different calculation or changing legacy null semantics. */
export const UNAVAILABLE_ADMISSION_METHOD_ID = "unavailable-admission-v1";
export const EnginePreferenceSchema = z.enum([
  "build_default",
  "original",
  "ecologits",
]);
export type EnginePreference = z.infer<typeof EnginePreferenceSchema>;
export const SelectionRevisionSchema = z.number().int().min(1).max(2147483647);

export const ProviderIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
export const UpstreamModelIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,191}$/);
export const UpstreamProfileReferenceSchema = z.strictObject({
  provider: ProviderIdSchema,
  model_name: UpstreamModelIdSchema,
  workload: z.enum(["text", "video"]),
});
const originalFallback = z.strictObject({
  strategy: z.literal("original_engine"),
});
const unavailableFallback = z.strictObject({
  strategy: z.literal("unavailable"),
});
const flagshipFallback = z.strictObject({
  strategy: z.literal("upstream_provider_flagship"),
  profile: UpstreamProfileReferenceSchema,
});
export const ProviderFallbackSchema = z.discriminatedUnion("strategy", [
  flagshipFallback,
  originalFallback,
  unavailableFallback,
]);
/** Why an override stands in for a model; an exact record is a direct binding instead. */
export const OverrideBasisSchema = z.enum([
  "nearest_record",
  "family_benchmark",
  "model_not_named",
  "model_not_in_library",
  // The highest version of the same family in the catalog, for a version not listed yet.
  "model_family_stand_in",
  // The highest version of the same variant (GPT Pro, Gemini Pro Image) for a variant not listed.
  "model_variant_stand_in",
  // The highest model of the same kind and vendor when the catalog has no record of the variant.
  "model_kind_stand_in",
]);
export const ModelOverrideSchema = z.discriminatedUnion("strategy", [
  z.strictObject({
    strategy: z.literal("upstream_profile"),
    profile: UpstreamProfileReferenceSchema,
    basis: OverrideBasisSchema,
  }),
  originalFallback,
  unavailableFallback,
]);
export type ModelOverride = z.infer<typeof ModelOverrideSchema>;
export const EcoLogitsFallbackPolicySchema = z
  .strictObject({
    policy_version: MethodIdentifierSchema,
    review_date: z.iso.date(),
    provider_defaults: z.record(ProviderIdSchema, ProviderFallbackSchema),
    model_overrides: z.record(MethodIdentifierSchema, ModelOverrideSchema),
    /** A site without an identified provider may name one explicit benchmark profile. */
    unknown_provider: z.discriminatedUnion("strategy", [
      flagshipFallback,
      originalFallback,
      unavailableFallback,
    ]),
  })
  .superRefine((policy, context) => {
    if (
      Object.keys(policy.provider_defaults).length > 64 ||
      Object.keys(policy.model_overrides).length > 4096
    ) {
      context.addIssue({
        code: "custom",
        message: "Policy exceeds its entry limit",
      });
    }
    for (const [provider, fallback] of Object.entries(
      policy.provider_defaults,
    )) {
      if (
        fallback.strategy === "upstream_provider_flagship" &&
        fallback.profile.provider !== provider
      ) {
        context.addIssue({
          code: "custom",
          message: "A provider flagship must belong to that provider",
          path: ["provider_defaults", provider],
        });
      }
    }
  });
export type EcoLogitsFallbackPolicy = z.infer<
  typeof EcoLogitsFallbackPolicySchema
>;
export type UpstreamProfileReference = z.infer<
  typeof UpstreamProfileReferenceSchema
>;

export const ModelMappingsSchema = z.strictObject({
  schema_version: z.literal("1.0.0"),
  review_date: z.iso.date(),
  mapping_basis: z.literal("consumer_to_api_assumption"),
  source: z.url(),
  bindings: z
    .record(MethodIdentifierSchema, UpstreamProfileReferenceSchema)
    .refine(
      (bindings) => Object.keys(bindings).length <= 4096,
      "Too many mappings",
    ),
});
export type ModelMappings = z.infer<typeof ModelMappingsSchema>;

const SiteKeySchema = z.enum([
  "chatgpt",
  "claude",
  "gemini",
  "perplexity",
  "notebooklm",
]);
const PositiveDecimalSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,6})(\.[0-9]{1,9})?$/)
  .refine((value) => Number(value) > 0, "Coefficient must be positive");
/** One value or a min/max range, as EcoLogits' provider configurations give PUE and WUE. */
const DataCentreFactorSchema = z.union([
  PositiveDecimalSchema,
  z
    .strictObject({ min: PositiveDecimalSchema, max: PositiveDecimalSchema })
    .refine(
      (factor) => Number(factor.min) <= Number(factor.max),
      "Range minimum exceeds its maximum",
    ),
]);
/**
 * The factor that turns a count of Claude text made with the tracker's own tokenizer into
 * Claude's own count (owner decision of 15 October 2026). It was measured with Anthropic's
 * `messages.count_tokens` on the repository's 400 synthetic texts
 * (`calibration/tokenizer-golden.json`, `calibration/anthropic/calibrate.py`): the API count
 * less the 8 tokens Anthropic adds to every message, against the o200k count of the same
 * text. Claude Sonnet 5.5, Opus 5.5, Haiku 5.5 and Fable 5.1 gave identical counts; the
 * ratio was 1.63 for English, 1.97 for German, 1.43 for code, 1.35 for numbers and 1.56
 * over all texts. The owner chose one factor over one per kind of text. It applies only to
 * counts of the named tokenizer profile, never to counts a provider reports.
 */
export const ClaudeTokenFactorSchema = z.strictObject({
  factor: PositiveDecimalSchema,
  tokenizer_profile_id: z.literal("o200k-base-4.0.0-reference"),
  measured_on: z.iso.date(),
  source: z.url(),
});
export type ClaudeTokenFactor = z.infer<typeof ClaudeTokenFactorSchema>;
const VideoSettingsSchema = z.strictObject({
  width: z.number().int().min(1).max(65536),
  height: z.number().int().min(1).max(65536),
  duration_seconds: PositiveDecimalSchema,
  with_audio: z.boolean(),
});
/**
 * Coefficients of the generated-media methods. They are versioned data bound into the
 * method hash, so a changed figure is a new method rather than a silent edit.
 */
export const MediaPolicySchema = z.strictObject({
  schema_version: z.literal("1.0.0"),
  review_date: z.iso.date(),
  image: z.strictObject({
    method_id: MethodIdentifierSchema,
    it_energy_wh_per_image: PositiveDecimalSchema,
    source: z.url(),
    model_providers: z.record(MethodIdentifierSchema, ProviderIdSchema),
    site_providers: z.partialRecord(SiteKeySchema, ProviderIdSchema),
  }),
  speech: z.strictObject({
    method_id: MethodIdentifierSchema,
    profile: UpstreamProfileReferenceSchema,
    tokens_per_second: z.record(ProviderIdSchema, PositiveDecimalSchema),
    characters_per_second: PositiveDecimalSchema,
    site_providers: z.partialRecord(SiteKeySchema, ProviderIdSchema),
    source: z.url(),
  }),
  video: z.strictObject({
    method_id: MethodIdentifierSchema,
    // The registry model that stands in when the page shows a video but names no model.
    site_models: z.partialRecord(SiteKeySchema, MethodIdentifierSchema),
    site_defaults: z.partialRecord(SiteKeySchema, VideoSettingsSchema),
    model_defaults: z.record(UpstreamModelIdSchema, VideoSettingsSchema),
    source: z.url(),
  }),
  overview: z.strictObject({
    method_id: MethodIdentifierSchema,
    seconds_per_illustration: PositiveDecimalSchema,
  }),
  // A model served away from its catalog provider's data centres takes the grid and, when
  // given, the PUE and WUE of where it runs. Factors replace the provider's for that model only.
  environment_overrides: z.record(
    MethodIdentifierSchema,
    z
      .strictObject({
        electricity_mix_zone: z.string().regex(/^[A-Z]{3}$/),
        datacenter_pue: DataCentreFactorSchema.optional(),
        datacenter_wue: DataCentreFactorSchema.optional(),
      })
      .refine(
        (override) =>
          override.datacenter_pue === undefined ||
          Number(
            typeof override.datacenter_pue === "string"
              ? override.datacenter_pue
              : override.datacenter_pue.min,
          ) >= 1,
        "PUE cannot be below 1",
      ),
  ),
  // Optional, so method definitions saved before 15 October 2026 stay readable: a method
  // without it estimates Claude text from the tokenizer's count unchanged.
  claude_token_factor: ClaudeTokenFactorSchema.optional(),
});
export type MediaPolicy = z.infer<typeof MediaPolicySchema>;

export const EcoLogitsCoreIdentitySchema = z.strictObject({
  catalog_schema: MethodIdentifierSchema,
  catalog_sha256: OpaqueKeySchema,
  converter_version: MethodIdentifierSchema,
  core_sha256: OpaqueKeySchema,
  core_version: MethodIdentifierSchema,
  requested_git_commit: z.string().regex(/^[a-f0-9]{40}$/),
  source_artifact_sha256: OpaqueKeySchema,
  upstream_version: MethodIdentifierSchema,
});
export const EcoLogitsMethodDefinitionSchema = z.strictObject({
  schema_version: z.literal("1.0.0"),
  engine_id: z.literal("ecologits"),
  core: EcoLogitsCoreIdentitySchema,
  mappings: ModelMappingsSchema,
  fallback: EcoLogitsFallbackPolicySchema,
  media: MediaPolicySchema,
  product_policy: z.literal("operational-only-output-1"),
  latency_policy: z.literal("observed-live-then-history-then-modeled-1"),
  environment_policy: z.literal("upstream-provider-default-assumed"),
  water_total_policy: z.literal("upstream-wcf-1"),
  original_fallback: z.strictObject({
    method_id: MethodIdentifierSchema,
    method_hash: OpaqueKeySchema,
  }),
});
export type EcoLogitsMethodDefinition = z.infer<
  typeof EcoLogitsMethodDefinitionSchema
>;

export const EngineBuildConfigurationSchema = z.strictObject({
  schema_version: z.literal("1.0.0"),
  default_engine: EngineIdSchema,
  // Keep historical research configurations readable after retiring the Original engine.
  available_engines: z.union([
    z.tuple([z.literal("ecologits")]),
    z.tuple([z.literal("original"), z.literal("ecologits")]),
  ]),
  ecologits_fallback: EcoLogitsFallbackPolicySchema,
});
export type EngineBuildConfiguration = z.infer<
  typeof EngineBuildConfigurationSchema
>;

export const EnginePreferenceRecordSchema = z.strictObject({
  schema_version: z.literal("1.0.0"),
  preference: EnginePreferenceSchema,
  selection_revision: SelectionRevisionSchema,
  updated_at: InstantSchema,
});
export type EnginePreferenceRecord = z.infer<
  typeof EnginePreferenceRecordSchema
>;

export const EngineMethodIdentitySchema = z.strictObject({
  engine_id: EngineIdSchema,
  implementation_version: MethodIdentifierSchema,
  method_id: MethodIdentifierSchema,
  method_hash: OpaqueKeySchema,
  source_version: MethodIdentifierSchema.nullable(),
  source_commit: z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .nullable(),
  catalog_hash: OpaqueKeySchema.nullable(),
  profile_policy_hash: OpaqueKeySchema,
  environment_policy_hash: OpaqueKeySchema,
  product_scope: z.literal("operational-only"),
});
export type EngineMethodIdentity = z.infer<typeof EngineMethodIdentitySchema>;

export const CanonicalRequestBindingSchema = z.strictObject({
  observed_request_id: z.uuid(),
  canonical_request_id: z.uuid(),
  relation_hash: OpaqueKeySchema,
});
export type CanonicalRequestBinding = z.infer<
  typeof CanonicalRequestBindingSchema
>;

export const HistoryBindingSchema = z.strictObject({
  message_key: OpaqueKeySchema,
  observation_hash: OpaqueKeySchema,
});
export type HistoryBinding = z.infer<typeof HistoryBindingSchema>;

export const EstimateObservationSourceSchema = z.discriminatedUnion("family", [
  z.strictObject({
    family: z.literal("live"),
    request_id: z.uuid(),
    request_revision: SelectionRevisionSchema,
    request_hash: OpaqueKeySchema,
    attempt_id: z.uuid(),
    attempt_revision: SelectionRevisionSchema,
    attempt_hash: OpaqueKeySchema,
    canonical_request_binding: CanonicalRequestBindingSchema.optional(),
    history_binding: HistoryBindingSchema.optional(),
  }),
  z.strictObject({
    family: z.literal("history"),
    message_key: OpaqueKeySchema,
    observation_hash: OpaqueKeySchema,
  }),
]);
export type EstimateObservationSource = z.infer<
  typeof EstimateObservationSourceSchema
>;
