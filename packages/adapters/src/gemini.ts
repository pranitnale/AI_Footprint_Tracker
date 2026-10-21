import { safeJson, LIMITS } from "@footprint/capture-core";
import { fitGeneratedText, GENERATED_TEXT_LIMITS } from "./generated-text";
import {
  geminiField,
  geminiLabel,
  geminiReply,
  type GeminiReply,
} from "./gemini-content";
import {
  initialSnapshot,
  type GeneratedComponent,
  type GeneratedMedia,
  type ProtocolSession,
  type Snapshot,
} from "./types";

const CHAT = /^c_[0-9a-f]{16}$/;
const TURN = /^r_[0-9a-f]{16}$/;
const CANDIDATE = /^rc_[0-9a-f]{16}$/;
// Batch envelope rows around the reply frames; they carry no reply content.
const ENVELOPE_ROWS: ReadonlySet<unknown> = new Set(["di", "af.httprm", "e"]);
const bounded = (text: string | null) =>
  text !== null && text.length <= LIMITS.text ? text : null;

/**
 * The other models' text and the generated media of a reply, shared with saved history:
 * a research report under the turn's label and the longest video storyboard without a
 * model, so the Google benchmark applies (EP2, B2).
 */
export function geminiGenerated(
  reply: GeminiReply,
  label: string | null,
): { components: GeneratedComponent[]; videos: GeneratedMedia[] } {
  const components: GeneratedComponent[] = [];
  if (reply.report)
    components.push({
      role: "research",
      model: label,
      text: reply.report.text,
      outputTokens: null,
    });
  if (reply.storyboard)
    components.push({
      role: "storyboard",
      model: null,
      text: reply.storyboard,
      outputTokens: null,
    });
  // Audio is not stored with a video; the site default applies (D3).
  const videos: GeneratedMedia[] = reply.videos.map((video) => ({
    kind: "video",
    model: video.model,
    width: video.width,
    height: video.height,
    durationSeconds: video.durationSeconds,
    withAudio: null,
  }));
  return { components, videos };
}

export class GeminiSession implements ProtocolSession {
  private state = initialSnapshot();
  private reply: GeminiReply | null = null;
  private candidateId: string | null = null;
  private label: string | null = null;
  /** The page showed a reply while a job ran without a candidate (a video, G3). */
  private job = false;
  /** A frame or field was not read: the reply is partial. */
  private unknown = false;
  gemini(value: unknown): void {
    if (!Array.isArray(value)) {
      this.unknown = true;
      return;
    }
    for (const row of value) {
      if (!Array.isArray(row)) this.unknown = true;
      else if (row[0] === "wrb.fr") this.readFrame(row[2]);
      else if (!ENVELOPE_ROWS.has(row[0])) this.unknown = true;
    }
  }
  /** One reply frame. A frame this reader cannot read makes the reply partial (D7). */
  private readFrame(payload: unknown): void {
    let inner: unknown;
    try {
      if (typeof payload !== "string") throw new Error("frame");
      inner = safeJson(payload);
    } catch {
      this.unknown = true;
      return;
    }
    if (!Array.isArray(inner)) {
      this.unknown = true;
      return;
    }
    // Every frame names the chat and the turn, also frames without a candidate. Ids that
    // cannot be read or that change within one reply leave it partial.
    const ids = geminiField(inner, 1);
    if (Array.isArray(ids)) {
      if (typeof ids[0] === "string" && CHAT.test(ids[0])) {
        if (this.state.conversationId && this.state.conversationId !== ids[0])
          this.unknown = true;
        this.state.conversationId = ids[0];
      } else if (ids[0] !== null && ids[0] !== undefined) this.unknown = true;
      if (typeof ids[1] === "string" && TURN.test(ids[1])) {
        if (
          this.state.providerRequestId &&
          this.state.providerRequestId !== ids[1]
        )
          this.unknown = true;
        this.state.providerRequestId = ids[1];
      } else if (ids[1] !== null && ids[1] !== undefined) this.unknown = true;
    } else if (ids !== null && ids !== undefined) this.unknown = true;
    const label = geminiLabel(geminiField(inner, 42));
    if (label) this.label = label;
    // A video turn shows a reply while its job runs, with no candidate and no reply id;
    // its result reaches only saved history (G3).
    const job = geminiField(inner, 6);
    if (Array.isArray(job) && typeof job[0] === "string") {
      this.job = true;
      this.state.started = true;
    }
    const candidates = geminiField(inner, 4);
    if (candidates === null || candidates === undefined) return;
    if (!Array.isArray(candidates)) {
      this.unknown = true;
      return;
    }
    if (!candidates.length) return;
    // Only one candidate was ever seen (14 Sep to 3 Oct); another one is not read.
    if (candidates.length > 1) this.unknown = true;
    const id = geminiField(candidates[0], 0);
    if (typeof id !== "string" || !CANDIDATE.test(id)) {
      this.unknown = true;
      return;
    }
    if (this.candidateId && this.candidateId !== id) this.unknown = true;
    this.candidateId = id;
    this.reply = geminiReply(candidates[0]);
    this.state.started = true;
  }
  /**
   * The request ended normally. Gemini sends no other end, and a reply the user stopped
   * ends the same way (16 Sep), so this completes a reply that showed content (M2, G18).
   */
  responseEnded(): void {
    if (this.state.state === "generating" && (this.reply || this.job))
      this.state.state = "completed";
  }
  stopped(): void {
    if (this.state.state === "generating") this.state.state = "cancelled";
  }
  completionVerified(): boolean {
    return this.state.state === "completed";
  }
  snapshot(): Snapshot {
    const reply = this.reply;
    // A reply read without its chat and turn ids cannot be linked to its saved copy,
    // which would then count again, so it is partial until both are seen.
    let unknown =
      this.unknown ||
      (reply?.unknown ?? false) ||
      ((reply !== null || this.job) &&
        (!this.state.conversationId || !this.state.providerRequestId));
    const snapshot: Snapshot = {
      ...this.state,
      model: this.label,
      outputId: this.candidateId,
      limitations: [...this.state.limitations],
    };
    if (reply) {
      snapshot.text = bounded(reply.answer);
      snapshot.thinking = bounded(reply.thinking);
      // A text past the frame limit stays unknown rather than failing the reply.
      if (
        (reply.answer !== null && snapshot.text === null) ||
        (reply.thinking !== null && snapshot.thinking === null)
      )
        unknown = true;
      // Results the page shows in full are input (A6); Gemini shows none in the fields
      // read here, so a fully read reply has none.
      const fitted = fitGeneratedText({
        toolInput: reply.toolInput,
        intermediate: reply.intermediate,
        toolOutput: reply.unknown ? undefined : "",
      });
      // A field left out to fit is unknown by its absence.
      Object.assign(snapshot, fitted);
      // Other models' text shares the bound of one reply's generated text; a component
      // that does not fit stays unknown.
      const generated = geminiGenerated(reply, this.label);
      let units = Object.values(fitted).reduce(
        (sum, text) => sum + text.length,
        0,
      );
      const components = generated.components.filter((component) => {
        const length = component.text?.length ?? 0;
        if (
          length > LIMITS.text ||
          units + length > GENERATED_TEXT_LIMITS.textUnits
        )
          return false;
        units += length;
        return true;
      });
      if (components.length < generated.components.length) unknown = true;
      if (components.length) snapshot.components = components;
      if (generated.videos.length)
        snapshot.media = generated.videos.slice(0, GENERATED_TEXT_LIMITS.media);
      if (reply.images.length && this.candidateId)
        snapshot.imageOperations = [
          {
            id: `gemini-images:${this.candidateId}`,
            parentId: null,
            model: this.label,
            kind: "unknown",
            requestedCount: null,
            outputs: reply.images.map((image, index) => ({
              id: `${this.candidateId}:${index}`,
              width: image.width,
              height: image.height,
            })),
            state: this.state.state,
          },
        ];
      if (reply.research) snapshot.limitations.push("research_work_unobserved");
    }
    if (unknown) snapshot.limitations.push("unknown_event_observed");
    return snapshot;
  }
}
