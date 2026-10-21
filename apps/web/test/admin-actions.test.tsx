import assert from "node:assert/strict";
import test, { afterEach, before } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import "./async-timeout";
import userEvent from "@testing-library/user-event";
import App from "../src/app";
import { AdminAudit, AdminPlan } from "../src/admin-pages";
import { AdminPeople, AdminPerson } from "../src/admin/AdminPeople";
import { ApiError } from "../src/api";
import type { Session } from "../src/types";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://tenant.example/admin/people",
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
  // React's legacy input polyfill calls these, since it loads before jsdom becomes the window.
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    attachEvent: { value: () => {} },
    detachEvent: { value: () => {} },
  });
});
afterEach(() => {
  cleanup();
  dom.window.document.body.innerHTML = "";
  dom.window.history.replaceState({}, "", "/admin/people");
});

const MEMBER_ID = "11111111-2222-4333-8444-555555555555";
const SESSION: Session = {
  role: "admin",
  user_id: "99999999-2222-4333-8444-555555555555",
  company_id: "company-1",
  company_name: "Example GmbH",
  email: "admin@example.test",
  csrf_token: "csrf",
  expires_at: "2026-10-14T18:00:00.000Z",
};
const CHALLENGE = {
  challenge_id: "challenge-1",
  delivery_state: "accepted",
  expires_at: "2026-10-14T12:05:00.000Z",
  retry_at: "2099-01-01T00:00:00.000Z",
  error_code: null,
};

/** An admin API stub that records writes and answers the person page's reads. */
function personApi(member: { status: string; membership_version: number }) {
  const writes: Array<{ method: string; path: string; body: any }> = [];
  let current = { ...member };
  let reauthTokens = 0;
  const api = {
    get: async (path: string) => {
      if (path === "/v1/config") return { timezone: "Europe/Berlin" };
      if (path.startsWith("/v1/admin/users?"))
        return {
          items: [{ user_id: MEMBER_ID, email: "pat@example.test", role: "user", installations: 2, ...current }],
          next_cursor: null,
        };
      if (path === `/v1/admin/users/${MEMBER_ID}/devices`)
        return {
          items: [
            {
              device_id: "device-a",
              browser_family: "chrome",
              status: "active",
              first_seen_at: "2026-09-01T08:00:00.000Z",
              // Fields the contract no longer sends; the page must not show them even if they arrive.
              last_seen_at: "2026-10-13T09:30:00.000Z",
              ip_address: "203.0.113.9",
            },
            {
              device_id: "device-b",
              browser_family: "firefox",
              status: "revoked",
              first_seen_at: "2026-08-01T08:00:00.000Z",
            },
          ],
        };
      // The member page reads no usage: a summary, people or health read fails the test.
      throw new Error(`unexpected GET ${path}`);
    },
    post: async (path: string, body: any) => {
      writes.push({ method: "POST", path, body });
      if (path === "/v1/auth/otp/request") return CHALLENGE;
      if (path === "/v1/auth/otp/verify") return { reauth_token: `token-${++reauthTokens}` };
      if (path.endsWith("/revoke")) return { device_id: "device-a", status: "revoked" };
      throw new Error(`unexpected POST ${path}`);
    },
    put: async (path: string, body: any) => {
      writes.push({ method: "PUT", path, body });
      current = { status: body.status, membership_version: current.membership_version + 1 };
      return { user_id: MEMBER_ID, status: body.status, membership_version: current.membership_version };
    },
  } as any;
  return { api, writes };
}

/** Sets a text field the way React reads it here: it loads before jsdom, so it listens to key events. */
async function setText(input: HTMLElement, text: string) {
  const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
  (input as HTMLInputElement).focus();
  setValue.call(input, text);
  fireEvent.keyUp(input);
  await waitFor(() => assert.equal((input as HTMLInputElement).value, text));
}

async function verifyCode(scope: ReturnType<typeof within>, user: ReturnType<typeof userEvent.setup>) {
  await user.click(await scope.findByRole("button", { name: "Email a fresh action code" }));
  await setText(await scope.findByLabelText("Action verification code"), "123456");
  await user.click(scope.getByRole("button", { name: "Verify code" }));
  await scope.findByText(/Your code is verified/);
}

test("a member's browsers show family, status and when they connected, never when they were used or an IP address", async () => {
  const { api } = personApi({ status: "active", membership_version: 3 });
  const view = render(<AdminPerson api={api} navigate={() => {}} userId={MEMBER_ID} session={SESSION} />);
  const card = (await view.findByRole("heading", { name: "Browsers" })).closest("section")!;
  const rows = await within(card).findAllByRole("row");
  assert.equal(rows.length, 3);
  assert.match(rows[0]!.textContent ?? "", /Connected since/);
  assert.doesNotMatch(rows[0]!.textContent ?? "", /Last seen/);
  assert.match(rows[1]!.textContent ?? "", /Chrome.*Active/);
  assert.match(rows[2]!.textContent ?? "", /Firefox.*Removed/);
  assert.doesNotMatch(card.textContent ?? "", /13 Oct|Oct 13|13\.10\./);
  assert.match(card.textContent ?? "", /not when it was used/);
  // Only the active browser can be removed.
  assert.equal(within(card).getAllByRole("button", { name: "Remove browser" }).length, 1);
  assert.doesNotMatch(document.body.textContent ?? "", /203\.0\.113\.9|\b\d{1,3}(\.\d{1,3}){3}\b/);
  assert.match(card.textContent ?? "", /signs it out at once/);
});

test("removing a browser sends a fresh action token to that browser's revoke address", async () => {
  const { api, writes } = personApi({ status: "active", membership_version: 3 });
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(<AdminPerson api={api} navigate={() => {}} userId={MEMBER_ID} session={SESSION} />);
  await user.click(await view.findByRole("button", { name: "Remove browser" }));
  const dialog = within(view.getByRole("dialog"));
  assert.equal((dialog.getByRole("button", { name: "Remove browser" }) as HTMLButtonElement).disabled, true);
  await verifyCode(dialog, user);
  assert.deepEqual(writes[0], {
    method: "POST",
    path: "/v1/auth/otp/request",
    body: { purpose: "action_reauth", email: "admin@example.test", dispatch_id: writes[0]!.body.dispatch_id, registration_id: null },
  });
  await user.click(dialog.getByRole("button", { name: "Remove browser" }));
  await view.findByText("Browser removed");
  const revoke = writes.find((write) => write.path.endsWith("/revoke"))!;
  assert.equal(revoke.path, `/v1/admin/users/${MEMBER_ID}/devices/device-a/revoke`);
  assert.deepEqual(revoke.body, { reauth_token: "token-1" });
  assert.equal(view.queryByRole("dialog"), null);
});

test("suspending and reactivating send the status, the member's version and a new action token each time", async () => {
  const { api, writes } = personApi({ status: "active", membership_version: 3 });
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(<AdminPerson api={api} navigate={() => {}} userId={MEMBER_ID} session={SESSION} />);
  await user.click(await view.findByRole("button", { name: "Suspend member" }));
  let dialog = within(view.getByRole("dialog"));
  await verifyCode(dialog, user);
  await user.click(dialog.getByRole("button", { name: "Suspend member" }));
  await view.findByText("Member suspended");
  const suspend = writes.find((write) => write.method === "PUT")!;
  assert.equal(suspend.path, `/v1/admin/users/${MEMBER_ID}/status`);
  assert.deepEqual(suspend.body, { status: "suspended", expected_version: 3, reauth_token: "token-1" });
  const access = (await view.findByRole("heading", { name: "Access and records" })).closest("section")!;
  await within(access).findByText("Suspended");

  await user.click(await view.findByRole("button", { name: "Reactivate member" }));
  dialog = within(view.getByRole("dialog"));
  await verifyCode(dialog, user);
  await user.click(dialog.getByRole("button", { name: "Reactivate member" }));
  await view.findByText("Member reactivated");
  const reactivate = writes.filter((write) => write.method === "PUT")[1]!;
  assert.deepEqual(reactivate.body, { status: "active", expected_version: 4, reauth_token: "token-2" });
  // Each action asks for its own code, since a token works once.
  assert.equal(writes.filter((write) => write.path === "/v1/auth/otp/request").length, 2);
  assert.notEqual(
    writes.filter((write) => write.path === "/v1/auth/otp/request")[0]!.body.dispatch_id,
    writes.filter((write) => write.path === "/v1/auth/otp/request")[1]!.body.dispatch_id,
  );
});

test("the suspension notice stays while the member page reads the member list again", async () => {
  const { api } = personApi({ status: "active", membership_version: 3 });
  const read = api.get;
  let slow = false;
  // A real server answers the reload later; until 19 October 2026 the page unmounted meanwhile
  // and the notice was gone when the list came back.
  api.get = async (path: string) => {
    if (slow && path.startsWith("/v1/admin/users?")) await new Promise((resolve) => setTimeout(resolve, 50));
    return read(path);
  };
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(<AdminPerson api={api} navigate={() => {}} userId={MEMBER_ID} session={SESSION} />);
  await user.click(await view.findByRole("button", { name: "Suspend member" }));
  const dialog = within(view.getByRole("dialog"));
  await verifyCode(dialog, user);
  slow = true;
  await user.click(dialog.getByRole("button", { name: "Suspend member" }));
  const access = (await view.findByRole("heading", { name: "Access and records" })).closest("section")!;
  await within(access).findByText("Suspended");
  assert.ok(view.getByText("Member suspended"));
});

test("the audit log names the service for the server's own entries and a former member for an unknown id", async () => {
  const api = {
    get: async (path: string) => {
      if (path.startsWith("/v1/admin/users?"))
        return {
          items: [{ user_id: MEMBER_ID, email: "pat@example.test", role: "admin", status: "active", installations: 1, membership_version: 1 }],
          next_cursor: null,
        };
      if (path.startsWith("/v1/admin/audit"))
        return {
          items: [
            { actor: "system", action: "usage_erasure_completed", target: "a".repeat(64), at: "2026-10-18T21:50:15.000Z", details: { epoch: 0 } },
            { actor: "77777777-2222-4333-8444-555555555555", action: "role_changed", target: MEMBER_ID, at: "2026-10-18T21:40:15.000Z", details: {} },
            { actor: MEMBER_ID, action: "policy_changed", target: "company-1", at: "2026-10-18T21:30:15.000Z", details: {} },
          ],
          next_cursor: null,
        };
      throw new Error(`unexpected GET ${path}`);
    },
  } as any;
  const view = render(<AdminAudit api={api} />);
  await view.findByText("Usage erasure completed");
  await view.findByText(/^by pat@example\.test/);
  assert.ok(view.getByText(/^by The service/));
  assert.ok(view.getByText(/^by A former member/));
});

// QA of 19 Oct 2026: a removed browser's entry read "user id: 1111...", the member's raw id.
test("audit details name a member by work email and never show a raw user or developer id", async () => {
  const gone = "88888888-2222-4333-8444-555555555555";
  const reviewer = "66666666-2222-4333-8444-555555555555";
  const api = {
    get: async (path: string) => {
      if (path.startsWith("/v1/admin/users?"))
        return {
          items: [{ user_id: MEMBER_ID, email: "pat@example.test", role: "admin", status: "active", installations: 1, membership_version: 1 }],
          next_cursor: null,
        };
      if (path.startsWith("/v1/admin/audit"))
        return {
          items: [
            { actor: MEMBER_ID, action: "browser_removed", target: "d".repeat(36), at: "2026-10-18T21:50:15.000Z", details: { user_id: MEMBER_ID } },
            { actor: MEMBER_ID, action: "browser_removed", target: "e".repeat(36), at: "2026-10-18T21:45:15.000Z", details: { user_id: gone } },
            { actor: MEMBER_ID, action: "organization_deletion_requested", target: "company-1", at: "2026-10-18T21:40:15.000Z", details: { requested_by: MEMBER_ID, requested_at: "2026-10-18T21:40:15.000Z" } },
            { actor: MEMBER_ID, action: "domain_exception_consumed", target: "approval-1", at: "2026-10-18T21:30:15.000Z", details: { reviewer_id: reviewer, version: 2 } },
          ],
          next_cursor: null,
        };
      throw new Error(`unexpected GET ${path}`);
    },
  } as any;
  const view = render(<AdminAudit api={api} />);
  await view.findByText("Person: pat@example.test");
  const entries = view.getByRole("region", { name: "Audit entries" }).textContent!;
  for (const id of [MEMBER_ID, gone, reviewer]) assert.equal(entries.includes(id), false, id);
  assert.doesNotMatch(entries, /user id|reviewer id|2026-10-18T/i);
  assert.ok(view.getByText("Person: a former member"));
  assert.match(entries, /Requested by: pat@example\.test/);
  assert.match(entries, /Reviewed by the service's developers; Version: 2/);
});

test("the last administrator conflict stays in the suspend dialog", async () => {
  const { api } = personApi({ status: "active", membership_version: 3 });
  api.put = async () => {
    throw new ApiError({ code: "last_admin", retryable: false, safe_message: "Keep at least one active administrator.", status: 409 });
  };
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(<AdminPerson api={api} navigate={() => {}} userId={MEMBER_ID} session={SESSION} />);
  await user.click(await view.findByRole("button", { name: "Suspend member" }));
  const dialog = within(view.getByRole("dialog"));
  await verifyCode(dialog, user);
  await user.click(dialog.getByRole("button", { name: "Suspend member" }));
  await dialog.findByText("Access was not changed");
  assert.ok(dialog.getByText("Keep at least one active administrator."));
  assert.equal(view.queryByText("Member suspended"), null);
});

test("a member's page is for access only and shows no usage", async () => {
  const { api } = personApi({ status: "active", membership_version: 3 });
  const view = render(<AdminPerson api={api} navigate={() => {}} userId={MEMBER_ID} session={SESSION} />);
  await view.findByRole("heading", { name: "pat@example.test" });
  assert.match(document.body.textContent ?? "", /A member's own usage is shown only to them, in their extension/);
  assert.ok(view.getByRole("heading", { name: "Role" }));
  assert.ok(view.getByRole("link", { name: "Delete this member's records" }));
  assert.doesNotMatch(document.body.textContent ?? "", /Electricity|Carbon|Water|requests|Last sync/);
});

const PEOPLE = {
  used: 3,
  members: 4,
  administrators: 1,
  capacity: 50,
  median_requests: "380",
  average_requests: "405.5",
  max_requests: "1004",
  bins: [
    { from: 0, to: 100, people: 1 },
    { from: 100, to: 250, people: 0 },
    { from: 250, to: 500, people: 1 },
    { from: 500, to: 750, people: 0 },
    { from: 750, to: 1000, people: 0 },
    { from: 1000, to: null, people: 1 },
  ],
};

test("the People page shows organization figures and lists members for access only", async () => {
  const api = {
    get: async (path: string) =>
      path === "/v1/config"
        ? { timezone: "Europe/Berlin" }
        : path.startsWith("/v1/admin/people")
          ? PEOPLE
          : {
              items: [
                { user_id: "a", email: "admin@example.test", role: "admin", status: "active", membership_version: 1, installations: 1 },
                { user_id: "b", email: "pat@example.test", role: "user", status: "active", membership_version: 2, installations: 2 },
              ],
              next_cursor: null,
            },
  } as any;
  const view = render(<AdminPeople api={api} navigate={() => {}} onPrivilegeLost={() => {}} />);
  await view.findByText(/No one's usage is shown next to their name or email/);
  const numbers = await view.findByRole("region", { name: "Usage per person in numbers" });
  assert.match(numbers.textContent ?? "", /Used AI.*3.*of 4/);
  assert.match(numbers.textContent ?? "", /Typical person.*380/);
  assert.match(numbers.textContent ?? "", /Average per person.*405\.5/);
  assert.match(numbers.textContent ?? "", /Most active person.*1,?004.*name not shown/);
  const table = (await view.findByRole("link", { name: "pat@example.test" })).closest("table")!;
  const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent);
  assert.deepEqual(headers, ["Work email", "Role", "Browsers", "Status", "Actions"]);
  assert.doesNotMatch(table.textContent ?? "", /Requests|380|1,?004/);
  assert.ok(within(table).getByRole("button", { name: "Manage pat@example.test" }));
});

test("the member list keeps suspended members and marks them", async () => {
  const api = {
    get: async (path: string) =>
      path === "/v1/config"
        ? { timezone: "Europe/Berlin" }
        : path.startsWith("/v1/admin/people")
          ? { ...PEOPLE, used: 0, members: 2, median_requests: null, average_requests: null, max_requests: null, bins: [] }
          : {
              items: [
                { user_id: "a", email: "admin@example.test", role: "admin", status: "active", membership_version: 1, installations: 1 },
                { user_id: "b", email: "pat@example.test", role: "user", status: "suspended", membership_version: 2, installations: 0 },
                { user_id: "c", email: "gone@example.test", role: "user", status: "deleted", membership_version: 2, installations: 0 },
              ],
              next_cursor: null,
            },
  } as any;
  const view = render(<AdminPeople api={api} navigate={() => {}} onPrivilegeLost={() => {}} />);
  const row = (await view.findByRole("link", { name: "pat@example.test" })).closest("tr")!;
  assert.ok(within(row).getByText("Suspended"));
  assert.equal(view.queryByText("gone@example.test"), null);
});

// QA of 19 Oct 2026: at 390 px the member table scrolled sideways and hid Status and Manage. On a
// phone admin.css stacks each row into lines named by data-label (measured with Playwright).
test("each member cell names its column, so a phone can stack the row without hiding any", async () => {
  const api = {
    get: async (path: string) =>
      path === "/v1/config"
        ? { timezone: "Europe/Berlin" }
        : path.startsWith("/v1/admin/people")
          ? { ...PEOPLE, used: 0, members: 1, median_requests: null, average_requests: null, max_requests: null, bins: [] }
          : {
              items: [{ user_id: "b", email: "pat@example.test", role: "user", status: "active", membership_version: 2, installations: 1 }],
              next_cursor: null,
            },
  } as any;
  const view = render(<AdminPeople api={api} navigate={() => {}} onPrivilegeLost={() => {}} />);
  const row = (await view.findByRole("link", { name: "pat@example.test" })).closest("tr")!;
  const table = row.closest("table")!;
  assert.ok(table.classList.contains("ad-table-stacked"));
  const headers = [...table.querySelectorAll("thead th")].map((th) => th.textContent);
  const cells = [...row.children];
  cells.forEach((cell, index) => {
    if (cell.tagName === "TH" || cell.querySelector("button.ad-btn")) return;
    assert.equal(cell.getAttribute("data-label"), headers[index], `cell ${index}`);
  });
  assert.deepEqual(
    cells.map((cell) => cell.getAttribute("data-label")),
    [null, "Role", "Browsers", "Status", null],
  );
});

test("deleting the organization needs the typed name and a fresh action code", async () => {
  const writes: Array<{ path: string; body: any }> = [];
  let scheduled = 0;
  const api = {
    get: async (path: string) => {
      if (path === "/v1/admin/organization/deletion") return { status: "none", requested_at: null, delete_after: null, grace_days: 7 };
      if (path === "/v1/admin/plan")
        return {
          plan_id: "free",
          plan_version: 1,
          mode: "hosted",
          member_capacity: 50,
          usage_retention_months: null,
          billing_status: "not_configured",
          transitions: [],
        };
      if (path === "/v1/config") return { timezone: "Europe/Berlin" };
      return { items: [], next_cursor: null };
    },
    post: async (path: string, body: any) => {
      writes.push({ path, body });
      if (path === "/v1/auth/otp/request") return CHALLENGE;
      if (path === "/v1/auth/otp/verify") return { reauth_token: "org-token" };
      if (path === "/v1/admin/organization/deletion")
        return { status: "scheduled", requested_at: "2026-10-14T12:00:00Z", delete_after: "2026-10-21T12:00:00Z", grace_days: 7 };
      throw new Error(`unexpected POST ${path}`);
    },
  } as any;
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(<AdminPlan api={api} navigate={() => {}} session={SESSION} onDeletionScheduled={() => scheduled++} />);
  const section = (await view.findByRole("heading", { name: "Delete organization" })).closest("section")!;
  assert.match(section.textContent ?? "", /audit log/);
  assert.match(section.textContent ?? "", /already downloaded cannot be erased/);
  await user.click(await within(section).findByRole("button", { name: "Delete organization" }));
  const dialog = within(view.getByRole("dialog"));
  const confirm = () => dialog.getByRole("button", { name: "Delete organization" }) as HTMLButtonElement;
  const name = dialog.getByLabelText(/Type the organization name/);
  await setText(name, "Example");
  await verifyCode(dialog, user);
  assert.equal(confirm().disabled, true, "a wrong name keeps the button disabled");
  await setText(name, "  example gmbh ");
  await waitFor(() => assert.equal(confirm().disabled, false));
  await user.click(confirm());
  await waitFor(() => assert.equal(scheduled, 1));
  const request = writes.find((write) => write.path === "/v1/admin/organization/deletion")!;
  assert.deepEqual(request.body, { reauth_token: "org-token", confirm_name: "example gmbh" });
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("a scheduled deletion replaces the admin pages with a notice, and cancelling returns to the dashboard", async () => {
  dom.window.history.replaceState({}, "", "/admin/people");
  let organization: "deletion_scheduled" | "active" = "deletion_scheduled";
  const deletes: string[] = [],
    blocked: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (url.pathname === "/v1/auth/session" && method === "GET") return json({ ...SESSION, organization_status: organization });
    if (url.pathname === "/v1/admin/organization/deletion" && method === "GET")
      return json({ status: "scheduled", requested_at: "2026-10-14T12:00:00Z", delete_after: "2026-10-21T12:00:00Z", grace_days: 7 });
    if (url.pathname === "/v1/admin/organization/deletion" && method === "DELETE") {
      deletes.push(new Headers(init?.headers).get("X-CSRF-Token") ?? "");
      organization = "active";
      return json({ status: "none", requested_at: null, delete_after: null, grace_days: 7 });
    }
    if (organization !== "active") blocked.push(`${method} ${url.pathname}`);
    return json({ error: { code: "not_available", safe_message: "Not in this test." } }, 503);
  };
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(<App />);
  assert.ok(await view.findByRole("heading", { name: "The organization is scheduled for deletion" }));
  await view.findByText(/browsers stopped syncing/);
  assert.match(document.body.textContent ?? "", /Deletion on /);
  assert.deepEqual(blocked, [], "no dashboard request while deletion is scheduled");
  await user.click(view.getByRole("button", { name: "Cancel deletion" }));
  await waitFor(() => assert.equal(dom.window.location.pathname, "/admin"));
  await waitFor(() => assert.equal(view.queryByRole("heading", { name: "The organization is scheduled for deletion" }), null));
  assert.deepEqual(deletes, ["csrf"]);
});

test("a page that meets service_suspended reloads the session and shows the deletion notice", async () => {
  dom.window.history.replaceState({}, "", "/admin/people");
  let sessions = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/auth/session")
      return json({ ...SESSION, organization_status: ++sessions === 1 ? "active" : "deletion_scheduled" });
    if (url.pathname === "/v1/admin/organization/deletion")
      return json({ status: "scheduled", requested_at: "2026-10-14T12:00:00Z", delete_after: "2026-10-21T12:00:00Z", grace_days: 7 });
    return json(
      { error: { code: "service_suspended", safe_message: "This organization is scheduled for deletion." } },
      403,
    );
  };
  const view = render(<App />);
  assert.ok(await view.findByRole("heading", { name: "The organization is scheduled for deletion" }));
  assert.ok(await view.findByRole("button", { name: "Cancel deletion" }));
});
