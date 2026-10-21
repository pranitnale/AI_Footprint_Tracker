import { patchAt, LIMITS, type SseFrame } from "@footprint/capture-core";
import { fitGeneratedText, GENERATED_TEXT_LIMITS } from "./generated-text";
import {
  knownPerplexityBlock,
  perplexityEntry,
  type PerplexityBlocks,
} from "./perplexity-content";
import { initialSnapshot, type ProtocolSession, type Snapshot } from "./types";
const MODEL_LABEL = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const record = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// Field names that would reach an object's prototype instead of a stored field.
const UNSAFE_FIELDS = new Set(["__proto__", "constructor", "prototype"]);

/** The block field that holds an answer block's content. */
function contentField(usage: string): string | null {
  if (usage === "workflow_root") return "workflow_block";
  if (usage === "ask_text" || /^ask_text_\d+_markdown$/.test(usage))
    return "markdown_block";
  return null;
}

export class PerplexitySession implements ProtocolSession {
  private state = initialSnapshot();
  private root: Record<string, unknown> = {};
  /**
   * Every block's latest fields by intended usage. A block arrives whole or as JSON-patch
   * `diff_block`s on one named field (9 Sep: even the first workflow came as a root
   * replace), so patches are followed for every block, not only answers: a video's
   * prompt and model can sit in any of them.
   */
  private blocks = new Map<string, Record<string, unknown>>();
  /** The field of each block whose patches could not be applied. */
  private broken = new Map<string, string>();
  /** A frame or block the reader does not know was not counted. */
  private unknown = false;
  frame({ value: v, event }: SseFrame): void {
    if (!v) return;
    if (
      event === "end_of_stream" &&
      typeof v === "object" &&
      Object.keys(v).length === 0
    )
      return;
    // Status-only resumptions also invalidate an earlier terminal marker.
    if (
      (this.state.state === "generating" || this.state.state === "completed") &&
      (v.text_completed === false || v.status === "IN_PROGRESS")
    )
      this.state.state = "generating";
    // Raw provider label of the model Perplexity reports it ran; the consumer normalizes it.
    if (
      typeof v.display_model === "string" &&
      MODEL_LABEL.test(v.display_model)
    ) {
      this.state.model = v.display_model;
      this.root.display_model = v.display_model;
    }
    if (typeof v.backend_uuid === "string" && UUID.test(v.backend_uuid))
      this.root.backend_uuid = v.backend_uuid;
    if (!Array.isArray(v.blocks)) {
      // Status frames carry no blocks; anything else is a frame this reader does not know.
      if (!(v.status || v.backend_uuid || v.uuid)) this.unknown = true;
    } else this.blocksFrame(v.blocks);
    if (
      this.state.state === "generating" &&
      v.final === true &&
      v.final_sse_message === true &&
      v.text_completed === true &&
      v.status === "COMPLETED"
    )
      this.state.state = "completed";
  }
  private blocksFrame(blocks: unknown[]) {
    for (const block of blocks) {
      if (!record(block) || typeof block.intended_usage !== "string") {
        this.unknown = true;
        continue;
      }
      const usage = block.intended_usage;
      const stored = this.blocks.get(usage) ?? {};
      this.blocks.set(usage, stored);
      // A field sent whole replaces the last one and repairs it.
      for (const [field, value] of Object.entries(block)) {
        if (field === "intended_usage" || field === "diff_block") continue;
        if (UNSAFE_FIELDS.has(field)) {
          this.unknown = true;
          continue;
        }
        stored[field] = structuredClone(value);
        if (this.broken.get(usage) === field) this.broken.delete(usage);
      }
      const diff = block.diff_block;
      if (diff === undefined || this.broken.has(usage)) continue;
      try {
        if (
          !record(diff) ||
          typeof diff.field !== "string" ||
          diff.field === "intended_usage" ||
          UNSAFE_FIELDS.has(diff.field) ||
          !Array.isArray(diff.patches)
        )
          throw new Error("unknown patch");
        let content = stored[diff.field] ?? null;
        for (const patch of diff.patches)
          content = patchAt(content, patch?.path, patch?.op, patch?.value);
        stored[diff.field] = content;
      } catch {
        // The block keeps its last content and the reply is partial until the field
        // arrives whole, so one unknown patch never fails the reply.
        this.broken.set(
          usage,
          record(diff) && typeof diff.field === "string"
            ? diff.field
            : (contentField(usage) ?? ""),
        );
      }
    }
  }
  stopped(): void {
    if (this.state.state === "generating") this.state.state = "cancelled";
  }
  completionVerified(): boolean {
    return this.state.state === "completed";
  }
  snapshot(): Snapshot {
    const unknown = this.unknown || this.broken.size > 0;
    const limitations = unknown
      ? [...this.state.limitations, "unknown_event_observed"]
      : this.state.limitations;
    if (!this.blocks.size) return { ...this.state, limitations };
    const blocks: PerplexityBlocks = {
      answers: new Map(),
      usages: new Set(this.blocks.keys()),
      // A block of a usage this reader does not know is not read, not even for media.
      all: [...this.blocks]
        .filter(([usage]) => knownPerplexityBlock(usage))
        // Stored blocks keep their usage as the map key; readers that pick blocks by
        // usage (Computer files) need it back, as saved blocks carry it.
        .map(([usage, stored]) => ({ ...stored, intended_usage: usage })),
      unknown: false,
    };
    for (const [usage, stored] of this.blocks) {
      const field = contentField(usage);
      if (field && Object.hasOwn(stored, field))
        blocks.answers.set(usage, stored[field]);
    }
    const entry = perplexityEntry(
      this.root,
      blocks,
      this.state.state === "completed",
    );
    // A part past its bound stays unknown instead of failing the reply.
    const bounded = (value: string | null) =>
      value !== null && value.length <= LIMITS.text ? value : null;
    const text = bounded(entry.answer);
    const thinking = bounded(entry.thinking);
    const overBound =
      (entry.answer !== null && text === null) ||
      thinking === null ||
      entry.videos.length + entry.images.length > GENERATED_TEXT_LIMITS.media;
    // One bound for all media, images first, as saved history applies it.
    const images = entry.images.slice(0, GENERATED_TEXT_LIMITS.media);
    const videos = entry.videos.slice(
      0,
      GENERATED_TEXT_LIMITS.media - images.length,
    );
    const generated = fitGeneratedText({
      toolInput: entry.toolInput,
      intermediate: entry.intermediate,
      toolOutput: entry.toolOutput,
    });
    return {
      ...this.state,
      text,
      thinking,
      ...generated,
      started:
        text !== null ||
        !!thinking ||
        !!generated.toolInput ||
        !!generated.intermediate,
      // The entry id is the reply's id live and saved, and the next send's parent (F1).
      outputId: entry.replyId,
      searchOperations: entry.searches,
      // Live replies report images as image operations, as on the other sites.
      ...(images.length && entry.replyId
        ? {
            imageOperations: [
              {
                id: `perplexity-images:${entry.replyId}`,
                parentId: null,
                model: images[0]!.model,
                kind: "text_to_image" as const,
                requestedCount: null,
                outputs: images.map((image, index) => ({
                  id: `${entry.replyId}:${index}`,
                  width: image.width,
                  height: image.height,
                })),
                state: this.state.state,
              },
            ],
          }
        : {}),
      ...(videos.length
        ? {
            media: videos.map((video) => ({
              kind: "video" as const,
              model: video.model,
              width: null,
              height: null,
              durationSeconds: null,
              withAudio: null,
            })),
          }
        : {}),
      limitations:
        (entry.unknown || overBound) &&
        !limitations.includes("unknown_event_observed")
          ? [...limitations, "unknown_event_observed"]
          : limitations,
    };
  }
}
