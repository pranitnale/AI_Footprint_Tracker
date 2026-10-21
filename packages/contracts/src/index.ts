// First, before any schema is made (see the module).
import "./zod-config";
import { z } from "zod";
import {
  HistoricalResourceV2Schema,
  type HistoricalResourceV2,
} from "./estimation-result";
import { REASON_CODES, ReasonCodeSchema, type ReasonCode } from "./reasons";
export * from "./reasons";
import { MODEL_IDS } from "./model-ids";
import {
  CounterSchema,
  DecimalSchema,
  FiniteDecimalSchema,
  InstantSchema,
  OpaqueKeySchema,
} from "./scalars";
// A record's own company key field stays null. The key travels beside the record, in the
// `company_dedup_keys` list of its upload, so the server never stores a browser's key (W11).
const dedupKey = OpaqueKeySchema.nullable();
import { canonicalJson, payloadHash } from "./canonical";
export * from "./scalars";
export * from "./observation-evidence";
export * from "./original-method";
export * from "./engine-policy";
export * from "./engine-status";
export * from "./estimation-result";
export * from "./claude-tokens";
export { canonicalJson, payloadHash } from "./canonical";
export { MODEL_IDS, MODEL_LABEL_PATTERN, type ModelId } from "./model-ids";

export const SCHEMA_VERSION = "3.0.0" as const;
export const SUPPORTED_SCHEMA_VERSIONS = [SCHEMA_VERSION] as const;
const reasons = z
  .array(ReasonCodeSchema)
  .max(32)
  .refine((a) => new Set(a).size === a.length, "Duplicate reasons");
export const VersionSchema = z.literal("0.1.0");
export const SITES = [
  "chatgpt",
  "claude",
  "gemini",
  "perplexity",
  "notebooklm",
] as const;
export const SiteSchema = z.enum(SITES);
export type Site = z.infer<typeof SiteSchema>;
const model = z.enum(MODEL_IDS).nullable();
const evidence = z.enum([
  "response_field",
  "request_field",
  "ui_selection",
  "unknown",
]);
const uuid = z.uuid();
const revision = z.number().int().min(1).max(2147483647);
export const PROFILE_IDS = [
  "o200k-base-4.0.0-reference",
  "cl100k-base-4.0.0-reference",
  "observed-text-v1",
  // Uploaded image tokens from each vendor's published rule (A7), not a text tokenizer.
  "vendor-image-rules-1",
] as const;
const profile = z.enum(PROFILE_IDS).nullable();
export const TIMING_SOURCES = [
  "browser_request",
  "chatgpt_history",
  "claude_history",
  "perplexity_history",
  "gemini_history",
  "cowork_history",
  "notebooklm_history",
] as const;
export type TimingSource = (typeof TIMING_SOURCES)[number];
// Research runs report their own task span; other sources keep their single scope.
export const TIMING_SCOPES: Readonly<Record<TimingSource, readonly string[]>> =
  Object.freeze({
    browser_request: ["request"],
    chatgpt_history: ["provider_message", "research_task"],
    claude_history: ["content_blocks", "research_task"],
    perplexity_history: ["workflow"],
    gemini_history: ["research_task"],
    cowork_history: ["provider_message"],
    notebooklm_history: ["provider_message"],
  });
export const TimingEvidenceSchema = z
  .strictObject({
    duration_seconds: FiniteDecimalSchema.refine((value) => {
      const numeric = Number(value);
      if (!(numeric > 0 && numeric <= 86400)) return false;
      // Compare the persisted decimal exactly at the upper bound, before binary64 rounding.
      const match =
        /^(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:e([+-]?[0-9]{1,3}))?$/.exec(value);
      if (!match) return false;
      const digits = BigInt(match[1]! + (match[2] ?? ""));
      const exponent = Number(match[3] ?? 0) - (match[2]?.length ?? 0);
      return exponent >= 0
        ? digits * 10n ** BigInt(exponent) <= 86400n
        : digits <= 86400n * 10n ** BigInt(-exponent);
    }, "Timing duration must be greater than zero and at most one day"),
    source: z.enum(TIMING_SOURCES),
    scope: z.enum([
      "request",
      "provider_message",
      "content_blocks",
      "workflow",
      "research_task",
    ]),
    completeness: z.enum(["complete_for_scope", "partial", "unknown"]),
    profile_version: z.literal("timing-observation-1"),
  })
  .superRefine((value, context) => {
    if (!(TIMING_SCOPES[value.source] as readonly string[]).includes(value.scope))
      context.addIssue({
        code: "custom",
        path: ["scope"],
        message: "Timing source and scope do not match",
      });
  });
export type TimingEvidence = z.infer<typeof TimingEvidenceSchema>;
/** History timing must come from the same provider surface as the message. */
export function historyTimingSources(site: Site): readonly TimingSource[] {
  return site === "claude"
    ? ["claude_history", "cowork_history"]
    : [`${site}_history` as TimingSource];
}
export const TokenMeasurementSchema = z
  .strictObject({
    value: CounterSchema.nullable(),
    evidence: z.enum([
      "provider_reported",
      "official_tokenizer",
      "calibrated_estimate",
      "heuristic_estimate",
      "unknown",
      "not_applicable",
    ]),
    scope: z.enum([
      "provider_request",
      "observed_text",
      "reconstructed_context",
      "provider_defined_subset",
    ]),
    completeness: z.enum(["complete_for_scope", "partial", "unknown"]),
    profile_id: profile,
    reason: ReasonCodeSchema.nullable(),
  })
  .superRefine((m, ctx) => {
    if (
      (m.evidence === "unknown" || m.evidence === "not_applicable") &&
      (m.value !== null || m.reason === null)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Unknown or inapplicable measurements require null and a reason",
      });
    if (m.value === null && m.reason === null)
      ctx.addIssue({
        code: "custom",
        message: "Missing quantity requires a reason",
      });
    if (m.value !== null && m.evidence === "calibrated_estimate")
      ctx.addIssue({
        code: "custom",
        message: "No calibrated tokenizer profiles are approved",
      });
  });
export type TokenMeasurement = z.infer<typeof TokenMeasurementSchema>;
export const TOKEN_FIELDS = [
  "new_input_text",
  "logical_input_total",
  "input_uncached",
  "input_cache_read",
  "input_cache_write",
  "answer_output",
  "visible_thinking",
  "reported_reasoning",
  "output_total",
  "tool_input",
  "intermediate_output",
  "tool_output",
  "image_input_tokens",
  "image_output_tokens",
] as const;
export type TokenField = (typeof TOKEN_FIELDS)[number];
/**
 * Generated text the estimate counts as output. Each part is counted once:
 * the reply, reasoning summaries, model-written tool input (files, documents, code,
 * queries, briefs, prompts) and other generated text (commentary, plans, research
 * plans, compaction summaries, retracted blocks, suggestions).
 */
export const OUTPUT_PARTS = [
  "answer_output",
  "visible_thinking",
  "tool_input",
  "intermediate_output",
] as const;
export type OutputPart = (typeof OUTPUT_PARTS)[number];
/** Parts kept on history records so live and history follow one counting rule. */
export const HISTORY_PART_FIELDS = [
  ...OUTPUT_PARTS,
  "reported_reasoning",
  "tool_output",
  "image_input_tokens",
] as const;
export type HistoryPartField = (typeof HISTORY_PART_FIELDS)[number];
/** Text parts of a reply besides the answer, each counted from its own text. */
export const REPLY_TEXT_PARTS = [
  "visible_thinking",
  "tool_input",
  "intermediate_output",
  "tool_output",
] as const;
export type ReplyTextPart = (typeof REPLY_TEXT_PARTS)[number];
export const TokenFieldsSchema = z.strictObject(
  Object.fromEntries(
    TOKEN_FIELDS.map((k) => [k, TokenMeasurementSchema]),
  ) as Record<TokenField, typeof TokenMeasurementSchema>,
);
export type TokenFields = z.infer<typeof TokenFieldsSchema>;
export function unknownMeasurement(
  reason: ReasonCode = "provider_usage_unavailable",
): TokenMeasurement {
  return {
    value: null,
    evidence: "unknown",
    scope: "observed_text",
    completeness: "unknown",
    profile_id: null,
    reason,
  };
}
export function notApplicableMeasurement(): TokenMeasurement {
  return {
    value: null,
    evidence: "not_applicable",
    scope: "observed_text",
    completeness: "unknown",
    profile_id: null,
    reason: "not_applicable",
  };
}
/** A count the provider reported for the request itself (Cowork, Claude AI artifacts). */
export function providerMeasurement(value: number | string): TokenMeasurement {
  return {
    value: String(value),
    evidence: "provider_reported",
    scope: "provider_request",
    completeness: "complete_for_scope",
    profile_id: null,
    reason: null,
  };
}
export function emptyTokenFields(): TokenFields {
  return Object.fromEntries(
    TOKEN_FIELDS.map((k) => [k, unknownMeasurement()]),
  ) as TokenFields;
}
/**
 * Adds the output parts without ever reading a missing part as zero. A part that is
 * unknown leaves the total partial; parts that do not apply are left out.
 */
export function composeOutputTotal(
  parts: Readonly<Record<OutputPart, TokenMeasurement>>,
): TokenMeasurement {
  const values = OUTPUT_PARTS.map((part) => parts[part]);
  const known = values.filter((measurement) => measurement.value !== null);
  const missing = values.filter(
    (measurement) =>
      measurement.value === null && measurement.evidence !== "not_applicable",
  );
  if (!known.length)
    return unknownMeasurement(
      missing[0]?.reason ?? parts.answer_output.reason ?? "estimate_unavailable",
    );
  const profiles = new Set(known.map((measurement) => measurement.profile_id));
  const evidence = new Set(known.map((measurement) => measurement.evidence));
  const partial =
    missing.length > 0 ||
    known.some(
      (measurement) => measurement.completeness !== "complete_for_scope",
    ) ||
    profiles.size > 1 ||
    evidence.size > 1;
  return {
    value: known
      .reduce((total, measurement) => total + BigInt(measurement.value!), 0n)
      .toString(),
    evidence: evidence.size === 1 ? [...evidence][0]! : "heuristic_estimate",
    scope: "observed_text",
    completeness: partial ? "partial" : "complete_for_scope",
    profile_id: profiles.size === 1 ? [...profiles][0]! : null,
    reason: partial
      ? (missing[0]?.reason ??
        known.find(
          (measurement) => measurement.completeness !== "complete_for_scope",
        )?.reason ??
        "partial_capture")
      : (known[0]!.reason ?? null),
  };
}
const outputTotalEquals = (
  total: TokenMeasurement,
  parts: Readonly<Record<OutputPart, TokenMeasurement>>,
) => canonicalJson(total) === canonicalJson(composeOutputTotal(parts));
const dimension = z.number().int().min(1).max(65536).nullable();
export const MediaSettingsSchema = z.strictObject({
  width: dimension,
  height: dimension,
  steps: z.number().int().min(1).max(10000).nullable(),
  precision: z.enum(["bfloat16", "float16", "float32", "unknown"]),
  architecture: z.enum(["diffusion", "autoregressive", "unknown"]),
});
export const unknownMediaSettings = () => ({
  width: null,
  height: null,
  steps: null,
  precision: "unknown" as const,
  architecture: "unknown" as const,
});
const dimensions = {
  width: dimension,
  height: dimension,
  dimension_source: z.enum([
    "original",
    "provider_resized",
    "thumbnail_only",
    "unknown",
  ]),
};
const opKind = z.enum([
  "text_to_image",
  "image_edit",
  "inpaint",
  "upscale",
  "unknown",
]);
const mediaState = z.enum([
  "requested",
  "generating",
  "completed",
  "cancelled",
  "failed",
  "interrupted_unconfirmed",
]);
const inputImage = z.strictObject({
  count: CounterSchema,
  origin: z.enum(["new_upload", "retained_context", "unknown_origin"]),
  ...dimensions,
  detail: z.enum(["low", "high", "auto", "unknown"]),
  token_profile_id: profile,
  tokens: TokenMeasurementSchema,
});
const requestedOperation = z.strictObject({
  operation_key: OpaqueKeySchema,
  kind: opKind,
  requested_count: CounterSchema.nullable(),
  settings: MediaSettingsSchema,
});
const imageOperation = z.strictObject({
  operation_key: OpaqueKeySchema,
  kind: opKind,
  requested_count: CounterSchema.nullable(),
  returned_count: CounterSchema.nullable(),
  state: mediaState,
  execution_evidence: z.enum([
    "none",
    "provider_started",
    "content_observed",
    "usage_reported",
  ]),
  settings: MediaSettingsSchema,
  model_id: model,
  model_evidence: evidence,
});
const generatedImage = z.strictObject({
  operation_key: OpaqueKeySchema,
  count: CounterSchema,
  ...dimensions,
  settings: MediaSettingsSchema,
});
export const RequestMediaSchema = z
  .strictObject({
    input_images: z.array(inputImage).max(100),
    requested_operations: z.array(requestedOperation).max(100),
    coverage_reasons: reasons,
  })
  .refine(
    (m) => m.input_images.length + m.requested_operations.length <= 100,
    "Media entry limit",
  )
  .refine(
    (m) =>
      new Set(m.requested_operations.map((o) => o.operation_key)).size ===
      m.requested_operations.length,
    "Duplicate operation",
  );
export const AttemptMediaSchema = z
  .strictObject({
    image_operations: z.array(imageOperation).max(100),
    generated_images: z.array(generatedImage).max(100),
    coverage_reasons: reasons,
  })
  .superRefine((m, ctx) => {
    if (m.image_operations.length + m.generated_images.length > 100)
      ctx.addIssue({ code: "custom", message: "Media entry limit" });
    if (
      new Set(m.image_operations.map((o) => o.operation_key)).size !==
      m.image_operations.length
    )
      ctx.addIssue({ code: "custom", message: "Duplicate operation" });
    for (const g of m.generated_images)
      if (!m.image_operations.some((o) => o.operation_key === g.operation_key))
        ctx.addIssue({
          code: "custom",
          message: "Generated image requires operation",
        });
    for (const o of m.image_operations) {
      const groups = m.generated_images.filter(
        (g) => g.operation_key === o.operation_key,
      );
      if (
        o.returned_count !== null &&
        CounterSchema.safeParse(o.returned_count).success &&
        groups.every((g) => CounterSchema.safeParse(g.count).success)
      ) {
        const grouped = groups.reduce((n, g) => n + BigInt(g.count), 0n);
        if (grouped > BigInt(o.returned_count))
          ctx.addIssue({
            code: "custom",
            message: "Grouped outputs exceed returned count",
          });
      }
    }
  });
export function emptyRequestMedia(): z.infer<typeof RequestMediaSchema> {
  return { input_images: [], requested_operations: [], coverage_reasons: [] };
}
export function emptyAttemptMedia(): z.infer<typeof AttemptMediaSchema> {
  return { image_operations: [], generated_images: [], coverage_reasons: [] };
}
const seconds = FiniteDecimalSchema.refine((value) => {
  const numeric = Number(value);
  return numeric > 0 && numeric <= 86400;
}, "Media length must be greater than zero and at most one day");
/**
 * Generated text attributed to another model than the reply's own: Cowork side calls,
 * a research report written by a named research model, or a Gemini video storyboard.
 */
export const TextComponentSchema = z.strictObject({
  role: z.enum(["side_calls", "research", "storyboard"]),
  model_id: model,
  model_evidence: evidence,
  tokens: TokenMeasurementSchema,
  timing: TimingEvidenceSchema.nullable(),
});
export type TextComponent = z.infer<typeof TextComponentSchema>;
/** Generated media are facts the page shows; the estimator applies the method and defaults. */
export const MediaOutputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("image"),
    model_id: model,
    count: CounterSchema,
    width: dimension,
    height: dimension,
    // A stopped or failed job counts as one image only when generation visibly started.
    outcome: z.enum(["returned", "started_not_returned"]),
  }),
  z.strictObject({
    kind: z.literal("video"),
    model_id: model,
    width: dimension,
    height: dimension,
    duration_seconds: seconds.nullable(),
    with_audio: z.boolean().nullable(),
  }),
  z.strictObject({
    kind: z.literal("speech"),
    length_basis: z.enum(["audio_frames", "stored_length", "characters"]),
    seconds: seconds.nullable(),
    characters: CounterSchema.nullable(),
  }),
  z.strictObject({
    kind: z.literal("video_overview"),
    duration_seconds: seconds,
  }),
]);
export type MediaOutput = z.infer<typeof MediaOutputSchema>;
export const GenerationSchema = z
  .strictObject({
    text_components: z.array(TextComponentSchema).max(16),
    media: z.array(MediaOutputSchema).max(64),
  })
  .superRefine((value, context) => {
    for (const [index, item] of value.media.entries()) {
      // Measured audio has a length in seconds; the reading-rate rule has only characters.
      if (
        item.kind === "speech" &&
        (item.length_basis === "characters"
          ? item.characters === null ||
            item.characters === "0" ||
            item.seconds !== null
          : item.seconds === null || item.characters !== null)
      )
        context.addIssue({
          code: "custom",
          path: ["media", index],
          message: "Speech length must match its basis",
        });
      // A stopped or failed job that visibly started counts as exactly one image.
      if (
        item.kind === "image" &&
        (item.count === "0" ||
          (item.outcome === "started_not_returned" && item.count !== "1"))
      )
        context.addIssue({
          code: "custom",
          path: ["media", index],
          message: "Image entries need a positive count; a started job is one image",
        });
    }
  });
export type Generation = z.infer<typeof GenerationSchema>;
export function emptyGeneration(): Generation {
  return { text_components: [], media: [] };
}
export const EXTRACTION_PROFILES = [
  "local-file-text-utf8-pdfjs6.3.289-opc-v1",
  "observed-inline-file-text-v1",
] as const;
export const ExtractionProfileSchema = z.enum(EXTRACTION_PROFILES);
export type ExtractionProfile = z.infer<typeof ExtractionProfileSchema>;
export const FILE_COVERAGE_REASONS = [
  "provider_processing",
  "ocr",
  "image_encoding",
  "retrieval_selection",
  "layout_and_drawing_text",
  "rendered_visibility",
  "formula_recalculation",
  "external_font_mapping",
] as const;
export const FileCoverageReasonSchema = z.enum(FILE_COVERAGE_REASONS);
export type FileCoverageReason = z.infer<typeof FileCoverageReasonSchema>;
export const ExtractedFileTextMeasurementSchema = z
  .strictObject({
    ...TokenMeasurementSchema.shape,
    scope: z.literal("extracted_file_text"),
    evidence: z.enum(["heuristic_estimate", "unknown"]),
  })
  .superRefine((m, ctx) => {
    if (
      m.value === null &&
      (m.reason === null ||
        m.evidence !== "unknown" ||
        m.completeness !== "unknown")
    )
      ctx.addIssue({
        code: "custom",
        message: "Missing file text requires unknown evidence and a reason",
      });
    if (
      m.value !== null &&
      (m.evidence !== "heuristic_estimate" ||
        m.profile_id === null ||
        m.completeness === "unknown" ||
        m.reason === null)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Known file text requires an approved profile and scoped evidence",
      });
  });
export type ExtractedFileTextMeasurement = z.infer<
  typeof ExtractedFileTextMeasurementSchema
>;
export const ExtractedFileTextComponentSchema = z.strictObject({
  component_id: z
    .string()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    ),
  origin: z.enum(["new_upload", "retained_context", "unknown_origin"]),
  extraction_profile_id: ExtractionProfileSchema,
  page_count: z.number().int().min(0).max(200).nullable(),
  tokens: ExtractedFileTextMeasurementSchema,
  missing: z
    .array(FileCoverageReasonSchema)
    .min(1)
    .max(FILE_COVERAGE_REASONS.length)
    .refine(
      (a) => new Set(a).size === a.length && a.includes("provider_processing"),
      "Local extraction does not establish provider processing",
    ),
});
export type ExtractedFileTextComponent = z.infer<
  typeof ExtractedFileTextComponentSchema
>;
export const RequestObservationSchema = z
  .strictObject({
    schema_version: z.literal(SCHEMA_VERSION),
    kind: z.literal("request"),
    request_id: uuid,
    revision,
    conversation_key: OpaqueKeySchema,
    key_version: z.literal("1"),
    provider_request_key: OpaqueKeySchema.nullable(),
    site: SiteSchema,
    adapter_version: VersionSchema,
    // `read_aloud` is speech made from a reply already shown (ChatGPT, G1) and
    // `notebook_guide` a NotebookLM guide the page asks for itself (W9).
    // Neither has a prompt: they add energy, never a request (see countsAsRequest).
    action: z.enum([
      "send",
      "regenerate",
      "continue",
      "edit_and_send",
      "read_aloud",
      "notebook_guide",
    ]),
    dispatched_at: InstantSchema,
    ended_at: InstantSchema.nullable(),
    state: z.enum([
      "dispatched",
      "generating",
      "completed",
      "cancelled",
      "failed",
      "interrupted_unconfirmed",
    ]),
    model_id: model,
    model_evidence: evidence,
    features: z
      .array(
        z.enum([
          "text",
          "thinking",
          "search",
          "document",
          "image_input",
          "image_generation",
          "image_edit",
          "audio",
          "video",
          "other_tool",
        ]),
      )
      .max(10)
      .refine((a) => new Set(a).size === a.length),
    observed_search_operations: CounterSchema.nullable(),
    documents: z.strictObject({
      extracted_text: z
        .array(ExtractedFileTextComponentSchema)
        .max(100)
        .nullable(),
      upload_count: CounterSchema.nullable(),
      types: z
        .array(
          z.enum([
            "text_pdf",
            "scanned_pdf",
            "text",
            "office",
            "other",
            "unknown",
          ]),
        )
        .max(6)
        .refine((a) => new Set(a).size === a.length),
      processing: z.enum([
        "observed_text",
        "opaque",
        "mixed",
        "none",
        "unknown",
      ]),
    }),
    media: RequestMediaSchema,
    coverage_reasons: reasons,
    policy_version: z
      .string()
      .regex(/^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/),
    company_dedup_key: dedupKey,
  })
  .superRefine((r, ctx) => {
    if (r.coverage_reasons.includes("historical_timing_conflict"))
      ctx.addIssue({
        code: "custom",
        message: "Historical timing conflicts require a historical response",
      });
    // A live record is a live request by definition (W9 review).
    if (r.coverage_reasons.includes("no_live_request"))
      ctx.addIssue({
        code: "custom",
        message: "Only saved history rows can lack a live request",
      });
    if (r.company_dedup_key !== null)
      ctx.addIssue({
        code: "custom",
        path: ["company_dedup_key"],
        message: "The company key travels beside the record",
      });
    if (r.ended_at !== null && r.ended_at < r.dispatched_at)
      ctx.addIssue({ code: "custom", message: "End precedes dispatch" });
    // Read aloud is ChatGPT speech made from a reply already shown, audio only (G1). It is
    // left out of request counts, so no other request may take its shape: it uploads no
    // documents or images, asks for none and runs no searches.
    if (
      r.action === "read_aloud" &&
      (r.site !== "chatgpt" ||
        r.features.length !== 1 ||
        r.features[0] !== "audio" ||
        (r.documents.upload_count !== null &&
          r.documents.upload_count !== "0") ||
        r.documents.types.length > 0 ||
        r.documents.extracted_text !== null ||
        !["none", "unknown"].includes(r.documents.processing) ||
        r.media.input_images.length > 0 ||
        r.media.requested_operations.length > 0 ||
        (r.observed_search_operations !== null &&
          r.observed_search_operations !== "0"))
    )
      ctx.addIssue({
        code: "custom",
        message: "Read aloud is ChatGPT audio only",
      });
    // A notebook guide is text NotebookLM writes from the notebook's sources, which are
    // hidden input: it has no prompt, uploads and searches nothing (W9).
    if (
      r.action === "notebook_guide" &&
      (r.site !== "notebooklm" ||
        r.features.length !== 1 ||
        r.features[0] !== "text" ||
        (r.documents.upload_count !== null &&
          r.documents.upload_count !== "0") ||
        r.documents.types.length > 0 ||
        r.documents.extracted_text !== null ||
        !["none", "unknown"].includes(r.documents.processing) ||
        r.media.input_images.length > 0 ||
        r.media.requested_operations.length > 0 ||
        (r.observed_search_operations !== null &&
          r.observed_search_operations !== "0"))
    )
      ctx.addIssue({
        code: "custom",
        message: "A notebook guide is NotebookLM text only",
      });
    const components = r.documents.extracted_text ?? [];
    if (
      new Set(components.map((c) => c.component_id)).size !== components.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Duplicate file component identity",
      });
    if (
      r.documents.upload_count !== null &&
      CounterSchema.safeParse(r.documents.upload_count).success &&
      BigInt(components.filter((c) => c.origin === "new_upload").length) >
        BigInt(r.documents.upload_count)
    )
      ctx.addIssue({
        code: "custom",
        message: "New file components exceed observed uploads",
      });
    if (
      components.length +
        r.media.input_images.length +
        r.media.requested_operations.length >
      100
    )
      ctx.addIssue({
        code: "custom",
        message: "Combined media metadata limit exceeded",
      });
  });
export const AttemptObservationSchema = z
  .strictObject({
    schema_version: z.literal(SCHEMA_VERSION),
    kind: z.literal("attempt"),
    attempt_id: uuid,
    request_id: uuid,
    revision,
    provider_attempt_key: OpaqueKeySchema.nullable(),
    key_version: z.literal("1"),
    started_at: InstantSchema,
    ended_at: InstantSchema.nullable(),
    state: z.enum([
      "dispatch_only",
      "generating",
      "completed",
      "cancelled",
      "failed",
      "interrupted_unconfirmed",
    ]),
    execution_evidence: z.enum([
      "none",
      "provider_started",
      "content_observed",
      "usage_reported",
    ]),
    model_id: model,
    model_evidence: evidence,
    tokens: TokenFieldsSchema,
    timing: TimingEvidenceSchema.nullable(),
    media: AttemptMediaSchema,
    generation: GenerationSchema,
    coverage_reasons: reasons,
    tokenizer_profile_id: profile,
    tokenizer_asset_hash: OpaqueKeySchema.nullable(),
    proposed_method_id: z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]{0,127}$/)
      .nullable(),
    company_dedup_key: dedupKey,
  })
  .refine(
    (r) => !r.coverage_reasons.includes("historical_timing_conflict"),
    "Historical timing conflicts require a historical response",
  )
  .refine(
    (r) => !r.coverage_reasons.includes("no_live_request"),
    "Only saved history rows can lack a live request",
  )
  .refine(
    (r) => r.company_dedup_key === null,
    "The company key travels beside the record",
  )
  .refine(
    (r) =>
      outputTotalEquals(r.tokens.output_total, r.tokens) ||
      (r.tokens.output_total.evidence === "provider_reported" &&
        r.tokens.output_total.scope === "provider_request" &&
        r.tokens.output_total.value !== null),
    "Output total must equal its parts unless the provider reports it for the request",
  )
  .refine(
    (r) => r.ended_at === null || r.ended_at >= r.started_at,
    "End precedes start",
  )
  .refine(
    (r) => r.timing === null || r.timing.source === "browser_request",
    "Live attempts require browser timing",
  )
  .refine(
    (r) =>
      r.timing?.completeness !== "complete_for_scope" ||
      r.state === "completed",
    "Complete live timing requires a completed attempt",
  );
export const ObservationSchema = z.union([
  RequestObservationSchema,
  AttemptObservationSchema,
]);
export type RequestObservation = z.infer<typeof RequestObservationSchema>;
/**
 * Whether a request record counts as a request the user sent. Read aloud makes speech from
 * a reply already counted, and NotebookLM writes its notebook guides by itself (W9), so
 * their energy counts but they add no request, and request counts stay comparable with
 * the prompts saved history shows.
 */
export const countsAsRequest = (request: Pick<RequestObservation, "action">) =>
  request.action !== "read_aloud" && request.action !== "notebook_guide";
export type AttemptObservation = z.infer<typeof AttemptObservationSchema>;
export type Observation = z.infer<typeof ObservationSchema>;
/**
 * The browser's company key for one record of a batch (W11). It names the prompt or reply
 * the record measures, so members who saw the same one send the same key. The server keeps
 * only its own hash of it.
 */
export const CompanyKeyEntrySchema = z.strictObject({
  kind: z.enum(["request", "attempt"]),
  record_id: uuid,
  company_dedup_key: OpaqueKeySchema,
});
export type CompanyKeyEntry = z.infer<typeof CompanyKeyEntrySchema>;
export const UsageBatchSchema = z
  .strictObject({
    schema_version: z.literal(SCHEMA_VERSION),
    batch_id: uuid,
    sent_at: InstantSchema,
    client_version: VersionSchema,
    deletion_epoch: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    records: z.array(ObservationSchema).min(1).max(100),
    // Left out when no record has a key, so a server without company keys accepts it.
    company_dedup_keys: z.array(CompanyKeyEntrySchema).max(100).optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.company_dedup_keys) return;
    const records = new Set(
      v.records.map((r) =>
        r.kind === "request"
          ? `request:${r.request_id}`
          : `attempt:${r.attempt_id}`,
      ),
    );
    const named = v.company_dedup_keys.map((e) => `${e.kind}:${e.record_id}`);
    if (
      new Set(named).size !== named.length ||
      named.some((name) => !records.has(name))
    )
      ctx.addIssue({
        code: "custom",
        path: ["company_dedup_keys"],
        message: "Each company key names one record of the batch",
      });
  });
export type UsageBatch = z.infer<typeof UsageBatchSchema>;
export function extractedFileText(
  request: RequestObservation,
): ExtractedFileTextComponent[] | null {
  return request.documents.extracted_text;
}
export function parseObservation(input: unknown): Observation {
  return ObservationSchema.parse(input);
}
export function parseUsageBatch(input: unknown): UsageBatch {
  const bytes = new TextEncoder().encode(canonicalJson(input)).length;
  if (bytes > 524288) throw new Error("payload_rejected");
  return UsageBatchSchema.parse(input);
}
const recovery: Partial<Record<ReasonCode, [string, string]>> = {
  historical_timing_conflict: [
    "Historical timing is uncertain. Valid message and token counts are retained.",
    "No action is required. Estimates use valid live timing when available, otherwise modeled timing.",
  ],
  storage_write_failed: [
    "This activity could not be saved.",
    "Check browser storage and retry. Keep this tab open while recording recovers.",
  ],
  ledger_integrity_failed: [
    "Some saved records need repair.",
    "Open tracking details. Affected totals remain unavailable until the records reconcile.",
  ],
  tokenizer_unavailable: [
    "The request was recorded, but text counting failed.",
    "Reload the extension to restart its local counting worker.",
  ],
  tokenizer_mapping_unverified: [
    "This text count uses an approximate model mapping.",
    "Read the counting scope in Details.",
  ],
  sync_delayed: [
    "Saved activity is waiting to sync.",
    "Check the company connection; pending records will retry automatically.",
  ],
  auth_reconnect_required: [
    "Your company connection needs renewal.",
    "Open Company and connect again with your work email.",
  ],
  protocol_unsupported: [
    "This provider response is not supported by the current parser.",
    "Update the extension. Independently recorded activity remains available.",
  ],
  estimate_unavailable: [
    "Resources are unavailable for part of this activity.",
    "Read the missing components in Details.",
  ],
  method_update_invalid: [
    "The calculation update could not be verified.",
    "Keep the current valid method and contact the deployment operator.",
  ],
  revision_conflict: [
    "Two versions of this record conflict.",
    "Keep the record in the reconciliation queue; do not create a replacement identity.",
  ],
  capture_limit_exceeded: [
    "The measurement limit was reached. Your AI request continues.",
    "The recorded subtotal remains partial; review its coverage in Details.",
  ],
  retention_expired: [
    "These company records are outside the retention period.",
    "Remove the expired local records after applying the server receipt.",
  ],
  host_interference_detected: [
    "On-page measurement has stopped to preserve the AI tool.",
    "Reload the page and inspect the extension diagnostic.",
  ],
  factor_incompatible: [
    "The available environmental factors cover different scopes.",
    "Show the supported components separately.",
  ],
  payload_rejected: [
    "This numerical record does not match the accepted contract.",
    "Keep it quarantined and update the extension before retrying.",
  ],
};
export const ERROR_CATALOG = Object.freeze(
  Object.fromEntries(
    REASON_CODES.map((code) => [
      code,
      Object.freeze({
        code,
        retryable: [
          "sync_delayed",
          "dependency_missing",
          "estimate_pending",
          "tokenizer_timeout",
          "storage_write_failed",
        ].includes(code),
        safe_message:
          recovery[code]?.[0] ??
          "This component has limited or unavailable coverage.",
        safe_action:
          recovery[code]?.[1] ??
          "Open Details for the affected scope and its recorded reason.",
      }),
    ]),
  ),
);

// History is observed at import, not a fabricated dispatch or execution.
export const HISTORY_SCHEMA_VERSION = SCHEMA_VERSION;
export const HistoricalInstantSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,6}Z$/)
  .refine((v) => {
    const millisecond = v.replace(/(\.\d{3})\d*Z$/, "$1Z");
    return (
      Number.isFinite(Date.parse(millisecond)) &&
      new Date(millisecond).toISOString() === millisecond
    );
  }, "Invalid history date");
export const HistoryPartsSchema = z.strictObject(
  Object.fromEntries(
    HISTORY_PART_FIELDS.map((k) => [k, TokenMeasurementSchema]),
  ) as Record<HistoryPartField, typeof TokenMeasurementSchema>,
);
export type HistoryParts = z.infer<typeof HistoryPartsSchema>;
/** Saved text is counted locally; only Cowork replies carry the provider's own totals. */
function validHistoryTokens(
  tokens: TokenMeasurement,
  role: "prompt" | "response",
): boolean {
  if (tokens.evidence === "provider_reported")
    return (
      role === "response" &&
      tokens.scope === "provider_request" &&
      tokens.value !== null
    );
  return (
    tokens.scope === "observed_text" &&
    (tokens.value === null
      ? tokens.evidence === "unknown"
      : tokens.evidence === "heuristic_estimate" && tokens.profile_id !== null)
  );
}
function validHistoryParts(
  tokens: TokenMeasurement,
  parts: HistoryParts,
  role: "prompt" | "response",
): boolean {
  if (role === "prompt")
    return (
      [...OUTPUT_PARTS, "reported_reasoning", "tool_output"] as const
    ).every((part) => parts[part].evidence === "not_applicable");
  if (parts.image_input_tokens.evidence !== "not_applicable") return false;
  return tokens.evidence === "provider_reported"
    ? true
    : outputTotalEquals(tokens, parts);
}
/**
 * Parts of a saved reply. Parts not given do not apply; a caller whose parser cannot read
 * a part passes it as unknown with its reason, so the total stays partial.
 */
export function historyResponseParts(
  answer: TokenMeasurement,
  other: Partial<Record<ReplyTextPart | "reported_reasoning", TokenMeasurement>> = {},
): HistoryParts {
  return {
    answer_output: answer,
    visible_thinking: other.visible_thinking ?? notApplicableMeasurement(),
    tool_input: other.tool_input ?? notApplicableMeasurement(),
    intermediate_output:
      other.intermediate_output ?? notApplicableMeasurement(),
    reported_reasoning: other.reported_reasoning ?? notApplicableMeasurement(),
    tool_output: other.tool_output ?? notApplicableMeasurement(),
    image_input_tokens: notApplicableMeasurement(),
  };
}
export function historyPromptParts(
  imageInput: TokenMeasurement = notApplicableMeasurement(),
): HistoryParts {
  return {
    answer_output: notApplicableMeasurement(),
    visible_thinking: notApplicableMeasurement(),
    tool_input: notApplicableMeasurement(),
    intermediate_output: notApplicableMeasurement(),
    reported_reasoning: notApplicableMeasurement(),
    tool_output: notApplicableMeasurement(),
    image_input_tokens: imageInput,
  };
}
/**
 * The token rows one saved message adds to a history summary: its own count, then the
 * input-side part of its role when it applies (a prompt's uploaded images, a reply's tool
 * results). A prompt saved without parts comes from a page that did not show its uploads,
 * so its images stay unknown, as they do for a live request. Each output of another model
 * in a reply (D3) adds its own row: it is generated output outside the reply's own total.
 */
export function historyTokenParts(
  message: Pick<HistoryMessage, "role" | "tokens" | "parts" | "generation">,
): Array<[HistoryTokenPart, TokenMeasurement]> {
  const part =
    message.role === "prompt" ? "image_input_tokens" : "tool_output";
  const side = message.parts?.[part] ?? unknownMeasurement();
  const rows: Array<[HistoryTokenPart, TokenMeasurement]> = [
    ["total", message.tokens],
  ];
  if (side.evidence !== "not_applicable") rows.push([part, side]);
  for (const component of message.generation.text_components)
    rows.push(["other_models", component.tokens]);
  return rows;
}
export const HistoryMessageSchema = z
  .strictObject({
    schema_version: z.literal(HISTORY_SCHEMA_VERSION),
    kind: z.literal("history_message"),
    message_key: OpaqueKeySchema,
    role: z.enum(["prompt", "response"]),
    conversation_key: OpaqueKeySchema,
    key_version: z.literal("1"),
    site: SiteSchema,
    parent_key: OpaqueKeySchema.nullable(),
    prompt_key: OpaqueKeySchema.nullable(),
    provider_request_key: OpaqueKeySchema.nullable(),
    provider_attempt_key: OpaqueKeySchema.nullable(),
    occurred_at: HistoricalInstantSchema.nullable(),
    date_basis: z.enum([
      "message_created",
      "entry_created",
      "turn_created",
      "unknown",
    ]),
    observed_at: InstantSchema,
    proposed_method_id: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,127}$/),
    proposed_method_hash: OpaqueKeySchema,
    model_id: model,
    tokens: TokenMeasurementSchema,
    parts: HistoryPartsSchema.nullable(),
    generation: GenerationSchema,
    inline_file_text: z
      .array(ExtractedFileTextComponentSchema.omit({ component_id: true }))
      .max(16)
      .nullable(),
    timing: TimingEvidenceSchema.nullable(),
    text_complete: z.boolean(),
    coverage_reasons: z
      .array(ReasonCodeSchema)
      .max(33)
      .refine(
        (values) =>
          new Set(values).size === values.length &&
          (values.length <= 32 ||
            values.includes("historical_timing_conflict")),
        "Historical timing conflict reserves one additional reason slot",
      ),
    company_dedup_key: dedupKey,
  })
  .superRefine((v, ctx) => {
    if (v.company_dedup_key !== null)
      ctx.addIssue({
        code: "custom",
        path: ["company_dedup_key"],
        message: "The company key travels beside the message",
      });
    // Only NotebookLM's saved Studio rows have no live request. Its saved chat turns, read
    // since 14 Oct 2026, wait for a live match like any other site's. The reason exempts a
    // row from live matching, so on any other row it would hide a possible double count
    // (W9 review).
    if (
      v.coverage_reasons.includes("no_live_request") &&
      v.site !== "notebooklm"
    )
      ctx.addIssue({
        code: "custom",
        path: ["coverage_reasons"],
        message: "Only NotebookLM Studio rows lack a live request",
      });
    if (
      v.coverage_reasons.includes("historical_timing_conflict") &&
      (v.role !== "response" || v.timing !== null)
    )
      ctx.addIssue({
        code: "custom",
        path: ["timing"],
        message: "Conflicting historical response timing must be unavailable",
      });
    if (
      v.timing !== null &&
      (v.role !== "response" ||
        !historyTimingSources(v.site).includes(v.timing.source) ||
        (v.timing.completeness === "complete_for_scope" && !v.text_complete))
    )
      ctx.addIssue({
        code: "custom",
        path: ["timing"],
        message: "Historical timing must match the response provider",
      });
    if (
      (v.occurred_at === null) !== (v.date_basis === "unknown") ||
      !validHistoryTokens(v.tokens, v.role) ||
      (v.role === "prompt" && v.provider_attempt_key !== null)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Invalid historical text evidence",
      });
    }
    // A reply's total is its parts' sum, so every reply names its parts; a prompt has
    // parts only for uploaded image input.
    if (
      (v.role === "response" && v.parts === null) ||
      (v.parts !== null && !validHistoryParts(v.tokens, v.parts, v.role))
    )
      ctx.addIssue({
        code: "custom",
        path: ["parts"],
        message: "Historical parts do not match the recorded total",
      });
    if (
      v.role === "prompt" &&
      (v.generation.text_components.length || v.generation.media.length)
    )
      ctx.addIssue({
        code: "custom",
        path: ["generation"],
        message: "Prompts carry no generated output",
      });
  });
export type HistoryMessage = z.infer<typeof HistoryMessageSchema>;
export const HistoryPageSchema = z
  .strictObject({
    schema_version: z.literal(HISTORY_SCHEMA_VERSION),
    site: SiteSchema,
    conversation_key: OpaqueKeySchema,
    observed_at: InstantSchema,
    deletion_epoch: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    messages: z.array(HistoryMessageSchema).max(100),
    branch_scope: z.enum(["selected_branch", "loaded_messages", "unknown"]),
    selected_leaf_key: OpaqueKeySchema.nullable(),
    branch_message_keys: z.array(OpaqueKeySchema).max(100).nullable(),
    root_message_key: OpaqueKeySchema.nullable(),
    first_request_verified: z.boolean(),
    has_earlier: z.boolean().nullable(),
    has_later: z.boolean().nullable(),
    // Company keys of the page's messages, beside them as in a usage batch (W11). Left out
    // when no message has one.
    company_dedup_keys: z
      .array(
        z.strictObject({
          message_key: OpaqueKeySchema,
          company_dedup_key: OpaqueKeySchema,
        }),
      )
      .max(100)
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (
      new Set(v.messages.map((m) => m.message_key)).size !==
        v.messages.length ||
      v.messages.some(
        (m) => m.site !== v.site || m.conversation_key !== v.conversation_key,
      ) ||
      (v.first_request_verified && v.root_message_key === null) ||
      (v.branch_message_keys !== null &&
        new Set(v.branch_message_keys).size !== v.branch_message_keys.length)
    )
      ctx.addIssue({ code: "custom", message: "Inconsistent history page" });
    if (v.company_dedup_keys) {
      const messages = new Set(v.messages.map((m) => m.message_key));
      const named = v.company_dedup_keys.map((e) => e.message_key);
      if (
        new Set(named).size !== named.length ||
        named.some((name) => !messages.has(name))
      )
        ctx.addIssue({
          code: "custom",
          path: ["company_dedup_keys"],
          message: "Each company key names one message of the page",
        });
    }
  });
export type HistoryPage = z.infer<typeof HistoryPageSchema>;
/**
 * Local-only proof that a saved history count came from text of these lengths under
 * one counting runtime, so an unchanged message can reuse it instead of recounting.
 * It holds lengths and numeric counts, never text or a hash of text, and it never
 * enters the history record, the outbox or the API.
 */
// Each length is of one text field, which the history reader takes up to the live limit
// (HISTORY_LIMITS.messageUnits, 2,097,152 units since 14 Oct 2026); an attached file's
// text stays at HISTORY_LIMITS.inlineFileUnits. A tighter bound here made the commit of a
// longer saved reply fail. history-size-limits.test.ts checks these against the limits.
export const HISTORY_BASIS_FIELD_UNITS = 2097152;
export const HISTORY_BASIS_FILE_UNITS = 262144;
const basisUnits = z.number().int().min(0).max(HISTORY_BASIS_FIELD_UNITS);
export const HistoryCountBasisSchema = z.strictObject({
  units: basisUnits,
  fileUnits: z
    .array(z.number().int().min(0).max(HISTORY_BASIS_FILE_UNITS))
    .max(16)
    .nullable(),
  // Lengths and counts of the reply's other text parts and other-model text, so a
  // message whose reasoning or tool input changed is counted again.
  partUnits: z.partialRecord(z.enum(REPLY_TEXT_PARTS), basisUnits),
  partTokens: z.partialRecord(z.enum(REPLY_TEXT_PARTS), TokenMeasurementSchema),
  componentUnits: z.array(basisUnits.nullable()).max(16),
  componentTokens: z.array(TokenMeasurementSchema.nullable()).max(16),
  implementationId: z.string().min(1).max(128),
  profileId: z.string().min(1).max(128),
  assetHash: z.string().min(1).max(256),
  tokens: TokenMeasurementSchema,
  inlineFileComponents: z
    .array(ExtractedFileTextComponentSchema.omit({ component_id: true }))
    .max(16)
    .nullable(),
  // The tokens of each text or code file Perplexity Computer created in the reply, by a
  // keyed hash of the file's id, and whether they were counted from its content or its
  // size (14 Oct 2026). Kept so a reopened chat neither downloads nor counts it again.
  computerFiles: z
    .record(
      z.string().regex(/^[0-9a-f]{64}$/),
      z.strictObject({
        tokens: CounterSchema,
        basis: z.enum(["content", "size"]),
      }),
    )
    .refine((files) => Object.keys(files).length <= 64)
    .optional(),
});
export type HistoryCountBasis = z.infer<typeof HistoryCountBasisSchema>;
export type HistoryReceipt = {
  message_key: string;
  status: "applied" | "duplicate" | "conflict" | "erased";
  payload_hash: string;
};
/**
 * Token rows of a history summary: each message's own count ("total": the prompt text or
 * the reply's output total) and the parts kept apart from it, so "In" can add tool results
 * (A6) and uploaded images (A7), and "Out" the output of other models (D3), without
 * counting anything twice.
 */
export const HISTORY_TOKEN_PARTS = [
  "total",
  "tool_output",
  "image_input_tokens",
  "other_models",
] as const;
export type HistoryTokenPart = (typeof HISTORY_TOKEN_PARTS)[number];
export type HistorySummary = {
  schema_version: typeof SCHEMA_VERSION;
  scope: "loaded_history";
  status: "available" | "empty" | "unavailable";
  observed_prompt_count: string;
  observed_response_count: string;
  /**
   * Saved requests no live capture counted: contributing prompts plus contributing
   * regenerated Claude replies (`regeneratedHistoryReplies`). Req adds it to live requests.
   */
  prompt_count: string;
  response_count: string;
  dated_message_count: string;
  undated_message_count: string;
  calculated_message_count: string;
  uncalculated_message_count: string;
  matched_live_message_count: string;
  unresolved_overlap_message_count: string;
  conflicting_message_count: string;
  first_request_verified: boolean;
  branch_scope: "selected_branch" | "loaded_messages" | "unknown";
  provider_history_complete: false;
  file_text: HistoryFileSeries[];
  file_text_coverage: {
    observed_message_count: string;
    unknown_message_count: string;
    scope: "extracted_file_text";
    additive: false;
  };
  tokens: Array<{
    role: "prompt" | "response";
    part: HistoryTokenPart;
    profile_id: string | null;
    evidence: "heuristic_estimate" | "provider_reported" | "unknown";
    value: string | null;
    known_message_count: string;
    unknown_message_count: string;
  }>;
  resources: Array<
    | {
        quantity:
          | "energy"
          | "carbon"
          | "water_direct"
          | "water_upstream"
          | "water_total";
        value: string | null;
        unit: string;
        scope: "historical_visible_response";
        method_id: string;
        method_hash: string;
        status: "partial_estimate" | "unavailable";
        validation_state: "unvalidated_reference";
        profile_selection: "highest_comparable" | "unavailable";
        selected_profile_id: string | null;
        reasons: string[];
        missing_components: string[];
        known_message_count: string;
        unknown_message_count: string;
      }
    | HistoricalResourceV2
  >;
};
export type HistoryView = {
  local: HistorySummary;
  pending: HistorySummary | null;
  server: HistorySummary | null;
  server_status: "current" | "offline" | "unavailable" | "personal";
  coverage: "partial_loaded_history";
  /**
   * Registry ids of the models that answered the loaded local messages, each once in order
   * of appearance, for Details only. Kept out of HistorySummary, whose strict schema the
   * server shares; absent in views built before 13 October 2026.
   */
  models?: string[];
  /**
   * Files Perplexity Computer created in the loaded local replies, by how their saved count
   * was made, for Details only (14 October 2026); absent when there are none.
   */
  computer_files?: { content: number; size: number };
};
export function historyNumericPayloadHash(record: HistoryMessage): string {
  const { observed_at: _observed, ...numeric } = record;
  return payloadHash(numeric);
}
/** A complete count can replace a partial count only within the same observed-text profile. */
function fullerHistoryTokens(
  old: HistoryMessage,
  next: HistoryMessage,
): boolean {
  return (
    !old.text_complete &&
    next.text_complete &&
    old.tokens.value !== null &&
    next.tokens.value !== null &&
    old.tokens.completeness === "partial" &&
    next.tokens.completeness === "complete_for_scope" &&
    old.tokens.scope === next.tokens.scope &&
    old.tokens.evidence === next.tokens.evidence &&
    old.tokens.profile_id !== null &&
    old.tokens.profile_id === next.tokens.profile_id &&
    BigInt(next.tokens.value) >= BigInt(old.tokens.value)
  );
}
/**
 * A saved reply can grow after the live stream ends: research reports, late video
 * results and continued blocks keep the same reply id. A larger count of the same
 * profile and evidence is the newer state of that reply, never a second reply.
 */
function grownHistoryTokens(
  old: HistoryMessage,
  next: HistoryMessage,
): boolean {
  return (
    old.role === "response" &&
    old.tokens.value !== null &&
    next.tokens.value !== null &&
    old.tokens.scope === next.tokens.scope &&
    old.tokens.evidence === next.tokens.evidence &&
    old.tokens.profile_id === next.tokens.profile_id &&
    BigInt(next.tokens.value) > BigInt(old.tokens.value) &&
    next.text_complete &&
    // Totals compare when they add the same parts: complete, or missing the same parts
    // the site's parser cannot read while every part it reads is complete.
    (next.tokens.completeness === "complete_for_scope" ||
      (next.tokens.completeness === "partial" &&
        unreadParts(old) !== null &&
        unreadParts(old) === unreadParts(next) &&
        OUTPUT_PARTS.every(
          (part) =>
            next.parts![part].value === null ||
            next.parts![part].completeness === "complete_for_scope",
        )))
  );
}
/** The output parts a saved reply could not read, or null when it names no parts. */
function unreadParts(message: HistoryMessage): string | null {
  const parts = message.parts;
  if (!parts) return null;
  return OUTPUT_PARTS.filter(
    (part) =>
      parts[part].value === null && parts[part].evidence !== "not_applicable",
  ).join(",");
}
/** The facts a read gives about one generated item, as bits; a reread can lose some. */
function generationFacts(item: MediaOutput | TextComponent): number {
  if ("role" in item)
    return (
      (item.model_id !== null ? 1 : 0) |
      (item.tokens.value !== null ? 2 : 0) |
      (item.tokens.completeness === "complete_for_scope" ? 4 : 0)
    );
  switch (item.kind) {
    case "image":
      return (
        (item.model_id !== null ? 1 : 0) |
        (item.width !== null && item.height !== null ? 2 : 0) |
        (item.outcome === "returned" ? 4 : 0)
      );
    case "video":
      return (
        (item.model_id !== null ? 1 : 0) |
        (item.width !== null && item.height !== null ? 2 : 0) |
        (item.duration_seconds !== null ? 4 : 0) |
        (item.with_audio !== null ? 8 : 0)
      );
    case "speech":
      // Measured audio is stronger evidence than the reading-rate rule.
      return item.length_basis === "characters" ? 0 : 1;
    case "video_overview":
      return 0;
  }
}
/** Units per kind and per set of known facts (images count each picture). */
function generationUnits(generation: Generation): Map<string, Map<number, bigint>> {
  const groups = new Map<string, Map<number, bigint>>();
  const add = (key: string, facts: number, units: bigint) => {
    const group = groups.get(key) ?? new Map<number, bigint>();
    group.set(facts, (group.get(facts) ?? 0n) + units);
    groups.set(key, group);
  };
  for (const item of generation.media)
    add(
      item.kind,
      generationFacts(item),
      item.kind === "image" ? BigInt(item.count) : 1n,
    );
  for (const component of generation.text_components)
    add(`text:${component.role}`, generationFacts(component), 1n);
  return groups;
}
// More distinct fact sets than this in one kind is not a real page; keep the saved state.
const GENERATION_FACT_SETS = 12;
/**
 * Later reads may add media or components to a reply and name more of their facts; they
 * never remove them. Each saved item needs its own item in the new read that knows at
 * least the same facts (Hall's condition over groups of saved items), so a reread that
 * names a size but loses the model never replaces the saved description.
 */
export function generationCovers(next: Generation, old: Generation): boolean {
  const after = generationUnits(next);
  for (const [key, saved] of generationUnits(old)) {
    const read = after.get(key) ?? new Map<number, bigint>();
    const masks = [...saved.keys()];
    if (masks.length > GENERATION_FACT_SETS) return false;
    for (let subset = 1; subset < 1 << masks.length; subset++) {
      const chosen = masks.filter((_, index) => subset & (1 << index));
      let demand = 0n,
        supply = 0n;
      for (const mask of chosen) demand += saved.get(mask)!;
      for (const [facts, units] of read)
        if (chosen.some((mask) => (facts & mask) === mask)) supply += units;
      if (supply < demand) return false;
    }
  }
  return true;
}

/** Saved parts outside the output total: tool results, reported reasoning, images. */
const SIDE_PARTS = [
  "tool_output",
  "reported_reasoning",
  "image_input_tokens",
] as const;
const sameMeasure = (a: TokenMeasurement, b: TokenMeasurement) =>
  a.evidence === b.evidence &&
  a.scope === b.scope &&
  a.profile_id === b.profile_id;
/**
 * A reread never erases or lowers a known count outside the output total, as a live
 * recount never does (X9): a later view that truncates tool results or cannot read them
 * keeps the saved count. Other parts follow the total's own rules.
 */
function keepSideParts(
  old: HistoryMessage,
  next: HistoryMessage,
): HistoryMessage {
  if (!old.parts || !next.parts) return next;
  let parts = next.parts;
  for (const part of SIDE_PARTS) {
    const saved = old.parts[part],
      read = parts[part];
    if (
      saved.value !== null &&
      (read.value === null ||
        (sameMeasure(saved, read) && BigInt(saved.value) > BigInt(read.value)))
    )
      parts = { ...parts, [part]: saved };
  }
  return parts === next.parts ? next : { ...next, parts };
}
/** Two known counts of one part that were measured differently cannot both be right. */
function sidePartsConflict(old: HistoryMessage, next: HistoryMessage): boolean {
  return SIDE_PARTS.some(
    (part) =>
      old.parts?.[part].value != null &&
      next.parts?.[part].value != null &&
      !sameMeasure(old.parts[part], next.parts[part]),
  );
}

/** Retain stronger evidence on stale rereads before hashing or deciding refinement. */
/**
 * Whether a Claude reread corrects a saved placeholder rather than naming a later model.
 * The first saved model normally stays, but a reply saved as `claude-unlisted` before the
 * registry knew its family (13 Oct 2026: Haiku 5.5 was estimated as Opus 5.5) must take the
 * family placeholder, and a family placeholder must take the listed model of the same family
 * once the library has it. A listed model never replaces a placeholder of another family,
 * because the chat may have switched models since.
 */
export function claudeRefinesModel(
  old: string | null,
  next: string | null,
): boolean {
  if (!old || !next || old === next) return false;
  if (old === "claude-unlisted") return /^claude-[a-z]+-unlisted$/.test(next);
  const family = /^claude-([a-z]+)-unlisted$/.exec(old)?.[1];
  return !!family && next.startsWith(`claude-${family}-`) && !next.endsWith("-unlisted");
}

export function mergeHistoryEvidence(
  old: HistoryMessage,
  next: HistoryMessage,
): HistoryMessage {
  if (
    old.message_key !== next.message_key ||
    old.conversation_key !== next.conversation_key ||
    old.site !== next.site ||
    old.role !== next.role
  )
    return next;
  // Claude history names only the chat's current model, so a later model switch must not
  // relabel older replies: the first saved model stays. Other sites label each reply, so
  // a newer label is a registry correction and replaces the saved one. Company keys can
  // rotate; the first saved key keeps the reply matched.
  const stable = {
    model_id:
      old.site === "claude"
        ? claudeRefinesModel(old.model_id, next.model_id)
          ? next.model_id
          : (old.model_id ?? next.model_id)
        : (next.model_id ?? old.model_id),
    company_dedup_key: old.company_dedup_key ?? next.company_dedup_key,
  };
  // A grown reply is the newer state of the same reply: its own timing and parts apply.
  if (grownHistoryTokens(old, next)) {
    return keepSideParts(old, {
      ...next,
      ...stable,
      generation: generationCovers(next.generation, old.generation)
        ? next.generation
        : old.generation,
    });
  }
  // A stale or shorter reread keeps the fuller saved state of the reply.
  if (grownHistoryTokens(next, old))
    return {
      ...old,
      observed_at: next.observed_at,
      generation: generationCovers(next.generation, old.generation)
        ? next.generation
        : old.generation,
    };
  const retained = { ...next, ...stable, timing: next.timing ?? old.timing };
  const oldComplete = old.timing?.completeness === "complete_for_scope";
  const nextComplete = next.timing?.completeness === "complete_for_scope";
  if (
    old.coverage_reasons.includes("historical_timing_conflict") ||
    next.coverage_reasons.includes("historical_timing_conflict") ||
    (oldComplete &&
      nextComplete &&
      canonicalJson(old.timing) !== canonicalJson(next.timing))
  ) {
    retained.timing = null;
    retained.coverage_reasons = [
      ...new Set<ReasonCode>([
        ...next.coverage_reasons,
        "historical_timing_conflict",
      ]),
    ];
  } else if (old.timing !== null && !nextComplete) {
    retained.timing = old.timing;
  }
  // A reread that could not count (its tokenizer was unavailable, or it did not read the
  // text) says nothing new about the message, so the saved counts stay. Otherwise a reread
  // just after the extension restarted turned every saved NotebookLM Studio prompt into a
  // conflict that was never counted again (owner report, 5 October 2026).
  if (old.tokens.value !== null && next.tokens.value === null) {
    retained.tokens = old.tokens;
    retained.parts = old.parts;
    retained.inline_file_text = old.inline_file_text;
  }
  if (fullerHistoryTokens(next, old)) {
    retained.tokens = old.tokens;
    retained.parts = old.parts;
    retained.text_complete = old.text_complete;
  }
  if (!generationCovers(retained.generation, old.generation))
    retained.generation = old.generation;
  return keepSideParts(old, retained);
}

/** Timing uncertainty keeps valid counts; incompatible identity or content remains a conflict. */
export function refineHistory(
  old: HistoryMessage,
  next: HistoryMessage,
): "duplicate" | "improved" | "conflict" {
  // Checked before merging: a stale reread is replaced by the saved state, which would
  // hide a part it measured differently.
  if (sidePartsConflict(old, next)) return "conflict";
  next = mergeHistoryEvidence(old, next);
  if (historyNumericPayloadHash(old) === historyNumericPayloadHash(next))
    return "duplicate";
  const immutable = [
    "message_key",
    "role",
    "site",
    "conversation_key",
    "key_version",
    "proposed_method_id",
    "proposed_method_hash",
  ] as const;
  if (immutable.some((key) => old[key] !== next[key])) return "conflict";
  // The model is reconciled by mergeHistoryEvidence, so it is not an identity field.
  for (const key of [
    "parent_key",
    "prompt_key",
    "provider_request_key",
    "provider_attempt_key",
    "occurred_at",
  ] as const)
    if (old[key] !== null && old[key] !== next[key]) return "conflict";
  if (old.date_basis !== "unknown" && old.date_basis !== next.date_basis)
    return "conflict";
  if (old.text_complete && !next.text_complete) return "conflict";
  const grown = grownHistoryTokens(old, next);
  if (
    !grown &&
    old.timing !== null &&
    canonicalJson(old.timing) !== canonicalJson(next.timing) &&
    !next.coverage_reasons.includes("historical_timing_conflict") &&
    !(
      old.timing.completeness !== "complete_for_scope" &&
      next.timing?.completeness === "complete_for_scope"
    )
  )
    return "conflict";
  if (
    old.inline_file_text !== null &&
    canonicalJson(old.inline_file_text) !== canonicalJson(next.inline_file_text)
  )
    return "conflict";
  if (!generationCovers(next.generation, old.generation)) return "conflict";
  if (sidePartsConflict(old, next)) return "conflict";
  if (
    old.tokens.value !== null &&
    canonicalJson(old.tokens) !== canonicalJson(next.tokens) &&
    !fullerHistoryTokens(old, next) &&
    !grown
  )
    return "conflict";
  return "improved";
}
export const HistoryFileSeriesSchema = z.strictObject({
  quantity: z.literal("extracted_file_text"),
  scope: z.literal("extracted_file_text"),
  unit: z.literal("tokens"),
  additive: z.literal(false),
  value: CounterSchema.nullable(),
  measurement_group: z.strictObject({
    origin: z.enum(["new_upload", "retained_context", "unknown_origin"]),
    extraction_profile_id: ExtractionProfileSchema,
    evidence: z.enum(["heuristic_estimate", "unknown"]),
    profile_id: profile,
  }),
  applicable_count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  contributing_component_count: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER),
  unknown_count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  partial_count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  unvalidated_count: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER),
  reason_counts: z.partialRecord(
    ReasonCodeSchema,
    z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  ),
  missing_counts: z.partialRecord(
    FileCoverageReasonSchema,
    z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  ),
});
export type HistoryFileSeries = z.infer<typeof HistoryFileSeriesSchema>;

function validateHistorySummary(value: HistorySummary, ctx: z.RefinementCtx) {
  const fields = [
    "observed_prompt_count",
    "observed_response_count",
    "prompt_count",
    "response_count",
    "dated_message_count",
    "undated_message_count",
    "calculated_message_count",
    "uncalculated_message_count",
    "matched_live_message_count",
    "unresolved_overlap_message_count",
    "conflicting_message_count",
  ] as const;
  if (fields.some((key) => !CounterSchema.safeParse(value[key]).success))
    return;
  const n = (key: (typeof fields)[number]) => BigInt(value[key]);
  // `prompt_count` counts requests: each contributing prompt, plus each contributing
  // regenerated Claude reply (`regeneratedHistoryReplies`), which `response_count` also
  // counts as a reply. So the two may exceed the contributing messages by at most the
  // replies, and never fall below them.
  const observed = n("observed_prompt_count") + n("observed_response_count"),
    contributing =
      n("calculated_message_count") + n("uncalculated_message_count"),
    regenerated = n("prompt_count") + n("response_count") - contributing;
  if (
    observed !== n("dated_message_count") + n("undated_message_count") ||
    observed !==
      contributing +
        n("matched_live_message_count") +
        n("conflicting_message_count") ||
    regenerated < 0n ||
    regenerated > n("response_count") ||
    // Rows no live capture can produce (no_live_request) contribute without waiting for a
    // live match, so only the other contributing rows are unresolved.
    n("unresolved_overlap_message_count") > contributing
  )
    ctx.addIssue({
      code: "custom",
      message: "Inconsistent historical coverage",
    });
  for (const resource of value.resources)
    if (
      (resource.value === null) !== (resource.status === "unavailable") ||
      (!("requested_method" in resource) &&
        (resource.profile_selection === "unavailable") !==
          (resource.selected_profile_id === null))
    )
      ctx.addIssue({
        code: "custom",
        message: "Inconsistent historical assessment",
      });
}

export const HistoryResourcesSchema = z
  .array(
    z.union([
      z.strictObject({
        quantity: z.enum([
          "energy",
          "carbon",
          "water_direct",
          "water_upstream",
          "water_total",
        ]),
        value: DecimalSchema.nullable(),
        unit: z.enum(["kWh", "gCO2e", "gCO2", "L"]),
        scope: z.literal("historical_visible_response"),
        method_id: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,127}$/),
        method_hash: OpaqueKeySchema,
        status: z.enum(["partial_estimate", "unavailable"]),
        validation_state: z.literal("unvalidated_reference"),
        profile_selection: z.enum(["highest_comparable", "unavailable"]),
        selected_profile_id: z
          .string()
          .regex(/^[a-z0-9][a-z0-9.-]{0,159}$/)
          .nullable(),
        reasons: z.array(ReasonCodeSchema).max(32),
        missing_components: z
          .array(z.string().regex(/^[a-z0-9_]{1,100}$/))
          .max(32),
        known_message_count: CounterSchema,
        unknown_message_count: CounterSchema,
      }),
      HistoricalResourceV2Schema,
    ]),
  )
  .max(160);
export const HistorySummarySchema = z
  .strictObject({
    schema_version: z.literal(SCHEMA_VERSION),
    scope: z.literal("loaded_history"),
    status: z.enum(["available", "empty", "unavailable"]),
    observed_prompt_count: CounterSchema,
    observed_response_count: CounterSchema,
    prompt_count: CounterSchema,
    response_count: CounterSchema,
    dated_message_count: CounterSchema,
    undated_message_count: CounterSchema,
    calculated_message_count: CounterSchema,
    uncalculated_message_count: CounterSchema,
    matched_live_message_count: CounterSchema,
    unresolved_overlap_message_count: CounterSchema,
    conflicting_message_count: CounterSchema,
    first_request_verified: z.boolean(),
    branch_scope: z.enum(["selected_branch", "loaded_messages", "unknown"]),
    provider_history_complete: z.literal(false),
    tokens: z
      .array(
        z.strictObject({
          role: z.enum(["prompt", "response"]),
          part: z.enum(HISTORY_TOKEN_PARTS),
          profile_id: profile,
          evidence: z.enum(["heuristic_estimate", "provider_reported", "unknown"]),
          value: CounterSchema.nullable(),
          known_message_count: CounterSchema,
          unknown_message_count: CounterSchema,
        }),
      )
      .max(128),
    file_text: z.array(HistoryFileSeriesSchema).max(256),
    file_text_coverage: z.strictObject({
      observed_message_count: CounterSchema,
      unknown_message_count: CounterSchema,
      scope: z.literal("extracted_file_text"),
      additive: z.literal(false),
    }),
    resources: HistoryResourcesSchema,
  })
  .superRefine(validateHistorySummary);

export function compareHistoricalInstants(a: string, b: string): number {
  const normalize = (value: string) =>
    HistoricalInstantSchema.parse(value).replace(
      /\.(\d{3,6})Z$/,
      (_, fraction: string) => "." + fraction.padEnd(6, "0") + "Z",
    );
  const left = normalize(a),
    right = normalize(b);
  return left < right ? -1 : left > right ? 1 : 0;
}
/**
 * The saved Claude chat replies that regenerated an earlier reply to the same prompt. Each
 * was its own request (`retry_completion`), so a summary counts it as one request when no
 * live capture matched it (owner rule of 26 Sep 2026: Req counts every request in a chat).
 * The prompt counts the original send, so the earliest reply under a prompt is never one.
 * Only claude.ai chat replies qualify: each reply there is one completion with its own id
 * (`provider_attempt_key`) and answers its prompt directly. Cowork results carry no reply id,
 * and other sites may save several messages under one request (ChatGPT thoughts and answer),
 * so their rows never count here.
 * Earliest is by `occurred_at`, undated rows last, then by `message_key`, so every reader
 * (and the server's mirror in `historical_usage.py`) picks the same first reply.
 * Returns message keys.
 */
export function regeneratedHistoryReplies(
  records: Iterable<
    Pick<
      HistoryMessage,
      | "message_key"
      | "role"
      | "site"
      | "conversation_key"
      | "parent_key"
      | "prompt_key"
      | "provider_attempt_key"
      | "occurred_at"
    >
  >,
): Set<string> {
  const groups = new Map<string, Map<string, string | null>>();
  for (const record of records) {
    if (
      record.role !== "response" ||
      record.site !== "claude" ||
      record.provider_attempt_key === null ||
      record.prompt_key === null ||
      record.parent_key !== record.prompt_key
    )
      continue;
    const group = record.conversation_key + ":" + record.prompt_key;
    const replies = groups.get(group) ?? new Map<string, string | null>();
    replies.set(record.message_key, record.occurred_at);
    groups.set(group, replies);
  }
  const regenerated = new Set<string>();
  for (const replies of groups.values()) {
    if (replies.size < 2) continue;
    const ordered = [...replies].sort(([aKey, aAt], [bKey, bAt]) => {
      if (aAt !== null && bAt !== null) {
        const order = compareHistoricalInstants(aAt, bAt);
        if (order) return order;
      } else if (aAt !== bAt) return aAt === null ? 1 : -1;
      return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
    });
    for (const [key] of ordered.slice(1)) regenerated.add(key);
  }
  return regenerated;
}
export function mergeHistoryCoverage(
  previous: HistoryPage | null,
  next: HistoryPage,
): HistoryPage {
  if (!previous || previous.conversation_key !== next.conversation_key)
    return next;
  if (previous.observed_at > next.observed_at) {
    // An older read can commit after a newer one: a ChatGPT page of earlier turns that
    // reaches the chat's start may answer after a later poll of the newest turns. Its
    // proof of the first request still holds, so it is kept with the newer selection.
    if (
      next.first_request_verified &&
      !previous.first_request_verified &&
      (previous.root_message_key === null ||
        previous.root_message_key === next.root_message_key)
    )
      return {
        ...previous,
        root_message_key: next.root_message_key,
        first_request_verified: true,
      };
    return previous;
  }
  const root = next.root_message_key ?? previous.root_message_key;
  return {
    ...next,
    root_message_key: root,
    first_request_verified:
      next.first_request_verified ||
      (previous.first_request_verified && previous.root_message_key === root),
  };
}
