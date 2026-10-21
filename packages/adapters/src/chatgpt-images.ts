import { CaptureError } from "@footprint/capture-core";
import type { ImageOperation } from "./types";
import { isChatgptAsyncJob } from "./chatgpt-content";
const identity = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 512;
const dimension = (v: unknown) =>
  Number.isInteger(v) && (v as number) > 0 && (v as number) <= 65536
    ? (v as number)
    : null;
/** Consumer image metadata identifies an operation independently of display message IDs. */
export class ChatgptImages {
  private operations = new Map<string, ImageOperation>();
  private provisional = new Map<string, string>();
  private resolvedMessages = new Set<string>();
  observe(message: any): void {
    if (message?.author?.role !== "tool") return;
    // A stopped image job (I3, 3 Oct): the tool's asynchronous message ends interrupted
    // without an image. Its name is opaque, so the metadata decides, and a job already seen
    // is not counted again.
    if (
      identity(message.id) &&
      isChatgptAsyncJob(message) &&
      message.metadata?.finish_details?.type === "interrupted" &&
      !(
        Array.isArray(message.content?.parts) &&
        message.content.parts.some(
          (part: any) => part?.content_type === "image_asset_pointer",
        )
      ) &&
      this.operations.size === 0
    ) {
      if (message.id.length > 480) throw new CaptureError("buffer_overflow");
      const key = `pending-message:${message.id}`;
      this.provisional.set(message.id, key);
      this.operations.set(key, {
        id: key,
        parentId: null,
        kind: "unknown",
        requestedCount: null,
        outputs: [],
        state: "generating",
      });
      return;
    }
    if (message.content?.content_type !== "multimodal_text") return;
    if (!Array.isArray(message.content.parts))
      throw new CaptureError("unsupported_schema");
    const images = message.content.parts.filter(
      (part: any) => part?.content_type === "image_asset_pointer",
    );
    if (!images.length) {
      // This scoped consumer event precedes the asset in the observed protocol.
      // The dynamic tool name alone is not evidence of image execution.
      if (
        identity(message.id) &&
        message.metadata?.ghostrider?.status === "intermediate" &&
        !this.provisional.has(message.id) &&
        !this.resolvedMessages.has(message.id)
      ) {
        if (this.operations.size >= 50 || message.id.length > 480)
          throw new CaptureError("buffer_overflow");
        const key = `pending-message:${message.id}`;
        this.provisional.set(message.id, key);
        this.operations.set(key, {
          id: key,
          parentId: null,
          kind: "unknown",
          requestedCount: null,
          outputs: [],
          state: "generating",
        });
      }
      return;
    }
    const pendingKey = this.provisional.get(message.id);
    if (
      this.resolvedMessages.size >= 256 &&
      !this.resolvedMessages.has(message.id)
    )
      throw new CaptureError("buffer_overflow");
    for (const part of images) {
      const generation = part.metadata?.generation;
      const dalle = part.metadata?.dalle;
      const id = generation?.gen_id ?? dalle?.gen_id;
      if (!identity(id)) throw new CaptureError("unsupported_schema");
      if (
        generation?.gen_id &&
        dalle?.gen_id &&
        generation.gen_id !== dalle.gen_id
      )
        throw new CaptureError("conflicting_duplicate");
      const parent = generation?.parent_gen_id ?? dalle?.parent_gen_id;
      if (
        generation?.parent_gen_id &&
        dalle?.parent_gen_id &&
        generation.parent_gen_id !== dalle.parent_gen_id
      )
        throw new CaptureError("conflicting_duplicate");
      const edit = dalle?.edit_op;
      const kind: ImageOperation["kind"] =
        typeof parent === "string" && edit === "transformation"
          ? "image_edit"
          : generation?.parent_gen_id === null && dalle?.edit_op === null
            ? "text_to_image"
            : "unknown";
      const operation: ImageOperation = this.operations.get(id) ?? {
        id,
        parentId: identity(parent) ? parent : null,
        kind,
        requestedCount: null,
        outputs: [],
        state: "generating",
      };
      if (operation.parentId !== (identity(parent) ? parent : null))
        throw new CaptureError("conflicting_duplicate");
      if (
        operation.kind !== "unknown" &&
        kind !== "unknown" &&
        operation.kind !== kind
      )
        throw new CaptureError("conflicting_duplicate");
      if (operation.kind === "unknown") operation.kind = kind;
      if (!identity(part.asset_pointer))
        throw new CaptureError("unsupported_schema");
      const partWidth = dimension(part.width),
        partHeight = dimension(part.height);
      const generationWidth = dimension(generation?.width),
        generationHeight = dimension(generation?.height);
      if (
        (partWidth !== null &&
          generationWidth !== null &&
          partWidth !== generationWidth) ||
        (partHeight !== null &&
          generationHeight !== null &&
          partHeight !== generationHeight)
      )
        throw new CaptureError("conflicting_duplicate");
      const width = partWidth ?? generationWidth,
        height = partHeight ?? generationHeight;
      const existing = operation.outputs.find(
        (output) => output.id === part.asset_pointer,
      );
      if (existing) {
        if (
          (existing.width !== null &&
            width !== null &&
            existing.width !== width) ||
          (existing.height !== null &&
            height !== null &&
            existing.height !== height)
        )
          throw new CaptureError("conflicting_duplicate");
        existing.width ??= width;
        existing.height ??= height;
      } else {
        const entries = [...this.operations.values()].reduce(
          (sum, op) => sum + 1 + op.outputs.length,
          0,
        );
        if (entries + (this.operations.has(id) ? 1 : 2) > 100)
          throw new CaptureError("buffer_overflow");
        operation.outputs.push({ id: part.asset_pointer, width, height });
      }
      if (message.metadata?.ghostrider?.status === "final")
        operation.state = "completed";
      this.operations.set(id, operation);
      if (pendingKey) {
        this.operations.delete(pendingKey);
        this.provisional.delete(message.id);
      }
      this.resolvedMessages.add(message.id);
    }
  }
  stopped(): void {
    for (const operation of this.operations.values())
      if (operation.state !== "completed") operation.state = "cancelled";
  }
  has(id: string) {
    return this.operations.has(id);
  }
  snapshot(): ImageOperation[] {
    return [...this.operations.values()].map((operation) => ({
      ...operation,
      outputs: operation.outputs.map((output) => ({ ...output })),
    }));
  }
}
