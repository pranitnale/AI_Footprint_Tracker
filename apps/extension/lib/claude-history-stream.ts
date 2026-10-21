import { JSONParser } from "@streamparser/json";
import {
  claudeHistoryRow,
  historyMessageUnits,
  historyModelLabel,
  type ClaudeHistoryRow,
  type ClaudeResearchTask,
} from "@footprint/adapters";

export const CLAUDE_STREAM_BATCH_MESSAGES = 50;
export const CLAUDE_STREAM_BATCH_TEXT_UNITS = 524288;

/** Keeps only one parsed row batch and conversation identity while reading JSON. */
export class ClaudeHistoryStream {
  private parser = new JSONParser({
    paths: [
      "$.uuid",
      "$.model",
      "$.current_leaf_message_uuid",
      "$.chat_messages.*",
    ],
    keepStack: false,
    stringBufferSize: 65536,
  });
  private rows: ClaudeHistoryRow[] = [];
  private units = 0;
  private uuid: string | null = null;
  private leaf: string | null = null;
  /** The chat's model (B5); rows parsed before it arrives get it when the read ends. */
  private model: string | null = null;
  private sawModel = false;
  private count = 0;
  private ids = new Set<string>();
  private sawArray = false;

  constructor(
    private send: (rows: ClaudeHistoryRow[]) => Promise<void>,
    /** Research runs of this conversation that the page's own polls showed (E1). */
    private research: readonly ClaudeResearchTask[] = [],
  ) {
    this.parser.onValue = ({ value, key, stack }) => {
      if (stack.length === 1 && key === "uuid") {
        if (this.uuid !== null || typeof value !== "string")
          throw new Error("history_unsupported");
        this.uuid = value;
      } else if (stack.length === 1 && key === "model") {
        if (this.sawModel) throw new Error("history_unsupported");
        this.sawModel = true;
        this.model = historyModelLabel(value);
      } else if (stack.length === 1 && key === "current_leaf_message_uuid") {
        if (this.leaf !== null || typeof value !== "string")
          throw new Error("history_unsupported");
        this.leaf = value;
      } else if (
        stack.length === 2 &&
        stack[1]?.key === "chat_messages" &&
        typeof key === "number"
      ) {
        this.sawArray = true;
        const row = claudeHistoryRow(value, {
          model: this.model,
          research: this.research,
        });
        if (this.ids.has(row.message.sourceId))
          throw new Error("history_unsupported");
        this.ids.add(row.message.sourceId);
        this.rows.push(row);
        this.units += historyMessageUnits(row.message);
        this.count++;
      }
    };
  }

  async write(bytes: Uint8Array) {
    // A network read can be large. Bound each synchronous parser turn so the
    // page has an opportunity to handle input between batches.
    for (let offset = 0; offset < bytes.length; offset += 65536) {
      this.parser.write(bytes.subarray(offset, offset + 65536));
      if (
        this.rows.length >= CLAUDE_STREAM_BATCH_MESSAGES ||
        this.units >= CLAUDE_STREAM_BATCH_TEXT_UNITS
      )
        await this.flush();
      if (offset > 0 && offset % (65536 * 8) === 0)
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  async finish(conversationId: string) {
    if (!this.parser.isEnded) this.parser.end();
    if (
      !this.parser.isEnded ||
      this.uuid !== conversationId ||
      !this.leaf ||
      !this.sawArray ||
      this.count === 0 ||
      !this.ids.has(this.leaf)
    )
      throw new Error("history_unsupported");
    await this.flush();
    return { leafId: this.leaf, rowCount: this.count, model: this.model };
  }

  private async flush() {
    if (!this.rows.length) return;
    const queued = this.rows;
    this.rows = [];
    this.units = 0;
    let batch: ClaudeHistoryRow[] = [];
    let units = 0;
    for (const row of queued) {
      const rowUnits = historyMessageUnits(row.message);
      if (
        batch.length &&
        (batch.length >= CLAUDE_STREAM_BATCH_MESSAGES ||
          units + rowUnits > CLAUDE_STREAM_BATCH_TEXT_UNITS)
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
