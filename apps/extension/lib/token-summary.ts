import type { TokenFields, TokenMeasurement } from "@footprint/contracts";

export const tokenSignature = (m: TokenMeasurement) =>
  JSON.stringify([m.scope, m.profile_id, m.evidence, m.completeness]);

/**
 * Summary keys of the token figures that Details lists, input side first, with the synced
 * quantity each one reads. Other models' output has no attempt field: it comes from the
 * reply's text components (D3).
 */
export const TOKEN_TOTAL_FIELDS = {
  newInput: "new_input_text",
  toolOutput: "tool_output",
  imageInput: "image_input_tokens",
  logicalInput: "logical_input_total",
  output: "output_total",
  answer: "answer_output",
  thinking: "visible_thinking",
  toolInput: "tool_input",
  intermediate: "intermediate_output",
  reasoning: "reported_reasoning",
  otherModels: "other_model_output",
} as const;
type TotalKey = keyof typeof TOKEN_TOTAL_FIELDS;
/** Synced quantities that add up to "Out". */
export const OUTPUT_QUANTITIES = [
  "output_total",
  "other_model_output",
] as const;

/**
 * The bar's "In": the new input text plus what the model read besides it, tool results
 * shown in full (A6) and uploaded images (A7). "Out" is the output total plus the output
 * of other models in the reply (D3).
 */
export const INPUT_FIELDS = [
  "new_input_text",
  "tool_output",
  "image_input_tokens",
] as const;

type TokenGroup = Pick<
  TokenMeasurement,
  "scope" | "profile_id" | "evidence" | "completeness"
> & { value: string; known: number };
/**
 * A token figure across replies. The value adds every known count: token counts are
 * approximate, so the tokenizer, evidence or completeness of each reply never hides the
 * total. `partial` counts known values that miss part of their scope; the groups keep
 * those details for Details.
 */
export type TokenTotal = {
  value: string | null;
  known: number;
  unknown: number;
  partial: number;
  /** Replies where the field does not apply, such as a prompt without images. */
  notApplicable: number;
  groups: TokenGroup[];
};

class FieldTotal {
  private groups = new Map<string, TokenGroup>();
  private sum = 0n;
  private known = 0;
  private unknown = 0;
  private partial = 0;
  private notApplicable = 0;
  add(m: TokenMeasurement) {
    // A field that does not apply (no images uploaded) is neither counted nor missing.
    if (m.evidence === "not_applicable") {
      this.notApplicable++;
      return;
    }
    if (m.value === null) {
      this.unknown++;
      return;
    }
    const signature = tokenSignature(m);
    const group = this.groups.get(signature) ?? {
      scope: m.scope,
      profile_id: m.profile_id,
      evidence: m.evidence,
      completeness: m.completeness,
      value: "0",
      known: 0,
    };
    group.value = (BigInt(group.value) + BigInt(m.value)).toString();
    group.known++;
    this.groups.set(signature, group);
    this.sum += BigInt(m.value);
    this.known++;
    if (m.completeness !== "complete_for_scope") this.partial++;
  }
  result(): TokenTotal {
    return {
      value: this.known ? this.sum.toString() : null,
      known: this.known,
      unknown: this.unknown,
      partial: this.partial,
      notApplicable: this.notApplicable,
      groups: [...this.groups.values()],
    };
  }
}

/** "In" of one reply: the parts that apply, partial when one of them is not known. */
class InputTotal {
  private sum = 0n;
  private known = 0;
  private unknown = 0;
  private partial = 0;
  private notApplicable = 0;
  add(tokens: TokenFields) {
    const parts = INPUT_FIELDS.map((field) => tokens[field]).filter(
      (m) => m.evidence !== "not_applicable",
    );
    const known = parts.filter((m) => m.value !== null);
    if (!known.length) {
      if (parts.length) this.unknown++;
      else this.notApplicable++;
      return;
    }
    this.known++;
    for (const m of known) this.sum += BigInt(m.value!);
    if (
      known.length < parts.length ||
      known.some((m) => m.completeness !== "complete_for_scope")
    )
      this.partial++;
  }
  result(): TokenTotal {
    return {
      value: this.known ? this.sum.toString() : null,
      known: this.known,
      unknown: this.unknown,
      partial: this.partial,
      notApplicable: this.notApplicable,
      groups: [],
    };
  }
}

/**
 * "Out" of one reply: its own output total plus the output of other models in it (D3:
 * side calls, research agents, storyboards), which is generated output outside that total.
 * A part that is not known leaves Out partial, never lower without saying so.
 */
export function outputWithOtherModels(
  total: TokenMeasurement,
  components: readonly TokenMeasurement[],
): TokenMeasurement {
  if (!components.length) return total;
  const all = [total, ...components];
  const known = all.filter((m) => m.value !== null);
  if (!known.length) return total;
  const missing = all.find(
    (m) => m.value === null && m.evidence !== "not_applicable",
  );
  const single = <T>(values: T[], fallback: T) =>
    new Set(values).size === 1 ? values[0]! : fallback;
  const partial =
    !!missing || known.some((m) => m.completeness !== "complete_for_scope");
  return {
    value: known.reduce((sum, m) => sum + BigInt(m.value!), 0n).toString(),
    evidence: single(
      known.map((m) => m.evidence),
      "heuristic_estimate",
    ),
    scope: single(
      known.map((m) => m.scope),
      "observed_text",
    ),
    completeness: partial ? "partial" : "complete_for_scope",
    profile_id: single(
      known.map((m) => m.profile_id),
      null,
    ),
    reason: missing
      ? (missing.reason ?? "partial_capture")
      : (known.find((m) => m.reason !== null)?.reason ?? null),
  };
}

export class TokenTotals {
  private input = new InputTotal();
  private fields = Object.fromEntries(
    Object.keys(TOKEN_TOTAL_FIELDS).map((key) => [key, new FieldTotal()]),
  ) as Record<TotalKey, FieldTotal>;
  /** One reply: its token fields and the token counts of other models' output in it. */
  add(tokens: TokenFields, components: readonly TokenMeasurement[] = []) {
    this.input.add(tokens);
    for (const [key, field] of Object.entries(TOKEN_TOTAL_FIELDS) as Array<
      [TotalKey, (typeof TOKEN_TOTAL_FIELDS)[TotalKey]]
    >)
      if (key === "output")
        this.fields.output.add(
          outputWithOtherModels(tokens.output_total, components),
        );
      else if (key === "otherModels")
        for (const component of components)
          this.fields.otherModels.add(component);
      else this.fields[key].add(tokens[field as keyof TokenFields]);
  }
  result(): Record<TotalKey | "input", TokenTotal> {
    return {
      input: this.input.result(),
      ...(Object.fromEntries(
        Object.entries(this.fields).map(([key, field]) => [
          key,
          field.result(),
        ]),
      ) as Record<TotalKey, TokenTotal>),
    };
  }
}

/** Details labels: the bar's "In" and "Out", then each part, input side first. */
export const TOKEN_LABELS = {
  input: "In: new input text, tool results and uploaded images",
  newInput: "New input text",
  toolOutput: "Tool results read as input",
  imageInput: "Uploaded images",
  logicalInput: "Reconstructed input",
  output: "Out: generated output, other models included",
  answer: "Observed answer",
  thinking: "Visible thinking",
  toolInput: "Tool input written by the model",
  intermediate: "Other generated text",
  reasoning: "Reasoning reported by the provider",
  otherModels: "Output of other models",
} as const;
export type TokenTotalKey = keyof typeof TOKEN_LABELS;

const replies = (n: number, format: (value: string) => string) =>
  `${format(String(n))} ${n === 1 ? "reply" : "replies"}`;

/**
 * One Details line for a token figure: the approximate count, then how many replies it
 * misses or covers in part. Without counts (a combined synced figure) it is the count alone.
 * "Not applicable" needs replies where the field does not apply and none where it is unknown.
 */
export function tokenTotalText(
  total: {
    value: string | null;
    unknown?: number;
    partial?: number;
    notApplicable?: number;
  },
  format: (value: string) => string,
): string {
  if (total.value === null)
    return !total.unknown && (total.notApplicable ?? 0) > 0
      ? "Not applicable"
      : "Unknown";
  return [
    `≈ ${format(total.value)} tokens`,
    total.unknown ? `not measured for ${replies(total.unknown, format)}` : "",
    total.partial
      ? `measured in part for ${replies(total.partial, format)}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

const PART_NOTES = [
  ["newInput", "typed text"],
  ["toolOutput", "tool results"],
  ["imageInput", "uploaded images"],
  ["answer", "answer text"],
  ["thinking", "visible thinking"],
  ["toolInput", "tool input"],
  ["intermediate", "other generated text"],
] as const;
type PartCounts = Partial<
  Record<(typeof PART_NOTES)[number][0], { unknown?: number; partial?: number }>
>;

/**
 * "Partly measured" belongs in Details only (owner decision, 2 Oct): which parts were not
 * read or were read in part, and how many replies have no resource estimate. It is
 * ordinary uncertainty, not an error, and null when everything was measured.
 */
export function partlyMeasuredText(
  parts: PartCounts,
  unestimated: number,
  format: (value: string) => string,
  /** Replies counted around stream events the tracker does not know (owner, 2 Oct). */
  unknownEvents = 0,
): string | null {
  const list = (field: "unknown" | "partial") =>
    PART_NOTES.flatMap(([key, label]) => {
      const n = parts[key]?.[field] ?? 0;
      return n > 0 ? [`${label} (${replies(n, format)})`] : [];
    });
  const missing = list("unknown"),
    incomplete = list("partial");
  const notes = [
    missing.length ? `Not read: ${missing.join(", ")}.` : "",
    incomplete.length ? `Read in part: ${incomplete.join(", ")}.` : "",
    unestimated > 0
      ? `No resource estimate: ${replies(unestimated, format)}.`
      : "",
    unknownEvents > 0
      ? `Counted around stream events the tracker does not know: ${replies(unknownEvents, format)}.`
      : "",
  ].filter(Boolean);
  return notes.length
    ? `Partly measured. ${notes.join(" ")} A part that was not read is not counted as zero.`
    : null;
}
