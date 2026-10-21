import { dom } from "./dom-env";
import assert from "node:assert/strict";
import test from "node:test";
import {
  comparisonLine,
  countedParts,
  countedSummary,
  DETAILS_STYLES,
  detailsModels,
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
  assert.equal(ownReadOffStatus("cowork", "after_import").settings, "Turn on Load full chat history for Claude Cowork");
  assert.equal(ownReadOffStatus("cowork", "after_import").reload, true);
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
  for (const key of ["chatgpt", "claude", "cowork", "gemini", "perplexity", "notebooklm"] as const)
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
