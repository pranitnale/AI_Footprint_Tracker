import { JSONParser } from "@streamparser/json";
import {
  ChatgptTurns,
  geminiHistoryFrames,
  historyInstant,
  historyMessageUnits,
  HISTORY_LIMITS,
  keepFirstComputerFiles,
  NOTEBOOKLM_CHAT_RPC,
  notebooklmHistoryFrames,
  parseHistoryText,
  perplexityComputerFiles,
  type HistoryTextMessage,
  type HistoryTextPage,
  type NotebooklmHistoryRead,
} from "@footprint/adapters";
import {
  COMPUTER_FILE_DOWNLOADS,
  resolveComputerFiles,
  type ComputerFileDeps,
} from "./computer-files";

export type StreamSite = "chatgpt" | "perplexity" | "gemini" | "notebooklm";
export type ProviderStreamRow = {
  message: HistoryTextMessage;
  requestRef: string | null;
  parentRef: string | null;
};
export type ProviderStreamMeta = Pick<
  HistoryTextPage,
  | "firstRequestVerified"
  | "rootSourceId"
  | "selectedLeafId"
  | "branchScope"
  | "hasEarlier"
  | "hasLater"
> & { messageCount: number };

export const PROVIDER_STREAM_BATCH_MESSAGES = 50;
export const PROVIDER_STREAM_BATCH_TEXT_UNITS = 524288;
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);

/**
 * A NotebookLM read with its chat context. A page of turns must answer a request for one,
 * with the session that request named; any other read must not claim one.
 */
export function notebooklmRead(
  body: string,
  chat?: () => Pick<NotebooklmHistoryRead, "session" | "sessions">,
): NotebooklmHistoryRead {
  const read = notebooklmHistoryFrames(body);
  if ((read.rpc === NOTEBOOKLM_CHAT_RPC) !== !!chat)
    throw new Error("history_unsupported");
  return chat ? { ...read, ...chat() } : read;
}

/**
 * Streams JSON rows where available. Google's batch responses (Gemini's fixed ten-turn RPC,
 * NotebookLM's Studio reads) are decoded whole and counted in bounded batches.
 */
export class ProviderHistoryStream {
  private parser: JSONParser | null = null;
  private rows: ProviderStreamRow[] = [];
  private units = 0;
  private messageCount = 0;
  private sourceCount = 0;
  private ids = new Set<string>();
  private identity: string | null = null;
  /** Whether the body named a chat or a selected message at all. */
  private named = false;
  private selectedLeaf: string | null = null;
  private pageInfo: any = null;
  private continuation: unknown = undefined;
  private firstRawSystem = false;
  private firstRawId: string | null = null;
  private firstPromptIndex: number | null = null;
  private firstPromptId: string | null = null;
  private lastRawId: string | null = null;
  private status: string | null = null;
  private firstEntry: any = null;
  private firstActual: any = null;
  private hasNext: boolean | null = null;
  private priorDate: string | null = null;
  private datesIncreasing = true;
  private backendRootCount = 0;
  /** Perplexity reply ids seen; two entries naming one reply would match neither. */
  private replyIds = new Set<string>();
  private googleChunks: Uint8Array[] = [];
  private googleBytes = 0;
  /** A turn's rows become one reply when the next turn starts or the page ends (W6). */
  private turns: ChatgptTurns;
  /** Computer files listed so far, so a file a later entry lists again counts once. */
  private fileIds = new Set<string>();
  /** Each Computer file's link from its asset; kept in the page world only. */
  private fileLinks = new Map<string, string>();
  private fileBudget = { downloads: COMPUTER_FILE_DOWNLOADS };

  constructor(
    private site: StreamSite,
    private conversationId: string,
    private observedAt: string,
    private send: (rows: ProviderStreamRow[]) => Promise<void>,
    /** Saved ChatGPT answers' ids and characters, for read aloud (G1). */
    onAnswer?: (ids: string[], characters: number) => void,
    /** A ChatGPT page of turns before the first one the page showed (chatgptEarlierPage). */
    private earlier = false,
    /** A page of saved NotebookLM turns: its session and the notebook's session list. */
    private notebooklmChat?: () => Pick<
      NotebooklmHistoryRead,
      "session" | "sessions"
    >,
    /** Downloads Perplexity Computer files before their replies are sent (14 Oct 2026). */
    private computerFiles?: ComputerFileDeps,
  ) {
    this.turns = new ChatgptTurns(onAnswer);
    if (site === "gemini" || site === "notebooklm") return;
    this.parser = new JSONParser({
      paths:
        site === "chatgpt"
          ? [
              "$.conversation_id",
              "$.current_node",
              "$.page_info",
              "$.context_truncation_continuation",
              "$.messages.*",
            ]
          : ["$.status", "$.first_entry", "$.has_next_page", "$.entries.*"],
      keepStack: false,
      stringBufferSize: 65536,
    });
    this.parser.onValue = ({ value, key, stack }) => {
      if (stack.length === 2 && typeof key === "number") {
        if (site === "chatgpt" && stack[1]?.key === "messages")
          this.chatgptRow(value);
        if (site === "perplexity" && stack[1]?.key === "entries")
          this.perplexityRow(value);
      } else if (stack.length === 1) {
        if (site === "chatgpt") {
          if (key === "conversation_id" || key === "current_node")
            this.named = true;
          if (key === "conversation_id")
            this.identity = typeof value === "string" ? value : null;
          if (key === "current_node")
            this.selectedLeaf = typeof value === "string" ? value : null;
          if (key === "page_info") this.pageInfo = value;
          if (key === "context_truncation_continuation")
            this.continuation = value;
        } else {
          if (key === "status")
            this.status = typeof value === "string" ? value : null;
          if (key === "first_entry") this.firstEntry = value;
          if (key === "has_next_page")
            this.hasNext = typeof value === "boolean" ? value : null;
        }
      }
    };
  }

  private chatgptRow(row: any) {
    if (!row || !uuid(row.id) || this.ids.has(row.id))
      throw new Error("history_unsupported");
    this.ids.add(row.id);
    const index = this.sourceCount++;
    const visible = row.metadata?.is_visually_hidden_from_conversation !== true;
    if (index === 0)
      this.firstRawId = row.id;
    if (index === 0)
      this.firstRawSystem =
        row.author?.role === "system" && !visible;
    if (visible && row.author?.role === "user" && this.firstPromptIndex === null) {
      this.firstPromptIndex = index;
      this.firstPromptId = row.id;
    }
    this.lastRawId = row.id;
    for (const item of this.turns.add(row)) this.queue(item);
  }

  private perplexityRow(entry: any) {
    const page = parseHistoryText(
      "perplexity",
      { status: "success", entries: [entry] },
      this.conversationId,
      this.observedAt,
    );
    if (page.status === "unsupported" || page.messages.length !== 2)
      throw new Error("history_unsupported");
    const id = page.messages[0]!.sourceId;
    if (this.ids.has(id)) throw new Error("history_unsupported");
    this.ids.add(id);
    if (!this.firstActual)
      this.firstActual = {
        id,
        backend: entry.backend_uuid,
        created: entry.entry_created_datetime,
        query: entry.query_str,
      };
    if (entry.backend_uuid === this.conversationId) this.backendRootCount++;
    if (uuid(entry.backend_uuid)) {
      if (this.replyIds.has(entry.backend_uuid))
        throw new Error("history_unsupported");
      this.replyIds.add(entry.backend_uuid);
    }
    const instant = historyInstant(entry.entry_created_datetime);
    const date = instant?.replace(
      /\.(\d+)Z$/,
      (_match: string, fraction: string) => "." + fraction.padEnd(6, "0") + "Z",
    ) ?? null;
    if (!date || (this.priorDate !== null && date <= this.priorDate))
      this.datesIncreasing = false;
    this.priorDate = date;
    this.sourceCount++;
    const response = page.messages[1]!;
    keepFirstComputerFiles(response, this.fileIds);
    if (response.computerFiles && Array.isArray(entry.blocks)) {
      const listed = new Set(response.computerFiles.map((file) => file.id));
      for (const file of perplexityComputerFiles(
        entry.blocks.slice(0, HISTORY_LIMITS.blocks),
      ).files)
        if (file.url && listed.has(file.id)) this.fileLinks.set(file.id, file.url);
    }
    for (const message of page.messages)
      this.queue({ message, requestRef: null, parentRef: null });
  }

  private queue(row: ProviderStreamRow) {
    this.rows.push(row);
    this.messageCount++;
    this.units += historyMessageUnits(row.message);
  }

  async write(bytes: Uint8Array) {
    if (this.site === "gemini" || this.site === "notebooklm") {
      // These bodies are decoded whole, so their size is bounded before they are held.
      this.googleBytes += bytes.length;
      if (this.googleBytes > HISTORY_LIMITS.wholeResponseBytes) {
        this.googleChunks = [];
        throw new Error("history_response_limit");
      }
      this.googleChunks.push(bytes.slice());
      return;
    }
    for (let offset = 0; offset < bytes.length; offset += 65536) {
      this.parser!.write(bytes.subarray(offset, offset + 65536));
      if (
        this.rows.length >= PROVIDER_STREAM_BATCH_MESSAGES ||
        this.units >= PROVIDER_STREAM_BATCH_TEXT_UNITS
      )
        await this.flush();
      if (offset > 0 && offset % (65536 * 8) === 0)
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  async finish(): Promise<ProviderStreamMeta> {
    if (this.site === "gemini" || this.site === "notebooklm") {
      const size = this.googleChunks.reduce((sum, part) => sum + part.length, 0);
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const part of this.googleChunks) {
        bytes.set(part, offset);
        offset += part.length;
      }
      this.googleChunks = [];
      const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const frame =
        this.site === "gemini"
          ? geminiHistoryFrames(body)
          : notebooklmRead(body, this.notebooklmChat);
      // A notebook without Studio items or saved turns has an empty list, which is a
      // complete read.
      const page = parseHistoryText(this.site, frame, this.conversationId, this.observedAt);
      if (page.status === "unsupported") throw new Error("history_unsupported");
      for (const message of page.messages) {
        this.queue({ message, requestRef: null, parentRef: null });
        if (
          this.rows.length >= PROVIDER_STREAM_BATCH_MESSAGES ||
          this.units >= PROVIDER_STREAM_BATCH_TEXT_UNITS
        )
          await this.flush();
      }
      await this.flush();
      return {
        messageCount: this.messageCount,
        firstRequestVerified: page.firstRequestVerified,
        rootSourceId: page.rootSourceId,
        selectedLeafId: page.selectedLeafId,
        branchScope: page.branchScope,
        hasEarlier: page.hasEarlier,
        hasLater: page.hasLater,
      };
    }
    if (!this.parser!.isEnded) this.parser!.end();
    if (!this.parser!.isEnded) throw new Error("history_unsupported");
    if (this.site === "chatgpt")
      for (const item of this.turns.finish()) this.queue(item);
    if (this.messageCount === 0) throw new Error("history_unsupported");
    await this.flush();
    if (this.site === "chatgpt") {
      // An earlier page names its chat only in its address, which the request matched.
      if (
        (this.earlier
          ? this.named
          : this.identity !== this.conversationId) ||
        !this.sourceCount
      )
        throw new Error("history_unsupported");
      // The same rule as the adapter's chatgptHistory: the page opens at the first prompt,
      // or at the hidden system message saved before it until October 2026 (after it since
      // 12 Oct 2026, never in Work chats, and absent from chats begun since 18 Oct 2026).
      // Only the page boundary tells the chat's start from a page in its middle.
      const first =
        (this.firstPromptIndex === 0 ||
          (this.firstPromptIndex === 1 && this.firstRawSystem)) &&
        this.pageInfo?.has_previous_page === false &&
        this.pageInfo?.has_next_page === this.earlier &&
        this.pageInfo?.start_cursor === this.firstRawId &&
        this.pageInfo?.end_cursor === this.lastRawId &&
        (this.earlier
          ? this.continuation === undefined
          : this.selectedLeaf === this.lastRawId &&
            this.continuation === null);
      return {
        messageCount: this.messageCount,
        firstRequestVerified: first,
        rootSourceId: first ? this.firstPromptId : null,
        // The selected row maps to the prompt or reply that holds it.
        selectedLeafId: uuid(this.selectedLeaf)
          ? this.turns.messageOf(this.selectedLeaf)
          : null,
        branchScope: "loaded_messages",
        hasEarlier:
          typeof this.pageInfo?.has_previous_page === "boolean"
            ? this.pageInfo.has_previous_page
            : null,
        hasLater:
          typeof this.pageInfo?.has_next_page === "boolean"
            ? this.pageInfo.has_next_page
            : null,
      };
    }
    if (this.status !== "success" || !this.sourceCount)
      throw new Error("history_unsupported");
    const designated = this.firstEntry;
    const first =
      this.datesIncreasing &&
      this.backendRootCount === 1 &&
      designated?.frontend_uuid === this.firstActual?.id &&
      designated?.uuid === designated?.frontend_uuid &&
      designated?.thread_url_slug === this.conversationId &&
      designated?.backend_uuid === this.conversationId &&
      this.firstActual?.backend === this.conversationId &&
      designated?.entry_created_datetime === this.firstActual?.created &&
      typeof designated?.query_str === "string" &&
      designated.query_str.length <= HISTORY_LIMITS.messageUnits &&
      designated.query_str === this.firstActual?.query;
    this.firstActual = null;
    this.firstEntry = null;
    return {
      messageCount: this.messageCount,
      firstRequestVerified: !!first,
      rootSourceId: first ? designated.frontend_uuid : null,
      selectedLeafId: null,
      branchScope: "loaded_messages",
      hasEarlier: first ? false : null,
      hasLater: typeof this.hasNext === "boolean" ? this.hasNext : null,
    };
  }

  private async flush() {
    if (!this.rows.length) return;
    const queued = this.rows;
    this.rows = [];
    this.units = 0;
    // Before the rows leave the page world, so a downloaded file's text is batched with
    // its reply and its link never leaves.
    if (this.site === "perplexity" && this.computerFiles)
      await resolveComputerFiles(
        queued.map((row) => row.message),
        this.fileLinks,
        this.computerFiles,
        this.fileBudget,
      );
    let batch: ProviderStreamRow[] = [];
    let units = 0;
    for (const row of queued) {
      const rowUnits = historyMessageUnits(row.message);
      if (
        batch.length &&
        (batch.length >= PROVIDER_STREAM_BATCH_MESSAGES ||
          units + rowUnits > PROVIDER_STREAM_BATCH_TEXT_UNITS)
      ) {
        await this.send(batch);
        batch = [];
        units = 0;
      }
      batch.push(row);
      units += rowUnits;
    }
    if (batch.length) await this.send(batch);
  }
}
