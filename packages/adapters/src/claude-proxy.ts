import {
  boundedText,
  CaptureError,
  LIMITS,
  validateTree,
  type SseFrame,
} from "@footprint/capture-core";
import { ClaudeSession } from "./claude";
import type {
  Dispatch,
  ProtocolSession,
  ProviderUsage,
  Snapshot,
} from "./types";

/**
 * AI-powered artifacts call Claude through the claude.ai page (G3, verified 3 Oct). The
 * response is a Messages API body with the model that answered and exact usage.
 */
const PROXY_PATH = /^\/api\/organizations\/[^/]+\/proxy\/v1\/messages$/;
export const isClaudeProxy = (url: URL) => PROXY_PATH.test(url.pathname);

const record = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const count = (value: unknown) =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= 1_000_000_000
    ? (value as number)
    : null;

/**
 * One artifact run: its newest user message is the new input, and its images are
 * counted by the provider's own input total. A body too large to read keeps its text
 * unknown rather than failing the run.
 */
export function claudeProxyDispatch(body: string | null): Dispatch {
  const base: Dispatch = {
    site: "claude",
    action: "send",
    input: null,
    conversationId: null,
    parentId: null,
    requestId: null,
    model: null,
    attachments: null,
    imageEditParentId: null,
  };
  if (body === null || body.length > LIMITS.frame) return base;
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new CaptureError("malformed_frame");
  }
  if (!record(data) || !Array.isArray(data.messages))
    throw new CaptureError("unsupported_schema");
  const last = data.messages.findLast(
    (message: unknown) => record(message) && message.role === "user",
  );
  // Tool schemas can nest deeper than the frame limit allows; only read fields are checked.
  validateTree({ model: data.model, last });
  if (typeof data.model === "string" && data.model.length <= 256)
    base.model = data.model;
  const content = last?.content;
  if (typeof content === "string") {
    base.input = boundedText(content);
    base.inputImages = [];
  } else if (Array.isArray(content)) {
    base.input = boundedText(
      content
        .filter(
          (block) =>
            record(block) &&
            block.type === "text" &&
            typeof block.text === "string",
        )
        .map((block) => block.text)
        .join("\n"),
    );
    // Inline images carry no size the tracker reads; their tokens stay unknown.
    base.inputImages = content
      .filter((block) => record(block) && block.type === "image")
      .map(() => ({ width: null, height: null }));
  }
  return base;
}

/** Messages API usage as exact counts; output alone is enough to be exact. */
function providerUsage(
  value: unknown,
  output: number | null,
): ProviderUsage | null {
  if (!record(value) || output === null) return null;
  return {
    output,
    input: count(value.input_tokens),
    cacheRead: count(value.cache_read_input_tokens),
    cacheWrite: count(value.cache_creation_input_tokens),
    // Thinking is billed inside output tokens; the API does not split it out.
    reasoning: null,
  };
}

/**
 * An artifact run, as one JSON body or as a Messages API stream. Its blocks are read by
 * the Claude chat parser; usage counts only once the run completed.
 */
export class ClaudeProxySession implements ProtocolSession {
  private reply = new ClaudeSession();
  private usage: Record<string, any> | null = null;
  private output: number | null = null;
  frame(frame: SseFrame): void {
    const v = frame.value;
    if (v?.type === "message_start" && record(v.message?.usage)) {
      this.usage = { ...v.message.usage };
      // The start count is a placeholder; only the final cumulative count is exact.
      this.output = null;
    }
    // The final message_delta carries the cumulative output count.
    if (v?.type === "message_delta" && record(v.usage)) {
      this.usage = { ...this.usage, ...v.usage };
      this.output = count(v.usage.output_tokens);
    }
    this.reply.frame(frame);
  }
  json(value: unknown): void {
    if (record(value) && value.type === "error") {
      this.reply.frame(frame({ type: "error" }));
      return;
    }
    if (
      !record(value) ||
      value.type !== "message" ||
      typeof value.id !== "string" ||
      !Array.isArray(value.content) ||
      value.content.length > 256
    )
      throw new CaptureError("unsupported_schema");
    this.reply.frame(
      frame({
        type: "message_start",
        message: { id: value.id, model: value.model },
      }),
    );
    value.content.forEach((block, index) =>
      this.reply.frame(
        frame({ type: "content_block_start", index, content_block: block }),
      ),
    );
    this.usage = record(value.usage) ? value.usage : null;
    this.output = count(value.usage?.output_tokens);
    this.reply.frame(
      frame({
        type: "message_delta",
        delta: { stop_reason: value.stop_reason ?? null },
      }),
    );
    this.reply.frame(frame({ type: "message_stop" }));
  }
  stopped(): void {
    this.reply.stopped();
  }
  completionVerified(): boolean {
    return this.reply.completionVerified();
  }
  snapshot(): Snapshot {
    const snapshot = this.reply.snapshot();
    const usage =
      snapshot.state === "completed"
        ? providerUsage(this.usage, this.output)
        : null;
    return usage ? { ...snapshot, usage } : snapshot;
  }
}

const frame = (value: Record<string, unknown>): SseFrame => ({
  event: "message",
  data: "",
  value,
});
