/**
 * The Details overlay summary (canvas board "Details overlay", chosen 7 and 8 Oct 2026): figures with
 * their range, everyday terms, four token numbers, how the chat compares with the person's other
 * chats, what was counted and how it was estimated. Presentation only: every number comes from the
 * figures the bar already shows, so the bar and Details never disagree.
 */
import { scenarioValue, type DisplayScenario } from "./display-scenario";
import { OWN_READ_SETTING_NAMES, type OwnReadSettingKey } from "./own-read-settings";
import { comparableTotal } from "@footprint/ui/totals";
import { formatInteger, metricParts } from "@footprint/ui/formatters";
import {
  carDistance,
  LED_BULB_WATTS,
  ledDuration,
  phoneCharges,
  toGrams,
  toMillilitres,
  toWh,
  waterAmount,
  wordsForTokens,
} from "@footprint/ui/comparisons";
import { modelName } from "./ui/model-names";
import type { ChatComparison } from "./chat-comparison";
import { readSmallerModel, SMALLER_NAMES, type SmallerModel } from "./smaller-model";

export type DetailsFigure = {
  value: string | null;
  unit: string;
  value_kind?: string | null;
  scenario_low?: string | null;
  scenario_high?: string | null;
  /** Rows that cannot be added, so no single figure exists. */
  multiple?: boolean;
};

export type DetailsInput = {
  /** The site, or "cowork" for a Claude Cowork session. */
  surface: string;
  siteName: string;
  scenario: DisplayScenario;
  requests: string | null;
  requestsApproximate: boolean;
  tokensIn: string | null;
  tokensOut: string | null;
  energy: DetailsFigure;
  carbon: DetailsFigure;
  water: DetailsFigure;
  /** Registry model ids of the replies, live and imported from saved history, in order of appearance. */
  models: readonly string[];
  /**
   * A short note shown after a model's name in How this was estimated, by model id. The hook for
   * family stand-ins: a model the library does not list yet can say which model of its family
   * its estimate used. Absent means no note.
   */
  modelNotes?: Readonly<Record<string, string>>;
  /** Whether the chat's earlier messages are loaded; null when the site keeps no earlier chat. */
  earlierLoaded: boolean | null;
};

/** A synced resource as one figure: rows calculated alike add up (D4), others stay separate. */
export function serverFigure(resources: ReadonlyArray<{ quantity: string; value: string | null; unit: string }> | undefined, quantity: string, unit: string): DetailsFigure {
  const rows = (resources ?? []).filter((row) => row.quantity === quantity);
  if (!rows.length) return { value: null, unit };
  const total = comparableTotal(rows as Parameters<typeof comparableTotal>[0]);
  return { value: total.value, unit: total.unit || unit, value_kind: total.value_kind, scenario_low: total.scenario_low, scenario_high: total.scenario_high, multiple: total.multiple };
}

const SCENARIO_NAMES: Record<DisplayScenario, string> = { minimum: "Minimum", midpoint: "Midpoint", maximum: "Maximum" };
export const scenarioName = (scenario: DisplayScenario) => SCENARIO_NAMES[scenario] ?? "Minimum";

type Kind = "energy" | "carbon" | "water";
const LABELS: Record<Kind, string> = { energy: "Electricity", carbon: "Carbon", water: "Water" };

export type FigureCard = {
  kind: Kind;
  label: string;
  number: string;
  unit: string;
  /** "8.99 to 17.1 Wh"; null for a single value. Shown under How this was estimated, not on the tile. */
  range: string | null;
};

const num = (value: string | null | undefined) => (value == null || value === "" ? null : Number(value));

/** One figure as shown at the scenario: its number, unit and range. Unknown and mixed figures say so. */
export function figureCard(kind: Kind, figure: DetailsFigure, scenario: DisplayScenario): FigureCard {
  const label = LABELS[kind];
  if (figure.multiple) return { kind, label, number: "See below", unit: "", range: null };
  const ranged = (figure.value_kind === "midpoint_sum" || figure.value_kind === "midpoint") && figure.scenario_low != null && figure.scenario_high != null;
  const shown = ranged ? scenarioValue({ value: figure.value, value_kind: figure.value_kind as "midpoint_sum", scenario_low: figure.scenario_low!, scenario_high: figure.scenario_high! }, scenario) : figure.value;
  const parts = shown == null ? null : metricParts(shown, figure.unit);
  if (!parts) return { kind, label, number: "Unknown", unit: "", range: null };
  if (!ranged) return { kind, label, number: parts.number, unit: parts.unit, range: null };
  const low = metricParts(figure.scenario_low!, figure.unit),
    high = metricParts(figure.scenario_high!, figure.unit);
  const range = low && high ? (low.unit === high.unit ? `${low.number} to ${high.number} ${high.unit}` : `${low.number} ${low.unit} to ${high.number} ${high.unit}`) : null;
  return { kind, label, number: parts.number, unit: parts.unit, range };
}

const shownValue = (figure: DetailsFigure, scenario: DisplayScenario) => {
  if (figure.multiple) return null;
  const ranged = (figure.value_kind === "midpoint_sum" || figure.value_kind === "midpoint") && figure.scenario_low != null && figure.scenario_high != null;
  return ranged ? scenarioValue({ value: figure.value, value_kind: figure.value_kind as "midpoint_sum", scenario_low: figure.scenario_low!, scenario_high: figure.scenario_high! }, scenario) : figure.value;
};

export type Everyday = { kind: Kind; icon: "bulb" | "phone" | "car" | "drop"; value: string; text: string };

/** The four everyday cards at the scenario. A card whose figure is unknown is left out. */
export function everydayTerms(input: Pick<DetailsInput, "energy" | "carbon" | "water" | "scenario">): Everyday[] {
  const out: Everyday[] = [];
  const wh = toWh(shownValue(input.energy, input.scenario), input.energy.unit);
  if (wh !== null && wh > 0) {
    const led = ledDuration(wh),
      phone = phoneCharges(wh);
    out.push({ kind: "energy", icon: "bulb", value: `${led.value} ${led.unit}`, text: `${LED_BULB_WATTS} W LED bulb` });
    out.push({ kind: "energy", icon: "phone", value: phone.value, text: phone.unit });
  }
  const grams = toGrams(shownValue(input.carbon, input.scenario), input.carbon.unit);
  if (grams !== null && grams > 0) {
    const car = carDistance(grams);
    out.push({ kind: "carbon", icon: "car", value: `${car.value} ${car.unit}`, text: "driven by car" });
  }
  const ml = toMillilitres(shownValue(input.water, input.scenario), input.water.unit);
  if (ml !== null && ml > 0) {
    const water = waterAmount(ml);
    out.push({ kind: "water", icon: "drop", value: `${water.value} ${water.unit}`, text: "of water" });
  }
  return out;
}

/** Requests, tokens read and written, and words per reply. */
export function tokenFigures(input: Pick<DetailsInput, "requests" | "requestsApproximate" | "tokensIn" | "tokensOut">) {
  const requests = num(input.requests);
  const out = num(input.tokensOut);
  const words = requests && out !== null && requests > 0 ? wordsForTokens(out / requests) : null;
  const known = (value: string | null) => (value === null ? "Unknown" : formatInteger(value));
  return [
    { value: input.requests === null ? "Unknown" : `${input.requestsApproximate ? "≈ " : ""}${formatInteger(input.requests)}`, text: "requests" },
    { value: known(input.tokensIn), text: "read, in" },
    { value: known(input.tokensOut), text: "written, out" },
    { value: words === null ? "Unknown" : `≈ ${formatInteger(words)}`, text: "words per reply" },
  ];
}

export type Mark = "full" | "half" | "empty";
export type CountedPart = { label: string; mark: Mark; state: string };

/**
 * What each tool lets the tracker count, from the decided coverage rules (the coverage notes in
 * estimate-details.ts say the same in full). An empty mark is a part the tool hides, never an error.
 */
export function countedParts(surface: string, siteName: string, earlierLoaded: boolean | null): CountedPart[] {
  const hidden = `not shown by ${siteName}`;
  const messages: CountedPart =
    earlierLoaded === false ? { label: "Your messages and the earlier chat", mark: "half", state: "earlier chat not loaded" } : { label: "Your messages and the earlier chat", mark: "full", state: "counted" };
  const answers: CountedPart = { label: "Answers", mark: "full", state: "counted" };
  switch (surface) {
    case "cowork":
      return [
        { label: "Your messages and the session", mark: "full", state: "counted" },
        answers,
        { label: "Reasoning", mark: "full", state: "from the usage report" },
        { label: "Tool steps", mark: "full", state: "counted" },
        { label: "Side calls: titles, suggestions", mark: "full", state: "from the usage report" },
      ];
    case "perplexity":
      return [
        messages,
        answers,
        { label: "Searches and steps shown", mark: "full", state: "counted" },
        { label: "Reasoning", mark: "empty", state: hidden },
        { label: "Internal search pipeline", mark: "empty", state: hidden },
      ];
    case "notebooklm":
      return [
        // Saved chats count since 14 October 2026; a long chat may not be loaded to its start.
        messages,
        answers,
        { label: "Studio items", mark: "half", state: "content, not instructions" },
        { label: "Reasoning", mark: "empty", state: hidden },
        { label: "Audio and Video Overview scripts", mark: "empty", state: hidden },
      ];
    default:
      return [
        messages,
        answers,
        { label: "Reasoning", mark: "half", state: "summary only" },
        { label: "Searches and tool steps shown", mark: "full", state: "counted" },
        { label: "Side calls: titles, safety checks", mark: "empty", state: hidden },
      ];
  }
}

/** "Everything ChatGPT shows. ChatGPT hides 1 part." */
export function countedSummary(parts: readonly CountedPart[], siteName: string) {
  const hidden = parts.filter((p) => p.mark === "empty").length;
  if (!hidden) return `Everything ${siteName} shows is counted.`;
  return `Everything ${siteName} shows. ${siteName} hides ${hidden} part${hidden === 1 ? "" : "s"}.`;
}

/** Readable model names, each once, in order of appearance. */
export function modelNames(ids: readonly string[]) {
  return [...new Set(ids.filter(Boolean).map(modelName))];
}

/** Readable model names, each once, with the note the input gives for that model. */
export function notedModelNames(ids: readonly string[], notes: Readonly<Record<string, string>> = {}) {
  const shown = new Map<string, string>();
  for (const id of ids.filter(Boolean)) {
    const name = modelName(id);
    const note = notes[id];
    if (!shown.has(name) || (note && !shown.get(name)!.includes("("))) shown.set(name, note ? `${name} (${note})` : name);
  }
  return [...shown.values()];
}

/**
 * The models Details names: those of the saved history the page loaded (the earlier messages),
 * then those of live replies, each once. A chat imported from history names its models too.
 */
export function detailsModels(live: readonly string[], history: readonly string[] | null | undefined) {
  return [...new Set([...(history ?? []), ...live])];
}

/** Model, method and the factors behind the figures, at the scenario. */
export function estimatedRows(input: DetailsInput): Array<[string, string]> {
  const names = notedModelNames(input.models, input.modelNotes);
  const rows: Array<[string, string]> = [
    [names.length > 1 ? "Models" : "Model", names.length ? names.join(", ") : "Not named by the page"],
    ["Method", `EcoLogits, ${scenarioName(input.scenario)} scenario`],
  ];
  // The tiles show one figure; its EcoLogits minimum to maximum range stays here (owner, 12 October 2026).
  for (const kind of ["energy", "carbon", "water"] as const) {
    const card = figureCard(kind, input[kind], input.scenario);
    if (card.range) rows.push([`${card.label}, minimum to maximum`, card.range]);
  }
  const wh = toWh(shownValue(input.energy, input.scenario), input.energy.unit);
  const out = num(input.tokensOut);
  if (wh !== null && out !== null && out > 0) {
    const perThousand = metricParts(String((wh / out) * 1000 / 1000), "kWh");
    if (perThousand) rows.push(["Electricity per 1,000 tokens out", `${perThousand.number} ${perThousand.unit}`]);
  }
  const grams = toGrams(shownValue(input.carbon, input.scenario), input.carbon.unit);
  const ml = toMillilitres(shownValue(input.water, input.scenario), input.water.unit);
  if (wh !== null && wh > 0 && grams !== null && ml !== null) {
    const kwh = wh / 1000;
    const carbon = metricParts(String(grams / kwh), "gCO2e");
    const water = metricParts(String(ml / 1000 / kwh), "L");
    if (carbon && water) rows.push(["Carbon and water per kWh", `${carbon.number} ${carbon.unit} · ${water.number} ${water.unit}`]);
  }
  return rows;
}

export function estimatedSummary(input: DetailsInput) {
  const names = modelNames(input.models);
  return [names.length > 2 ? `${names.length} models` : names.join(", ") || "Model not named", "EcoLogits", scenarioName(input.scenario)].join(" · ");
}

/** The sub-heading under "This chat": requests and the model. */
export function headerLine(input: DetailsInput) {
  const requests = num(input.requests);
  const names = modelNames(input.models);
  return [
    requests === null ? null : `${input.requestsApproximate ? "≈ " : ""}${formatInteger(input.requests!)} request${requests === 1 ? "" : "s"}`,
    names.length > 2 ? `${names.length} models` : names.join(", ") || null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export type ComparisonState = { state: "loading" } | { state: "failed" } | { state: "ready"; result: ChatComparison };

const percent = (share: number) => `${Math.round(share * 100)}%`;

/** The summary line under "Compared with your chats". */
export function comparisonLine(comparison: ComparisonState) {
  if (comparison.state === "loading") return "Comparing with your other chats";
  if (comparison.state === "failed") return "The comparison is not available right now";
  const r = comparison.result;
  if (r.smallerShare === null) return r.chats ? "Too few chats in the last 30 days to compare" : "No other chats in the last 30 days";
  // "Bigger than 0% / 100% of your chats" read oddly (live QA, 19 Oct 2026). The share counts
  // the other chats that are strictly smaller, so the ends get their own words, and a share
  // that only rounds to 0% or 100% stays inside the ends.
  if (r.smallerShare <= 0) return "None of your other chats was smaller · last 30 days";
  if (r.smallerShare >= 1) return "Bigger than all your other chats · last 30 days";
  const share = Math.min(99, Math.max(1, Math.round(r.smallerShare * 100)));
  return `Bigger than ${share}% of your chats · last 30 days`;
}

/** Validates the background's reply so a malformed message can only show "not available". */
export function readComparison(value: unknown): ChatComparison | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const n = (x: unknown) => x === null || (typeof x === "number" && Number.isFinite(x) && x >= 0);
  if (!Number.isSafeInteger(v.chats) || !n(v.thisChat) || !n(v.smallerShare) || !n(v.averageWh) || !n(v.todayShare)) return null;
  if (!Array.isArray(v.bins) || v.bins.length > 64 || !v.bins.every((b) => Number.isSafeInteger(b) && (b as number) >= 0)) return null;
  if (v.thisBin !== null && !(Number.isSafeInteger(v.thisBin) && (v.thisBin as number) >= 0 && (v.thisBin as number) < v.bins.length)) return null;
  if ((v.smallerShare as number | null) !== null && (v.smallerShare as number) > 1) return null;
  if ((v.todayShare as number | null) !== null && (v.todayShare as number) > 1) return null;
  return { chats: v.chats as number, thisChat: v.thisChat as number | null, smallerShare: v.smallerShare as number | null, averageWh: v.averageWh as number | null, todayShare: v.todayShare as number | null, bins: v.bins as number[], thisBin: v.thisBin as number | null, smallerModel: readSmallerModel(v.smallerModel) };
}

export type SmallerCard = { thisChat: string; smaller: string; share: number; note: string };

/**
 * "The same output tokens with a smaller model": the electricity Details shows for this chat and the
 * same chat with each reply's main text from a smaller record, at the chosen scenario. Null when the
 * figure is unknown or nothing would shrink.
 */
export function smallerModelCard(input: Pick<DetailsInput, "energy" | "scenario">, smaller: SmallerModel | null | undefined): SmallerCard | null {
  if (!smaller) return null;
  const wh = toWh(shownValue(input.energy, input.scenario), input.energy.unit);
  if (wh === null || !(wh > 0)) return null;
  const after = wh + smaller[input.scenario];
  if (!(after < wh)) return null;
  const text = (value: number) => {
    const parts = metricParts(String(value / 1000), "kWh");
    return parts ? `${parts.number} ${parts.unit}`.trim() : null;
  };
  const shown = text(wh);
  // A smaller model still uses electricity, so zero or less means the shown figure covers less
  // than the compared replies. Say so rather than print a misleading "0 kWh".
  const lower = after > 0 ? text(after) : null;
  if (!shown) return null;
  const names = smaller.records.map((record) => SMALLER_NAMES[record] ?? record);
  const kept = smaller.unchanged ? ` ${formatInteger(smaller.unchanged)} ${smaller.unchanged === 1 ? "reply keeps its" : "replies keep their"} own figure.` : "";
  return {
    thisChat: shown,
    smaller: lower ? `≈ ${lower}` : "Not available",
    share: lower ? after / wh : 0,
    note: `Compared with ${names.join(" and ")}. Assumes the same answer length; another model would write a different answer.${kept}`,
  };
}

export function smallerModelNodes(doc: Document, card: SmallerCard): HTMLElement {
  const row = (label: string, share: number, value: string, lighter: boolean) =>
    el(
      doc,
      "div",
      { class: "dt-wi" },
      el(doc, "span", {}, label),
      el(doc, "span", { class: "dt-wi-bar", "aria-hidden": "true" }, el(doc, "i", { style: `width:${share > 0 ? Math.max(2, Math.round(share * 100)) : 0}%`, ...(lighter ? { "data-lighter": "true" } : {}) })),
      el(doc, "span", { class: "dt-wi-value" }, value),
    );
  return el(
    doc,
    "div",
    { class: "dt-box", "data-section": "smaller" },
    el(doc, "b", { class: "dt-box-title" }, "The same output tokens with a smaller model"),
    row("This chat", 1, card.thisChat, false),
    row("Smaller model", card.share, card.smaller, true),
    el(doc, "span", { class: "dt-soft dt-wi-note" }, card.note),
  );
}

/** `settings`: the label of a button that opens Settings, where the fix is a setting. */
export type DetailsStatus = { chip: string; text: string; tone: "info" | "warn"; reload?: boolean; retry?: boolean; settings?: string };

/**
 * What Details says for each status (canvas board BarStatusSheet). Details names the state in
 * plain words. Up to date shows no message, figures first. Statuses the person cannot act on are
 * listed under "Not everything could be counted" (owner, 13 Oct 2026), so their text says what was
 * not counted and why. Progress (Processing, Updating, Loading) is not a status: it goes to the
 * line at the bottom of Details (progressText).
 */
const STATUS_RULES: ReadonlyArray<[RegExp, DetailsStatus]> = [
  [/Reload required/, { chip: "Reload the page", text: "Reload this page to keep tracking.", tone: "warn", reload: true }],
  [/Site access removed/, { chip: "No access to this site", text: "Allow the extension on this site, then reload.", tone: "warn" }],
  [/Tracking problem \(reload page\)/, { chip: "Reply not counted", text: "The cause, effect and time are below. Reloading the page usually fixes it and does not send a message.", tone: "warn", reload: true }],
  [/Tracking problem \(allow access\)/, { chip: "Reply not counted", text: "The extension has no access to this site. Allow the extension on this site, then reload.", tone: "warn" }],
  [/Tracking problem \(free browser storage\)/, { chip: "Reply not counted", text: "This browser could not save usage, so recent replies may be missing. Free some browser storage, then restart the browser.", tone: "warn" }],
  [/Tracking problem \(retry\)/, { chip: "Reply not counted", text: "The saved totals of this chat could not be read. Retry reads them again and does not send a message.", tone: "warn", retry: true }],
  [/Tracking problem(?! \()/, { chip: "Reply not counted", text: "Part of the activity on this page could not be recorded. The cause, effect and time are below.", tone: "warn" }],
  [/Conversation totals unavailable \(|Saved totals refresh problem \(/, { chip: "Totals unavailable", text: "The saved totals of this chat could not be read. Retry reads them again and does not send a message.", tone: "warn", retry: true }],
  [/Conversation totals unavailable(?! \()|Saved totals refresh problem(?! \()|Usage unknown|AI usage unavailable/, { chip: "Totals unavailable", text: "The saved totals of this chat could not be read. The cause is below.", tone: "warn" }],
  [/History calculation unavailable|History update problem/, { chip: "Earlier messages not estimated", text: "New replies are still counted. Reloading the page tries the earlier messages again.", tone: "warn", reload: true }],
  [/Earlier activity unavailable/, { chip: "Earlier messages not estimated", text: "The earlier messages of this chat could not be estimated on this device. New replies are still counted.", tone: "warn" }],
  [/History too large/, { chip: "Chat too long to read in full", text: "Figures cover the part that was read. Scrolling or reloading cannot change this limit.", tone: "warn" }],
  [/History not loaded|Earlier messages not counted/, { chip: "Earlier messages not loaded", text: "They are counted once the page loads them. Reloading the page does not send a message.", tone: "warn", reload: true }],
  // Until 17 Oct 2026 Perplexity sent a thread's messages only when the thread was opened inside
  // the page. Since the live QA of 19 Oct 2026 a full page load sends them too, so the tracker's
  // own read or the page's read normally counts the thread and this entry is rarely reached.
  [/Thread not loaded/, { chip: "Earlier messages not loaded", text: "Perplexity did not send this thread's messages, so they were not counted. Perplexity sends them when the page loads, so reloading the page usually counts them. Reloading does not send a message.", tone: "warn" }],
  // ChatGPT used without an account never saves a chat (live, 20 Oct 2026): reloading opens an
  // empty chat, so no button is offered.
  [/Earlier messages not saved/, { chip: "Earlier messages not counted", text: "ChatGPT does not save chats made without an account, so messages this browser did not see while tracking was on cannot be read or counted. Messages sent from now on are counted.", tone: "warn" }],
  [/Matching incomplete|History match unavailable|Synced matching unavailable|Recorded match changed/, { chip: "Not all records linked", text: "Some saved messages could not be linked to recorded requests, so they are left out or marked as approximate. How this was estimated lists which.", tone: "warn" }],
  [/Partially loaded/, { chip: "Some earlier messages missing", text: "The start of this chat could not be read, so figures cover the messages that were read.", tone: "warn" }],
];

/** The statuses Details opens with, most serious first, from the bar's status and figure text. */
export function detailsStatuses(status: string, metrics = ""): DetailsStatus[] {
  const text = `${status} · ${metrics}`;
  return STATUS_RULES.filter(([rule]) => rule.test(text)).map(([, value]) => value);
}

/**
 * Details statuses in two groups: those shown on the bar open Details, and the rest (statuses
 * only Details explains, and states the figure text implies) go under "Not everything could be
 * counted".
 */
export function detailsStatusGroups(barStatus: string, detailsOnly: string, metrics = "") {
  const shown = detailsStatuses(barStatus);
  const rest = detailsStatuses(detailsOnly, metrics).filter((status) => !shown.includes(status));
  return { bar: shown, notCounted: rest };
}

// ---- DOM ----------------------------------------------------------------------------------------

type Child = Node | string | null | undefined | false;
function el(doc: Document, tag: string, attrs: Record<string, string> = {}, ...children: Child[]) {
  const node = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

const ICONS: Record<string, string> = {
  bulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z",
  phone: "M9 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM11 18h2",
  car: "M3 16v-3l2-5h14l2 5v3zM6 16.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M15 16.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0",
  drop: "M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z",
  chevron: "m6 9 6 6 6-6",
  close: "M6 6l12 12M18 6 6 18",
  cloudCheck: "M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9zM9.5 13.5l2 2 3.5-3.5",
  sync: "M20 11a8 8 0 0 0-14.3-4.3L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.3 4.3l1.7-1.8M20 20v-4.5h-4.5",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M12 7v5l3 2",
  cloudOff: "M7 18a4 4 0 0 1-.6-8 6 6 0 0 1 1.2-2.4M10.5 5.3A6 6 0 0 1 18 9a4.5 4.5 0 0 1 2.8 7.6M17.5 18H7M3 3l18 18",
};
export function icon(doc: Document, name: keyof typeof ICONS | string, size = 14) {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "dt-i");
  const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICONS[name] ?? "");
  svg.append(path);
  return svg;
}

const dot = (doc: Document, mark: Mark, small = false) => el(doc, "span", { class: `dt-dot${small ? " dt-dot-sm" : ""}`, "data-mark": mark });

/**
 * One row per status: a small chip and its sentence, with a reload or retry button where that
 * is the fix. These rows open Details; the bar itself shows no status (owner, 14 Oct 2026).
 */
export function statusNodes(doc: Document, statuses: readonly DetailsStatus[], reload: () => void, retry?: () => void, openSettings?: () => void): HTMLElement[] {
  const action = (label: string, className: string, run: () => void) => {
    const b = el(doc, "button", { type: "button", class: className }, label);
    b.addEventListener("click", run);
    return b;
  };
  return statuses.map((s) =>
    el(
      doc,
      "div",
      { class: "dt-status", "data-tone": s.tone },
      el(doc, "span", { class: "dt-chip" }, s.chip),
      el(doc, "span", { class: "dt-status-text" }, s.text),
      s.reload ? action("Reload page", "dt-reload", reload) : null,
      s.retry && retry ? action("Retry", "dt-retry", retry) : null,
      s.settings && openSettings ? action(s.settings, "dt-reload dt-settings", openSettings) : null,
    ),
  );
}

/** Sites where reloading the page makes it load a chat's messages again. */
const RELOAD_LOADS: ReadonlySet<OwnReadSettingKey> = new Set(["claude", "cowork", "gemini", "notebooklm"]);

/**
 * The Details entry when "Load full chat history" is off for the site and a chat's messages are
 * missing only for that reason (owner decision of 17 Oct 2026). It names the switch, says what
 * works without it, and offers to turn it on. `reloadOffered`: another entry already has a
 * Reload page button, so this one does not repeat it. Nothing of it reaches the bar.
 */
export function ownReadOffStatus(
  key: OwnReadSettingKey,
  mode: string,
  reloadOffered = false,
  mainSwitch = false,
): DetailsStatus {
  const name = OWN_READ_SETTING_NAMES[key];
  // With the main switch off the site's own switch is still on but cannot be changed, so the
  // entry names the main switch (live QA, 19 Oct 2026).
  const lead = mainSwitch
    ? `Load full chat history automatically is off for every site, so the tracker did not ask ${name} for`
    : `Load full chat history is off for ${name}, so the tracker did not ask ${name} for`;
  const reload = RELOAD_LOADS.has(key) || (key === "chatgpt" && mode !== "after_import");
  const text =
    key === "chatgpt" && mode === "after_import"
      ? `${lead} the earlier messages of this chat. Scroll to the first message to count it.`
      : key === "perplexity"
        ? `${lead} this thread's messages.`
        : key === "notebooklm"
          ? `${lead} this notebook's saved chat, if it has one.${reload && !reloadOffered ? " Reloading the page loads it and does not send a message." : ""}`
          : `${lead} this chat's missing messages.${reload && !reloadOffered ? " Reloading the page loads them and does not send a message." : ""}`;
  return {
    chip: "Full chat history is not loaded automatically",
    text,
    tone: "warn",
    ...(reload && !reloadOffered ? { reload: true } : {}),
    settings: mainSwitch
      ? "Turn on Load full chat history automatically"
      : `Turn on Load full chat history for ${name}`,
  };
}

/**
 * The entry under "Not everything could be counted" for replies stopped before any answer was
 * written (`stoppedWithoutAnswer` of a chat's summary). With no output there is nothing to
 * estimate from, so the bar shows Unknown or leaves them out, and before this entry Details gave
 * no reason (live QA, 19 Oct 2026: a ChatGPT Pro reply stopped while thinking). Null when there
 * are none.
 */
export function stoppedRepliesStatus(count: number, siteName: string): DetailsStatus | null {
  if (!Number.isInteger(count) || count < 1) return null;
  const one = count === 1;
  return {
    chip: one ? "Stopped reply not estimated" : "Stopped replies not estimated",
    text: one
      ? `A reply was stopped before any answer was written, so it has no output tokens to estimate from. The model may already have been thinking, but ${siteName} does not show that work, so the tracker cannot estimate it either. The reply's electricity, carbon and water are left out of the figures, not counted as zero.`
      : `${formatInteger(String(count))} replies were stopped before any answer was written, so they have no output tokens to estimate from. The model may already have been thinking, but ${siteName} does not show that work, so the tracker cannot estimate it either. These replies' electricity, carbon and water are left out of the figures, not counted as zero.`,
    tone: "warn",
  };
}

/**
 * The entry under "Not everything could be counted" while tracking is paused
 * (`TrackingState.paused`). The bar then shows only the chat's earlier figures or what a chat
 * with nothing counted shows, never Processing (live, 21 Oct 2026), so Details names the reason
 * instead of saying that a request sent here will be counted.
 */
export function trackingPausedStatus(): DetailsStatus {
  return {
    chip: "Tracking paused",
    text: "Tracking is paused, so nothing sent in this chat while it is paused is counted and the chat's saved messages are not read. Figures counted before the pause stay. Resume tracking in Settings or the popup to count new requests.",
    tone: "warn",
  };
}

/** Plain words for work in progress, for the line at the bottom of Details. */
const PROGRESS_TEXT: Record<string, string> = {
  Processing: "Reply arriving",
  Updating: "Updating the figures",
  "Loading earlier messages": "Reading earlier messages",
  "Calculating earlier messages": "Calculating earlier messages",
  "Loading conversation totals": "Loading saved totals",
};

/**
 * The progress line at the bottom of Details: what is being read or calculated right now,
 * including the tracker's own read ("Sending request", "Receiving data"). Empty when idle.
 */
export function progressText(progress: readonly string[], ownRead: string | null = null): string {
  const lines = progress.map((label) => PROGRESS_TEXT[label] ?? label);
  if (ownRead && !lines.includes(ownRead)) lines.push(ownRead);
  return [...new Set(lines)].join(" · ");
}

/** The figures, everyday terms and tokens at the top of Details. */
export function overviewNodes(doc: Document, input: DetailsInput): HTMLElement[] {
  const cards = (["energy", "carbon", "water"] as const).map((kind) => figureCard(kind, input[kind], input.scenario));
  const tiles = el(
    doc,
    "div",
    { class: "dt-tiles" },
    ...cards.map((c) =>
      el(
        doc,
        "div",
        { class: "dt-tile", "data-kind": c.kind },
        el(doc, "span", { class: "dt-tile-label" }, c.label),
        el(doc, "span", { class: "dt-tile-value" }, c.number, c.unit ? el(doc, "small", {}, ` ${c.unit}`) : null),
      ),
    ),
  );
  const nodes: HTMLElement[] = [tiles];
  const everyday = everydayTerms(input);
  if (everyday.length)
    nodes.push(
      el(
        doc,
        "div",
        { class: "dt-everyday" },
        el(doc, "div", { class: "dt-row-head" }, el(doc, "span", { class: "dt-label" }, "In everyday terms"), el(doc, "span", { class: "dt-soft" }, `at ${scenarioName(input.scenario)}`)),
        el(
          doc,
          "div",
          { class: "dt-ev" },
          ...everyday.map((e) => {
            // The unit is set smaller, like the figure tiles above, so "1.5 glasses" fits a quarter
            // of the panel instead of running past its card.
            const space = e.value.indexOf(" ");
            const value = space < 0 ? e.value : e.value.slice(0, space);
            const unit = space < 0 ? null : el(doc, "small", {}, e.value.slice(space));
            return el(doc, "div", { class: "dt-ev-card" }, el(doc, "span", { class: "dt-ev-value" }, el(doc, "span", { class: "dt-ev-icon", "data-kind": e.kind }, icon(doc, e.icon)), el(doc, "b", {}, value, unit)), el(doc, "span", { class: "dt-soft" }, e.text));
          }),
        ),
      ),
    );
  nodes.push(
    el(
      doc,
      "div",
      { class: "dt-box" },
      el(doc, "b", { class: "dt-box-title" }, "Tokens"),
      el(doc, "div", { class: "dt-stats dt-stats-4" }, ...tokenFigures(input).map((t) => el(doc, "span", {}, el(doc, "b", {}, t.value), el(doc, "span", { class: "dt-soft" }, t.text)))),
    ),
  );
  return nodes;
}

/**
 * A closed-by-default section with a summary line (canvas disclosure). `open` and `onToggle` let
 * the content script keep a section open while live figures re-render the panel.
 */
export function disclosure(doc: Document, options: { id: string; title: string; summary: string; extra?: Node | null; open: boolean; onToggle: (open: boolean) => void; tone?: "warn" }) {
  const bodyId = `ai-footprint-${options.id}`;
  const button = el(
    doc,
    "button",
    { type: "button", class: "dt-disc", "aria-expanded": String(options.open), "aria-controls": bodyId },
    el(doc, "span", { class: "dt-disc-text" }, el(doc, "span", { class: "dt-disc-title" }, el(doc, "b", {}, options.title), options.extra ?? null), el(doc, "span", { class: "dt-soft dt-disc-summary" }, options.summary)),
    el(doc, "span", { class: "dt-chev" }, icon(doc, "chevron", 16)),
  );
  const body = el(doc, "div", { class: "dt-disc-body", id: bodyId });
  body.hidden = !options.open;
  button.addEventListener("click", () => {
    const open = button.getAttribute("aria-expanded") !== "true";
    button.setAttribute("aria-expanded", String(open));
    body.hidden = !open;
    options.onToggle(open);
  });
  const box = el(doc, "section", { class: "dt-box dt-section", "data-section": options.id, ...(options.tone ? { "data-tone": options.tone } : {}) }, button, body);
  return { box, body, summary: button.querySelector<HTMLElement>(".dt-disc-summary")! };
}

/** The header of "Not everything could be counted": what was left out, named by its chips. */
export function notCountedHeading(statuses: readonly DetailsStatus[]) {
  return {
    title: statuses.some((s) => s.tone === "warn") ? "Not everything could be counted" : "Some figures are not ready yet",
    summary: [...new Set(statuses.map((s) => s.chip))].join(" · "),
  };
}

/**
 * The open body of "Not everything could be counted": each status with why, then what was
 * counted, which is the figure text the bar shows.
 */
export function notCountedNodes(doc: Document, statuses: readonly DetailsStatus[], counted: string): Node[] {
  return [
    el(doc, "ul", { class: "dt-notcounted" }, ...statuses.map((s) => el(doc, "li", {}, el(doc, "b", {}, s.chip), el(doc, "span", {}, s.text)))),
    counted ? el(doc, "p", { class: "dt-soft" }, `Counted: ${counted}`) : null,
  ].filter((node): node is HTMLElement => node !== null);
}

/**
 * The organization sync state of this chat, for a small icon at the bottom of Details (owner,
 * 13 Oct 2026: nothing about sync on the bar). Null in personal mode.
 */
export type SyncState = "synced" | "syncing" | "waiting" | "offline" | "paused" | "held";
export function detailsSyncState(input: {
  mode: string | null | undefined;
  /** The organization server could not be reached. */
  offline: boolean;
  /** Updates of this browser are still waiting to upload. */
  pending: boolean;
  /** The server answered with a current copy of this chat. */
  current: boolean;
  /** The organization paused sharing (suspended, or its deletion is scheduled). */
  paused?: boolean;
  /** Sharing waits for the person to agree, in Settings, to what the server's switches change. */
  held?: boolean;
}): SyncState | null {
  if (input.mode !== "company") return null;
  if (input.paused) return "paused";
  if (input.held) return "held";
  if (input.offline) return "offline";
  if (input.pending) return "syncing";
  return input.current ? "synced" : "waiting";
}
const SYNC_TEXT: Record<SyncState, { label: string; title: string; icon: string }> = {
  synced: { label: "Synced", title: "Synced with your organization.", icon: "cloudCheck" },
  syncing: { label: "Syncing", title: "Sending this browser's updates to your organization in the background.", icon: "sync" },
  waiting: { label: "Waiting to sync", title: "Your organization's server has no current copy of this chat yet. This browser's figures are shown.", icon: "clock" },
  offline: { label: "Offline", title: "The organization server cannot be reached. Updates are sent when the connection returns.", icon: "cloudOff" },
  paused: { label: "Sharing paused", title: "Your organization paused sharing. This browser keeps its records and sends them when sharing resumes.", icon: "clock" },
  held: { label: "Sharing on hold", title: "Your organization's server now collects or shows more than you agreed to. Nothing new is shared until you review it and agree in the dashboard's Settings.", icon: "clock" },
};
export function syncNodes(doc: Document, state: SyncState): HTMLElement {
  const text = SYNC_TEXT[state];
  const node = el(doc, "span", { class: "dt-sync", "data-sync": state, role: "img", title: text.title, "aria-label": `Organization sync: ${text.title}` }, icon(doc, text.icon, 14), el(doc, "span", { "aria-hidden": "true" }, text.label));
  return node;
}

/** How long Details waits for the chat comparison before it says the chats could not be read. */
export const COMPARISON_TIMEOUT_MS = 10_000;

/**
 * Asks for the chat comparison and checks the reply. Null when the request fails, the reply is
 * not a comparison, no reply arrives within the timeout or `signal` aborts (the page stopped), so
 * Details never shows "Comparing with your other chats" for good.
 */
export async function requestComparison(send: () => Promise<unknown>, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<ChatComparison | null> {
  if (options.signal?.aborted) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop: (() => void) | undefined;
  const ended = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), options.timeoutMs ?? COMPARISON_TIMEOUT_MS);
    stop = () => resolve(null);
    options.signal?.addEventListener("abort", stop, { once: true });
  });
  try {
    return await Promise.race([send().then(readComparison, () => null), ended]);
  } finally {
    clearTimeout(timer);
    if (stop) options.signal?.removeEventListener("abort", stop);
  }
}

/** The open body of "Compared with your chats". */
export function comparisonNodes(doc: Document, comparison: ComparisonState): Node[] {
  if (comparison.state !== "ready") return [el(doc, "p", { class: "dt-soft" }, comparison.state === "loading" ? "Reading your chats of the last 30 days on this device." : "Your other chats could not be read just now. Open Details again to retry.")];
  const r = comparison.result;
  if (!r.chats) return [el(doc, "p", { class: "dt-soft" }, "No chats with an electricity figure in the last 30 days.")];
  const peak = Math.max(1, ...r.bins);
  const label = r.smallerShare === null ? "Your chats by size." : `Your chats by size. This chat is bigger than ${percent(r.smallerShare)} of them.`;
  const histogram = el(
    doc,
    "div",
    { class: "dt-hist-wrap" },
    el(doc, "span", { class: "dt-hist", role: "img", "aria-label": label }, ...r.bins.map((count, i) => el(doc, "i", { style: `height:${count ? Math.max(3, Math.round((count / peak) * 26)) : 2}px`, ...(i === r.thisBin ? { "data-this": "true" } : {}) }))),
    el(doc, "span", { class: "dt-soft dt-hist-axis" }, el(doc, "span", {}, "smaller chats"), el(doc, "span", {}, "larger chats")),
  );
  const average = r.averageWh === null ? null : metricParts(String(r.averageWh / 1000), "kWh");
  const stats = [
    r.smallerShare === null ? null : { value: percent(r.smallerShare), text: "of your chats are smaller" },
    average ? { value: `${average.number} ${average.unit}`, text: "your average chat" } : null,
    r.todayShare === null ? null : { value: percent(r.todayShare), text: "of your use today" },
  ].filter((s): s is { value: string; text: string } => s !== null);
  return [histogram, el(doc, "div", { class: "dt-stats dt-stats-3" }, ...stats.map((s) => el(doc, "span", {}, el(doc, "b", {}, s.value), el(doc, "span", { class: "dt-soft" }, s.text))))];
}

/** The parts checklist and its legend for "What was counted". */
export function countedNodes(doc: Document, parts: readonly CountedPart[], siteName: string): Node[] {
  return [
    el(doc, "ul", { class: "dt-parts" }, ...parts.map((p) => el(doc, "li", {}, dot(doc, p.mark), el(doc, "span", {}, p.label), el(doc, "span", { class: "dt-soft" }, p.state)))),
    el(
      doc,
      "div",
      { class: "dt-legend dt-soft" },
      el(doc, "span", {}, dot(doc, "full", true), "counted"),
      el(doc, "span", {}, dot(doc, "half", true), "in part"),
      el(doc, "span", {}, dot(doc, "empty", true), "the tool does not show it"),
    ),
    el(doc, "p", { class: "dt-soft" }, `Parts a tool hides are left out, so the real figure may be higher. This is normal for ${siteName} and is not an error.`),
  ];
}

export function countedDots(doc: Document, parts: readonly CountedPart[]) {
  return el(doc, "span", { class: "dt-dots", "aria-hidden": "true" }, ...parts.map((p) => dot(doc, p.mark, true)));
}

export function estimatedNodes(doc: Document, input: DetailsInput): Node[] {
  return [el(doc, "dl", { class: "dt-kv" }, ...estimatedRows(input).flatMap(([k, v]) => [el(doc, "dt", {}, k), el(doc, "dd", {}, v)]))];
}

/** Overlay styles, scoped under .panel so the bar keeps its look (owner rule, 7 Oct 2026). */
export const DETAILS_STYLES = `
.panel{--dt-bg:#ffffff;--dt-ink:#13241a;--dt-soft:#4a5a4e;--dt-line:#e6ebe1;--dt-chip:#f1f3ec;--dt-link:#2e6b3f;--dt-tE:#fff6db;--dt-tEk:#8a5a00;--dt-tC:#f1efea;--dt-tCk:#5b564c;--dt-tW:#e7f1fa;--dt-tWk:#1d69ae;--dt-track:#eef1e8;--dt-cE:#e0a82e;--dt-cC:#9e978a;--dt-cW:#3f8fd6;--dt-in:#c9d8c2;--dt-out:#2e6b3f;--dt-mk:#2e6b3f;--dt-mke:#9db394;--dt-local:#eef6e4;--dt-local-line:#8fbf7a;--dt-local-ink:#1d4a2a;--dt-local-text:#24362a;
  width:min(460px,calc(100vw - 28px));padding:0;border:0;border-radius:20px;background:var(--dt-bg);color:var(--dt-ink);box-shadow:0 24px 64px rgba(15,42,28,.22),0 0 0 1px rgba(15,42,28,.08);font-size:14px;line-height:1.4;overscroll-behavior:contain}
:host([data-aft-theme="dark"]) .panel{--dt-bg:#16261c;--dt-ink:#e8efe6;--dt-soft:#a9b8ad;--dt-line:rgba(232,239,230,.12);--dt-chip:rgba(232,239,230,.08);--dt-link:#b9e27c;--dt-tE:rgba(243,197,75,.14);--dt-tEk:#f3c54b;--dt-tC:rgba(184,178,163,.16);--dt-tCk:#d8d2c4;--dt-tW:rgba(63,143,214,.18);--dt-tWk:#8ec2f0;--dt-track:rgba(232,239,230,.10);--dt-cE:#f3c54b;--dt-cC:#d8d2c4;--dt-cW:#7db9ec;--dt-in:rgba(185,226,124,.28);--dt-out:#b9e27c;--dt-mk:#b9e27c;--dt-mke:rgba(232,239,230,.38);--dt-local:rgba(185,226,124,.1);--dt-local-line:rgba(185,226,124,.55);--dt-local-ink:#d6f2a8;--dt-local-text:#dde8df;box-shadow:0 24px 64px rgba(0,0,0,.55),0 0 0 1px rgba(232,239,230,.14)}
.panel a{color:var(--dt-link)}
.panel button{border:0;background:var(--dt-chip);color:inherit;border-radius:10px}
.panel button:focus-visible{outline:2px solid var(--dt-link);outline-offset:2px}
.panel .dt-i{fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:none}
.dt-head{position:sticky;top:0;z-index:1;display:flex;align-items:flex-start;gap:10px;padding:18px 16px 12px 20px;background:var(--dt-bg);border-radius:20px 20px 0 0}
.dt-head>div{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.panel .dt-head h2{margin:0;font-size:20px;line-height:1.2;font-weight:700}
.dt-sub{margin:0;font-size:13px;color:var(--dt-soft)}
.panel .dt-head .close{float:none;width:36px;height:36px;min-height:36px;padding:0;display:grid;place-items:center;flex:none}
.panel [data-body]{padding:0 16px 4px}
.dt-soft{color:var(--dt-soft)}
.dt-status{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin-bottom:10px;font-size:13px;line-height:18px}
.dt-chip{display:inline-flex;align-items:center;min-height:24px;padding:2px 9px;border-radius:99px;font-size:12px;font-weight:700;background:#e7eff8;color:#1d4f80}
.dt-status[data-tone=warn] .dt-chip{background:#fff1cc;color:#6e4700}
:host([data-aft-theme="dark"]) .dt-chip{background:rgba(63,143,214,.22);color:#a9cdf2}
:host([data-aft-theme="dark"]) .dt-status[data-tone=warn] .dt-chip{background:rgba(233,185,73,.2);color:#f3c54b}
.dt-status-text{flex:1 1 240px;min-width:0}
.panel .dt-reload{min-height:32px;padding:4px 12px;font-weight:600;background:var(--dt-chip)}
.dt-section[data-tone=warn]{padding:0;overflow:hidden;border-color:var(--aft-warning,#fff0c4)}
.panel .dt-section[data-tone=warn]>.dt-disc{padding:8px 12px 8px 14px;background:var(--aft-warning,#fff0c4);color:var(--aft-warning-ink,#53380b)}
.dt-section[data-tone=warn] .dt-disc-summary{color:inherit}
.dt-section[data-tone=warn] .dt-chev{background:transparent}
.dt-section[data-tone=warn]>.dt-disc-body{margin:0;padding:10px 14px 12px;border-top:0}
.dt-notcounted{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.dt-notcounted li{display:flex;flex-direction:column;gap:2px}
.dt-progress{margin:8px 0 0;font-size:12px;color:var(--aft-ink);opacity:.8}
.dt-progress:empty{display:none}
.dt-sync-row{display:flex;justify-content:flex-end;padding:8px 16px 0}
.dt-sync-row:empty{display:none}
.dt-sync{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--dt-soft)}
.dt-problems:empty{display:none}
.dt-problems{margin-top:10px;padding:10px 12px;border-radius:14px;border:1px solid var(--dt-line);font-size:13px}
.dt-problems h3{margin:4px 0 4px;font-size:14px}
.dt-tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.dt-tile{display:flex;flex-direction:column;align-items:center;gap:3px;padding:10px 12px;border-radius:14px;min-width:0;text-align:center}
.dt-tile[data-kind=energy]{background:var(--dt-tE);--c:var(--dt-cE);--k:var(--dt-tEk)}
.dt-tile[data-kind=carbon]{background:var(--dt-tC);--c:var(--dt-cC);--k:var(--dt-tCk)}
.dt-tile[data-kind=water]{background:var(--dt-tW);--c:var(--dt-cW);--k:var(--dt-tWk)}
.dt-tile-label{font-size:13px;font-weight:600;color:var(--k)}
.dt-tile-value{font-size:20px;font-weight:700;line-height:1.25;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.dt-tile-value small{display:block;font-size:13px;font-weight:600;line-height:1.3;white-space:nowrap}
.dt-everyday{margin-top:12px;display:flex;flex-direction:column;gap:6px}
.dt-row-head{display:flex;justify-content:space-between;align-items:baseline;padding:0 4px;font-size:12px}
.dt-label{font-size:13px;font-weight:600;color:var(--dt-soft)}
.dt-ev{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
.dt-ev-card{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:10px 6px;border-radius:12px;background:var(--dt-chip);min-width:0;font-size:12px;line-height:15px;text-align:center}
.dt-ev-card>.dt-soft{text-wrap:balance}
.dt-ev-value{display:flex;align-items:flex-start;justify-content:center;gap:5px;max-width:100%}
.dt-ev-value b{font-size:15px;line-height:20px;font-variant-numeric:tabular-nums;min-width:0;overflow-wrap:anywhere}
.dt-ev-value b small{font-size:12px;font-weight:600}
.dt-ev-icon{display:inline-flex;align-items:center;height:20px;flex:none}
.dt-ev-icon[data-kind=energy]{color:var(--dt-tEk)}.dt-ev-icon[data-kind=carbon]{color:var(--dt-tCk)}.dt-ev-icon[data-kind=water]{color:var(--dt-tWk)}
.dt-box{margin-top:10px;padding:12px 14px;border-radius:14px;border:1px solid var(--dt-line);display:flex;flex-direction:column;gap:9px}
.dt-box-title{font-size:14px}
.dt-stats{display:grid;gap:8px}
.dt-stats-4{grid-template-columns:repeat(4,minmax(0,1fr))}
.dt-stats-3{grid-template-columns:repeat(3,minmax(0,1fr))}
.dt-stats>span{display:flex;flex-direction:column;align-items:center;gap:1px;min-width:0;font-size:12px;line-height:15px;text-align:center}
.dt-stats b{font-size:17px;line-height:22px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.dt-section{gap:6px}
.dt-wi{display:grid;grid-template-columns:96px minmax(0,1fr) auto;gap:10px;align-items:center;font-size:13px}
.dt-wi-bar{display:block;height:10px;border-radius:5px;background:var(--dt-track);overflow:hidden}
.dt-wi-bar i{display:block;height:10px;border-radius:5px;background:var(--dt-cE)}
.dt-wi-bar i[data-lighter]{opacity:.55}
.dt-wi-value{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.dt-wi-note{font-size:12px;line-height:16px}
.panel .dt-disc{display:flex;align-items:center;gap:10px;width:100%;min-height:44px;padding:0;border:0;background:transparent;text-align:left;font-size:14px}
.dt-disc-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.dt-disc-title{display:flex;align-items:center;gap:10px}
.dt-disc-summary{font-size:12px;line-height:16px}
.dt-chev{width:32px;height:32px;border-radius:10px;background:var(--dt-chip);display:grid;place-items:center;flex:none}
.dt-chev svg{transition:transform .15s}
.dt-disc[aria-expanded=true] .dt-chev svg{transform:rotate(180deg)}
.dt-disc-body{display:flex;flex-direction:column;gap:9px;margin-top:4px;padding-top:10px;border-top:1px solid var(--dt-line);font-size:13px}
.dt-disc-body[hidden]{display:none}
.dt-hist-wrap{display:flex;flex-direction:column;gap:3px}
.dt-hist{display:flex;align-items:flex-end;gap:4px;height:28px}
.dt-hist i{display:block;flex:1;border-radius:3px;background:var(--dt-in)}
.dt-hist i[data-this]{background:var(--dt-out)}
.dt-hist-axis{display:flex;justify-content:space-between;font-size:12px}
.dt-dots{display:inline-flex;gap:4px}
.dt-dot{width:14px;height:14px;border-radius:7px;box-sizing:border-box;border:2px solid var(--dt-mk);flex:none;display:inline-block}
.dt-dot-sm{width:10px;height:10px;border-radius:5px}
.dt-dot[data-mark=full]{background:var(--dt-mk)}
.dt-dot[data-mark=half]{background:linear-gradient(90deg,var(--dt-mk) 50%,transparent 50%)}
.dt-dot[data-mark=empty]{border-color:var(--dt-mke)}
.dt-parts{list-style:none;margin:0;padding:0}
.dt-parts li{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:10px;align-items:center;padding:7px 0;border-top:1px solid var(--dt-line);line-height:18px}
.dt-parts li:first-child{border-top:0}
.dt-legend{display:flex;flex-wrap:wrap;gap:6px 14px;padding-top:9px;border-top:1px solid var(--dt-line);font-size:12px}
.dt-legend span{display:inline-flex;align-items:center;gap:6px}
.panel .dt-kv{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 12px;margin:0}
.panel .dt-kv dt{color:var(--dt-soft)}
.panel .dt-kv dd{text-align:right;font-variant-numeric:tabular-nums}
.dt-more{margin-top:4px;padding-top:6px;border-top:1px solid var(--dt-line)}
.dt-more h3{font-size:14px;margin:14px 0 4px}
.dt-local{margin:12px 16px 0;padding:10px 12px;border-radius:12px;border:1.5px solid var(--dt-local-line);background:var(--dt-local);color:var(--dt-local-text);font-size:13px;line-height:1.45}
.dt-local b{color:var(--dt-local-ink)}
.dt-local:empty{display:none}
.dt-credit{margin:14px 0 0;padding:12px 16px 14px;border-top:1px solid var(--dt-line);text-align:center;font-size:12px;line-height:17px;color:var(--dt-soft)}
.dt-credit a{font-weight:600;text-decoration:underline;text-underline-offset:2px}
@media (max-width:420px){.dt-tiles{grid-template-columns:1fr}.dt-ev{grid-template-columns:repeat(2,minmax(0,1fr))}.dt-stats-4{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (prefers-reduced-motion:reduce){.dt-chev svg{transition:none}}
`;
