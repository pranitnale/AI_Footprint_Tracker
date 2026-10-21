import type {
  GeneratedComponent,
  GeneratedMedia,
  ImageOperation,
  ProviderUsage,
  Snapshot,
} from "@footprint/adapters";
import {
  historyResponseParts,
  unknownMeasurement,
  type AttemptObservation,
  type Generation,
  type HistoryParts,
  type MediaOutput,
  type ReasonCode,
  type ReplyTextPart,
  type Site,
  type TextComponent,
  type TokenFields,
  type TokenMeasurement,
} from "@footprint/contracts";
import type { CountField, CountResponse } from "@footprint/tokenizers/metadata";
import {
  resolveModelLabel,
  resolveVideoModel,
  storableModelLabel,
  unknownModelLabel,
} from "./models";

/** Count fields of a reply's own text and the token field each one fills. */
export const TEXT_PARTS = [
  ["input", "new_input_text"],
  ["answer", "answer_output"],
  ["thinking", "visible_thinking"],
  ["tool_input", "tool_input"],
  ["intermediate", "intermediate_output"],
  ["tool_output", "tool_output"],
] as const satisfies ReadonlyArray<readonly [CountField, keyof TokenFields]>;

/** Count fields of generated text beyond the answer and thinking (`GeneratedText`). */
export const GENERATED_TEXT_FIELDS: ReadonlySet<CountField> = new Set([
  "tool_input",
  "intermediate",
  "tool_output",
]);

/**
 * Why a part stays unknown when the site's adapter does not read it. Details names the
 * reason; the output total stays partial instead of silently lower.
 */
export const UNREAD_PART_REASONS = {
  visible_thinking: "observed_text_only",
  tool_input: "tool_work_unobserved",
  intermediate_output: "observed_text_only",
  tool_output: "tool_work_unobserved",
} as const satisfies Partial<Record<keyof TokenFields, ReasonCode>>;

/** Token fields of a new attempt: nothing is known, and unread parts say why. */
export function initialReplyTokens(base: TokenFields): TokenFields {
  const tokens = { ...base };
  for (const [part, reason] of Object.entries(UNREAD_PART_REASONS))
    tokens[part as keyof typeof UNREAD_PART_REASONS] =
      unknownMeasurement(reason);
  return tokens;
}

/** The texts of one snapshot to count, keyed by count field. */
export function snapshotCountFields(
  snapshot: Snapshot,
): Partial<Record<CountField, string>> {
  const fields: Partial<Record<CountField, string>> = {};
  if (snapshot.text !== null) fields.answer = snapshot.text;
  if (snapshot.thinking !== null) fields.thinking = snapshot.thinking;
  if (snapshot.toolInput !== undefined) fields.tool_input = snapshot.toolInput;
  if (snapshot.intermediate !== undefined)
    fields.intermediate = snapshot.intermediate;
  if (snapshot.toolOutput !== undefined)
    fields.tool_output = snapshot.toolOutput;
  snapshot.components?.forEach((component, index) => {
    if (component.text !== null) fields[`component_${index}`] = component.text;
  });
  return fields;
}

/**
 * A recount never erases or lowers a known count of the same reply (X9). A failed count
 * keeps the last value, marked partial when the text changed since it was counted. A
 * lower count of the same profile keeps the higher one: those tokens were generated,
 * even if the page later shows less.
 */
export function retainedCount(
  previous: TokenMeasurement,
  next: TokenMeasurement | undefined,
  textChanged: boolean,
): TokenMeasurement {
  if (!next || next.value === null) {
    if (previous.value === null || previous.evidence === "provider_reported")
      return previous.value === null
        ? (next ?? unknownMeasurement("tokenizer_unavailable"))
        : previous;
    return textChanged
      ? {
          ...previous,
          completeness: "partial",
          reason: "tokenizer_unavailable",
        }
      : previous;
  }
  if (
    previous.value !== null &&
    previous.evidence === next.evidence &&
    previous.profile_id === next.profile_id &&
    BigInt(previous.value) > BigInt(next.value)
  )
    return previous;
  return next;
}

/** A count the provider reported for the request itself. */
export function providerCount(value: number): TokenMeasurement {
  return {
    value: String(value),
    evidence: "provider_reported",
    scope: "provider_request",
    completeness: "complete_for_scope",
    profile_id: null,
    reason: null,
  };
}

/**
 * Exact provider counts replace counted parts: the total, the reasoning inside it and the
 * input split. The logical input is the sum of the three input fields when all are known.
 */
export function applyProviderUsage(
  tokens: TokenFields,
  usage: ProviderUsage,
): TokenFields {
  const next = { ...tokens, output_total: providerCount(usage.output) };
  if (usage.reasoning !== null)
    next.reported_reasoning = providerCount(usage.reasoning);
  if (usage.input !== null) next.input_uncached = providerCount(usage.input);
  if (usage.cacheRead !== null)
    next.input_cache_read = providerCount(usage.cacheRead);
  if (usage.cacheWrite !== null)
    next.input_cache_write = providerCount(usage.cacheWrite);
  if (
    usage.input !== null &&
    usage.cacheRead !== null &&
    usage.cacheWrite !== null
  )
    next.logical_input_total = providerCount(
      usage.input + usage.cacheRead + usage.cacheWrite,
    );
  return next;
}

/** True when the output total is the provider's own count rather than a sum of parts. */
export function providerTotal(tokens: TokenFields): boolean {
  return (
    tokens.output_total.evidence === "provider_reported" &&
    tokens.output_total.scope === "provider_request" &&
    tokens.output_total.value !== null
  );
}

const decimal = (value: number) => {
  // Media lengths are bounded positive numbers; fixed notation keeps the decimal schema.
  const text = Number(value.toFixed(6)).toString();
  return text.includes("e") ? value.toFixed(6) : text;
};

/** Text written by another model than the reply's own, with labels resolved locally. */
export function textComponents(
  site: Site,
  components: readonly GeneratedComponent[],
  previous: readonly TextComponent[],
  counts: CountResponse["counts"],
  changed: (field: CountField) => boolean,
  unknownLabels: Set<string>,
): TextComponent[] {
  return components.map((component, index) => {
    const model = resolveModelLabel(site, component.model);
    const unknown = unknownModelLabel(model, component.model);
    if (unknown) unknownLabels.add(unknown);
    const field: CountField = `component_${index}`;
    const before = previous[index];
    const tokens =
      component.outputTokens !== null
        ? providerCount(component.outputTokens)
        : retainedCount(
            before?.role === component.role
              ? before.tokens
              : unknownMeasurement("tokenizer_unavailable"),
            counts[field]?.measurement,
            changed(field),
          );
    return {
      role: component.role,
      model_id: model?.id ?? null,
      model_evidence: model ? "response_field" : "unknown",
      tokens,
      timing: component.timing ?? null,
    };
  });
}

/** Media facts as the page shows them; defaults are the estimator's. */
export function snapshotMedia(
  site: Site,
  media: readonly GeneratedMedia[],
  unknownLabels: Set<string>,
): MediaOutput[] {
  return media.map((item): MediaOutput => {
    if (item.kind === "image") {
      const model = resolveModelLabel(site, item.model);
      const unknown = unknownModelLabel(model, item.model);
      if (unknown) unknownLabels.add(unknown);
      return {
        kind: "image",
        model_id: model?.unlisted ? null : (model?.id ?? null),
        count: String(item.count),
        width: item.width,
        height: item.height,
        outcome: item.outcome,
      };
    }
    if (item.kind === "video") {
      const model = resolveVideoModel(site, item.model);
      if (model === "perplexity-video-unlisted") {
        const label = storableModelLabel(item.model);
        if (label) unknownLabels.add(label);
      }
      return {
        kind: "video",
        model_id: model,
        width: item.width,
        height: item.height,
        duration_seconds:
          item.durationSeconds === null ? null : decimal(item.durationSeconds),
        with_audio: item.withAudio,
      };
    }
    if (item.kind === "speech")
      return {
        kind: "speech",
        length_basis: item.basis,
        seconds: item.seconds === null ? null : decimal(item.seconds),
        characters: item.characters === null ? null : String(item.characters),
      };
    return {
      kind: "video_overview",
      duration_seconds: decimal(item.durationSeconds),
    };
  });
}

/**
 * Generated images: one entry per returned size, or one started image when an operation
 * shows that generation began but returned nothing (D1).
 */
export function imageMedia(
  site: Site,
  operations: readonly ImageOperation[],
  unknownLabels: Set<string>,
): MediaOutput[] {
  const items: MediaOutput[] = [];
  for (const operation of operations) {
    const raw = operation.model ?? null;
    const model = resolveModelLabel(site, raw);
    const unknown = unknownModelLabel(model, raw);
    if (unknown) unknownLabels.add(unknown);
    const model_id = model?.unlisted ? null : (model?.id ?? null);
    if (!operation.outputs.length) {
      items.push({
        kind: "image",
        model_id,
        count: "1",
        width: null,
        height: null,
        outcome: "started_not_returned",
      });
      continue;
    }
    const sizes = new Map<
      string,
      { width: number | null; height: number | null; count: number }
    >();
    for (const output of operation.outputs) {
      const key = `${output.width}x${output.height}`;
      const size = sizes.get(key) ?? {
        width: output.width,
        height: output.height,
        count: 0,
      };
      size.count++;
      sizes.set(key, size);
    }
    for (const size of sizes.values())
      items.push({
        kind: "image",
        model_id,
        count: String(size.count),
        // A size is a pair; half a size is not a fact.
        width: size.width !== null && size.height !== null ? size.width : null,
        height:
          size.width !== null && size.height !== null ? size.height : null,
        outcome: "returned",
      });
  }
  return items;
}

/**
 * Parts of a saved reply. A part the site's parser cannot read stays unknown with its
 * reason, exactly as on a live reply, so live and history follow one rule (D2).
 */
export function historyReplyParts(
  answer: TokenMeasurement,
  partTokens: Partial<Record<ReplyTextPart, TokenMeasurement>>,
  usage: ProviderUsage | undefined,
): HistoryParts {
  return historyResponseParts(answer, {
    visible_thinking:
      partTokens.visible_thinking ??
      unknownMeasurement(UNREAD_PART_REASONS.visible_thinking),
    tool_input:
      partTokens.tool_input ??
      unknownMeasurement(UNREAD_PART_REASONS.tool_input),
    intermediate_output:
      partTokens.intermediate_output ??
      unknownMeasurement(UNREAD_PART_REASONS.intermediate_output),
    tool_output:
      partTokens.tool_output ??
      unknownMeasurement(UNREAD_PART_REASONS.tool_output),
    reported_reasoning:
      usage?.reasoning != null
        ? providerCount(usage.reasoning)
        : unknownMeasurement("provider_usage_unavailable"),
  });
}

/** Generation of a saved reply: other-model text with labels resolved locally, and media. */
export function historyGeneration(
  site: Site,
  components: ReadonlyArray<{
    role: TextComponent["role"];
    model: string | null;
    tokens: TokenMeasurement;
    /** The component's own time, such as a research run's span. */
    timing?: TextComponent["timing"];
  }>,
  media: readonly GeneratedMedia[],
  unknownLabels: Set<string>,
): Generation {
  return {
    text_components: components.map((component) => {
      const model = resolveModelLabel(site, component.model);
      const unknown = unknownModelLabel(model, component.model);
      if (unknown) unknownLabels.add(unknown);
      return {
        role: component.role,
        model_id: model?.id ?? null,
        model_evidence: model ? "response_field" : "unknown",
        tokens: component.tokens,
        timing: component.timing ?? null,
      };
    }),
    media: snapshotMedia(site, media, unknownLabels),
  };
}

/** The generation of one snapshot: other-model text, media and images. */
export function snapshotGeneration(
  site: Site,
  snapshot: Snapshot,
  previous: AttemptObservation["generation"],
  counts: CountResponse["counts"],
  changed: (field: CountField) => boolean,
  unknownLabels: Set<string>,
): Generation {
  return {
    text_components: textComponents(
      site,
      snapshot.components ?? [],
      previous.text_components,
      counts,
      changed,
      unknownLabels,
    ),
    media: [
      ...imageMedia(site, snapshot.imageOperations, unknownLabels),
      ...snapshotMedia(site, snapshot.media ?? [], unknownLabels),
    ],
  };
}
