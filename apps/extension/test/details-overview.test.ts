import { dom } from "./dom-env";
import assert from "node:assert/strict";
import test from "node:test";
import {
  comparisonLine,
  countedHow,
  replyKinds,
  countedParts,
  countedSummary,
  DETAILS_STYLES,
  detailsModels,
  exactFromStart,
  detailsStatusGroups,
  detailsStatuses,
  detailsSyncState,
  disclosure,
  notCountedHeading,
  notCountedNodes,
  notedModelNames,
  ownReadOffStatus,
  statusNodes,
  overviewNodes,
  syncNodes,
  estimatedRows,
  estimatedSummary,
  everydayTerms,
  figureCard,
  headerLine,
  readComparison,
  requestComparison,
  tokenFigures,
  type DetailsInput,
} from "../lib/details-overview";

const input = (changes: Partial<DetailsInput> = {}): DetailsInput => ({
  surface: "chatgpt",
  siteName: "ChatGPT",
  scenario: "minimum",
  requests: "4",
  requestsApproximate: false,
  tokensIn: "9860",
  tokensOut: "2150",
  energy: { value: "0.013", unit: "kWh", value_kind: "midpoint_sum", scenario_low: "0.00899", scenario_high: "0.0171" },
  carbon: { value: "5", unit: "gCO2e", value_kind: "midpoint_sum", scenario_low: "3.46", scenario_high: "6.55" },
  water: { value: "0.048", unit: "L", value_kind: "midpoint_sum", scenario_low: "0.0292", scenario_high: "0.0683" },
  models: ["chatgpt-gpt-5-6-sol", "chatgpt-gpt-5-6-sol"],
  earlierLoaded: true,
  ...changes,
});

test("a figure shows the chosen scenario and keeps its range for How this was estimated", () => {
  const minimum = figureCard("energy", input().energy, "minimum");
  assert.deepEqual([minimum.number, minimum.unit, minimum.range], ["8.99", "Wh", "8.99 to 17.1 Wh"]);
  assert.equal(figureCard("energy", input().energy, "maximum").number, "17.1");
  // The midpoint is the stored value: half way between the EcoLogits minimum and maximum.
  assert.equal(figureCard("energy", input().energy, "midpoint").number, "13");
  // A single value has no range, an unknown value says so, and mixed scopes never add.
  assert.equal(figureCard("energy", { value: "0.002", unit: "kWh" }, "minimum").range, null);
  assert.equal(figureCard("energy", { value: null, unit: "kWh" }, "minimum").number, "Unknown");
  assert.equal(figureCard("water", { value: null, unit: "L", multiple: true }, "minimum").number, "See below");
});

test("everyday terms use the sourced factors and leave out unknown figures", () => {
  const terms = everydayTerms(input());
  assert.deepEqual(
    terms.map((t) => `${t.value} ${t.text}`),
    ["1.1 hours 8 W LED bulb", "47% phone charge", "20 m driven by car", "2 tbsp of water"],
  );
  assert.deepEqual(everydayTerms(input({ carbon: { value: null, unit: "gCO2e" } })).map((t) => t.icon), ["bulb", "phone", "drop"]);
  assert.deepEqual(everydayTerms(input({ energy: { value: null, unit: "kWh" }, carbon: { value: null, unit: "gCO2e" }, water: { value: null, unit: "L" } })), []);
});

test("tokens give requests, tokens in and out, and approximate words per reply", () => {
  assert.deepEqual(
    tokenFigures(input()).map((t) => t.value),
    ["4", "9,860", "2,150", "≈ 400"],
  );
  assert.deepEqual(
    tokenFigures(input({ requests: null, tokensIn: null, tokensOut: null, requestsApproximate: true })).map((t) => t.value),
    ["Unknown", "Unknown", "Unknown", "Unknown"],
  );
  assert.equal(tokenFigures(input({ requestsApproximate: true }))[0]!.value, "≈ 4");
});

test("how it was estimated names each model once and derives the factors from the shown figures", () => {
  assert.deepEqual(estimatedRows(input()), [
    ["Model", "GPT-5.6 Sol"],
    ["Method", "EcoLogits, Minimum scenario"],
    ["Electricity, minimum to maximum", "8.99 to 17.1 Wh"],
    ["Carbon, minimum to maximum", "3.46 to 6.55 g CO₂e"],
    ["Water, minimum to maximum", "29.2 to 68.3 mL"],
    ["Electricity per 1,000 tokens out", "4.18 Wh"],
    ["Carbon and water per kWh", "385 g CO₂e · 3.25 L"],
  ]);
  assert.equal(estimatedSummary(input()), "GPT-5.6 Sol · EcoLogits · Minimum");
  assert.equal(estimatedSummary(input({ models: [], scenario: "maximum" })), "Model not named · EcoLogits · Maximum");
  assert.deepEqual(estimatedRows(input({ models: ["claude-opus-5-5", "claude-sonnet-5-5"], tokensOut: null }))[0], ["Models", "Claude Opus 5.5, Claude Sonnet 5.5"]);
  // Owner correction of 14 October 2026: a GPT Pro is a family model in Pro reasoning mode.
  assert.deepEqual(estimatedRows(input({ models: ["chatgpt-gpt-6-sol-pro", "chatgpt-gpt-6-pro"] }))[0], [
    "Models",
    "GPT-6 Sol (Pro reasoning), GPT-6 Astra (Pro reasoning)",
  ]);
  assert.equal(estimatedRows(input({ tokensOut: "0" })).length, 6);
  assert.equal(headerLine(input()), "4 requests · GPT-5.6 Sol");
  assert.equal(headerLine(input({ requests: "1", models: [] })), "1 request");
});

test("what was counted marks hidden parts as empty, never as an error, per tool", () => {
  const chatgpt = countedParts("chatgpt", "ChatGPT", true);
  assert.deepEqual(chatgpt.map((p) => p.mark), ["full", "full", "half", "full", "empty"]);
  assert.equal(countedSummary(chatgpt, "ChatGPT"), "Everything ChatGPT shows. ChatGPT hides 1 part.");
  assert.equal(countedParts("claude", "Claude", false)[0]!.mark, "half");
  assert.equal(countedSummary(countedParts("cowork", "Claude", null), "Claude"), "Everything Claude shows is counted.");
  assert.equal(countedSummary(countedParts("perplexity", "Perplexity", true), "Perplexity"), "Everything Perplexity shows. Perplexity hides 2 parts.");
  assert.deepEqual(countedParts("notebooklm", "NotebookLM", null).map((p) => p.mark), ["full", "full", "half", "empty", "empty"]);
  // A notebook's saved chat (14 Oct 2026) can be loaded only in part, like other chats.
  assert.deepEqual(countedParts("notebooklm", "NotebookLM", false)[0], { label: "Your messages and the earlier chat", mark: "half", state: "earlier chat not loaded" });
});

// Live pass of 23 Nov 2026: Claude's own counts include hidden thinking, so a chat of exact replies
// must not say its reasoning is a summary. A chat of text counts keeps the old line, and a mixed
// chat says both.
test("what was counted says for each Claude chat whether its reasoning is exact", () => {
  const reasoning = (replies?: { exact: number; text: number } | null) =>
    countedParts("claude", "Claude", true, replies).find((part) => part.label === "Reasoning")!;
  const summaryOnly = { label: "Reasoning", mark: "half", state: "summary only" };
  assert.deepEqual(reasoning(), summaryOnly);
  assert.deepEqual(reasoning(null), summaryOnly);
  assert.deepEqual(reasoning({ exact: 0, text: 3 }), summaryOnly);
  assert.deepEqual(reasoning({ exact: 3, text: 0 }), { label: "Reasoning", mark: "full", state: "from Claude's own counts" });
  assert.deepEqual(reasoning({ exact: 3, text: 1 }), { label: "Reasoning", mark: "half", state: "exact in 3 replies, summary only in 1 reply" });
  assert.deepEqual(reasoning({ exact: 1, text: 2 }), { label: "Reasoning", mark: "half", state: "exact in 1 reply, summary only in 2 replies" });
  // Other sites never take this reading.
  assert.deepEqual(countedParts("chatgpt", "ChatGPT", true, { exact: 3, text: 0 }), countedParts("chatgpt", "ChatGPT", true));
});

// Same pattern for side calls: Claude's own counts include them (modelUsage covers side calls).
test("what was counted says for each Claude chat whether side calls are counted", () => {
  const sideCalls = (replies?: { exact: number; text: number } | null) =>
    countedParts("claude", "Claude", true, replies).find((part) => /^Side calls/.test(part.label))!;
  const hidden = { label: "Side calls: titles, safety checks", mark: "empty", state: "not shown by Claude" };
  assert.deepEqual(sideCalls(), hidden);
  assert.deepEqual(sideCalls(null), hidden);
  assert.deepEqual(sideCalls({ exact: 0, text: 3 }), hidden);
  assert.deepEqual(sideCalls({ exact: 3, text: 0 }), { label: "Side calls: titles, suggestions", mark: "full", state: "inside Claude's own counts" });
  assert.deepEqual(sideCalls({ exact: 3, text: 1 }), { label: "Side calls: titles, suggestions", mark: "half", state: "inside Claude's counts in 3 replies, not counted in 1 reply" });
  assert.deepEqual(sideCalls({ exact: 1, text: 2 }), { label: "Side calls: titles, suggestions", mark: "half", state: "inside Claude's counts in 1 reply, not counted in 2 replies" });
  // A chat of exact replies hides nothing, so the summary says everything is counted.
  assert.equal(countedSummary(countedParts("claude", "Claude", true, { exact: 3, text: 0 }), "Claude"), "Everything Claude shows is counted.");
  assert.equal(countedSummary(countedParts("claude", "Claude", true, { exact: 0, text: 3 }), "Claude"), "Everything Claude shows. Claude hides 1 part.");
  assert.deepEqual(countedParts("chatgpt", "ChatGPT", true, { exact: 3, text: 0 }), countedParts("chatgpt", "ChatGPT", true));
});

test("the start of a Claude chat counts as read when its exact replies add up to Claude's own total", () => {
  const kinds = (exactReplies: number, textReplies: number, outputCounted: number | null) => ({ exactReplies, textReplies, outputCounted });
  assert.equal(exactFromStart(kinds(3, 0, 4200), 4200), true);
  assert.equal(exactFromStart(kinds(3, 0, 4000), 4200), false, "work Claude ran is not counted here");
  assert.equal(exactFromStart(kinds(3, 0, 4200), null), false, "no total to compare with");
  assert.equal(exactFromStart(kinds(3, 1, 4200), 4200), false, "a text reply may come from a part that was not read");
  assert.equal(exactFromStart(kinds(0, 0, null), 0), false);
});

test("Details opens with the bar's state in plain words, problems first, and nothing when up to date", () => {
  assert.deepEqual(detailsStatuses(""), []);
  assert.deepEqual(detailsStatuses("Recorded"), []);
  // Sync state is a Details icon, never a status (owner, 13 Oct 2026), and progress is the line
  // at the bottom of Details, never a status (owner, 14 Oct 2026).
  assert.deepEqual(
    detailsStatuses("Processing · Updating · Loading earlier messages · Calculating earlier messages · Loading conversation totals · Waiting to sync"),
    [],
  );
  const problem = detailsStatuses("Tracking problem (reload page) · Updating");
  assert.deepEqual(problem.map((s) => s.chip), ["Reply not counted"]);
  assert.equal(problem[0]!.reload, true);
  assert.equal(problem[0]!.tone, "warn");
  // A tracking problem the person cannot fix offers no reload.
  assert.equal(detailsStatuses("Tracking problem")[0]!.reload, undefined);
  assert.deepEqual(detailsStatuses("History not loaded (reload page)").map((s) => s.chip), ["Earlier messages not loaded"]);
  assert.deepEqual(detailsStatuses("Reload required (reload page)").map((s) => s.chip), ["Reload the page"]);
});

test("a tracking problem offers the fix its bracketed action names", () => {
  const only = (status: string) => {
    const shown = detailsStatuses(status);
    assert.equal(shown.length, 1, status);
    return shown[0]!;
  };
  const reload = only("Tracking problem (reload page)");
  assert.equal(reload.reload, true);
  assert.equal(reload.retry, undefined);
  const access = only("Tracking problem (allow access)");
  assert.equal(access.reload, undefined);
  assert.match(access.text, /Allow the extension on this site/);
  const storage = only("Tracking problem (free browser storage)");
  assert.equal(storage.reload, undefined);
  assert.match(storage.text, /Free some browser storage/);
  const retry = only("Tracking problem (retry)");
  assert.equal(retry.retry, true);
  assert.equal(retry.reload, undefined);
});

test("a chat whose start could not be read is listed with what could not be counted", () => {
  const groups = detailsStatusGroups("", "Partially loaded");
  assert.deepEqual(groups.bar, []);
  assert.deepEqual(groups.notCounted.map((s) => [s.chip, s.tone, s.reload, s.retry]), [["Some earlier messages missing", "warn", undefined, undefined]]);
  assert.equal(notCountedHeading(groups.notCounted).title, "Not everything could be counted");
});

test("a comparison that does not answer in time counts as failed", async () => {
  const never = () => new Promise<unknown>(() => {});
  assert.equal(await requestComparison(never, { timeoutMs: 20 }), null);
  assert.equal(await requestComparison(() => Promise.reject(new Error("closed")), { timeoutMs: 20 }), null);
  assert.equal(await requestComparison(async () => ({ code: "payload_rejected" }), { timeoutMs: 20 }), null);
  // A page that stops does not wait for the timeout.
  const stopped = new AbortController();
  const waiting = requestComparison(never, { signal: stopped.signal });
  stopped.abort();
  assert.equal(await waiting, null);
});

test("statuses the bar leaves out are listed under Not everything could be counted, with what was counted", () => {
  const groups = detailsStatusGroups("History not loaded (reload page)", "Matching incomplete · Earlier activity unavailable", "Req 4 · In/Out tokens - ≈ 10/20");
  assert.deepEqual(groups.bar.map((s) => s.chip), ["Earlier messages not loaded"]);
  assert.deepEqual(groups.notCounted.map((s) => s.chip), ["Earlier messages not estimated", "Not all records linked"]);
  assert.deepEqual(notCountedHeading(groups.notCounted), {
    title: "Not everything could be counted",
    summary: "Earlier messages not estimated · Not all records linked",
  });
  // Only activity that is not ready yet is not called a failure.
  assert.equal(notCountedHeading([{ chip: "Reading", text: "Reading.", tone: "info" }]).title, "Some figures are not ready yet");
  // A status the bar already shows is not listed twice.
  assert.deepEqual(detailsStatusGroups("History not loaded (reload page)", "", "AI usage · Earlier messages not counted").notCounted, []);
  const doc = dom.window.document;
  const nodes = notCountedNodes(doc, groups.notCounted, "Req 4 · In/Out tokens - ≈ 10/20");
  const text = nodes.map((node) => node.textContent).join(" ");
  assert.match(text, /Not all records linked.*could not be linked/);
  assert.match(text, /Counted: Req 4/);
  assert.equal(notCountedNodes(doc, groups.notCounted, "").length, 1);
});

test("the warning section uses the warning palette and stays collapsible", () => {
  const doc = dom.window.document;
  const made = disclosure(doc, { id: "not-counted", title: "Not everything could be counted", summary: "Not all records linked", tone: "warn", open: false, onToggle: () => {} });
  assert.equal(made.box.getAttribute("data-tone"), "warn");
  assert.equal(made.body.hidden, true);
  assert.match(DETAILS_STYLES, /\.dt-section\[data-tone=warn\]>\.dt-disc\{[^}]*background:var\(--aft-warning/);
});

test("the sync icon says the organization sync state, and nothing in personal mode", () => {
  const state = (changes: Partial<Parameters<typeof detailsSyncState>[0]> = {}) =>
    detailsSyncState({ mode: "company", offline: false, pending: false, current: true, ...changes });
  assert.equal(state({ mode: "personal" }), null);
  assert.equal(state(), "synced");
  assert.equal(state({ pending: true }), "syncing");
  assert.equal(state({ current: false }), "waiting");
  assert.equal(state({ offline: true, pending: true }), "offline");
  // An organization that paused sharing is neither offline nor syncing.
  assert.equal(state({ paused: true, offline: true, pending: true }), "paused");
  assert.equal(state({ mode: "personal", paused: true }), null);
  // Sharing held for the person's agreement to the server's switches (19 Oct 2026): a quiet
  // icon in Details that names where to agree, never a bar status.
  assert.equal(state({ held: true, pending: true }), "held");
  assert.equal(state({ paused: true, held: true }), "paused");
  const held = syncNodes(dom.window.document, "held");
  assert.equal(held.textContent, "Sharing on hold");
  assert.match(held.getAttribute("title")!, /Nothing new is shared until you review it and agree in the dashboard's Settings\./);
  const paused = syncNodes(dom.window.document, "paused");
  assert.equal(paused.textContent, "Sharing paused");
  assert.match(paused.getAttribute("title")!, /Your organization paused sharing/);
  const node = syncNodes(dom.window.document, "syncing");
  assert.equal(node.getAttribute("role"), "img");
  assert.match(node.getAttribute("aria-label")!, /^Organization sync: /);
  assert.match(node.getAttribute("title")!, /in the background/);
  assert.equal(node.textContent, "Syncing");
  assert.ok(node.querySelector("svg"));
});

test("Details names the models of imported history and can add a note after a name", () => {
  // Live, 13 Oct 2026: chats imported from history said "Model not named".
  const models = detailsModels([], ["claude-opus-5-5"]);
  assert.equal(estimatedSummary(input({ models })), "Claude Opus 5.5 · EcoLogits · Minimum");
  assert.deepEqual(detailsModels(["claude-sonnet-5-5", "claude-opus-5-5"], ["claude-opus-5-5"]), ["claude-opus-5-5", "claude-sonnet-5-5"]);
  assert.deepEqual(detailsModels(["claude-opus-5-5"], undefined), ["claude-opus-5-5"]);
  // The hook for family stand-ins: a note per model id, shown in How this was estimated only.
  const noted = input({ models: ["claude-unlisted"], modelNotes: { "claude-unlisted": "estimated as Claude Opus 5.5" } });
  assert.deepEqual(estimatedRows(noted)[0], ["Model", "Claude model not yet listed (estimated as Claude Opus 5.5)"]);
  assert.equal(headerLine(noted), "4 requests · Claude model not yet listed");
  assert.deepEqual(notedModelNames(["claude-opus-5-5", "claude-opus-5-5"]), ["Claude Opus 5.5"]);
});

test("the comparison reply is validated before anything is shown", () => {
  const good = { chats: 12, thisChat: 9, smallerShare: 0.72, averageWh: 5.62, todayShare: 0.24, bins: [1, 2, 0], thisBin: 1, scenario: "minimum" };
  assert.deepEqual(readComparison(good), { chats: 12, thisChat: 9, smallerShare: 0.72, averageWh: 5.62, todayShare: 0.24, bins: [1, 2, 0], thisBin: 1, smallerModel: null });
  for (const bad of [null, "x", { ...good, chats: 1.5 }, { ...good, smallerShare: 1.2 }, { ...good, todayShare: -1 }, { ...good, bins: [1, -1] }, { ...good, thisBin: 3 }, { ...good, averageWh: Number.NaN }, { code: "policy_unavailable", error: "x" }])
    assert.equal(readComparison(bad), null, JSON.stringify(bad));
  assert.equal(comparisonLine({ state: "ready", result: readComparison(good)! }), "Bigger than 72% of your chats · last 30 days");
  // Live QA of 19 Oct 2026: the ends read "Bigger than 0% / 100% of your chats".
  const share = (smallerShare: number) => comparisonLine({ state: "ready", result: { ...readComparison(good)!, smallerShare } });
  assert.equal(share(0), "None of your other chats was smaller · last 30 days");
  assert.equal(share(1), "Bigger than all your other chats · last 30 days");
  assert.equal(share(0.996), "Bigger than 99% of your chats · last 30 days");
  assert.equal(share(0.004), "Bigger than 1% of your chats · last 30 days");
  assert.equal(comparisonLine({ state: "ready", result: { ...readComparison(good)!, smallerShare: null } }), "Too few chats in the last 30 days to compare");
  assert.equal(comparisonLine({ state: "ready", result: { ...readComparison(good)!, chats: 0, smallerShare: null } }), "No other chats in the last 30 days");
  assert.equal(comparisonLine({ state: "loading" }), "Comparing with your other chats");
});

test("everyday values set their unit smaller and the figure tiles centre their content (owner request of 15 October 2026)", () => {
  // "1.5 glasses" in bold at full size ran past its card in a quarter of the panel.
  const nodes = overviewNodes(dom.window.document, input({ water: { value: "0.381", unit: "L" } }));
  const values = [...nodes[1].querySelectorAll(".dt-ev-value b")];
  const water = values.at(-1)!;
  assert.equal(water.textContent, "1.5 glasses");
  assert.equal(water.querySelector("small")?.textContent, " glasses");
  // A value without a unit (phone charges) has no small part.
  assert.equal(values[1].querySelector("small"), null);
  assert.match(DETAILS_STYLES, /\.dt-tile\{[^}]*align-items:center[^}]*text-align:center/);
  // The unit sits on its own line under the number in every tile, so "g CO2e" never splits.
  assert.match(DETAILS_STYLES, /\.dt-tile-value small\{[^}]*display:block[^}]*white-space:nowrap/);
  assert.doesNotMatch(DETAILS_STYLES, /\.dt-ev-value b\{[^}]*white-space:nowrap/);
  // Each everyday card centres its value and caption, like the figure tiles above it.
  assert.match(DETAILS_STYLES, /\.dt-ev-card\{[^}]*align-items:center[^}]*justify-content:center[^}]*text-align:center/);
});

// Owner decision of 17 Oct 2026: a read "Load full chat history" held is named in Details with what
// works instead and a button to turn it on; Perplexity never offers a reload.
test("Load full chat history off: Details names the switch, the fix that works on each site and offers to turn it on", () => {
  const claude = ownReadOffStatus("claude", "missing");
  assert.equal(claude.chip, "Full chat history is not loaded automatically");
  assert.equal(claude.settings, "Turn on Load full chat history for Claude");
  assert.equal(claude.reload, true);
  assert.match(claude.text, /did not ask Claude for this chat's missing messages\. Reloading the page loads them/);
  // Another entry already offers Reload page: no second button, no second sentence.
  const shared = ownReadOffStatus("gemini", "missing", true);
  assert.equal(shared.reload, undefined);
  assert.doesNotMatch(shared.text, /Reload/);
  // One Claude switch covers chats and Cowork sessions (22 Nov 2026), so there is one name.
  assert.equal(ownReadOffStatus("claude", "after_import").settings, "Turn on Load full chat history for Claude");
  assert.equal(ownReadOffStatus("claude", "after_import").reload, true);
  assert.doesNotMatch(ownReadOffStatus("claude", "missing").text, /Cowork/);
  assert.match(ownReadOffStatus("notebooklm", "after_import").text, /this notebook's saved chat, if it has one/);
  assert.equal(ownReadOffStatus("notebooklm", "after_import").reload, true);
  // A long ChatGPT chat loads its earlier messages when the person scrolls up.
  const chatgpt = ownReadOffStatus("chatgpt", "after_import");
  assert.match(chatgpt.text, /Scroll to the first message to count it\.$/);
  assert.equal(chatgpt.reload, undefined);
  assert.equal(ownReadOffStatus("chatgpt", "missing").reload, true, "a chat the page never read loads on reload");
  // Perplexity never sends a thread's messages on a page load.
  const perplexity = ownReadOffStatus("perplexity", "missing");
  assert.equal(perplexity.reload, undefined);
  assert.doesNotMatch(perplexity.text, /[Rr]eload/);
  assert.equal(perplexity.settings, "Turn on Load full chat history for Perplexity");
  for (const key of ["chatgpt", "claude", "gemini", "perplexity", "notebooklm"] as const)
    assert.doesNotMatch(ownReadOffStatus(key, "missing").text, /\u2014/);
  // Live QA of 19 Oct 2026: with the main switch off the site's own switch is already on and
  // cannot be changed, so the entry names the main switch.
  const main = ownReadOffStatus("chatgpt", "missing", false, true);
  assert.match(main.text, /^Load full chat history automatically is off for every site, so the tracker did not ask ChatGPT for/);
  assert.doesNotMatch(main.text, /off for ChatGPT/);
  assert.equal(main.settings, "Turn on Load full chat history automatically");

  const doc = dom.window.document;
  let opened = 0;
  let reloaded = 0;
  const [row] = statusNodes(doc, [claude], () => reloaded++, undefined, () => opened++);
  const buttons = [...row!.querySelectorAll("button")];
  assert.deepEqual(buttons.map((b) => b.textContent), ["Reload page", "Turn on Load full chat history for Claude"]);
  buttons[1]!.click();
  assert.equal(opened, 1);
  assert.equal(reloaded, 0);
  // Without a way to open Settings the row keeps its words and offers no dead button.
  assert.equal(statusNodes(doc, [perplexity], () => {})[0]!.querySelectorAll("button").length, 0);
});

// Since the live QA of 19 Oct 2026 Perplexity sends a thread's messages on a full page load,
// so the entry no longer sends the person to the Library.
test("Perplexity's missing thread history says a reload usually counts it", () => {
  const [status] = detailsStatuses("Thread not loaded");
  assert.equal(status!.chip, "Earlier messages not loaded");
  assert.equal(status!.reload, undefined);
  assert.match(status!.text, /reloading the page usually counts them/);
  assert.doesNotMatch(status!.text, /Library/);
  // It is not something the person fixes with a button, so it is listed with what was not counted.
  assert.deepEqual(detailsStatusGroups("", "Thread not loaded").notCounted.map((s) => s.chip), ["Earlier messages not loaded"]);
});

// ChatGPT used without an account never saves a chat (live, 20 Oct 2026): reloading opens an
// empty chat, so the entry offers no button and never matches the reloadable history entry.
test("a signed-out ChatGPT chat's unsaved earlier messages are listed without a reload", () => {
  const statuses = detailsStatuses("Earlier messages not saved");
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0]!.chip, "Earlier messages not counted");
  assert.equal(statuses[0]!.reload, undefined);
  assert.equal(statuses[0]!.retry, undefined);
  assert.match(statuses[0]!.text, /ChatGPT does not save chats made without an account/);
  assert.deepEqual(
    detailsStatusGroups("", "Earlier messages not saved").notCounted.map((s) => s.chip),
    ["Earlier messages not counted"],
  );
});

// "How this was counted" on Claude (22 Nov 2026): one drop-down that says where the figures come
// from, for each kind of chat, and never shows a failed read as an exact count.
const CLAUDE_OWN = { output: 4200, input: 310, cacheRead: 60_000_000, cacheWrite: 1_500 };
const counted = (over: Partial<Parameters<typeof countedHow>[0]> = {}) =>
  countedHow({ exactReplies: 0, textReplies: 0, claude: null, outputCounted: null, unlinked: false, switchOff: false, laterWork: false, ...over });

test("how this was counted: an exact chat says Claude's own counts are used and where In comes from", () => {
  const exact = counted({ exactReplies: 3 })!;
  assert.equal(exact.summary, "Exact, from Claude");
  assert.deepEqual(exact.lines, [
    "Output and reasoning are Claude's own token counts for this chat, side calls included. Input is your prompts and tool results, counted on your computer.",
  ]);
});

test("how this was counted: a chat counted from text says so and what is missing", () => {
  const text = counted({ textReplies: 2 })!;
  assert.equal(text.summary, "Estimated from text");
  assert.deepEqual(text.lines, [
    "Claude gives no token counts for this chat. The tracker counted the text Claude shows. Hidden reasoning is not included.",
  ]);
  // A chat that could not be matched to its session keeps the text figures and says why.
  assert.deepEqual(counted({ textReplies: 2, unlinked: true })!.lines.at(-1), "Claude's own counts for this chat could not be matched to it.");
  assert.equal(counted({ exactReplies: 2, unlinked: true })!.lines.some((line) => /matched/.test(line)), false, "an exact chat was matched");
});

test("how this was counted: a mixed chat names how many replies are exact and how many are estimated", () => {
  const mixed = counted({ exactReplies: 4, textReplies: 2 })!;
  assert.equal(mixed.summary, "Part exact, part estimated");
  assert.deepEqual(mixed.lines, [
    "4 replies use Claude's own token counts. 2 replies were counted from their text, because Claude has no counts for them.",
  ]);
  assert.match(counted({ exactReplies: 1, textReplies: 1 })!.lines[0]!, /^1 reply uses .* 1 reply was counted from its text, because Claude has no counts for it/);
});

test("how this was counted: Claude's higher total shows the two numbers, and the cause only when it is known", () => {
  const higher = counted({ exactReplies: 3, claude: CLAUDE_OWN, outputCounted: 4000 })!;
  assert.ok(higher.lines.includes("Claude's own total for this chat is 4,200 output tokens. 4,000 are counted here."));
  assert.equal(higher.lines.some((line) => /after the last reply/.test(line)), false, "no cause is claimed without proof");
  const later = counted({ exactReplies: 3, claude: CLAUDE_OWN, outputCounted: 4000, laterWork: true })!;
  assert.ok(later.lines.includes("Claude's own total for this chat is 4,200 output tokens. 4,000 are counted here. The rest ran after the last reply and is counted with the next one."));
  // Equal totals, or a total that is lower, say nothing.
  for (const outputCounted of [4200, 5000, null])
    assert.equal(counted({ exactReplies: 3, claude: CLAUDE_OWN, outputCounted })!.lines.some((line) => /own total/.test(line)), false);
});

test("how this was counted: Claude's own input totals are numbers, and In stays prompts and tool results", () => {
  const all = counted({ exactReplies: 3, claude: CLAUDE_OWN, outputCounted: 4200 })!;
  assert.ok(all.lines.includes("Claude reports 310 new input tokens, 1,500 tokens written to its cache and 60,000,000 tokens read from it. In shows your prompts and tool results only."));
  const some = counted({ exactReplies: 1, claude: { output: 5, input: 7, cacheRead: null, cacheWrite: null }, outputCounted: 5 })!;
  assert.ok(some.lines.includes("Claude reports 7 new input tokens. In shows your prompts and tool results only."));
  const none = counted({ exactReplies: 1, claude: { output: 5, input: null, cacheRead: null, cacheWrite: null }, outputCounted: 5 })!;
  assert.equal(none.lines.some((line) => /new input/.test(line)), false);
});

// Owner decision of 23 Nov 2026: for replies with exact input, In is everything Claude processed.
const EXACT_INPUT = { new: 310, cache_write: 1_500, cache_read: 60_000_000, replies: 3 };
const CACHE_NOTE = "The cache tokens are context Claude read again, so In is larger than what you typed.";

test("how this was counted: exact input says In is everything Claude processed, with the three numbers", () => {
  const exact = counted({ exactReplies: 3, exactInput: EXACT_INPUT })!;
  assert.equal(exact.summary, "Exact, from Claude");
  assert.deepEqual(exact.lines, [
    "Output and reasoning are Claude's own token counts for this chat, side calls included.",
    `In is everything Claude processed for this chat: 310 new input tokens, 1,500 tokens written to its cache and 60,000,000 tokens read from it. ${CACHE_NOTE}`,
  ]);
  for (const line of exact.lines) assert.doesNotMatch(line, /prompts and tool results only|counted on your computer/);
  // One reply is a reply, not "1 replies", and the company is never said to see these numbers.
  const one = counted({ exactReplies: 1, exactInput: { ...EXACT_INPUT, replies: 1 } })!;
  assert.doesNotMatch(one.lines.join(" "), /replies|company/);
});

test("how this was counted: a mixed chat says which replies have exact input and how the others are counted", () => {
  const mixed = counted({ exactReplies: 3, textReplies: 2, exactInput: EXACT_INPUT })!;
  assert.equal(mixed.summary, "Part exact, part estimated");
  assert.deepEqual(mixed.lines, [
    "3 replies use Claude's own token counts. 2 replies were counted from their text, because Claude has no counts for them.",
    `In is everything Claude processed for 3 replies: 310 new input tokens, 1,500 tokens written to its cache and 60,000,000 tokens read from it. ${CACHE_NOTE} The other 2 replies are counted from the text of your prompts and tool results, on your computer.`,
  ]);
  // Exact replies whose result had no counters are counted from text as well.
  const gap = counted({ exactReplies: 4, exactInput: EXACT_INPUT })!;
  assert.match(gap.lines.at(-1)!, /for 3 replies: .* The other reply is counted from the text of your prompts and tool results, on your computer\.$/);
});

test("how this was counted: without exact input the wording stays, and the session totals keep their line", () => {
  assert.deepEqual(counted({ exactReplies: 3 })!.lines, [
    "Output and reasoning are Claude's own token counts for this chat, side calls included. Input is your prompts and tool results, counted on your computer.",
  ]);
  const own = counted({ exactReplies: 3, claude: CLAUDE_OWN, outputCounted: 4200 })!;
  assert.ok(own.lines.some((line) => /In shows your prompts and tool results only\.$/.test(line)));
  // With exact input the three numbers come from the saved replies, so the session's own
  // input numbers are not listed a second time and the sentence that is no longer true is gone.
  const both = counted({ exactReplies: 3, claude: CLAUDE_OWN, outputCounted: 4200, exactInput: EXACT_INPUT })!;
  assert.equal(both.lines.some((line) => /prompts and tool results only|Claude reports/.test(line)), false);
  assert.equal(both.lines.filter((line) => /new input tokens/.test(line)).length, 1);
  for (const line of both.lines) assert.doesNotMatch(line, /—|–/);
});

test("how this was counted: with Load full chat history off it shows the total the page loaded", () => {
  const off = counted({ textReplies: 1, claude: CLAUDE_OWN, outputCounted: 90, switchOff: true })!;
  assert.equal(off.summary, "Estimated from text");
  assert.ok(off.lines.includes("Claude reports 4,200 output tokens for this chat."));
  assert.equal(off.lines.some((line) => /counted here/.test(line)), false, "no rows are made from the running total");
  assert.equal(counted({ textReplies: 1, switchOff: true })!.lines.some((line) => /reports/.test(line)), false, "nothing to show without a loaded total");
});

test("how this was counted: nothing counted yet gives no drop-down, and no line uses a dash", () => {
  assert.equal(counted(), null);
  const every = counted({ exactReplies: 2, textReplies: 1, claude: CLAUDE_OWN, outputCounted: 10, laterWork: true, unlinked: true })!;
  for (const line of [every.summary, ...every.lines]) assert.doesNotMatch(line, /\u2014|\u2013/);
});

test("how this was counted: replies are told apart by the evidence of the saved response totals", () => {
  const item = (role: string, part: string, evidence: string, known: string, value: string | null) =>
    ({ role, part, evidence, value, known_message_count: known });
  assert.deepEqual(
    replyKinds([
      item("response", "total", "provider_reported", "3", "4000"),
      item("response", "total", "heuristic_estimate", "2", "120"),
      item("prompt", "total", "heuristic_estimate", "5", "300"),
      item("response", "tool_output", "provider_reported", "9", "77"),
      item("response", "total", "unknown", "4", null),
    ]),
    { exactReplies: 3, textReplies: 2, outputCounted: 4000 },
    "only response totals count, unknown evidence is neither",
  );
  assert.deepEqual(replyKinds([item("response", "total", "heuristic_estimate", "1", "9")]), { exactReplies: 0, textReplies: 1, outputCounted: null });
  assert.deepEqual(replyKinds([]), { exactReplies: 0, textReplies: 0, outputCounted: null });
});

test("with Load full chat history off, a Claude chat whose session events are read says its own counts are not read and offers no reload", () => {
  // The page never loads a session's events itself, so Reload page would not help (core package 2).
  const status = ownReadOffStatus("claude", "after_turn");
  assert.equal(status.reload, undefined);
  assert.doesNotMatch(status.text, /[Rr]eload/);
  assert.match(status.text, /^Load full chat history is off for Claude, so the tracker did not ask Claude for this chat's own token counts, so they are not read while the switch is off\.$/);
  assert.equal(status.settings, "Turn on Load full chat history for Claude");
  const main = ownReadOffStatus("claude", "after_turn", false, true);
  assert.match(main.text, /^Load full chat history automatically is off for every site, so the tracker did not ask Claude for this chat's own token counts/);
  assert.doesNotMatch(status.text, /\u2014/);
  // Other modes of Claude, and other sites, keep their entry.
  assert.equal(ownReadOffStatus("claude", "missing").reload, true);
  assert.equal(ownReadOffStatus("claude", "after_import").reload, true);
});
