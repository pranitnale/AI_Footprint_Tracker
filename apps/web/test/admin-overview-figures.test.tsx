import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { afterEach, before } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import { cleanup, render, waitFor, within } from "@testing-library/react";
import "./async-timeout";
import { sumFixed } from "@footprint/ui/totals";
import { AdminActivity, activityRows } from "../src/admin/AdminActivity";
import { AdminOverview, NO_MODEL_REQUEST } from "../src/admin/AdminOverview";
import { AdminModels, estimationKind } from "../src/admin/AdminModels";
import { adminFigures, baseParts, baseValue, modelName, type AdminSummary } from "../src/admin/figures";

/*
 * The organization overview of production on 14 October 2026, rebuilt by the server test
 * apps/server/tests/test_admin_overview_figures.py: one member, one browser updated during the
 * month, so live records and saved replies were estimated with two EcoLogits releases that differ
 * only in their model mappings, and saved chats that partly overlap the live records. The fixture
 * keeps that summary's numbers and method identities; expand() gives them back the server's shape.
 * Before the fix every electricity, carbon and water figure here was "Not available".
 */
type Row = [kind: "live" | "saved", release: string, quantity: string, unit: string, value: string, low: string, high: string, profile: string | null];
type Part = {
  request_count: string;
  attempt_count: string;
  active_users?: string;
  active_installations?: string;
  mixed_methods?: boolean;
  method_groups?: string[];
  site?: string;
  history: Record<string, string | boolean>;
  rows: Row[];
  sites?: Record<string, Part>;
  days?: Record<string, Part>;
  models?: Record<string, Part>;
};
const fixture = JSON.parse(readFileSync(new URL("./fixtures/admin-overview-mixed-releases.json", import.meta.url), "utf8")) as {
  range_start: string;
  range_end: string;
  releases: Record<string, { requested_method: Record<string, unknown>; effective_method: Record<string, unknown> }>;
  comparability: Record<string, unknown>;
  summary: Part;
};

function expand(part: Part, releases = fixture.releases): AdminSummary {
  const live: unknown[] = [];
  const saved: unknown[] = [];
  for (const [kind, release, quantity, unit, value, low, high, profile] of part.rows) {
    const methods = releases[release]!;
    const lineage = {
      ...methods,
      comparability: { ...fixture.comparability, tokenizer_profile_id: "o200k-base-4.0.0-reference" },
      method_id: methods.requested_method.method_id,
      method_hash: methods.requested_method.method_hash,
      selected_profile_id: profile,
    };
    const common = { quantity, unit, value, scenario_low: low, scenario_high: high, value_kind: "midpoint_sum", interval_kind: null };
    if (kind === "live")
      live.push({
        ...common,
        scope: "modeled_text_component",
        method_group: { ...lineage, interval_kind: "upstream_approximation" },
        applicable_count: 1,
        unknown_count: 0,
        partial_count: 1,
        unvalidated_count: 1,
        contributing_attempt_count: 1,
      });
    else
      saved.push({
        ...common,
        ...lineage,
        scope: "historical_visible_response",
        phase: "usage",
        status: "partial_estimate",
        validation_state: "unvalidated_reference",
        known_message_count: "1",
        unknown_message_count: "0",
      });
  }
  const map = (parts?: Record<string, Part>) =>
    parts && Object.fromEntries(Object.entries(parts).map(([key, value]) => [key, expand(value, releases)]));
  return {
    aggregate_status: "current",
    suppressed: false,
    range_start: fixture.range_start,
    range_end: fixture.range_end,
    request_count: part.request_count,
    attempt_count: part.attempt_count,
    active_users: part.active_users,
    active_installations: part.active_installations,
    mixed_methods: part.mixed_methods,
    method_groups: part.method_groups,
    ...(part.site ? { site: part.site } : {}),
    tokens: [],
    resources: live,
    history: { scope: "loaded_history", tokens: [], resources: saved, ...part.history },
    sites: map(part.sites),
    days: map(part.days),
    models: map(part.models),
  } as unknown as AdminSummary;
}

/** The midpoint sum of every row of a quantity, live and saved: what the overview must show. */
function expected(part: Part, quantity: string) {
  return sumFixed(part.rows.filter((row) => row[2] === quantity).map((row) => row[4]));
}

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://tenant.example/admin" });
before(() => {
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    history: dom.window.history,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle,
  });
  Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
});
afterEach(() => {
  cleanup();
  dom.window.document.body.innerHTML = "";
});

test("releases that differ only in model mappings add into one organization figure", () => {
  const whole = fixture.summary;
  // The scenario of the production overview: two releases among live and saved rows.
  assert.equal(whole.mixed_methods, true);
  assert.equal(new Set(whole.rows.map((row) => row[1])).size, 2);
  assert.ok(whole.rows.some((row) => row[0] === "live") && whole.rows.some((row) => row[0] === "saved"));
  assert.equal(whole.history.unresolved_overlap_message_count, "6");

  const figures = adminFigures(expand(whole), "midpoint")!;
  for (const [resource, quantity] of [
    ["energy", "energy"],
    ["carbon", "carbon"],
    ["water", "water_total"],
  ] as const) {
    const figure = figures[resource];
    assert.equal(figure.multiple, false, resource);
    assert.equal(figure.mid, expected(whole, quantity), resource);
    assert.equal(figure.value, figure.mid, resource);
    assert.equal(figure.low, sumFixed(whole.rows.filter((row) => row[2] === quantity).map((row) => row[5])));
    assert.equal(figure.high, sumFixed(whole.rows.filter((row) => row[2] === quantity).map((row) => row[6])));
  }
  assert.deepEqual(figures.partial, []);
  assert.equal(figures.releases, 2);
  // Live requests plus the saved requests no live record matched; the matched copies add nothing.
  assert.equal(figures.requests, 7n);
  assert.equal(figures.approximate, true);
});

test("tool, day and model splits show figures that add up to the whole overview", () => {
  const whole = expand(fixture.summary);
  const total = baseValue(adminFigures(whole, "midpoint")!, "energy")!;
  for (const part of ["sites", "days"] as const) {
    const values = Object.values(whole[part]!).map((summary) => baseValue(adminFigures(summary, "midpoint")!, "energy"));
    assert.ok(values.every((value) => value !== null && value > 0), part);
    const sum = values.reduce((a, b) => a! + b!, 0)!;
    assert.ok(Math.abs(sum - total) < total * 1e-9, `${part}: ${sum} against ${total}`);
  }
  assert.deepEqual(Object.keys(whole.sites!).sort(), ["chatgpt", "claude"]);
  for (const [model, summary] of Object.entries(whole.models!))
    assert.notEqual(baseValue(adminFigures(summary, "midpoint")!, "energy"), null, model);
});

test("the overview shows electricity, carbon, water and every tool instead of Not available", async () => {
  const summary = expand(fixture.summary);
  const api = {
    get: async (path: string) => {
      if (path === "/v1/config") return { timezone: "Europe/Berlin" };
      if (path.startsWith("/v1/admin/summary")) return summary;
      if (path.startsWith("/v1/admin/people")) return { used: 1, members: 1, administrators: 1, capacity: 50, median_requests: "1", average_requests: "1", max_requests: "1", bins: [] };
      if (path === "/v1/admin/health") return { browsers_connected: 1, browsers_synced_last_day: 1, browsers_not_synced_3_days: 0, problems: [] };
      throw new Error(`unexpected GET ${path}`);
    },
  } as any;
  const view = render(<AdminOverview api={api} navigate={() => {}} />);
  const hero = await view.findByRole("region", { name: /^Electricity/ });
  const figures = adminFigures(summary, "midpoint")!;
  const parts = baseParts("energy", baseValue(figures, "energy"))!;
  assert.ok(within(hero).getByText(parts.number));
  assert.equal(view.queryAllByText("Not available").length, 0);
  const tools = view.getByRole("table", { name: /by tool/i });
  assert.ok(within(tools).getByText("ChatGPT") && within(tools).getByText("Claude"));
  assert.ok(view.getByText(/add estimates from 2 releases of the EcoLogits method/));
  assert.equal(view.queryByText(/largest group of estimates/), null);
  // The summary counts browsers that sent usage, which Health's connected count may exceed.
  assert.ok(view.getByText(/^\d+ browsers? with usage$/));
  assert.equal(view.queryByText(/browsers connected/), null);
});

test("a period without usage says so while browsers are connected, and asks for a first browser only when none is", async () => {
  const empty = expand({ request_count: "0", attempt_count: "0", active_users: "0", active_installations: "0", history: { status: "empty", prompt_count: "0" }, rows: [] });
  for (const [connected, title, other] of [
    [3, "No usage in this period", "Connect the first browser"],
    [0, "Connect the first browser", "No usage in this period"],
  ] as const) {
    let served = false;
    const api = {
      get: async (path: string) => {
        if (path === "/v1/config") return { timezone: "Europe/Berlin" };
        if (path.startsWith("/v1/admin/summary")) return empty;
        if (path.startsWith("/v1/admin/people")) return null;
        if (path === "/v1/admin/health") {
          served = true;
          return { browsers_connected: connected, browsers_synced_last_day: 0, browsers_not_synced_3_days: connected, problems: [] };
        }
        throw new Error(`unexpected GET ${path}`);
      },
    } as any;
    const view = render(<AdminOverview api={api} navigate={() => {}} />);
    await waitFor(() => assert.ok(served));
    await view.findByText(title);
    assert.equal(view.queryByText(other), null);
    cleanup();
  }
});

test("the Activity table counts each tool's requests without a named model, so its rows add up", async () => {
  const whole = structuredClone(fixture.summary);
  // Perplexity often names no model: its tool part has requests that no model part has.
  whole.sites!.perplexity = { ...structuredClone(whole.sites!.chatgpt!), site: undefined };
  const summary = expand(whole);
  const api = {
    get: async (path: string) => {
      if (path === "/v1/config") return { timezone: "Europe/Berlin" };
      if (path.startsWith("/v1/admin/activity")) return summary;
      throw new Error(`unexpected GET ${path}`);
    },
  } as any;
  const view = render(<AdminActivity api={api} />);
  const table = (await view.findByRole("heading", { name: "By tool and model" })).closest("section")!;
  const rests = within(table)
    .getAllByText("Earlier messages and other models")
    .map((label) => label.closest("tr")!);
  // The fixture's tools also have saved messages without a model; Perplexity has no model at all.
  const row = rests.find((item) => /Perplexity/.test(item.textContent ?? ""))!;
  assert.ok(row);
  assert.match(row.textContent ?? "", /Not counted/);
  const tools = Object.values(summary.sites!).reduce((sum, part) => sum + (baseValue(adminFigures(part, "midpoint")!, "requests") ?? 0), 0);
  const rows = activityRows(summary, "midpoint");
  assert.equal(rows.reduce((sum, item) => sum + (item.values.requests ?? 0), 0), tools);
});

test("estimates that cannot add show their largest comparable group with a note", async () => {
  // Another EcoLogits catalog (an upstream update) may not be added to the first release.
  const [first, second] = Object.keys(fixture.releases);
  const other = (method: Record<string, unknown>) => ({ ...method, catalog_hash: "f".repeat(64) });
  const releases = {
    [first!]: fixture.releases[first!]!,
    [second!]: {
      requested_method: other(fixture.releases[second!]!.requested_method),
      effective_method: other(fixture.releases[second!]!.effective_method),
    },
  };
  const summary = expand(fixture.summary, releases);
  const figures = adminFigures(summary, "midpoint")!;
  assert.deepEqual(figures.partial, ["energy", "carbon", "water"]);
  const sets = [first!, second!].map((release) =>
    sumFixed(fixture.summary.rows.filter((row) => row[2] === "energy" && row[1] === release).map((row) => row[4])),
  );
  const largest = sets.sort((a, b) => Number(b) - Number(a))[0];
  assert.equal(figures.energy.mid, largest);
  assert.equal(figures.energy.multiple, true);

  const api = {
    get: async (path: string) => {
      if (path === "/v1/config") return { timezone: "Europe/Berlin" };
      if (path.startsWith("/v1/admin/summary")) return summary;
      if (path.startsWith("/v1/admin/people")) return null;
      if (path === "/v1/admin/health") return { browsers_connected: 1, browsers_synced_last_day: 1, browsers_not_synced_3_days: 0, problems: [] };
      throw new Error(`unexpected GET ${path}`);
    },
  } as any;
  const view = render(<AdminOverview api={api} navigate={() => {}} />);
  await view.findByRole("region", { name: /^Electricity/ });
  assert.equal(view.queryAllByText("Not available").length, 0);
  assert.ok(view.getByText(/electricity, carbon, water show the largest group of estimates that add up/));
});

test("a model with electricity but no request of its own says why instead of Not available", async () => {
  // NotebookLM's notebook guides add electricity but no request (G1).
  const whole = structuredClone(fixture.summary);
  const model = Object.keys(whole.models!)[0]!;
  whole.models![model] = { ...whole.models![model]!, request_count: "0", history: { ...whole.models![model]!.history, prompt_count: "0" } };
  const api = {
    get: async (path: string) => {
      if (path === "/v1/config") return { timezone: "Europe/Berlin" };
      if (path.startsWith("/v1/admin/summary")) return expand(whole);
      if (path.startsWith("/v1/admin/people")) return null;
      if (path === "/v1/admin/health") return { browsers_connected: 1, browsers_synced_last_day: 1, browsers_not_synced_3_days: 0, problems: [] };
      throw new Error(`unexpected GET ${path}`);
    },
  } as any;
  const view = render(<AdminOverview api={api} navigate={() => {}} />);
  const cell = await view.findByText("No request");
  assert.equal(cell.getAttribute("title"), NO_MODEL_REQUEST);
});

// QA of 19 Oct 2026: a model whose only reply was stopped before any answer showed Unknown
// electricity with "Own record", while its tool had a value. A stopped reply keeps its estimate
// group with no figure, so the label must come from groups that have one.
test("a model whose replies have no estimate reads Not estimated and the page says what Unknown means", async () => {
  const summary = expand(fixture.summary);
  const luna = summary.models!["chatgpt-gpt-5-6-luna"]!;
  const stopped = {
    ...structuredClone(luna),
    request_count: "1",
    attempt_count: "1",
    resources: luna.resources!.map((series: any) => ({
      ...series,
      value: null,
      scenario_low: null,
      scenario_high: null,
      contributing_attempt_count: 0,
      unknown_count: 1,
    })),
    history: { ...luna.history, status: "empty", prompt_count: "0" },
  } as unknown as AdminSummary & { site?: string };
  summary.models!["chatgpt-gpt-5-6-terra"] = stopped;
  assert.equal(estimationKind(stopped).label, "Not estimated");
  // The fixture's groups name no profile selection, so an estimated model reads Reference estimate.
  assert.equal(estimationKind(luna).label, "Reference estimate");
  assert.notEqual(baseValue(adminFigures(summary.sites!.chatgpt, "midpoint")!, "energy"), null, "the tool has a value");
  const api = {
    get: async (path: string) => {
      if (path === "/v1/config") return { timezone: "Europe/Berlin" };
      if (path.startsWith("/v1/admin/summary")) return summary;
      throw new Error(`unexpected GET ${path}`);
    },
  } as any;
  const view = render(<AdminModels api={api} />);
  const table = (await view.findByRole("heading", { name: "All models" })).closest("section")!;
  const row = [...table.querySelectorAll("tbody tr")].find(
    (item) => item.querySelector("th")?.textContent === modelName("chatgpt-gpt-5-6-terra"),
  )!;
  assert.ok(row, "the stopped model has a row");
  assert.match(row.textContent ?? "", /Unknown/);
  assert.match(row.textContent ?? "", /Not estimated/);
  assert.doesNotMatch(row.textContent ?? "", /Reference estimate|Own record/);
  assert.match(table.textContent ?? "", /Unknown means no reply of that model has an estimate yet/);
});
