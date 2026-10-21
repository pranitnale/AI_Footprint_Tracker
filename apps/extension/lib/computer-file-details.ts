import type { ComputerFileRow } from "@footprint/adapters";
import { computerFilesOverLimit } from "./history-capture";

/**
 * What Details says about the files Perplexity Computer created in the open chat (owner
 * decision of 14 Oct 2026). The names come from the reads of this navigation and stay in
 * the content script's memory only; nothing about them is stored or sent. `over_limit`
 * marks a text file whose stated size is past COMPUTER_FILE_LIMIT_BYTES, which is not
 * counted.
 */
export type ComputerFileFact = {
  name: ComputerFileRow["name"];
  state: ComputerFileRow["state"] | "over_limit";
};

/** Most files Details keeps for one chat. */
const FACTS = 256;

/** Notes the files of counted saved replies; a later read of a file replaces its state. */
export function noteComputerFiles(
  facts: Map<string, ComputerFileFact>,
  messages: ReadonlyArray<{ computerFiles?: readonly ComputerFileRow[] }>,
) {
  for (const message of messages) {
    const over = computerFilesOverLimit(message.computerFiles);
    for (const file of message.computerFiles ?? []) {
      facts.delete(file.id);
      facts.set(file.id, {
        name: file.name,
        state: over.has(file.id) ? "over_limit" : file.state,
      });
      while (facts.size > FACTS) facts.delete(facts.keys().next().value!);
    }
  }
}

const files = (count: number) => `${count} file${count === 1 ? "" : "s"}`;
const names = (list: readonly ComputerFileFact[]) =>
  list.map((file) => file.name).join(", ");

/**
 * How the saved replies' files were counted, from their count bases (`computer_files` of
 * the history view). Names are not saved, so these lines name none.
 */
export type SavedComputerFiles = { content: number; size: number };

/** The saved counts from a history view, or null when it has none or is malformed. */
export function savedComputerFiles(value: unknown): SavedComputerFiles | null {
  if (!value || typeof value !== "object") return null;
  const { content, size } = value as Record<string, unknown>;
  const count = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0;
  return count(content) && count(size) && ((content as number) > 0 || (size as number) > 0)
    ? { content: content as number, size: size as number }
    : null;
}

/**
 * Details lines: counted files first, then estimated, unread and uncounted ones. The files
 * this navigation's reads saw are named; without them (a reopened task whose replies were
 * counted before) the saved counts still say how the files were counted.
 */
export function computerFileLines(
  facts: ReadonlyMap<string, ComputerFileFact>,
  saved: SavedComputerFiles | null = null,
): string[] {
  if (!facts.size && saved) {
    const lines: string[] = [];
    if (saved.content)
      lines.push(`Files created: ${saved.content} (counted from their content).`);
    if (saved.size)
      lines.push(
        `Estimated from their size, because they could not be downloaded: ${files(saved.size)}. Each counts as its size in bytes divided by 4.`,
      );
    return lines;
  }
  const all = [...facts.values()];
  const by = (state: ComputerFileFact["state"]) =>
    all.filter((file) => file.state === state);
  const lines: string[] = [];
  const content = by("content"),
    size = by("size"),
    unread = by("unread"),
    overLimit = by("over_limit"),
    other = by("other");
  if (content.length)
    lines.push(
      `Files created: ${content.length} (counted from their content): ${names(content)}.`,
    );
  if (size.length)
    lines.push(
      `Estimated from their size, because they could not be downloaded: ${names(size)}. Each counts as its size in bytes divided by 4.`,
    );
  if (unread.length)
    lines.push(
      `Not downloaded yet, so not counted: ${names(unread)}. They are counted when the chat is read again with the tab shown.`,
    );
  if (overLimit.length)
    lines.push(
      `Not counted, because the page states a size past the tracker's limit of 32 MiB per file and per reply: ${names(overLimit)}. The reply shows as partly measured.`,
    );
  if (other.length)
    lines.push(
      `${files(other.length)} not counted, because only text and code files are: ${names(other)}.`,
    );
  return lines;
}
