import {
  CLAUDE_BLOCK_TYPES,
  CLAUDE_DELTAS,
  CLAUDE_EVENTS,
  CLAUDE_IGNORED_EVENTS,
} from "./claude";
import { CLAUDE_STOP_REASONS } from "./claude-content";
import {
  CHATGPT_EVENTS,
  CHATGPT_TURN_END_ITEMS,
  CHATGPT_TURN_IDLE_ITEMS,
} from "./chatgpt";
import {
  PERPLEXITY_BLOCK_USAGES,
  PERPLEXITY_ITEMS,
} from "./perplexity-content";
import { NOTEBOOKLM_GUIDE_RPC } from "./notebooklm";
import { GEMINI_HISTORY_RPC } from "./history/gemini";
import {
  NOTEBOOKLM_ITEM_RPC,
  NOTEBOOKLM_STUDIO_RPC,
} from "./history/notebooklm";

export type ProviderVocabulary = Readonly<
  Record<
    "claude" | "chatgpt" | "perplexity" | "gemini" | "notebooklm",
    Readonly<Record<string, readonly string[]>>
  >
>;

/**
 * The protocol names each reader knows, for the provider drift check (W10). It is built
 * from the lists the readers use, so the check and the readers cannot disagree. Gemini and
 * NotebookLM frames are positional, so only their call names are checked.
 */
export const PROVIDER_VOCABULARY: ProviderVocabulary = Object.freeze({
  claude: {
    events: [...CLAUDE_EVENTS, ...CLAUDE_IGNORED_EVENTS],
    blocks: CLAUDE_BLOCK_TYPES,
    deltas: CLAUDE_DELTAS,
    stopReasons: CLAUDE_STOP_REASONS,
  },
  chatgpt: {
    events: CHATGPT_EVENTS,
    items: [
      "stream-item",
      ...CHATGPT_TURN_END_ITEMS,
      ...CHATGPT_TURN_IDLE_ITEMS,
    ],
  },
  perplexity: { blocks: PERPLEXITY_BLOCK_USAGES, items: PERPLEXITY_ITEMS },
  gemini: { rpcs: [GEMINI_HISTORY_RPC] },
  notebooklm: {
    rpcs: [NOTEBOOKLM_STUDIO_RPC, NOTEBOOKLM_ITEM_RPC, NOTEBOOKLM_GUIDE_RPC],
  },
});
