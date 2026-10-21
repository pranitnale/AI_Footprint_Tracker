// The People pages as they were before 18 October 2026: requests per member, the ranking and one
// member's usage. admin-app shows them only while the server has person analytics switched on
// (admin/features.ts); the server then counts each person's usage only from the first full day
// after the switch. Off, the aggregate pages in AdminPeople.tsx are shown instead.
import { useState } from "react";
import { Icon } from "@footprint/ui/icons";
import { formatInteger } from "@footprint/ui/formatters";
import { Dialog } from "@footprint/ui";
import { ApiClient, idempotencyKey, queryString } from "../api";
import { ErrorState, Notice, PageTitle, Status, formatDateTime } from "../components";
import { fetchAllPages, MEMBER_PAGE_LIMIT } from "../paging";
import type { Navigate } from "../router";
import type { Member, Session } from "../types";
import { Card, ChipMenu, PeriodMenu, ScenarioMenu, Skeleton, SourceNote, StateCard, ToolMenu, UpdatingNote } from "./controls";
import {
  SITE_LABELS,
  adminFigures,
  baseText,
  baseValue,
  dashAxis,
  dashWindow,
  modelName,
  type AdminSummary,
  type Metric,
} from "./figures";
import type { DisplayScenario } from "@footprint/contracts";
import {
  DayBars,
  METRIC_LABELS,
  MethodNote,
  ServerProblem,
  Tile,
  usePeopleSummary,
  useSummary,
  useTimezone,
  type HealthSummary,
  type PeopleSummary,
} from "./AdminOverview";
import { cachedSince, useAdminView, useApi } from "./state";
import { ActionReauthSteps, useActionReauth } from "./reauth";

const PAGE = 10;
const BROWSER_NAMES: Record<string, string> = { chrome: "Chrome", edge: "Edge", firefox: "Firefox" };

function useMembers(api: ApiClient) {
  return useApi(() =>
    fetchAllPages<Member>((cursor) => api.get("/v1/admin/users" + queryString({ limit: MEMBER_PAGE_LIMIT, cursor: cursor || undefined }))),
  );
}

/**
 * The day figures per person start on (person_analytics_since, the first full day after the
 * service switched them on), when it falls after the start of the window; null otherwise. Each
 * per-person answer is counted from that day while the window's organization figures are not.
 */
export function personFloorDay(since: string | undefined | null, window: { startDate?: string }, timezone: string): string | null {
  if (!since) return null;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(since));
  return !window.startDate || day > window.startDate ? day : null;
}

/** Says that the per-person figures of a page start later than its period. */
export function PersonFloorNote({ day }: { day: string }) {
  const date = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
  return (
    <p className="ad-banner" role="note">
      <Icon name="info" size={18} />
      Figures per person count from {date}, the first full day after this service started showing usage per person. Earlier
      usage counts only in the organization's figures.
    </p>
  );
}

function binLabel(from: number, to: number | null) {
  return to === null ? `over ${formatInteger(from)}` : `${formatInteger(from)} to ${formatInteger(to)}`;
}

export function AdminPeopleNamed({
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
  const actions = (
    <>
      {timezone && <PeriodMenu timezone={timezone} now={now} />}
      <ScenarioMenu />
    </>
  );
  // Suspended members stay listed so they can be found and reactivated; erased members do not.
  const listed = (members.data ?? []).filter((member) => member.status === "active" || member.status === "suspended");
  const active = listed.filter((member) => member.status === "active");
  const requests = people.data?.requests ?? {};
  const rows = listed
        .filter((member) => (!role || member.role === role) && (!query || (member.email ?? "").toLowerCase().includes(query.trim().toLowerCase())))
        .map((member) => ({ member, requests: Number(requests[member.user_id] ?? 0) }))
        .sort((a, b) => b.requests - a.requests || (a.member.email ?? "").localeCompare(b.member.email ?? ""));
  const most = Math.max(1, ...rows.map((row) => row.requests));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
  const error = config.error ?? members.error ?? people.error;
  const updating = error ? null : cachedSince(people);
  const admins = active.filter((member) => member.role === "admin").length;
  // The aggregates above cover the whole window; the requests per person start on this day.
  const floor = window && timezone ? personFloorDay(people.data?.person_analytics_since, window, timezone) : null;

  return (
    <>
      <PageTitle title="People" actions={actions}>
        {updating !== null && <UpdatingNote since={updating} />}
      </PageTitle>
      <p className="ad-banner">
        <Icon name="shield" size={18} />
        Figures per person are for administrators only. People join by connecting a browser with their verified work email.
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
            <Card title="How usage spreads" aside={<span className="ad-soft">People by requests in the {window.phrase}</span>}>
              <Spread bins={people.data.bins} />
            </Card>
            <section className="ad-card ad-stats" aria-label="People in numbers">
              <div>
                <span>Used AI</span>
                <b className="ad-num">{formatInteger(people.data.used)}</b>
                <small>in the {window.phrase}</small>
              </div>
              <div>
                <span>Members</span>
                <b className="ad-num">
                  {formatInteger(people.data.members)} <small>of {formatInteger(people.data.capacity)}</small>
                </b>
                <small>administrators included</small>
              </div>
              <div>
                <span>Median person</span>
                <b className="ad-num">
                  {people.data.median_requests === null ? "None" : new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(Number(people.data.median_requests))} <small>requests</small>
                </b>
                <small>among people who used AI</small>
              </div>
              <div>
                <span>Administrators</span>
                <b className="ad-num">{formatInteger(people.data.administrators)}</b>
                <small>can see this page</small>
              </div>
            </section>
          </div>

          {floor && <PersonFloorNote day={floor} />}
          <Card
            title="Everyone"
            className="ad-card-table"
            aside={
              <div className="ad-search-row">
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
                      <th className="num">Requests</th>
                      <th>{window.label}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map(({ member, requests: count }) => (
                      <tr key={member.user_id}>
                        <th scope="row">
                          <a
                            href={`/admin/people/${member.user_id}`}
                            onClick={(event) => {
                              event.preventDefault();
                              navigate(`/admin/people/${member.user_id}`);
                            }}
                          >
                            {member.email ?? "Email not available"}
                          </a>
                          {member.status === "suspended" && (
                            <>
                              {" "}
                              <Status tone="warning">Suspended</Status>
                            </>
                          )}
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
                        <td className="num" data-label="Requests">
                          <b>{formatInteger(count)}</b>
                        </td>
                        <td className="ad-bar-cell">
                          <span className="ad-track" aria-hidden="true">
                            <span className="ad-fill" style={{ width: `${(count / most) * 100}%` }} />
                          </span>
                        </td>
                      </tr>
                    ))}
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
          : `They will see everyone's usage, change policies, create exports and delete records. There would be ${formatInteger(admins + 1)} administrators.`}{" "}
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

function ago(iso: string | null, now: number) {
  if (!iso) return "Never";
  const minutes = Math.round((now - Date.parse(iso)) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} ${Math.round(minutes / 60) === 1 ? "hour" : "hours"} ago`;
  if (minutes < 48 * 60) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(new Date(iso));
}

/** One person's figures (canvas AdminPerson), split by day and model like the organization's. */
export function AdminPersonNamed({
  api,
  navigate,
  userId,
  session,
}: {
  api: ApiClient;
  navigate: Navigate;
  userId: string;
  /** The signed-in administrator, whose email receives the action codes. */
  session?: Session;
}) {
  const view = useAdminView();
  const config = useTimezone(api);
  const [now] = useState(() => new Date());
  const [metric, setMetric] = useState<Metric>("energy");
  const timezone = config.data?.timezone;
  const window = timezone ? dashWindow(view.period, timezone, now) : null;
  const members = useMembers(api);
  const person = useSummary(api, window, view.site, { user_id: userId });
  const floor = window && timezone ? personFloorDay(person.data?.person_analytics_since, window, timezone) : null;
  // The organization's totals give the person's share; its splits are not needed here. They are
  // read from the day the person's figures start, so the share compares the same days.
  const orgWindow =
    window && floor && timezone ? { startDate: floor, endDate: window.endDate ?? dashWindow({ kind: "today" }, timezone, now).endDate } : window;
  const org = useSummary(api, orgWindow, view.site, {}, true);
  const health = useApi(() => api.get<HealthSummary>("/v1/admin/health"));
  const member = members.data?.find((item) => item.user_id === userId);
  const browsers = (health.data?.browsers ?? []).filter((browser) => browser.user_id === userId);
  const families = [...new Set(browsers.map((b) => BROWSER_NAMES[b.browser_family] ?? b.browser_family))];
  const since = browsers.map((b) => b.connected_at).sort()[0];
  const lastSync = browsers.map((b) => b.last_reporting_at).filter((v): v is string => !!v).sort().at(-1) ?? null;
  const name = member?.email ?? "Member";
  const initials = name.split("@")[0]!.split(/[._-]/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("");
  const back = (
    <a
      href="/admin/people"
      onClick={(event) => {
        event.preventDefault();
        navigate("/admin/people");
      }}
    >
      Back to People
    </a>
  );
  const error = config.error ?? members.error ?? person.error;
  const updating = error ? null : cachedSince(person, org);
  if (members.data && !member)
    return (
      <>
        <PageTitle title="Person not found" eyebrow={back} />
        <StateCard icon="user" tone="info" title="This person is not a member">
          <p>They may have been removed from the organization. Their records follow the organization's deletion rules.</p>
        </StateCard>
      </>
    );
  const figures = adminFigures(person.data, view.scenario);
  const orgFigures = adminFigures(org.data, view.scenario);
  const share = (m: Metric) => {
    const own = figures ? baseValue(figures, m) : null;
    const all = orgFigures ? baseValue(orgFigures, m) : null;
    return own !== null && all ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format((own / all) * 100)}% of the organization` : null;
  };
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
                {member ? (member.role === "admin" ? "Admin" : "User") : "Member"}
                {member?.status === "suspended" ? " · Suspended" : ""} · {formatInteger(browsers.length)} {browsers.length === 1 ? "browser" : "browsers"}
                {families.length ? ` (${families.join(", ")})` : ""}
                {since ? ` · connected since ${new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long" }).format(new Date(since))}` : ""}
              </p>
            </div>
          </div>
        </div>
        <div className="actions">
          {timezone && <PeriodMenu timezone={timezone} now={now} />}
          <ToolMenu />
          <ScenarioMenu />
        </div>
      </div>
      {updating !== null && (
        <p>
          <UpdatingNote since={updating} />
        </p>
      )}
      {error ? (
        <ServerProblem
          error={error}
          onRetry={() => {
            config.retry();
            members.retry();
            person.retry();
          }}
        />
      ) : !person.data || !window ? (
        <Skeleton label="Loading this person's figures" />
      ) : !figures ? (
        <StateCard icon="refresh" tone="info" title="Figures are being rebuilt">
          <p>{person.data.safe_message ?? "Check again in a few minutes."}</p>
        </StateCard>
      ) : (
        <>
          {floor && <PersonFloorNote day={floor} />}
          <div className="ad-tiles ad-tiles-4" role="group" aria-label="Choose the figure shown in the chart">
            {(["energy", "carbon", "water", "requests"] as const).map((m) => (
              <Tile key={m} figures={figures} metric={m} pressed={metric === m} onPick={() => setMetric(m)} hint={m === "energy" ? share(m) : undefined} />
            ))}
          </div>
          {person.data.days && window.bucket === "day" && window.keys.length > 1 && (
            <Card title={`${METRIC_LABELS[metric]} per day`}>
              <DayBars
                keys={window.keys}
                axis={dashAxis(window)}
                values={window.keys.map((key) => {
                  const f = adminFigures(person.data!.days![key], view.scenario);
                  return f ? baseValue(f, metric) : 0;
                })}
                metric={metric}
                label={`${METRIC_LABELS[metric]} each day`}
                tone="light"
              />
            </Card>
          )}
          <div className="ad-two">
            <PersonModels summary={person.data} metric={metric} scenario={view.scenario} />
            <Card title="Coverage">
              <dl className="ad-rows">
                <div>
                  <dt>Requests seen live</dt>
                  <dd>{formatInteger(person.data.request_count ?? "0")}</dd>
                </div>
                <div>
                  <dt>Earlier messages read from chats</dt>
                  <dd>{person.data.history?.status === "available" ? `${formatInteger(person.data.history.prompt_count)} requests` : "None"}</dd>
                </div>
                <div>
                  <dt>Estimates still calculating</dt>
                  <dd>{formatInteger(person.data.pending_estimates ?? "0")}</dd>
                </div>
                <div>
                  <dt>Replies not counted</dt>
                  <dd>{formatInteger(person.data.unresolved_request_count ?? "0")}</dd>
                </div>
                <div>
                  <dt>Last sync</dt>
                  <dd>{ago(lastSync, Date.now())}</dd>
                </div>
              </dl>
            </Card>
          </div>
          <SourceNote>A browser count is not a device count. Figures exclude what the sites keep hidden, as described in the methodology.</SourceNote>
          {figures && <MethodNote figures={figures} />}
        </>
      )}
      {member && (
        <div className="ad-two">
          <PersonBrowsers api={api} member={member} email={session?.email} />
          <PersonAccess
            api={api}
            member={member}
            session={session}
            navigate={navigate}
            onChanged={() => {
              members.refresh();
              health.refresh();
            }}
          />
        </div>
      )}
    </>
  );
}

function PersonModels({ summary, metric: shown, scenario }: { summary: AdminSummary; metric: Metric; scenario: DisplayScenario }) {
  const rows = Object.entries(summary?.models ?? {})
    .map(([id, part]) => {
      const f = adminFigures(part, scenario);
      const value = f ? baseValue(f, shown) : null;
      const requests = f ? baseValue(f, "requests") : null;
      const energy = f ? baseValue(f, "energy") : null;
      return { id, site: part.site, value, requests, perRequest: energy !== null && requests ? energy / requests : null };
    })
    // A model without an estimate still shows with its requests; dropping it said that no model
    // was recorded for a person who used several (QA of 19 October 2026).
    .filter((row) => row.value !== null || (row.requests ?? 0) > 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || (b.requests ?? 0) - (a.requests ?? 0));
  const total = rows.reduce((sum, row) => sum + (row.value ?? 0), 0);
  const tools = new Set(rows.map((row) => row.site)).size;
  return (
    <Card
      title="Models"
      aside={
        <span className="ad-soft">
          {rows.length} {rows.length === 1 ? "model" : "models"} in {tools} {tools === 1 ? "tool" : "tools"} · share of {METRIC_LABELS[shown].toLowerCase()}
        </span>
      }
    >
      {rows.length ? (
        <ul className="ad-model-list">
          {rows.map((row) => (
            <li key={row.id}>
              <span>
                <b>{modelName(row.id)}</b>
                <small>
                  {row.site ? SITE_LABELS[row.site] : "Tool not known"} · {formatInteger(Math.round(row.requests ?? 0))} requests
                </small>
              </span>
              <span className="ad-track" aria-hidden="true">
                <span className={`ad-fill ad-tool-${row.site ?? "other"}`} style={{ width: `${total ? ((row.value ?? 0) / total) * 100 : 0}%` }} />
              </span>
              <span className="ad-soft num">{total ? Math.round(((row.value ?? 0) / total) * 100) : 0}%</span>
              <span className="num">
                <b>{baseText(shown, row.value)}</b>
                {row.perRequest !== null && <small>{baseText("energy", row.perRequest, 2)} each</small>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ad-soft">No model was recorded for this person in this period.</p>
      )}
    </Card>
  );
}

/** One connected browser as the server lists it. The server never sends IP addresses here. */
type MemberDevice = {
  device_id: string;
  browser_family: "chrome" | "edge" | "firefox";
  status: "active" | "disconnected" | "revoked" | "deleted";
  first_seen_at: string;
  last_seen_at: string | null;
};
const DEVICE_STATUS: Record<MemberDevice["status"], { label: string; tone: "good" | "neutral" | "warning" }> = {
  active: { label: "Active", tone: "good" },
  disconnected: { label: "Disconnected", tone: "neutral" },
  revoked: { label: "Removed", tone: "warning" },
  deleted: { label: "Deleted", tone: "neutral" },
};
const codeOf = (caught: unknown) => (caught as { code?: string } | null)?.code;

/** A member's browsers with first and last contact, and removal of an active one. */
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
                <th>First seen</th>
                <th>Last seen</th>
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
                    <td data-label="First seen">{formatDateTime(device.first_seen_at)}</td>
                    <td data-label="Last seen">{device.last_seen_at ? formatDateTime(device.last_seen_at) : "Not yet"}</td>
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
        Removing a browser signs it out at once, so it stops sending usage. The records it already sent stay.
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

/** Suspension and reactivation, with a pointer to the separate erasure of the member's usage. */
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
    <Card title="Access">
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
      <p className="ad-soft">
        Erasing deletes their usage records for good. To erase, go to{" "}
        <a
          href="/admin/deletions"
          onClick={(event) => {
            event.preventDefault();
            navigate("/admin/deletions");
          }}
        >
          Deletion
        </a>{" "}
        and choose One person.
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
