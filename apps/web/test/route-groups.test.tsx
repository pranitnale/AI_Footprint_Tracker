// The website's route groups (15 October 2026): each group is its own download, every address the
// proxy serves still renders its page, and a group whose code cannot be downloaded offers a reload.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { afterEach, before } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import "./async-timeout";
import App from "../src/app";
import { RouteGroup, RouteLoadError, lazyPage, routeChunk } from "../src/lazy-routes";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://tenant.example/" });
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
  // jsdom has no layout; the pages only scroll to the top.
  dom.window.scrollTo = () => {};
});
afterEach(() => {
  cleanup();
  dom.window.document.body.innerHTML = "";
});

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const MEMBER_ID = "11111111-2222-4333-8444-555555555555";

/**
 * Every module the website entry loads before any route group, following static imports and
 * re-exports (type-only ones are erased by the build) but not import() calls.
 */
function entryGraph() {
  const files = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/^\s*(?:import|export)\s+(type\s+)?(?:[^;'"]*?\sfrom\s+)?["']([^"']+)["']/gm)) {
      if (match[1]) continue;
      const specifier = match[2]!;
      if (!specifier.startsWith(".")) {
        packages.add(specifier);
        continue;
      }
      const base = resolve(dirname(file), specifier);
      const target = [base, `${base}.ts`, `${base}.tsx`, resolve(base, "index.ts"), resolve(base, "index.tsx")].find(
        (candidate) => existsSync(candidate) && /\.(ts|tsx)$/.test(candidate),
      );
      if (target) visit(target);
    }
  };
  visit(resolve(SRC, "main.tsx"));
  return { files: [...files].map((file) => file.slice(SRC.length + 1).replace(/\\/g, "/")), packages };
}

test("the website entry does not load the dashboards, the developer panel or the methodology", () => {
  const { files, packages } = entryGraph();
  assert.ok(files.includes("app.tsx") && files.includes("site/pages/WebHome.tsx"), files.join(" "));
  for (const group of [
    "admin-app.tsx",
    "admin-pages.tsx",
    "admin/AdminOverview.tsx",
    "operator-app.tsx",
    "operator-pages.tsx",
    "components.tsx",
    "auth-pages.tsx",
    "methodology-pages.ts",
    "public-pages.tsx",
    "generated/methodology.ts",
    "site/pages/WebPrivacyPolicy.tsx",
  ])
    assert.ok(!files.includes(group), `${group} is loaded with the entry`);
  assert.ok(!packages.has("@footprint/ui/methodology"), "the methodology components are loaded with the entry");
});

test("the admin dashboard does not load the developer panel", () => {
  const source = readFileSync(resolve(SRC, "admin-app.tsx"), "utf8");
  assert.doesNotMatch(source, /operator-(pages|app)/);
  for (const file of ["admin-pages.tsx", "admin/AdminOverview.tsx", "admin/AdminPeople.tsx", "admin/AdminModels.tsx"])
    assert.doesNotMatch(readFileSync(resolve(SRC, file), "utf8"), /from "\.\.?\/operator-/, file);
});

/** The addresses the proxy serves the website for (deploy/proxy/default.conf.template). */
const PUBLIC = [
  "/",
  "/methodology",
  "/methodology/ecologits",
  "/methodology/reference",
  "/privacy",
  "/privacy-policy",
  "/terms",
  "/dpa",
  "/imprint",
  "/contact",
  "/open-source",
  "/download",
  "/downloads",
  "/teams",
  "/self-host",
];
const AUTH = ["/register", "/login", "/operator/login"];
const ADMIN = [
  "/admin",
  "/admin/people",
  `/admin/people/${MEMBER_ID}`,
  "/admin/users",
  "/admin/usage",
  "/admin/tools",
  "/admin/activity",
  // Activity while person analytics is off, Requests while it is on (admin/features.ts). Network
  // exists only with both switches on, so it is not in this list (admin-website.test.tsx).
  "/admin/requests",
  "/admin/health",
  "/admin/policies",
  "/admin/exports",
  "/admin/audit",
  "/admin/deletions",
  "/admin/plan",
];
const OPERATOR = ["/operator", "/operator/contacts", "/operator/plans", "/operator/exceptions", "/operator/health"];

test("the route lists here are the addresses the proxy serves the website for", () => {
  const template = readFileSync(resolve(SRC, "../../../deploy/proxy/default.conf.template"), "utf8");
  const spa = [...template.matchAll(/location ~ "?(\^\/[^"\s]*\/\?\$)"? \{/g)].map((match) => new RegExp(match[1]!));
  assert.ok(spa.length >= 2, "the proxy's page locations were not found");
  for (const path of [...PUBLIC, ...AUTH, ...ADMIN, ...OPERATOR].filter((path) => path !== "/"))
    assert.ok(spa.some((pattern) => pattern.test(path)), `${path} is not served by the proxy`);
  assert.match(template, /location = \/ \{/);
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A signed-in admin or developer; endpoints the pages need answer plainly, others answer 404. */
function signedIn(role: "admin" | "operator") {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path === "/v1/auth/session" || path === "/v1/operator/auth/session")
      return json({
        role,
        user_id: role === "admin" ? "admin-1" : null,
        company_id: role === "admin" ? "company-1" : null,
        company_name: role === "admin" ? "Example Company" : null,
        email: "admin@example.com",
        organization_status: role === "admin" ? "active" : null,
        csrf_token: "csrf",
        expires_at: "2026-10-15T18:00:00.000Z",
      });
    if (path === "/v1/config") return json({ timezone: "Europe/Berlin" });
    if (path === "/v1/admin/summary") return json({ aggregate_status: "current", request_count: "0" });
    if (path === "/v1/admin/health") return json({ browsers_connected: 1, browsers_synced_last_day: 1, browsers_not_synced_3_days: 0, problems: [] });
    if (path === "/v1/methods") return json({ default_method_id: "m", methods: [] });
    if (path === "/v1/admin/users") return json({ items: [], next_cursor: null });
    return json({ error: { code: "not_found", safe_message: "Not found in this test." } }, 404);
  }) as typeof fetch;
}

const ROUTE_FALLBACKS = ["Loading", "Loading the page", "Loading the methodology", "Loading the dashboard", "Loading the developer panel"];
const hasText = (view: ReturnType<typeof render>, selector: string, text: string) =>
  [...view.container.querySelectorAll(selector)].some((element) => element.textContent?.trim() === text);

// Every check returns a plain boolean: a failing assertion that prints a jsdom element of a long
// page (the methodology) can take the test runner's whole memory.
async function shows(path: string, check: (view: ReturnType<typeof render>) => boolean) {
  dom.window.history.replaceState({}, "", path);
  const view = render(<App />);
  await waitFor(() => {
    const loading = [...view.container.querySelectorAll(".loading > p")].map((p) => p.textContent ?? "");
    assert.ok(!loading.some((label) => ROUTE_FALLBACKS.includes(label)), `${path} is still loading its code`);
    assert.ok(check(view), `${path} did not render its page`);
  });
  assert.equal(dom.window.location.pathname, path, `${path} moved to another address`);
  assert.ok(!hasText(view, "h1", "This page does not exist."), `${path} shows Not found`);
  // A data request that fails shows a notice with the same title, so only the reload notice of a
  // route group whose code failed to download counts here.
  assert.ok(!/updated since this tab opened it/.test(view.container.textContent ?? ""), `${path} failed to load its code`);
}

test("every public page and the sign-in pages render from their route group", async () => {
  for (const path of [...PUBLIC, ...AUTH]) {
    await shows(path, (view) => view.container.querySelector("h1") !== null);
    cleanup();
  }
});

test("every admin address renders inside the dashboard, including a person's page", async () => {
  signedIn("admin");
  for (const path of ADMIN) {
    await shows(path, (view) => hasText(view, "button", "Sign out") && !hasText(view, "h1", "Admin page not found"));
    cleanup();
  }
});

test("every developer panel address renders inside the panel", async () => {
  signedIn("operator");
  for (const path of OPERATOR) {
    await shows(path, (view) => hasText(view, "button", "Sign out") && !hasText(view, "h1", "Operator page not found"));
    cleanup();
  }
});

test("a route group whose code cannot be downloaded offers a reload instead of a blank page", async () => {
  let attempts = 0;
  const load = routeChunk<{ Page: () => React.ReactElement }>(() => {
    attempts++;
    return Promise.reject(new TypeError("Failed to fetch dynamically imported module"));
  });
  const Page = lazyPage(load, "Page");
  const view = render(
    <RouteGroup label="Loading the page">
      <Page />
    </RouteGroup>,
  );
  assert.ok(view.getByText("Loading the page"), "the usual loading state shows while the code downloads");
  const reload = await view.findByRole("button", { name: "Reload page" });
  assert.ok(reload);
  assert.ok(view.getByText("This page could not be loaded"));
  assert.match(view.container.textContent ?? "", /updated since this tab opened it/);
  // App starts the same download while it checks the session; both share one request.
  await assert.rejects(load(), RouteLoadError);
  assert.equal(attempts, 1);
});

test("an ordinary render error is not reported as a download problem", async () => {
  const load = routeChunk(async () => ({
    Page: () => {
      throw new Error("broken page");
    },
  }));
  const Page = lazyPage(load, "Page");
  const quiet = console.error;
  console.error = () => {};
  try {
    const caught: unknown[] = [];
    class Outer extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
      state = { failed: false };
      static getDerivedStateFromError() {
        return { failed: true };
      }
      componentDidCatch(error: unknown) {
        caught.push(error);
      }
      render() {
        return this.state.failed ? <p>outer</p> : this.props.children;
      }
    }
    const view = render(
      <Outer>
        <RouteGroup label="Loading the page">
          <Page />
        </RouteGroup>
      </Outer>,
    );
    await view.findByText("outer");
    assert.equal(view.queryByRole("button", { name: "Reload page" }), null);
    assert.match(String(caught[0]), /broken page/);
  } finally {
    console.error = quiet;
  }
});
