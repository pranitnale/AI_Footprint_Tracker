import { useState } from "react";
import { Icon } from "@footprint/ui/icons";
import { formatInteger } from "@footprint/ui/formatters";
import { Dialog } from "@footprint/ui";
import { ApiClient, idempotencyKey, queryString } from "../api";
import { ErrorState, Notice, PageTitle, Status, formatDateTime } from "../components";
import { fetchAllPages, MEMBER_PAGE_LIMIT } from "../paging";
import type { Navigate } from "../router";
import type { Member, Session } from "../types";
import { Card, ChipMenu, PeriodMenu, Skeleton, StateCard, UpdatingNote } from "./controls";
import { dashWindow } from "./figures";
import { ServerProblem, usePeopleSummary, useTimezone, type PeopleSummary } from "./AdminOverview";
import { cachedSince, useAdminView, useApi } from "./state";
import { ActionReauthSteps, useActionReauth } from "./reauth";

const PAGE = 10;
const BROWSER_NAMES: Record<string, string> = { chrome: "Chrome", edge: "Edge", firefox: "Firefox" };

export function useMembers(api: ApiClient) {
  return useApi(() =>
    fetchAllPages<Member>((cursor) => api.get("/v1/admin/users" + queryString({ limit: MEMBER_PAGE_LIMIT, cursor: cursor || undefined }))),
  );
}

function binLabel(from: number, to: number | null) {
  return to === null ? `over ${formatInteger(from)}` : `${formatInteger(from)} to ${formatInteger(to)}`;
}

/** A per-person request figure from the server ("380" or "405.5"), or None when nobody used AI. */
function requestsText(value: string | null) {
  return value === null ? "None" : new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(Number(value));
}

const STATUS_LABELS: Record<string, { label: string; tone: "good" | "warning" | "neutral" }> = {
  active: { label: "Active", tone: "good" },
  suspended: { label: "Suspended", tone: "warning" },
};

/**
 * The People page (approved canvas PeopleNew, owner decision of 18 October 2026): how usage spreads
 * across the whole organization, and the member list for managing access only. No usage is shown
 * next to a name or email, and the server sends none per person. Small groups are not hidden.
 */
export function AdminPeople({
  api,
  navigate,
  onPrivilegeLost,
  session,
}: {
  api: ApiClient;
  navigate: Navigate;
  onPrivilegeLost: () => void;
  /** The signed-in administrator, whose email receives the action codes. */
  session?: Session;
}) {
  const view = useAdminView();
  const config = useTimezone(api);
  const [now] = useState(() => new Date());
  const timezone = config.data?.timezone;
  const window = timezone ? dashWindow(view.period, timezone, now) : null;
  const members = useMembers(api);
  const people = usePeopleSummary(api, window);
  const [query, setQuery] = useState(""),
    [role, setRole] = useState<"" | "admin" | "user">(""),
    [page, setPage] = useState(0),
    [target, setTarget] = useState<Member | null>(null);
  const actions = timezone ? <PeriodMenu timezone={timezone} now={now} /> : null;
  // Suspended members stay listed so they can be found and reactivated; erased members do not.
  const listed = (members.data ?? []).filter((member) => member.status === "active" || member.status === "suspended");
  const active = listed.filter((member) => member.status === "active");
  const rows = listed
    .filter((member) => (!role || member.role === role) && (!query || (member.email ?? "").toLowerCase().includes(query.trim().toLowerCase())))
    .sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
  const error = config.error ?? members.error ?? people.error;
  const updating = error ? null : cachedSince(people);
  const admins = active.filter((member) => member.role === "admin").length;
  const open = (member: Member) => navigate(`/admin/people/${member.user_id}`);

  return (
    <>
      <PageTitle title="People" actions={actions}>
        {updating !== null && <UpdatingNote since={updating} />}
      </PageTitle>
      <p className="ad-banner">
        <Icon name="shield" size={18} />
        These figures describe the whole organization. No one's usage is shown next to their name or email.
      </p>
      {error ? (
        <ServerProblem
          error={error}
          onRetry={() => {
            config.retry();
            members.retry();
            people.retry();
          }}
        />
      ) : !members.data || !people.data || !window ? (
        <Skeleton label="Loading people" />
      ) : (
        <>
          <div className="ad-two">
            <Card title="How usage spreads" aside={<span className="ad-soft">Number of people by requests, {window.phrase}</span>}>
              <Spread bins={people.data.bins} />
              <p className="ad-soft">
                Shown for any number of people. In a very small organization these figures can describe one person's usage.
              </p>
            </Card>
            <PeopleNumbers people={people.data} phrase={window.phrase} />
          </div>

          <Card
            title="Members"
            className="ad-card-table"
            aside={
              <div className="ad-search-row">
                <span className="ad-soft">For managing access only. Usage is not listed here.</span>
                <label className="ad-search">
                  <Icon name="search" size={16} />
                  <span className="ad-hidden">Search by work email</span>
                  <input
                    type="search"
                    placeholder="Search by work email"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setPage(0);
                    }}
                  />
                </label>
                <label className="ad-select">
                  <span className="ad-hidden">Role</span>
                  <select
                    value={role}
                    onChange={(event) => {
                      setRole(event.target.value as typeof role);
                      setPage(0);
                    }}
                  >
                    <option value="">All roles</option>
                    <option value="admin">Admins</option>
                    <option value="user">Users</option>
                  </select>
                </label>
              </div>
            }
          >
            {shown.length ? (
              <div className="ad-table-scroll">
                <table className="ad-table ad-table-stacked">
                  <thead>
                    <tr>
                      <th>Work email</th>
                      <th>Role</th>
                      <th className="num">Browsers</th>
                      <th>Status</th>
                      <th>
                        <span className="ad-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((member) => {
                      const status = STATUS_LABELS[member.status] ?? { label: member.status, tone: "neutral" as const };
                      return (
                        <tr key={member.user_id}>
                          <th scope="row">
                            <a
                              href={`/admin/people/${member.user_id}`}
                              onClick={(event) => {
                                event.preventDefault();
                                open(member);
                              }}
                            >
                              {member.email ?? "Email not available"}
                            </a>
                          </th>
                          <td data-label="Role">
                            <ChipMenu<"admin" | "user">
                              name={`Role for ${member.email ?? "this member"}`}
                              label={member.role === "admin" ? "Admin" : "User"}
                              value={member.role}
                              options={[
                                { value: "admin", label: "Admin" },
                                { value: "user", label: "User" },
                              ]}
                              onChange={(next) => next !== member.role && setTarget(member)}
                            />
                          </td>
                          <td className="num" data-label="Browsers">{formatInteger(member.installations)}</td>
                          <td data-label="Status">
                            <Status tone={status.tone}>{status.label}</Status>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="ad-btn ad-btn-sm"
                              aria-label={`Manage ${member.email ?? "this member"}`}
                              onClick={() => open(member)}
                            >
                              Manage
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="ad-soft ad-pad">{listed.length ? "No one matches this search." : "No members yet."}</p>
            )}
            <div className="ad-pager">
              <span className="ad-soft">
                {rows.length ? `${page * PAGE + 1} to ${Math.min(rows.length, page * PAGE + PAGE)} of ${rows.length}` : "0 people"}
              </span>
              <span>
                <button type="button" className="ad-btn ad-btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                  Previous
                </button>
                <button type="button" className="ad-btn ad-btn-sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
                  Next
                </button>
              </span>
            </div>
          </Card>
        </>
      )}
      {target && (
        <RoleChange
          api={api}
          member={target}
          admins={admins}
          email={session?.email}
          onClose={() => setTarget(null)}
          onDone={() => {
            setTarget(null);
            members.retry();
            people.retry();
          }}
          onPrivilegeLost={onPrivilegeLost}
          onStale={() => members.retry()}
        />
      )}
    </>
  );
}

/** The four organization figures beside the spread (canvas: Used AI, Typical person, Average, Most active). */
function PeopleNumbers({ people, phrase }: { people: PeopleSummary; phrase: string }) {
  return (
    <section className="ad-card ad-stats" aria-label="Usage per person in numbers">
      <div>
        <span>Used AI</span>
        <b className="ad-num">
          {formatInteger(people.used)} <small>of {formatInteger(people.members)}</small>
        </b>
        <small>members, {phrase}</small>
      </div>
      <div>
        <span>Typical person</span>
        <b className="ad-num">{requestsText(people.median_requests)}</b>
        <small>requests (median)</small>
      </div>
      <div>
        <span>Average per person</span>
        <b className="ad-num">{requestsText(people.average_requests)}</b>
        <small>requests</small>
      </div>
      <div>
        <span>Most active person</span>
        <b className="ad-num">{requestsText(people.max_requests)}</b>
        <small>requests, name not shown</small>
      </div>
    </section>
  );
}

function Spread({ bins }: { bins: PeopleSummary["bins"] }) {
  const max = Math.max(1, ...bins.map((bin) => bin.people));
  const top = bins.findIndex((bin) => bin.people === max);
  return (
    <ol className="ad-spread" aria-label="People by number of requests">
      {bins.map((bin, index) => (
        <li key={bin.from}>
          <b className="ad-num">{formatInteger(bin.people)}</b>
          <span className="ad-spread-bar" data-on={index === top || undefined} style={{ height: `${(bin.people / max) * 100}%` }} aria-hidden="true" />
          <span className="ad-spread-label">
            <span className="ad-hidden">{formatInteger(bin.people)} people sent </span>
            {binLabel(bin.from, bin.to)}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Role change with the canvas confirmation (AdminDialogs). The server protects the last active
 * administrator and rejects stale or concurrent changes; its answer stays inside the dialog.
 * Administrator sessions last 7 days, so the change needs a fresh email code like suspension.
 */
function RoleChange({
  api,
  member,
  admins,
  email,
  onClose,
  onDone,
  onPrivilegeLost,
  onStale,
}: {
  api: ApiClient;
  member: Member;
  admins: number;
  email: string | null | undefined;
  onClose: () => void;
  onDone: () => void;
  onPrivilegeLost: () => void;
  onStale: () => void;
}) {
  const reauth = useActionReauth(api);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  // One key per dialog, so a retry after a lost answer replays the change instead of repeating it.
  const [operation] = useState(idempotencyKey);
  const removing = member.role === "admin";
  const who = member.email ?? "this member";
  async function confirm() {
    if (!reauth.token) return;
    setBusy(true);
    setError(null);
    try {
      await api.put(`/v1/admin/users/${encodeURIComponent(member.user_id)}/role`, {
        role: removing ? "user" : "admin",
        expected_version: member.membership_version,
        idempotency_key: operation,
        reauth_token: reauth.token,
      });
      onDone();
    } catch (caught) {
      setError(caught);
      const code = codeOf(caught);
      if (code === "reauthentication_required") reauth.reset({ fresh: true });
      if (code === "admin_required") onPrivilegeLost();
      if (code === "last_admin" || code === "stale_version") onStale();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={removing ? `Remove admin access for ${who}?` : `Make ${who} an administrator?`}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="ad-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={`ad-btn ${removing ? "ad-btn-danger" : "ad-btn-primary"}`}
            onClick={confirm}
            disabled={busy || !reauth.token}
          >
            {busy ? "Changing access" : removing ? "Remove admin access" : "Make admin"}
          </button>
        </>
      }
    >
      <p>
        {removing
          ? `They keep tracking as a member and see only their own figures. There would be ${formatInteger(Math.max(0, admins - 1))} ${admins - 1 === 1 ? "administrator" : "administrators"}.`
          : `They will see the organization's figures, change policies, create exports and delete records. There would be ${formatInteger(admins + 1)} administrators.`}{" "}
        Confirm with a fresh code from your email.
      </p>
      <ActionReauthSteps reauth={reauth} email={email} disabled={busy} />
      {reauth.token && <p className="small">Your code is verified. It is valid for 5 minutes and one action.</p>}
      {Boolean(error ?? reauth.error) && (
        <Notice tone="danger" title="Access was not changed">
          {((error ?? reauth.error) as Error).message}
        </Notice>
      )}
    </Dialog>
  );
}

export { BROWSER_NAMES };

/**
 * A member's page (approved canvas PersonNew): role, browsers with the date each connected, suspension
 * and the way to delete the member's records. It shows no usage: a member's own figures are shown
 * only to them, in their extension (owner decision of 18 October 2026).
 */
export function AdminPerson({
  api,
  navigate,
  userId,
  session,
  onPrivilegeLost = () => undefined,
}: {
  api: ApiClient;
  navigate: Navigate;
  userId: string;
  /** The signed-in administrator, whose email receives the action codes. */
  session?: Session;
  onPrivilegeLost?: () => void;
}) {
  const members = useMembers(api);
  const [roleTarget, setRoleTarget] = useState<Member | null>(null);
  const member = members.data?.find((item) => item.user_id === userId);
  const admins = (members.data ?? []).filter((item) => item.status === "active" && item.role === "admin").length;
  const back = (
    <a
      href="/admin/people"
      onClick={(event) => {
        event.preventDefault();
        navigate("/admin/people");
      }}
    >
      Back to Members
    </a>
  );
  if (members.error) return <ServerProblem error={members.error} onRetry={members.retry} />;
  if (!members.data) return <Skeleton label="Loading this member" />;
  if (!member)
    return (
      <>
        <PageTitle title="Person not found" eyebrow={back} />
        <StateCard icon="user" tone="info" title="This person is not a member">
          <p>They may have been removed from the organization. Their records follow the organization's deletion rules.</p>
        </StateCard>
      </>
    );
  const name = member.email ?? "Member";
  const initials = name.split("@")[0]!.split(/[._-]/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("");
  return (
    <>
      <div className="page-title ad-person-title">
        <div>
          <span className="eyebrow">{back}</span>
          <div className="ad-person">
            <span className="ad-avatar" aria-hidden="true">
              {initials || "?"}
            </span>
            <div>
              <h1>{name}</h1>
              <p>
                {member.role === "admin" ? "Admin" : "User"}
                {member.status === "suspended" ? " · Suspended" : ""} · {formatInteger(member.installations)}{" "}
                {member.installations === 1 ? "browser" : "browsers"}
              </p>
            </div>
          </div>
        </div>
      </div>
      <p className="ad-banner">
        <Icon name="shield" size={18} />
        This page is for managing access. A member's own usage is shown only to them, in their extension.
      </p>
      <div className="ad-two">
        <Card title="Role">
          <dl className="ad-rows">
            <div>
              <dt>Access level</dt>
              <dd>
                <ChipMenu<"admin" | "user">
                  name={`Role for ${name}`}
                  label={member.role === "admin" ? "Administrator" : "User"}
                  value={member.role}
                  options={[
                    { value: "user", label: "User" },
                    { value: "admin", label: "Administrator" },
                  ]}
                  onChange={(next) => next !== member.role && setRoleTarget(member)}
                />
              </dd>
            </div>
          </dl>
          <p className="ad-soft">Changing a role asks for a fresh email code.</p>
        </Card>
        <PersonBrowsers api={api} member={member} email={session?.email} />
      </div>
      <PersonAccess api={api} member={member} session={session} navigate={navigate} onChanged={members.refresh} />
      {roleTarget && (
        <RoleChange
          api={api}
          member={roleTarget}
          admins={admins}
          email={session?.email}
          onClose={() => setRoleTarget(null)}
          onDone={() => {
            setRoleTarget(null);
            members.refresh();
          }}
          onPrivilegeLost={onPrivilegeLost}
          onStale={members.refresh}
        />
      )}
    </>
  );
}

/**
 * One connected browser as the server lists it: which browser, its status and when it connected.
 * The server sends no IP address and no last-used time (owner decision of 18 October 2026).
 */
export type MemberDevice = {
  device_id: string;
  browser_family: "chrome" | "edge" | "firefox";
  status: "active" | "disconnected" | "revoked" | "deleted";
  first_seen_at: string;
};
const DEVICE_STATUS: Record<MemberDevice["status"], { label: string; tone: "good" | "neutral" | "warning" }> = {
  active: { label: "Active", tone: "good" },
  disconnected: { label: "Disconnected", tone: "neutral" },
  revoked: { label: "Removed", tone: "warning" },
  deleted: { label: "Deleted", tone: "neutral" },
};
const codeOf = (caught: unknown) => (caught as { code?: string } | null)?.code;

/** A member's browsers with the date each connected, and removal of an active one. */
function PersonBrowsers({ api, member, email }: { api: ApiClient; member: Member; email: string | null | undefined }) {
  const devices = useApi(() =>
    api.get<{ items: MemberDevice[] }>(`/v1/admin/users/${encodeURIComponent(member.user_id)}/devices`),
  );
  const [target, setTarget] = useState<MemberDevice | null>(null),
    [removed, setRemoved] = useState<string | null>(null);
  const items = devices.data?.items ?? [];
  return (
    <Card title="Browsers" className="ad-card-table">
      {devices.error ? (
        <ErrorState error={devices.error} onRetry={devices.retry} />
      ) : !devices.data ? (
        <Skeleton label="Loading browsers" />
      ) : items.length ? (
        <div className="ad-table-scroll">
          <table className="ad-table ad-table-stacked">
            <thead>
              <tr>
                <th>Browser</th>
                <th>Status</th>
                <th>Connected since</th>
                <th>
                  <span className="ad-hidden">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((device) => {
                const status = DEVICE_STATUS[device.status] ?? { label: device.status, tone: "neutral" as const };
                return (
                  <tr key={device.device_id}>
                    <th scope="row">{BROWSER_NAMES[device.browser_family] ?? device.browser_family}</th>
                    <td data-label="Status">
                      <Status tone={status.tone}>{status.label}</Status>
                    </td>
                    <td data-label="Connected since">{formatDateTime(device.first_seen_at)}</td>
                    <td>
                      {device.status === "active" && (
                        <button
                          type="button"
                          className="ad-btn ad-btn-sm"
                          onClick={() => {
                            setRemoved(null);
                            setTarget(device);
                          }}
                        >
                          Remove browser
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="ad-soft ad-pad">No browser has connected yet.</p>
      )}
      {removed && <Notice title="Browser removed">{removed} is signed out. Its records stay.</Notice>}
      <p className="ad-soft ad-pad">
        Shows whether a browser is connected, not when it was used. Removing a browser signs it out at once, so it stops sending
        usage. The records it already sent stay.
      </p>
      {target && (
        <RemoveBrowser
          api={api}
          member={member}
          device={target}
          email={email}
          onClose={() => setTarget(null)}
          onDone={(name) => {
            setTarget(null);
            setRemoved(name);
            devices.retry();
          }}
          onGone={devices.retry}
        />
      )}
    </Card>
  );
}

function RemoveBrowser({
  api,
  member,
  device,
  email,
  onClose,
  onDone,
  onGone,
}: {
  api: ApiClient;
  member: Member;
  device: MemberDevice;
  email: string | null | undefined;
  onClose: () => void;
  onDone: (name: string) => void;
  onGone: () => void;
}) {
  const reauth = useActionReauth(api);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const name = BROWSER_NAMES[device.browser_family] ?? device.browser_family;
  const who = member.email ?? "this member";
  async function confirm() {
    if (!reauth.token) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ device_id: string; status: string }>(
        `/v1/admin/users/${encodeURIComponent(member.user_id)}/devices/${encodeURIComponent(device.device_id)}/revoke`,
        { reauth_token: reauth.token },
      );
      if (result?.status !== "revoked") throw new Error("The server did not confirm the removal. The browser may still be connected.");
      onDone(name);
    } catch (caught) {
      setError(caught);
      if (codeOf(caught) === "reauthentication_required") reauth.reset({ fresh: true });
      if (codeOf(caught) === "not_found") onGone();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={`Remove ${name} for ${who}?`}
      onClose={onClose}
      dangerous
      actions={
        <>
          <button type="button" className="ad-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="ad-btn ad-btn-danger" onClick={confirm} disabled={busy || !reauth.token}>
            {busy ? "Removing browser" : "Remove browser"}
          </button>
        </>
      }
    >
      <p>
        The browser first seen {formatDateTime(device.first_seen_at)} is signed out at once and stops sending usage. The records it
        already sent stay. Confirm with a fresh code from your email.
      </p>
      <ActionReauthSteps reauth={reauth} email={email} disabled={busy} />
      {reauth.token && <p className="small">Your code is verified. It is valid for 5 minutes and one action.</p>}
      {Boolean(error ?? reauth.error) && (
        <ErrorState error={error ?? reauth.error} context="action" title="The browser was not removed" />
      )}
    </Dialog>
  );
}

/** Suspension and reactivation, and the way to the separate deletion of the member's records. */
function PersonAccess({
  api,
  member,
  session,
  navigate,
  onChanged,
}: {
  api: ApiClient;
  member: Member;
  session: Session | undefined;
  navigate: Navigate;
  onChanged: () => void;
}) {
  // The dialog keeps the member as it was when opened, so a reload after a conflict cannot close it.
  const [target, setTarget] = useState<Member | null>(null),
    [done, setDone] = useState<"active" | "suspended" | null>(null);
  const suspended = member.status === "suspended";
  const self = Boolean(session?.user_id) && session?.user_id === member.user_id;
  return (
    <Card title="Access and records">
      <dl className="ad-rows">
        <div>
          <dt>Status</dt>
          <dd>{suspended ? <Status tone="warning">Suspended</Status> : <Status tone="good">Active</Status>}</dd>
        </div>
      </dl>
      {done && (
        <Notice title={done === "suspended" ? "Member suspended" : "Member reactivated"}>
          {done === "suspended"
            ? "They can no longer connect or send usage. Their records stay."
            : "They can connect again with an email code."}
        </Notice>
      )}
      <p className="ad-soft">
        {suspended
          ? "Reactivating lets them connect a browser again with an email code."
          : "Suspending stops them connecting browsers and sending usage until you reactivate them. Their records stay."}
      </p>
      {self && !suspended ? (
        <p className="ad-soft">You cannot suspend yourself. Another administrator can.</p>
      ) : (
        <button
          type="button"
          className={`ad-btn ${suspended ? "ad-btn-primary" : "ad-btn-danger"}`}
          onClick={() => {
            setDone(null);
            setTarget(member);
          }}
        >
          {suspended ? "Reactivate member" : "Suspend member"}
        </button>
      )}
      <p>
        <a
          className="ad-btn ad-btn-danger"
          href="/admin/deletions"
          onClick={(event) => {
            event.preventDefault();
            navigate("/admin/deletions");
          }}
        >
          Delete this member's records
        </a>
      </p>
      <p className="ad-soft">
        Deleting records answers a member's erasure request and removes them from the organization. On Deletion, choose One person
        and this member. The preview says what will be deleted, without counting this member's records.
      </p>
      {target && (
        <ChangeStatus
          api={api}
          member={target}
          email={session?.email}
          onClose={() => setTarget(null)}
          onDone={(status) => {
            setTarget(null);
            setDone(status);
            onChanged();
          }}
          onStale={onChanged}
        />
      )}
    </Card>
  );
}

function ChangeStatus({
  api,
  member,
  email,
  onClose,
  onDone,
  onStale,
}: {
  api: ApiClient;
  member: Member;
  email: string | null | undefined;
  onClose: () => void;
  onDone: (status: "active" | "suspended") => void;
  onStale: () => void;
}) {
  const reauth = useActionReauth(api);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const next = member.status === "suspended" ? "active" : "suspended";
  const who = member.email ?? "this member";
  async function confirm() {
    if (!reauth.token) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.put<{ user_id: string; status: string; membership_version: number }>(
        `/v1/admin/users/${encodeURIComponent(member.user_id)}/status`,
        { status: next, expected_version: member.membership_version, reauth_token: reauth.token },
      );
      if (result?.status !== next) throw new Error("The server did not confirm the change. The member's access may be unchanged.");
      onDone(next);
    } catch (caught) {
      setError(caught);
      const code = codeOf(caught);
      if (code === "reauthentication_required") reauth.reset({ fresh: true });
      if (code === "stale_version" || code === "not_found") onStale();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={next === "suspended" ? `Suspend ${who}?` : `Reactivate ${who}?`}
      onClose={onClose}
      dangerous={next === "suspended"}
      actions={
        <>
          <button type="button" className="ad-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={`ad-btn ${next === "suspended" ? "ad-btn-danger" : "ad-btn-primary"}`}
            onClick={confirm}
            disabled={busy || !reauth.token}
          >
            {busy ? "Changing access" : next === "suspended" ? "Suspend member" : "Reactivate member"}
          </button>
        </>
      }
    >
      <p>
        {next === "suspended"
          ? "Their browsers stop connecting and sending usage until you reactivate them. Their records stay."
          : "They can connect a browser again with an email code."}{" "}
        Confirm with a fresh code from your email.
      </p>
      <ActionReauthSteps reauth={reauth} email={email} disabled={busy} />
      {reauth.token && <p className="small">Your code is verified. It is valid for 5 minutes and one action.</p>}
      {Boolean(error ?? reauth.error) && (
        <ErrorState error={error ?? reauth.error} context="action" title="Access was not changed" />
      )}
    </Dialog>
  );
}
