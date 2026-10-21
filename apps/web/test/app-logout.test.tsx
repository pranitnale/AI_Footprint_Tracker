import assert from "node:assert/strict";
import test, { afterEach, before } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import { cleanup, render, waitFor, within } from "@testing-library/react";
import "./async-timeout";
import userEvent from "@testing-library/user-event";
import App from "../src/app";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://tenant.example/admin/unknown",
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
    addEventListener: dom.window.addEventListener.bind(dom.window),
    removeEventListener: dom.window.removeEventListener.bind(dom.window),
  });
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  dom.window.document.body.innerHTML = "";
  dom.window.history.replaceState({}, "", "/admin/unknown");
});

const session = (role: "admin" | "operator" | "user") => ({
  role,
  user_id: role === "operator" ? null : "user-1",
  company_id: role === "operator" ? null : "company-1",
  company_name: role === "operator" ? null : "Example Company",
  csrf_token: "csrf-token",
  expires_at: "2026-09-10T18:00:00.000Z",
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

test("tenant sign out keeps the session visible after an offline failure and recovers once confirmed", async () => {
  const user = userEvent.setup({ document: dom.window.document });
  const retry = deferred<Response>();
  let deletes = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/auth/session" && init?.method === "DELETE") {
      deletes++;
      if (deletes === 1) throw new Error("offline");
      return retry.promise;
    }
    if (url.pathname === "/v1/auth/session") return json(session("admin"));
    throw new Error(`Unexpected request ${init?.method ?? "GET"} ${url}`);
  };
  const view = render(<App />);
  const signOut = await view.findByRole("button", { name: "Sign out" });
  await user.click(signOut);
  assert.equal(dom.window.location.pathname, "/admin/unknown");
  assert.ok(await view.findByText("Sign out failed"));
  await user.click(view.getByRole("button", { name: "Menu" }));
  const drawer = view.getByRole("dialog", { name: "admin navigation" });
  assert.ok(within(drawer).getByText("Sign out failed"));
  assert.match(
    within(drawer).getByRole("alert").textContent ?? "",
    /service could not be reached/i,
  );
  assert.equal(view.getAllByRole("alert").length, 1);
  const tryAgain = within(drawer).getByRole("button", {
    name: "Try sign out again",
  });
  await user.click(tryAgain);
  const pendingControls = view.getAllByRole("button", {
    name: "Signing out…",
  });
  assert.equal(pendingControls.length, 2);
  assert.equal(
    pendingControls.every((button) => button.hasAttribute("disabled")),
    true,
  );
  await user.click(pendingControls[0]!);
  assert.equal(
    deletes,
    2,
    "the disabled control cannot start a duplicate DELETE",
  );
  retry.resolve(json({ logged_out: true }));
  await waitFor(() => assert.equal(dom.window.location.pathname, "/login"));
  assert.equal(view.queryByText("Sign out failed"), null);
});

test("operator sign out rejects an unknown success body and retries the operator endpoint", async () => {
  dom.window.history.replaceState({}, "", "/operator/unknown");
  const user = userEvent.setup({ document: dom.window.document });
  let deletes = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/operator/auth/session" && !init?.method)
      return json(session("operator"));
    if (
      url.pathname === "/v1/operator/auth/session" &&
      init?.method === "DELETE"
    ) {
      deletes++;
      return deletes === 1 ? json({ ok: true }) : json({ logged_out: true });
    }
    throw new Error(`Unexpected request ${init?.method ?? "GET"} ${url}`);
  };
  const view = render(<App />);
  await user.click(await view.findByRole("button", { name: "Sign out" }));
  assert.equal(dom.window.location.pathname, "/operator/unknown");
  assert.match(
    view.getByText(/did not confirm sign out/i).textContent ?? "",
    /session may still be open/i,
  );
  await user.click(view.getByRole("button", { name: "Try sign out again" }));
  await waitFor(() =>
    assert.equal(dom.window.location.pathname, "/operator/login"),
  );
  assert.equal(deletes, 2);
});

test("a member session at an admin address goes to sign in, since members have no web pages", async () => {
  dom.window.history.replaceState({}, "", "/admin");
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/auth/session" && !init?.method) return json(session("user"));
    throw new Error(`Unexpected request ${init?.method ?? "GET"} ${url}`);
  };
  const view = render(<App />);
  await waitFor(() => assert.equal(dom.window.location.pathname, "/login"));
  assert.ok(await view.findByRole("heading", { name: "Administrator sign in" }));
});

test("a known expired session is cleared when sign out returns authentication_required", async () => {
  const user = userEvent.setup({ document: dom.window.document });
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/auth/session" && !init?.method)
      return json(session("admin"));
    if (url.pathname === "/v1/auth/session" && init?.method === "DELETE")
      return json(
        {
          error: {
            code: "authentication_required",
            retryable: false,
            safe_message: "Your session ended.",
          },
        },
        401,
      );
    throw new Error(`Unexpected request ${init?.method ?? "GET"} ${url}`);
  };
  const view = render(<App />);
  await user.click(await view.findByRole("button", { name: "Sign out" }));
  await waitFor(() => assert.equal(dom.window.location.pathname, "/login"));
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

test("the old member onboarding address is not a page and asks for no session", async () => {
  dom.window.history.replaceState({}, "", "/onboarding?connection_id=0f2c6a1b-6d44-4b64-9f8e-0c4a3d2f1e7b");
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    throw new Error(`Unexpected request ${input}`);
  };
  const view = render(<App />);
  assert.ok(await view.findByRole("heading", { name: "This page does not exist." }));
  assert.equal(dom.window.location.pathname, "/onboarding");
  assert.deepEqual(requests, []);
});

test("signing in is required for the admin dashboard and carries nothing from the address", async () => {
  dom.window.history.replaceState({}, "", "/admin?connection_id=0f2c6a1b-6d44-4b64-9f8e-0c4a3d2f1e7b");
  globalThis.fetch = async () =>
    json({ error: { code: "authentication_required", retryable: false, safe_message: "Sign in to continue." } }, 401);
  const view = render(<App />);
  await waitFor(() => assert.equal(dom.window.location.pathname, "/login"));
  assert.equal(dom.window.location.search, "");
  assert.equal(view.queryByText(/A browser is waiting/), null);
});
