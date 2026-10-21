// Behaviour of the redesigned dashboard (canvas Dash*, Dialog* and MenusSheet boards), driven through the
// real dashboard client and response validators with fixture replies, so every button and dialog runs end to end.
import assert from "node:assert/strict";
import test, { after, afterEach, before } from "node:test";
import { dom } from "./dom-env";
import React from "react";
import { act, cleanup, configure, fireEvent, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { dashboard as dashboardFixture, fakeTransport, serverHistory, type Scenario } from "./ui-fixtures";
import type { Transport } from "../lib/dashboard/client";
import { ORG_RECHECK_MS } from "../lib/dash/OrgOverview";
import { serverHistoryView, validatedSummary, withSplitHistoryViews } from "../lib/server-summary";

const NOW = new Date("2026-10-12T10:30:00.000Z");
const realNow = Date.now;
dom.reconfigure({ url: "chrome-extension://aift/dashboard.html" });
// The first render loads every module; under a full parallel suite it can take longer than the default second.
configure({ asyncUtilTimeout: 5000 });
const storage: Record<string, unknown> = {};
const opened: string[] = [];
const copied: string[] = [];
/** Origins the dashboard asked the browser permission for. */
const permitted: string[] = [];

before(async () => {
  Date.now = () => NOW.getTime();
  Object.defineProperty(dom.window.navigator, "clipboard", { value: { writeText: async (text: string) => void copied.push(text) }, configurable: true });
  Object.assign(globalThis, {
    chrome: {
      runtime: { id: "aift", getURL: (path: string) => `chrome-extension://aift${path}`, getManifest: () => ({ version: "0.1.0" }) },
      storage: {
        local: {
          get: async (key: string) => (key in storage ? { [key]: storage[key] } : {}),
          set: async (items: Record<string, unknown>) => void Object.assign(storage, items),
        },
      },
      tabs: { create: async ({ url }: { url: string }) => void opened.push(url), query: async () => [], reload: async () => undefined },
    },
  });
  await import("../lib/dash/Dashboard");
});
after(() => {
  Date.now = realNow;
});
afterEach(() => {
  session = null;
  cleanup();
  document.body.innerHTML = "";
  for (const key of Object.keys(storage)) delete storage[key];
  opened.length = 0;
  copied.length = 0;
  permitted.length = 0;
  dom.window.location.hash = "";
});

const view = () => within(document.body);
let session: ReturnType<typeof userEvent.setup> | null = null;
/** One user-event session per test: separate sessions lose track of a controlled input after it is cleared. */
const user = () => (session ??= userEvent.setup({ document: dom.window.document }));

async function show(scenario: Scenario = {}, options: { transport?: Transport; hash?: string; prefs?: Record<string, unknown>; permission?: boolean } = {}) {
  Object.assign(storage, options.prefs ?? {});
  dom.window.location.hash = options.hash ?? "";
  const { default: Dashboard } = await import("../lib/dash/Dashboard");
  const calls = (scenario.calls ??= []);
  render(<Dashboard transport={options.transport ?? fakeTransport(scenario)} requestPermission={async (origin) => (permitted.push(origin), options.permission ?? true)} clock={() => NOW} />);
  return calls;
}
const hash = async (value: string) => {
  await act(async () => {
    dom.window.location.hash = value;
    dom.window.dispatchEvent(new dom.window.HashChangeEvent("hashchange"));
  });
};

test("overview shows the period, figure, tiles, tools and the month so far", async () => {
  const calls = await show();
  await view().findByRole("heading", { name: "Where it comes from" });
  assert.ok(view().getByRole("heading", { name: "Your AI footprint" }));
  assert.match(view().getByText(/Recorded in this browser/).textContent!, /13 September to 12 October/);
  assert.ok(view().getByRole("region", { name: "Electricity · last 30 days" }));
  assert.ok(view().getByRole("heading", { name: "October so far" }));
  assert.equal(view().getByRole("button", { name: /^Electricity/ }).getAttribute("aria-pressed"), "true");
  const tools = view().getByRole("table");
  assert.equal(within(tools).getAllByRole("row").length, 5);
  const requests = calls.filter((c) => c.action === "usage-breakdown").map((c) => c.payload);
  assert.ok(requests.some((r) => r!.start === "2026-09-12T22:00:00.000Z" && r!.bucket === "day"), "the 30 days start at Berlin midnight");
  assert.ok(view().getByText(/Estimates, not meter readings/));
});

test("tiles switch the hero figure, chart and tool split, and are remembered", async () => {
  await show();
  await view().findByRole("heading", { name: "Where it comes from" });
  await user().click(view().getByRole("button", { name: /^Requests/ }));
  await view().findByRole("region", { name: "Requests · last 30 days" });
  assert.ok(view().getByText("Share of requests"));
  assert.equal((storage["ui:dashboard"] as { metric: string }).metric, "requests");
  await user().click(view().getByRole("button", { name: /^Water/ }));
  await view().findByRole("region", { name: "Water · last 30 days" });
});

test("hovering or focusing a day bar shows its figure and requests", async () => {
  await show();
  await view().findByRole("heading", { name: "Where it comes from" });
  const bars = view().getByRole("list", { name: "Each day in the period" });
  const last = within(bars).getAllByRole("button").at(-1)!;
  assert.match(last.getAttribute("aria-label")!, /12 Oct: .* request/);
  await act(async () => last.focus());
  assert.match(view().getAllByRole("tooltip").map((t) => t.textContent).join("|"), /12 Oct · .* · \d+ requests/);
});

test("the period menu offers every period and a custom range", async () => {
  const calls = await show();
  await view().findByRole("heading", { name: "Where it comes from" });
  await user().click(view().getByRole("button", { name: /Last 30 days/ }));
  const menu = view().getByRole("dialog", { name: "Choose a period" });
  for (const name of ["Today", "Last 7 days", "Last 30 days", "This month", "Last month", "All time", "Custom dates"]) assert.ok(within(menu).getByRole("button", { name: new RegExp(`^${name}`) }));
  await user().click(within(menu).getByRole("button", { name: /^Last 7 days/ }));
  await view().findByRole("region", { name: "Electricity · last 7 days" });
  assert.equal((storage["ui:dashboard"] as { period: string }).period, "7d");

  await user().click(view().getByRole("button", { name: /Last 7 days/ }));
  await user().click(view().getByRole("button", { name: /^Custom dates/ }));
  await user().click(view().getByRole("button", { name: "Previous month" }));
  await user().click(view().getByRole("button", { name: "1 September" }));
  await user().click(view().getByRole("button", { name: "30 September" }));
  await view().findByRole("region", { name: "Electricity · 1 to 30 September" });
  assert.equal((storage["ui:dashboard"] as { period: string }).period, "custom:2026-09-01:2026-09-30");
  const custom = calls.filter((c) => c.action === "usage-breakdown").map((c) => c.payload!.start);
  assert.ok(custom.includes("2026-08-31T22:00:00.000Z"));
});

test("the menu closes on Escape and future days cannot be chosen", async () => {
  await show();
  await view().findByRole("heading", { name: "Where it comes from" });
  await user().click(view().getByRole("button", { name: /Last 30 days/ }));
  await user().click(view().getByRole("button", { name: /^Custom dates/ }));
  assert.equal(view().getByRole("button", { name: "13 October" }).hasAttribute("disabled"), true);
  assert.equal(view().getByRole("button", { name: "Next month" }).hasAttribute("disabled"), true);
  await user().keyboard("{Escape}");
  assert.equal(view().queryByRole("dialog", { name: "Choose a period" }), null);
});

test("navigation reaches every page and Methodology opens its page", async () => {
  await show();
  await view().findByRole("heading", { name: "Where it comes from" });
  assert.equal(view().getByRole("link", { name: "Methodology" }).getAttribute("href"), "methodology.html");
  await hash("models");
  await view().findByRole("heading", { name: "Tools and models you used" });
  assert.equal(view().getByRole("link", { name: "Tools and models" }).getAttribute("aria-current"), "page");
  await hash("recap");
  await view().findByRole("heading", { name: "Your September in AI" });
  await hash("settings");
  await view().findByRole("heading", { name: "Scenario" });
  await hash("tracking");
  await view().findByRole("heading", { name: "Open problems" });
  await hash("licences");
  await view().findByRole("heading", { name: "Components" });
  await user().click(view().getByRole("button", { name: /Back to Settings/ }));
  await view().findByRole("heading", { name: "Scenario" });
});

// Live QA of 19 Oct 2026: every model read "Not estimated" because the page looked for the record
// selection on the figure groups, which never carry it; the breakdown now names it per model.
test("tools and models lists every model with how it is estimated", async () => {
  await show({}, { hash: "models" });
  const table = within(await view().findByRole("region", { name: "All models" }));
  const kind = (model: string) => within(table.getByRole("rowheader", { name: model }).closest("tr") as HTMLElement).getAllByRole("cell").at(-1)!.textContent;
  for (const model of ["Claude Opus 5.5", "Claude Sonnet 5.5", "GPT-5.6 Sol", "Gemini 3.8 Flash"]) assert.equal(kind(model), "Own record");
  assert.equal(kind("o3 (Pro reasoning)"), "Similar model: GPT-6 Astra");
  // Perplexity Best and NotebookLM name no model, so their family's benchmark stands in.
  assert.equal(kind("Perplexity Best"), "Family estimate");
  assert.equal(kind("NotebookLM model"), "Family estimate");
  assert.equal(table.queryByText("Not estimated"), null);
  // The four models with their own record answered 310 of the 396 requests.
  const exact = view().getByText(/of requests are estimated with the exact model/).closest("div")!;
  assert.equal(within(exact as HTMLElement).getByText(/%$/).textContent, "78%");
});

test("the monthly recap opens a day, moves between months and stops at this month", async () => {
  const calls = await show({}, { hash: "recap" });
  await view().findByRole("heading", { name: "Your September in AI" });
  await user().click(view().getByRole("button", { name: /^Tuesday 1 September/ }));
  await view().findByRole("complementary", { name: "Tuesday 1 September" });
  await waitFor(() => assert.ok(calls.some((c) => c.action === "usage-breakdown" && c.payload!.start === "2026-08-31T22:00:00.000Z" && c.payload!.end === "2026-09-01T22:00:00.000Z")));
  await user().click(view().getByRole("button", { name: "Carbon" }));
  assert.match(view().getByRole("button", { name: /^Tuesday 1 September/ }).getAttribute("aria-label")!, /CO₂e/);
  await user().click(view().getByRole("button", { name: "October 2026" }));
  await view().findByRole("heading", { name: "Your October in AI" });
  assert.equal(view().getByRole("button", { name: "November 2026" }).hasAttribute("disabled"), true);
  assert.equal(view().getByRole("button", { name: /^Tuesday 13 October/ }).hasAttribute("disabled"), true, "days still to come cannot be opened");
  await user().click(view().getByRole("button", { name: "September 2026" }));
  await view().findByRole("heading", { name: "Your September in AI" });
});

test("changing the scenario asks first, and Cancel keeps the current one", async () => {
  const calls = await show({}, { hash: "settings" });
  await view().findByRole("heading", { name: "Scenario" });
  await user().click(view().getByRole("radio", { name: /Minimum/ }));
  assert.equal(view().queryByRole("dialog"), null, "choosing the current scenario opens nothing");
  await user().click(view().getByRole("radio", { name: /Midpoint/ }));
  let dialog = view().getByRole("dialog", { name: "Show Midpoint figures everywhere?" });
  await user().click(within(dialog).getByRole("button", { name: "Cancel" }));
  assert.equal(view().queryByRole("dialog"), null);
  assert.equal(calls.some((c) => c.action === "settings"), false);
  await user().click(view().getByRole("radio", { name: /Maximum/ }));
  dialog = view().getByRole("dialog", { name: "Show Maximum figures everywhere?" });
  await user().click(within(dialog).getByRole("button", { name: "Show Maximum" }));
  await view().findByText("Maximum now applies everywhere");
  const change = calls.find((c) => c.action === "settings")!.payload as { changes: Record<string, unknown> };
  assert.equal(change.changes.displayScenario, "maximum");
  assert.equal(change.changes.paused, false, "other settings are sent unchanged");
});

test("pausing asks first; resuming does not", async () => {
  const calls = await show({}, { hash: "settings" });
  await view().findByRole("heading", { name: "Scenario" });
  await user().click(view().getByRole("switch", { name: "Tracking is on" }));
  const dialog = view().getByRole("dialog", { name: "Pause tracking?" });
  assert.equal(document.activeElement?.textContent, "Keep tracking", "the safe choice has focus");
  await user().keyboard("{Escape}");
  assert.equal(view().queryByRole("dialog"), null);
  await user().click(view().getByRole("switch", { name: "Tracking is on" }));
  await user().click(within(view().getByRole("dialog")).getByRole("button", { name: /Pause tracking/ }));
  await view().findByRole("switch", { name: "Tracking is paused" });
  assert.equal((calls.find((c) => c.action === "settings")!.payload as { changes: { paused: boolean } }).changes.paused, true);
  assert.equal(typeof (storage["ui:paused"] as { at?: number }).at, "number");
  assert.ok(view().getByText("Tracking is paused", { selector: ".dh-status-title" }));
  await user().click(view().getByRole("switch", { name: "Tracking is paused" }));
  await view().findByRole("switch", { name: "Tracking is on" });
  assert.equal(view().queryByRole("dialog"), null);
  assert.deepEqual(storage["ui:paused"], {});
  void dialog;
});

test("erasing needs the acknowledgement and reports the erased count", async () => {
  const calls = await show({}, { hash: "settings" });
  await view().findByRole("heading", { name: "Your records" });
  await user().click(view().getByRole("button", { name: /Erase all records/ }));
  const dialog = view().getByRole("dialog", { name: "Erase all records in this browser?" });
  const erase = within(dialog).getByRole("button", { name: "Erase records" });
  assert.equal(erase.hasAttribute("disabled"), true);
  await user().click(within(dialog).getByRole("checkbox", { name: "I understand this erases everything" }));
  await user().click(erase);
  await view().findByText("939 records erased. This browser starts fresh.");
  assert.ok(calls.some((c) => c.action === "erase-local"));
});

/** The long-chat tip card's controls, found with plain selectors (16 Oct 2026). */
function tipControls() {
  const field = (id: string) => document.querySelector<HTMLInputElement>(`#${id}`)!;
  const save = (id: string) => field(id).closest("form")!.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const toggle = (name: "requests" | "tokens") =>
    document.querySelector<HTMLButtonElement>(`[role="switch"][aria-label^="Long-chat tip by ${name} is "]`)!;
  return { field, save, toggle };
}
const lastChanges = (calls: { action: string; payload?: Record<string, unknown> }[]) =>
  (calls.filter((c) => c.action === "settings").at(-1)!.payload as { changes: Record<string, unknown> }).changes;

test("the long-chat tip has a Requests and a Tokens switch: requests on at 50, tokens off with its limit locked", async () => {
  const calls = await show({}, { hash: "settings" });
  await view().findByRole("heading", { name: "Long-chat tip" });
  const tip = tipControls();
  assert.equal(tip.toggle("requests").getAttribute("aria-checked"), "true");
  assert.equal(tip.toggle("requests").getAttribute("aria-label"), "Long-chat tip by requests is on");
  assert.equal(tip.toggle("tokens").getAttribute("aria-checked"), "false");
  assert.equal(tip.toggle("tokens").getAttribute("aria-label"), "Long-chat tip by tokens is off");
  assert.equal(tip.field("st-request-limit").value, "50");
  assert.equal(tip.field("st-request-limit").disabled, false);
  assert.equal(tip.field("st-budget").disabled, true, "the token limit cannot be edited while Tokens is off");
  assert.equal(tip.save("st-budget").disabled, true);
  assert.equal(tip.save("st-request-limit").disabled, true, "nothing changed yet");
  assert.ok(document.querySelector("#st-budget-help")!.textContent!.includes("Leave empty to use each model's own context size."));

  const input = tip.field("st-request-limit");
  for (const wrong of ["0", "10001", "many", ""]) {
    await user().clear(input);
    if (wrong) await user().type(input, wrong);
    await user().click(tip.save("st-request-limit"));
    assert.match(document.querySelector("#st-request-limit-error")!.textContent!, /whole number of requests between 1 and 10,000/);
    assert.equal(input.getAttribute("aria-invalid"), "true");
  }
  assert.equal(calls.some((c) => c.action === "settings"), false, "a wrong limit is not saved");
  await user().clear(input);
  await user().type(input, "1,200");
  await user().click(tip.save("st-request-limit"));
  await view().findByText(/^The tip now shows at [\d,.\s]+ requests$/);
  assert.equal(lastChanges(calls).contextTipRequestLimit, 1200);

  await user().click(tip.toggle("tokens"));
  await view().findByText("The long-chat tip now shows by tokens");
  assert.equal(lastChanges(calls).contextTipTokens, true);
  await user().click(tipControls().toggle("requests"));
  await view().findByText("The long-chat tip no longer shows by requests");
  assert.equal(lastChanges(calls).contextTipRequests, false);
});

test("with Tokens on, the custom token limit saves and a wrong limit is explained", async () => {
  const calls = await show({ dashboard: { settings: { contextTipTokens: true, contextTipRequests: true, contextTipRequestLimit: 80 } } }, { hash: "settings" });
  await view().findByRole("heading", { name: "Long-chat tip" });
  const tip = tipControls();
  assert.equal(tip.toggle("tokens").getAttribute("aria-checked"), "true");
  assert.equal(tip.field("st-request-limit").value, "80");
  const input = tip.field("st-budget");
  assert.equal(input.disabled, false);
  await user().type(input, "500");
  await user().click(tip.save("st-budget"));
  assert.match(document.querySelector("#st-budget-error")!.textContent!, /between 1,000 and 10,000,000/);
  assert.equal(calls.some((c) => c.action === "settings"), false);
  await user().clear(input);
  await user().type(input, "100,000");
  await user().click(tip.save("st-budget"));
  await view().findByText(/^Custom limit set to [\d,.\s]+ tokens$/);
  assert.equal(lastChanges(calls).budget, 100_000);
});

test("a long-chat tip turned off before 16 Oct 2026 shows both switches off with their limits locked", async () => {
  await show({ dashboard: { settings: { contextTip: false } } }, { hash: "settings" });
  await view().findByRole("heading", { name: "Long-chat tip" });
  const tip = tipControls();
  assert.equal(tip.toggle("requests").getAttribute("aria-checked"), "false");
  assert.equal(tip.toggle("tokens").getAttribute("aria-checked"), "false");
  assert.equal(tip.field("st-request-limit").disabled, true);
  assert.equal(tip.field("st-budget").disabled, true);
});

// "Load full chat history automatically" (owner decision of 17 Oct 2026): one main switch and a
// checkbox per site, all on by default.
const olderChats = () => ({
  main: document.querySelector<HTMLButtonElement>('[role="switch"][aria-label^="Load full chat history is "]')!,
  sites: view().getByRole("group", { name: "Sites" }),
});

test("Load full chat history has a main switch and a checkbox per site, all on by default", async () => {
  const calls = await show({}, { hash: "settings" });
  await view().findByRole("heading", { name: "Load full chat history automatically" });
  view().getByText(
    "If a site does not load all of a chat you open, the tracker asks that site once for the missing messages, read-only, with your sign-in there. When off, the tracker counts what the site loads on its own, and some older messages may not be counted.",
  );
  const { main, sites } = olderChats();
  assert.equal(main.getAttribute("aria-checked"), "true");
  assert.equal(main.getAttribute("aria-label"), "Load full chat history is on");
  const boxes = within(sites).getAllByRole("checkbox") as HTMLInputElement[];
  assert.deepEqual(
    boxes.map((box) => [box.closest("label")!.textContent, box.checked]),
    [["ChatGPT", true], ["Claude", true], ["Claude Cowork", true], ["Gemini", true], ["Perplexity", true], ["NotebookLM", true]],
  );
  await user().click(within(sites).getByRole("checkbox", { name: "Perplexity" }));
  await view().findByText("Full chat history no longer loads automatically on Perplexity");
  assert.deepEqual(lastChanges(calls).ownReadSites, {
    chatgpt: true,
    claude: true,
    cowork: true,
    gemini: true,
    perplexity: false,
    notebooklm: true,
  });
  await user().click(olderChats().main);
  await view().findByText("Full chat history no longer loads automatically");
  assert.equal(lastChanges(calls).ownRead, false);
});

test("with Load full chat history off each site keeps its choice in view but cannot be changed", async () => {
  await show({ dashboard: { settings: { ownRead: false, ownReadSites: { gemini: false } } } }, { hash: "settings" });
  await view().findByRole("heading", { name: "Load full chat history automatically" });
  const { main, sites } = olderChats();
  assert.equal(main.getAttribute("aria-checked"), "false");
  assert.equal(main.getAttribute("aria-label"), "Load full chat history is off");
  const box = (name: string) => within(sites).getByRole("checkbox", { name }) as HTMLInputElement;
  assert.equal(box("Gemini").checked, false);
  assert.equal(box("ChatGPT").checked, true, "a site saved before the change reads as on");
  assert.equal(box("ChatGPT").matches(":disabled"), true);
});

test("the time zone list saves the chosen zone", async () => {
  const calls = await show({}, { hash: "settings" });
  await view().findByRole("heading", { name: "Time zone" });
  const select = view().getByRole("combobox", { name: "Time zone" }) as HTMLSelectElement;
  assert.equal(select.value, "Europe/Berlin");
  await user().selectOptions(select, "America/New_York");
  await view().findByText("Days now follow America/New_York");
  assert.equal((calls.find((c) => c.action === "settings")!.payload as { changes: { timezone: string } }).changes.timezone, "America/New_York");
});

/** Replaces a field's text the way a person would, so React sees every keystroke. */
async function enter(input: HTMLElement, value: string) {
  await user().clear(input);
  await user().type(input, value);
}

test("connecting takes the work email, the browser permission and the code, then names the organization to confirm", async () => {
  const calls = await show({}, { hash: "settings" });
  await view().findByRole("heading", { name: "Organization" });
  await user().click(view().getByRole("button", { name: /^Connect$/ }));
  let dialog = view().getByRole("dialog", { name: "Connect your organization" });
  assert.equal(within(dialog).queryByRole("textbox", { name: "Server address" }), null, "own server is a secondary option");
  const email = within(dialog).getByRole("textbox", { name: "Work email" });
  await enter(email, "sam");
  await user().click(within(dialog).getByRole("button", { name: "Continue" }));
  assert.match(within(dialog).getByRole("alert").textContent!, /Enter your work email/);
  await enter(email, "sam@example-consulting.com");
  await user().click(within(dialog).getByRole("button", { name: "Continue" }));
  dialog = view().getByRole("dialog", { name: "Allow the extension to reach the server" });
  assert.match(dialog.textContent!, /data on aifootprinttracker\.com/);
  await user().click(within(dialog).getByRole("button", { name: "Continue" }));
  dialog = await view().findByRole("dialog", { name: "Enter the code from your email" });
  assert.deepEqual(permitted, ["https://aifootprinttracker.com"]);
  assert.deepEqual(calls.find((c) => c.action === "connect")!.payload, { origin: "https://aifootprinttracker.com", email: "sam@example-consulting.com" });
  assert.match(dialog.textContent!, /on its way to sam@example-consulting\.com\. It expires/);
  // No mail goes to a domain without an organization (server S1), so the dialog promises nothing more.
  assert.match(dialog.textContent!, /If your organization uses AI Footprint Tracker/);
  const code = within(dialog).getByRole("textbox", { name: "Code" });
  await enter(code, "12345");
  await user().click(within(dialog).getByRole("button", { name: "Continue" }));
  assert.match(within(dialog).getByRole("alert").textContent!, /6-digit code/);
  assert.equal(calls.some((c) => c.action === "verify-code"), false);
  await enter(code, "000000");
  await user().click(within(dialog).getByRole("button", { name: "Continue" }));
  await within(dialog).findByText(/code is wrong or has expired/);
  assert.equal(within(dialog).getByRole("alert").textContent!.includes("Technical detail"), false);
  await enter(code, "123456");
  await user().click(within(dialog).getByRole("button", { name: "Continue" }));
  dialog = await view().findByRole("dialog", { name: "Connect to Example Consulting?" });
  // The organization agreement (canvas ConnectNew, 17 October 2026): what is never shared comes
  // first and stands out, and Connect waits for the checkbox.
  assert.match(dialog.textContent!, /Your organization sees how its people use AI as a whole\. Here is exactly what connecting changes\./);
  const never = within(dialog).getByRole("region", { name: "Never shared" });
  assert.match(never.textContent!, /Your prompts, the AI's answers, files and chat titles\. Your connection address is not collected\./);
  assert.ok(never.classList.contains("lg-local"));
  const order = ["Never shared", "Shared with your organization", "What your administrators see", "Stays in this browser"].map((text) => dialog.textContent!.indexOf(text));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "in the order of the design");
  assert.ok(order.every((at) => at >= 0));
  assert.match(dialog.textContent!, /Chats you open after connecting are counted from their start, earlier messages included\./);
  assert.match(dialog.textContent!, /Never your usage next to your name\./);
  assert.equal(within(dialog).getByRole("link", { name: "Privacy policy" }).getAttribute("href"), "https://aifootprinttracker.com/privacy-policy");
  const connect = within(dialog).getByRole("button", { name: "Connect" }) as HTMLButtonElement;
  assert.equal(connect.disabled, true, "Connect waits for the agreement");
  assert.equal(calls.some((c) => c.action === "confirm-connection"), false, "nothing is shared before Connect");
  await user().click(within(dialog).getByRole("checkbox", { name: "I agree to share this browser's AI use with Example Consulting as described." }));
  assert.equal(connect.disabled, false);
  await user().click(connect);
  await view().findByText("Connected to Example Consulting. The popup and dashboard now show Organization.");
  assert.deepEqual(calls.find((c) => c.action === "confirm-connection")!.payload, { agreed: true, version: "2026-10-18" });
  assert.deepEqual(opened, [], "no approval page opens");
});

test("a server with person analytics on: Connect asks again with the updated text and shares nothing before that agreement", async () => {
  const calls = await show({ dashboard: { pending: "verified" }, serverFeatures: { person_analytics: true, ip_collection: false } }, { hash: "settings" });
  await view().findByRole("heading", { name: "Organization" });
  await user().click(view().getByRole("button", { name: "Continue" }));
  let dialog = await view().findByRole("dialog", { name: "Connect to Example Consulting?" });
  // A server tells a browser its switches only once connected, so this step shows the default text.
  assert.match(dialog.textContent!, /Never your usage next to your name\./);
  await user().click(within(dialog).getByRole("checkbox", { name: "I agree to share this browser's AI use with Example Consulting as described." }));
  await user().click(within(dialog).getByRole("button", { name: "Connect" }));
  dialog = await view().findByRole("dialog", { name: "Review what Example Consulting can see" });
  assert.match(dialog.textContent!, /nothing is shared until you agree to this text/);
  assert.doesNotMatch(dialog.textContent!, /Never your usage next to your name/);
  assert.match(dialog.textContent!, /Also each member's usage next to their name, yours included, recorded from when the organization turned it on\./);
  assert.match(within(dialog).getByRole("region", { name: "Never shared" }).textContent!, /Your connection address is not collected\./);
  const agree = within(dialog).getByRole("button", { name: "Agree and share" }) as HTMLButtonElement;
  assert.equal(agree.disabled, true, "the review asks for its own tick");
  assert.equal(calls.some((c) => c.action === "organization-consent"), false);
  await user().click(within(dialog).getByRole("checkbox", { name: "I agree to share this browser's AI use with Example Consulting as described." }));
  await user().click(agree);
  await view().findByText("Connected to Example Consulting. The popup and dashboard now show Organization.");
  assert.deepEqual(calls.find((c) => c.action === "organization-consent")!.payload, { agreed: true, version: "2026-10-19-people" });
  await waitFor(() => assert.equal(view().queryByRole("region", { name: "Sharing with Example Consulting is on hold" }), null));
});

test("a server that turns switches on later: Settings holds sharing and asks for the agreement there, with the address kept", async () => {
  const features = { person_analytics: true, ip_collection: true, person_analytics_since: "2026-10-20T00:00:00Z" };
  const calls = await show({ dashboard: { mode: "company", features, held: true }, serverFeatures: features }, { hash: "settings" });
  const review = await view().findByRole("region", { name: "Sharing with Example Consulting is on hold" });
  assert.match(review.textContent!, /Nothing new is shared until you agree to the text below\./);
  assert.doesNotMatch(review.textContent!, /not collected/);
  assert.match(review.textContent!, /Your connection address is collected with each upload and kept for 30 days\./);
  assert.match(review.textContent!, /recorded from 20 October 2026\. They can also see connection addresses next to members and browsers\./);
  assert.ok(view().getByText("Administrators can see each member's usage by name, yours included, from 20 October 2026"));
  assert.ok(view().getByText("Your connection address is kept for 30 days"));
  assert.ok(view().getByText("Sharing with Example Consulting waits for your agreement in Settings"), "the sidebar says so too");
  const agree = within(review).getByRole("button", { name: "Agree and share" }) as HTMLButtonElement;
  assert.equal(agree.disabled, true);
  await user().click(within(review).getByRole("checkbox", { name: "I agree to share this browser's AI use with Example Consulting as described." }));
  await user().click(agree);
  await view().findByText("Sharing with Example Consulting resumes");
  assert.deepEqual(calls.find((c) => c.action === "organization-consent")!.payload, { agreed: true, version: "2026-10-19-people-address" });
  await waitFor(() => assert.equal(view().queryByRole("region", { name: "Sharing with Example Consulting is on hold" }), null));
});

test("with both switches off Settings keeps the promises of 18 October 2026 and asks nothing", async () => {
  await show({ dashboard: { mode: "company", features: { person_analytics: false, ip_collection: false } } }, { hash: "settings" });
  await view().findByText("Administrators never see your usage next to your name");
  assert.ok(view().getByText("Your connection address is not collected"));
  assert.equal(view().queryByRole("region", { name: /is on hold/ }), null);
});

test("an organization that runs its own server is reached at the address the person enters", async () => {
  const calls = await show({}, { hash: "settings" });
  await view().findByRole("heading", { name: "Organization" });
  await user().click(view().getByRole("button", { name: /^Connect$/ }));
  const dialog = view().getByRole("dialog", { name: "Connect your organization" });
  await enter(within(dialog).getByRole("textbox", { name: "Work email" }), "sam@example.org");
  await user().click(within(dialog).getByRole("button", { name: "Your organization runs its own server?" }));
  const address = within(dialog).getByRole("textbox", { name: "Server address" });
  await enter(address, "http://aift.example.org");
  await user().click(within(dialog).getByRole("button", { name: "Continue" }));
  assert.match(within(dialog).getByRole("alert").textContent!, /https:\/\//);
  await enter(address, "https://aift.example.org/login");
  await user().click(within(dialog).getByRole("button", { name: "Continue" }));
  assert.match(within(dialog).getByRole("alert").textContent!, /without a path/);
  await enter(address, "https://aift.example.org");
  await user().click(within(dialog).getByRole("button", { name: "Continue" }));
  const permission = view().getByRole("dialog", { name: "Allow the extension to reach the server" });
  assert.match(permission.textContent!, /data on aift\.example\.org/);
  await user().click(within(permission).getByRole("button", { name: "Continue" }));
  await view().findByRole("dialog", { name: "Enter the code from your email" });
  assert.deepEqual(permitted, ["https://aift.example.org"]);
  assert.equal((calls.find((c) => c.action === "connect")!.payload as { origin: string }).origin, "https://aift.example.org");
});

test("a declined browser permission never starts a connection", async () => {
  const calls = await show({}, { hash: "settings", permission: false });
  await view().findByRole("heading", { name: "Organization" });
  await user().click(view().getByRole("button", { name: /^Connect$/ }));
  const input = view().getByRole("textbox", { name: "Work email" });
  await enter(input, "sam@example-consulting.com");
  await user().click(view().getByRole("button", { name: "Continue" }));
  await user().click(view().getByRole("button", { name: "Continue" }));
  await view().findByText(/permission was not granted/);
  assert.equal(calls.some((c) => c.action === "connect"), false);
});

test("a connection waiting for its code reopens at the code step, can send a new code and can be cancelled", async () => {
  const calls = await show({ dashboard: { pending: true } }, { hash: "connect" });
  const dialog = await view().findByRole("dialog", { name: "Enter the code from your email" });
  await user().click(within(dialog).getByRole("button", { name: "Send a new code" }));
  await waitFor(() => assert.ok(calls.some((c) => c.action === "connect")));
  assert.deepEqual(calls.find((c) => c.action === "connect")!.payload, { origin: "https://aifootprinttracker.com", email: "sam@example-consulting.com" });
  await user().click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => assert.equal(view().queryByRole("dialog"), null));
  assert.ok(calls.some((c) => c.action === "cancel-connection"));
});

test("a code pasted from the email with a space or a dash keeps all six digits", async () => {
  // Owner, 13 Oct 2026: a pasted "094 475" lost its last digit in a six-character field. A space or
  // a dash in a pasted code must never cost a digit or block the code.
  const calls = await show({ dashboard: { pending: true } }, { hash: "connect" });
  const dialog = await view().findByRole("dialog", { name: "Enter the code from your email" });
  const code = within(dialog).getByRole("textbox", { name: "Code" }) as HTMLInputElement;
  // A browser cuts pasted text to maxLength before the page sees it; jsdom does not, so do it here.
  const paste = (text: string) => fireEvent.change(code, { target: { value: code.maxLength >= 0 ? text.slice(0, code.maxLength) : text } });
  assert.equal(code.getAttribute("autocomplete"), "one-time-code");
  assert.equal(code.getAttribute("inputmode"), "numeric");
  paste("094-475");
  await waitFor(() => assert.equal(code.value, "094475"));
  paste("123 456");
  await waitFor(() => assert.equal(code.value, "123456"));
  await user().click(within(dialog).getByRole("button", { name: "Continue" }));
  await waitFor(() => assert.deepEqual(calls.find((c) => c.action === "verify-code")?.payload, { code: "123456" }));
});

test("a verified connection reopens at the confirmation and its page says what waits", async () => {
  await show({ dashboard: { pending: "verified" } }, { hash: "connect" });
  const dialog = await view().findByRole("dialog", { name: "Connect to Example Consulting?" });
  await user().click(within(dialog).getByRole("button", { name: "Cancel" }));
  await view().findByRole("heading", { name: "See your organization's AI footprint together" });
});

test("the popup's Connect organization link opens the organization side with the dialog", async () => {
  await show({}, { hash: "connect" });
  await view().findByRole("dialog", { name: "Connect your organization" });
  await user().click(view().getByRole("button", { name: "Cancel" }));
  await view().findByRole("heading", { name: "See your organization's AI footprint together" });
  await user().click(view().getByRole("button", { name: /Connect your organization/ }));
  await view().findByRole("dialog", { name: "Connect your organization" });
});

test("a connection the organization ended says so in Settings and offers to connect again", async () => {
  await show({ dashboard: { ended: "revoked" } }, { hash: "settings" });
  await view().findByRole("heading", { name: "Organization" });
  assert.ok(view().getByText(/^This browser was removed from Example Consulting, so it no longer shares usage\./));
  assert.equal(view().queryByText(/^Not connected\./), null);
  assert.ok(view().getByRole("button", { name: /^Connect again$/ }));
  cleanup();
  await show({ dashboard: { ended: "reconnect_needed" } }, { hash: "settings" });
  assert.ok(await view().findByText(/^The connection to Example Consulting has ended/));
});

test("disconnecting can sync first and then leaves organization mode", async () => {
  const calls = await show({ dashboard: { mode: "company", queueCount: 3 } }, { hash: "settings" });
  await view().findByRole("heading", { name: "Example Consulting" });
  // The name comes from the server; the hosted address is not the organization's identity.
  assert.ok(view().getByText(/^Hosted service · connected$/));
  assert.equal(document.body.textContent!.includes("aifootprinttracker.com ·"), false);
  assert.equal(view().queryByRole("heading", { name: "Your records" }), null, "erasing is only offered in personal mode");
  // Connection addresses are no longer collected (18 October 2026), so Settings names no period for them.
  assert.equal(/Connection addresses|IP address/i.test(document.body.textContent!), false);
  await user().click(view().getByRole("button", { name: /Disconnect this browser/ }));
  const dialog = view().getByRole("dialog", { name: "Disconnect from Example Consulting?" });
  assert.match(dialog.textContent!, /3 records have/);
  await user().click(within(dialog).getByRole("button", { name: /Sync first/ }));
  await waitFor(() => assert.ok(calls.some((c) => c.action === "sync")));
  await user().click(within(dialog).getByRole("button", { name: "Disconnect" }));
  await view().findByText("Disconnected. You are in personal mode.");
  assert.ok(calls.some((c) => c.action === "disconnect"));
});

test("with tracking off, Sync now and Disconnect never say that waiting records were sent", async () => {
  // A sync before the agreement, or after Turn off tracking, applies erasures only and sends
  // nothing (lib/tracking-consent.ts), so the page must not report "Synced".
  const calls = await show({ dashboard: { mode: "company", queueCount: 3, consent: false } }, { hash: "settings" });
  await view().findByRole("heading", { name: "Example Consulting" });
  await user().click(view().getByRole("button", { name: /Sync now/ }));
  await view().findByText("Tracking is off, so nothing was sent to Example Consulting.");
  assert.ok(calls.some((c) => c.action === "sync"), "erasures are still applied");
  assert.equal(view().queryByText("Synced with Example Consulting"), null);
  await user().click(view().getByRole("button", { name: /Disconnect this browser/ }));
  const dialog = view().getByRole("dialog", { name: "Disconnect from Example Consulting?" });
  assert.equal(within(dialog).queryByRole("button", { name: /Sync first/ }), null, "a sync could not send them");
  assert.match(dialog.textContent!, /3 records have not reached your organization yet/);
  assert.match(dialog.textContent!, /Tracking stays off until you agree/);
  assert.equal(/Tracking goes on in personal mode/.test(dialog.textContent!), false);
});

test("Settings and the organization overview say whether members see organization totals, as the policy says (17 October 2026)", async () => {
  const cases = [
    ["threshold", "Organization totals are shared with members", "Example Consulting · totals your organization shares with its members"],
    ["disabled", "Organization totals are not shared with members", "Example Consulting · totals kept for administrators"],
    [null, "Organization totals are shared with members only if an administrator turns sharing on", "Example Consulting"],
  ] as const;
  for (const [companySharing, line, subtitle] of cases) {
    await show({ dashboard: { mode: "company", companySharing } }, { hash: "settings" });
    await view().findByRole("heading", { name: "Example Consulting" });
    assert.ok(view().getByText(line), `${companySharing}: ${line}`);
    assert.equal(document.body.textContent!.includes("shared with everyone"), false);
    cleanup();
    await show({ dashboard: { mode: "company", companySharing } }, { prefs: { "ui:dashboard": { scope: "org" } } });
    const title = await view().findByRole("heading", { name: "Organization footprint", level: 1 });
    assert.equal(title.nextElementSibling?.textContent, subtitle, `${companySharing}: ${subtitle}`);
    // Totals reach the organization's members, never "everyone", also in the overview's notes.
    await view().findByRole("heading", { name: "Your part" }).catch(() => null);
    assert.equal(/with everyone/.test(document.body.textContent!), false, `${companySharing}: no "with everyone"`);
    cleanup();
    for (const key of Object.keys(storage)) delete storage[key];
  }
});

test("organization overview shows people, your part, the comparison and tools; Sync now syncs", async () => {
  const calls = await show({ dashboard: { mode: "company" } }, { prefs: { "ui:dashboard": { scope: "org" } } });
  await view().findByRole("heading", { name: "Your part" });
  assert.ok(view().getByRole("heading", { name: "Organization footprint" }));
  assert.match(view().getByRole("region", { name: /Example Consulting/ }).textContent!, /34 people/);
  assert.ok(view().getByRole("heading", { name: "How you compare" }));
  assert.ok(view().getByRole("heading", { name: "By tool" }));
  await user().click(view().getByRole("button", { name: /Sync now/ }));
  await view().findByText("Synced with Example Consulting");
  assert.ok(calls.some((c) => c.action === "sync"));
});

test("the organization overview asks for splits only for the period it charts", async () => {
  const calls = await show({ dashboard: { mode: "company" } }, { prefs: { "ui:dashboard": { scope: "org" } } });
  await view().findByRole("heading", { name: "Your part" });
  const queries = calls.filter((c) => c.action === "company-summary").map((c) => String(c.payload!.query));
  const totalsOnly = queries.filter((q) => /[?&]splits=none(&|$)/.test(q));
  const full = queries.filter((q) => !q.includes("splits"));
  // The previous period is read for its totals only (15 Oct 2026); the current one keeps its splits.
  assert.ok(totalsOnly.length >= 1 && full.length >= 1, queries.join(" | "));
  const start = (q: string) => new URLSearchParams(q).get("start") ?? "";
  assert.ok(totalsOnly.every((q) => full.every((f) => start(q) < start(f))), queries.join(" | "));
});

/**
 * The organization server's raw answer for a fixture summary, run through the background's own
 * check (validatedSummary) and the saved-history views selectedServerSummary builds for an
 * organization summary and its splits. The fixture rows carry the dashboard's scenario fields; the
 * raw answer uses plain rows so that the check reads them as a server would.
 */
function throughBackground(value: Record<string, unknown>) {
  const raw = (summary: Record<string, any>): Record<string, unknown> => {
    const { scopeToken: _token, days, sites, models, ...rest } = summary;
    const parts = (map: Record<string, any> | undefined) =>
      map && Object.fromEntries(Object.entries(map).map(([key, part]) => [key, raw(part)]));
    return {
      ...rest,
      resources: (rest.resources as Record<string, unknown>[]).map(
        ({ value_kind: _k, scenario_low: _l, scenario_high: _h, interval_kind: _i, method_id: _m, ...row }) => row,
      ),
      ...(days ? { days: parts(days) } : {}),
      ...(sites ? { sites: parts(sites) } : {}),
      ...(models ? { models: parts(models) } : {}),
    };
  };
  const checked = validatedSummary(raw(value));
  return {
    ...withSplitHistoryViews(checked),
    history: serverHistoryView(checked.history),
    scopeToken: value.scopeToken,
    snapshot_source: "server",
    cached_at: Date.now(),
    offline: false,
  };
}

test("the organization overview draws its daily bars and by-tool table from the server's splits", async () => {
  const base = fakeTransport({ dashboard: { mode: "company" } });
  const transport: Transport = async (action, payload) => {
    const value = await base(action, payload);
    return action === "company-summary" || action === "my-summary" ? throughBackground(value as Record<string, unknown>) : value;
  };
  await show({}, { transport, prefs: { "ui:dashboard": { scope: "org" } } });
  await view().findByRole("heading", { name: "Your part" });
  const bars = view().getByRole("list", { name: "Each day in the period" });
  const days = within(bars).getAllByRole("button");
  assert.equal(days.length, 30);
  assert.match(days.at(-1)!.getAttribute("aria-label")!, /^12 Oct: [\d.,]+ (Wh|kWh)/);
  const tools = view().getByRole("table", { name: /Organization electricity by tool/ });
  const rows = within(tools).getAllByRole("row");
  assert.ok(rows.length >= 3, `${rows.length} tool rows`);
  assert.match(tools.textContent!, /ChatGPT/);
});

test("the organization overview shows its figures when each split carries its saved history", async () => {
  // Live on 21 October 2026: the server sends every day, tool and model split with the saved
  // history of that part, and the overview showed "Organization totals could not load" instead.
  const base = fakeTransport({ dashboard: { mode: "company" } });
  const withHistory = (summary: Record<string, any>) => {
    const parts = (map: Record<string, unknown> | undefined) =>
      map && Object.fromEntries(Object.entries(map).map(([key, part]) => [key, { ...(part as object), history: serverHistory("2") }]));
    return {
      ...summary,
      history: serverHistory("2"),
      ...(summary.days ? { days: parts(summary.days) } : {}),
      ...(summary.sites ? { sites: parts(summary.sites) } : {}),
      ...(summary.models ? { models: parts(summary.models) } : {}),
    };
  };
  const transport: Transport = async (action, payload) => {
    const value = await base(action, payload);
    return action === "company-summary" ? throughBackground(withHistory(value as Record<string, unknown>)) : value;
  };
  await show({}, { transport, prefs: { "ui:dashboard": { scope: "org" } } });
  await view().findByRole("heading", { name: "Your part" });
  assert.equal(view().queryByText("Organization totals could not load."), null);
  assert.doesNotMatch(orgHero().textContent!, /Not available/);
  const bars = view().getByRole("list", { name: "Each day in the period" });
  assert.equal(within(bars).getAllByRole("button").length, 30);
  const tools = view().getByRole("table", { name: /Organization electricity by tool/ });
  assert.match(tools.textContent!, /ChatGPT/);
});

/**
 * A transport whose fresh organization answers wait: `current` holds the charted period's summary
 * and `previous` the earlier period's totals. Saved copies (cached=only) answer at once.
 */
function heldOrganization(scenario: Scenario, outcome: "answer" | "fail" = "answer") {
  const gate = () => {
    let open!: () => void;
    const promise = new Promise<void>((resolve) => (open = resolve));
    return { promise, open: () => open() };
  };
  const current = gate(),
    previous = gate();
  const base = fakeTransport(scenario);
  const transport: Transport = async (action, payload) => {
    const query = String(payload?.query ?? "");
    if (action === "company-summary" && !query.includes("cached=only")) {
      await (query.includes("splits=none") ? previous : current).promise;
      if (outcome === "fail") throw new Error("organization_unavailable");
    }
    return base(action, payload);
  };
  return { transport, releaseCurrent: current.open, releasePrevious: previous.open };
}
const SAVED = { ageMs: 2 * 3_600_000, kwh: 20.5, previousKwh: 10 };
const orgHero = () => view().getByRole("region", { name: /Example Consulting/ });
/** The change against the previous period in the organization hero, if shown. */
const orgChange = () => document.querySelector(".dh-hero .dh-pill:not(.dh-pill-age)")?.textContent ?? null;

test("the organization overview shows the saved copy at once with its age, then the fresh figures", async () => {
  const scenario: Scenario = { dashboard: { mode: "company" }, orgCached: SAVED };
  const { transport, releaseCurrent, releasePrevious } = heldOrganization(scenario);
  await show(scenario, { transport, prefs: { "ui:dashboard": { scope: "org" } } });
  await view().findByText("Updated 2 h ago");
  assert.match(orgHero().textContent!, /20\.5/);
  assert.equal(view().queryByText(/not refreshed|unreachable/), null, "being refreshed is not a failed refresh");
  // Both saved copies: their change is shown, worked out between the two saved copies.
  assert.match(orgChange() ?? "", /more than/);
  releaseCurrent();
  await waitFor(() => assert.match(orgHero().textContent!, /31\.6/));
  assert.equal(view().queryByText(/^Updated /), null, "fresh figures carry no age note");
  // A fresh total is never compared with a saved previous period.
  assert.equal(orgChange(), null);
  releasePrevious();
  await waitFor(() => assert.match(orgChange() ?? "", /more than/));
});

test("a saved organization copy goes when the fresh answer fails", async () => {
  const scenario: Scenario = { dashboard: { mode: "company" }, orgCached: SAVED };
  const { transport, releaseCurrent, releasePrevious } = heldOrganization(scenario, "fail");
  await show(scenario, { transport, prefs: { "ui:dashboard": { scope: "org" } } });
  await view().findByText("Updated 2 h ago");
  releasePrevious();
  releaseCurrent();
  await view().findByText("Organization totals could not load.");
  assert.equal(view().queryByText(/^Updated /), null);
  assert.doesNotMatch(document.body.textContent!, /20\.5/);
});

test("a saved organization copy from another data scope is never shown", async () => {
  const scenario: Scenario = { dashboard: { mode: "company" }, orgCached: { ...SAVED, scopeToken: "b".repeat(64) } };
  const { transport, releaseCurrent, releasePrevious } = heldOrganization(scenario);
  await show(scenario, { transport, prefs: { "ui:dashboard": { scope: "org" } } });
  await waitFor(() => assert.ok(scenario.calls!.filter((c) => String(c.payload?.query ?? "").includes("cached=only")).length >= 2));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(view().getByText("Loading organization figures"));
  assert.equal(view().queryByText(/^Updated /), null);
  releasePrevious();
  releaseCurrent();
  await view().findByRole("heading", { name: "Your part" });
});

test("organization figures that fail say so and Try again asks the server again", async () => {
  let fail = true;
  const base = fakeTransport({ dashboard: { mode: "company" } });
  const transport: Transport = async (action, payload) => {
    if (action === "company-summary" && fail) throw new Error("organization_unavailable");
    return base(action, payload);
  };
  await show({}, { transport, prefs: { "ui:dashboard": { scope: "org" } } });
  await view().findByText("Organization totals could not load.");
  fail = false;
  await user().click(view().getByRole("button", { name: "Try again" }));
  await view().findByRole("heading", { name: "Your part" });
});

test("an organization period nobody used is a calm note without Try again, and the totals appear on their own", async (t) => {
  // Owner, 13 Oct 2026: with sharing on, the server shows totals whatever the group size, and a
  // period without usage comes back as a current summary of zeros rather than as hidden.
  t.mock.timers.enable({ apis: ["setInterval"] });
  let unused = true;
  const base = fakeTransport({ dashboard: { mode: "company" } });
  const transport: Transport = async (action, payload) => {
    const value = await base(action, payload);
    if (action !== "company-summary" || !unused) return value;
    const { sites: _sites, days: _days, models: _models, ...whole } = value as Record<string, unknown>;
    return { ...whole, request_count: "0", attempt_count: "0", active_users: "0", resources: [], tokens: [] };
  };
  await show({}, { transport, prefs: { "ui:dashboard": { scope: "org" } } });
  await view().findByText("No organization usage yet");
  const status = view().getByRole("status").textContent!;
  assert.doesNotMatch(status, /5 people|enough people|privacy/i);
  assert.equal(view().queryByRole("button", { name: "Try again" }), null);
  assert.equal(view().queryByText("Not available"), null);
  unused = false;
  await act(async () => t.mock.timers.tick(ORG_RECHECK_MS));
  await view().findByRole("heading", { name: "Your part" });
  // Members are told that small teams' totals can show one person's use.
  assert.ok(view().getByText(/however few people use AI\. In a small team they can show one person's use/));
});

test("a server that still withholds totals gets a neutral wait, not a minimum-group claim", async (t) => {
  // An older self-hosted server can still answer "suppressed"; the page must not explain it with a
  // rule the current server no longer has.
  t.mock.timers.enable({ apis: ["setInterval"] });
  let suppressed = true;
  const base = fakeTransport({ dashboard: { mode: "company" } });
  const transport: Transport = async (action, payload) => {
    const value = await base(action, payload);
    return action === "company-summary" && suppressed ? { ...(value as object), aggregate_status: "suppressed", suppressed: true } : value;
  };
  await show({}, { transport, prefs: { "ui:dashboard": { scope: "org" } } });
  await view().findByText("Organization totals are not shared for this period");
  assert.doesNotMatch(view().getByRole("status").textContent!, /5 people|at least|enough people/i);
  assert.equal(view().queryByRole("button", { name: "Try again" }), null);
  suppressed = false;
  await act(async () => t.mock.timers.tick(ORG_RECHECK_MS));
  await view().findByRole("heading", { name: "Your part" });
});

test("tracking status lists each site and copies a support note without chat text", async () => {
  await show({ dashboard: { health: [{ code: "protocol_unsupported" }] } }, { hash: "tracking" });
  await view().findByRole("heading", { name: "Open problems" });
  // A page problem is an earlier event: its saved row never clears, so it is not an open
  // problem and the sidebar does not count it (owner, 12 October 2026).
  assert.ok(view().getByText(/No open problems/));
  // Earlier problems stay closed until the person opens them (owner, 16 October 2026).
  const earlier = document.querySelector<HTMLDetailsElement>("details.tr-earlier")!;
  assert.equal(earlier.open, false);
  assert.equal(earlier.querySelector("summary")!.textContent, "Earlier problems1");
  earlier.open = true;
  assert.match(earlier.textContent!, /1 reply not counted/);
  assert.match(earlier.textContent!, /Last seen today/);
  assert.equal(document.querySelector(".dh-status-title")!.textContent, "Tracking is on");
  assert.ok(view().getAllByText("1 reply not counted").length >= 1);
  // The site cards wait for the usage breakdown, which can answer after the problems list.
  assert.ok((await view().findAllByText("Working")).length >= 4);
  assert.ok(view().getByText("Not used yet"));
  await user().click(view().getByRole("button", { name: /Copy for support/ }));
  await view().findByText("Copied for support, without chat text");
  // user-event installs its own clipboard, so read back what the page wrote through it.
  const note = await navigator.clipboard.readText();
  assert.match(note, /^AI Footprint Tracker 0\.1\.0\nProblem: protocol_unsupported\n/);
  assert.doesNotMatch(note, /chat|prompt|https?:/i);
});

// Live QA of 19 Oct 2026: ChatGPT showed Working while its live replies were missed.
test("tracking status shows a tool whose latest live reply was not read", async () => {
  const base = fakeTransport();
  const transport: Transport = async (action, payload) => {
    const value = (await base(action, payload)) as Record<string, unknown>;
    return action === "usage-breakdown"
      ? { ...value, siteLastMissed: { chatgpt: new Date(Date.now() - 5 * 60_000).toISOString() } }
      : value;
  };
  await show({}, { hash: "tracking", transport });
  await view().findByText("Last reply not read");
  const card = document.querySelector("#tr-chatgpt")!.closest("section")!;
  assert.match(card.textContent!, /Last reply not read/);
  assert.match(card.textContent!, /could not be read while it arrived/);
  assert.match(card.textContent!, /reload the ChatGPT tab/);
  assert.ok(card.querySelector(".tr-badge-missed"));
  assert.ok(view().getAllByText("Working").length >= 3, "the other tools keep their state");
});

test("problems that are not page events stay open and are counted in the sidebar", async () => {
  await show({ dashboard: { health: [{ code: "storage_write_failed" }, { code: "capture_hook_missing" }] } }, { hash: "tracking" });
  const open = await view().findByRole("region", { name: "Open problems" });
  assert.match(open.textContent!, /New usage could not be saved/);
  assert.doesNotMatch(open.textContent!, /stopped reporting/);
  assert.match(document.querySelector("details.tr-earlier")!.textContent!, /An open AI tab stopped reporting replies/);
  assert.equal(document.querySelector(".dh-status-title")!.textContent, "Tracking, 1 problem");
});

test("solved problems and those not seen for 3 days move to Earlier problems and leave the sidebar count", async () => {
  // Owner decision of 16 October 2026.
  const at = NOW.getTime();
  await show(
    {
      dashboard: {
        health: [
          { code: "storage_write_failed", lastAt: at - 60_000 },
          { code: "sync_delayed", lastAt: at - 3_600_000, resolvedAt: at - 1_800_000, state: "resolved", count: 4 },
          { code: "policy_unavailable", lastAt: at - 4 * 86_400_000, state: "inactive" },
          { code: "estimate_unavailable", lastAt: at - 7_200_000, resolvedAt: at - 600_000, state: "resolved" },
          // A note is never open, even when seen today.
          { code: "revision_conflict", lastAt: at - 120_000, state: "unresolved" },
        ],
      },
    },
    { hash: "tracking" },
  );
  await view().findByText("Earlier problems");
  // The page shows local times; the test machine's time zone decides them.
  const hm = (ms: number) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
  const open = document.querySelector('section[aria-labelledby="tr-open"]')!;
  const earlier = document.querySelector<HTMLDetailsElement>("details.tr-earlier")!;
  assert.equal(earlier.open, false, "closed until opened");
  earlier.open = true;
  assert.match(open.textContent!, /New usage could not be saved/);
  assert.ok(open.textContent!.includes(`Last seen today, ${hm(at - 60_000)} · 1 time`));
  assert.doesNotMatch(open.textContent!, /First seen|waiting to sync|refused some updates|Something needs a look/);
  assert.match(earlier.textContent!, /Usage is waiting to sync/);
  assert.ok(earlier.textContent!.includes(`Last seen today, ${hm(at - 3_600_000)} · 4 times · Solved today, ${hm(at - 1_800_000)}`));
  assert.match(earlier.textContent!, /Organization rules could not be checked/);
  assert.ok(earlier.textContent!.includes(`Last seen 8 Oct, ${hm(at - 4 * 86_400_000)} · 1 time · Not seen for 3 days`));
  assert.match(earlier.textContent!, /Your organization's server refused some updates/);
  assert.ok(earlier.textContent!.includes(`Last seen today, ${hm(at - 120_000)} · 1 time · Nothing to fix in this browser`));
  assert.match(earlier.textContent!, /Something needs a look/);
  assert.match(earlier.textContent!, /solved when the same work succeeded again, notes nothing in this browser can fix, and problems not seen for 3 days/);
  // No page event is listed, so the page sentence is left out.
  assert.doesNotMatch(earlier.textContent!, /These happened on an AI page/);
  // A solved problem asks nothing of the person; one that only went quiet still says what to do.
  const solved = [...earlier.querySelectorAll("li")].find((li) => /waiting to sync/.test(li.textContent!))!;
  assert.doesNotMatch(solved.textContent!, /What you can do/);
  const quiet = [...earlier.querySelectorAll("li")].find((li) => /rules could not be checked/.test(li.textContent!))!;
  assert.match(quiet.textContent!, /What you can do/);
  const note = [...earlier.querySelectorAll("li")].find((li) => /refused some updates/.test(li.textContent!))!;
  assert.doesNotMatch(note.textContent!, /What you can do/);
  assert.equal(document.querySelector(".dh-status-title")!.textContent, "Tracking, 1 problem");
  // Copy for support keeps working for an earlier problem and names when it was solved.
  await user().click(solved.querySelector("button")!);
  await view().findByText("Copied for support, without chat text");
  const copied = await navigator.clipboard.readText();
  assert.match(copied, /^AI Footprint Tracker 0\.1\.0\nProblem: sync_delayed\n/);
  assert.match(copied, new RegExp(`\\nResolved: ${new Date(at - 1_800_000).toISOString()}\\n`));
});

test("the sidebar says tracking is on when every saved problem is solved", async () => {
  const at = NOW.getTime();
  await show(
    { dashboard: { health: [{ code: "storage_write_failed", lastAt: at - 60_000, resolvedAt: at - 30_000, state: "resolved" }] } },
    { hash: "tracking" },
  );
  await view().findByText("Earlier problems");
  assert.equal(document.querySelector(".dh-status-title")!.textContent, "Tracking is on");
  assert.match(document.querySelector('section[aria-labelledby="tr-open"]')!.textContent!, /No open problems/);
});

test("settings switches the extension pages between light, dark and the device theme", async () => {
  await show({}, { hash: "settings" });
  const group = await view().findByRole("group", { name: "Appearance" });
  const button = (name: string) => within(group).getByRole("button", { name });
  assert.deepEqual(
    within(group).getAllByRole("button").map((b) => b.textContent),
    ["Light", "Dark", "System"],
  );
  assert.equal(button("System").getAttribute("aria-pressed"), "true", "the device theme by default");
  await user().click(button("Dark"));
  assert.equal(document.documentElement.dataset.theme, "dark");
  assert.equal(button("Dark").getAttribute("aria-pressed"), "true");
  await waitFor(() => assert.deepEqual(storage["ui:theme"], { choice: "dark" }));
  await view().findByText("Pages now use the dark theme");
  await user().click(button("Light"));
  assert.equal(document.documentElement.dataset.theme, "light");
  await user().click(button("System"));
  assert.equal(document.documentElement.hasAttribute("data-theme"), false);
  await waitFor(() => assert.deepEqual(storage["ui:theme"], { choice: "system" }));
});

test("the sidebar logo opens the public website", async () => {
  await show();
  const brand = await view().findByRole("link", { name: "AI Footprint Tracker website" });
  assert.equal(brand.getAttribute("href"), "https://aifootprinttracker.com");
  assert.equal(brand.getAttribute("target"), "_blank");
  assert.ok(view().getByRole("link", { name: "Overview" }), "Overview stays in the navigation");
});

test("licences count every component and list all on request", async () => {
  await show({}, { hash: "licences" });
  await view().findByRole("heading", { name: "Components" });
  assert.match(view().getByText(/Showing 8 of/).textContent!, /Showing 8 of 65/);
  await user().click(view().getByRole("button", { name: "Show all" }));
  assert.equal(within(view().getByRole("table")).getAllByRole("row").length, 66);
});

test("a reply from another data scope is discarded and the dashboard reloads", async () => {
  let foreign = true;
  const base = fakeTransport();
  let loads = 0;
  const transport: Transport = async (action, payload) => {
    if (action === "dashboard") loads++;
    const value = (await base(action, payload)) as Record<string, unknown>;
    if (action === "usage-breakdown" && foreign) {
      foreign = false;
      return { ...value, scopeToken: "b".repeat(64) };
    }
    return value;
  };
  await show({}, { transport });
  await view().findByRole("heading", { name: "Where it comes from" });
  assert.ok(loads >= 2, "the dashboard was loaded again after the foreign reply");
});

test("a failed first load offers Try again", async () => {
  let fail = true;
  const base = fakeTransport();
  const transport: Transport = async (action, payload) => {
    if (action === "dashboard" && fail) throw new Error("background_unavailable");
    return base(action, payload);
  };
  await show({}, { transport });
  await view().findByText(/dashboard could not load/);
  fail = false;
  await user().click(view().getByRole("button", { name: "Try again" }));
  await view().findByRole("heading", { name: "Where it comes from" });
});

test("a rebuilding cache is checked again and stops once current", async () => {
  let rebuilding = 2;
  let loads = 0;
  const base = fakeTransport();
  const transport: Transport = async (action, payload) => {
    if (action !== "dashboard") return base(action, payload);
    loads++;
    const value = dashboardFixture();
    return rebuilding-- > 0 ? { ...value, aggregate_status: "rebuilding", refreshAfterMs: 500 } : value;
  };
  await show({}, { transport });
  await waitFor(() => assert.equal(loads, 3), { timeout: 4_000 });
  await new Promise((r) => setTimeout(r, 900));
  assert.equal(loads, 3, "no more checks once current");
});

test("an empty browser shows how to start, without the recap", async () => {
  await show({ dashboard: { empty: true } });
  await view().findByRole("heading", { name: "Your footprint starts with your next chat" });
  assert.equal(view().queryByRole("link", { name: "Monthly recap" }), null);
  assert.ok(view().getByText("Nothing recorded yet"));
});

test("after a period change the overview never shows the previous period's figures under the new label (15 October 2026)", async () => {
  // useScoped kept the previous answer visible while a new key loaded, so "Last 7 days" showed the
  // 30-day figures until the 7-day breakdown arrived.
  let hold = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const scenario: Scenario = {};
  const base = fakeTransport(scenario);
  const transport: Transport = async (action, payload) => {
    if (action === "usage-breakdown" && hold) await held;
    return base(action, payload);
  };
  await show(scenario, { transport });
  const thirty = await view().findByRole("region", { name: "Electricity · last 30 days" });
  const thirtyText = thirty.querySelector(".dh-hero-num")!.textContent;
  hold = true;
  await user().click(view().getByRole("button", { name: /Last 30 days/ }));
  await user().click(within(view().getByRole("dialog", { name: "Choose a period" })).getByRole("button", { name: /^Last 7 days/ }));
  await new Promise((resolve) => setTimeout(resolve, 100));
  const seven = document.body.querySelector('[aria-label="Electricity · last 7 days"]');
  assert.notEqual(seven?.querySelector(".dh-hero-num")?.textContent ?? null, thirtyText, "the 30-day figure must not appear under the 7-day label");
  release();
  await view().findByRole("region", { name: "Electricity · last 7 days" });
});

// The agreements of 17 and 18 October 2026 (lib/tracking-consent.ts).
// Owner request of 21 Oct 2026: the card moved to the bottom and links to the methodology.
test("the overview ends with the card that says everything was calculated on this computer", async () => {
  await show();
  const card = await view().findByRole("region", { name: "Everything here was calculated on your computer." });
  assert.match(card.textContent!, /Your history is stored in this browser only\. Nothing is sent to us\. The code is open source under the MIT License\./);
  const methodology = within(card).getByRole("link", { name: "Read the methodology" });
  assert.equal(methodology.getAttribute("href"), "methodology.html");
  assert.equal(within(card).queryByRole("link", { name: "Read the code" }), null);
  const main = document.querySelector(".dh-main")!;
  assert.ok(view().getByRole("region", { name: /^Electricity · / }).compareDocumentPosition(card) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING, "the figures come first");
  // Only the page credit follows it.
  assert.equal([...main.querySelectorAll(":scope > section")].at(-1), card, "it is the last card");
  assert.ok(main.querySelector(".dh-note")!.compareDocumentPosition(card) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING, "below the estimates note");
});

test("Settings keeps Read the code in its card", async () => {
  await show({}, { hash: "settings" });
  const card = await view().findByRole("region", { name: "Everything here was calculated on your computer." });
  assert.equal(within(card).getByRole("link", { name: "Read the code" }).getAttribute("href"), "https://aifootprinttracker.com/open-source");
});

test("with nothing recorded the overview also ends with the card, linked to the methodology", async () => {
  await show({ dashboard: { empty: true } });
  const card = await view().findByRole("region", { name: "Everything here was calculated on your computer." });
  assert.equal(within(card).getByRole("link", { name: "Read the methodology" }).getAttribute("href"), "methodology.html");
  assert.equal([...document.querySelector(".dh-main")!.querySelectorAll(":scope > section")].at(-1), card, "it is the last card");
});

test("connected to an organization the card says only numbers are shared with it", async () => {
  await show({ dashboard: { mode: "company" } });
  await hash("overview");
  await user().click(await view().findByRole("button", { name: "Me" }));
  const card = await view().findByRole("region", { name: "Calculated on your computer." });
  assert.match(card.textContent!, /Only numbers are shared with Example Consulting, never your chats\./);
});

test("Settings says when the person agreed and Turn off tracking withdraws it after asking", async () => {
  const calls = await show({ dashboard: { consent: true } }, { hash: "settings" });
  const section = (await view().findByRole("heading", { name: "Your agreement" })).closest("section")!;
  assert.match(section.textContent!, /You agreed on 3 October 2026\./);
  await user().click(within(section).getByRole("button", { name: "Turn off tracking" }));
  const dialog = view().getByRole("dialog", { name: "Turn off tracking?" });
  assert.match(dialog.textContent!, /Nothing is counted, stored or read from the sites until you agree again/);
  assert.equal(calls.some((c) => c.action === "consent"), false, "nothing changes before confirming");
  await user().click(within(dialog).getByRole("button", { name: "Turn off tracking" }));
  await view().findByText("Tracking is off. Nothing is counted until you agree again.");
  assert.deepEqual(calls.find((c) => c.action === "consent")!.payload, { agreed: false });
  await waitFor(() => assert.match(section.isConnected ? section.textContent! : view().getByRole("heading", { name: "Your agreement" }).closest("section")!.textContent!, /Tracking is off\./));
  // The Pause switch would say Tracking is on beside Tracking is off, so it waits for the agreement.
  assert.equal(view().queryByRole("switch", { name: /Tracking is (on|paused)/ }), null);
  assert.match(view().getByRole("heading", { name: "Tracking" }).closest("section")!.textContent!, /Off until you agree under Your agreement\./);
  await user().click(view().getByRole("button", { name: "Review and agree" }));
  assert.deepEqual(opened, ["chrome-extension://aift/welcome.html"]);
  const about = view().getByRole("region", { name: "Everything here was calculated on your computer." });
  assert.ok(about);
});

// Live QA of 19 Oct 2026: each Set up opened another welcome tab.
test("an open welcome page comes to the front instead of a second one", async () => {
  const runtime = (globalThis as any).chrome.runtime;
  const asked: unknown[] = [];
  runtime.sendMessage = async (message: unknown) => {
    asked.push(message);
    return { focused: true };
  };
  try {
    await show({ dashboard: { consent: false } });
    await user().click(await view().findByRole("button", { name: /Tracking is off/ }));
    await waitFor(() => assert.deepEqual(asked, [{ target: "footprint-welcome-focus" }]));
    assert.deepEqual(opened, [], "no second welcome tab");
  } finally {
    delete runtime.sendMessage;
  }
});

test("the sidebar says Tracking is off before the person agrees and opens the welcome page", async () => {
  await show({ dashboard: { consent: false } });
  const status = await view().findByRole("button", { name: /Tracking is off/ });
  assert.match(status.textContent!, /Nothing is counted until you agree\./);
  await user().click(status);
  assert.deepEqual(opened, ["chrome-extension://aift/welcome.html"]);
});
