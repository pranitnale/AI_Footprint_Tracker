// How many requests the admin pages send while loading (15 October 2026): one summary per need,
// totals-only summaries without their splits, and the organization settings once per session.
import assert from "node:assert/strict";
import test, { afterEach, before } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import "./async-timeout";
import { AdminTools } from "../src/admin-pages";
import { AdminActivity } from "../src/admin/AdminActivity";
import { AdminOverview } from "../src/admin/AdminOverview";
import { AdminPeople, AdminPerson } from "../src/admin/AdminPeople";
import { ApiError, companyConfig, forgetCompanyConfig, summaryTotals } from "../src/api";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://tenant.example/admin",
});
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
    FormData: dom.window.FormData,
    addEventListener: dom.window.addEventListener.bind(dom.window),
    removeEventListener: dom.window.removeEventListener.bind(dom.window),
  });
  Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    attachEvent: { value: () => {} },
    detachEvent: { value: () => {} },
  });
});
afterEach(() => {
  cleanup();
  dom.window.document.body.innerHTML = "";
});

const MEMBER_ID = "11111111-2222-4333-8444-555555555555";
const summaryCalls = (paths: string[]) => paths.filter((path) => path.startsWith("/v1/admin/summary"));
const totalsOnly = (path: string) => new URL(path, "https://x.invalid").searchParams.get("splits") === "none";

/** A read-only admin API stub that records every GET path. */
function recordingApi(extra: (path: string) => unknown = () => undefined) {
  const paths: string[] = [];
  const api = {
    get: async (path: string) => {
      paths.push(path);
      const answer = extra(path);
      if (answer !== undefined) return answer;
      if (path === "/v1/config") return { timezone: "Europe/Berlin" };
      if (path.startsWith("/v1/admin/summary")) return { aggregate_status: "current", request_count: "1" };
      if (path.startsWith("/v1/admin/users?")) return { items: [], next_cursor: null };
      if (path.startsWith("/v1/admin/activity")) return { aggregate_status: "current", request_count: "1" };
      if (path.startsWith("/v1/admin/breakdown")) return { items: [], next_cursor: null };
      if (path.startsWith("/v1/admin/people")) return null;
      if (path === "/v1/admin/health")
        return { browsers_connected: 0, browsers_synced_last_day: 0, browsers_not_synced_3_days: 0, problems: [] };
      if (path === "/v1/methods") return { default_method_id: "m", methods: [] };
      throw new Error(`unexpected GET ${path}`);
    },
  } as any;
  return { api, paths };
}

test("the Activity page sends one activity request and reads no member", async () => {
  const { api, paths } = recordingApi();
  render(<AdminActivity api={api} />);
  await waitFor(() => assert.ok(paths.some((path) => path.startsWith("/v1/admin/activity"))));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(paths.filter((path) => path.startsWith("/v1/admin/activity")).length, 1, paths.join(" | "));
  // Organization figures only: no member list, people summary or per-person filter.
  assert.deepEqual(
    paths.filter((path) => path.startsWith("/v1/admin/users") || path.startsWith("/v1/admin/people") || path.includes("user_id")),
    [],
  );
});

test("the overview reads the previous period without splits and the current one with them", async () => {
  const { api, paths } = recordingApi();
  render(<AdminOverview api={api} navigate={() => {}} />);
  await waitFor(() => assert.equal(summaryCalls(paths).length, 2));
  const [full, previous] = [summaryCalls(paths).find((p) => !totalsOnly(p))!, summaryCalls(paths).find(totalsOnly)!];
  assert.ok(full && previous, summaryCalls(paths).join(" | "));
  const start = (path: string) => new URL(path, "https://x.invalid").searchParams.get("start") ?? "";
  assert.ok(start(previous) < start(full), "the totals-only summary is the earlier period");
});

test("a member's page reads the member list and browsers but no usage", async () => {
  const { api, paths } = recordingApi((path) =>
    path === `/v1/admin/users/${MEMBER_ID}/devices`
      ? { items: [] }
      : path.startsWith("/v1/admin/users?")
        ? {
            items: [{ user_id: MEMBER_ID, email: "pat@example.test", role: "user", status: "active", membership_version: 1, installations: 0 }],
            next_cursor: null,
          }
        : undefined,
  );
  render(<AdminPerson api={api} navigate={() => {}} userId={MEMBER_ID} />);
  await waitFor(() => assert.ok(paths.includes(`/v1/admin/users/${MEMBER_ID}/devices`)));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(
    paths.filter((path) => /^\/v1\/admin\/(summary|activity|people|health)/.test(path)),
    [],
    paths.join(" | "),
  );
});

test("the member list is read in pages of 200", async () => {
  const { api, paths } = recordingApi();
  render(<AdminPeople api={api} navigate={() => {}} onPrivilegeLost={() => {}} />);
  await waitFor(() => assert.ok(paths.some((path) => path.startsWith("/v1/admin/users?"))));
  const users = paths.filter((path) => path.startsWith("/v1/admin/users?"));
  assert.ok(users.every((path) => new URL(path, "https://x.invalid").searchParams.get("limit") === "200"), users.join(" | "));
});

test("the organization settings are read once per session, also on a page that needs them twice", async () => {
  const { api, paths } = recordingApi();
  render(<AdminTools api={api} />);
  // The page's own filters and the model list inside it both need the time zone.
  await waitFor(() => assert.ok(summaryCalls(paths).length >= 1));
  await waitFor(() => assert.ok(paths.some((path) => path.startsWith("/v1/admin/breakdown"))));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(paths.filter((path) => path === "/v1/config").length, 1);
  cleanup();
  render(<AdminActivity api={api} />);
  await waitFor(() => assert.ok(paths.some((path) => path.startsWith("/v1/admin/activity"))));
  assert.equal(paths.filter((path) => path === "/v1/config").length, 1, "the next page reuses it");
  // Sign-out, a role change or a policy save forget it; a failed read is not kept.
  forgetCompanyConfig(api);
  await companyConfig(api);
  assert.equal(paths.filter((path) => path === "/v1/config").length, 2);
  let fail = true;
  const flaky = {
    get: async () => {
      if (fail) throw new Error("offline");
      return { timezone: "UTC" };
    },
  } as any;
  await assert.rejects(companyConfig(flaky));
  fail = false;
  assert.deepEqual(await companyConfig(flaky), { timezone: "UTC" });
});

test("the signed-in website reads the organization settings once across admin pages", async () => {
  dom.window.history.replaceState({}, "", "/admin/activity");
  const requested: string[] = [];
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    requested.push(url.pathname);
    if (url.pathname === "/v1/auth/session")
      return json({
        role: "admin",
        user_id: "user-1",
        company_id: "company-1",
        company_name: "Example Company",
        csrf_token: "csrf",
        expires_at: "2099-01-01T00:00:00.000Z",
      });
    if (url.pathname === "/v1/config") return json({ timezone: "Europe/Berlin" });
    if (url.pathname === "/v1/admin/summary" || url.pathname === "/v1/admin/activity")
      return json({ aggregate_status: "current", request_count: "1" });
    if (url.pathname === "/v1/methods") return json({ default_method_id: "m", methods: [] });
    return json({ items: [], next_cursor: null });
  }) as typeof fetch;
  const { default: App } = await import("../src/app");
  render(<App />);
  await waitFor(() => assert.ok(requested.includes("/v1/admin/activity")));
  // Another page, which needs the time zone twice, reads the session again but not the settings.
  dom.window.history.pushState({}, "", "/admin/tools");
  dom.window.dispatchEvent(new dom.window.PopStateEvent("popstate"));
  await waitFor(() => assert.ok(requested.includes("/v1/admin/breakdown")));
  await waitFor(() => assert.equal(requested.filter((path) => path === "/v1/auth/session").length, 2));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(requested.filter((path) => path === "/v1/config").length, 1, requested.join(" "));
});

test("a server that refuses splits=none is asked once more in full and not asked with it again", async () => {
  const paths: string[] = [];
  const api = {
    get: async (path: string) => {
      paths.push(path);
      if (path.includes("splits=none"))
        throw new ApiError({ code: "unsupported_filter", retryable: false, safe_message: "No.", status: 422 });
      return { aggregate_status: "current", request_count: "4" };
    },
  } as any;
  assert.deepEqual(await summaryTotals(api, "/v1/admin/summary?period=month"), { aggregate_status: "current", request_count: "4" });
  assert.deepEqual(paths, ["/v1/admin/summary?period=month&splits=none", "/v1/admin/summary?period=month"]);
  paths.length = 0;
  await summaryTotals(api, "/v1/admin/summary?period=week");
  assert.deepEqual(paths, ["/v1/admin/summary?period=week"]);
  // Any other refusal reaches the page unchanged.
  const refusing = {
    get: async () => {
      throw new ApiError({ code: "invalid_period", retryable: false, safe_message: "No.", status: 422 });
    },
  } as any;
  await assert.rejects(summaryTotals(refusing, "/v1/admin/summary?period=x"), /No\./);
});
