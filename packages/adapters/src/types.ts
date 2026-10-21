import type { Site, SseFrame, TimingEvidence } from "@footprint/capture-core";
export interface Dispatch {
  site: Site;
  /**
   * `read_aloud` is speech made from a reply already shown (ChatGPT, G1): no prompt.
   * `notebook_guide` is a NotebookLM guide the page asks for itself (W9): no prompt.
   */
  action:
    | "send"
    | "regenerate"
    | "continue"
    | "edit_and_send"
    | "read_aloud"
    | "notebook_guide";
  input: string | null;
  conversationId: string | null;
  parentId: string | null;
  requestId: string | null;
  model: string | null;
  attachments: number | null;
  attachmentPresence?: true;
  imageEditParentId: string | null;
  inlineFiles?: string[] | null;
  /** Sizes of images uploaded with this message, for the vendor's image token rule (A7). */
  inputImages?: InputImage[];
}
/** An uploaded image as the page describes it; a size it does not show is null. */
export interface InputImage {
  width: number | null;
  height: number | null;
}
/** Exact counts the provider reports for one reply (Cowork results, Claude AI artifacts). */
export interface ProviderUsage {
  output: number;
  input: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  /** Reasoning tokens included in `output`, when the provider names them. */
  reasoning: number | null;
}
/** Generated text attributed to another model than the reply's own (D3). */
export interface GeneratedComponent {
  role: "side_calls" | "research" | "storyboard";
  /** Raw provider label; the extension resolves it through the registry. */
  model: string | null;
  /** Visible text to count, or null when only the provider's count is known. */
  text: string | null;
  /** The provider's own output count, when it reports one. */
  outputTokens: number | null;
  /** The component's own generation time, when the page shows it (a research run's span). */
  timing?: TimingEvidence;
}
/**
 * Generated media: facts the page shows, never media content. Live replies report images
 * as image operations; saved history reports them here.
 */
export type GeneratedMedia =
  | {
      kind: "image";
      model: string | null;
      count: number;
      width: number | null;
      height: number | null;
      /** A stopped or failed job that visibly started counts as one image (D1). */
      outcome: "returned" | "started_not_returned";
    }
  | {
      kind: "video";
      model: string | null;
      width: number | null;
      height: number | null;
      durationSeconds: number | null;
      withAudio: boolean | null;
    }
  | {
      kind: "speech";
      basis: "audio_frames" | "stored_length" | "characters";
      seconds: number | null;
      characters: number | null;
    }
  | { kind: "video_overview"; durationSeconds: number };
/**
 * Generated text beyond the visible answer. A field the adapter reads is present, even
 * as an empty string; a field it cannot read is left out and its part stays unknown. A
 * field left out after an earlier snapshot of the same reply carried it keeps the
 * earlier count as a lower bound, marked partial.
 */
export interface GeneratedText {
  /** Model-written tool input decoded to text: files, code, queries, briefs (D2). */
  toolInput?: string;
  /** Commentary, plans, compaction summaries and other intermediate text (D2). */
  intermediate?: string;
  /** Tool results the page shows in full, counted as input (A6). */
  toolOutput?: string;
  usage?: ProviderUsage;
  components?: GeneratedComponent[];
  media?: GeneratedMedia[];
}
export interface Snapshot extends GeneratedText {
  providerRequestId?: string;
  text: string | null;
  thinking: string | null;
  /** The id the next request names as its parent: the reply's last answer message. */
  outputId: string | null;
  /**
   * The id saved history keeps for this reply, when it differs from `outputId`. ChatGPT
   * saves a turn under its first message, which stays the same while the turn grows.
   */
  attemptId?: string | null;
  /**
   * NotebookLM: names the finished reply by its content (`notebooklmReplyId`), because its
   * saved copy keeps no id the stream named. It links the two; the attempt id stays.
   */
  contentId?: string;
  conversationId: string | null;
  parentId: string | null;
  model: string | null;
  state:
    | "generating"
    | "completed"
    | "cancelled"
    | "failed"
    | "interrupted_unconfirmed";
  started: boolean;
  searchOperations: number | null;
  topic: string | null;
  limitations: string[];
  imageOperations: ImageOperation[];
}
export interface ImageOperation {
  id: string;
  parentId: string | null;
  /** Raw label of the image model when the page names it. */
  model?: string | null;
  kind: "text_to_image" | "image_edit" | "unknown";
  requestedCount: number | null;
  outputs: Array<{ id: string; width: number | null; height: number | null }>;
  state:
    | "completed"
    | "generating"
    | "cancelled"
    | "failed"
    | "interrupted_unconfirmed";
}
export interface ProtocolSession {
  frame?(frame: SseFrame): void;
  gemini?(value: unknown): void;
  /** One JSON value per line of the response (signed-out ChatGPT, 20 Oct 2026). */
  line?(value: unknown): void;
  /**
   * Bytes of reply data this reader keeps in memory. A JSON-lines stream repeats the page's
   * metadata on every line, so its raw size says little about what a capture holds; the
   * stream limits count this instead (20 Oct 2026).
   */
  retainedBytes?(): number;
  /** A whole JSON response body, for routes that do not stream. */
  json?(value: unknown): void;
  /** Raw response bytes, for a route that answers with audio (ChatGPT read aloud). */
  bytes?(chunk: Uint8Array): void;
  /** The raw response ended. */
  bytesEnded?(): void;
  /**
   * Characters of the message read aloud, for audio the reader cannot time: its length
   * then follows the reading rate (owner, 3 Oct).
   */
  readCharacters?(characters: number): void;
  /** The message a read-aloud request reads. */
  readonly readMessageId?: string | null;
  /**
   * Reads a socket message. Returns true when part of it belonged to this reply, so only
   * those messages count toward the reply's stream limit (W10 review).
   */
  socket?(
    value: unknown,
    context?: {
      allowConversationTerminal: boolean;
      /** The page leaving this reply's topic is the person's Stop (ChatGPT's local new-chat address). */
      unsubscribeStops?: boolean;
    },
  ): boolean;
  /**
   * The response ended normally and its decoder accepted the end. Only a protocol whose
   * normal end is its completion signal implements this (Gemini, M2).
   */
  responseEnded?(): void;
  completionVerified?(): boolean;
  /**
   * The reply waits for the end of a provider job that runs apart from its stream (ChatGPT
   * asynchronous turns, G7). A live capture that runs out of time then ends without a
   * failure; the saved reply is read later (W10).
   */
  awaitingAsync?(): boolean;
  snapshot(): Snapshot;
  stopped(): void;
  /**
   * The person stopped the turn before the provider answered its send, so nothing was
   * written: it ends cancelled with output 0, as a turn stopped while thinking does
   * (ChatGPT, 20 Oct 2026).
   */
  stoppedBeforeAnswer?(): void;
}
/** Packaged parsing behavior for an already supported provider site. */
export interface ProviderAdapter {
  readonly site: Site;
  readonly responseFormat: "sse" | "gemini";
  readonly generationRoute: (url: URL, method: string) => boolean;
  readonly parseDispatch: (url: URL, body: string) => Dispatch;
  /** A session for one generation request; the route can choose its parser. */
  readonly createSession: (url?: URL) => ProtocolSession;
}
export interface ProviderAdapterRegistry {
  readonly get: (site: Site) => Readonly<ProviderAdapter> | undefined;
}
export const initialSnapshot = (): Snapshot => ({
  text: null,
  thinking: null,
  outputId: null,
  conversationId: null,
  parentId: null,
  model: null,
  state: "generating",
  started: false,
  searchOperations: null,
  topic: null,
  limitations: [
    "hidden_reasoning_unknown",
    "server_context_unknown",
    "media_capture_unverified",
  ],
  imageOperations: [],
});
