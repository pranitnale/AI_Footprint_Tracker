// Admin figures kept for the identical request on a signed-in page (15 October 2026): they show at
// once when the administrator returns, are read again in the background, never stand in for another
// request, never look current after a failed refresh, and go with any write or change of account.
import assert from "node:assert/strict";
import test, { afterEach, before } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import "./async-timeout";
import {
  ApiClient,
  forgetSessionReads,
  readFigures,
  rememberedFigures,
  setFigureScope,
} from "../src/api";
import { AdminOverview } from "../src/admin/AdminOverview";
import { useFigures } from "../src/admin/state";

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

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** A GET stub whose answers the test hands out one at a time, per path. */
function scriptedApi() {
  const waiting = new Map<string, ReturnType<typeof deferred<unknown>>[]>();
  const sent: string[] = [];
  const api = {
    get: (path: string) => {
      sent.push(path);
      const next = deferred<unknown>();
      waiting.set(path, [...(waiting.get(path) ?? []), next]);
      return next.promise;
    },
  };
  const answer = async (path: string, value: unknown) => {
    await waitFor(() => assert.ok(waiting.get(path)?.length, `no request for ${path}`));
    await act(async () => waiting.get(path)!.shift()!.resolve(value));
  };
  const fail = async (path: string, error: unknown) => {
    await waitFor(() => assert.ok(waiting.get(path)?.length, `no request for ${path}`));
    await act(async () => waiting.get(path)!.shift()!.reject(error));
  };
  return { api, sent, answer, fail };
}

function Probe({ api, path }: { api: { get: (path: string) => Promise<unknown> }; path: string | null }) {
  const figures = useFigures(api, path, () => api.get(path!));
  return (
    <p data-testid="probe">
      {figures.error ? "error" : String(figures.data ?? "none")}
      {figures.cachedAt !== null ? " (kept)" : ""}
    </p>
  );
}
const probe = (view: ReturnType<typeof render>) => view.getByTestId("probe").textContent;

test("figures read before show at once on return, marked as kept, and the refresh replaces them", async () => {
  const { api, answer } = scriptedApi();
  const first = render(<Probe api={api} path="/v1/admin/summary?start=a" />);
  assert.equal(probe(first), "none");
  await answer("/v1/admin/summary?start=a", "42 requests");
  assert.equal(probe(first), "42 requests");
  first.unmount();
  const again = render(<Probe api={api} path="/v1/admin/summary?start=a" />);
  assert.equal(probe(again), "42 requests (kept)", "the first render already shows the kept figures");
  await answer("/v1/admin/summary?start=a", "43 requests");
  assert.equal(probe(again), "43 requests");
});

test("figures are never shown for a different request, not even for one render", async () => {
  const { api, answer } = scriptedApi();
  const view = render(<Probe api={api} path="/v1/admin/summary?start=a" />);
  await answer("/v1/admin/summary?start=a", "period A");
  const seen: string[] = [];
  const observer = new dom.window.MutationObserver(() => seen.push(probe(view) ?? ""));
  observer.observe(view.container, { subtree: true, childList: true, characterData: true });
  view.rerender(<Probe api={api} path="/v1/admin/summary?start=b" />);
  seen.push(probe(view) ?? "");
  assert.ok(!seen.some((text) => text.includes("period A")), seen.join(" | "));
  await answer("/v1/admin/summary?start=b", "period B");
  assert.equal(probe(view), "period B");
  // Back to A: its own figures, kept, while A is read again.
  view.rerender(<Probe api={api} path="/v1/admin/summary?start=a" />);
  assert.equal(probe(view), "period A (kept)");
  observer.disconnect();
  // A totals-only read is its own request too.
  assert.equal(rememberedFigures(api, "totals /v1/admin/summary?start=a"), undefined);
});

test("a failed refresh shows the error, not the kept figures, and drops them", async () => {
  const { api, answer, fail } = scriptedApi();
  const first = render(<Probe api={api} path="/v1/admin/people?start=a" />);
  await answer("/v1/admin/people?start=a", "7 people");
  first.unmount();
  const again = render(<Probe api={api} path="/v1/admin/people?start=a" />);
  assert.equal(probe(again), "7 people (kept)");
  await fail("/v1/admin/people?start=a", new Error("offline"));
  assert.equal(probe(again), "error");
  again.unmount();
  assert.equal(probe(render(<Probe api={api} path="/v1/admin/people?start=a" />)), "none");
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("any write through the client, sign-out included, forgets every kept figure", async () => {
  const api = new ApiClient("https://tenant.example");
  let failWrites = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method && init.method !== "GET") {
      if (failWrites) throw new Error("offline");
      return json({ logged_out: true });
    }
    return json({ request_count: new URL(String(input)).search });
  }) as typeof fetch;
  const read = (path: string) => readFigures(api, path, () => api.get(path));
  const kept = (path: string) => rememberedFigures(api, path) !== undefined;

  await read("/v1/admin/summary?start=a");
  assert.ok(kept("/v1/admin/summary?start=a"));
  await api.delete("/v1/auth/session");
  assert.ok(!kept("/v1/admin/summary?start=a"), "sign-out");

  // An erasure or deletion that fails on the way may still have reached the server.
  await read("/v1/admin/summary?start=a");
  failWrites = true;
  await assert.rejects(api.post("/v1/admin/deletions", { user_id: "u" }));
  assert.ok(!kept("/v1/admin/summary?start=a"), "deletion");
  failWrites = false;

  await read("/v1/admin/summary?start=a");
  await api.put("/v1/admin/users/u/role", { role: "user" });
  assert.ok(!kept("/v1/admin/summary?start=a"), "role change");

  await read("/v1/admin/summary?start=a");
  forgetSessionReads(api);
  assert.ok(!kept("/v1/admin/summary?start=a"), "session reload or policy save");
});

test("a read that was under way during a write does not keep its older answer", async () => {
  const api = new ApiClient("https://tenant.example");
  const slow = deferred<Response>();
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) =>
    init?.method && init.method !== "GET" ? json({ ok: true }) : slow.promise) as typeof fetch;
  const pending = readFigures(api, "/v1/admin/summary?start=a", () => api.get("/v1/admin/summary?start=a"));
  await api.post("/v1/admin/deletions", { user_id: "u" });
  slow.resolve(json({ request_count: "9" }));
  await pending;
  assert.equal(rememberedFigures(api, "/v1/admin/summary?start=a"), undefined);
});

test("another account signed in on the page starts without the earlier account's figures", async () => {
  const api = { get: async () => "figures of account 1" };
  setFigureScope(api, "admin company-1 user-1");
  await readFigures(api, "/v1/admin/summary", () => api.get());
  setFigureScope(api, "admin company-1 user-1");
  assert.ok(rememberedFigures(api, "/v1/admin/summary"), "the same account keeps them");
  setFigureScope(api, "admin company-2 user-9");
  assert.equal(rememberedFigures(api, "/v1/admin/summary"), undefined);
});

test("the overview shows kept figures with an Updating note at once, and a failed refresh only as an error", async () => {
  const { api, sent, answer, fail } = scriptedApi();
  const isFullSummary = (path: string) => path.startsWith("/v1/admin/summary") && !path.includes("splits=none");
  // A period being rebuilt shows the summary's message, which tells two answers apart.
  const rebuilding = (message: string) => ({ aggregate_status: "rebuilding", safe_message: message });
  const updating = (view: ReturnType<typeof render>) => /Updating figures read at/.test(view.container.textContent ?? "");
  const summaryPath = () =>
    waitFor(() => {
      const found = sent.find(isFullSummary);
      assert.ok(found, "no summary request yet");
      return found;
    });

  const first = render(<AdminOverview api={api as any} navigate={() => {}} />);
  await answer("/v1/config", { timezone: "Europe/Berlin" });
  const path = await summaryPath();
  await answer(path, rebuilding("Version one"));
  await first.findByText("Version one");
  assert.ok(!updating(first), "a fresh answer has no Updating note");
  first.unmount();

  const second = render(<AdminOverview api={api as any} navigate={() => {}} />);
  await second.findByText("Version one");
  assert.ok(updating(second), "kept figures say that they are being updated");
  assert.ok(!second.queryByText("Loading organization figures"), "no skeleton before the kept figures");
  await waitFor(() => assert.equal(sent.filter((sentPath) => sentPath === path).length, 2, "the summary is read again"));
  await answer(path, rebuilding("Version two"));
  await second.findByText("Version two");
  assert.ok(!updating(second));
  second.unmount();

  const third = render(<AdminOverview api={api as any} navigate={() => {}} />);
  await third.findByText("Version two");
  await waitFor(() => assert.equal(sent.filter((sentPath) => sentPath === path).length, 3));
  await fail(path, Object.assign(new Error("unavailable"), { status: 503, code: "service_unavailable" }));
  await third.findByText("The server did not answer");
  assert.ok(!third.queryByText("Version two"), "figures that could not be confirmed are not shown");
  assert.ok(!updating(third));
});
