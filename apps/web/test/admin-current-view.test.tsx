// Organization current-method design, test 18 (23 Nov 2026): the admin pages ask summaries and
// activity in the server's newest method, and the export starts on the server's default method.
import assert from "node:assert/strict";
import test, { afterEach, before } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import "./async-timeout";
import { AdminExports, AdminRequests } from "../src/admin-pages";
import { AdminActivity } from "../src/admin/AdminActivity";
import { AdminOverview } from "../src/admin/AdminOverview";

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

const view = (path: string) => new URL(path, "https://x.invalid").searchParams.get("calculation_view");

function recordingApi() {
  const paths: string[] = [];
  const api = {
    get: async (path: string) => {
      paths.push(path);
      if (path === "/v1/config") return { timezone: "Europe/Berlin" };
      if (path.startsWith("/v1/admin/summary") || path.startsWith("/v1/admin/activity"))
        return { aggregate_status: "current", request_count: "1" };
      if (path.startsWith("/v1/admin/users?") || path.startsWith("/v1/admin/requests") || path.startsWith("/v1/admin/breakdown"))
        return { items: [], next_cursor: null };
      if (path.startsWith("/v1/admin/people")) return null;
      if (path === "/v1/admin/health")
        return { browsers_connected: 0, browsers_synced_last_day: 0, browsers_not_synced_3_days: 0, problems: [] };
      if (path === "/v1/methods")
        return {
          default_method_id: "ecologits-newest",
          methods: [{ method_id: "ecologits-older" }, { method_id: "ecologits-newest" }],
        };
      throw new Error(`unexpected GET ${path}`);
    },
  } as any;
  return { api, paths };
}

test("the overview, activity and requests pages ask summaries in the current view", async () => {
  for (const [name, page] of [
    ["overview", (api: any) => <AdminOverview api={api} navigate={() => {}} />],
    ["activity", (api: any) => <AdminActivity api={api} />],
    ["requests", (api: any) => <AdminRequests api={api} />],
  ] as const) {
    const { api, paths } = recordingApi();
    render(page(api));
    const figures = () => paths.filter((path) => /^\/v1\/admin\/(summary|activity)/.test(path));
    await waitFor(() => assert.ok(figures().length > 0, name));
    await new Promise((resolve) => setTimeout(resolve, 50));
    for (const path of figures()) assert.equal(view(path), "current", `${name}: ${path}`);
    assert.equal(figures().some((path) => path.includes("method_id")), false, name);
    // Endpoints that do not know the view are asked as before.
    for (const path of paths.filter((path) => /^\/v1\/admin\/(people|requests|breakdown)/.test(path)))
      assert.equal(view(path), null, `${name}: ${path}`);
    cleanup();
  }
});

test("the export starts on the completed recalculation with the server's default method", async () => {
  const { api } = recordingApi();
  const page = render(<AdminExports api={api} />);
  await waitFor(() => {
    const method = page.container.querySelector<HTMLSelectElement>('select[name="method_id"]');
    assert.ok(method);
    assert.equal(method.value, "ecologits-newest");
  });
  const choice = page.getByLabelText("Calculation view") as HTMLSelectElement;
  assert.equal(choice.value, "recalculated");
  assert.ok([...choice.options].some((option) => option.value === "original"), "the original view stays a choice");
});
