import { timingEvidence } from "@footprint/capture-core";
import {
  boundedText,
  finishHistoryPage,
  historyMessage,
  historyMessageUnits,
  historyPage,
} from "./common";
import { HISTORY_LIMITS } from "./types";
import { GENERATED_TEXT_LIMITS } from "../generated-text";
import {
  geminiField,
  geminiLabel,
  geminiReply,
  geminiTime,
  type GeminiImage,
} from "../gemini-content";
import { geminiGenerated } from "../gemini";
import type { GeneratedMedia } from "../types";

/** The history call the page makes when a chat opens or loads earlier turns. */
export const GEMINI_HISTORY_RPC = "hNvQHb";
const turnId = (v: unknown): v is string =>
  typeof v === "string" && /^r_[0-9a-f]{16}$/.test(v);
const candidateId = (v: unknown): v is string =>
  typeof v === "string" && /^rc_[0-9a-f]{16}$/.test(v);
function time(pair: unknown): string | null {
  const value = geminiTime(pair);
  if (!value || value[0] > 253402300799 || value[1] % 1000 !== 0) return null;
  return (
    new Date(value[0] * 1000).toISOString().slice(0, 19) +
    "." +
    String(value[1] / 1000).padStart(6, "0") +
    "Z"
  );
}
/** Seconds from one stored time to a later one, or null. */
function span(
  from: [number, number] | null,
  to: [number, number] | null,
): number | null {
  if (!from || !to) return null;
  const seconds = to[0] - from[0] + (to[1] - from[1]) / 1e9;
  return seconds > 0 ? seconds : null;
}
/** The prompt's text: the canonical string array (14 Sep), else its first string. */
function promptText(record: unknown): string | null {
  const query = geminiField(record, 0);
  if (!Array.isArray(query)) return null;
  const text = query.every((part) => typeof part === "string")
    ? query.join("")
    : // A tool turn's prompt holds more fields after its text (a video turn, 3 Oct).
      typeof query[0] === "string"
      ? query[0]
      : null;
  return text !== null && boundedText(text) ? text : null;
}
/** Images grouped by size, each group one media item (D1). */
function imageMedia(
  images: readonly GeminiImage[],
  model: string | null,
): GeneratedMedia[] {
  const groups = new Map<string, GeneratedMedia & { kind: "image" }>();
  for (const image of images) {
    const key = `${image.width}x${image.height}`;
    const group = groups.get(key);
    if (group) group.count++;
    else
      groups.set(key, {
        kind: "image",
        count: 1,
        width: image.width,
        height: image.height,
        model,
        outcome: "returned",
      });
  }
  return [...groups.values()];
}

/** A saved turn's reply, by the same rule as the live stream (W8). */
function readReply(
  response: ReturnType<typeof historyMessage>,
  candidate: unknown,
  label: string | null,
  turnTime: [number, number] | null,
  others: boolean,
) {
  const reply = geminiReply(candidate);
  let unknown = reply.unknown || others;
  let limited = false;
  response.modelId = label;
  if (reply.answer !== null && boundedText(reply.answer))
    response.text = reply.answer;
  // An answer too long to read is left out for its size; a missing one is unknown.
  else if (reply.answer !== null) limited = true;
  else unknown = true;
  for (const [key, text] of [
    ["thinking", reply.thinking],
    ["toolInput", reply.toolInput],
    ["intermediate", reply.intermediate],
    // Results the page shows in full are input (A6); none are in the fields read here.
    ["toolOutput", reply.unknown ? undefined : ""],
  ] as const) {
    if (text === undefined || text === null) continue;
    if (boundedText(text)) response[key] = text;
    else limited = true;
  }
  const generated = geminiGenerated(reply, label);
  const components = generated.components
    .filter((component) => {
      if (component.text !== null && boundedText(component.text)) return true;
      if (component.text !== null) limited = true;
      else unknown = true;
      return false;
    })
    .map((component) => {
      if (component.role !== "research") return component;
      // The report's document is stored when the run ends; its span from the turn is the
      // research time (G4: 109 s). Gemini keeps no other reply times.
      const seconds = span(turnTime, reply.report?.storedAt ?? null);
      const timing =
        seconds === null
          ? null
          : timingEvidence(
              seconds,
              "gemini_history",
              "complete_for_scope",
              "research_task",
            );
      return timing ? { ...component, timing } : component;
    });
  if (components.length) response.components = components;
  const media = [...generated.videos, ...imageMedia(reply.images, label)];
  if (media.length > GENERATED_TEXT_LIMITS.media) unknown = true;
  if (media.length)
    response.media = media.slice(0, GENERATED_TEXT_LIMITS.media);
  // One message fits one counting batch: tool results go first, then intermediate text,
  // tool input, thinking and other models' text; a part left out stays unknown.
  for (const key of [
    "toolOutput",
    "intermediate",
    "toolInput",
    "thinking",
    "components",
  ] as const)
    if (
      !!response[key]?.length &&
      historyMessageUnits(response) > HISTORY_LIMITS.textUnits
    ) {
      delete response[key];
      limited = true;
    }
  const reasons = [
    ...(unknown ? ["unknown_event_observed" as const] : []),
    ...(limited ? ["capture_limit_exceeded" as const] : []),
    ...(reply.research ? ["research_work_unobserved" as const] : []),
  ];
  if (reasons.length) response.coverageReasons = reasons;
  // A turn stopped before its answer stores an empty answer (14 Sep): it is not complete.
  response.complete = response.text !== null && !reply.empty;
}

export function geminiHistory(
  value: unknown,
  conversationId: string,
  observedAt: string,
) {
  const rows = geminiField(value, 0);
  if (
    !Array.isArray(rows) ||
    rows.length === 0 ||
    rows.length > HISTORY_LIMITS.messages / 2
  )
    throw new Error("history_unsupported");
  const page = historyPage("gemini", conversationId, observedAt);
  type Turn = {
    id: string;
    row: unknown[];
    prior: [string, string, string] | null;
    selected: unknown;
    selectedId: string;
    others: boolean;
  };
  const turns = new Map<string, Turn>();
  // Google drops trailing empty fields from its arrays, so only the ids are required; a
  // turn's content that cannot be read makes that reply partial (N1).
  for (const row of rows) {
    const ids = geminiField(row, 0);
    const prior = geminiField(row, 1) ?? null;
    const response = geminiField(row, 3);
    const candidates = geminiField(response, 0);
    const selectedId = geminiField(response, 3);
    if (
      !Array.isArray(row) ||
      !Array.isArray(ids) ||
      ids[0] !== conversationId ||
      !turnId(ids[1]) ||
      turns.has(ids[1]) ||
      (prior !== null &&
        (!Array.isArray(prior) ||
          prior[0] !== conversationId ||
          !turnId(prior[1]) ||
          !candidateId(prior[2]))) ||
      !Array.isArray(candidates) ||
      candidates.length === 0 ||
      candidates.length > HISTORY_LIMITS.blocks ||
      !candidateId(selectedId)
    )
      throw new Error("history_unsupported");
    const selected = candidates.filter(
      (candidate) => geminiField(candidate, 0) === selectedId,
    );
    if (selected.length !== 1) throw new Error("history_unsupported");
    turns.set(ids[1], {
      id: ids[1],
      row,
      prior: prior as Turn["prior"],
      selected: selected[0],
      selectedId,
      // Only one candidate per turn was ever seen; another one is not counted.
      others: candidates.length > 1,
    });
  }
  const chain: Turn[] = [],
    seen = new Set<string>();
  const referenced = new Set(
    [...turns.values()].flatMap((turn) => (turn.prior ? [turn.prior[1]] : [])),
  );
  const heads = [...turns.keys()].filter((id) => !referenced.has(id));
  if (heads.length !== 1) throw new Error("history_unsupported");
  let next: string | null = heads[0]!;
  let root = false;
  while (next && turns.has(next)) {
    if (seen.has(next)) throw new Error("history_unsupported");
    seen.add(next);
    const item: Turn = turns.get(next)!;
    chain.push(item);
    if (item.prior === null) {
      root = true;
      break;
    }
    const prior = turns.get(item.prior[1]);
    if (prior && prior.selectedId !== item.prior[2])
      throw new Error("history_unsupported");
    next = item.prior[1];
  }
  if (chain.length !== turns.size) throw new Error("history_unsupported");
  page.selectedLeafId = chain[0]!.selectedId;
  page.branchScope = "selected_branch";
  page.branchSourceIds = [];
  for (const turn of chain.reverse()) {
    const prompt = historyMessage(turn.id, "prompt"),
      response = historyMessage(turn.selectedId, "response");
    if (turn.prior) {
      prompt.parentSourceId = turn.prior[2];
      prompt.parentRole = "response";
    }
    prompt.requestId = response.requestId = prompt.sourceId;
    response.liveAttemptId = response.sourceId;
    response.parentSourceId = prompt.sourceId;
    response.promptSourceId = prompt.sourceId;
    response.parentRole = "prompt";
    const stored = geminiField(turn.row, 4);
    prompt.occurredAt = time(stored);
    response.occurredAt = prompt.occurredAt;
    if (prompt.occurredAt)
      prompt.dateBasis = response.dateBasis = "turn_created";
    prompt.text = promptText(geminiField(turn.row, 2));
    prompt.complete = prompt.text !== null;
    const label = geminiLabel(geminiField(geminiField(turn.row, 3), 21));
    // The turn's one label names the model that answered its prompt.
    prompt.modelId = label;
    readReply(response, turn.selected, label, geminiTime(stored), turn.others);
    page.messages.push(prompt, response);
    page.branchSourceIds.push(prompt.sourceId, response.sourceId);
  }
  if (root) {
    page.rootSourceId = page.messages[0]!.sourceId;
    page.firstRequestVerified = true;
    page.hasEarlier = false;
  }
  return finishHistoryPage(page);
}

/** This history RPC uses observed line framing, independently of live StreamGenerate framing. */
export function geminiHistoryFrames(body: string): unknown {
  if (!body.startsWith(")]}'")) throw new Error("history_unsupported");
  const lines = body.slice(4).split(/\r?\n/);
  let result: unknown,
    found = false;
  for (let index = 0; index < lines.length;) {
    if (lines[index] === "") {
      index++;
      continue;
    }
    const size = lines[index++],
      line = lines[index++];
    if (
      !size ||
      !/^[1-9][0-9]*$/.test(size) ||
      line === undefined ||
      Number(size) !== line.length + 2
    )
      throw new Error("history_unsupported");
    const rows = JSON.parse(line);
    if (!Array.isArray(rows)) throw new Error("history_unsupported");
    for (const row of rows)
      if (
        Array.isArray(row) &&
        row[0] === "wrb.fr" &&
        row[1] === GEMINI_HISTORY_RPC
      ) {
        if (found || typeof row[2] !== "string")
          throw new Error("history_unsupported");
        found = true;
        result = JSON.parse(row[2]);
      }
  }
  if (!found) throw new Error("history_unsupported");
  return result;
}
