import {
  HISTORY_LIMITS,
  historyMessageUnits,
  type ComputerFileRow,
  type HistoryTextMessage,
} from "@footprint/adapters";
import type { ComputerFileDownload } from "./own-read-page";

/**
 * Files Perplexity Computer created, made ready to count in the page world (owner decision
 * of 14 Oct 2026). Text and code files count with the normal tokenizer on their content, as
 * output of the model that ran the request. The page shows only a file's name and size, so
 * its content is downloaded read-only from the https link its own asset gives, once per
 * file: a file already counted for this reply keeps its saved count and is not downloaded
 * again. A file that cannot be downloaded counts as its size in bytes divided by 4.
 */

/** Most files one thread read downloads; the rest wait for a later read. */
export const COMPUTER_FILE_DOWNLOADS = 32;
/** Downloads are spaced 1 to 2 s apart, like the own reads' paced requests. */
export const COMPUTER_FILE_SPACING_MS = 1000;
export const COMPUTER_FILE_SPACING_SPREAD_MS = 1000;

/** One file a reply lists, as the history stream asks whether it was counted before. */
export interface ComputerFileQuery {
  /** The reply's source id (the entry's id). */
  reply: string;
  /** The file's asset id. */
  id: string;
}
/** How a file counted before was counted. */
export type ComputerFileCounted = "content" | "size";

export interface ComputerFileDeps {
  /**
   * The files of these replies that saved counts already hold, and how each was counted;
   * null when the question could not be answered (nothing is downloaded then).
   */
  known(
    files: ComputerFileQuery[],
  ): Promise<ReadonlyMap<string, ComputerFileCounted> | null>;
  download(link: string, bytes: number): Promise<ComputerFileDownload>;
  /** Waits; false once the read was stopped. */
  pause(ms: number): Promise<boolean>;
  /** Tells the reader a long read goes on. */
  progress(): Promise<void>;
  random?: () => number;
}

/**
 * Sets the state of every unread text file in these rows: counted before, downloaded,
 * by size, or left unread for a later read. `links` holds each file's link from its asset;
 * a file without one counts by size.
 */
export async function resolveComputerFiles(
  messages: readonly HistoryTextMessage[],
  links: ReadonlyMap<string, string>,
  deps: ComputerFileDeps,
  budget: { downloads: number },
): Promise<void> {
  // A reply still running may not have its files' final content yet.
  const waiting = messages.flatMap((message) =>
    message.role === "response" && message.complete
      ? (message.computerFiles ?? [])
          .filter((file) => file.kind === "text" && file.state === "unread")
          .map((file) => ({ message, file }))
      : [],
  );
  if (!waiting.length) return;
  const known = await deps.known(
    waiting.map(({ message, file }) => ({ reply: message.sourceId, id: file.id })),
  );
  if (!known) return;
  const random = deps.random ?? Math.random;
  let downloaded = 0;
  let held = false;
  for (const { message, file } of waiting) {
    const counted = known.get(file.id);
    if (counted) {
      file.state = counted;
      continue;
    }
    const link = links.get(file.id);
    // The file's text must fit in the reply's message with everything else it carries.
    const room = HISTORY_LIMITS.textUnits - historyMessageUnits(message);
    if (!link || file.bytes > room) {
      file.state = "size";
      continue;
    }
    if (held || budget.downloads <= 0) continue;
    // Each download renews the read's time limit first, so a slow file never ends it.
    await deps.progress();
    if (downloaded > 0) {
      const wait =
        COMPUTER_FILE_SPACING_MS +
        Math.floor(random() * COMPUTER_FILE_SPACING_SPREAD_MS);
      if (!(await deps.pause(wait))) return;
    }
    budget.downloads--;
    downloaded++;
    const result = await deps.download(link, file.bytes);
    setDownload(file, result);
    if (result.kind === "held") held = true;
  }
}

function setDownload(file: ComputerFileRow, result: ComputerFileDownload) {
  if (result.kind === "text") {
    file.state = "content";
    file.text = result.text;
  } else if (result.kind === "failed") file.state = "size";
}
