import {
  boundedText,
  finishHistoryPage,
  historyInstant,
  historyMessageUnits,
  historyModelLabel as modelLabel,
  historySpan,
  historyMessage,
  historyPage,
  historyUUID,
  record,
} from "./common";
import { GENERATED_TEXT_LIMITS } from "../generated-text";
import { perplexityBlocks, perplexityEntry } from "../perplexity-content";
import {
  HISTORY_LIMITS,
  type HistoryCoverageReason,
  type HistoryTextMessage,
} from "./types";

/**
 * A saved entry's reply, read by the same rule as the live stream (W7): the answer, the
 * queries and video prompts the model wrote, worker text and videos. Parts the reader does
 * not know are not counted and mark the reply partial; an over-long part stays unknown.
 */
function readResponse(
  entry: Record<string, any>,
  response: ReturnType<typeof historyMessage>,
) {
  if (!Array.isArray(entry.blocks)) return;
  // Blocks past the bound are not read; the reply is partial and names why.
  const blocks = entry.blocks.slice(0, HISTORY_LIMITS.blocks);
  // A part left out for its size, named apart from content the reader does not know.
  let limited = blocks.length < entry.blocks.length;
  const named = (unknown: boolean) => {
    const reasons: HistoryCoverageReason[] = [
      ...(unknown ? (["unknown_event_observed"] as const) : []),
      ...(limited ? (["capture_limit_exceeded"] as const) : []),
    ];
    if (reasons.length) response.coverageReasons = reasons;
  };
  const read = perplexityEntry(
    entry,
    perplexityBlocks(blocks),
    entry.status === "COMPLETED",
  );
  // Without its own id a reply cannot be matched to its live copy, so its text is not
  // counted here at all rather than twice.
  if (read.replyId === null) {
    named(true);
    return;
  }
  // The reply keeps its own id even when no answer was read, so it still meets its live
  // copy instead of being counted beside it.
  response.liveAttemptId = read.replyId;
  const unread = read.unknown || limited;
  const unknown =
    read.unknown ||
    read.videos.length + read.images.length > GENERATED_TEXT_LIMITS.media;
  // An image request can end with the image alone and no answer text (seen 5 Oct 2026);
  // a finished entry read in full then keeps its media and prompt with an empty answer,
  // as the live reply does, marked partial when its media pass the bound. With a part
  // unread the answer may be there, so it stays unknown: an empty answer would count as
  // a complete zero and replace the live reply's unknown measurement.
  const mediaOnly =
    read.answer === null &&
    entry.status === "COMPLETED" &&
    !unread &&
    read.images.length + read.videos.length > 0;
  if (!mediaOnly && (read.answer === null || !boundedText(read.answer))) {
    if (read.answer !== null) limited = true;
    named(unknown);
    return;
  }
  response.text = read.answer ?? "";
  for (const [key, text] of [
    ["thinking", read.thinking],
    ["toolInput", read.toolInput],
    ["intermediate", read.intermediate],
    ["toolOutput", read.toolOutput],
  ] as const) {
    if (text === undefined) continue;
    if (boundedText(text)) response[key] = text;
    else limited = true;
  }
  if (read.videos.length || read.images.length)
    response.media = [
      ...read.images.map((image) => ({
        kind: "image" as const,
        model: image.model,
        count: 1,
        width: image.width,
        height: image.height,
        outcome: "returned" as const,
      })),
      ...read.videos.map((video) => ({
        kind: "video" as const,
        model: video.model,
        width: null,
        height: null,
        durationSeconds: null,
        withAudio: null,
      })),
    ].slice(0, GENERATED_TEXT_LIMITS.media);
  // One message fits one counting batch: tool results go first, then intermediate text,
  // tool input and thinking; a part left out stays unknown.
  for (const key of [
    "toolOutput",
    "intermediate",
    "toolInput",
    "thinking",
  ] as const)
    if (
      response[key] &&
      historyMessageUnits(response) > HISTORY_LIMITS.textUnits
    ) {
      delete response[key];
      limited = true;
    }
  // Computer files (owner decision of 14 Oct 2026): the page world downloads text and code
  // files before the reply leaves it; until then they are unread and count nothing.
  if (read.files.length)
    response.computerFiles = read.files.map((file) => ({
      id: file.id,
      name: file.name,
      bytes: file.bytes,
      kind: file.text ? "text" : "other",
      state: file.text ? "unread" : "other",
    }));
  named(unknown);
  response.complete = entry.status === "COMPLETED";
  if (response.complete)
    response.timing = historySpan(
      entry.entry_created_datetime,
      entry.entry_updated_datetime,
      "perplexity_history",
    );
}

/**
 * Keeps a Computer file only in the first reply of a read that lists it, so a file a later
 * entry lists again is counted once. `seen` holds the files of the replies before.
 */
export function keepFirstComputerFiles(
  message: HistoryTextMessage,
  seen: Set<string>,
) {
  if (!message.computerFiles) return;
  const files = message.computerFiles.filter((file) => !seen.has(file.id));
  for (const file of files) seen.add(file.id);
  if (files.length) message.computerFiles = files;
  else delete message.computerFiles;
}

export function perplexityHistoryText(
  value: unknown,
  conversationId: string,
  observedAt: string,
) {
  if (
    !record(value) ||
    value.status !== "success" ||
    !Array.isArray(value.entries)
  )
    throw new Error("history_unsupported");
  const page = historyPage("perplexity", conversationId, observedAt);
  const replies = new Set<string>();
  const files = new Set<string>();
  for (const entry of value.entries) {
    if (
      !record(entry) ||
      !historyUUID(entry.frontend_uuid) ||
      entry.uuid !== entry.frontend_uuid ||
      entry.thread_url_slug !== conversationId
    )
      throw new Error("history_unsupported");
    // Two entries naming one reply would leave both unmatched to it.
    if (historyUUID(entry.backend_uuid)) {
      if (replies.has(entry.backend_uuid))
        throw new Error("history_unsupported");
      replies.add(entry.backend_uuid);
    }
    const prompt = historyMessage(entry.frontend_uuid, "prompt"),
      response = historyMessage(entry.frontend_uuid, "response");
    prompt.requestId = response.requestId = entry.frontend_uuid;
    response.promptSourceId = prompt.sourceId;
    prompt.occurredAt = historyInstant(entry.entry_created_datetime);
    response.occurredAt = prompt.occurredAt;
    if (prompt.occurredAt)
      prompt.dateBasis = response.dateBasis = "entry_created";
    prompt.text = boundedText(entry.query_str) ? entry.query_str : null;
    prompt.complete = prompt.text !== null;
    // The prompt carries the selection; the response carries what Perplexity reports it ran.
    prompt.modelId = modelLabel(entry.user_selected_model);
    response.modelId = modelLabel(entry.display_model);
    readResponse(entry, response);
    keepFirstComputerFiles(response, files);
    page.messages.push(prompt, response);
  }
  page.hasLater =
    typeof value.has_next_page === "boolean" ? value.has_next_page : null;
  const first = value.entries[0],
    designated = value.first_entry;
  let previousDate: string | null = null;
  const increasingDates = value.entries.every((entry: any) => {
    const source = historyInstant(entry.entry_created_datetime);
    if (source === null) return false;
    const ordered = source.replace(
      /\.(\d+)Z$/,
      (_match, fraction: string) => "." + fraction.padEnd(6, "0") + "Z",
    );
    if (previousDate !== null && ordered <= previousDate) return false;
    previousDate = ordered;
    return true;
  });
  // The coherent designated pointer proves the first available request here, not every branch or execution.
  // Never count its duplicate text, or infer this boundary solely from terminal pagination.
  if (
    record(first) &&
    record(designated) &&
    increasingDates &&
    historyUUID(designated.frontend_uuid) &&
    designated.uuid === designated.frontend_uuid &&
    designated.frontend_uuid === first.frontend_uuid &&
    designated.thread_url_slug === conversationId &&
    designated.backend_uuid === conversationId &&
    first.backend_uuid === conversationId &&
    value.entries.filter((entry: any) => entry.backend_uuid === conversationId)
      .length === 1 &&
    designated.entry_created_datetime === first.entry_created_datetime &&
    boundedText(designated.query_str) &&
    designated.query_str === first.query_str
  ) {
    page.firstRequestVerified = true;
    page.rootSourceId = first.frontend_uuid;
    page.hasEarlier = false;
  }
  return finishHistoryPage(page);
}
