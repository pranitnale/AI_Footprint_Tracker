import assert from "node:assert/strict";
import test, { afterEach, before } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import { cleanup, render, waitFor, within } from "@testing-library/react";
import "./async-timeout";
import { AdminRequests } from "../src/admin-pages";
import { AdminPersonNamed } from "../src/admin/AdminPeopleNamed";

/*
 * With person analytics switched on, every per-person figure counts from the first full day after
 * the switch (person_analytics_since), while the organization's figures cover the whole period.
 * Before 19 October 2026 the pages did not say so: a member's share compared their days with the
 * organization's whole period, and the request list said "Showing 15 of 254" when it could list 61.
 */
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://tenant.example/admin/people" });
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

const MEMBER = "11111111-2222-4333-8444-555555555555";
const SUMMARY = {
  aggregate_status: "current",
  suppressed: false,
  request_count: "3",
  attempt_count: "3",
  active_users: "1",
  tokens: [],
  resources: [],
  history: { status: "empty", prompt_count: "0", tokens: [], resources: [] },
};
const dayIn = (instant: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant));

function floorApi(since: string) {
  const paths: string[] = [];
  const api = {
    get: async (path: string) => {
      paths.push(path);
      if (path === "/v1/config") return { timezone: "Europe/Berlin", features: { person_analytics: true, ip_collection: false } };
      if (path.startsWith("/v1/admin/users?"))
        return {
          items: [{ user_id: MEMBER, email: "pat@example.test", role: "user", status: "active", installations: 1, membership_version: 1 }],
          next_cursor: null,
        };
      if (path.startsWith(`/v1/admin/users/${MEMBER}/devices`)) return { items: [] };
      if (path.startsWith("/v1/admin/summary") && path.includes("user_id=")) return { ...SUMMARY, person_analytics_since: since };
      if (path.startsWith("/v1/admin/summary")) return SUMMARY;
      if (path === "/v1/admin/health") return { browsers_connected: 1, browsers_synced_last_day: 1, browsers_not_synced_3_days: 0, problems: [], items: [], browsers: [] };
      if (path.startsWith("/v1/admin/requests")) return { items: [], next_cursor: null, person_analytics_since: since };
      throw new Error(`unexpected GET ${path}`);
    },
  } as any;
  return { api, paths };
}

test("a member's page says from which day their figures count, and compares their share over the same days", async () => {
  const since = new Date(Date.now() - 5 * 86_400_000).toISOString();
  const { api, paths } = floorApi(since);
  const view = render(<AdminPersonNamed api={api} navigate={() => {}} userId={MEMBER} />);
  await view.findByRole("note");
  assert.match(view.getByRole("note").textContent ?? "", /Figures per person count from .* Earlier usage counts only in the organization's figures/);
  // The organization's totals for the share start on the same day as the person's figures.
  await waitFor(() =>
    assert.ok(paths.some((path) => path.startsWith("/v1/admin/summary") && !path.includes("user_id=") && path.includes(`start=${dayIn(since)}`)), paths.join(" | ")),
  );
});

test("no note while person analytics was on before the period started", async () => {
  const { api } = floorApi("2000-01-01T00:00:00.000Z");
  const view = render(<AdminPersonNamed api={api} navigate={() => {}} userId={MEMBER} />);
  await view.findByText("Requests seen live");
  assert.equal(view.queryByRole("note"), null);
});

test("the request list says from which day it lists and does not compare its rows with the period's total", async () => {
  const since = new Date(Date.now() - 5 * 86_400_000).toISOString();
  const { api } = floorApi(since);
  const view = render(<AdminRequests api={api} />);
  const note = await view.findByRole("note");
  assert.match(note.textContent ?? "", /Figures per person count from/);
  const list = await view.findByRole("region", { name: "Recorded requests" });
  await within(list).findByText(/^Showing 0 requests seen live/);
  assert.doesNotMatch(list.textContent ?? "", / of 3 requests/);
});
