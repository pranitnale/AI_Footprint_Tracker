import {
  CaptureError,
  LIMITS,
  SseDecoder,
  patchAt,
  boundedText,
  retainedSize,
  type SseFrame,
} from "@footprint/capture-core";
import { initialSnapshot, type ProtocolSession, type Snapshot } from "./types";
import { ChatgptImages } from "./chatgpt-images";
import { chatgptTurn, isChatgptFinal } from "./chatgpt-content";
import { fitGeneratedText } from "./generated-text";
import { historyModelLabel } from "./history/common";
/**
 * Stream event names the reader knows (live audit 9 Sep). `message` is the default name of
 * an event without one; such events are read by their value.
 */
export const CHATGPT_EVENTS: readonly string[] = Object.freeze([
  "delta",
  "delta_encoding",
  "resume_conversation_token",
  "input_message",
  "title_generation",
  "message_marker",
  "server_ste_metadata",
  "message_stream_complete",
  "conversation_detail_metadata",
  "stream_handoff",
  "message",
]);
/** Socket items that end a turn's stream; `stream-item` carries its events. */
export const CHATGPT_TURN_END_ITEMS: readonly string[] = Object.freeze([
  "done",
  "conversation-turn-complete",
]);
/**
 * Socket items that keep a turn's stream alive and carry no output (`heartbeat`, which
 * names only the turn, the chat and a time; seen 18 Oct 2026).
 */
export const CHATGPT_TURN_IDLE_ITEMS: readonly string[] = Object.freeze([
  "heartbeat",
]);
/** The most message slots one stream may name, as many as the messages it may hold. */
const MESSAGE_SLOTS = 256;
/**
 * The most socket stream items one reply may send. Each item carries one delta, so a long
 * GPT-6 Pro reply passed LIMITS.items (live, 20 Oct 2026: about 6,200 output tokens in about
 * 4 minutes). Only an item's id and a fingerprint of its content are kept to recognise a
 * resent item, so this bound allows about five times that reply and keeps a few MB.
 */
export const CHATGPT_STREAM_ITEMS = 32_768;

/** Length and FNV-1a hash of a stream item, to tell a resent item from a changed one. */
function fingerprint(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // A stream item is at most LIMITS.frame long, so both fit a safe integer.
  return text.length * 2 ** 32 + hash;
}
export class ChatgptSession implements ProtocolSession {
  private state = initialSnapshot();
  /**
   * The message tree of each slot a delta names with `c`. Since 6 Oct 2026 one stream
   * interleaves deltas of several messages (two thoughts messages and the answer), so a
   * patch must reach the message its slot holds, not the one added last.
   */
  private roots = new Map<number, any>();
  private slot = 0;
  private path: string | null = null;
  private operation: string | null = null;
  /** Each socket stream item read, by id, with the fingerprint of its content. */
  private seen = new Map<string, number>();
  private seenBytes = 0;
  private messages = new Map<string, any>();
  private done = false;
  private images = new ChatgptImages();
  private turnExchangeId: string | null = null;
  private asyncPending = false;
  private asyncTerminal = false;
  /** The turn continues as a job apart from the stream, read from the saved chat. */
  private streamJob = false;
  /** A stream event or turn item this reader does not know was not counted (D7). */
  private unknownEvents = false;
  /** The served model the stream's metadata names (G13), used when no message names one. */
  private serverModel: string | null = null;
  /** ChatGPT took the turn: its stream echoed the prompt or handed the turn to the socket. */
  private accepted = false;
  /**
   * The socket sent the turn's end item. Kept apart from `done`, which a later in-progress
   * message resets, because the page also leaves the topic after a normal end.
   */
  private turnEnded = false;
  frame(frame: SseFrame): void {
    const v = frame.value;
    if (typeof v?.conversation_id === "string")
      this.state.conversationId = v.conversation_id;
    if (v?.type === "input_message" || frame.event === "input_message")
      this.accepted = true;
    if (
      v?.type === "server_ste_metadata" ||
      frame.event === "server_ste_metadata"
    )
      this.serverModel =
        historyModelLabel(v?.metadata?.model_slug ?? v?.model_slug) ??
        this.serverModel;
    if (frame.event === "stream_handoff" || v?.type === "stream_handoff") {
      const topics = v.options?.filter(
        (o: any) => o.type === "subscribe_ws_topic",
      );
      if (
        !Array.isArray(topics) ||
        topics.length !== 1 ||
        typeof topics[0].topic_id !== "string"
      )
        throw new CaptureError("unsupported_schema");
      this.done = this.turnEnded = false;
      this.accepted = true;
      this.state.topic = topics[0].topic_id;
      this.turnExchangeId =
        typeof v.turn_exchange_id === "string" ? v.turn_exchange_id : null;
      return;
    }
    if (frame.event === "delta") {
      if (!v || typeof v !== "object")
        throw new CaptureError("unsupported_schema");
      // Like p and o, a slot carries over to the deltas that omit it.
      if ("c" in v) {
        if (!Number.isInteger(v.c) || v.c < 0 || v.c >= MESSAGE_SLOTS)
          throw new CaptureError("unsupported_schema");
        this.slot = v.c;
      }
      this.path = v.p ?? this.path;
      this.operation = v.o ?? this.operation;
      if (this.path === null || this.operation === null)
        throw new CaptureError("unsupported_schema");
      let root = this.roots.get(this.slot) ?? null;
      if (this.operation === "patch") {
        if (this.path !== "" || !Array.isArray(v.v))
          throw new CaptureError("unsupported_schema");
        for (const p of v.v) root = patchAt(root, p.p, p.o, p.v);
      } else root = patchAt(root, this.path, this.operation, v.v);
      this.roots.set(this.slot, root);
      this.storeMessage(root?.message);
      if (typeof root?.conversation_id === "string")
        this.state.conversationId = root.conversation_id;
      return;
    }
    if (v?.message) this.storeMessage(v.message);
    if (
      frame.event === "message_stream_complete" ||
      v?.type === "message_stream_complete"
    ) {
      this.done = true;
      // An image job that runs apart from the stream (5 Oct 2026): the stream completes
      // while its one assistant message, marked asynchronous, is still in progress. The
      // page then polls the saved chat, which carries the job's images. A stream handed
      // to the socket learns its end from the conversation's status instead.
      if (
        !this.state.topic &&
        [...this.messages.values()].some(
          (m) =>
            m.author?.role === "assistant" &&
            m.status === "in_progress" &&
            typeof m.metadata?.async_source === "string",
        )
      )
        this.asyncPending = this.streamJob = true;
    }
    // A new kind of event: the reply counts from what is known and says so in Details
    // (D7, X11). A message it carries is read, yet the event may hold more output beside
    // it. Unknown content inside a known event still fails above.
    if (
      v &&
      !CHATGPT_EVENTS.includes(frame.event) &&
      !["message_stream_complete", "conversation_detail_metadata"].includes(
        v.type,
      )
    )
      this.unknownEvents = true;
  }
  private storeMessage(message: any): void {
    if (!message || typeof message.id !== "string")
      throw new CaptureError("unsupported_schema");
    if (this.messages.size >= 256 && !this.messages.has(message.id))
      throw new CaptureError("buffer_overflow");
    if (
      message.author?.role === "assistant" &&
      message.status === "in_progress"
    )
      this.done = false;
    this.messages.set(message.id, structuredClone(message));
    this.images.observe(message);
    if (message.author?.role === "assistant") this.state.started = true;
  }
  socket(
    value: unknown,
    context?: { allowConversationTerminal: boolean; unsubscribeStops?: boolean },
  ): boolean {
    const envelopes = Array.isArray(value) ? value : [value];
    if (envelopes.length > LIMITS.items)
      throw new CaptureError("buffer_overflow");
    // The socket carries every chat of the account; only this reply's items are kept.
    let consumed = false;
    for (const raw of envelopes as any[]) {
      if (raw?.reply?.catchups) {
        if (this.socket(raw.reply.catchups, context)) consumed = true;
        continue;
      }
      // A Stop in a new chat before ChatGPT names the page (it stays at /c/local-chatgpt:<id>)
      // sends no stop_conversation: the page aborts the body and leaves the turn's topic, and
      // the socket confirms it (live, 19 Oct 2026). Leaving the running chat for another keeps
      // the topic. In a saved chat stop_conversation proves the Stop, so the caller allows
      // this only at the local address. The page also leaves the topic after the turn's end
      // item (an async job or images may still be pending then), so only an unsubscribe
      // before that end is a Stop.
      if (
        context?.unsubscribeStops &&
        raw?.type === "reply" &&
        raw.reply?.type === "unsubscribe" &&
        this.state.topic !== null &&
        raw.reply.topic_id === this.state.topic
      ) {
        consumed = true;
        if (!this.turnEnded && this.snapshot().state === "generating")
          this.stopped();
        continue;
      }
      if (raw?.type === "conversation-update") {
        const payload = raw.payload;
        if (
          !this.state.conversationId ||
          payload?.conversation_id !== this.state.conversationId ||
          !this.turnExchangeId
        )
          continue;
        if (payload.update_type === "add-messages") {
          const messages = payload.update_content?.messages;
          if (!Array.isArray(messages) || messages.length > 256)
            throw new CaptureError("unsupported_schema");
          for (const message of messages) {
            if (
              message?.metadata?.turn_exchange_id !== this.turnExchangeId ||
              message.metadata.working_turn_id !== this.turnExchangeId
            )
              continue;
            this.storeMessage(message);
            consumed = true;
          }
        } else if (payload.update_type === "set-conversation-async-status") {
          if (
            !context?.allowConversationTerminal ||
            payload.update_content?.is_async_correction !== false
          )
            continue;
          consumed = true;
          const status = payload.update_content.conversation_async_status;
          if (status === 5) {
            this.asyncPending = true;
            this.asyncTerminal = false;
          }
          if (status === 4) {
            this.asyncTerminal = true;
          }
        }
        continue;
      }
      if (
        raw?.topic_id !== this.state.topic ||
        raw?.payload?.type !== "conversation-turn-stream"
      )
        continue;
      consumed = true;
      const item = raw.payload.payload;
      if (typeof item?.conversation_id === "string")
        this.state.conversationId = item.conversation_id;
      if (CHATGPT_TURN_END_ITEMS.includes(item?.type)) {
        this.done = this.turnEnded = true;
        continue;
      }
      if (CHATGPT_TURN_IDLE_ITEMS.includes(item?.type)) continue;
      if (item?.type !== "stream-item") {
        // A new kind of turn item: counted around, as an unknown event (D7, X11).
        this.unknownEvents = true;
        continue;
      }
      // A stream item that cannot be read may hold answer text, so it fails closed.
      if (
        typeof item.stream_item_id !== "string" ||
        typeof item.encoded_item !== "string"
      )
        throw new CaptureError("unsupported_schema");
      const print = fingerprint(item.encoded_item);
      if (this.seen.has(item.stream_item_id)) {
        if (this.seen.get(item.stream_item_id) !== print)
          throw new CaptureError("conflicting_duplicate");
        continue;
      }
      if (this.seen.size >= CHATGPT_STREAM_ITEMS)
        throw new CaptureError("buffer_overflow");
      this.seen.set(item.stream_item_id, print);
      this.seenBytes += item.stream_item_id.length * 2 + 16;
      const decoder = new SseDecoder((frame) => this.frame(frame));
      decoder.pushText(item.encoded_item);
      decoder.finish();
    }
    return consumed;
  }
  /**
   * The messages, their delta trees and the stream items' ids this reader keeps. The socket
   * wraps every delta in its own envelope, so its data says little about this (20 Oct 2026).
   */
  retainedBytes(): number {
    let size = this.seenBytes;
    for (const message of this.messages.values()) size += retainedSize(message);
    for (const root of this.roots.values()) size += retainedSize(root);
    return size;
  }
  stopped(): void {
    this.state.state = "cancelled";
    // A turn ChatGPT took and the person then stopped ended by their choice, with what the
    // stream showed until then. A model that thinks without showing its thoughts shows
    // nothing (live, 19 Oct 2026, GPT-6 Pro stopped while thinking), and an unstarted reply
    // kept its state at dispatch, so its end was recorded as cut off
    // (interrupted_unconfirmed) with unknown output. Taken counts as started here, as
    // claude.ai's message_start starts a reply, so the reply is cancelled with 0 output. A
    // reply cut off without a stop keeps its unknown output.
    if (this.accepted) this.state.started = true;
    this.images.stopped();
  }
  stoppedBeforeAnswer(): void {
    // The runtime calls this only for a Stop the person proved with a click while the page
    // cancelled the send; ChatGPT had then written nothing this reader could see.
    this.accepted = true;
    this.stopped();
  }
  completionVerified(): boolean {
    return (
      (this.done || this.asyncTerminal) && this.snapshot().state === "completed"
    );
  }
  awaitingAsync(): boolean {
    return this.asyncPending && !this.asyncTerminal;
  }
  snapshot(): Snapshot {
    const messages = [...this.messages.values()];
    const turn = chatgptTurn(messages);
    // Unknown content inside an answer fails closed (D7); an unknown message of another
    // kind only leaves the reply partial.
    if (turn.answerUnreadable) throw new CaptureError("unsupported_schema");
    const finals = messages.filter(isChatgptFinal);
    const interrupted = finals.some(
      (m) =>
        m.metadata?.finish_details?.type === "interrupted" &&
        m.metadata?.finish_details?.reason === "client_stopped",
    );
    const imageOperations = this.images.snapshot();
    const imageFinal =
      imageOperations.length > 0 &&
      imageOperations.every((operation) => operation.state === "completed");
    // Several finals can answer one turn (G8); the last one ends it.
    const last = finals.at(-1);
    const textFinal =
      !!last &&
      last.end_turn === true &&
      finals.every((m) => m.status === "finished_successfully");
    // An asynchronous turn ends with its conversation's terminal status, once its images
    // are final, or its answer for a turn without images (Work turns, G7).
    const finalState =
      interrupted || this.state.state === "cancelled"
        ? "cancelled"
        : imageOperations.length || this.asyncPending
          ? this.asyncTerminal &&
            (imageOperations.length ? imageFinal : textFinal)
            ? "completed"
            : this.state.state
          : textFinal
            ? "completed"
            : this.state.state;
    const started = this.state.started || imageOperations.length > 0;
    return {
      ...this.state,
      state: finalState,
      // Once the reply started, every part is read whole: a part without text is zero.
      // An answer of a content type not yet seen is unknown, not zero.
      text:
        turn.answer !== null
          ? boundedText(turn.answer)
          : started && !turn.answerUnknown
            ? ""
            : null,
      thinking: started ? boundedText(turn.thinking) : null,
      ...(started
        ? fitGeneratedText({
            toolInput: turn.toolInput,
            intermediate: turn.intermediate,
            toolOutput: turn.toolOutput,
          })
        : {}),
      outputId: turn.outputId,
      // Until an image job or an answer names the turn, its first counted message (often
      // its thoughts) names it only for now. That id is held back while the stream can
      // still bring the answer: the reply's provider and company keys come from it, and
      // the organization server refuses a later revision that names another key. On 14
      // Oct 2026 every ChatGPT reply that thought first kept the figures of its first
      // thoughts on the server for that reason.
      attemptId:
        turn.attemptIdProvisional && finalState === "generating" && !this.done
          ? null
          : turn.attemptId,
      // The saved chat names the model of a job's reply, and the stream's served model can
      // differ (5 Oct 2026: gpt-5-6-thinking served, gpt-5-4-auto-thinking saved). Two
      // models would keep the live and saved copies of the reply apart.
      model: turn.model ?? (this.streamJob ? null : this.serverModel),
      started,
      searchOperations: turn.searches || null,
      limitations: [
        ...this.state.limitations,
        ...(turn.unknown || this.unknownEvents
          ? ["unknown_event_observed"]
          : []),
      ],
      imageOperations,
    };
  }
}
