import type { Site } from "@footprint/capture-core";
import { chatgptHistory } from "./chatgpt";
import { claudeHistory, type ClaudeResearchTask } from "./claude";
import { perplexityHistoryText } from "./perplexity";
import { historyPage, historyUUID } from "./common";
import { geminiHistory } from "./gemini";
import {
  notebooklmHistory,
  notebooklmId,
  type NotebooklmHistoryRead,
} from "./notebooklm";
export * from "./types";
export {
  historyInstant,
  historyMessageUnits,
  historyModelLabel,
} from "./common";
export { geminiHistoryFrames } from "./gemini";
export { keepFirstComputerFiles } from "./perplexity";
export {
  notebooklmChatSessions,
  notebooklmHistoryFrames,
  notebooklmId,
  NOTEBOOKLM_CHAT_RPC,
  NOTEBOOKLM_ITEM_RPC,
  NOTEBOOKLM_SESSIONS_RPC,
  NOTEBOOKLM_STUDIO_RPC,
  type NotebooklmHistoryRead,
} from "./notebooklm";
export { ChatgptTurns, type ChatgptHistoryRow } from "./chatgpt";
export { CoworkEvents, coworkRequest, validCoworkCumulative } from "./cowork";
export {
  claudeHistoryRow,
  claudePromptOf,
  claudeResearchTask,
  CLAUDE_HISTORY_ROOT,
  type ClaudeHistoryOptions,
  type ClaudeHistoryRow,
  type ClaudeResearchTask,
} from "./claude";

export function parseHistoryText(
  site: Site,
  value: unknown,
  conversationId: string,
  observedAt: string,
  onFailure?: (reason: string) => void,
  /** Claude Research runs of this conversation that the page's own polls showed. */
  claudeResearch: readonly ClaudeResearchTask[] = [],
  /** A ChatGPT page of turns before the first one the page showed. */
  chatgptEarlier = false,
) {
  const unsupported = () => ({
    ...historyPage(site, conversationId, observedAt),
    status: "unsupported" as const,
    branchScope: "unknown" as const,
  });
  if (
    site === "gemini"
      ? !/^c_[0-9a-f]{16}$/.test(conversationId)
      : site === "notebooklm"
        ? !notebooklmId(conversationId)
        : !historyUUID(conversationId)
  )
    return unsupported();
  try {
    if (site === "chatgpt")
      return chatgptHistory(value, conversationId, observedAt, chatgptEarlier);
    if (site === "claude")
      return claudeHistory(value, conversationId, observedAt, claudeResearch);
    if (site === "perplexity")
      return perplexityHistoryText(value, conversationId, observedAt);
    if (site === "gemini")
      return geminiHistory(value, conversationId, observedAt);
    if (site === "notebooklm")
      return notebooklmHistory(
        value as NotebooklmHistoryRead,
        conversationId,
        observedAt,
      );
  } catch (error) {
    if (error instanceof Error) onFailure?.(error.message);
  }
  return unsupported();
}
