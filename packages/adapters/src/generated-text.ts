import { isTimingEvidence, LIMITS } from "@footprint/capture-core";
import type {
  GeneratedComponent,
  GeneratedMedia,
  GeneratedText,
  InputImage,
  ProviderUsage,
} from "./types";

export const GENERATED_TEXT_LIMITS = Object.freeze({
  // All generated text of one reply beyond the answer and thinking, so one count job
  // stays bounded however many fields a site fills.
  textUnits: 2 * LIMITS.text,
  components: 16,
  media: 64,
  inputImages: 32,
  tokens: 1_000_000_000,
  seconds: 86_400,
  label: 256,
});

const GENERATED_KEYS = [
  "toolInput",
  "intermediate",
  "toolOutput",
  "usage",
  "components",
  "media",
] as const;

const exactKeys = (value: object, keys: string) =>
  Object.keys(value).sort().join(",") === keys;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const count = (value: unknown, minimum = 0) =>
  Number.isSafeInteger(value) &&
  (value as number) >= minimum &&
  (value as number) <= GENERATED_TEXT_LIMITS.tokens;
const nullableCount = (value: unknown) => value === null || count(value);
const label = (value: unknown) =>
  value === null ||
  (typeof value === "string" && value.length <= GENERATED_TEXT_LIMITS.label);
const seconds = (value: unknown) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value > 0 &&
  value <= GENERATED_TEXT_LIMITS.seconds;
const dimension = (value: unknown) =>
  value === null ||
  (Number.isInteger(value) &&
    (value as number) > 0 &&
    (value as number) <= 65536);

/**
 * Generated text of one live reply that fits the bounds. A field over its own limit is left
 * out; if the rest is still too long, tool results go first (they are input only), then
 * intermediate text, then tool input. A field left out stays unknown.
 */
export function fitGeneratedText(parts: {
  toolInput?: string;
  intermediate?: string;
  toolOutput?: string;
}): Partial<Record<"toolInput" | "intermediate" | "toolOutput", string>> {
  const fitted: Partial<
    Record<"toolInput" | "intermediate" | "toolOutput", string>
  > = {};
  for (const key of ["toolInput", "intermediate", "toolOutput"] as const) {
    const text = parts[key];
    if (text !== undefined && text.length <= LIMITS.text) fitted[key] = text;
  }
  const size = () =>
    Object.values(fitted).reduce((sum, text) => sum + text.length, 0);
  for (const key of ["toolOutput", "intermediate", "toolInput"] as const)
    if (size() > GENERATED_TEXT_LIMITS.textUnits) delete fitted[key];
  return fitted;
}

/** The generated-text keys a message carries, for exact-key checks of its owner. */
export function generatedTextKeys(value: object): string[] {
  return GENERATED_KEYS.filter((key) => Object.hasOwn(value, key));
}

function validUsage(value: unknown): value is ProviderUsage {
  return (
    isRecord(value) &&
    exactKeys(value, "cacheRead,cacheWrite,input,output,reasoning") &&
    count(value.output) &&
    nullableCount(value.input) &&
    nullableCount(value.cacheRead) &&
    nullableCount(value.cacheWrite) &&
    nullableCount(value.reasoning) &&
    (value.reasoning === null ||
      (value.reasoning as number) <= (value.output as number))
  );
}

function validComponent(value: unknown): value is GeneratedComponent {
  return (
    isRecord(value) &&
    (exactKeys(value, "model,outputTokens,role,text") ||
      (exactKeys(value, "model,outputTokens,role,text,timing") &&
        isTimingEvidence(value.timing))) &&
    ["side_calls", "research", "storyboard"].includes(value.role as string) &&
    label(value.model) &&
    (value.text === null || typeof value.text === "string") &&
    nullableCount(value.outputTokens) &&
    // A component is either counted from its text or reported by the provider.
    (value.text === null) !== (value.outputTokens === null)
  );
}

function validMedia(value: unknown): value is GeneratedMedia {
  if (!isRecord(value)) return false;
  if (value.kind === "image")
    return (
      exactKeys(value, "count,height,kind,model,outcome,width") &&
      label(value.model) &&
      Number.isSafeInteger(value.count) &&
      (value.count as number) >= 1 &&
      (value.count as number) <= 100 &&
      dimension(value.width) &&
      dimension(value.height) &&
      (value.width === null) === (value.height === null) &&
      (value.outcome === "returned" ||
        (value.outcome === "started_not_returned" && value.count === 1))
    );
  if (value.kind === "video")
    return (
      exactKeys(value, "durationSeconds,height,kind,model,width,withAudio") &&
      label(value.model) &&
      dimension(value.width) &&
      dimension(value.height) &&
      (value.width === null) === (value.height === null) &&
      (value.durationSeconds === null || seconds(value.durationSeconds)) &&
      (value.withAudio === null || typeof value.withAudio === "boolean")
    );
  if (value.kind === "speech")
    return (
      exactKeys(value, "basis,characters,kind,seconds") &&
      (value.basis === "characters"
        ? value.seconds === null && count(value.characters, 1)
        : (value.basis === "audio_frames" || value.basis === "stored_length") &&
          value.characters === null &&
          seconds(value.seconds))
    );
  return (
    value.kind === "video_overview" &&
    exactKeys(value, "durationSeconds,kind") &&
    seconds(value.durationSeconds)
  );
}

/**
 * Checks the generated-text fields of a snapshot or history message. Provider usage is
 * read only on Claude (Cowork and AI artifacts report it); other sites never send it.
 * Live snapshots report images as image operations, so their media list has none.
 */
export function validGeneratedText(
  value: GeneratedText,
  site: string,
  source: "live" | "history" = "history",
): boolean {
  let units = 0;
  for (const key of ["toolInput", "intermediate", "toolOutput"] as const) {
    if (!Object.hasOwn(value, key)) continue;
    const text = value[key];
    if (typeof text !== "string" || text.length > LIMITS.text) return false;
    units += text.length;
  }
  if (
    Object.hasOwn(value, "usage") &&
    (site !== "claude" || !validUsage(value.usage))
  )
    return false;
  if (Object.hasOwn(value, "components")) {
    const components = value.components;
    if (
      !Array.isArray(components) ||
      components.length > GENERATED_TEXT_LIMITS.components ||
      !components.every(validComponent)
    )
      return false;
    for (const component of components) units += component.text?.length ?? 0;
  }
  if (
    Object.hasOwn(value, "media") &&
    (!Array.isArray(value.media) ||
      value.media.length > GENERATED_TEXT_LIMITS.media ||
      !value.media.every(validMedia) ||
      (source === "live" && value.media.some((item) => item.kind === "image")))
  )
    return false;
  return units <= GENERATED_TEXT_LIMITS.textUnits;
}

/** Checks the uploaded image sizes of a dispatch or history prompt. */
export function validInputImages(value: unknown): value is InputImage[] {
  return (
    Array.isArray(value) &&
    value.length <= GENERATED_TEXT_LIMITS.inputImages &&
    value.every(
      (image) =>
        isRecord(image) &&
        exactKeys(image, "height,width") &&
        dimension(image.width) &&
        dimension(image.height) &&
        (image.width === null) === (image.height === null),
    )
  );
}
