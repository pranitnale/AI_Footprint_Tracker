// Behaviour of the redesigned toolbar popup (canvas boards Popup*), driven through the real dashboard
// client and response validators with fixture replies, so every button is exercised end to end.
import assert from "node:assert/strict";
import test, { after, afterEach, before } from "node:test";
import { dom } from "./dom-env";
import React from "react";
import { act, cleanup, configure, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fakeTransport, SCOPE, type Scenario } from "./ui-fixtures";
import type { Transport } from "../lib/dashboard/client";

const NOW = new Date("2026-10-12T10:30:00.000Z");
const realNow = Date.now;
dom.reconfigure({ url: "chrome-extension://aift/popup.html" });
// The first render loads every module; under a full parallel suite it can take longer than the default second.
configure({ asyncUtilTimeout: 5000 });
const storage: Record<string, unknown> = {};
const session: Record<string, unknown> = {};
const opened: string[] = [];
const reloaded: number[] = [];
let activeTab: { id: number; url: string } | null = null;
// What the open AI tab answers when the popup asks it about capture (owner, 12 October 2026).
let tabAnswer: unknown = { target: "page-health", problems: [] };
let tabStatus = "complete";
let siteAccess = true;
const asked: unknown[][] = [];
let closed = 0;

before(async () => {
  // Fixture ages (generated a minute ago, approval expiring in nine minutes) are relative to Date.now; pin it to the popup clock.
  Date.now = () => NOW.getTime();
  dom.window.close = () => void closed++;
  // wxt/browser resolves to globalThis.chrome when the module is first imported, so the stub must exist before Popup loads.
  Object.assign(globalThis, {
    chrome: {
      runtime: { id: "aift", getURL: (path: string) => `chrome-extension://aift${path}` },
      storage: {
        local: {
          get: async (key: string) => (key in storage ? { [key]: storage[key] } : {}),
          set: async (items: Record<string, unknown>) => void Object.assign(storage, structuredClone(items)),
          remove: async (key: string) => void delete storage[key],
        },
        session: {
          get: async (key: string) => (key in session ? { [key]: structuredClone(session[key]) } : {}),
          set: async (items: Record<string, unknown>) => void Object.assign(session, structuredClone(items)),
          remove: async (key: string) => void delete session[key],
        },
      },
      tabs: {
        create: async ({ url }: { url: string }) => void opened.push(url),
        query: async () => (activeTab ? [activeTab] : []),
        reload: async (id: number) => void reloaded.push(id),
        get: async (id: number) => ({ ...activeTab!, id, status: tabStatus, discarded: false }),
        sendMessage: async (...args: unknown[]) => {
          asked.push(args);
          const answer = typeof tabAnswer === "function" ? tabAnswer(asked.length) : tabAnswer;
          if (answer instanceof Error) throw answer;
          return answer;
        },
      },
      permissions: { contains: async () => siteAccess },
    },
  });
  // Load the popup once up front: a cold module load on a busy machine can outlast the first query timeout.
  await import("../lib/popup/Popup");
});
after(() => {
  Date.now = realNow;
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  for (const key of Object.keys(storage)) delete storage[key];
  for (const key of Object.keys(session)) delete session[key];
  opened.length = 0;
  reloaded.length = 0;
  activeTab = null;
  closed = 0;
  tabAnswer = { target: "page-health", problems: [] };
  tabStatus = "complete";
  siteAccess = true;
  asked.length = 0;
});

async function show(scenario: Scenario = {}, transport?: Transport, preferences: Record<string, unknown> = {}, organization = false) {
  Object.assign(storage, preferences);
  const { default: Popup } = await import("../lib/popup/Popup");
  const calls = (scenario.calls ??= []);
  render(<Popup transport={transport ?? fakeTransport(scenario)} clock={() => NOW} />);
  // A saved Organization choice is ignored, so organization tests switch with the toggle.
  if (organization) await user().click(await view().findByRole("button", { name: "Organization" }));
  return calls;
}
// The jsdom document becomes global in before(), after testing-library loads, so queries bind to it lazily.
const view = () => within(document.body);
const user = () => userEvent.setup({ document: dom.window.document });
const hero = () => view().getByRole("region", { name: /·/ });

test("personal view shows the 30 day total, tiles, requests and the tool split", async () => {
  const calls = await show();
  await view().findByRole("group", { name: "Period" });
  assert.match(hero().textContent ?? "", /Electricity · last 30 days/);
  assert.match(hero().textContent ?? "", /hours of LED light/);
  const tiles = view().getByRole("group", { name: "Choose the figure shown above" });
  assert.equal(within(tiles).getAllByRole("button").length, 3);
  assert.match(view().getByRole("region", { name: "Requests and tools" }).textContent ?? "", /requests/);
  assert.ok(view().getByRole("img", { name: /Claude 45%/ }));
  const breakdowns = calls.filter((c) => c.action === "usage-breakdown");
  assert.equal(breakdowns.length, 2, "current and previous window");
  assert.equal(breakdowns[0]!.payload!.bucket, "day");
  assert.equal(breakdowns[0]!.payload!.timezone, "Europe/Berlin");
  assert.match(view().getByText(/Up to date/).textContent ?? "", /1 min ago/);
});

test("the logo opens the public website, the footer puts the status beside Dashboard and the credit centred below (16 October 2026)", async () => {
  await show();
  await view().findByRole("group", { name: "Period" });
  const brand = view().getByRole("link", { name: "AI Footprint Tracker website" });
  assert.equal(brand.getAttribute("href"), "https://aifootprinttracker.com");
  assert.equal(brand.getAttribute("target"), "_blank");
  assert.match(brand.getAttribute("rel") ?? "", /noopener/);
  // The status then Dashboard in the footer row, the credit alone below them, no Methodology link.
  const foot = document.querySelector(".pp-foot")!;
  assert.equal(foot.children.length, 2);
  assert.match(foot.firstElementChild!.textContent!, /^Up to date/);
  assert.equal(foot.lastElementChild!.textContent, "Dashboard");
  const meta = foot.nextElementSibling!;
  assert.ok(meta.classList.contains("pp-meta"));
  assert.equal(meta.children.length, 1);
  assert.match(meta.textContent!, /^Designed and built by Pranit Nale$/);
  assert.ok(!document.querySelector('a[href="methodology.html"]'), "no Methodology link in the popup");
});

// The popup keeps its last figures per period in extension storage, so they survive a browser
// restart, and shows them at once with an Updating note until fresh figures replace them (owner
// decision of 16 October 2026). Before, it showed them only after the dashboard was read and only
// while nothing new was recorded.
const SAVED_VIEWS = "popup:last-views";
const heroValue = () => document.querySelector(".pp-hero-value")?.textContent ?? null;
const periodButtons = () => [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Period"] button')];
const footStatus = () => document.querySelector(".pp-foot-status")?.textContent ?? "";

/** Renders one popup with fresh figures, so its figures are saved, and returns the hero text. */
async function saveFigures(Popup: React.ComponentType<any>, transport: Transport = fakeTransport()) {
  render(<Popup transport={transport} clock={() => NOW} keepLastView />);
  await view().findByRole("group", { name: "Period" });
  const text = heroValue();
  await waitFor(() => assert.ok((storage[SAVED_VIEWS] as Record<string, unknown> | undefined)?.["30d"], "the view is kept for the next popup"));
  cleanup();
  return text;
}
/** A transport that never answers `held` actions, so anything shown comes from the saved copy. */
function holding(held: string[], change?: (action: string, reply: Record<string, any>) => void): Transport {
  const base = fakeTransport();
  return async (action, payload) => {
    if (held.includes(action)) return new Promise(() => {});
    const reply = (await base(action, payload)) as Record<string, any>;
    change?.(action, reply);
    return reply;
  };
}

test("the saved figures show before the dashboard is read, marked Updating, and stay out of session storage", async () => {
  const { default: Popup } = await import("../lib/popup/Popup");
  const first = await saveFigures(Popup);
  assert.equal(session["popup:last-view"], undefined, "kept in extension storage, which survives a restart");
  render(<Popup transport={holding(["dashboard", "usage-breakdown"])} clock={() => NOW} keepLastView />);
  await waitFor(() => assert.equal(heroValue(), first));
  assert.match(footStatus(), /^Updating · /);
});

test("while the figures update the period buttons stay in place but cannot be used, and only Updating is said (16 October 2026)", async () => {
  const { default: Popup } = await import("../lib/popup/Popup");
  await saveFigures(Popup);
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const base = fakeTransport();
  const transport: Transport = async (action, payload) => {
    if (action === "usage-breakdown") await held;
    return base(action, payload);
  };
  render(<Popup transport={transport} clock={() => NOW} keepLastView />);
  await waitFor(() => assert.ok(heroValue()));
  // Past the 600 ms after which a pill used to replace the buttons.
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.deepEqual(periodButtons().map((button) => button.textContent), ["Today", "7 days", "30 days"]);
  assert.ok(periodButtons().every((button) => button.disabled), "the period buttons cannot be used while updating");
  assert.match(footStatus(), /^Updating/);
  assert.doesNotMatch(document.body.textContent ?? "", /Refreshing/);
  release();
  await waitFor(() => assert.ok(periodButtons().every((button) => !button.disabled)));
  assert.match(footStatus(), /^Up to date/);
  assert.doesNotMatch(document.body.textContent ?? "", /Refreshing/);
});

test("unchanged saved figures are current once the dashboard confirms them", async () => {
  const { default: Popup } = await import("../lib/popup/Popup");
  const first = await saveFigures(Popup);
  render(<Popup transport={holding(["usage-breakdown"])} clock={() => NOW} keepLastView />);
  await waitFor(() => assert.equal(heroValue(), first));
  await waitFor(() => assert.doesNotMatch(footStatus(), /Updating · /, "no saved-copy age once confirmed"));
});

test("saved figures stay with an Updating note while newer records are counted, then fresh figures replace them", async () => {
  const { default: Popup } = await import("../lib/popup/Popup");
  const first = await saveFigures(Popup);
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let dashboards = 0;
  const base = fakeTransport();
  const transport: Transport = async (action, payload) => {
    if (action === "usage-breakdown") await held;
    const reply = (await base(action, payload)) as Record<string, any>;
    // A reply was recorded since the copy was saved.
    if (action === "dashboard") {
      reply.summary.requests = 940;
      dashboards++;
    }
    return reply;
  };
  render(<Popup transport={transport} clock={() => NOW} keepLastView />);
  await waitFor(() => assert.equal(heroValue(), first));
  await waitFor(() => assert.equal(dashboards, 1));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(heroValue(), first);
  assert.match(footStatus(), /^Updating · /);
  release();
  await waitFor(() => assert.doesNotMatch(footStatus(), /Updating/));
});

test("an unchanged summary that is still being rebuilt does not confirm saved figures (16 October 2026)", async () => {
  // Right after a reply the dashboard still carries the earlier summary, marked rebuilding, so the
  // saved copy (one request short, seen live) must keep its Updating note.
  const { default: Popup } = await import("../lib/popup/Popup");
  const first = await saveFigures(Popup);
  let answered = false;
  const rebuilding = (action: string, d: Record<string, any>) => {
    if (action !== "dashboard") return;
    d.aggregate_status = "rebuilding";
    answered = true;
  };
  render(
    <Popup
      transport={holding(["usage-breakdown"], rebuilding)}
      clock={() => NOW}
      keepLastView
    />,
  );
  await waitFor(() => assert.equal(heroValue(), first));
  await waitFor(() => assert.ok(answered));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.match(footStatus(), /^Updating · /);
});

test("saved figures never show for another data scope, other settings or while an erasure runs", async () => {
  const { default: Popup } = await import("../lib/popup/Popup");
  await saveFigures(Popup);
  const changes: ((action: string, d: Record<string, any>) => void)[] = [
    // While an erasure runs the background refuses the dashboard, as buildDashboard does.
    (action, d) => {
      if (action === "view-token") d.erasing = true;
      if (action === "dashboard") throw new Error("deletion_in_progress");
    },
    (_action, d) => void (d.settings.displayScenario = "maximum"),
    // The long-chat tip settings of 16 Oct 2026 are part of the settings a copy follows.
    (_action, d) => void (d.settings.contextTipRequestLimit = 70),
    (_action, d) => void (d.settings.contextTipTokens = true),
    // An erasure, a connection or a disconnection gives the data another scope token.
    (_action, d) => void (d.scopeToken = "another-scope"),
  ];
  for (const change of changes) {
    for (const held of [["dashboard", "usage-breakdown"], ["usage-breakdown"]]) {
      render(<Popup transport={holding(held, change)} clock={() => NOW} keepLastView />);
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.ok(!document.querySelector(".pp-hero"), "no figures shown");
      cleanup();
    }
  }
});

test("a saved copy that newer records may have changed goes when the fresh figures cannot be read", async () => {
  const { default: Popup } = await import("../lib/popup/Popup");
  await saveFigures(Popup);
  const base = fakeTransport();
  const failing: Transport = async (action, payload) => {
    if (action === "usage-breakdown") throw new Error("load_failed");
    const reply = (await base(action, payload)) as Record<string, any>;
    // A reply was recorded since the copy was saved, so the copy is not current.
    if (action === "dashboard") reply.summary.requests = 940;
    return reply;
  };
  render(<Popup transport={failing} clock={() => NOW} keepLastView />);
  await waitFor(() => assert.match(footStatus(), /Figures could not refresh/));
  assert.ok(!document.querySelector(".pp-hero"), "no figures shown");
});

test("erasing records removes every saved copy", async () => {
  const { default: Popup } = await import("../lib/popup/Popup");
  await saveFigures(Popup);
  session["popup:last-view"] = { kept: "by an earlier version" };
  const { clearLastView } = await import("../lib/popup/last-view");
  await clearLastView();
  assert.equal(storage[SAVED_VIEWS], undefined);
  assert.equal(session["popup:last-view"], undefined);
});

test("figures are never shown under another period's label while that period loads", async () => {
  const { default: Popup } = await import("../lib/popup/Popup");
  let hold = false;
  const base = fakeTransport();
  const transport: Transport = async (action, payload) => {
    if (action === "usage-breakdown" && hold) return new Promise(() => {});
    return base(action, payload);
  };
  render(<Popup transport={transport} clock={() => NOW} />);
  await view().findByRole("group", { name: "Period" });
  hold = true;
  await user().click(view().getByRole("button", { name: "7 days" }));
  await waitFor(() => assert.ok(view().getByText("Loading your figures")));
  assert.ok(!document.querySelector(".pp-hero"), "no figures shown");
});

test("period buttons reload hourly or daily buckets and remember the choice", async () => {
  const calls = await show();
  await view().findByRole("group", { name: "Period" });
  await user().click(view().getByRole("button", { name: "Today" }));
  await waitFor(() => assert.match(hero().textContent ?? "", /Electricity · today/));
  const today = calls.filter((c) => c.action === "usage-breakdown").at(-2)!;
  assert.equal(today.payload!.bucket, "hour");
  assert.match(hero().textContent ?? "", /requests/, "today shows the request count instead of a comparison");
  assert.deepEqual((storage["ui:popup"] as { period: string }).period, "today");
  await user().click(view().getByRole("button", { name: "7 days" }));
  await waitFor(() => assert.match(hero().textContent ?? "", /last 7 days/));
});

test("a scope saved by an earlier version is dropped when the popup next saves a choice", async () => {
  await show({ dashboard: { mode: "company" } }, undefined, { "ui:popup": { scope: "org", metric: "water" } });
  await view().findByRole("group", { name: "Period" });
  await user().click(view().getByRole("button", { name: "Today" }));
  await waitFor(() => assert.equal((storage["ui:popup"] as { period?: string }).period, "today"));
  assert.deepEqual(storage["ui:popup"], { metric: "water", period: "today" });
});

test("resource tiles switch the hero figure and are remembered", async () => {
  await show();
  await view().findByRole("group", { name: "Period" });
  await user().click(view().getByRole("button", { name: /Carbon/ }));
  await waitFor(() => assert.match(hero().textContent ?? "", /Carbon · last 30 days/));
  assert.equal(view().getByRole("button", { name: /Carbon/ }).getAttribute("aria-pressed"), "true");
  assert.equal((storage["ui:popup"] as { metric: string }).metric, "carbon");
  await user().click(view().getByRole("button", { name: /Water/ }));
  await waitFor(() => assert.match(hero().textContent ?? "", /Water · last 30 days/));
});

test("settings and dashboard controls open the right extension pages", async () => {
  await show();
  await view().findByRole("group", { name: "Period" });
  await user().click(view().getByRole("button", { name: "Settings" }));
  await user().click(view().getByRole("button", { name: "Dashboard" }));
  assert.deepEqual(opened, ["chrome-extension://aift/dashboard.html#settings", "chrome-extension://aift/dashboard.html"]);
});

test("a reply from another data scope is never shown", async () => {
  const base = fakeTransport();
  const transport: Transport = async (action, payload) => {
    const value = (await base(action, payload)) as Record<string, unknown>;
    return action === "usage-breakdown" ? { ...value, scopeToken: "b".repeat(64) } : value;
  };
  await show({}, transport);
  await view().findByText(/could not be loaded/);
  assert.equal(view().queryByRole("group", { name: "Period" }), null);
  assert.match(view().getByText(/could not refresh/).textContent ?? "", /could not refresh/);
});

test("a failed first load offers Try again, which loads the figures", async () => {
  let fail = true;
  const base = fakeTransport();
  const transport: Transport = async (action, payload) => {
    if (action === "dashboard" && fail) throw new Error("background_unavailable");
    return base(action, payload);
  };
  await show({}, transport);
  await view().findByText(/could not load your figures/);
  fail = false;
  await user().click(view().getByRole("button", { name: "Try again" }));
  await view().findByRole("group", { name: "Period" });
});

test("first run explains the tracker when nothing has been recorded", async () => {
  await show({ dashboard: { empty: true } });
  await view().findByRole("heading", { name: "Ready when you are" });
  assert.equal(view().queryByRole("group", { name: "Show usage for" }), null, "no Me or Organization switch before any data");
  for (const site of ["ChatGPT", "Claude", "Gemini", "Perplexity", "NotebookLM"]) assert.ok(view().getByText(site));
  await user().click(view().getByRole("button", { name: "Dashboard" }));
  assert.deepEqual(opened, ["chrome-extension://aift/dashboard.html"]);
  assert.equal(view().getByRole("link", { name: "How estimates work" }).getAttribute("href"), "methodology.html");
  // The welcome page shows its tour once the person agreed (owner request of 21 Oct 2026).
  await user().click(view().getByRole("button", { name: "Take the quick tour" }));
  await waitFor(() => assert.deepEqual(opened, ["chrome-extension://aift/dashboard.html", "chrome-extension://aift/welcome.html"]));
});

test("the popup opens on Me even when Organization was chosen last time", async () => {
  // Owner, 14 Oct 2026: the popup opened straight on Organization because the last choice was kept.
  await show({ dashboard: { mode: "company" } }, undefined, { "ui:popup": { scope: "org" } });
  await view().findByRole("group", { name: "Period" });
  assert.equal(view().getByRole("button", { name: "Me" }).getAttribute("aria-pressed"), "true");
  assert.equal(view().getByRole("button", { name: "Organization" }).getAttribute("aria-pressed"), "false");
});

test("organization scope without a connection invites the user to connect", async () => {
  await show();
  await view().findByRole("group", { name: "Period" });
  await user().click(view().getByRole("button", { name: "Organization" }));
  await view().findByRole("heading", { name: "Connect this browser to your organization" });
  assert.ok(view().getByText("Personal mode"));
  assert.equal((storage["ui:popup"] as { scope?: string } | undefined)?.scope, undefined);
  await user().click(view().getByRole("button", { name: /Connect organization/ }));
  assert.deepEqual(opened, ["chrome-extension://aift/dashboard.html#connect"]);
  await user().click(view().getByRole("button", { name: "Me" }));
  await view().findByRole("group", { name: "Period" });
});

test("the Organization side says when the organization removed this browser", async () => {
  await show({ dashboard: { ended: "revoked" } }, undefined, {}, true);
  await view().findByRole("heading", { name: "Connect this browser to your organization" });
  assert.ok(view().getByText("Disconnected"));
  assert.ok(view().getByText(/^This browser was removed from Example Consulting, so it no longer shares usage\./));
  assert.equal(view().queryByText("Not connected"), null);
});

test("a connection waiting for its code sends the person back to the dashboard and can be cancelled", async () => {
  const calls = await show({ dashboard: { pending: true } }, undefined, { "ui:popup": { scope: "org" } }, true);
  await view().findByRole("heading", { name: "Enter the code from your email" });
  assert.ok(view().getByText("sam@example-consulting.com"));
  assert.ok(view().getByText("in 4 minutes"));
  // The hosted address names no organization, so it is not shown as one.
  assert.equal(view().queryByText(/aifootprinttracker\.com/), null);
  await user().click(view().getByRole("button", { name: /Continue in the dashboard/ }));
  assert.deepEqual(opened, ["chrome-extension://aift/dashboard.html#connect"]);
  await user().click(view().getByRole("button", { name: "Cancel" }));
  await view().findByRole("heading", { name: "Connect this browser to your organization" });
  assert.ok(calls.some((c) => c.action === "cancel-connection"));
});

test("paused tracking shows when it was paused and Resume tracking turns it back on", async () => {
  const pausedAt = new Date("2026-10-12T07:20:00.000Z").getTime();
  const calls = await show({ dashboard: { paused: true } }, undefined, { "ui:paused": { at: pausedAt } });
  await view().findByRole("heading", { name: "Tracking is paused" });
  assert.ok(view().getByText("Paused since 09:20 today"), "shown in the user's time zone (Berlin)");
  assert.ok(view().getByText("Last 30 days, until you paused"));
  await user().click(view().getByRole("button", { name: /Resume tracking/ }));
  await view().findByRole("group", { name: "Period" });
  const change = calls.find((c) => c.action === "settings");
  assert.equal((change!.payload as { changes: { paused: boolean } }).changes.paused, false);
  assert.deepEqual(storage["ui:paused"], {});
});

test("paused with nothing recorded says it is paused and offers Resume, not the first-run page", async () => {
  // Seen live on 21 Oct 2026: after a full erase while paused, the popup said tracking starts on its own.
  await show({ dashboard: { paused: true, empty: true } });
  await view().findByRole("heading", { name: "Tracking is paused" });
  assert.equal(view().queryByRole("heading", { name: "Ready when you are" }), null);
  assert.equal(view().queryByText(/until you paused/), null, "no empty totals under the paused message");
  assert.ok(view().getByRole("button", { name: /Resume tracking/ }));
});

test("a reply that could not be counted offers to reload the open AI tab", async () => {
  activeTab = { id: 41, url: "https://claude.ai/chat/abc" };
  tabAnswer = { target: "page-health", problems: [{ code: "protocol_unsupported", count: 1 }] };
  await show();
  const text = await view().findByText("1 reply in your open Claude tab was not counted.");
  const notice = text.closest(".pp-problem")!;
  assert.equal(notice.parentElement!.lastElementChild, notice, "problems sit below every figure");
  assert.ok(notice.previousElementSibling?.matches('[aria-label="Requests and tools"]'));
  assert.match(view().getByText(/Figures from/).textContent ?? "", /1 min ago/);
  await user().click(view().getByRole("button", { name: "Reload tab" }));
  await waitFor(() => assert.deepEqual(reloaded, [41]));
  assert.equal(closed, 1);
});

test("an open AI tab with no tracker that answers is reported as stopped", async () => {
  activeTab = { id: 7, url: "https://chatgpt.com/c/abc" };
  tabAnswer = new Error("Could not establish connection. Receiving end does not exist.");
  await show();
  await view().findByText("Your open ChatGPT tab stopped reporting replies.");
  // A silent tab is asked once more before it counts as silent.
  assert.deepEqual(asked, [
    [7, { target: "page-health" }, { frameId: 0 }],
    [7, { target: "page-health" }, { frameId: 0 }],
  ]);
  await user().click(view().getByRole("button", { name: "Reload tab" }));
  await waitFor(() => assert.deepEqual(reloaded, [7]));
});

test("a tab between two pages or failing for another reason shows nothing (Codex review, 12 Oct)", async () => {
  activeTab = { id: 7, url: "https://chatgpt.com/c/abc" };
  // No receiver at first, then the new page answers.
  tabAnswer = (call: number) =>
    call === 1 ? new Error("Could not establish connection. Receiving end does not exist.") : { target: "page-health", problems: [] };
  await show();
  await view().findByRole("region", { name: "Requests and tools" });
  await waitFor(() => assert.equal(asked.length, 2));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(document.querySelector(".pp-problem"), null);
  cleanup();
  asked.length = 0;
  tabAnswer = new Error("Frame with ID 0 was removed.");
  await show();
  await view().findByRole("region", { name: "Requests and tools" });
  await waitFor(() => assert.equal(asked.length, 1));
  // Past the retry pause: another error is not retried and shows nothing.
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(asked.length, 1);
  assert.equal(document.querySelector(".pp-problem"), null, "only a missing receiver means no tracker");
});

test("first run with an AI tab opened before the tracker asks to reload it", async () => {
  activeTab = { id: 9, url: "https://claude.ai/new" };
  tabAnswer = new Error("Could not establish connection. Receiving end does not exist.");
  await show({ dashboard: { empty: true } });
  await view().findByRole("heading", { name: "Ready when you are" });
  const text = await view().findByText("Reload your open Claude tab to start tracking it.");
  const notice = text.closest(".pp-problem")!;
  assert.equal(notice.parentElement!.lastElementChild, notice, "at the bottom");
  await user().click(view().getByRole("button", { name: "Reload tab" }));
  await waitFor(() => assert.deepEqual(reloaded, [9]));
});

test("saved problems alone never show a notice: only the open tab's own answer does", async () => {
  const saved = { dashboard: { health: [{ code: "capture_hook_missing" }, { code: "protocol_unsupported" }] } };
  activeTab = { id: 7, url: "https://chatgpt.com/c/abc" };
  await show(saved);
  await view().findByRole("region", { name: "Requests and tools" });
  await waitFor(() => assert.equal(asked.length, 1));
  assert.equal(document.querySelector(".pp-problem"), null, "the tab answered that capture works");
  cleanup();
  activeTab = null;
  await show(saved);
  await view().findByRole("region", { name: "Requests and tools" });
  assert.equal(document.querySelector(".pp-problem"), null, "no AI tab is open");
  cleanup();
  activeTab = { id: 7, url: "https://chatgpt.com/c/abc" };
  tabAnswer = undefined;
  await show(saved);
  await view().findByRole("region", { name: "Requests and tools" });
  await waitFor(() => assert.equal(asked.length, 2));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(document.querySelector(".pp-problem"), null, "an answer it cannot read is not a problem");
  cleanup();
  tabAnswer = { target: "footprint-display" };
  await show(saved);
  await view().findByRole("region", { name: "Requests and tools" });
  await waitFor(() => assert.equal(asked.length, 3));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(document.querySelector(".pp-problem"), null, "an answer to another question is not a problem");
});

test("a tab that is still loading or has no site access is not asked and shows nothing", async () => {
  activeTab = { id: 7, url: "https://chatgpt.com/c/abc" };
  tabAnswer = new Error("Receiving end does not exist.");
  tabStatus = "loading";
  await show();
  await view().findByRole("region", { name: "Requests and tools" });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(document.querySelector(".pp-problem"), null);
  cleanup();
  tabStatus = "complete";
  siteAccess = false;
  await show();
  await view().findByRole("region", { name: "Requests and tools" });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(document.querySelector(".pp-problem"), null);
  assert.deepEqual(asked, []);
});

test("organization view shows the 30 day total, people and your share", async () => {
  const calls = await show({ dashboard: { mode: "company" } }, undefined, { "ui:popup": { scope: "org" } }, true);
  await view().findByText("34 people");
  assert.match(hero().textContent ?? "", /Example Consulting · last 30 days/);
  assert.match(hero().textContent ?? "", /31.6/);
  assert.match(view().getByRole("region", { name: "Your share" }).textContent ?? "", /3%/);
  assert.equal(view().queryByRole("group", { name: "Period" }), null, "the organization view always covers 30 days");
  // Each window is read twice: the saved copy (cached=only, none here) and the fresh answer.
  const company = calls.filter((c) => c.action === "company-summary" && !String(c.payload!.query).includes("cached=only"));
  assert.equal(company.length, 2, "current and previous 30 days");
  const saved = calls.filter((c) => c.action === "company-summary" && String(c.payload!.query).includes("cached=only"));
  assert.deepEqual(
    saved.map((c) => String(c.payload!.query).replace(/&?cached=only/, "")),
    company.map((c) => String(c.payload!.query)),
    "the saved copies are asked for exactly the fresh queries",
  );
  // The popup reads totals only, so neither asks for the organization splits (15 Oct 2026).
  for (const call of company) assert.match(String(call.payload!.query), /[?&]splits=none(&|$)/);
  assert.ok(view().getByText(/Synced 3 min ago/));
});

test("the Me view stops updating once its figures are final, while the organization summary still loads", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const scenario: Scenario = { dashboard: { mode: "company" } };
  const base = fakeTransport(scenario);
  let asking = false;
  const transport: Transport = async (action, payload) => {
    if (action === "company-summary") {
      asking = true;
      await held;
    }
    return base(action, payload);
  };
  await show(scenario, transport);
  await view().findByRole("group", { name: "Period" });
  await waitFor(() => assert.ok(asking));
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.doesNotMatch(footStatus(), /Updating/);
  assert.match(view().getByText(/Up to date/).textContent ?? "", /1 min ago/);
  assert.ok(periodButtons().every((button) => !button.disabled), "the period buttons can be used again");
  release();
  await user().click(view().getByRole("button", { name: "Organization" }));
  await view().findByText("34 people");
});

test("organization figures show before the person's own share arrives (15 October 2026)", async () => {
  // Live, the person's summary took 6 to 20 s while the organization totals took under 2 s, and
  // the Organization view waited for both.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const scenario: Scenario = { dashboard: { mode: "company" } };
  const base = fakeTransport(scenario);
  const transport: Transport = async (action, payload) => {
    if (action === "my-summary") await held;
    return base(action, payload);
  };
  await show(scenario, transport, { "ui:popup": { scope: "org" } }, true);
  await view().findByText("34 people");
  assert.match(hero().textContent ?? "", /31.6/);
  // A plain selector: a role query that finds nothing walks the whole popup and takes minutes.
  const share = () => document.body.querySelector('section[aria-label="Your share"]')?.textContent ?? "";
  // While the person's summary is read, the share says so instead of Unknown.
  assert.match(share(), /Your shareLoading/);
  assert.doesNotMatch(share(), /Unknown|%/);
  release();
  await waitFor(() => assert.match(share(), /3%/));
});

test("the saved share shows with an Updating note until the person's fresh summary arrives (16 October 2026)", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const scenario: Scenario = { dashboard: { mode: "company" }, orgCached: { ageMs: 2 * 3_600_000 }, myCached: true };
  const base = fakeTransport(scenario);
  const transport: Transport = async (action, payload) => {
    if (action === "my-summary" && !String(payload?.query).includes("cached=only")) await held;
    return base(action, payload);
  };
  await show(scenario, transport, {}, true);
  await view().findByText("34 people");
  const share = () => document.body.querySelector('section[aria-label="Your share"]')?.textContent ?? "";
  await waitFor(() => assert.match(share(), /^Your share · Updating.*3%/));
  release();
  await waitFor(() => assert.doesNotMatch(share(), /Updating/));
  assert.match(share(), /3%/);
});

test("organization offline shows the snapshot, your own figures and Try again runs a sync", async () => {
  const calls = await show({ dashboard: { mode: "company", queueCount: 12 }, orgOffline: true }, undefined, { "ui:popup": { scope: "org" } }, true);
  await view().findByText("Organization server unreachable");
  assert.ok(view().getByText(/^Snapshot /));
  assert.ok(view().getByText("You, from this browser, up to date"));
  assert.ok(view().getByText("12 waiting to sync"));
  await user().click(view().getByRole("button", { name: /Try again/ }));
  await waitFor(() => assert.ok(calls.some((c) => c.action === "sync")));
});

test("cached organization figures from a reachable server are not called unreachable", async () => {
  // A server that answered with an error (for example 409 while it recalculates) is reachable.
  await show({ dashboard: { mode: "company", queueCount: 2 }, orgStale: true }, undefined, { "ui:popup": { scope: "org" } }, true);
  await view().findByText("Organization figures not refreshed");
  assert.equal(view().queryByText("Organization server unreachable"), null);
  assert.ok(view().getByText(/^Snapshot /));
  assert.ok(view().getByText("2 waiting to sync"));
});

test("organization figures that fail to load say so without hiding the switch back to Me", async () => {
  await show({ dashboard: { mode: "company", queueCount: 3 }, orgFails: true }, undefined, { "ui:popup": { scope: "org" } }, true);
  await view().findByText("Organization figures are unavailable");
  assert.ok(view().getByText("3 waiting to sync"));
  await user().click(view().getByRole("button", { name: "Me" }));
  await view().findByRole("group", { name: "Period" });
});

/** A transport whose fresh organization answers wait for `release`; saved copies answer at once. */
function heldOrganization(scenario: Scenario, outcome: "answer" | "fail" = "answer") {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const base = fakeTransport(scenario);
  const transport: Transport = async (action, payload) => {
    if (action === "company-summary" && !String(payload?.query).includes("cached=only")) {
      await held;
      if (outcome === "fail") throw new Error("organization_unavailable");
    }
    return base(action, payload);
  };
  return { transport, release: () => release() };
}
const SAVED = { ageMs: 2 * 3_600_000, kwh: 20.5, previousKwh: 20 };

test("saved organization figures show at once with their age, and the fresh answer replaces them", async () => {
  const scenario: Scenario = { dashboard: { mode: "company" }, orgCached: SAVED };
  const { transport, release } = heldOrganization(scenario);
  await show(scenario, transport, {}, true);
  await view().findByText("Updated 2 h ago");
  assert.match(hero().textContent ?? "", /20\.5/);
  assert.ok(view().getByText("Updating"), "the footer says the figures are being updated");
  // Being refreshed is not a failed refresh.
  assert.equal(view().queryByText(/not refreshed|unreachable/), null);
  assert.equal(view().queryByText(/^Snapshot /), null);
  release();
  await view().findByText("34 people");
  assert.match(hero().textContent ?? "", /31\.6/);
  assert.equal(view().queryByText(/^Updated /), null, "fresh figures carry no age note");
  assert.ok(view().getByText(/Synced 3 min ago/));
});

test("a saved organization copy goes when the fresh answer fails", async () => {
  const scenario: Scenario = { dashboard: { mode: "company", queueCount: 3 }, orgCached: SAVED };
  const { transport, release } = heldOrganization(scenario, "fail");
  await show(scenario, transport, {}, true);
  await view().findByText("Updated 2 h ago");
  release();
  await view().findByText("Organization figures are unavailable");
  assert.equal(view().queryByText(/^Updated /), null);
  assert.doesNotMatch(document.body.textContent ?? "", /20\.5/);
});

test("a saved organization copy from another data scope is never shown", async () => {
  // For example a copy read just before an erasure or a reconnection changed the scope.
  const scenario: Scenario = { dashboard: { mode: "company" }, orgCached: { ...SAVED, scopeToken: "b".repeat(64) } };
  const { transport, release } = heldOrganization(scenario);
  await show(scenario, transport, {}, true);
  // Both saved copies were read (the held fresh reads are recorded only once released).
  await waitFor(() => assert.equal(scenario.calls!.filter((c) => c.action === "company-summary").length, 2));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(view().getByText("Loading organization figures"));
  assert.equal(view().queryByText(/^Updated /), null);
  release();
  await view().findByText("34 people");
});

test("a verified connection names the organization and waits for the person, without polling", async () => {
  const scenario: Scenario = { dashboard: { pending: "verified" } };
  const calls = await show(scenario, undefined, { "ui:popup": { scope: "org" } }, true);
  await view().findByRole("heading", { name: "Connect to Example Consulting?" });
  assert.ok(view().getByText("Example Consulting"));
  const before = calls.length;
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(calls.length, before);
});

test("a connected organization shows the name its server gave, also without its own address", async () => {
  const scenario: Scenario = { dashboard: { mode: "company" } };
  const base = fakeTransport(scenario);
  const transport: Transport = async (action, payload) => {
    const value = await base(action, payload);
    if (action !== "dashboard") return value;
    return { ...(value as object), company: { ...(value as { company: object }).company, company_name: "Fern & Partners" } };
  };
  await show(scenario, transport, { "ui:popup": { scope: "org" } }, true);
  await view().findByText("34 people");
  assert.match(hero().textContent ?? "", /Fern & Partners · last 30 days/);
});

test("fixtures use the shared scope token", () => {
  assert.match(SCOPE, /^[a-f0-9]{64}$/);
});

// The popup before the person agreed (canvas PopupNew, owner decisions of 17 and 18 Oct 2026).
test("before the person agrees the popup asks for the agreement instead of showing figures", async () => {
  const scenario: Scenario = { dashboard: { consent: false } };
  const calls = await show(scenario);
  const local = await view().findByRole("region", { name: "Runs on your computer" });
  assert.match(local.textContent!, /Everything is calculated in this browser\. Nothing is sent to us\. Open source\./);
  assert.ok(local.classList.contains("lg-local"));
  assert.ok(view().getByText("Nothing is counted until you agree."));
  assert.match(document.body.textContent!, /Keeps numbers only\. The text is discarded after counting\./);
  assert.equal(view().queryByRole("group", { name: "Show usage for" }), null, "no figures and no Me or Organization switch");
  const history = view().getByRole("checkbox", { name: "Load full chat history automatically" }) as HTMLInputElement;
  assert.equal(history.checked, true, "on by default");
  await user().click(history);
  await user().click(view().getByRole("button", { name: "How it works in detail" }));
  assert.deepEqual(opened, ["chrome-extension://aift/welcome.html"]);
  await user().click(view().getByRole("button", { name: "Agree and start" }));
  await waitFor(() => assert.equal(view().queryByRole("region", { name: "Runs on your computer" }), null));
  assert.deepEqual(calls.find((c) => c.action === "consent")!.payload, { agreed: true, version: "2026-10-18", ownRead: false });
  await view().findByRole("group", { name: "Show usage for" });
});
