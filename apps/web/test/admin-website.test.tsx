// The way between the admin panel and the public website (owner request of 16 October 2026): the
// panel's logo opens the Overview, Main website opens the public site and stays there, the home
// page opened directly sends a signed-in administrator to the panel, and the header button names
// the organization. Checks use plain selectors and booleans: a failing assertion that prints a
// jsdom element can take the test runner's whole memory.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { afterEach, before } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import "./async-timeout";
import App from "../src/app";
import { hasAdminHint, rememberAdminSession, stayOnWebsite, staysOnWebsite } from "../src/admin-hint";
import { SiteLayout } from "../src/site/SiteLayout";

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
  dom.window.localStorage.clear();
  dom.window.sessionStorage.clear();
  dom.window.history.replaceState({}, "", "/");
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const adminSession = (company: string | null = "Example Company") =>
  json({
    role: "admin",
    user_id: "admin-1",
    company_id: "company-1",
    company_name: company,
    email: "admin@example.com",
    organization_status: "active",
    csrf_token: "csrf",
    expires_at: "2026-10-23T18:00:00.000Z",
  });
const expired = () =>
  json({ error: { code: "authentication_required", retryable: false, safe_message: "Sign in to continue." } }, 401);

/** Every request the page makes, as "METHOD /path". */
const requests: string[] = [];
function serve(session: () => Response | Promise<Response>, config: object = { timezone: "Europe/Berlin" }) {
  requests.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    requests.push(`${init?.method ?? "GET"} ${path}`);
    if (path === "/v1/auth/session" && !init?.method) return session();
    if (path === "/v1/config") return json(config);
    if (path === "/v1/admin/summary") return json({ aggregate_status: "current", request_count: "0" });
    if (path === "/v1/admin/health") return json({ browsers_connected: 1, browsers_synced_last_day: 1, browsers_not_synced_3_days: 0, problems: [] });
    if (path === "/v1/methods") return json({ default_method_id: "m", methods: [] });
    if (path === "/v1/admin/users") return json({ items: [], next_cursor: null });
    return json({ error: { code: "not_found", safe_message: "Not found in this test." } }, 404);
  }) as typeof fetch;
}

const sessionReads = () => requests.filter((request) => request === "GET /v1/auth/session").length;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const homeShown = (view: ReturnType<typeof render>) => view.container.querySelector("h1.h1x") !== null;
const dashboardShown = (view: ReturnType<typeof render>) =>
  [...view.container.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Sign out");
const panelButton = (view: ReturnType<typeof render>) =>
  view.container.querySelector<HTMLAnchorElement>("header.site-top a.site-panel");
const mainWebsite = (root: ParentNode) =>
  [...root.querySelectorAll<HTMLAnchorElement>("a.nav-item")].find((link) => link.textContent?.trim() === "Main website");

test("the admin logo opens the Overview from every admin page", async () => {
  serve(() => adminSession());
  dom.window.history.replaceState({}, "", "/admin/plan");
  const view = render(<App />);
  await waitFor(() => assert.ok(dashboardShown(view), "the dashboard did not open"));
  const logo = view.container.querySelector<HTMLAnchorElement>("aside a.brand");
  assert.ok(logo, "the sidebar has a logo");
  assert.equal(logo.getAttribute("href"), "/admin");
  fireEvent.click(logo);
  await waitFor(() => assert.equal(dom.window.location.pathname, "/admin"));
  assert.ok(dashboardShown(view), "the logo left the dashboard");
});

test("Main website sits below Plan in the sidebar and in the phone menu", async () => {
  serve(() => adminSession());
  dom.window.history.replaceState({}, "", "/admin");
  const view = render(<App />);
  await waitFor(() => assert.ok(dashboardShown(view), "the dashboard did not open"));
  const aside = view.container.querySelector("aside")!;
  const labels = [...aside.querySelectorAll("a.nav-item")].map((link) => link.textContent?.trim());
  assert.equal(labels.at(-1), "Main website");
  assert.equal(labels.at(-2), "Plan");
  const entry = mainWebsite(aside)!;
  assert.equal(entry.getAttribute("href"), "/?from=admin");
  assert.ok(entry.querySelector("svg"), "the entry has an icon like the others");
  fireEvent.click(view.container.querySelector<HTMLButtonElement>("button.mobile-menu")!);
  const drawer = view.container.querySelector("#mobile-admin-nav");
  assert.ok(drawer, "the phone menu opened");
  const phoneEntry = mainWebsite(drawer);
  assert.ok(phoneEntry, "the phone menu has Main website");
  assert.equal(phoneEntry.getAttribute("href"), "/?from=admin");
  fireEvent.click(phoneEntry);
  await waitFor(() => assert.ok(homeShown(view), "the home page did not open"));
  assert.equal(dom.window.location.pathname, "/");
  assert.equal(view.container.querySelector("#mobile-admin-nav"), null, "the phone menu closed");
});

test("Main website opens the public home page and does not bounce back, also after a reload", async () => {
  serve(() => adminSession());
  dom.window.history.replaceState({}, "", "/admin");
  let view = render(<App />);
  await waitFor(() => assert.ok(dashboardShown(view), "the dashboard did not open"));
  assert.equal(hasAdminHint(), true, "the dashboard remembers that an administrator signed in");
  fireEvent.click(mainWebsite(view.container.querySelector("aside")!)!);
  await waitFor(() => assert.ok(homeShown(view), "the home page did not open"));
  assert.equal(dom.window.location.pathname, "/");
  assert.equal(dom.window.location.search, "");
  // The page already knows the session, so the header opens the panel at once.
  assert.ok(panelButton(view), "the header does not offer the admin panel");
  await pause(200);
  assert.equal(dom.window.location.pathname, "/", "the home page sent the administrator back");
  // A reload in the same tab keeps the public page.
  cleanup();
  view = render(<App />);
  assert.ok(homeShown(view), "the reloaded home page waited for the session");
  await waitFor(() => assert.ok(panelButton(view), "the header did not learn about the session"));
  assert.equal(dom.window.location.pathname, "/", "the reloaded home page sent the administrator back");
});

test("Main website opened in a new tab stays on the public home page and cleans the address", async () => {
  serve(() => adminSession());
  rememberAdminSession();
  dom.window.history.replaceState({}, "", "/?from=admin");
  const view = render(<App />);
  assert.ok(homeShown(view), "the home page waited for the session");
  assert.equal(dom.window.location.pathname, "/");
  assert.equal(dom.window.location.search, "", "the marker stays in the address");
  assert.equal(staysOnWebsite(), true);
  await waitFor(() => assert.ok(panelButton(view), "the header did not learn about the session"));
  assert.equal(dom.window.location.pathname, "/", "the home page sent the administrator back");
});

test("an administrator who opens the home page directly goes to the Overview", async () => {
  serve(() => adminSession());
  rememberAdminSession();
  const view = render(<App />);
  assert.equal(homeShown(view), false, "the home page showed before the session was known");
  await waitFor(() => assert.equal(dom.window.location.pathname, "/admin"));
  await waitFor(() => assert.ok(dashboardShown(view), "the dashboard did not open"));
});

test("without the hint the home page renders at once and asks for no session", async () => {
  serve(() => adminSession());
  const view = render(<App />);
  assert.ok(homeShown(view), "the home page did not render at once");
  await pause(100);
  assert.deepEqual(requests, []);
  assert.equal(dom.window.location.pathname, "/");
  assert.equal(panelButton(view), null);
});

test("an expired session clears the hint and shows the home page", async () => {
  serve(expired);
  rememberAdminSession();
  const view = render(<App />);
  await waitFor(() => assert.ok(homeShown(view), "the home page did not show"));
  assert.equal(sessionReads(), 1);
  assert.equal(hasAdminHint(), false, "the hint stayed after the session expired");
  assert.equal(dom.window.location.pathname, "/");
  const signIn = view.container.querySelector<HTMLAnchorElement>("header.site-top a.site-signin");
  assert.equal(signIn?.textContent?.trim(), "Admin sign in");
  // The next visit renders at once without asking again.
  cleanup();
  requests.length = 0;
  const next = render(<App />);
  assert.ok(homeShown(next));
  await pause(50);
  assert.deepEqual(requests, []);
});

test("a slow session check shows the home page after a short wait and never moves it later", async () => {
  let answer!: (response: Response) => void;
  serve(() => new Promise<Response>((resolve) => (answer = resolve)));
  rememberAdminSession();
  const started = Date.now();
  const view = render(<App />);
  assert.equal(homeShown(view), false);
  await waitFor(() => assert.ok(homeShown(view), "the home page did not show"));
  assert.ok(Date.now() - started < 4000, "the home page waited too long");
  answer(adminSession());
  await waitFor(() => assert.ok(panelButton(view), "the header did not learn about the session"));
  assert.equal(dom.window.location.pathname, "/", "a late session moved a page the person could see");
});

test("other public pages never redirect an administrator", async () => {
  for (const path of [
    "/downloads",
    "/download",
    "/teams",
    "/self-host",
    "/methodology",
    "/methodology/ecologits",
    "/methodology/reference",
    "/privacy",
    "/open-source",
    "/contact",
    "/terms",
    "/privacy-policy",
    "/dpa",
    "/imprint",
  ]) {
    serve(() => adminSession());
    rememberAdminSession();
    dom.window.history.replaceState({}, "", path);
    const view = render(<App />);
    await waitFor(() => assert.ok(panelButton(view), `${path} did not learn about the session`));
    await pause(20);
    assert.equal(dom.window.location.pathname, path, `${path} redirected`);
    cleanup();
  }
});

test("the hint names no person, organization or token", async () => {
  serve(() => adminSession());
  dom.window.history.replaceState({}, "", "/admin");
  const view = render(<App />);
  await waitFor(() => assert.ok(dashboardShown(view), "the dashboard did not open"));
  const storage = dom.window.localStorage;
  const stored = Array.from({ length: storage.length }, (_, index) => {
    const key = storage.key(index)!;
    return [key, storage.getItem(key)] as const;
  });
  assert.deepEqual(stored, [["aift.admin-session", "1"]]);
});

test("signing out clears the hint", async () => {
  let signedOut = false;
  serve(() => (signedOut ? expired() : adminSession()));
  const fetchWithSignOut = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (new URL(String(input)).pathname === "/v1/auth/session" && init?.method === "DELETE") {
      signedOut = true;
      return json({ logged_out: true });
    }
    return fetchWithSignOut(input, init);
  }) as typeof fetch;
  dom.window.history.replaceState({}, "", "/admin");
  const view = render(<App />);
  await waitFor(() => assert.ok(dashboardShown(view), "the dashboard did not open"));
  assert.equal(hasAdminHint(), true);
  fireEvent.click([...view.container.querySelectorAll("aside button")].find((b) => b.textContent?.trim() === "Sign out")!);
  await waitFor(() => assert.equal(dom.window.location.pathname, "/login"));
  assert.equal(hasAdminHint(), false);
});

test("blocked storage means no hint and no error", () => {
  const blocked = () => {
    throw new Error("SecurityError: the operation is insecure.");
  };
  const names = ["localStorage", "sessionStorage"] as const;
  const own = names.map((name) => Object.getOwnPropertyDescriptor(dom.window, name));
  for (const name of names) Object.defineProperty(dom.window, name, { get: blocked, configurable: true });
  try {
    assert.doesNotThrow(() => rememberAdminSession());
    assert.equal(hasAdminHint(), false);
    assert.doesNotThrow(() => stayOnWebsite());
    assert.equal(staysOnWebsite(), false);
  } finally {
    names.forEach((name, index) => {
      const descriptor = own[index];
      if (descriptor) Object.defineProperty(dom.window, name, descriptor);
      else delete (dom.window as unknown as Record<string, unknown>)[name];
    });
  }
  assert.doesNotThrow(() => dom.window.localStorage.getItem("x"), "the real storage came back");
});

test("the header button reads Admin sign in for visitors", () => {
  const view = render(
    <SiteLayout navigate={() => {}} path="/">
      <p>Page</p>
    </SiteLayout>,
  );
  const button = view.container.querySelector<HTMLAnchorElement>("header.site-top a.site-signin");
  assert.equal(button?.textContent?.trim(), "Admin sign in");
  assert.equal(button?.getAttribute("href"), "/login");
  assert.equal(panelButton(view), null);
});

test("the header button opens the panel and names the organization on a second, shortened line", () => {
  const name = "Bundesverband der Energie- und Wasserwirtschaft Beratungs- und Projektgesellschaft mbH, Niederlassung Süd";
  const visits: string[] = [];
  const view = render(
    <SiteLayout navigate={(to) => visits.push(to)} path="/" adminPanel={{ company: name }}>
      <p>Page</p>
    </SiteLayout>,
  );
  const button = panelButton(view);
  assert.ok(button, "the header does not offer the admin panel");
  assert.equal(button.getAttribute("href"), "/admin");
  assert.equal(button.querySelector(".site-panel-action")?.textContent, "Open admin panel");
  assert.equal(button.querySelector(".site-panel-org")?.textContent, name);
  assert.equal(button.getAttribute("aria-label"), `Open admin panel for ${name}`);
  assert.equal(button.getAttribute("title"), `Open admin panel for ${name}`);
  assert.equal(view.container.querySelectorAll("header.site-top a.site-signin").length, 1, "one button only");
  fireEvent.click(button);
  assert.deepEqual(visits, ["/admin"]);
  cleanup();
  const unnamed = render(
    <SiteLayout navigate={() => {}} path="/" adminPanel={{ company: null }}>
      <p>Page</p>
    </SiteLayout>,
  );
  const plain = panelButton(unnamed)!;
  assert.equal(plain.getAttribute("aria-label"), "Open admin panel");
  assert.equal(plain.querySelector(".site-panel-org"), null);
});

test("a long organization name cannot widen the header", () => {
  const css = readFileSync(new URL("../src/site/site.css", import.meta.url), "utf8");
  const rule = (selector: string) => {
    const match = new RegExp(`${selector.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`).exec(css);
    assert.ok(match, `${selector} has no rule`);
    return match[1]!;
  };
  assert.match(rule(".site .site-signin.site-panel"), /max-width:\s*220px/);
  assert.match(rule(".site .site-signin.site-panel"), /min-width:\s*0/);
  assert.match(rule(".site .site-panel-lines"), /min-width:\s*0/);
  const org = rule(".site .site-panel-org");
  assert.match(org, /overflow:\s*hidden/);
  assert.match(org, /text-overflow:\s*ellipsis/);
  assert.match(org, /white-space:\s*nowrap/);
  assert.match(org, /font-size:\s*12px/);
});

const navLabels = (view: ReturnType<typeof render>) =>
  [...view.container.querySelectorAll("aside a.nav-item")].map((link) => link.textContent?.trim());

test("with the server switches off the panel has no per-person pages", async () => {
  // Owner decision of 18 October 2026: person analytics and IP collection are operator switches,
  // off by default. A server that sends no features counts as off.
  serve(() => adminSession());
  dom.window.history.replaceState({}, "", "/admin/requests");
  const view = render(<App />);
  await waitFor(() => assert.ok(dashboardShown(view), "the dashboard did not open"));
  await waitFor(() => assert.ok(requests.includes("GET /v1/admin/activity"), requests.join(" ")));
  const labels = navLabels(view);
  assert.ok(labels.includes("Activity"));
  assert.equal(labels.includes("Requests"), false);
  assert.equal(labels.includes("Network"), false);
  assert.equal(requests.includes("GET /v1/admin/requests"), false);
  cleanup();
  dom.window.history.replaceState({}, "", "/admin/network");
  const network = render(<App />);
  await waitFor(() => assert.ok(network.container.textContent?.includes("Admin page not found")));
});

test("with person analytics and IP collection on the panel shows Requests and Network", async () => {
  serve(() => adminSession(), {
    timezone: "Europe/Berlin",
    features: { person_analytics: true, ip_collection: true },
  });
  dom.window.history.replaceState({}, "", "/admin/requests");
  const view = render(<App />);
  await waitFor(() => assert.ok(dashboardShown(view), "the dashboard did not open"));
  await waitFor(() => assert.ok(navLabels(view).includes("Network"), navLabels(view).join(", ")));
  assert.ok(navLabels(view).includes("Requests"));
  await waitFor(() => assert.ok(requests.includes("GET /v1/admin/requests"), requests.join(" ")));
});

test("with person analytics on but IP collection off there is no Network page", async () => {
  serve(() => adminSession(), {
    timezone: "Europe/Berlin",
    features: { person_analytics: true, ip_collection: false },
  });
  dom.window.history.replaceState({}, "", "/admin/network");
  const view = render(<App />);
  await waitFor(() => assert.ok(navLabels(view).includes("Requests"), navLabels(view).join(", ")));
  assert.equal(navLabels(view).includes("Network"), false);
  assert.ok(view.container.textContent?.includes("Admin page not found"));
});

test("the light-only website keeps the light tool colours on a device in dark mode", () => {
  // living-gauge.css gives dark pages lighter tool colours; the admin bars sit on light cards.
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /<html lang="en" data-theme="light">/);
});
