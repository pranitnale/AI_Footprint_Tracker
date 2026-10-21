import assert from "node:assert/strict";
import test, { afterEach, before } from "node:test";
import { JSDOM } from "jsdom";
import React, { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import "./async-timeout";
import userEvent from "@testing-library/user-event";
import { Dialog } from "@footprint/ui";
import {
  AdminAudit,
  AdminDeletion,
  AdminExports,
  AdminHealth,
  AdminHealthByBrowser,
  AdminNetwork,
  AdminPlan,
  AdminPolicies,
  AdminRequests,
} from "../src/admin-pages";
import { AdminPeople } from "../src/admin/AdminPeople";
import {
  AppLayout,
  ErrorState,
  Filters,
  formatInteger,
} from "../src/components";
import { ApiError, queryString } from "../src/api";
import { LoginPage, RegisterPage } from "../src/auth-pages";
import {
  OperatorContacts,
  OperatorExceptions,
  OperatorOrganizations,
  useNewContactCount,
} from "../src/operator-pages";

const dom = new JSDOM(
  '<!doctype html><html><body><button id="opener">Open</button></body></html>',
  { url: "https://tenant.example/admin/users" },
);
before(() => {
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle,
    FormData: dom.window.FormData,
    // The Policies page reads location.hash to scroll to its export section.
    location: dom.window.location,
  });
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    attachEvent: { value: () => {} },
    detachEvent: { value: () => {} },
  });
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = '<button id="opener">Open</button>';
  window.history.replaceState({}, "", "/admin/users");
});

test("modal focus is trapped, Escape closes it and focus returns to the opener", async () => {
  const user = userEvent.setup({ document: dom.window.document });
  const opener = document.getElementById("opener") as HTMLButtonElement;
  opener.focus();
  function Harness() {
    const [open, setOpen] = useState(true);
    return open ? (
      <Dialog
        title="Confirm access"
        onClose={() => setOpen(false)}
        actions={
          <>
            <button>Cancel</button>
            <button>Confirm</button>
          </>
        }
      >
        Review this change.
      </Dialog>
    ) : null;
  }
  const view = render(<Harness />);
  const dialog = view.getByRole("dialog");
  await waitFor(() =>
    assert.equal(dialog.contains(document.activeElement), true),
  );
  const buttons = within(dialog).getAllByRole("button");
  buttons.at(-1)!.focus();
  await user.tab();
  assert.equal(document.activeElement, buttons[0]);
  await user.keyboard("{Escape}");
  assert.equal(view.queryByRole("dialog"), null);
  assert.equal(document.activeElement, opener);
});

test("range deletion preview discloses imported history without source dates", async () => {
  const api = {
    get: async (path: string) => {
      assert.equal(path, "/v1/config");
      return { timezone: "Europe/Berlin" };
    },
    post: async (path: string) => {
      assert.equal(path, "/v1/admin/deletions/preview");
      return {
        state: "ready",
        counts_complete: true,
        request_count: "2",
        record_count: "6",
        historical_message_count: "5",
        undated_historical_message_count: "3",
        range_start: "2026-08-31T22:00:00.000Z",
        range_end: "2026-09-30T22:00:00.000Z",
        contribution_date_range: null,
        contribution_dates: [],
        expires_at: "2026-09-14T13:00:00.000Z",
        local_erasure: "Connected browsers will apply the deletion receipt.",
        preview_token: "preview",
      };
    },
  } as any;
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(
    <AdminDeletion
      api={api}
      session={{
        role: "admin",
        user_id: "user-1",
        company_id: "company-1",
        company_name: "Example",
        csrf_token: "csrf",
        expires_at: "2026-09-14T14:00:00.000Z",
      }}
    />,
  );
  await waitFor(() =>
    assert.equal(
      (
        view.getByRole("button", {
          name: "Preview deletion",
        }) as HTMLButtonElement
      ).disabled,
      false,
    ),
  );
  fireEvent.change(view.getByLabelText("Start"), {
    target: { value: "2026-09-01" },
  });
  fireEvent.change(view.getByLabelText("End, exclusive"), {
    target: { value: "2026-10-01" },
  });
  await user.click(view.getByRole("button", { name: "Preview deletion" }));
  await view.findByRole("heading", { name: "Deletion preview" });
  assert.equal(
    view.getByText("Imported historical messages").nextElementSibling
      ?.textContent,
    "5",
  );
  assert.equal(
    view.getByText("Imported historical messages without a source date")
      .nextElementSibling?.textContent,
    "3",
  );
  assert.ok(
    view.getByText(
      /date-range deletion also includes 3 imported historical messages/i,
    ),
  );
  assert.ok(view.getByText(/separate age-retention policy/i));
});

const ADMIN_SESSION = {
  role: "admin",
  user_id: "user-1",
  company_id: "company-1",
  company_name: "Example",
  email: "admin@example.test",
  csrf_token: "csrf",
  expires_at: "2026-10-21T12:00:00.000Z",
} as const;

/** Verifies a fresh action code inside the open dialog, as every role change now needs one. */
async function verifyActionCode(view: ReturnType<typeof render>, user: ReturnType<typeof userEvent.setup>) {
  const dialog = within(view.getByRole("dialog"));
  await user.click(await dialog.findByRole("button", { name: "Email a fresh action code" }));
  await pasteCode((await dialog.findByLabelText("Action verification code")) as HTMLInputElement, "123456");
  await user.click(dialog.getByRole("button", { name: "Verify code" }));
  await dialog.findByText(/Your code is verified/);
}

const DEVELOPER_EMAIL = "developer@example.test";

/**
 * Answers the developer panel's action code requests, which go to the operator endpoints. Returns
 * undefined for any other path, so a test's own POST handler can go on.
 */
function operatorCode(path: string, body: any, requests: any[] = []) {
  if (path === "/v1/operator/auth/otp/request") {
    requests.push(body);
    return {
      challenge_id: "challenge-operator",
      delivery_state: "accepted",
      expires_at: "2026-10-14T12:05:00.000Z",
      retry_at: "2099-01-01T00:00:00.000Z",
      error_code: null,
    };
  }
  if (path === "/v1/operator/auth/otp/verify") return { reauth_token: "operator-token" };
  return undefined;
}

/** Verifies a fresh developer code inside one action's dialog or section. */
async function verifyOperatorCode(scope: HTMLElement, user: ReturnType<typeof userEvent.setup>) {
  const area = within(scope);
  await user.click(await area.findByRole("button", { name: "Email a fresh action code" }));
  await pasteCode((await area.findByLabelText("Action verification code")) as HTMLInputElement, "123456");
  await user.click(area.getByRole("button", { name: "Verify code" }));
  await area.findByText(/Your code is verified/);
}

function usersApi(roleError?: ApiError, writes: Array<{ path: string; body: any }> = []) {
  return {
    post: async (path: string, body: any) => {
      writes.push({ path, body });
      if (path === "/v1/auth/otp/request")
        return {
          challenge_id: "challenge-1",
          delivery_state: "accepted",
          expires_at: "2026-10-14T12:05:00.000Z",
          retry_at: "2099-01-01T00:00:00.000Z",
          error_code: null,
        };
      if (path === "/v1/auth/otp/verify") return { reauth_token: "role-token" };
      throw new Error(`unexpected POST ${path}`);
    },
    get: async (path: string) =>
      path === "/v1/config"
        ? { timezone: "Europe/Berlin" }
        : path.startsWith("/v1/admin/people")
          ? {
              used: 1,
              members: 1,
              administrators: 1,
              capacity: 50,
              median_requests: "12",
              average_requests: "12",
              max_requests: "12",
              bins: [{ from: 0, to: 100, people: 1 }],
            }
          : {
      items: [
        {
          user_id: "user-1",
          email: "admin@example.test",
          role: "admin",
          status: "active",
          membership_version: 1,
          installations: 1,
        },
      ],
      next_cursor: null,
    },
    put: async (path: string, body: any) => {
      writes.push({ path, body });
      if (roleError) throw roleError;
      return {};
    },
  } as any;
}

test("last-admin conflict stays inside the dialog and leaves the role unchanged", async () => {
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(
    <AdminPeople
      navigate={() => {}}
      api={usersApi(
        new ApiError({
          code: "last_admin",
          retryable: false,
          safe_message: "Keep at least one active administrator.",
          status: 409,
        }),
      )}
      onPrivilegeLost={() => assert.fail("must not redirect")}
      session={ADMIN_SESSION}
    />,
  );
  await user.click(
    await view.findByRole("button", { name: "Role for admin@example.test: Admin" }),
  );
  await user.click(view.getByRole("menuitemradio", { name: "User" }));
  await verifyActionCode(view, user);
  await user.click(view.getByRole("button", { name: "Remove admin access" }));
  const dialog = view.getByRole("dialog");
  await waitFor(() =>
    assert.match(dialog.textContent ?? "", /Access was not changed/),
  );
  assert.match(
    dialog.textContent ?? "",
    /Keep at least one active administrator/,
  );
  assert.match(document.body.textContent ?? "", /admin/);
});

test("a CSRF failure does not masquerade as privilege loss", async () => {
  let lost = false;
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(
    <AdminPeople
      navigate={() => {}}
      api={usersApi(
        new ApiError({
          code: "csrf_failed",
          retryable: false,
          safe_message: "Refresh the page and try again.",
          status: 403,
        }),
      )}
      onPrivilegeLost={() => {
        lost = true;
      }}
      session={ADMIN_SESSION}
    />,
  );
  await user.click(
    await view.findByRole("button", { name: "Role for admin@example.test: Admin" }),
  );
  await user.click(view.getByRole("menuitemradio", { name: "User" }));
  await verifyActionCode(view, user);
  await user.click(view.getByRole("button", { name: "Remove admin access" }));
  await view.findByText("Refresh the page and try again.");
  assert.equal(lost, false);
  assert.ok(view.getByRole("dialog"));
});

test("confirmed admin revocation invokes the safe privilege-loss path", async () => {
  let lost = false;
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(
    <AdminPeople
      navigate={() => {}}
      api={usersApi(
        new ApiError({
          code: "admin_required",
          retryable: false,
          safe_message: "Admin access has ended.",
          status: 403,
        }),
      )}
      onPrivilegeLost={() => {
        lost = true;
      }}
      session={ADMIN_SESSION}
    />,
  );
  await user.click(
    await view.findByRole("button", { name: "Role for admin@example.test: Admin" }),
  );
  await user.click(view.getByRole("menuitemradio", { name: "User" }));
  await verifyActionCode(view, user);
  await user.click(view.getByRole("button", { name: "Remove admin access" }));
  await waitFor(() => assert.equal(lost, true));
});

test("a role change waits for a fresh action code and sends it with the change", async () => {
  const writes: Array<{ path: string; body: any }> = [];
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(
    <AdminPeople navigate={() => {}} api={usersApi(undefined, writes)} onPrivilegeLost={() => {}} session={ADMIN_SESSION} />,
  );
  await user.click(await view.findByRole("button", { name: "Role for admin@example.test: Admin" }));
  await user.click(view.getByRole("menuitemradio", { name: "User" }));
  const confirm = () => view.getByRole("button", { name: "Remove admin access" }) as HTMLButtonElement;
  assert.equal(confirm().disabled, true, "no change without a verified code");
  await verifyActionCode(view, user);
  assert.deepEqual(writes[0]!.body.purpose, "action_reauth");
  assert.equal(writes[0]!.body.email, "admin@example.test");
  await user.click(confirm());
  await waitFor(() => assert.ok(writes.find((write) => write.path.endsWith("/role"))));
  const change = writes.find((write) => write.path.endsWith("/role"))!;
  assert.equal(change.path, "/v1/admin/users/user-1/role");
  assert.equal(change.body.role, "user");
  assert.equal(change.body.expected_version, 1);
  assert.equal(change.body.reauth_token, "role-token");
});

test("a refused action code sends the role change dialog back to the email step", async () => {
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(
    <AdminPeople
      navigate={() => {}}
      api={usersApi(
        new ApiError({
          code: "reauthentication_required",
          retryable: false,
          safe_message: "Confirm with a new email code.",
          status: 403,
        }),
      )}
      onPrivilegeLost={() => assert.fail("must not redirect")}
      session={ADMIN_SESSION}
    />,
  );
  await user.click(await view.findByRole("button", { name: "Role for admin@example.test: Admin" }));
  await user.click(view.getByRole("menuitemradio", { name: "User" }));
  await verifyActionCode(view, user);
  await user.click(view.getByRole("button", { name: "Remove admin access" }));
  const dialog = within(view.getByRole("dialog"));
  await dialog.findByRole("button", { name: "Email a fresh action code" });
  assert.equal((dialog.getByRole("button", { name: "Remove admin access" }) as HTMLButtonElement).disabled, true);
});

test("controlled filter drafts retain typed values across parent rerenders", async () => {
  const user = userEvent.setup({ document: dom.window.document });
  const values = { period: "month" };
  const view = render(<Filters values={values} onChange={() => {}} />);
  const start = view.getByLabelText("Start") as HTMLInputElement;
  await user.type(start, "2026-09-01");
  assert.equal(start.value, "2026-09-01");
  view.rerender(<Filters values={values} onChange={() => {}} />);
  assert.equal(
    (view.getByLabelText("Start") as HTMLInputElement).value,
    "2026-09-01",
  );
});

test("Last month remains a preset after filters are applied", async () => {
  let applied: Record<string, string> | undefined;
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(
    <Filters
      values={{ period: "month" }}
      timezone="Europe/Berlin"
      now={new Date("2026-09-10T12:00:00Z")}
      onChange={(next) => {
        applied = next;
      }}
    />,
  );
  await user.selectOptions(view.getByLabelText("Period"), "last_month");
  await user.click(view.getByRole("button", { name: "Apply filters" }));
  assert.equal(applied?.period, "custom");
  assert.equal(applied?._period_preset, "last_month");
  assert.equal(applied?.start, "2026-08-01");
  assert.equal(applied?.end, "2026-09-01");
  assert.equal(
    queryString(applied!),
    "?period=custom&start=2026-08-01&end=2026-09-01",
  );
  assert.equal(
    (view.getByLabelText("Period") as HTMLSelectElement).value,
    "last_month",
  );
});

test("mobile navigation moves and traps focus, closes with Escape and includes sign out", async () => {
  let signedOut = false;
  const view = render(
    <AppLayout
      mode="admin"
      path="/admin"
      company="Test"
      navigate={() => {}}
      onLogout={() => {
        signedOut = true;
      }}
    >
      <button>Background action</button>
    </AppLayout>,
  );
  const toggle = view.getByRole("button", { name: "Menu" });
  toggle.focus();
  fireEvent.click(toggle);
  const drawer = view.getByRole("dialog", { name: "admin navigation" });
  await waitFor(() =>
    assert.equal(drawer.contains(document.activeElement), true),
  );
  const signOut = within(drawer).getByRole("button", { name: "Sign out" });
  assert.ok(signOut);
  signOut.focus();
  fireEvent.keyDown(document, { key: "Tab" });
  assert.equal(document.activeElement, within(drawer).getAllByRole("link")[0]);
  fireEvent.keyDown(document, { key: "Escape" });
  assert.equal(view.queryByRole("dialog"), null);
  assert.equal(document.activeElement, toggle);
  assert.equal(signedOut, false);
});

const challenge = {
  challenge_id: "challenge-1",
  delivery_state: "accepted",
  expires_at: "2026-09-10T12:10:00Z",
  retry_at: "2020-09-10T12:01:00Z",
  error_code: null,
};

/** Signs in up to the code step and enters a code, as an administrator would. */
async function enterSignInCode(
  view: ReturnType<typeof render>,
  user: ReturnType<typeof userEvent.setup>,
) {
  await user.type(view.getByLabelText("Work email"), "person@example.com");
  await user.click(view.getByRole("button", { name: "Email me a code" }));
  await view.findByRole("heading", { name: "Check your inbox" });
  await user.type(view.getByLabelText("Verification code"), "123456");
  await user.click(view.getByRole("button", { name: "Verify and continue" }));
}

test("web sign-in is for administrators and shows the server's reason when it refuses", async () => {
  const refusals = [
    new ApiError({
      code: "admin_required",
      retryable: false,
      safe_message:
        "Only administrators sign in on the website. Members connect from the AI Footprint Tracker browser extension.",
      status: 403,
    }),
    new ApiError({
      code: "organization_not_found",
      retryable: false,
      safe_message:
        "No organization uses this work email domain. Check that you used your work email, ask your administrator which work email the organization was registered with, or register your organization at aifootprinttracker.com.",
      status: 404,
    }),
  ];
  for (const refusal of refusals) {
    const posts: string[] = [];
    const api = {
      setCsrf: () => {},
      post: async (path: string) => {
        posts.push(path);
        if (path === "/v1/auth/otp/request") return challenge;
        if (path === "/v1/auth/otp/verify") throw refusal;
        throw new Error(`unexpected ${path}`);
      },
    } as any;
    const user = userEvent.setup({ document: dom.window.document });
    const view = render(<LoginPage api={api} navigate={() => {}} />);
    assert.ok(view.getByRole("heading", { name: "Administrator sign in" }));
    // Members are told where they connect before they try.
    assert.ok(view.getByText(/Members do not sign in here. They connect from the AI Footprint Tracker browser extension/));
    await enterSignInCode(view, user);
    const alert = await view.findByRole("alert");
    assert.equal(alert.textContent, refusal.safe_message);
    // Only a member, refused for not being an administrator, is pointed to the extension.
    const download = view.queryByRole("link", { name: "Get the extension" });
    if (refusal.code === "admin_required") assert.equal(download?.getAttribute("href"), "/downloads");
    else assert.equal(download, null);
    assert.deepEqual(posts, ["/v1/auth/otp/request", "/v1/auth/otp/verify"]);
    cleanup();
  }
});

test("registration asks for no organization address and a hosted registration lands on /admin", async () => {
  const gets: string[] = [];
  const bodies: Record<string, any> = {};
  const loaded: string[] = [];
  const api = {
    get: async (path: string) => {
      gets.push(path);
      return hostedDeployment();
    },
    post: async (path: string, body: any) => {
      bodies[path] = body;
      if (path === "/v1/organizations/registrations")
        return { registration_id: "registration-1", state: "verification_pending", expires_at: "2026-09-10T13:00:00Z" };
      if (path === "/v1/auth/otp/request") return challenge;
      if (path === "/v1/auth/otp/verify")
        return {
          registration_id: "registration-1",
          state: "active",
          expires_at: "2026-09-10T13:00:00Z",
          destination: "/admin",
          csrf_token: "csrf",
        };
      throw new Error(`unexpected ${path}`);
    },
  } as any;
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(<RegisterPage api={api} load={(url) => loaded.push(url)} />);
  await view.findByText(/how the service finds your organization/);
  assert.equal(view.queryByLabelText(/Organization address/), null);
  assert.equal(view.queryByLabelText(/Organization identifier/), null);
  assert.equal(view.queryByRole("button", { name: "Check" }), null);
  await completeRegistrationForm(view, user);
  await user.type(view.getByLabelText("Verification code"), "123456");
  await user.click(view.getByRole("button", { name: "Verify and create organization" }));
  await waitFor(() => assert.deepEqual(loaded, ["/admin"]));
  assert.equal("slug" in bodies["/v1/organizations/registrations"], false);
  assert.deepEqual(gets, ["/v1/public/deployment"]);
});

test("self-hosted registration also has no address field and keeps the server's hand-over", async () => {
  const loaded: string[] = [];
  const handOver = "https://company.footprint.example.org/auth/bootstrap/start?registration_id=registration-1";
  const api = {
    get: async () => ({ mode: "self_hosted", registration_origin: "https://footprint.example.org" }),
    post: async (path: string) => {
      if (path === "/v1/organizations/registrations")
        return { registration_id: "registration-1", state: "verification_pending", expires_at: "2026-09-10T13:00:00Z" };
      if (path === "/v1/auth/otp/request") return challenge;
      if (path === "/v1/auth/otp/verify")
        return { registration_id: "registration-1", state: "active", expires_at: "2026-09-10T13:00:00Z", destination: handOver };
      throw new Error(`unexpected ${path}`);
    },
  } as any;
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(<RegisterPage api={api} load={(url) => loaded.push(url)} />);
  await view.findByText("Members connect from the extension with an email address on the same domain as yours.");
  assert.equal(view.queryByLabelText(/Organization identifier/), null);
  await completeRegistrationForm(view, user, /same domain as yours/);
  await user.type(view.getByLabelText("Verification code"), "123456");
  await user.click(view.getByRole("button", { name: "Verify and create organization" }));
  await waitFor(() => assert.deepEqual(loaded, [handOver]));
});

async function completeRegistrationForm(
  view: ReturnType<typeof render>,
  user: ReturnType<typeof userEvent.setup>,
  // The deployment-specific hint shows once the settings arrive, which enables Continue.
  loaded: RegExp = /how the service finds your organization/,
) {
  await view.findByText(loaded);
  await user.type(view.getByLabelText("Organization name"), "Example Company");
  await user.type(view.getByLabelText("Organization website"), "example.com");
  await user.type(view.getByLabelText("Your work email"), "admin@example.com");
  await user.type(view.getByLabelText("Your name"), "Example Admin");
  await user.type(view.getByLabelText("Your role"), "Owner");
  await user.click(
    view.getByLabelText(/I am authorized to register this organization/),
  );
  const next = view.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
  // The organization must accept the terms and the processing agreement before anything is sent.
  assert.equal(next.disabled, true);
  await user.click(view.getByLabelText(/I accept the Terms of use and the Data processing agreement/));
  await user.click(next);
  await view.findByRole("heading", { name: "Confirm your work email" });
}

function hostedDeployment() {
  return {
    mode: "hosted",
    registration_origin: "https://registration.verification.example",
  };
}

test("registration verification retries the same logical operation after a lost response", async () => {
  const verificationBodies: any[] = [];
  let verificationAttempts = 0;
  const api = {
    get: async () => hostedDeployment(),
    post: async (path: string, body: any) => {
      if (path === "/v1/organizations/registrations")
        return {
          registration_id: "registration-1",
          state: "verification_pending",
          expires_at: "2026-09-10T13:00:00Z",
        };
      if (path === "/v1/auth/otp/request")
        return {
          challenge_id: "challenge-1",
          delivery_state: "accepted",
          expires_at: "2026-09-10T12:10:00Z",
          retry_at: "2020-09-10T12:01:00Z",
          error_code: null,
        };
      if (path === "/v1/auth/otp/verify") {
        verificationBodies.push(body);
        verificationAttempts += 1;
        if (verificationAttempts === 1)
          throw new ApiError({
            code: "otp_invalid_or_expired",
            retryable: true,
            safe_message:
              "The code was wrong, expired or the response was interrupted. Try again or request a new code.",
            status: 401,
          });
        return {
          registration_id: "registration-1",
          state: "provisioning_failed",
          expires_at: "2026-09-10T13:00:00Z",
        };
      }
      throw new Error(`unexpected ${path}`);
    },
  } as any;
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(<RegisterPage api={api} />);
  await completeRegistrationForm(view, user);
  await user.type(view.getByLabelText("Verification code"), "123456");
  await user.click(
    view.getByRole("button", { name: "Verify and create organization" }),
  );
  await view.findByText(/Try again or request a new code/);
  await user.click(
    view.getByRole("button", { name: "Verify and create organization" }),
  );
  await view.findByRole("heading", {
    name: "Organization setup needs attention",
  });
  assert.equal(verificationBodies.length, 2);
  assert.equal(
    verificationBodies[0].verification_id,
    verificationBodies[1].verification_id,
  );
});

test("registration takes the work domain from the work email", async () => {
  const bodies: any[] = [];
  const api = {
    get: async () => hostedDeployment(),
    post: async (path: string, body: any) => {
      if (path === "/v1/organizations/registrations") {
        bodies.push(body);
        return { registration_id: "registration-1", state: "verification_pending", expires_at: "2026-09-10T13:00:00Z" };
      }
      if (path === "/v1/auth/otp/request")
        return {
          challenge_id: "challenge-1",
          delivery_state: "accepted",
          expires_at: "2026-09-10T12:10:00Z",
          retry_at: "2020-09-10T12:01:00Z",
          error_code: null,
        };
      throw new Error(`unexpected ${path}`);
    },
  } as any;
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(<RegisterPage api={api} />);
  await view.findByText(/how the service finds your organization/);
  await user.type(view.getByLabelText("Organization name"), "Example Company");
  await user.type(view.getByLabelText("Organization website"), "example.com");
  // A separate domain field let people type "@example.com", which the server refused (13 Oct 2026).
  assert.equal(view.queryByLabelText("Work email domain"), null);
  await user.type(view.getByLabelText("Your work email"), "Admin@Example.com");
  await user.type(view.getByLabelText("Your name"), "Example Admin");
  await user.type(view.getByLabelText("Your role"), "Owner");
  await user.click(view.getByLabelText(/I am authorized to register this organization/));
  await user.click(view.getByLabelText(/I accept the Terms of use and the Data processing agreement/));
  await user.click(view.getByRole("button", { name: "Continue" }));
  await view.findByRole("heading", { name: "Confirm your work email" });
  assert.equal(bodies[0].work_domain, "example.com");
});

test("registration resend keeps its draft and replaces the expired challenge", async () => {
  const calls: Array<{ path: string; body: any }> = [];
  const api = {
    get: async () => hostedDeployment(),
    post: async (path: string, body: any) => {
      calls.push({ path, body });
      if (path === "/v1/organizations/registrations")
        return {
          registration_id: "registration-1",
          state: "verification_pending",
          expires_at: "2026-09-10T13:00:00Z",
        };
      if (path === "/v1/auth/otp/request")
        return {
          challenge_id: "challenge-old",
          delivery_state: "delivery_unknown",
          expires_at: "2026-09-10T12:10:00Z",
          retry_at: "2020-09-10T12:01:00Z",
          error_code: null,
        };
      if (path === "/v1/auth/otp/resend")
        return {
          challenge_id: "challenge-new",
          delivery_state: "accepted",
          expires_at: "2026-09-10T12:15:00Z",
          retry_at: "2020-09-10T12:02:00Z",
          error_code: null,
        };
      throw new Error(`unexpected ${path}`);
    },
  } as any;
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(<RegisterPage api={api} />);
  await completeRegistrationForm(view, user);
  assert.ok(view.getByText(/could not confirm that the email arrived/));
  await user.type(view.getByLabelText("Verification code"), "123456");
  await user.click(view.getByRole("button", { name: "Send a new code" }));
  assert.equal(
    (view.getByLabelText("Verification code") as HTMLInputElement).value,
    "",
  );
  assert.deepEqual(
    calls.find((call) => call.path === "/v1/auth/otp/resend")?.body
      .challenge_id,
    "challenge-old",
  );
  // The new code was accepted for delivery, so the warning about the old one is gone.
  await waitFor(() => assert.equal(view.queryByText(/could not confirm that the email arrived/), null));
});

test("operator reviews retention impact before assigning an organization plan", async () => {
  const organization = {
    company_id: "company-1",
    name: "Example Company",
    origin: "https://tenant.example",
    status: "active",
    version: 4,
    capacity: 50,
    retention_months: 6,
    plan_id: "configured-free",
    plan_version: 1,
  };
  const assignments: any[] = [];
  const decisions: any[] = [];
  let assigned = false;
  const api = {
    get: async (path: string) => {
      if (path.startsWith("/v1/operator/organizations?"))
        return { items: [organization], next_cursor: null };
      if (path === "/v1/operator/organizations/company-1") return organization;
      if (path.startsWith("/v1/operator/plans?"))
        return {
          items: [
            {
              plan_id: "short",
              version: 1,
              member_capacity: 50,
              retention_months: 3,
            },
          ],
          next_cursor: null,
        };
      if (path.startsWith("/v1/operator/organizations/company-1/transitions"))
        return {
          items: assigned
            ? [
                {
                  transition_id: "transition-1",
                  plan: "short:1",
                  effective_at: "2026-09-11T10:00:00.000Z",
                  acknowledged: false,
                  acknowledgement_required: true,
                  version: 1,
                  retention_shortened: true,
                  status: "pending",
                  company_version: 4,
                  current_entitlement_generation: 1,
                  operator_can_cancel: true,
                  operator_can_review: false,
                  retention_preview: {
                    request_count: "12",
                    attempt_count: "20",
                  },
                },
              ]
            : [],
          next_cursor: null,
        };
      if (path.startsWith("/v1/operator/organizations/company-1/exceptions"))
        return { items: [], next_cursor: null };
      throw new Error(`unexpected ${path}`);
    },
    put: async (path: string, body: any) => {
      assignments.push({ path, body });
      assigned = true;
      return {
        status: "retention_transition_pending",
        transition_id: "transition-2",
      };
    },
    post: async (path: string, body: any) => {
      const code = operatorCode(path, body, codeRequests);
      if (code) return code;
      decisions.push({ path, body });
      return {
        status: "cancelled",
        transition_id: "transition-1",
        restored_reversion_id: null,
      };
    },
  } as any;
  const codeRequests: any[] = [];
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(<OperatorOrganizations api={api} email={DEVELOPER_EMAIL} />);
  await user.click(
    await view.findByRole("button", { name: "Manage Example Company" }),
  );
  await user.selectOptions(view.getByLabelText("Plan version"), "short:1");
  await user.selectOptions(view.getByLabelText("Takes effect"), "later");
  fireEvent.change(view.getByLabelText("Effective at"), {
    target: { value: "2026-09-11T10:00" },
  });
  await user.type(view.getByLabelText("Reason"), "Reviewed shorter retention");
  const assignButton = view.getByRole("button", { name: "Review and assign plan" }) as HTMLButtonElement;
  // The developer panel stays signed in for 7 days, so a plan assignment needs a fresh code.
  assert.equal(assignButton.disabled, true);
  await verifyOperatorCode(view.getByRole("region", { name: "Assign a plan" }), user);
  assert.deepEqual(codeRequests[0], {
    purpose: "operator_reauth",
    email: DEVELOPER_EMAIL,
    dispatch_id: codeRequests[0].dispatch_id,
    registration_id: null,
  });
  await user.click(assignButton);
  await view.findByText(/Retention would shorten/);
  await view.findByText("12 requests and 20 attempts may expire");
  assert.ok(view.getByText(/organization admin acknowledgement required/i));
  assert.equal(
    assignments[0].path,
    "/v1/operator/organizations/company-1/entitlement",
  );
  assert.equal(assignments[0].body.expected_version, 4);
  assert.equal(assignments[0].body.plan_id, "short");
  assert.equal(assignments[0].body.plan_version, 1);
  assert.match(assignments[0].body.idempotency_key, /^[0-9a-f-]{36}$/);
  assert.equal(assignments[0].body.reauth_token, "operator-token");
  // The code was spent, so the next assignment asks for a new one.
  await waitFor(() => assert.equal(assignButton.disabled, true));
  const cancelTransition = view.getByRole("button", {
    name: "Cancel transition",
  });
  await user.click(cancelTransition);
  await user.click(view.getByRole("button", { name: "Keep transition" }));
  await waitFor(() => assert.equal(document.activeElement, cancelTransition));
  await user.click(cancelTransition);
  await user.type(
    view.getByLabelText("Review reason"),
    "Assignment superseded",
  );
  const confirmCancel = view.getByRole("button", { name: "Confirm cancellation" }) as HTMLButtonElement;
  assert.equal(confirmCancel.disabled, true);
  await verifyOperatorCode(view.getByRole("region", { name: "Transition cancellation" }), user);
  await user.click(confirmCancel);
  await waitFor(() => assert.equal(decisions.length, 1));
  assert.equal(decisions[0].body.reauth_token, "operator-token");
  assert.equal(
    decisions[0].path,
    "/v1/operator/organizations/company-1/transitions/transition-1/cancel",
  );
  assert.deepEqual(
    {
      expected_version: decisions[0].body.expected_version,
      expected_company_version: decisions[0].body.expected_company_version,
      confirmed: decisions[0].body.confirmed,
    },
    { expected_version: 1, expected_company_version: 4, confirmed: true },
  );
  assert.ok(await view.findByText("Transition cancelled"));
  assert.ok(view.getByText(/current plan remains in effect/i));
  assert.equal(view.queryByText("Plan assignment accepted"), null);
  await waitFor(() =>
    assert.equal(
      document.activeElement,
      view.getByRole("heading", { name: "Retention transitions" }),
    ),
  );
});

test("operator re-reviews a stale transition against live entitlements", async () => {
  const organization = {
    company_id: "company-1",
    name: "Example Company",
    origin: "https://tenant.example",
    status: "active",
    version: 9,
    entitlement_generation: 5,
    capacity: 60,
    retention_months: 12,
    plan_id: "current",
    plan_version: 2,
  };
  const posts: any[] = [];
  const transition = {
    transition_id: "transition-review",
    plan: "target:3",
    effective_at: "2026-10-01T00:00:00.000Z",
    acknowledged: false,
    acknowledgement_required: true,
    version: 7,
    retention_shortened: true,
    status: "review_required",
    company_version: 9,
    current_entitlement_generation: 5,
    operator_can_cancel: true,
    operator_can_review: true,
    current_entitlement: {
      plan_id: "current",
      plan_version: 2,
      capacity: 60,
      retention_months: 12,
      timezone: "Europe/Berlin",
    },
    target_entitlement: {
      plan_id: "target",
      plan_version: 3,
      capacity: 75,
      retention_months: 3,
      timezone: "Europe/Berlin",
    },
    retention_preview: {
      request_count: "8",
      attempt_count: "13",
      cutoff: "2026-07-01T22:00:00.000Z",
      counted_at: "2026-09-10T12:00:00.000Z",
    },
  };
  const api = {
    get: async (path: string) => {
      if (path.startsWith("/v1/operator/organizations?"))
        return { items: [organization], next_cursor: null };
      if (path === "/v1/operator/organizations/company-1") return organization;
      if (path.startsWith("/v1/operator/plans?"))
        return { items: [], next_cursor: null };
      if (path.includes("/transitions"))
        return { items: [transition], next_cursor: null };
      if (path.includes("/exceptions")) return { items: [], next_cursor: null };
      throw new Error(`unexpected ${path}`);
    },
    post: async (path: string, body: any) => {
      const code = operatorCode(path, body);
      if (code) return code;
      posts.push({ path, body });
      return { ...transition, status: "pending", version: 8 };
    },
  } as any;
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(<OperatorOrganizations api={api} email={DEVELOPER_EMAIL} />);
  await user.click(
    await view.findByRole("button", { name: "Manage Example Company" }),
  );
  await user.click(
    await view.findByRole("button", {
      name: "Review against current entitlement",
    }),
  );
  assert.ok(view.getAllByText("Current v2").length >= 1);
  assert.ok(view.getAllByText("Target v3").length >= 1);
  assert.ok(
    view.getAllByText(/8 requests and 13 attempts may expire/i).length >= 1,
  );
  await user.type(
    view.getByLabelText("Review reason"),
    "Recomputed after current plan change",
  );
  await verifyOperatorCode(view.getByRole("region", { name: "Transition review" }), user);
  await user.click(
    view.getByRole("button", { name: "Confirm reviewed transition" }),
  );
  await waitFor(() => assert.equal(posts.length, 1));
  assert.equal(posts[0].body.reauth_token, "operator-token");
  assert.equal(
    posts[0].path,
    "/v1/operator/organizations/company-1/transitions/transition-review/review",
  );
  assert.deepEqual(
    {
      expected_version: posts[0].body.expected_version,
      expected_company_version: posts[0].body.expected_company_version,
      reason: posts[0].body.reason,
      confirmed: posts[0].body.confirmed,
    },
    {
      expected_version: 7,
      expected_company_version: 9,
      reason: "Recomputed after current plan change",
      confirmed: true,
    },
  );
  assert.ok(await view.findByText("Transition review updated"));
  assert.ok(view.getByText(/impact preview was refreshed/i));
});

test("immutable plan conflicts are described as action failures", () => {
  const view = render(
    <ErrorState
      context="action"
      title="Plan version was not created"
      error={
        new ApiError({
          code: "immutable_plan",
          retryable: false,
          safe_message: "The request could not be completed.",
          status: 409,
        })
      }
    />,
  );
  assert.ok(view.getByText("Plan version was not created"));
  assert.ok(
    view.getByText("This plan version already exists. Create a new version."),
  );
  assert.equal(view.queryByText("This page could not be loaded"), null);
});

test("plan transitions allow acknowledgement only while pending", async () => {
  const posts: any[] = [];
  const api = {
    get: async (path: string) => {
      if (path.startsWith("/v1/admin/users?"))
        return { items: [], next_cursor: null };
      if (path === "/v1/admin/plan")
        return {
          plan_id: "configured-free",
          plan_version: 1,
          version: 1,
          member_capacity: 50,
          usage_retention_months: 6,
          mode: "hosted",
          billing_status: "not_configured",
          transitions: [
            {
              transition_id: "pending-1",
              status: "pending",
              version: 4,
              acknowledged: false,
              acknowledgement_required: true,
              retention_shortened: true,
              effective_at: "2026-10-01T00:00:00.000Z",
              current_entitlement: {
                plan_id: "configured-free",
                plan_version: 1,
                capacity: 50,
                retention_months: 6,
                timezone: "Europe/Berlin",
              },
              target_entitlement: {
                plan_id: "short-retention",
                plan_version: 2,
                capacity: 75,
                retention_months: 1,
                timezone: "Europe/Berlin",
              },
              retention_preview: {
                request_count: "2",
                attempt_count: "4",
                cutoff: "2026-09-01T22:00:00.000Z",
                counted_at: "2026-09-10T12:00:00.000Z",
              },
            },
            {
              transition_id: "review-1",
              status: "review_required",
              version: 3,
              acknowledged: false,
              acknowledgement_required: true,
              retention_shortened: true,
              effective_at: "2026-11-01T00:00:00.000Z",
            },
            {
              transition_id: "cancelled-1",
              status: "cancelled",
              version: 2,
              acknowledged: false,
              acknowledgement_required: false,
              retention_shortened: false,
              effective_at: "2026-12-01T00:00:00.000Z",
            },
            {
              transition_id: "automatic-1",
              status: "pending",
              version: 2,
              acknowledged: false,
              acknowledgement_required: false,
              retention_shortened: false,
              effective_at: "2026-12-15T00:00:00.000Z",
              current_entitlement: {
                plan_id: "configured-free",
                plan_version: 1,
                capacity: 50,
                retention_months: 6,
              },
              target_entitlement: {
                plan_id: "larger",
                plan_version: 1,
                capacity: 100,
                retention_months: 6,
              },
            },
            {
              transition_id: "acknowledged-1",
              status: "pending",
              version: 5,
              acknowledged: true,
              acknowledgement_required: true,
              retention_shortened: true,
              effective_at: "2026-10-15T00:00:00.000Z",
              current_entitlement: {
                plan_id: "configured-free",
                plan_version: 1,
                capacity: 50,
                retention_months: 6,
              },
              target_entitlement: {
                plan_id: "one-month",
                plan_version: 1,
                capacity: 50,
                retention_months: 1,
              },
              retention_preview: {
                request_count: "1",
                attempt_count: "2",
                cutoff: "2026-09-14T22:00:00.000Z",
                counted_at: "2026-09-10T12:00:00.000Z",
              },
            },
            {
              transition_id: "applied-1",
              status: "applied",
              version: 6,
              acknowledged: true,
              acknowledgement_required: true,
              retention_shortened: true,
              effective_at: "2026-09-01T00:00:00.000Z",
              base_entitlement: {
                plan_id: "configured-free",
                plan_version: 1,
                capacity: 50,
                retention_months: 6,
              },
              current_entitlement: {
                plan_id: "one-month",
                plan_version: 1,
                capacity: 500,
                retention_months: 1,
              },
              target_entitlement: {
                plan_id: "one-month",
                plan_version: 1,
                capacity: 500,
                retention_months: 1,
              },
              retention_preview: {
                request_count: "2",
                attempt_count: "2",
                cutoff: "2026-08-01T00:00:00.000Z",
                counted_at: "2026-08-31T12:00:00.000Z",
              },
            },
          ],
        };
      throw new Error(`unexpected ${path}`);
    },
    post: async (path: string, body: any) => {
      const code = actionCodeAnswer(path);
      if (code) return code;
      posts.push({ path, body });
      return {};
    },
  } as any;
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(<AdminPlan api={api} session={ADMIN_SESSION} />);
  assert.ok(
    await view.findByText(
      /operator review is required before an organization admin/i,
    ),
  );
  assert.ok(view.getByText("Cancelled"));
  assert.ok(view.getAllByText(/has no remaining admin action/i).length >= 1);
  assert.ok(view.getByText("Acknowledged, waiting for application"));
  assert.ok(view.getByText("Scheduled for automatic application"));
  assert.ok(
    view.getByText(/no organization admin acknowledgement is required/i),
  );
  const appliedNotice = view.getByText("Applied").closest(".notice");
  assert.ok(appliedNotice);
  assert.ok(
    within(appliedNotice as HTMLElement).getByText(
      /historical preview counted 2/i,
    ),
  );
  assert.equal(
    within(appliedNotice as HTMLElement).queryByText(/would be removed/i),
    null,
  );
  assert.equal(view.queryByText("1 months"), null);
  assert.ok(view.getAllByText("1 month").length >= 1);
  assert.ok(view.getByText("short-retention v2"));
  assert.ok(
    view.getByText(/2 request families and 4 attempts would be removed/i),
  );
  const acknowledge = view.getByRole("button", {
    name: "Review scheduled change",
  });
  assert.equal(
    view.queryAllByRole("button", { name: acknowledge.textContent! }).length,
    1,
  );
  await user.click(acknowledge);
  const confirm = view.getByRole("button", { name: "Confirm acknowledgement" });
  assert.equal((confirm as HTMLButtonElement).disabled, true);
  await user.click(
    view.getByLabelText(
      "I reviewed the target plan, capacity, retention cutoff and record impact.",
    ),
  );
  // Reviewed but without a fresh email code, the acknowledgement still waits.
  assert.equal((confirm as HTMLButtonElement).disabled, true);
  await verifyActionCode(view, user);
  await user.click(confirm);
  await waitFor(() => assert.equal(posts.length, 1));
  assert.equal(posts[0].body.transition_id, "pending-1");
  assert.equal(posts[0].body.expected_version, 4);
  assert.equal(posts[0].body.reauth_token, "action-token");
  assert.match(posts[0].body.idempotency_key, /^[0-9a-f-]{36}$/);
});

/** The answers to the action code steps, or null for any other path. */
function actionCodeAnswer(path: string) {
  if (path === "/v1/auth/otp/request")
    return {
      challenge_id: "challenge-1",
      delivery_state: "accepted",
      expires_at: "2026-10-14T12:05:00.000Z",
      retry_at: "2099-01-01T00:00:00.000Z",
      error_code: null,
    };
  if (path === "/v1/auth/otp/verify") return { reauth_token: "action-token" };
  return null;
}

function policyApi(writes: Array<{ path: string; body: any }>, policyError?: ApiError) {
  return {
    get: async (path: string) => {
      if (path === "/v1/config")
        return {
          policy_version: "1.0.3",
          timezone: "Europe/Berlin",
          pause_mode: "user_controlled",
          company_sharing: "disabled",
          usage_retention_months: 12,
        };
      if (path === "/v1/admin/plan") return { usage_retention_months: 24 };
      if (path === "/v1/methods") return { methods: [] };
      throw new Error(`unexpected GET ${path}`);
    },
    post: async (path: string, body: any) => {
      writes.push({ path, body });
      const code = actionCodeAnswer(path);
      if (code) return code;
      if (path === "/v1/admin/exports")
        return { export_id: "export-1", expires_at: "2026-10-15T12:00:00.000Z", download_path: "/v1/admin/exports/export-1/download" };
      throw new Error(`unexpected POST ${path}`);
    },
    put: async (path: string, body: any) => {
      writes.push({ path, body });
      if (policyError) throw policyError;
      return { ...body, usage_retention_months: 12, policy_version: "1.0.4" };
    },
  } as any;
}

test("a policy change waits for a fresh action code and sends it with the change", async () => {
  const writes: Array<{ path: string; body: any }> = [];
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(<AdminPolicies api={policyApi(writes)} session={ADMIN_SESSION} />);
  await user.click(await view.findByRole("switch", { name: "Show organization totals to everyone" }));
  await user.click(view.getByRole("button", { name: "Save changes" }));
  const dialog = within(view.getByRole("dialog"));
  assert.ok(dialog.getByText("Save policy changes?"));
  const confirm = () => dialog.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
  assert.equal(confirm().disabled, true, "no change without a verified code");
  assert.equal(writes.length, 0);
  assert.equal((dialog.getByLabelText("Confirm your work email") as HTMLInputElement).value, "admin@example.test");
  await verifyActionCode(view, user);
  assert.equal(writes[0]!.body.purpose, "action_reauth");
  assert.equal(writes[0]!.body.email, "admin@example.test");
  await user.click(confirm());
  await waitFor(() => assert.ok(writes.find((write) => write.path === "/v1/admin/policy")));
  const change = writes.find((write) => write.path === "/v1/admin/policy")!;
  assert.equal(change.body.company_sharing, "threshold");
  assert.equal(change.body.expected_version, "1.0.3");
  assert.equal(change.body.reauth_token, "action-token");
  assert.match(change.body.idempotency_key, /^[0-9a-f-]{36}$/);
  await waitFor(() => assert.equal(view.queryByRole("dialog"), null));
});

test("a shorter usage retention asks for a fresh action code in its warning dialog", async () => {
  const writes: Array<{ path: string; body: any }> = [];
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(
    <AdminPolicies
      api={policyApi(
        writes,
        new ApiError({ code: "reauthentication_required", retryable: false, safe_message: "Confirm with a new email code.", status: 403 }),
      )}
      session={ADMIN_SESSION}
    />,
  );
  fireEvent.change(await view.findByLabelText("Keep usage records"), { target: { value: "3" } });
  await user.click(view.getByRole("button", { name: "Save changes" }));
  const dialog = within(view.getByRole("dialog"));
  assert.ok(dialog.getByText("Keep usage records for 3 months?"));
  const confirm = () => dialog.getByRole("button", { name: "Save and delete" }) as HTMLButtonElement;
  assert.equal(confirm().disabled, true);
  await verifyActionCode(view, user);
  await user.click(confirm());
  // A refused code sends the dialog back to the email step, and nothing counts as saved.
  await dialog.findByRole("button", { name: "Email a fresh action code" });
  assert.equal(confirm().disabled, true);
  assert.equal(writes.filter((write) => write.path === "/v1/admin/policy").at(-1)!.body.usage_retention, "3");
});

test("an export starts only after a fresh action code", async () => {
  const writes: Array<{ path: string; body: any }> = [];
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(<AdminExports api={policyApi(writes)} session={ADMIN_SESSION} />);
  fireEvent.change(view.getByLabelText("From"), { target: { value: "2026-09-01" } });
  fireEvent.change(view.getByLabelText("To, exclusive"), { target: { value: "2026-10-01" } });
  await user.click(view.getByRole("button", { name: "Create CSV" }));
  const dialog = within(view.getByRole("dialog"));
  const confirm = () => dialog.getByRole("button", { name: "Create CSV" }) as HTMLButtonElement;
  assert.equal(confirm().disabled, true, "no export without a verified code");
  assert.equal(writes.length, 0);
  await verifyActionCode(view, user);
  await user.click(confirm());
  await view.findByText("Export ready.");
  const created = writes.find((write) => write.path === "/v1/admin/exports")!;
  assert.equal(created.body.start, "2026-09-01");
  assert.equal(created.body.end, "2026-10-01");
  // Organization summaries only: no per-record report and no person filter.
  assert.equal(created.body.report, "summary");
  assert.equal("user_id" in created.body, false);
  assert.equal(created.body.reauth_token, "action-token");
  assert.match(created.body.idempotency_key, /^[0-9a-f-]{36}$/);
  assert.equal(view.queryByRole("dialog"), null);
});

test("operator exception revocation requires confirmation and an acknowledged reversion", async () => {
  const deletes: any[] = [];
  const organization = {
    company_id: "company-1",
    name: "Example Company",
    origin: "https://tenant.example",
    status: "active",
    version: 3,
    capacity: 75,
    retention_months: 12,
    plan_id: "configured-free",
    plan_version: 1,
  };
  const exception = {
    exception_id: "exception-1",
    status: "active",
    version: 1,
    member_capacity: 75,
    retention_months: 12,
    effective_at: "2026-09-01T00:00:00.000Z",
    expires_at: "2026-10-01T00:00:00.000Z",
    reason: "Temporary team expansion",
    reversion_transition_id: "transition-1",
    company_id: "company-1",
    company_name: "Example Company",
    retention_shortened: true,
    acknowledged: true,
  };
  const api = {
    get: async (path: string) => {
      if (path.startsWith("/v1/operator/organizations?"))
        return { items: [organization], next_cursor: null };
      if (path.startsWith("/v1/operator/domain-claims"))
        return { items: [], next_cursor: null };
      if (path.startsWith("/v1/operator/exceptions?"))
        return {
          items: [
            exception,
            {
              ...exception,
              exception_id: "exception-2",
              company_name: "Waiting Company",
              acknowledged: false,
            },
          ],
          next_cursor: null,
        };
      throw new Error(`unexpected ${path}`);
    },
    post: async (path: string, body: any) => operatorCode(path, body),
    delete: async (path: string, body: any) => {
      deletes.push({ path, body });
      return { status: "revocation_scheduled", transition_id: "transition-1" };
    },
  } as any;
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(<OperatorExceptions api={api} email={DEVELOPER_EMAIL} />);
  // An exception whose shorter retention is not acknowledged cannot be revoked yet.
  await view.findByText("Waiting for the admin to acknowledge");
  assert.equal(
    view.queryByRole("button", { name: "Revoke the exception for Waiting Company" }),
    null,
  );
  await user.click(
    view.getByRole("button", { name: "Revoke the exception for Example Company" }),
  );
  assert.equal(deletes.length, 0);
  await view.findByRole("dialog", { name: "Revoke this exception?" });
  const revokeButton = view.getByRole("button", { name: "Revoke exception" });
  assert.equal((revokeButton as HTMLButtonElement).disabled, true);
  await user.type(
    view.getByLabelText("Reason for revoking"),
    "Temporary capacity is no longer needed",
  );
  assert.equal((revokeButton as HTMLButtonElement).disabled, true);
  await verifyOperatorCode(view.getByRole("dialog"), user);
  await user.click(revokeButton);
  await waitFor(() => assert.equal(deletes.length, 1));
  assert.equal(deletes[0].body.reauth_token, "operator-token");
  assert.equal(
    deletes[0].path,
    "/v1/operator/organizations/company-1/exceptions/exception-1",
  );
  assert.equal(deletes[0].body.transition_acknowledgement, "transition-1");
  assert.equal(
    deletes[0].body.reason,
    "Temporary capacity is no longer needed",
  );
  await view.findByText(/The exception for Example Company ends now/);
});

test("operator atomically replaces an exception with current version proofs", async () => {
  const replacements: any[] = [];
  const organization = {
    company_id: "company-1",
    name: "Example Company",
    origin: "https://tenant.example",
    status: "active",
    version: 8,
    entitlement_generation: 7,
    capacity: 75,
    retention_months: 12,
    plan_id: "exception-plan",
    plan_version: 1,
  };
  const transition = {
    transition_id: "reversion-1",
    plan: "configured-free:1",
    effective_at: "2026-10-01T00:00:00.000Z",
    acknowledged: false,
    version: 3,
    retention_shortened: true,
    status: "pending",
    company_version: 8,
    current_entitlement_generation: 7,
    operator_can_cancel: false,
    operator_can_review: false,
    exception_id: "exception-1",
    retention_preview: { request_count: "5", attempt_count: "10" },
  };
  const exception = {
    exception_id: "exception-1",
    status: "active",
    version: 2,
    member_capacity: 75,
    retention_months: 12,
    effective_at: "2026-09-01T00:00:00.000Z",
    expires_at: "2026-10-01T00:00:00.000Z",
    reason: "Temporary team expansion",
    reversion_transition_id: "reversion-1",
  };
  const api = {
    get: async (path: string) => {
      if (path.startsWith("/v1/operator/organizations?"))
        return { items: [organization], next_cursor: null };
      if (path === "/v1/operator/organizations/company-1") return organization;
      if (path.startsWith("/v1/operator/plans?"))
        return {
          items: [
            {
              plan_id: "long",
              version: 2,
              member_capacity: 100,
              retention_months: 18,
            },
          ],
          next_cursor: null,
        };
      if (path.includes("/transitions"))
        return { items: [transition], next_cursor: null };
      if (path.includes("/exceptions"))
        return { items: [exception], next_cursor: null };
      throw new Error(`unexpected ${path}`);
    },
    post: async (path: string, body: any) => {
      const code = operatorCode(path, body);
      if (code) return code;
      replacements.push({ path, body });
      return {
        status: "assigned",
        exception_id: "exception-1",
        superseded_transition_id: "reversion-1",
        transition_id: null,
        version: 9,
        entitlement_generation: 8,
      };
    },
  } as any;
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(<OperatorOrganizations api={api} email={DEVELOPER_EMAIL} />);
  await user.click(
    await view.findByRole("button", { name: "Manage Example Company" }),
  );
  const replace = await view.findByRole("button", {
    name: "Replace exception with plan",
  });
  await user.click(replace);
  await user.click(view.getByRole("button", { name: "Keep exception" }));
  await waitFor(() => assert.equal(document.activeElement, replace));
  await user.click(replace);
  await user.selectOptions(view.getByLabelText("Replacement plan"), "long:2");
  await user.type(
    view.getByLabelText("Replacement reason"),
    "Reviewed permanent entitlement",
  );
  await verifyOperatorCode(view.getByRole("region", { name: "Exception replacement" }), user);
  await user.click(
    view.getByRole("button", { name: "Confirm exception replacement" }),
  );
  await waitFor(() => assert.equal(replacements.length, 1));
  assert.equal(replacements[0].body.reauth_token, "operator-token");
  assert.equal(
    replacements[0].path,
    "/v1/operator/organizations/company-1/exceptions/exception-1/replace",
  );
  assert.deepEqual(
    {
      expected_version: replacements[0].body.expected_version,
      expected_company_version: replacements[0].body.expected_company_version,
      expected_transition_version:
        replacements[0].body.expected_transition_version,
      expected_entitlement_generation:
        replacements[0].body.expected_entitlement_generation,
      plan_id: replacements[0].body.plan_id,
      plan_version: replacements[0].body.plan_version,
      confirmed: replacements[0].body.confirmed,
    },
    {
      expected_version: 2,
      expected_company_version: 8,
      expected_transition_version: 3,
      expected_entitlement_generation: 7,
      plan_id: "long",
      plan_version: 2,
      confirmed: true,
    },
  );
  assert.ok(await view.findByText("Exception replaced"));
  assert.ok(view.getByText(/selected plan is now assigned/i));
});

test("developer contact inbox marks, closes and deletes requests and keeps the new count in step", async () => {
  const contacts = [
    {
      id: "a".repeat(64),
      topic: "larger_organization",
      status: "new",
      received_at: "2026-10-11T08:14:00.000Z",
      updated_at: "2026-10-11T08:14:00.000Z",
      name: "Jonas Albers",
      email: "j.albers@hafenwerk.example",
      organization: "Hafenwerk Logistik GmbH",
      people: "101-250",
      message: "Can we have more than 50 members?",
    },
    {
      id: "b".repeat(64),
      topic: "self_hosting",
      status: "closed",
      received_at: "2026-10-02T15:05:00.000Z",
      updated_at: "2026-10-03T09:00:00.000Z",
      name: "Ole Brandt",
      email: "o.brandt@atlas.example",
      organization: "",
      people: null,
      message: "Which database do you support?",
    },
  ];
  const posts: any[] = [];
  const deletes: string[] = [];
  const deleteBodies: any[] = [];
  const api = {
    get: async (path: string) => {
      if (path.startsWith("/v1/operator/contacts"))
        return { items: contacts, counts: { new: 1, replied: 0, closed: 1 } };
      throw new Error(`unexpected ${path}`);
    },
    post: async (path: string, body: any) => {
      const code = operatorCode(path, body);
      if (code) return code;
      posts.push({ path, body });
      return { ...contacts[0], status: body.status, updated_at: "2026-10-12T10:00:00.000Z" };
    },
    delete: async (path: string, body: any) => {
      deletes.push(path);
      deleteBodies.push(body);
      return { deleted: true };
    },
  } as any;
  function Badge() {
    const count = useNewContactCount(api);
    return <span aria-label="New requests">{count ?? "none"}</span>;
  }
  const navigated: string[] = [];
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(
    <>
      <Badge />
      <OperatorContacts
        api={api}
        navigate={(to: string) => navigated.push(to)}
        email={DEVELOPER_EMAIL}
      />
    </>,
  );
  await view.findByRole("heading", { name: "Jonas Albers" });
  assert.ok(view.getByRole("button", { name: "New (1)" }));
  assert.ok(view.getByText("101 to 250"));
  assert.equal(
    view.getByRole("link", { name: "Reply by email" }).getAttribute("href")?.startsWith("mailto:j.albers@hafenwerk.example?subject="),
    true,
  );
  await waitFor(() => assert.equal(view.getByLabelText("New requests").textContent, "1"));
  await user.click(view.getByRole("link", { name: "Grant more members" }));
  assert.deepEqual(navigated, ["/operator/exceptions"]);
  await user.click(view.getByRole("button", { name: "Mark as replied" }));
  await waitFor(() => assert.equal(posts.length, 1));
  assert.deepEqual(posts[0], { path: "/v1/operator/contacts/" + "a".repeat(64), body: { status: "replied" } });
  // The request leaves the New tab and the sidebar count drops at once.
  await view.findByText("No requests here.");
  assert.equal(view.getByLabelText("New requests").textContent, "0");
  assert.ok(view.getByRole("status").textContent?.includes("Marked the request from Jonas Albers as replied."));
  await user.click(view.getByRole("button", { name: "Closed (1)" }));
  await view.findByRole("heading", { name: "Ole Brandt" });
  assert.ok(view.getByText("Not asked"));
  assert.ok(view.getByRole("button", { name: "Reopen" }));
  await user.click(view.getByRole("button", { name: "Delete" }));
  const confirmDelete = await view.findByRole("dialog", { name: "Delete the request from Ole Brandt?" });
  assert.equal(deletes.length, 0);
  // Marking needs no code; deleting removes the request for good, so it does.
  assert.equal((view.getByRole("button", { name: "Delete request" }) as HTMLButtonElement).disabled, true);
  await verifyOperatorCode(confirmDelete, user);
  await user.click(view.getByRole("button", { name: "Delete request" }));
  await waitFor(() => assert.deepEqual(deletes, ["/v1/operator/contacts/" + "b".repeat(64)]));
  assert.equal(deleteBodies[0].reauth_token, "operator-token");
  assert.match(deleteBodies[0].idempotency_key, /^[0-9a-f-]{36}$/);
  await view.findByText("No requests here.");
  assert.ok(view.getByRole("button", { name: "All (1)" }));
});

test("developer organizations summarize members, exceptions and new contact requests", async () => {
  const organizations = [
    { company_id: "c1", name: "Example Consulting GmbH", origin: "https://0f2c6a1b6d444b649f8e0c4a3d2f1e7b.aifootprinttracker.com", domain: "example-consulting.de", status: "active", version: 2, capacity: 50, retention_months: null, plan_id: "hosted-free", plan_version: 3, members: 40, retention_choice: null },
    { company_id: "c2", name: "Fair Facts e.V.", origin: "https://5b1e0d0c2f3a4c6e8a9b7c6d5e4f3a2b.aifootprinttracker.com", domain: "fairfacts.org", status: "active", version: 1, capacity: 50, retention_months: null, plan_id: "hosted-free", plan_version: 3, members: 16, retention_choice: 12 },
    { company_id: "c3", name: "Atlas Logistics", origin: "https://atlas.aifootprinttracker.com", domain: "atlas-logistics.com", status: "suspended", version: 5, capacity: 50, retention_months: null, plan_id: "hosted-free", plan_version: 3, members: 12, retention_choice: null },
  ];
  const api = {
    get: async (path: string) => {
      if (path.startsWith("/v1/operator/organizations?")) return { items: organizations, next_cursor: null };
      if (path.startsWith("/v1/operator/exceptions?"))
        return { items: [{ exception_id: "e1", status: "active", expires_at: "2026-11-01T00:00:00.000Z", company_id: "c1" }], next_cursor: null };
      if (path.startsWith("/v1/operator/contacts")) return { items: [], counts: { new: 3 } };
      throw new Error(`unexpected ${path}`);
    },
  } as any;
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(<OperatorOrganizations api={api} />);
  await view.findByText("2 active, 1 suspended");
  // Members count only active organizations.
  assert.ok(view.getByText("56"));
  await view.findByText("3 new");
  assert.ok(view.getByText("40 of 50"));
  assert.ok(view.getByText("12 months, set by admin"));
  assert.ok(view.getAllByText("Hosted free v3").length === 3);
  assert.ok(view.getByRole("button", { name: "Restore Atlas Logistics" }));
  const names = () => [...view.container.querySelectorAll("tbody th")].map((cell) => cell.firstChild?.textContent);
  // Sorted by name, whatever order the server pages them in.
  assert.deepEqual(names(), ["Atlas Logistics", "Example Consulting GmbH", "Fair Facts e.V."]);
  assert.ok(view.getByText("example-consulting.de"));
  assert.equal(view.queryByText(/0f2c6a1b6d444b649f8e0c4a3d2f1e7b/), null);
  await user.type(view.getByPlaceholderText("Search organizations"), "fair");
  assert.deepEqual(names(), ["Fair Facts e.V."]);
  await user.type(view.getByPlaceholderText("Search organizations"), "{Backspace>4/}");
  await user.type(view.getByPlaceholderText("Search organizations"), "consulting.de");
  assert.deepEqual(names(), ["Example Consulting GmbH"]);
  await user.type(view.getByPlaceholderText("Search organizations"), "{Backspace>13/}");
  assert.equal(names().length, 3);
  await user.click(view.getByRole("button", { name: "State: All states" }));
  await user.click(view.getByRole("menuitemradio", { name: "Suspended" }));
  assert.deepEqual(names(), ["Atlas Logistics"]);
});

test("suspending an organization waits for a fresh developer code and asks again after a refusal", async () => {
  const organization = { company_id: "c1", name: "Example Consulting GmbH", origin: "https://example.test", domain: "example-consulting.de", status: "active", version: 2, capacity: 50, retention_months: null, plan_id: "hosted-free", plan_version: 3, members: 4, retention_choice: null };
  const puts: any[] = [];
  let refuse = true;
  const api = {
    get: async (path: string) => {
      if (path.startsWith("/v1/operator/organizations?")) return { items: [organization], next_cursor: null };
      if (path.startsWith("/v1/operator/exceptions?")) return { items: [], next_cursor: null };
      if (path.startsWith("/v1/operator/contacts")) return { items: [], counts: { new: 0 } };
      throw new Error(`unexpected ${path}`);
    },
    post: async (path: string, body: any) => operatorCode(path, body),
    put: async (path: string, body: any) => {
      puts.push({ path, body });
      if (refuse) {
        refuse = false;
        throw new ApiError({ code: "reauthentication_required", retryable: false, safe_message: "Confirm with a new email code.", status: 403 });
      }
      return { status: "suspended", version: 3 };
    },
  } as any;
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(<OperatorOrganizations api={api} email={DEVELOPER_EMAIL} />);
  await user.click(await view.findByRole("button", { name: "Suspend Example Consulting GmbH" }));
  const dialog = view.getByRole("dialog");
  await user.type(within(dialog).getByLabelText("Reason"), "Confirmed abuse report");
  const suspend = () => within(dialog).getByRole("button", { name: "Suspend service" }) as HTMLButtonElement;
  assert.equal(suspend().disabled, true, "no change without a verified code");
  await verifyOperatorCode(dialog, user);
  await user.click(suspend());
  // A refused code sends the dialog back to the email step.
  await within(dialog).findByRole("button", { name: "Email a fresh action code" });
  assert.equal(suspend().disabled, true);
  await verifyOperatorCode(dialog, user);
  await user.click(suspend());
  await waitFor(() => assert.equal(puts.length, 2));
  assert.equal(puts[1].path, "/v1/operator/organizations/c1/status");
  assert.equal(puts[1].body.status, "suspended");
  assert.equal(puts[1].body.reauth_token, "operator-token");
  await waitFor(() => assert.equal(view.queryByRole("dialog"), null));
});

test("granting an exception and approving a domain each wait for a fresh developer code", async () => {
  const organization = { company_id: "company-1", name: "Example Company", origin: "https://tenant.example", status: "active", version: 3, capacity: 50, retention_months: 12, plan_id: "configured-free", plan_version: 1 };
  const writes: any[] = [];
  const api = {
    get: async (path: string) => {
      if (path.startsWith("/v1/operator/organizations?")) return { items: [organization], next_cursor: null };
      if (path.startsWith("/v1/operator/domain-claims")) return { items: [], next_cursor: null };
      if (path.startsWith("/v1/operator/exceptions?")) return { items: [], next_cursor: null };
      throw new Error(`unexpected ${path}`);
    },
    post: async (path: string, body: any) => {
      const code = operatorCode(path, body);
      if (code) return code;
      writes.push({ path, body });
      if (path === "/v1/operator/domain-claims")
        return { approval_id: "a1", domain: body.domain, version: 1, reason: body.reason, reviewed_at: "2026-10-14T12:00:00.000Z", expires_at: body.expires_at, status: "approved" };
      return { exception_id: "e1", status: "active", version: 1, member_capacity: 80, retention_months: 12, effective_at: "2026-10-14T12:00:00.000Z", expires_at: "2026-11-30T23:00:00.000Z", reason: body.reason, reversion_transition_id: "t1" };
    },
  } as any;
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(<OperatorExceptions api={api} email={DEVELOPER_EMAIL} />);
  const grant = view.getByRole("region", { name: "Grant an exception" });
  const card = within(grant);
  await waitFor(() => assert.ok(card.getByRole("option", { name: "Example Company" })));
  await user.selectOptions(card.getByLabelText("Organization"), "company-1");
  fireEvent.change(card.getByLabelText("Member capacity"), { target: { value: "80" } });
  fireEvent.change(card.getByLabelText(/^Ends/), { target: { value: "2099-11-30" } });
  await user.type(card.getByLabelText("Reason"), "Contact request for 80 members");
  const grantButton = card.getByRole("button", { name: "Grant exception" }) as HTMLButtonElement;
  assert.equal(grantButton.disabled, true);
  await verifyOperatorCode(grant, user);
  await user.click(grantButton);
  await waitFor(() => assert.equal(writes.length, 1));
  assert.equal(writes[0].path, "/v1/operator/organizations/company-1/exceptions");
  assert.equal(writes[0].body.reauth_token, "operator-token");
  await card.findByText(/can have up to 80 members/);
  const domains = view.getByRole("region", { name: "Work email domains" });
  const domainCard = within(domains);
  await user.type(domainCard.getByLabelText("Domain"), "example-group.com");
  fireEvent.change(domainCard.getByLabelText("Approval ends"), { target: { value: "2099-11-30" } });
  await user.type(domainCard.getByLabelText("Reason"), "Subsidiary of Example Company");
  const approve = domainCard.getByRole("button", { name: "Approve domain" }) as HTMLButtonElement;
  assert.equal(approve.disabled, true);
  await verifyOperatorCode(domains, user);
  await user.click(approve);
  await waitFor(() => assert.equal(writes.length, 2));
  assert.equal(writes[1].path, "/v1/operator/domain-claims");
  assert.equal(writes[1].body.domain, "example-group.com");
  assert.equal(writes[1].body.reauth_token, "operator-token");
  await domainCard.findByText(/One more organization may register with example-group.com/);
});

test("the admin logo opens the Overview and the developer panel logo opens the public website", async () => {
  const { AppLayout } = await import("../src/components");
  const visits: string[] = [];
  const admin = render(
    <AppLayout mode="admin" path="/admin/plan" navigate={(to) => visits.push(to)} onLogout={() => {}}>
      <p>Page</p>
    </AppLayout>,
  );
  const adminLogos = [...admin.container.querySelectorAll<HTMLAnchorElement>("a.brand")];
  assert.equal(adminLogos.length, 2, "the sidebar logo and the phone header logo");
  for (const link of adminLogos) {
    assert.equal(link.getAttribute("href"), "/admin");
    assert.equal(link.getAttribute("aria-label"), "AI Footprint Organization admin, Overview");
    fireEvent.click(link);
  }
  assert.deepEqual(visits, ["/admin", "/admin"]);
  admin.unmount();
  const operator = render(
    <AppLayout mode="operator" path="/operator" navigate={() => {}} onLogout={() => {}}>
      <p>Page</p>
    </AppLayout>,
  );
  const links = operator.getAllByRole("link", { name: /AI Footprint Tracker website/ });
  assert.ok(links.length >= 1);
  for (const link of links) assert.equal(link.getAttribute("href"), "https://aifootprinttracker.com");
  assert.equal(operator.container.querySelector(".nav-website"), null, "the developer panel has no Main website entry");
  operator.unmount();
});

test("a domain exception names the work domain only", async () => {
  const posts: any[] = [];
  const api = {
    get: async (path: string) => {
      if (path.startsWith("/v1/operator/organizations?")) return { items: [], next_cursor: null };
      if (path.startsWith("/v1/operator/exceptions?")) return { items: [], next_cursor: null };
      if (path.startsWith("/v1/operator/domain-claims"))
        return {
          items: [
            {
              approval_id: "a".repeat(64),
              domain: "example-group.com",
              version: 1,
              reason: "Group subsidiary",
              reviewed_at: "2026-10-01T09:00:00.000Z",
              expires_at: "2026-10-01T09:00:00.000Z",
              status: "consumed",
            },
          ],
          next_cursor: null,
        };
      throw new Error(`unexpected ${path}`);
    },
    post: async (path: string, body: any) => {
      const code = operatorCode(path, body);
      if (code) return code;
      posts.push({ path, body });
      return { ...body, approval_id: "a".repeat(64), version: 2, reviewed_at: "2026-10-13T09:00:00.000Z", status: "approved" };
    },
  } as any;
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(<OperatorExceptions api={api} email={DEVELOPER_EMAIL} />);
  await view.findByText("example-group.com");
  const card = within(view.getByRole("heading", { name: "Work email domains" }).closest("section")!);
  assert.equal(card.queryByLabelText(/Organization address/), null);
  await user.type(card.getByLabelText("Domain"), "Example-Group.com");
  await user.type(card.getByLabelText("Approval ends"), "2030-01-31");
  await user.type(card.getByLabelText("Reason"), "Second subsidiary");
  await verifyOperatorCode(view.getByRole("region", { name: "Work email domains" }), user);
  await user.click(card.getByRole("button", { name: "Approve domain" }));
  await waitFor(() => assert.equal(posts.length, 1));
  assert.equal(posts[0].path, "/v1/operator/domain-claims");
  // The next version of the one record for this domain, with no organization address in it.
  assert.deepEqual(Object.keys(posts[0].body).sort(), ["domain", "expected_version", "expires_at", "idempotency_key", "reason", "reauth_token"]);
  assert.equal(posts[0].body.domain, "example-group.com");
  assert.equal(posts[0].body.expected_version, 1);
  await view.findByText(/One more organization may register with example-group.com until/);
});

/**
 * Pastes into an email code field as a browser does: the browser cuts pasted text to the field's
 * maxLength before the page sees it. jsdom does not, so the cut is applied here.
 */
async function pasteCode(input: HTMLInputElement, text: string) {
  const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
  const limit = input.maxLength;
  input.focus();
  setValue.call(input, limit >= 0 ? text.slice(0, limit) : text);
  // React loads before this file installs jsdom as the window, so it watches text fields through
  // key events instead of input events; a key-up makes it read the pasted value.
  fireEvent.keyUp(input);
  await waitFor(() => assert.doesNotMatch(input.value, /\D/));
  return input.value;
}

test("sign-in code field keeps all six digits of a pasted code with a space or a dash", async () => {
  const api = {
    setCsrf: () => {},
    post: async (path: string) => {
      if (path === "/v1/auth/otp/request") return challenge;
      throw new Error(`unexpected ${path}`);
    },
  } as any;
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(<LoginPage api={api} navigate={() => {}} />);
  await user.type(view.getByLabelText("Work email"), "person@example.com");
  await user.click(view.getByRole("button", { name: "Email me a code" }));
  await view.findByRole("heading", { name: "Check your inbox" });
  const input = view.getByLabelText("Verification code") as HTMLInputElement;
  // A raw maxLength would cut "094 475" to "094 47" before the space is dropped.
  assert.equal(input.getAttribute("maxlength"), null);
  assert.equal(await pasteCode(input, "094 475"), "094475");
  assert.equal(await pasteCode(input, "094-475"), "094475");
  assert.equal(input.getAttribute("autocomplete"), "one-time-code");
  assert.equal(input.getAttribute("inputmode"), "numeric");
});

test("deletion action code field keeps all six digits of a pasted code with a space or a dash", async () => {
  const api = {
    get: async () => ({ timezone: "Europe/Berlin" }),
    post: async (path: string) => {
      if (path === "/v1/auth/otp/request") return challenge;
      if (path !== "/v1/admin/deletions/preview") throw new Error(`unexpected ${path}`);
      return {
        state: "ready",
        counts_complete: true,
        request_count: "2",
        record_count: "6",
        historical_message_count: "0",
        undated_historical_message_count: "0",
        range_start: "2026-08-31T22:00:00.000Z",
        range_end: "2026-09-30T22:00:00.000Z",
        contribution_date_range: null,
        contribution_dates: [],
        expires_at: "2026-09-14T13:00:00.000Z",
        local_erasure: "Connected browsers will apply the deletion receipt.",
        preview_token: "preview",
      };
    },
  } as any;
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(
    <AdminDeletion
      api={api}
      session={{
        role: "admin",
        user_id: "user-1",
        company_id: "company-1",
        company_name: "Example",
        csrf_token: "csrf",
        email: "admin@example.com",
        expires_at: "2026-09-14T14:00:00.000Z",
      } as any}
    />,
  );
  await waitFor(() =>
    assert.equal((view.getByRole("button", { name: "Preview deletion" }) as HTMLButtonElement).disabled, false),
  );
  fireEvent.change(view.getByLabelText("Start"), { target: { value: "2026-09-01" } });
  fireEvent.change(view.getByLabelText("End, exclusive"), { target: { value: "2026-10-01" } });
  await user.click(view.getByRole("button", { name: "Preview deletion" }));
  await user.click(await view.findByRole("button", { name: "Email a fresh action code" }));
  const input = (await view.findByLabelText("Action verification code")) as HTMLInputElement;
  assert.equal(input.getAttribute("maxlength"), null);
  assert.equal(await pasteCode(input, "094 475"), "094475");
  assert.equal(await pasteCode(input, "094-475"), "094475");
  assert.equal(input.getAttribute("autocomplete"), "one-time-code");
  assert.equal(input.getAttribute("inputmode"), "numeric");
});

test("the Health page says the calculation method is loading, never that it is not available", async () => {
  let answerMethods!: (value: unknown) => void;
  const api = {
    get: (path: string) => {
      if (path === "/v1/admin/health")
        return Promise.resolve({ browsers_connected: 0, browsers_synced_last_day: 0, browsers_not_synced_3_days: 0, problems: [] });
      if (path === "/v1/methods") return new Promise((resolve) => (answerMethods = resolve));
      throw new Error(`unexpected ${path}`);
    },
  } as any;
  const view = render(<AdminHealth api={api} />);
  await view.findByText("Loading the calculation method.");
  assert.equal(view.queryByText("Calculation method not available."), null);
  answerMethods({ default_method_id: "ecologits-reference-2026-09-10-v1", methods: [] });
  await view.findByText("Calculated with ecologits-reference-2026-09-10-v1.");
});

// Live QA of 19 Oct 2026: rebuilt totals, which the service records as "system", were shown
// as the work of "A former member".
test("the audit log names the service for system actions and a former member only for a real member", async () => {
  const api = {
    get: (path: string) => {
      if (path.startsWith("/v1/admin/users"))
        return Promise.resolve({ items: [{ user_id: "user-1", email: "admin@example.com" }], next_cursor: null });
      if (path.startsWith("/v1/admin/audit"))
        return Promise.resolve({
          items: [
            { actor: "system", actor_kind: "system", action: "aggregate_rebuilt", target: "era-1", at: "2026-10-19T08:00:00.000Z", details: {} },
            { actor: "user-1", action: "policy_updated", target: null, at: "2026-10-19T07:00:00.000Z", details: {} },
            { actor: "user-gone", action: "policy_updated", target: null, at: "2026-10-19T06:00:00.000Z", details: {} },
          ],
          next_cursor: null,
        });
      throw new Error(`unexpected ${path}`);
    },
  } as any;
  const view = render(<AdminAudit api={api} />);
  await view.findByText("by admin@example.com");
  const entries = view.getByRole("region", { name: "Audit entries" }).textContent!;
  assert.match(entries, /by The service/);
  assert.match(entries, /by A former member/);
  assert.equal((entries.match(/A former member/g) ?? []).length, 1);
});

// Live QA of 19 Oct 2026: the page named the archived baseline's id; the shipped EcoLogits
// method has a long hashed id, so the page names its engine and release.
test("the Health page names the shipped EcoLogits method by its release", async () => {
  const id = "ecologits-0.11.2-" + "a".repeat(64);
  const api = {
    get: (path: string) => {
      if (path === "/v1/admin/health")
        return Promise.resolve({ browsers_connected: 0, browsers_synced_last_day: 0, browsers_not_synced_3_days: 0, problems: [] });
      if (path === "/v1/methods")
        return Promise.resolve({
          default_method_id: id,
          methods: [
            { method_id: "ecologits-reference-2026-09-10-v1", default: false },
            { method_id: id, default: true, engine_id: "ecologits", source_version: "0.11.2" },
          ],
        });
      throw new Error(`unexpected ${path}`);
    },
  } as any;
  const view = render(<AdminHealth api={api} />);
  await view.findByText("Calculated with EcoLogits 0.11.2.");
});

test("the Health page shows counts only and names no browser or person", async () => {
  // Owner decision of 18 October 2026: the server counts (a browser connected minutes ago is not
  // counted three days late, test_admin_people), and the page lists no browser, member or time.
  const paths: string[] = [];
  const api = {
    get: (path: string) => {
      paths.push(path);
      if (path === "/v1/admin/health")
        return Promise.resolve({
          browsers_connected: 3,
          browsers_synced_last_day: 1,
          browsers_not_synced_3_days: 2,
          problems: [{ code: "sync_failed", site: "chatgpt", browsers: 1 }],
        });
      if (path === "/v1/methods") return Promise.resolve({ default_method_id: "m", methods: [] });
      throw new Error(`unexpected ${path}`);
    },
  } as any;
  const view = render(<AdminHealth api={api} />);
  await view.findByText("2 browsers have not synced for 3 days");
  assert.ok(view.getByText("1 of 3 browsers synced"));
  assert.ok(view.getByText("Sync failed on ChatGPT"));
  assert.ok(view.getByText("1 browser reported this in their latest health report."));
  assert.equal(view.queryByRole("table"), null);
  assert.equal(paths.some((path) => path.startsWith("/v1/admin/users")), false);
});

test("deleting one person's records previews what goes without counting their records", async () => {
  const api = {
    get: async (path: string) =>
      path === "/v1/config"
        ? { timezone: "Europe/Berlin" }
        : {
            items: [
              { user_id: "user-2", email: "pat@example.test", role: "user", status: "active", membership_version: 1, installations: 1 },
            ],
            next_cursor: null,
          },
    post: async (path: string, body: any) => {
      assert.equal(path, "/v1/admin/deletions/preview");
      assert.deepEqual(body, { scope: "user", user_id: "user-2", start: null, end: null });
      return {
        state: "ready",
        scope: "user",
        counts_complete: true,
        counts_shown: false,
        deletes: ["Their requests and replies, with the estimates made for them", "Messages counted from their saved chats"],
        request_count: null,
        record_count: null,
        historical_message_count: null,
        undated_historical_message_count: null,
        range_start: "1970-01-01T00:00:00.000Z",
        range_end: "2026-09-30T22:00:00.000Z",
        contribution_date_range: { start: null, end: null },
        contribution_dates: [],
        expires_at: "2026-09-14T13:00:00.000Z",
        local_erasure: "Connected browsers will apply the deletion receipt.",
        preview_token: "preview",
      };
    },
  } as any;
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(<AdminDeletion api={api} session={ADMIN_SESSION as any} />);
  fireEvent.change(await view.findByLabelText("Scope"), { target: { value: "user" } });
  await view.findByRole("option", { name: "pat@example.test" });
  fireEvent.change(view.getByLabelText("Person"), { target: { value: "user-2" } });
  await user.click(view.getByRole("button", { name: "Preview deletion" }));
  await view.findByRole("heading", { name: "Deletion preview" });
  assert.ok(view.getByText("Their requests and replies, with the estimates made for them"));
  assert.ok(view.getByText(/does not reveal their usage/));
  assert.equal(view.queryByText("Requests"), null);
  assert.equal(view.queryByText("Daily totals affected"), null);
  assert.ok(view.getByText("Everything recorded for this member"));
});

// QA of 19 Oct 2026: a person's or the whole organization's preview said "Range 1 Jan 1970", the
// start the server stores when no date was chosen.
for (const scope of ["user", "company"] as const)
  test(`a ${scope === "user" ? "person's" : "whole organization's"} deletion preview names no 1970 start`, async () => {
    const api = {
      get: async (path: string) =>
        path === "/v1/config"
          ? { timezone: "Europe/Berlin" }
          : {
              items: [{ user_id: "user-2", email: "pat@example.test", role: "user", status: "active", membership_version: 1, installations: 1 }],
              next_cursor: null,
            },
      post: async () => ({
        state: "ready",
        scope,
        counts_complete: true,
        counts_shown: true,
        deletes: null,
        request_count: "4",
        record_count: "9",
        historical_message_count: "0",
        undated_historical_message_count: "0",
        range_start: "1970-01-01T00:00:00.000Z",
        range_end: "2026-09-30T22:00:00.000Z",
        contribution_date_range: { start: null, end: null },
        contribution_dates: [],
        expires_at: "2026-09-14T13:00:00.000Z",
        local_erasure: "Connected browsers will apply the deletion receipt.",
        preview_token: "preview",
      }),
    } as any;
    const user = userEvent.setup({ document: dom.window.document });
    const view = render(<AdminDeletion api={api} session={ADMIN_SESSION as any} />);
    fireEvent.change(await view.findByLabelText("Scope"), { target: { value: scope } });
    if (scope === "user") {
      await view.findByRole("option", { name: "pat@example.test" });
      fireEvent.change(view.getByLabelText("Person"), { target: { value: "user-2" } });
    }
    await user.click(view.getByRole("button", { name: "Preview deletion" }));
    await view.findByRole("heading", { name: "Deletion preview" });
    // Compared as text: a found element in an assertion diff makes node inspect the whole DOM.
    assert.doesNotMatch(view.container.textContent ?? "", /1970/);
    const range = view.getByText("Range").parentElement!;
    assert.match(range.textContent ?? "", /Everything recorded until/);
  });

test("the Plan page counts members without showing Unknown while the member list loads", async () => {
  let answerUsers!: (value: unknown) => void;
  const api = {
    get: (path: string) => {
      if (path === "/v1/admin/plan")
        return Promise.resolve({ plan_id: "hosted-free", plan_version: 3, version: 1, member_capacity: 50, usage_retention_months: null, mode: "hosted", billing_status: "free", transitions: [] });
      if (path.startsWith("/v1/admin/users")) return new Promise((resolve) => (answerUsers = resolve));
      if (path === "/v1/config") return Promise.resolve(null);
      throw new Error(`unexpected ${path}`);
    },
    post: async () => ({}),
  } as any;
  const view = render(<AdminPlan api={api} />);
  await view.findByText("Counting members");
  assert.equal(view.queryByText(/Unknown/), null);
  answerUsers({ items: [{ user_id: "u1", email: "admin@example.org", status: "active" }], next_cursor: null });
  await view.findByText("1 of 50");
});

// The per-person pages below show only while the server has person analytics (and, for Network,
// IP collection) switched on; admin-app chooses them (see the routing tests).

test("request Details renders readable measurements and keeps raw data advanced", async () => {
  const request = {
    request_id: "request-1",
    user_id: "user-1",
    dispatched_at: "2026-09-10T12:00:00.000Z",
    ended_at: "2026-09-10T12:00:01.000Z",
    site: "chatgpt",
    model_id: null,
    state: "completed",
    coverage_reasons: ["provider_usage_unavailable"],
    attempt_count: "1",
    shared_attempt_count: "0",
    detail_path: "/v1/admin/users/user-1/requests/request-1",
  };
  const api = {
    get: async (path: string) => {
      if (path === "/v1/config") return { timezone: "Europe/Berlin" };
      if (path.startsWith("/v1/admin/summary"))
        return { aggregate_status: "current", request_count: "1" };
      if (path.startsWith("/v1/admin/users?"))
        return { items: [], next_cursor: null };
      if (path.startsWith("/v1/admin/requests"))
        return { items: [request], next_cursor: null };
      return {
        request: {
          schema_version: "1.2.0",
          coverage_reasons: ["partial_capture"],
          documents: {
            extracted_text: [
              {
                component_id: "00000000-0000-4000-8000-000000000001",
                origin: "new_upload",
                extraction_profile_id: "local-file-text-profile",
                page_count: 2,
                tokens: {
                  value: "9223372036854775807",
                  evidence: "heuristic_estimate",
                  scope: "extracted_file_text",
                  completeness: "complete_for_scope",
                  profile_id: "tokenizer-profile",
                  reason: "tokenizer_mapping_unverified",
                },
                missing: ["provider_processing", "ocr"],
              },
            ],
          },
        },
        attempts: [
          {
            attempt_id: "attempt-1",
            started_at: "2026-09-10T12:00:00.000Z",
            state: "completed",
            contribution: "originating",
            execution_evidence: "content_observed",
            model_id: null,
            model_evidence: "unknown",
            coverage_reasons: ["hidden_reasoning_unobserved"],
            tokens: {
              answer_output: {
                value: "500",
                scope: "observed_text",
                evidence: "heuristic_estimate",
                completeness: "complete_for_scope",
                reason: "tokenizer_mapping_unverified",
              },
            },
            media: {
              image_operations: [
                {
                  kind: "text_to_image",
                  requested_count: null,
                  returned_count: "1",
                  state: "completed",
                  model_id: null,
                  settings: { width: 1024, height: 1024 },
                },
              ],
              generated_images: [{ count: "1" }],
              coverage_reasons: ["image_model_unavailable"],
            },
            estimate: {
              result: {
                profile_selection: "highest_comparable",
                selected_profile_id: "command-a-reference",
                method_id: "reference-v1",
                view: "original",
                validation_state: "unvalidated_reference",
                included_components: ["observed_output_surrogate"],
                missing_components: ["hidden_reasoning"],
                assumed_settings: { batch_size: 64 },
                known_settings: { output_tokens: "500" },
                provenance: { source: "Published reference" },
                reasons: ["unvalidated_reference"],
                metrics: {
                  energy: {
                    value: "0.00038900446245",
                    unit: "kWh",
                    scope: "modeled_text_component",
                    status: "partial_estimate",
                    reasons: ["unvalidated_reference"],
                  },
                },
                image_references: [
                  {
                    cohort_id: "image-reference-cohort",
                    gpu_kwh: null,
                    known_settings: { width: 1024, height: 1024 },
                  },
                ],
              },
            },
          },
        ],
        next_cursor: null,
      };
    },
  } as any;
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(<AdminRequests api={api} />);
  await user.click(
    await view.findByRole("button", { name: /^Open Details for the request/ }),
  );
  // The summary leads; every attempt in full is one step further.
  await view.findByRole("heading", { name: "Estimate" });
  await user.click(view.getByRole("button", { name: "Each attempt in full" }));
  await view.findByRole("heading", { name: "Token components" });
  assert.ok(view.getByText("Highest comparable proxy: command-a-reference"));
  assert.ok(view.getByText(/^≈ 0[.,]389 Wh$/));
  assert.ok(view.getByText(formatInteger("9223372036854775807")));
  assert.ok(view.getByText("New upload"));
  assert.ok(view.getByText("provider processing, ocr"));
  assert.ok(view.getByText("local-file-text-profile"));
  assert.ok(view.getByText("Record schema version: 1.2.0."));
  assert.ok(view.getByText("Request coverage is incomplete"));
  assert.ok(
    view.getByText(/some observed file references could not be matched/),
  );
  assert.ok(view.getByText(/Missing components remain unknown/));
  // A saved result can still hold an image benchmark reference from before 20 October 2026;
  // the data was removed, so Details no longer lists it.
  assert.equal(
    view.queryByRole("heading", { name: "Image benchmark references" }),
    null,
  );
  assert.ok(view.getByText("Advanced numerical record"));
});

test("network key rotation never presents an unavailable distinct count as zero", async () => {
  const api = {
    get: async (path: string) =>
      path === "/v1/config"
        ? { timezone: "Europe/Berlin" }
        : {
            label: "Connection IP observed by company server",
            coverage_start: "2026-08-11T00:00:00.000Z",
            incomplete_history: false,
            distinct_ips: null,
            distinct_ip_status: "key_rotation_pending",
            key_versions: ["1", "2"],
            items: [],
            next_cursor: null,
          },
  } as any;
  const view = render(<AdminNetwork api={api} />);
  await view.findByText("Unavailable while IP keys rotate");
  assert.ok(view.getByText("Retained key versions: 1, 2"));
  assert.equal(view.queryByText(/^0$/), null);
});

// QA of 19 Oct 2026: "Kept since" with "Older addresses are already deleted" did not say what the
// date is, and was wrong when the date is the day person analytics started.
for (const [daysAgo, incomplete, note] of [
  [2, true, "Earlier addresses are not shown: they were recorded before person analytics was switched on"],
  [30, true, "Earlier addresses are deleted after 30 days"],
  [5, false, "The whole period is shown"],
] as const)
  test(`the Network page says what its first date means: ${note}`, async () => {
    const api = {
      get: async (path: string) => {
        if (path === "/v1/config") return { timezone: "Europe/Berlin" };
        if (path.startsWith("/v1/admin/users")) return { items: [], next_cursor: null };
        if (path === "/v1/admin/health") return { browsers: [] };
        return {
          label: "Connection IP observed by company server",
          coverage_start: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
          incomplete_history: incomplete,
          distinct_ips: "0",
          distinct_ip_status: "current",
          items: [],
          next_cursor: null,
        };
      },
    } as any;
    const view = render(<AdminNetwork api={api} />);
    await view.findByText("Addresses shown from");
    assert.doesNotMatch(view.container.textContent ?? "", /Kept since/);
    assert.ok(view.getByText(note));
  });

test("connection addresses appear only after a fresh action code opens them", async () => {
  const writes: Array<{ path: string; body: any }> = [];
  let opened = false;
  const api = {
    get: async (path: string) => {
      if (path === "/v1/config") return { timezone: "Europe/Berlin" };
      if (path.startsWith("/v1/admin/users")) return { items: [], next_cursor: null };
      if (path === "/v1/admin/health") return { browsers: [] };
      if (!opened)
        throw new ApiError({ code: "reauthentication_required", retryable: false, safe_message: "Confirm with a new email code.", status: 403 });
      return {
        label: "Connection IP observed by company server",
        coverage_start: "2026-09-14T00:00:00.000Z",
        incomplete_history: false,
        distinct_ips: "1",
        distinct_ip_status: "current",
        items: [
          {
            network_observation_id: "n-1",
            user_id: "user-1",
            device_id: "device-1",
            observed_at: "2026-10-14T10:00:00.000Z",
            address: "198.51.100.7",
            source_quality: "server_observed",
            accepted_record_count: 2,
          },
        ],
        next_cursor: null,
      };
    },
    post: async (path: string, body: any) => {
      writes.push({ path, body });
      const code = actionCodeAnswer(path);
      if (code) return code;
      if (path === "/v1/admin/network/access") {
        opened = true;
        return { expires_at: "2026-10-14T12:15:00.000Z" };
      }
      throw new Error(`unexpected POST ${path}`);
    },
  } as any;
  const user = userEvent.setup({ document: dom.window.document });
  const view = render(<AdminNetwork api={api} session={ADMIN_SESSION} />);
  const show = (await view.findByRole("button", { name: "Show addresses" })) as HTMLButtonElement;
  assert.equal(show.disabled, true, "no addresses without a verified code");
  assert.equal(view.queryByText("198.51.100.7"), null);
  assert.equal((view.getByLabelText("Confirm your work email") as HTMLInputElement).value, "admin@example.test");
  await user.click(view.getByRole("button", { name: "Email a fresh action code" }));
  await pasteCode((await view.findByLabelText("Action verification code")) as HTMLInputElement, "123456");
  await user.click(view.getByRole("button", { name: "Verify code" }));
  await view.findByText(/Your code is verified/);
  await user.click(view.getByRole("button", { name: "Show addresses" }));
  await view.findByText("198.51.100.7");
  assert.deepEqual(writes.find((write) => write.path === "/v1/admin/network/access")!.body, { reauth_token: "action-token" });
});

test("the Health page does not call a browser connected minutes ago three days late", async () => {
  // 14 Oct 2026: a browser connected half an hour earlier, not synced yet, was listed as
  // "1 browser has not synced for 3 days".
  const now = Date.now();
  const at = (ms: number) => new Date(now - ms).toISOString();
  const browser = (id: string, connected: number, synced: number | null) => ({
    device_id: id,
    user_id: "u1",
    browser_family: "chrome",
    connected_at: at(connected),
    last_reporting_at: synced === null ? null : at(synced),
    client_version: "0.1.0",
    report: null,
  });
  const api = {
    get: (path: string) => {
      if (path === "/v1/admin/health")
        return Promise.resolve({
          items: [],
          browsers: [browser("new", 30 * 60_000, null), browser("old", 9 * 86_400_000, 4 * 86_400_000), browser("idle", 5 * 86_400_000, null)],
        });
      if (path.startsWith("/v1/admin/users")) return Promise.resolve({ items: [], next_cursor: null });
      if (path === "/v1/methods") return Promise.resolve({ default_method_id: "m", methods: [] });
      throw new Error(`unexpected ${path}`);
    },
  } as any;
  const view = render(<AdminHealthByBrowser api={api} />);
  await view.findByText("2 browsers have not synced for 3 days");
});
