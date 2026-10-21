import {
  safeJson,
  boundedText,
  CaptureError,
  LIMITS,
  validateTree,
  geminiRequestPath,
  GEMINI_STREAM_PATH,
  type Site,
} from "@footprint/capture-core";
import type { Dispatch, InputImage } from "./types";
import { claudeInlineFiles } from "./inline-files";
import { claudeProxyDispatch, isClaudeProxy } from "./claude-proxy";
import { chatgptAttachments } from "./chatgpt-attachments";
import { chatgptUploadedImages } from "./chatgpt-content";
import { isChatgptReadAloud } from "./chatgpt-speech";
import {
  chatgptSignedOutDispatch,
  isChatgptSignedOutSend,
} from "./chatgpt-signed-out";
import { GENERATED_TEXT_LIMITS } from "./generated-text";
import { notebooklmDispatch, notebooklmGenerationRoute } from "./notebooklm";

/**
 * Sizes of the images a ChatGPT send uploads, from the message's image parts (A7). A part
 * of an unknown kind, or an image attachment without its image part, leaves them unknown.
 */
function chatgptSendImages(messages: any[]): InputImage[] | undefined {
  const images: InputImage[] = [];
  for (const message of messages) {
    if (message?.author?.role !== "user") continue;
    const sizes = chatgptUploadedImages(message.content);
    if (!sizes) return undefined;
    const attached = message.metadata?.attachments;
    if (
      Array.isArray(attached) &&
      attached.filter(
        (item: any) =>
          typeof item?.mime_type === "string" &&
          item.mime_type.startsWith("image/"),
      ).length > sizes.length
    )
      return undefined;
    images.push(...sizes);
  }
  return images.length <= GENERATED_TEXT_LIMITS.inputImages
    ? images
    : undefined;
}

export function generationRoute(site: Site, url: URL, method: string): boolean {
  // Read aloud asks for speech of a reply already shown (G1).
  if (site === "chatgpt" && isChatgptReadAloud(url, method)) return true;
  if (method.toUpperCase() !== "POST") return false;
  switch (site) {
    case "claude":
      // claude.ai can switch a conversation to the completion2 backend (C3); AI-powered
      // artifacts call the model through the page's proxy (G3).
      return (
        /^\/api\/organizations\/[^/]+\/chat_conversations\/[^/]+\/(completion|retry_completion)2?$/.test(
          url.pathname,
        ) || isClaudeProxy(url)
      );
    case "chatgpt":
      // Without an account the page sends from its own path (20 Oct 2026).
      return (
        /^\/backend-api\/(f\/)?conversation$/.test(url.pathname) ||
        isChatgptSignedOutSend(url, method)
      );
    case "gemini":
      // A secondary Google account sends from /u/{index}/ (G17).
      return geminiRequestPath(url.pathname) === GEMINI_STREAM_PATH;
    case "perplexity":
      return /^\/rest\/sse\/perplexity_ask$/.test(url.pathname);
    case "notebooklm":
      // The chat stream and the notebook guide the page asks for itself (W9).
      return notebooklmGenerationRoute(url);
  }
}
const id = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 && v.length <= 256 ? v : null;

function claudeRequestFields(body: string): Record<string, unknown> {
  if (body.length > LIMITS.frame) throw new CaptureError("buffer_overflow");
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new CaptureError("malformed_frame");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new CaptureError("unsupported_schema");
  // Tool schemas can exceed the stream-frame nesting limit. They are not dispatch
  // evidence: validate only the fields we consume, within the same total body bound.
  const fields = Object.fromEntries(
    [
      "prompt",
      "parent_message_uuid",
      "completion_request_id",
      "model",
      "attachments",
      "files",
    ]
      .filter((key) => Object.hasOwn(value, key))
      .map((key) => [key, (value as Record<string, unknown>)[key]]),
  );
  validateTree(fields);
  return fields;
}

export function parseDispatch(site: Site, url: URL, body: string): Dispatch {
  const base: Dispatch = {
    site,
    action: "send",
    input: "",
    conversationId: null,
    parentId: null,
    requestId: null,
    model: null,
    attachments: null,
    imageEditParentId: null,
  };
  if (site === "gemini") {
    const form = new URLSearchParams(body);
    const encoded = form.get("f.req");
    if (!encoded) throw new CaptureError("missing_body");
    const outer = safeJson(encoded);
    if (!Array.isArray(outer) || typeof outer[1] !== "string")
      throw new CaptureError("unsupported_schema");
    const inner = safeJson(outer[1]);
    base.input = boundedText(inner?.[0]?.[0]);
    const previous = inner?.[2];
    base.conversationId = id(previous?.[0]);
    // A follow-up names the previous turn and its selected candidate, which keys that
    // reply's context (A4). Without the candidate the turn id stays, so an unresolved
    // parent leaves the context unknown instead of starting a new chat.
    base.parentId =
      typeof previous?.[2] === "string" && /^rc_[0-9a-f]{16}$/.test(previous[2])
        ? previous[2]
        : id(previous?.[1]);
    return base;
  }
  if (site === "notebooklm") return notebooklmDispatch(url, body, base);
  if (site === "claude" && isClaudeProxy(url)) return claudeProxyDispatch(body);
  if (site === "chatgpt" && isChatgptReadAloud(url, "GET")) {
    // No prompt and no turn: the speech reads a reply, so it joins no context chain.
    base.action = "read_aloud";
    base.conversationId = id(url.searchParams.get("conversation_id"));
    base.attachments = 0;
    base.inputImages = [];
    return base;
  }
  // A signed-out send is a form, not JSON (20 Oct 2026).
  if (site === "chatgpt" && isChatgptSignedOutSend(url, "POST"))
    return chatgptSignedOutDispatch(body, base);
  const data = site === "claude" ? claudeRequestFields(body) : safeJson(body);
  if (site === "claude") {
    base.inlineFiles = claudeInlineFiles(data);
    base.input = boundedText(data.prompt);
    base.action = /\/retry_completion2?$/.test(url.pathname)
      ? "regenerate"
      : "send";
    base.conversationId = id(url.pathname.split("/")[5]);
    base.parentId = id(data.parent_message_uuid);
    base.requestId = id(data.completion_request_id);
    base.model = id(data.model);
    base.attachments =
      Array.isArray(data.attachments) && Array.isArray(data.files)
        ? data.attachments.length + data.files.length
        : null;
    // Uploads travel as file ids without their pixel size, so images stay unknown unless
    // no file was sent at all (A7). Inline attachments are extracted text, not images.
    if (Array.isArray(data.files) && data.files.length === 0)
      base.inputImages = [];
  } else if (site === "chatgpt") {
    if (!Array.isArray(data.messages) || data.messages.length > 100)
      throw new CaptureError("unsupported_schema");
    const text: string[] = [];
    for (const message of data.messages) {
      if (message.author?.role !== "user") continue;
      if (!Array.isArray(message.content?.parts))
        throw new CaptureError("unsupported_schema");
      for (const part of message.content.parts) {
        if (typeof part === "string") text.push(part);
        // A spoken prompt is its transcript, as saved history reads it (A9).
        else if (
          part?.content_type === "audio_transcription" &&
          typeof part.text === "string"
        )
          text.push(part.text);
      }
    }
    base.input = boundedText(text.join("\n"));
    base.action =
      data.action === "variant"
        ? "regenerate"
        : data.action === "continue"
          ? "continue"
          : "send";
    base.conversationId = id(data.conversation_id);
    base.parentId = id(data.parent_message_id);
    base.requestId =
      data.messages.length === 1 && base.action === "send"
        ? id(data.messages[0]?.id)
        : null;
    base.model = id(data.model);
    const attachments = chatgptAttachments(data.messages);
    base.attachments = attachments.count;
    if (attachments.present) base.attachmentPresence = true;
    const images = chatgptSendImages(data.messages);
    if (images) base.inputImages = images;
    const edit = data.messages[0]?.metadata?.dalle?.from_client?.operation;
    if (
      edit?.type === "transformation" &&
      id(edit.original_gen_id) &&
      id(edit.original_file_id)
    )
      base.imageEditParentId = id(edit.original_gen_id);
  } else {
    base.input = boundedText(data.query_str);
    const params = data.params ?? {};
    // The saved consumer audit does not establish a stable thread identifier.
    // Request-like or undocumented IDs cannot safely become conversation identity.
    base.conversationId = null;
    base.parentId = id(params.last_backend_uuid);
    // Verified request identity only. History context and route IDs are different identities.
    base.requestId =
      typeof params.frontend_uuid === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        params.frontend_uuid,
      )
        ? params.frontend_uuid
        : null;
    base.model = id(params.model_preference);
    base.attachments = Array.isArray(params.attachments)
      ? params.attachments.length
      : null;
    // Attachments travel as links without their pixel size, so images stay unknown unless
    // nothing was attached (A7).
    if (base.attachments === 0) base.inputImages = [];
  }
  return base;
}
