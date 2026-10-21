import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";
import { Icon } from "@footprint/ui/icons";
import {
  Button,
  Dialog,
  ErrorState,
  Notice,
  PageTitle,
  formatDateTime,
  formatInteger,
  formatRetention,
} from "./components";
import { ApiClient, idempotencyKey, queryString } from "./api";
import { fetchAllPages } from "./paging";
import { Card, ChipMenu, Skeleton } from "./admin/controls";
import { ActionReauthSteps, useActionReauth, type ActionReauth } from "./admin/reauth";
import type { Navigate } from "./router";

/**
 * A fresh email code for one developer action. The developer panel stays signed in for 7 days and
 * reaches every organization, so changing an organization's status or entitlement, approving a
 * domain and deleting a contact request each need a code sent to the developer's own address.
 */
function useOperatorCode(api: ApiClient) {
  return useActionReauth(api, { operator: true });
}

function OperatorCode({
  reauth,
  email,
  disabled = false,
}: {
  reauth: ActionReauth;
  email: string | null | undefined;
  disabled?: boolean;
}) {
  return (
    <>
      <ActionReauthSteps reauth={reauth} email={email} disabled={disabled} />
      {reauth.token && (
        <p className="small">
          Your code is verified. It is valid for 5 minutes and one action.
        </p>
      )}
      {Boolean(reauth.error) && (
        <ErrorState
          error={reauth.error}
          context="action"
          title="The code was not accepted"
        />
      )}
    </>
  );
}

/**
 * A code works once: after a completed action, or when the server refused the code, the next
 * action asks for a new one. Any other refusal rolled back on the server, so the code stays usable.
 */
function settleCode(reauth: ActionReauth, caught?: unknown) {
  if (
    caught === undefined ||
    (caught as { code?: string } | null)?.code === "reauthentication_required"
  )
    reauth.reset({ fresh: true });
}

type Organization = {
  company_id: string;
  name: string;
  /** The internal key; a hosted organization's key is not an address anyone uses. */
  origin: string;
  /** The registered work email domain that members connect with. */
  domain?: string;
  status: string;
  version: number;
  capacity: number;
  retention_months: number | null;
  plan_id: string;
  plan_version: number;
  entitlement_generation?: number;
  /** Active members; absent from a single organization's record. */
  members?: number;
  /** A shorter usage retention the organization's admins chose, in months. */
  retention_choice?: number | null;
};

type Plan = {
  plan_id: string;
  version: number;
  member_capacity: number;
  retention_months: number | null;
};

const HOSTED = "Hosted service";
const PAGE = 20;

function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(true),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    setBusy(true);
    setError(null);
    loader()
      .then((v) => live && setData(v))
      .catch((v) => live && setError(v))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [revision, ...deps]);
  return { data, error, busy, retry: () => setRevision((v) => v + 1) };
}

/** Every organization, sorted by name; the server pages them in id order. */
async function loadOrganizations(api: ApiClient) {
  const items = await fetchAllPages<Organization>((cursor) =>
    api.get(
      "/v1/operator/organizations" +
        queryString({ limit: "100", cursor: cursor || undefined }),
    ),
  );
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

/** "configured-free" reads as "Configured free". */
export function planName(id: string) {
  const text = id.replaceAll("-", " ").trim();
  return text ? text[0]!.toUpperCase() + text.slice(1) : "Unnamed plan";
}
const planShort = (id: string, version: number) =>
  `${planName(id)} v${version}`;
const planLong = (id: string, version: number) =>
  `${planName(id)}, version ${version}`;
const keptFor = (months: number | null | undefined) =>
  months === null
    ? "Until deleted"
    : months === undefined
      ? "Unknown"
      : formatRetention(months);

/** The retention an organization keeps: the admins' shorter choice when they made one. */
function orgRetention(org: Organization) {
  const choice = org.retention_choice;
  if (
    choice !== null &&
    choice !== undefined &&
    (org.retention_months === null || choice < org.retention_months)
  )
    return `${formatRetention(choice)}, set by admin`;
  return keptFor(org.retention_months);
}

function host(origin: string) {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/**
 * How the panel tells organizations apart: the work email domain. Hosted organizations share the
 * service's one address, so their internal key would only confuse; a record without a domain
 * falls back to the host of its key.
 */
function orgDomain(org: Organization) {
  return org.domain || host(org.origin);
}

function shortDate(iso: string | null | undefined) {
  if (!iso) return "Unknown";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(date);
}

/** The end of a chosen calendar day in the developer's own time zone. */
function endOfDay(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year!, month! - 1, day! + 1).toISOString();
}

function tomorrow() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** One record per plan version, newest version first within each plan. */
function uniquePlans(plans: Plan[]) {
  const seen = new Map<string, Plan>();
  for (const plan of plans) seen.set(`${plan.plan_id}:${plan.version}`, plan);
  return [...seen.values()].sort(
    (a, b) => a.plan_id.localeCompare(b.plan_id) || b.version - a.version,
  );
}

function planOption(plan: Plan) {
  return `${planLong(plan.plan_id, plan.version)} (${formatInteger(plan.member_capacity)} members, ${keptFor(plan.retention_months).toLowerCase()})`;
}

/** A transition's target plan: "configured-free:1", or an exception's private return plan. */
function transitionPlan(plan: string) {
  if (plan.startsWith("exception-reversal:")) return "Plan before the exception";
  const at = plan.lastIndexOf(":");
  const version = Number(plan.slice(at + 1));
  return at > 0 && Number.isInteger(version)
    ? planShort(plan.slice(0, at), version)
    : plan;
}

// The new contact count is shared by the sidebar badge and the inbox, so a reply clears the badge at once.
let newContacts: number | null = null;
const contactListeners = new Set<() => void>();
function setNewContacts(count: number) {
  newContacts = count;
  contactListeners.forEach((listener) => listener());
}
function subscribeContacts(listener: () => void) {
  contactListeners.add(listener);
  return () => contactListeners.delete(listener);
}

/** New contact requests, or null until known. The inbox reports its own load errors. */
export function useNewContactCount(api: ApiClient) {
  const count = useSyncExternalStore(subscribeContacts, () => newContacts);
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => api.get<ContactList>("/v1/operator/contacts?status=new"))
      .then((list) => {
        if (live) setNewContacts(list.counts?.new ?? list.items.length);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api]);
  return count;
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint: ReactNode;
}) {
  return (
    <div className="ad-card ad-stat-card">
      <span>{label}</span>
      <b className="ad-num">{value}</b>
      <small>{hint}</small>
    </div>
  );
}

function StateBadge({ status }: { status: string }) {
  return status === "active" ? (
    <span className="ad-badge ad-badge-good">Active</span>
  ) : (
    <span className="ad-badge ad-badge-danger">
      {status === "suspended" ? "Suspended" : status.replaceAll("_", " ")}
    </span>
  );
}

function link(navigate: Navigate | undefined, to: string) {
  return (event: { preventDefault(): void }) => {
    if (!navigate) return;
    event.preventDefault();
    navigate(to);
  };
}

type ListedException = PlanException & {
  company_id: string;
  company_name: string | null;
  retention_shortened: boolean;
  acknowledged: boolean;
};

export function OperatorOrganizations({
  api,
  navigate,
  email,
}: {
  api: ApiClient;
  navigate?: Navigate;
  /** The signed-in developer's address, which receives the action codes. */
  email?: string | null;
}) {
  const statusCode = useOperatorCode(api);
  const orgs = useLoad(() => loadOrganizations(api));
  const exceptions = useLoad(() =>
    fetchAllPages<ListedException>((cursor) =>
      api.get(
        "/v1/operator/exceptions" +
          queryString({ limit: "100", cursor: cursor || undefined }),
      ),
    ).catch(() => null),
  );
  const contacts = useNewContactCount(api);
  const [search, setSearch] = useState(""),
    [state, setState] = useState<"all" | "active" | "suspended">("all"),
    [shown, setShown] = useState(PAGE);
  const [action, setAction] = useState<Organization | null>(null),
    [managed, setManaged] = useState<Organization | null>(null),
    [reason, setReason] = useState(""),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false),
    [statusOperation, setStatusOperation] = useState(idempotencyKey);
  async function change() {
    if (!action || !statusCode.token) return;
    setBusy(true);
    setError(null);
    try {
      await api.put(`/v1/operator/organizations/${action.company_id}/status`, {
        expected_version: action.version,
        status: action.status === "active" ? "suspended" : "active",
        reason: reason.trim(),
        idempotency_key: statusOperation,
        reauth_token: statusCode.token,
      });
      settleCode(statusCode);
      setAction(null);
      setReason("");
      orgs.retry();
    } catch (caught) {
      setError(caught);
      settleCode(statusCode, caught);
    } finally {
      setBusy(false);
    }
  }
  const all = orgs.data ?? [];
  const active = all.filter((org) => org.status === "active");
  const membersKnown = active.every((org) => typeof org.members === "number");
  const members = active.reduce((sum, org) => sum + (org.members ?? 0), 0);
  const current = (exceptions.data ?? []).filter((item) =>
    ["active", "revocation_scheduled"].includes(item.status),
  );
  const nextEnd = current.map((item) => item.expires_at).sort()[0];
  const needle = search.trim().toLowerCase();
  const rows = all.filter(
    (org) =>
      (state === "all" || org.status === state) &&
      (!needle ||
        org.name.toLowerCase().includes(needle) ||
        orgDomain(org).toLowerCase().includes(needle)),
  );
  return (
    <>
      <PageTitle title="Organizations" eyebrow={HOSTED} />
      {orgs.busy && !orgs.data ? (
        <Skeleton label="Loading organizations" />
      ) : orgs.error && !orgs.data ? (
        <ErrorState error={orgs.error} onRetry={orgs.retry} />
      ) : (
        <>
          <div className="ad-stat-cards">
            <StatCard
              label="Organizations"
              value={formatInteger(all.length)}
              hint={`${formatInteger(active.length)} active, ${formatInteger(all.length - active.length)} suspended`}
            />
            <StatCard
              label="Members"
              value={membersKnown ? formatInteger(members) : "Not available"}
              hint="Across active organizations"
            />
            <StatCard
              label="Exceptions"
              value={
                exceptions.data
                  ? formatInteger(current.length)
                  : exceptions.busy
                    ? "Loading"
                    : "Not available"
              }
              hint={
                nextEnd ? `Next one ends ${shortDate(nextEnd)}` : "None in effect"
              }
            />
            <StatCard
              label="Contact requests"
              value={
                contacts === null ? "Not available" : `${formatInteger(contacts)} new`
              }
              hint={
                <a
                  className="ad-link"
                  href="/operator/contacts"
                  onClick={link(navigate, "/operator/contacts")}
                >
                  Open the inbox
                </a>
              }
            />
          </div>
          <section className="ad-card ad-card-table" aria-label="Organizations">
            <div className="ad-filter-bar op-filter">
              <label className="ad-search">
                <Icon name="search" size={16} />
                <span className="ad-hidden">Search organizations</span>
                <input
                  type="search"
                  placeholder="Search organizations"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setShown(PAGE);
                  }}
                />
              </label>
              <ChipMenu<"all" | "active" | "suspended">
                name="State"
                label={
                  state === "all"
                    ? "All states"
                    : state === "active"
                      ? "Active"
                      : "Suspended"
                }
                value={state}
                options={[
                  { value: "all", label: "All states" },
                  { value: "active", label: "Active" },
                  { value: "suspended", label: "Suspended" },
                ]}
                onChange={(next) => {
                  setState(next);
                  setShown(PAGE);
                }}
              />
            </div>
            {rows.length ? (
              <div className="ad-table-scroll">
                <table className="ad-table">
                  <thead>
                    <tr>
                      <th>Organization</th>
                      <th>Plan</th>
                      <th>Members</th>
                      <th>Usage retention</th>
                      <th>State</th>
                      <th className="op-actions-head">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, shown).map((org) => {
                      const used =
                        typeof org.members === "number" && org.capacity > 0
                          ? Math.min(100, Math.round((org.members / org.capacity) * 100))
                          : null;
                      return (
                        <tr key={org.company_id}>
                          <th scope="row">
                            {org.name}
                            <small>{orgDomain(org)}</small>
                          </th>
                          <td>{planShort(org.plan_id, org.plan_version)}</td>
                          <td>
                            {used === null ? (
                              `Up to ${formatInteger(org.capacity)}`
                            ) : (
                              <span className="op-members">
                                <span className="ad-track" aria-hidden="true">
                                  <span
                                    className="ad-fill"
                                    style={{ width: `${used}%` }}
                                  />
                                </span>
                                {formatInteger(org.members)} of{" "}
                                {formatInteger(org.capacity)}
                              </span>
                            )}
                          </td>
                          <td>{orgRetention(org)}</td>
                          <td>
                            <StateBadge status={org.status} />
                          </td>
                          <td>
                            <span className="op-row-actions">
                              <button
                                type="button"
                                className="ad-btn ad-btn-sm"
                                aria-label={`Manage ${org.name}`}
                                onClick={() => setManaged(org)}
                              >
                                Manage
                              </button>
                              <button
                                type="button"
                                className={`ad-btn ad-btn-sm ${org.status === "active" ? "op-btn-danger" : "op-btn-good"}`}
                                aria-label={`${org.status === "active" ? "Suspend" : "Restore"} ${org.name}`}
                                onClick={() => {
                                  setError(null);
                                  setReason("");
                                  setStatusOperation(idempotencyKey());
                                  setAction(org);
                                }}
                              >
                                {org.status === "active" ? "Suspend" : "Restore"}
                              </button>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="ad-soft ad-pad">
                {all.length
                  ? "No organization matches this search."
                  : "No organization has registered yet."}
              </p>
            )}
            {rows.length > shown && (
              <div className="ad-more">
                <button
                  type="button"
                  className="ad-btn"
                  onClick={() => setShown((value) => value + PAGE)}
                >
                  <Icon name="chevronDown" size={16} />
                  Show {formatInteger(Math.min(PAGE, rows.length - shown))} more
                </button>
                <span className="ad-soft">
                  Showing {formatInteger(shown)} of {formatInteger(rows.length)}
                </span>
              </div>
            )}
          </section>
          {Boolean(orgs.error) && (
            <ErrorState error={orgs.error} onRetry={orgs.retry} />
          )}
        </>
      )}
      {action && (
        <Dialog
          title={`${action.status === "active" ? "Suspend" : "Restore"} service for ${action.name}?`}
          dangerous={action.status === "active"}
          onClose={() => setAction(null)}
          actions={
            <>
              <Button onClick={() => setAction(null)}>Cancel</Button>
              <Button
                variant={action.status === "active" ? "danger" : "primary"}
                onClick={change}
                disabled={!reason.trim() || busy || !statusCode.token}
              >
                {action.status === "active"
                  ? "Suspend service"
                  : "Restore service"}
              </Button>
            </>
          }
        >
          <p>
            {action.status === "active"
              ? "Service stops for this organization until it is restored. Roles and usage are kept. The reason is recorded in the audit log."
              : "Service resumes for this organization. The reason is recorded in the audit log."}{" "}
            Confirm with a fresh code from your email.
          </p>
          <label>
            Reason
            <input
              value={reason}
              maxLength={200}
              onChange={(event) => {
                setReason(event.target.value);
                setStatusOperation(idempotencyKey());
              }}
              required
            />
          </label>
          <OperatorCode reauth={statusCode} email={email} disabled={busy} />
          {Boolean(error) && (
            <ErrorState
              error={error}
              context="action"
              title="Service state was not changed"
            />
          )}
        </Dialog>
      )}
      {managed && (
        <OrganizationManager
          api={api}
          organization={managed}
          navigate={navigate}
          email={email}
          onClose={() => setManaged(null)}
          onChanged={() => {
            orgs.retry();
            exceptions.retry();
          }}
        />
      )}
    </>
  );
}

type Transition = {
  transition_id: string;
  plan: string;
  effective_at: string;
  acknowledged: boolean;
  acknowledgement_required: boolean;
  version: number;
  retention_shortened: boolean;
  retention_preview?: {
    request_count?: string;
    attempt_count?: string;
    cutoff?: string;
    counted_at?: string;
  };
  current_entitlement?: {
    plan_id: string;
    plan_version: number;
    capacity: number;
    retention_months: number | null;
    timezone: string;
  };
  target_entitlement?: {
    plan_id: string;
    plan_version: number;
    capacity: number;
    retention_months: number | null;
    timezone: string;
  } | null;
  exception_id?: string;
  source_exception_id?: string;
  status:
    "pending" | "review_required" | "cancelled" | "superseded" | "applied";
  company_version: number;
  current_entitlement_generation: number;
  operator_can_cancel: boolean;
  operator_can_review: boolean;
};

type PlanException = {
  exception_id: string;
  status: string;
  version: number;
  member_capacity: number;
  retention_months: number | null;
  effective_at: string;
  expires_at: string;
  reason: string;
  reversion_transition_id: string;
};

function ExceptionStatus({ status }: { status: string }) {
  const [label, tone] =
    status === "active"
      ? ["Active", "ad-badge-good"]
      : status === "revocation_scheduled"
        ? ["Ending", "ad-badge-info"]
        : status === "expired"
          ? ["Ended", ""]
          : status === "revoked"
            ? ["Revoked", ""]
            : [planName(status.replaceAll("_", "-")), ""];
  return <span className={`ad-badge ${tone}`}>{label}</span>;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function OrganizationManager({
  api,
  organization,
  navigate,
  email,
  onClose,
  onChanged,
}: {
  api: ApiClient;
  organization: Organization;
  navigate?: Navigate;
  email?: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  // One code per action: each form below asks for its own and spends it on one change.
  const assignCode = useOperatorCode(api),
    decisionCode = useOperatorCode(api),
    replaceCode = useOperatorCode(api);
  const assignForm = useId(),
    decisionForm = useId(),
    replaceForm = useId();
  const detail = useLoad<Organization>(() =>
    api.get(`/v1/operator/organizations/${organization.company_id}`),
  );
  const plans = useLoad(() =>
    fetchAllPages<Plan>((cursor) =>
      api.get(
        "/v1/operator/plans" +
          queryString({ limit: "100", cursor: cursor || undefined }),
      ),
    ),
  );
  const transitions = useLoad(() =>
    fetchAllPages<Transition>((cursor) =>
      api.get(
        `/v1/operator/organizations/${organization.company_id}/transitions` +
          queryString({ limit: "100", cursor: cursor || undefined }),
      ),
    ),
  );
  const exceptions = useLoad(() =>
    fetchAllPages<PlanException>((cursor) =>
      api.get(
        `/v1/operator/organizations/${organization.company_id}/exceptions` +
          queryString({ limit: "100", cursor: cursor || undefined }),
      ),
    ),
  );
  const [operation, setOperation] = useState(idempotencyKey),
    [when, setWhen] = useState<"now" | "later">("now"),
    [result, setResult] = useState<{
      kind:
        | "assignment"
        | "transition_cancel"
        | "transition_review"
        | "exception_replace";
      data: any;
    } | null>(null),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false),
    [decision, setDecision] = useState<{
      action: "cancel" | "review";
      transition: Transition;
    } | null>(null),
    [decisionOperation, setDecisionOperation] = useState(idempotencyKey),
    [replaceTarget, setReplaceTarget] = useState<PlanException | null>(null),
    [replaceOperation, setReplaceOperation] = useState(idempotencyKey);
  const inlineTrigger = useRef<HTMLButtonElement | null>(null);
  const transitionsHeading = useRef<HTMLHeadingElement | null>(null);
  function restoreInlineTrigger() {
    window.setTimeout(() => inlineTrigger.current?.focus(), 0);
  }
  function focusManagerFallback() {
    window.setTimeout(() => transitionsHeading.current?.focus(), 0);
  }
  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail.data || !assignCode.token) return;
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const [planId, planVersion] = String(form.get("plan")).split(":");
    try {
      const value = await api.put<any>(
        `/v1/operator/organizations/${organization.company_id}/entitlement`,
        {
          expected_version: detail.data.version,
          plan_id: planId,
          plan_version: Number(planVersion),
          // The server applies a time that has passed at once, so "Now" sends the current time.
          effective_at:
            when === "later"
              ? new Date(String(form.get("effective_at"))).toISOString()
              : new Date().toISOString(),
          reason: form.get("reason"),
          idempotency_key: operation,
          reauth_token: assignCode.token,
        },
      );
      settleCode(assignCode);
      setResult({ kind: "assignment", data: value });
      setOperation(idempotencyKey());
      detail.retry();
      transitions.retry();
      onChanged();
    } catch (caught) {
      setError(caught);
      settleCode(assignCode, caught);
    } finally {
      setBusy(false);
    }
  }
  async function decideTransition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!decision || !decisionCode.token) return;
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const value = await api.post(
        `/v1/operator/organizations/${organization.company_id}/transitions/${decision.transition.transition_id}/${decision.action}`,
        {
          expected_version: decision.transition.version,
          expected_company_version: decision.transition.company_version,
          reason: form.get("reason"),
          confirmed: true,
          idempotency_key: decisionOperation,
          reauth_token: decisionCode.token,
        },
      );
      settleCode(decisionCode);
      setResult({
        kind:
          decision.action === "cancel"
            ? "transition_cancel"
            : "transition_review",
        data: value,
      });
      setDecision(null);
      focusManagerFallback();
      setDecisionOperation(idempotencyKey());
      detail.retry();
      transitions.retry();
      exceptions.retry();
      onChanged();
    } catch (caught) {
      setError(caught);
      settleCode(decisionCode, caught);
    } finally {
      setBusy(false);
    }
  }
  async function replaceException(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!replaceTarget || !detail.data || !replaceCode.token) return;
    const reversal = transitions.data?.find(
      (item) => item.transition_id === replaceTarget.reversion_transition_id,
    );
    if (!reversal) return;
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const [planId, planVersion] = String(form.get("plan")).split(":");
    try {
      const value = await api.post(
        `/v1/operator/organizations/${organization.company_id}/exceptions/${replaceTarget.exception_id}/replace`,
        {
          expected_version: replaceTarget.version,
          expected_company_version: detail.data.version,
          expected_transition_version: reversal.version,
          expected_entitlement_generation:
            detail.data.entitlement_generation ?? 0,
          plan_id: planId,
          plan_version: Number(planVersion),
          reason: form.get("reason"),
          confirmed: true,
          idempotency_key: replaceOperation,
          reauth_token: replaceCode.token,
        },
      );
      settleCode(replaceCode);
      setResult({ kind: "exception_replace", data: value });
      setReplaceTarget(null);
      focusManagerFallback();
      setReplaceOperation(idempotencyKey());
      detail.retry();
      transitions.retry();
      exceptions.retry();
      onChanged();
    } catch (caught) {
      setError(caught);
      settleCode(replaceCode, caught);
    } finally {
      setBusy(false);
    }
  }
  const loading =
    (detail.busy && !detail.data) ||
    (plans.busy && !plans.data) ||
    (transitions.busy && !transitions.data) ||
    (exceptions.busy && !exceptions.data);
  const blockingTransition = (transitions.data ?? []).some((item) =>
    ["pending", "review_required"].includes(item.status),
  );
  const activeException = (exceptions.data ?? []).some((item) =>
    ["active", "revocation_scheduled"].includes(item.status),
  );
  const choices = uniquePlans(plans.data ?? []);
  const org = detail.data ?? organization;
  const members = organization.members;
  const choice = organization.retention_choice;
  const shorterChoice =
    choice !== null &&
    choice !== undefined &&
    (org.retention_months === null || choice < org.retention_months);
  const planSelect = (name: string, label: string) => (
    <label className="op-wide">
      {label}
      <select name={name} required>
        <option value="">Select plan</option>
        {choices.map((plan) => (
          <option
            key={`${plan.plan_id}:${plan.version}`}
            value={`${plan.plan_id}:${plan.version}`}
          >
            {planOption(plan)}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <Dialog
      title={`Manage ${organization.name}`}
      onClose={onClose}
      size="wide"
      actions={<Button onClick={onClose}>Close</Button>}
    >
      <p className="ad-soft op-sub">
        {orgDomain(organization)}
        {typeof members === "number" &&
          ` · ${formatInteger(members)} ${members === 1 ? "member" : "members"}`}
      </p>
      {loading ? (
        <Skeleton label="Loading organization entitlement" />
      ) : (
        <>
          <h3 className="ad-h3">Current plan</h3>
          <dl className="op-facts-rows">
            <Fact label="Plan">{planShort(org.plan_id, org.plan_version)}</Fact>
            <Fact label="Capacity">
              {formatInteger(org.capacity)} members
              {typeof members === "number" && `, ${formatInteger(members)} used`}
            </Fact>
            <Fact label="Usage retention">
              {org.retention_months === null
                ? "Until an administrator deletes it."
                : `${formatRetention(org.retention_months)}.`}{" "}
              {shorterChoice
                ? `The admins chose ${formatRetention(choice)}.`
                : "The admins have not chosen a shorter period."}
            </Fact>
          </dl>
          <section className="op-section" aria-label="Assign a plan">
          {/* The code steps hold a form of their own, so they sit after this form, not inside it. */}
          <form
            id={assignForm}
            onSubmit={assign}
            onChange={() => {
              setOperation(idempotencyKey());
              setResult(null);
            }}
          >
            <h3 className="ad-h3">Assign a plan</h3>
            <div className="op-grid">
              {planSelect("plan", "Plan version")}
              <label>
                Takes effect
                <select
                  value={when}
                  onChange={(event) =>
                    setWhen(event.target.value as "now" | "later")
                  }
                >
                  <option value="now">Now</option>
                  <option value="later">At a set date and time</option>
                </select>
              </label>
              {when === "later" && (
                <label>
                  Effective at
                  <input name="effective_at" type="datetime-local" required />
                </label>
              )}
              <label className="op-full">
                Reason
                <input
                  name="reason"
                  maxLength={200}
                  required
                  placeholder="Shown in the audit log"
                />
              </label>
            </div>
          </form>
          <OperatorCode reauth={assignCode} email={email} disabled={busy} />
          <div className="ad-actions">
            <button
              type="submit"
              form={assignForm}
              className="ad-btn ad-btn-primary"
              disabled={
                busy || blockingTransition || activeException || !assignCode.token
              }
            >
              {busy ? "Assigning plan" : "Review and assign plan"}
            </button>
          </div>
          <p className="ad-soft op-hint">
            A plan that keeps usage for a shorter time than now needs the
            organization admin to acknowledge it first. Each assignment needs a
            fresh code from your email.
          </p>
          </section>
          {(blockingTransition || activeException) && (
            <Notice
              tone="warning"
              title="Resolve the current entitlement first"
            >
              A pending or review-required transition, active exception or
              scheduled exception revocation blocks another ordinary plan
              assignment. Review the records below, then cancel, review or
              replace the applicable item.
            </Notice>
          )}
          {result && (
            <Notice
              tone={
                result.data.status === "retention_transition_pending"
                  ? "warning"
                  : undefined
              }
              title={
                result.kind === "assignment"
                  ? "Plan assignment accepted"
                  : result.kind === "transition_cancel"
                    ? "Transition cancelled"
                    : result.kind === "transition_review"
                      ? "Transition review updated"
                      : "Exception replaced"
              }
            >
              {result.kind === "assignment"
                ? result.data.status === "retention_transition_pending"
                  ? "Retention would shorten. The organization admin must review the preview and acknowledge the transition before it can take effect."
                  : result.data.status === "scheduled"
                    ? "The plan change is scheduled for the selected time."
                    : "The plan is assigned."
                : result.kind === "transition_cancel"
                  ? result.data.restored_reversion_id
                    ? `The transition was cancelled. The former exception was restored, and reversion ${result.data.restored_reversion_id} requires a fresh organization admin review.`
                    : "The transition was cancelled. The current plan remains in effect, and the cancelled transition stays in history."
                  : result.kind === "transition_review"
                    ? result.data.acknowledgement_required
                      ? "The impact preview was refreshed against the current entitlement. Organization admin acknowledgement is required before the transition can apply."
                      : "The transition was refreshed against the current entitlement and is scheduled for automatic application."
                    : result.data.status === "retention_transition_pending"
                      ? "The exception was replaced atomically. Current limits remain in effect until the organization admin acknowledges the new retention transition."
                      : "The exception was replaced atomically and the selected plan is now assigned."}
            </Notice>
          )}
          <h3 className="ad-h3" ref={transitionsHeading} tabIndex={-1}>
            Retention transitions
          </h3>
          {transitions.data?.length ? (
            <div className="ad-table-scroll op-boxed">
              <table className="ad-table">
                <thead>
                  <tr>
                    <th>Plan</th>
                    <th>Effective</th>
                    <th>Preview</th>
                    <th>State</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {transitions.data.map((transition) => (
                    <tr key={transition.transition_id}>
                      <td>{transitionPlan(transition.plan)}</td>
                      <td>{formatDateTime(transition.effective_at)}</td>
                      <td>
                        {transition.retention_preview
                          ? `${formatInteger(transition.retention_preview.request_count)} requests and ${formatInteger(transition.retention_preview.attempt_count)} attempts may expire`
                          : "No shortening preview required"}
                      </td>
                      <td className="op-wrap">
                        {transition.status === "review_required"
                          ? "Review required before this transition can apply"
                          : ["cancelled", "superseded", "applied"].includes(
                                transition.status,
                              )
                            ? `${planName(transition.status)}; historical record`
                            : transition.acknowledgement_required
                              ? transition.acknowledged
                                ? "Admin acknowledged; waiting for application"
                                : "Organization admin acknowledgement required"
                              : "Scheduled for automatic application; no admin acknowledgement required"}
                      </td>
                      <td>
                        <span className="op-row-actions">
                          {transition.operator_can_review && (
                            <button
                              type="button"
                              className="ad-btn ad-btn-sm"
                              onClick={(event) => {
                                inlineTrigger.current = event.currentTarget;
                                setResult(null);
                                setDecision({ action: "review", transition });
                                setDecisionOperation(idempotencyKey());
                              }}
                            >
                              Review against current entitlement
                            </button>
                          )}
                          {transition.operator_can_cancel && (
                            <button
                              type="button"
                              className="ad-btn ad-btn-sm"
                              onClick={(event) => {
                                inlineTrigger.current = event.currentTarget;
                                setResult(null);
                                setDecision({ action: "cancel", transition });
                                setDecisionOperation(idempotencyKey());
                              }}
                            >
                              Cancel transition
                            </button>
                          )}
                          {!transition.operator_can_review &&
                            !transition.operator_can_cancel && (
                              <span className="ad-soft">No action</span>
                            )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="ad-soft">No plan change is waiting or recorded.</p>
          )}
          {decision && (
            <section
              className="op-inline-form"
              aria-label={
                decision.action === "cancel"
                  ? "Transition cancellation"
                  : "Transition review"
              }
            >
            <form
              id={decisionForm}
              onSubmit={decideTransition}
              onChange={() => {
                setDecisionOperation(idempotencyKey());
                setError(null);
              }}
            >
              <h3 className="ad-h3">
                {decision.action === "cancel"
                  ? "Confirm transition cancellation"
                  : "Review transition against current entitlement"}
              </h3>
              <p>
                Plan {transitionPlan(decision.transition.plan)}; state{" "}
                {decision.transition.status.replaceAll("_", " ")}; effective{" "}
                {formatDateTime(decision.transition.effective_at)}.
              </p>
              <p>
                Preview:{" "}
                {formatInteger(
                  decision.transition.retention_preview?.request_count,
                )}{" "}
                requests and{" "}
                {formatInteger(
                  decision.transition.retention_preview?.attempt_count,
                )}{" "}
                attempts may expire.
              </p>
              {decision.action === "review" && (
                <dl className="ad-rows">
                  <Fact label="Current plan">
                    {decision.transition.current_entitlement
                      ? planShort(
                          decision.transition.current_entitlement.plan_id,
                          decision.transition.current_entitlement.plan_version,
                        )
                      : "Unavailable"}
                  </Fact>
                  <Fact label="Current capacity">
                    {formatInteger(
                      decision.transition.current_entitlement?.capacity,
                    )}
                  </Fact>
                  <Fact label="Current retention">
                    {decision.transition.current_entitlement
                      ? keptFor(
                          decision.transition.current_entitlement
                            .retention_months,
                        )
                      : "Unavailable"}
                  </Fact>
                  <Fact label="Target plan">
                    {decision.transition.target_entitlement
                      ? planShort(
                          decision.transition.target_entitlement.plan_id,
                          decision.transition.target_entitlement.plan_version,
                        )
                      : "Unavailable"}
                  </Fact>
                  <Fact label="Target capacity">
                    {formatInteger(
                      decision.transition.target_entitlement?.capacity,
                    )}
                  </Fact>
                  <Fact label="Target retention">
                    {decision.transition.target_entitlement
                      ? keptFor(
                          decision.transition.target_entitlement
                            .retention_months,
                        )
                      : "Unavailable"}
                  </Fact>
                  <Fact label="Retention cutoff">
                    {formatDateTime(
                      decision.transition.retention_preview?.cutoff,
                    )}
                  </Fact>
                </dl>
              )}
              {decision.action === "cancel" &&
                decision.transition.source_exception_id && (
                  <Notice tone="warning">
                    Cancelling this replacement restores the former exception
                    and creates a fresh unacknowledged reversion. The
                    organization admin must review that retention transition
                    again.
                  </Notice>
                )}
              <label>
                Review reason
                <input name="reason" maxLength={200} required />
              </label>
            </form>
            <OperatorCode reauth={decisionCode} email={email} disabled={busy} />
            <div className="ad-actions">
              <Button
                type="button"
                onClick={() => {
                  setDecision(null);
                  restoreInlineTrigger();
                }}
              >
                Keep transition
              </Button>
              <Button
                type="submit"
                form={decisionForm}
                variant={decision.action === "cancel" ? "danger" : "primary"}
                disabled={
                  busy ||
                  !decisionCode.token ||
                  (decision.action === "review" &&
                    (!decision.transition.current_entitlement ||
                      !decision.transition.target_entitlement))
                }
              >
                {decision.action === "cancel"
                  ? "Confirm cancellation"
                  : "Confirm reviewed transition"}
              </Button>
            </div>
            </section>
          )}
          <div className="op-section-head">
            <h3 className="ad-h3">Exceptions</h3>
            <a
              className="ad-link"
              href="/operator/exceptions"
              onClick={(event) => {
                if (!navigate) return;
                event.preventDefault();
                onClose();
                navigate("/operator/exceptions");
              }}
            >
              Manage exceptions
            </a>
          </div>
          {exceptions.data?.length ? (
            <ul className="op-list">
              {exceptions.data.map((item) => (
                <li key={item.exception_id}>
                  <span>
                    <b>
                      {formatInteger(item.member_capacity)} members,{" "}
                      {keptFor(item.retention_months).toLowerCase()}
                    </b>
                    <span className="ad-soft">
                      {" "}
                      · {shortDate(item.effective_at)} to{" "}
                      {shortDate(item.expires_at)} · {item.reason}
                    </span>
                  </span>
                  <span className="op-row-actions">
                    <ExceptionStatus status={item.status} />
                    {["active", "revocation_scheduled"].includes(
                      item.status,
                    ) && (
                      <button
                        type="button"
                        className="ad-btn ad-btn-sm"
                        onClick={(event) => {
                          inlineTrigger.current = event.currentTarget;
                          setResult(null);
                          setReplaceTarget(item);
                          setReplaceOperation(idempotencyKey());
                        }}
                        disabled={
                          !transitions.data?.some(
                            (transition) =>
                              transition.transition_id ===
                              item.reversion_transition_id,
                          )
                        }
                      >
                        Replace exception with plan
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ad-soft">This organization has no exception.</p>
          )}
          {replaceTarget && (
            <section
              className="op-inline-form"
              aria-label="Exception replacement"
            >
            <form
              id={replaceForm}
              onSubmit={replaceException}
              onChange={() => {
                setReplaceOperation(idempotencyKey());
                setError(null);
              }}
            >
              <h3 className="ad-h3">Confirm atomic exception replacement</h3>
              <p>
                The current exception and its reversion are replaced together.
                Apply the selected plan now. If it would shorten retention, the
                current limits remain in place until the organization admin
                reviews the preview and acknowledges the change.
              </p>
              {planSelect("plan", "Replacement plan")}
              <label>
                Replacement reason
                <input name="reason" maxLength={200} required />
              </label>
            </form>
            <OperatorCode reauth={replaceCode} email={email} disabled={busy} />
            <div className="ad-actions">
              <Button
                type="button"
                onClick={() => {
                  setReplaceTarget(null);
                  restoreInlineTrigger();
                }}
              >
                Keep exception
              </Button>
              <Button
                type="submit"
                form={replaceForm}
                variant="danger"
                disabled={busy || !replaceCode.token}
              >
                Confirm exception replacement
              </Button>
            </div>
            </section>
          )}
        </>
      )}
      {Boolean(
        error ||
        detail.error ||
        plans.error ||
        transitions.error ||
        exceptions.error,
      ) && (
        <ErrorState
          error={
            error ||
            detail.error ||
            plans.error ||
            transitions.error ||
            exceptions.error
          }
          context={error ? "action" : "page"}
          title={error ? "Plan was not assigned" : undefined}
          onRetry={
            error
              ? undefined
              : () => {
                  detail.retry();
                  plans.retry();
                  transitions.retry();
                  exceptions.retry();
                }
          }
        />
      )}
    </Dialog>
  );
}

type ContactTopic = "larger_organization" | "self_hosting" | "other";
type ContactStatus = "new" | "replied" | "closed";
type Contact = {
  id: string;
  topic: ContactTopic;
  status: ContactStatus;
  received_at: string;
  updated_at: string;
  name: string;
  email: string;
  organization: string;
  people: string | null;
  message: string;
};
type ContactList = {
  items: Contact[];
  counts?: Partial<Record<ContactStatus, number>>;
};

const TOPICS: Record<ContactTopic, string> = {
  larger_organization: "More than 50 members",
  self_hosting: "Self-hosting",
  other: "Something else",
};
const STATUS_LABELS: Record<ContactStatus, [string, string]> = {
  new: ["New", "ad-badge-info"],
  replied: ["Replied", "ad-badge-good"],
  closed: ["Closed", ""],
};
const TABS = [
  ["new", "New"],
  ["replied", "Replied"],
  ["closed", "Closed"],
  ["all", "All"],
] as const;
type Tab = (typeof TABS)[number][0];

function peopleBand(value: string | null) {
  if (!value) return "Not asked";
  if (value.endsWith("+")) return `More than ${value.slice(0, -1)}`;
  return value.replace("-", " to ");
}

function received(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}

export function OperatorContacts({
  api,
  navigate,
  email,
}: {
  api: ApiClient;
  navigate?: Navigate;
  /** The signed-in developer's address, which receives the deletion codes. */
  email?: string | null;
}) {
  const list = useLoad(() => api.get<ContactList>("/v1/operator/contacts"));
  // Deleting a request removes it for good, so it needs a fresh code; marking it does not.
  const deleteCode = useOperatorCode(api);
  const [deleteOperation, setDeleteOperation] = useState(idempotencyKey);
  const [items, setItems] = useState<Contact[] | null>(null),
    [tab, setTab] = useState<Tab>("new"),
    [selected, setSelected] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState<unknown>(null),
    [confirm, setConfirm] = useState<Contact | null>(null),
    [toast, setToast] = useState("");
  const detail = useRef<HTMLElement>(null);
  useEffect(() => {
    if (list.data) setItems(list.data.items);
  }, [list.data]);
  useEffect(() => {
    if (items) setNewContacts(items.filter((item) => item.status === "new").length);
  }, [items]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  const all = items ?? [];
  const count = (key: Tab) =>
    all.filter((item) => key === "all" || item.status === key).length;
  const shown = all.filter((item) => tab === "all" || item.status === tab);
  const current = shown.find((item) => item.id === selected) ?? shown[0];
  async function setStatus(contact: Contact, status: ContactStatus) {
    setBusy(true);
    setActionError(null);
    try {
      const updated = await api.post<Contact>(
        `/v1/operator/contacts/${contact.id}`,
        { status },
      );
      setItems((values) =>
        (values ?? []).map((item) =>
          item.id === contact.id ? { ...item, ...updated } : item,
        ),
      );
      setToast(
        status === "replied"
          ? `Marked the request from ${contact.name} as replied.`
          : status === "closed"
            ? `Closed the request from ${contact.name}.`
            : `Reopened the request from ${contact.name}.`,
      );
    } catch (caught) {
      setActionError(caught);
    } finally {
      setBusy(false);
    }
  }
  async function remove(contact: Contact) {
    if (!deleteCode.token) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.delete(`/v1/operator/contacts/${contact.id}`, {
        idempotency_key: deleteOperation,
        reauth_token: deleteCode.token,
      });
      settleCode(deleteCode);
      setDeleteOperation(idempotencyKey());
      setItems((values) =>
        (values ?? []).filter((item) => item.id !== contact.id),
      );
      setConfirm(null);
      setSelected(null);
      setToast(`Deleted the request from ${contact.name}.`);
    } catch (caught) {
      setActionError(caught);
      settleCode(deleteCode, caught);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle title="Contact requests" eyebrow="Website">
        Messages sent with the Contact form on the website.
      </PageTitle>
      {list.busy && !items ? (
        <Skeleton label="Loading contact requests" />
      ) : list.error && !items ? (
        <ErrorState error={list.error} onRetry={list.retry} />
      ) : (
        <>
          <div className="op-tabs" role="group" aria-label="Show requests">
            {TABS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={tab === key}
                onClick={() => {
                  setTab(key);
                  setSelected(null);
                  setActionError(null);
                }}
              >
                {label} ({formatInteger(count(key))})
              </button>
            ))}
          </div>
          <div className="op-inbox">
            <section className="ad-card op-messages" aria-label="Requests">
              {shown.length ? (
                <ul>
                  {shown.map((item) => {
                    const [label, tone] = STATUS_LABELS[item.status];
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          aria-current={item.id === current?.id ? "true" : undefined}
                          onClick={() => {
                            setSelected(item.id);
                            setActionError(null);
                            // On narrow screens the details sit below the list.
                            if (window.matchMedia?.("(max-width: 900px)").matches)
                              window.requestAnimationFrame(() =>
                                detail.current?.scrollIntoView({ block: "start" }),
                              );
                          }}
                        >
                          <span className="op-message-head">
                            <b>{item.name}</b>
                            <small>{received(item.received_at)}</small>
                          </span>
                          {item.organization && (
                            <span className="op-message-org">
                              {item.organization}
                            </span>
                          )}
                          <span className="op-message-tags">
                            <span className={`ad-badge ${tone}`}>{label}</span>
                            <span className="ad-badge">{TOPICS[item.topic]}</span>
                          </span>
                          <span className="op-message-preview">
                            {item.message}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="ad-soft ad-pad">No requests here.</p>
              )}
            </section>
            {current && (
              <section
                ref={detail}
                className="ad-card op-detail"
                aria-labelledby="op-contact-name"
              >
                <div className="op-detail-head">
                  <div>
                    <h2 id="op-contact-name" className="ad-h2">
                      {current.name}
                    </h2>
                    <p className="ad-soft">
                      {current.organization && `${current.organization} · `}
                      <a href={`mailto:${current.email}`}>{current.email}</a>
                    </p>
                  </div>
                  <span className={`ad-badge ${STATUS_LABELS[current.status][1]}`}>
                    {STATUS_LABELS[current.status][0]}
                  </span>
                </div>
                <dl className="op-facts">
                  <Fact label="Topic">{TOPICS[current.topic]}</Fact>
                  <Fact label="People">{peopleBand(current.people)}</Fact>
                  <Fact label="Received">{received(current.received_at)}</Fact>
                </dl>
                <p className="op-message">{current.message}</p>
                {current.status !== "new" && (
                  <p className="op-note">
                    <Icon name="check" size={16} />
                    {current.status === "replied" ? "Marked as replied" : "Closed"}{" "}
                    on {received(current.updated_at)}.
                  </p>
                )}
                <div className="ad-actions">
                  <a
                    className="ad-btn ad-btn-primary"
                    href={`mailto:${current.email}?subject=${encodeURIComponent("Your message to AI Footprint Tracker")}`}
                  >
                    <Icon name="mail" size={16} />
                    Reply by email
                  </a>
                  {current.status === "new" && (
                    <button
                      type="button"
                      className="ad-btn"
                      disabled={busy}
                      onClick={() => void setStatus(current, "replied")}
                    >
                      Mark as replied
                    </button>
                  )}
                  {current.status !== "closed" ? (
                    <button
                      type="button"
                      className="ad-btn"
                      disabled={busy}
                      onClick={() => void setStatus(current, "closed")}
                    >
                      Close
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="ad-btn"
                      disabled={busy}
                      onClick={() => void setStatus(current, "new")}
                    >
                      Reopen
                    </button>
                  )}
                  {current.topic === "larger_organization" && (
                    <a
                      className="ad-btn"
                      href="/operator/exceptions"
                      onClick={link(navigate, "/operator/exceptions")}
                    >
                      Grant more members
                    </a>
                  )}
                  <button
                    type="button"
                    className="ad-btn op-btn-danger"
                    disabled={busy}
                    onClick={() => {
                      setActionError(null);
                      setDeleteOperation(idempotencyKey());
                      setConfirm(current);
                    }}
                  >
                    <Icon name="trash" size={16} />
                    Delete
                  </button>
                </div>
                {Boolean(actionError) && !confirm && (
                  <ErrorState
                    error={actionError}
                    context="action"
                    title="The request was not changed"
                  />
                )}
                <p className="ad-soft op-hint">
                  Replies go out from your own email. Delete a request once you
                  no longer need it; the sender can ask for this at any time.
                </p>
              </section>
            )}
          </div>
        </>
      )}
      {toast && (
        <div className="op-toast" role="status">
          <span>{toast}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setToast("")}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      {confirm && (
        <Dialog
          title={`Delete the request from ${confirm.name}?`}
          dangerous
          onClose={() => setConfirm(null)}
          actions={
            <>
              <Button onClick={() => setConfirm(null)}>Cancel</Button>
              <Button
                variant="danger"
                disabled={busy || !deleteCode.token}
                onClick={() => void remove(confirm)}
              >
                Delete request
              </Button>
            </>
          }
        >
          <p>
            The message and the contact details are removed from the developer
            panel. This cannot be undone. Confirm with a fresh code from your
            email.
          </p>
          <OperatorCode reauth={deleteCode} email={email} disabled={busy} />
          {Boolean(actionError) && (
            <ErrorState
              error={actionError}
              context="action"
              title="The request was not deleted"
            />
          )}
        </Dialog>
      )}
    </>
  );
}

export function OperatorPlans({ api }: { api: ApiClient }) {
  const plans = useLoad(() =>
    fetchAllPages<Plan>((cursor) =>
      api.get(
        "/v1/operator/plans" +
          queryString({ limit: "100", cursor: cursor || undefined }),
      ),
    ),
  );
  const orgs = useLoad(() => loadOrganizations(api).catch(() => null));
  const [error, setError] = useState<unknown>(null),
    [saved, setSaved] = useState<Plan | null>(null),
    [keep, setKeep] = useState<"until" | "months">("until"),
    [busy, setBusy] = useState(false),
    [operation, setOperation] = useState(idempotencyKey);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(null);
    setBusy(true);
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const created = await api.post<Plan>("/v1/operator/plans", {
        plan_id: data.get("plan_id"),
        version: Number(data.get("version")),
        member_capacity: Number(data.get("capacity")),
        retention_months: keep === "until" ? null : Number(data.get("retention")),
        idempotency_key: operation,
      });
      setSaved(created);
      setOperation(idempotencyKey());
      form.reset();
      setKeep("until");
      plans.retry();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  const list = uniquePlans(plans.data ?? []);
  const newest = new Map<string, number>();
  for (const plan of list)
    newest.set(plan.plan_id, Math.max(newest.get(plan.plan_id) ?? 0, plan.version));
  function usage(plan: Plan) {
    const later = newest.get(plan.plan_id)!;
    const replaced = later > plan.version ? `Version ${later} is newer.` : "";
    if (!orgs.data) return replaced;
    const assigned = orgs.data.filter(
      (org) => org.plan_id === plan.plan_id && org.plan_version === plan.version,
    ).length;
    return assigned
      ? `Assigned to ${formatInteger(assigned)} ${assigned === 1 ? "organization" : "organizations"}. ${replaced}`.trim()
      : `Not assigned. ${replaced}`.trim();
  }
  return (
    <>
      <PageTitle title="Plans" eyebrow={HOSTED}>
        Plan versions never change once created. To change limits, create a new
        version and assign it.
      </PageTitle>
      {plans.busy && !plans.data ? (
        <Skeleton label="Loading plans" />
      ) : plans.error && !plans.data ? (
        <ErrorState error={plans.error} onRetry={plans.retry} />
      ) : list.length ? (
        <ul className="op-plans">
          {list.map((plan) => (
            <li key={`${plan.plan_id}:${plan.version}`} className="ad-card">
              <div className="op-plan-head">
                <h2 className="ad-h2">{planName(plan.plan_id)}</h2>
                <span className="ad-badge">Version {plan.version}</span>
              </div>
              <dl className="op-plan-figures">
                <Fact label="Members">{formatInteger(plan.member_capacity)}</Fact>
                <Fact label="Usage kept">{keptFor(plan.retention_months)}</Fact>
              </dl>
              <p className="ad-soft">
                {usage(plan) || "Admins can choose a shorter period."}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ad-soft">No plan version exists yet.</p>
      )}
      <Card title="Create a plan version">
        <form
          className="op-grid"
          onSubmit={submit}
          onChange={() => {
            setOperation(idempotencyKey());
            setSaved(null);
          }}
        >
          <label>
            Plan ID
            <input
              name="plan_id"
              // Browsers compile pattern with the v flag, where a bare "-" in a class is invalid and disables the check.
              pattern="[a-z0-9\-]{1,40}"
              maxLength={40}
              title="Lowercase letters, digits and hyphens"
              required
              placeholder="larger-organization"
            />
          </label>
          <label>
            Version
            <input name="version" type="number" min="1" required />
          </label>
          <label>
            Member capacity
            <input name="capacity" type="number" min="1" max="500" required />
            <small className="ad-soft">1 to 500</small>
          </label>
          <label>
            Usage retention
            <select
              value={keep}
              onChange={(event) =>
                setKeep(event.target.value as "until" | "months")
              }
            >
              <option value="until">Until admin deletion</option>
              <option value="months">A number of months</option>
            </select>
            <small className="ad-soft">
              Admins can always choose a shorter period.
            </small>
          </label>
          {keep === "months" && (
            <label>
              Months
              <input name="retention" type="number" min="1" max="120" required />
              <small className="ad-soft">1 to 120</small>
            </label>
          )}
          <div className="op-full op-submit">
            <button
              type="submit"
              className="ad-btn ad-btn-primary"
              disabled={busy}
            >
              {busy ? "Creating plan version" : "Create plan version"}
            </button>
            <span className="ad-soft">No price or checkout. Plans only set limits.</span>
          </div>
        </form>
        {saved && (
          <Notice title="Plan version created">
            {planLong(saved.plan_id, saved.version)} can now be assigned.
          </Notice>
        )}
        {Boolean(error) && (
          <ErrorState
            error={error}
            context="action"
            title="Plan version was not created"
          />
        )}
      </Card>
      {Boolean(plans.error && plans.data) && (
        <ErrorState error={plans.error} onRetry={plans.retry} />
      )}
    </>
  );
}

const RETENTION_STEPS = [12, 24, 36, 60, 120];

export function OperatorExceptions({
  api,
  email,
}: {
  api: ApiClient;
  /** The signed-in developer's address, which receives the action codes. */
  email?: string | null;
}) {
  const grantCode = useOperatorCode(api),
    revokeCode = useOperatorCode(api);
  const grantForm = useId();
  const orgs = useLoad(() => loadOrganizations(api));
  const list = useLoad(() =>
    fetchAllPages<ListedException>((cursor) =>
      api.get(
        "/v1/operator/exceptions" +
          queryString({ limit: "100", cursor: cursor || undefined }),
      ),
    ),
  );
  const [error, setError] = useState<unknown>(null),
    [granted, setGranted] = useState<string>(""),
    [selectedOrg, setSelectedOrg] = useState(""),
    [retention, setRetention] = useState("same"),
    [busy, setBusy] = useState(false),
    [operation, setOperation] = useState(idempotencyKey),
    [revokeOperation, setRevokeOperation] = useState(idempotencyKey),
    [revokeReason, setRevokeReason] = useState(""),
    [revokeError, setRevokeError] = useState<unknown>(null),
    [revokeTarget, setRevokeTarget] = useState<ListedException | null>(null);
  const org = orgs.data?.find((item) => item.company_id === selectedOrg);
  // An exception may only keep usage as long or longer than now; a shorter period ends a plan, not starts one.
  const retentionOptions: [string, string][] = !org
    ? [["same", "No change"]]
    : org.retention_months === null
      ? [["same", "No change, until deleted"]]
      : [
          ["same", `No change, ${formatRetention(org.retention_months)}`],
          ...RETENTION_STEPS.filter((months) => months > org.retention_months!).map(
            (months): [string, string] => [String(months), formatRetention(months)],
          ),
          ["until", "Until admin deletion"],
        ];
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!org || !grantCode.token) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setError(null);
    setGranted("");
    setBusy(true);
    try {
      const result = await api.post<PlanException>(
        `/v1/operator/organizations/${org.company_id}/exceptions`,
        {
          expected_version: org.version,
          member_capacity: Number(data.get("capacity")),
          retention_months:
            retention === "same"
              ? org.retention_months
              : retention === "until"
                ? null
                : Number(retention),
          // The server accepts exceptions that start now; a later start is not supported.
          effective_at: new Date().toISOString(),
          expires_at: endOfDay(String(data.get("ends"))),
          reason: data.get("reason"),
          idempotency_key: operation,
          reauth_token: grantCode.token,
        },
      );
      settleCode(grantCode);
      setGranted(
        `${org.name} can have up to ${formatInteger(result.member_capacity)} members until ${formatDateTime(result.expires_at)}.`,
      );
      setOperation(idempotencyKey());
      form.reset();
      setSelectedOrg("");
      setRetention("same");
      orgs.retry();
      list.retry();
    } catch (caught) {
      setError(caught);
      settleCode(grantCode, caught);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(item: ListedException) {
    if (!revokeCode.token) return;
    setRevokeError(null);
    setBusy(true);
    try {
      await api.delete(
        `/v1/operator/organizations/${item.company_id}/exceptions/${item.exception_id}`,
        {
          expected_version: item.version,
          idempotency_key: revokeOperation,
          reason: revokeReason.trim(),
          transition_acknowledgement: item.acknowledged
            ? item.reversion_transition_id
            : null,
          reauth_token: revokeCode.token,
        },
      );
      settleCode(revokeCode);
      setGranted(
        `The exception for ${item.company_name ?? "the organization"} ends now. Its plan limits apply when maintenance runs.`,
      );
      list.retry();
      orgs.retry();
      setRevokeOperation(idempotencyKey());
      setRevokeReason("");
      setRevokeTarget(null);
    } catch (caught) {
      setRevokeError(caught);
      settleCode(revokeCode, caught);
    } finally {
      setBusy(false);
    }
  }
  const rows = [...(list.data ?? [])].sort(
    (a, b) =>
      Number(["active", "revocation_scheduled"].includes(b.status)) -
        Number(["active", "revocation_scheduled"].includes(a.status)) ||
      b.effective_at.localeCompare(a.effective_at),
  );
  return (
    <>
      <PageTitle title="Exceptions" eyebrow={HOSTED}>
        Extend capacity or retention for one organization, for example after a
        contact request from an organization with more than 50 members. Set an
        end date and a clear reason. No charge is created.
      </PageTitle>
      <Card title="Grant an exception">
        <form
          id={grantForm}
          className="op-grid"
          onSubmit={submit}
          onChange={() => {
            setOperation(idempotencyKey());
            setGranted("");
          }}
        >
          <label>
            Organization
            <select
              name="company_id"
              required
              value={selectedOrg}
              onChange={(event) => {
                setSelectedOrg(event.target.value);
                setRetention("same");
              }}
            >
              <option value="">Select organization</option>
              {orgs.data?.map((item) => (
                <option value={item.company_id} key={item.company_id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Member capacity
            <input
              key={selectedOrg}
              name="capacity"
              type="number"
              min="1"
              max="500"
              defaultValue={org?.capacity}
              required
            />
          </label>
          <label>
            Usage retention
            <select
              value={retention}
              onChange={(event) => setRetention(event.target.value)}
            >
              {retentionOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Ends
            <input name="ends" type="date" min={tomorrow()} required />
            <small className="ad-soft">At the end of this day, your time</small>
          </label>
          <label className="op-full">
            Reason
            <input
              name="reason"
              maxLength={200}
              required
              placeholder="Shown in the audit log"
            />
          </label>
        </form>
        <OperatorCode reauth={grantCode} email={email} disabled={busy} />
        <div className="op-submit">
          <button
            type="submit"
            form={grantForm}
            className="ad-btn ad-btn-primary"
            disabled={busy || !org || !grantCode.token}
          >
            {busy ? "Granting exception" : "Grant exception"}
          </button>
          <span className="ad-soft">
            Starts as soon as you grant it. Each grant needs a fresh code from
            your email.
          </span>
        </div>
        {granted && <Notice title="Exception saved">{granted}</Notice>}
        {Boolean(error) && (
          <ErrorState
            error={error}
            context="action"
            title="Exception was not granted"
          />
        )}
        {Boolean(orgs.error) && (
          <ErrorState error={orgs.error} onRetry={orgs.retry} />
        )}
      </Card>
      <Card title="Current and recent exceptions" className="ad-card-table">
        {list.busy && !list.data ? (
          <Skeleton label="Loading exceptions" />
        ) : list.error && !list.data ? (
          <ErrorState error={list.error} onRetry={list.retry} />
        ) : rows.length ? (
          <div className="ad-table-scroll">
            <table className="ad-table">
              <thead>
                <tr>
                  <th>Organization</th>
                  <th>Status</th>
                  <th>Capacity</th>
                  <th>Retention</th>
                  <th>Starts</th>
                  <th>Ends</th>
                  <th>Reason</th>
                  <th>
                    <span className="ad-hidden">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => {
                  const waiting = item.retention_shortened && !item.acknowledged;
                  const name = item.company_name ?? "Deleted organization";
                  return (
                    <tr key={item.exception_id}>
                      <th scope="row">{name}</th>
                      <td>
                        <ExceptionStatus status={item.status} />
                      </td>
                      <td>{formatInteger(item.member_capacity)} members</td>
                      <td>{keptFor(item.retention_months)}</td>
                      <td>{shortDate(item.effective_at)}</td>
                      <td>{shortDate(item.expires_at)}</td>
                      <td className="op-wrap">{item.reason}</td>
                      <td>
                        {item.status === "active" &&
                          (waiting ? (
                            <span
                              className="ad-soft op-wrap"
                              title="The exception keeps usage longer than the plan. Its organization admin must acknowledge the shorter retention before it can end early."
                            >
                              Waiting for the admin to acknowledge
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="ad-btn ad-btn-sm op-btn-danger"
                              aria-label={`Revoke the exception for ${name}`}
                              onClick={() => {
                                setRevokeError(null);
                                setRevokeReason("");
                                setRevokeOperation(idempotencyKey());
                                setRevokeTarget(item);
                              }}
                            >
                              Revoke
                            </button>
                          ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ad-soft ad-pad">No exception has been granted.</p>
        )}
        <p className="ad-soft ad-pad op-table-note">
          When an exception that extends retention ends, the organization admin
          must acknowledge the shorter retention first.
        </p>
        {Boolean(list.error && list.data) && (
          <ErrorState error={list.error} onRetry={list.retry} />
        )}
      </Card>
      {revokeTarget && (
        <Dialog
          title="Revoke this exception?"
          dangerous
          onClose={() => setRevokeTarget(null)}
          actions={
            <>
              <Button onClick={() => setRevokeTarget(null)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={() => void revoke(revokeTarget)}
                disabled={!revokeReason.trim() || busy || !revokeCode.token}
              >
                Revoke exception
              </Button>
            </>
          }
        >
          <p>
            {revokeTarget.company_name ?? "The organization"} returns to its
            plan limits. It now has an exception for{" "}
            {formatInteger(revokeTarget.member_capacity)} members and{" "}
            {keptFor(revokeTarget.retention_months).toLowerCase()} retention,
            until {shortDate(revokeTarget.expires_at)}.
          </p>
          {revokeTarget.retention_shortened && (
            <Notice tone="warning">
              Retention gets shorter. The organization admin has acknowledged
              this, so older usage can be deleted when the change applies.
            </Notice>
          )}
          <label>
            Reason for revoking
            <input
              value={revokeReason}
              maxLength={200}
              required
              onChange={(event) => {
                setRevokeReason(event.target.value);
                setRevokeOperation(idempotencyKey());
                setRevokeError(null);
              }}
            />
          </label>
          <p>Confirm with a fresh code from your email.</p>
          <OperatorCode reauth={revokeCode} email={email} disabled={busy} />
          {Boolean(revokeError) && (
            <ErrorState
              error={revokeError}
              context="action"
              title="The exception was not revoked"
            />
          )}
        </Dialog>
      )}
      <DomainClaims api={api} email={email} />
    </>
  );
}

type DomainClaim = {
  approval_id: string;
  domain: string;
  version: number;
  reason: string;
  reviewed_at: string;
  expires_at: string;
  status: string;
};

function DomainClaims({
  api,
  email,
}: {
  api: ApiClient;
  email?: string | null;
}) {
  // An approval lets a further organization register on a domain another one uses.
  const approveCode = useOperatorCode(api);
  const approveForm = useId();
  const page = useLoad(() =>
    fetchAllPages<DomainClaim>((cursor) =>
      api.get(
        "/v1/operator/domain-claims" +
          queryString({ limit: "100", cursor: cursor || undefined }),
      ),
    ),
  );
  const [operation, setOperation] = useState(idempotencyKey),
    [result, setResult] = useState<DomainClaim | null>(null),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  async function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!approveCode.token) return;
    setBusy(true);
    setError(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    const domain = String(data.get("domain")).trim().toLowerCase();
    const existing = page.data?.find((item) => item.domain === domain);
    try {
      setResult(
        await api.post<DomainClaim>("/v1/operator/domain-claims", {
          domain,
          expected_version: existing?.version ?? 0,
          reason: data.get("reason"),
          expires_at: endOfDay(String(data.get("expires_at"))),
          idempotency_key: operation,
          reauth_token: approveCode.token,
        }),
      );
      settleCode(approveCode);
      setOperation(idempotencyKey());
      form.reset();
      page.retry();
    } catch (caught) {
      setError(caught);
      settleCode(approveCode, caught);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title="Work email domains">
      <p className="ad-soft ad-card-sub">
        Let one more organization register with a work domain that another
        organization already uses, for example a group or subsidiary domain.
        The approval does not create the organization or verify its
        administrator. Members connect by their email domain. On a shared
        domain only existing members are matched to their organization, so
        new members cannot join from the extension.
      </p>
      <form
        id={approveForm}
        className="op-grid"
        onSubmit={approve}
        onChange={() => {
          setOperation(idempotencyKey());
          setResult(null);
        }}
      >
        <label>
          Domain
          <input
            name="domain"
            required
            maxLength={253}
            placeholder="example-group.com"
          />
        </label>
        <label>
          Approval ends
          <input name="expires_at" type="date" min={tomorrow()} required />
        </label>
        <label className="op-full">
          Reason
          <input
            name="reason"
            maxLength={200}
            required
            placeholder="Shown in the audit log"
          />
        </label>
      </form>
      <OperatorCode reauth={approveCode} email={email} disabled={busy} />
      <div className="op-submit">
        <button
          type="submit"
          form={approveForm}
          className="ad-btn ad-btn-primary"
          disabled={busy || !approveCode.token}
        >
          {busy ? "Approving domain" : "Approve domain"}
        </button>
        <span className="ad-soft">
          Each approval needs a fresh code from your email.
        </span>
      </div>
      {result && (
        <Notice title="Domain approved">
          One more organization may register with {result.domain} until{" "}
          {formatDateTime(result.expires_at)}.
        </Notice>
      )}
      {Boolean(error) && (
        <ErrorState
          error={error}
          context="action"
          title="Domain was not approved"
        />
      )}
      {page.busy && !page.data ? (
        <Skeleton label="Loading domain approvals" />
      ) : page.error ? (
        <ErrorState error={page.error} onRetry={page.retry} />
      ) : page.data?.length ? (
        <ul className="op-list op-list-top">
          {page.data.map((item) => (
            <li key={item.approval_id}>
              <span>
                <b>{item.domain}</b>
                <span className="ad-soft">
                  {" "}
                  approved {shortDate(item.reviewed_at)}{" "}
                  until {shortDate(item.expires_at)} · {item.reason}
                </span>
              </span>
              <span
                className={`ad-badge ${item.status === "approved" ? "ad-badge-good" : ""}`}
              >
                {planName(item.status)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ad-soft op-hint">No domain has been approved.</p>
      )}
    </Card>
  );
}

type AuditItem = {
  at: string;
  action: string;
  target: string;
  actor: string;
  actor_kind?: string;
  company_id?: string | null;
  details?: Record<string, unknown> | null;
};
type HealthData = {
  status: string;
  organizations: number;
  mail_adapter: string;
  mail_privacy_verified: boolean;
  retention_transitions_requiring_action?: number;
};

const ACTIONS: Record<string, [string, string]> = {
  plan_created: ["Plan version created", ""],
  plan_assigned: ["Plan assigned", "ad-badge-good"],
  plan_transition_scheduled: ["Plan change scheduled", "ad-badge-info"],
  plan_transition_cancelled: ["Plan change cancelled", ""],
  plan_transition_reviewed: ["Plan change reviewed", "ad-badge-info"],
  exception_granted: ["Exception granted", "ad-badge-info"],
  exception_revocation_scheduled: ["Exception revoked", ""],
  exception_replaced: ["Exception replaced", ""],
  domain_exception_approved: ["Domain approved", "ad-badge-good"],
  contact_request_status: ["Contact request updated", ""],
  contact_request_deleted: ["Contact request deleted", ""],
};

function actionLabel(item: AuditItem): [string, string] {
  if (item.action === "service_status_changed")
    return item.details?.status === "suspended"
      ? ["Service suspended", "ad-badge-danger"]
      : ["Service restored", "ad-badge-good"];
  return ACTIONS[item.action] ?? [planName(item.action.replaceAll("_", "-")), ""];
}

function auditDetails(item: AuditItem) {
  const details = item.details ?? {};
  const parts: string[] = [];
  if (typeof details.plan === "string") parts.push(transitionPlan(details.plan));
  if (item.action === "contact_request_status" && typeof details.status === "string")
    parts.push(`Marked ${details.status}`);
  if (typeof details.domain === "string")
    parts.push(details.domain);
  if (typeof details.expires_at === "string")
    parts.push(`Ends ${shortDate(details.expires_at)}`);
  if (typeof details.reason === "string" && details.reason) parts.push(details.reason);
  return parts.join(" · ");
}

export function OperatorHealth({ api }: { api: ApiClient }) {
  const health = useLoad(() => api.get<HealthData>("/v1/operator/health"));
  const orgs = useLoad(() => loadOrganizations(api).catch(() => null));
  const first = useLoad(() =>
    api.get<{ items: AuditItem[]; next_cursor?: string | null }>(
      "/v1/operator/audit" + queryString({ limit: "50" }),
    ),
  );
  const [more, setMore] = useState<{ items: AuditItem[]; next: string | null }>(
    { items: [], next: null },
  );
  const [loadingMore, setLoadingMore] = useState(false),
    [moreError, setMoreError] = useState<unknown>(null),
    [filter, setFilter] = useState("all");
  useEffect(() => setMore({ items: [], next: null }), [first.data]);
  const next = more.items.length ? more.next : (first.data?.next_cursor ?? null);
  async function showOlder() {
    if (!next) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await api.get<{ items: AuditItem[]; next_cursor?: string | null }>(
        "/v1/operator/audit" + queryString({ limit: "50", cursor: next }),
      );
      setMore((value) => ({
        items: [...value.items, ...page.items],
        next: page.next_cursor ?? null,
      }));
    } catch (caught) {
      setMoreError(caught);
    } finally {
      setLoadingMore(false);
    }
  }
  const names = new Map((orgs.data ?? []).map((org) => [org.company_id, org.name]));
  const entries = [...(first.data?.items ?? []), ...more.items];
  const labels = [...new Set(entries.map((item) => actionLabel(item)[0]))].sort();
  const rows = entries.filter(
    (item) => filter === "all" || actionLabel(item)[0] === filter,
  );
  function target(item: AuditItem) {
    if (item.action === "plan_created") return transitionPlan(item.target);
    if (item.action.startsWith("contact_request")) return "Contact request";
    if (item.action === "domain_exception_approved")
      return typeof item.details?.domain === "string"
        ? `Work domain ${item.details.domain}`
        : "Work domain";
    const company = item.company_id ?? item.target;
    return names.get(company) ?? (item.company_id ? "Deleted organization" : "Service");
  }
  const active = (orgs.data ?? []).filter((org) => org.status === "active").length;
  const waiting = health.data?.retention_transitions_requiring_action ?? 0;
  return (
    <>
      <PageTitle title="Health and audit" eyebrow={HOSTED} />
      {health.busy && !health.data ? (
        <Skeleton label="Checking the service" />
      ) : health.error ? (
        <ErrorState error={health.error} onRetry={health.retry} />
      ) : (
        health.data && (
          <>
            <div className="op-health">
              <div className="ad-note-card">
                <span
                  className={`ad-note-icon ${health.data.status === "available" ? "ad-tone-good" : "ad-tone-warn"}`}
                  aria-hidden="true"
                >
                  <Icon name={health.data.status === "available" ? "check" : "alert"} size={18} />
                </span>
                <div>
                  <b>Service</b>
                  <p>
                    {health.data.status === "available"
                      ? "API responds normally"
                      : `API reports ${health.data.status.replaceAll("_", " ")}`}
                  </p>
                </div>
              </div>
              <div className="ad-note-card">
                <span className="ad-note-icon" aria-hidden="true">
                  <Icon name="building" size={18} />
                </span>
                <div>
                  <b>Organizations</b>
                  <p>
                    {orgs.data
                      ? `${formatInteger(active)} active, ${formatInteger(orgs.data.length - active)} suspended`
                      : `${formatInteger(health.data.organizations)} registered`}
                  </p>
                </div>
              </div>
              <div className="ad-note-card">
                <span className="ad-note-icon" aria-hidden="true">
                  <Icon name="mail" size={18} />
                </span>
                <div>
                  <b>Mail sender</b>
                  <p>
                    {health.data.mail_adapter === "fake"
                      ? "Test sender. No mail leaves the server."
                      : `${planName(health.data.mail_adapter)} sends sign-in codes.`}
                  </p>
                </div>
              </div>
              <div
                className={`ad-note-card ${health.data.mail_privacy_verified ? "" : "op-note-warn"}`}
              >
                <span
                  className={`ad-note-icon ${health.data.mail_privacy_verified ? "ad-tone-good" : "ad-tone-warn"}`}
                  aria-hidden="true"
                >
                  <Icon name="shield" size={18} />
                </span>
                <div>
                  <b>Mail privacy</b>
                  <p>
                    {health.data.mail_privacy_verified
                      ? "Verified."
                      : "Not verified. Check the sender's tracking and logging settings."}
                  </p>
                </div>
              </div>
            </div>
            {waiting > 0 && (
              <Notice
                tone="warning"
                title={`${formatInteger(waiting)} ${waiting === 1 ? "plan change is" : "plan changes are"} past their date`}
              >
                Each waits for an organization admin to acknowledge shorter
                retention, or for a developer review. Open the organization
                under Organizations to see it.
              </Notice>
            )}
          </>
        )
      )}
      <Card
        title="Audit log"
        className="ad-card-table"
        aside={
          labels.length > 1 && (
            <ChipMenu<string>
              name="Action"
              label={filter === "all" ? "All actions" : filter}
              value={filter}
              options={[
                { value: "all", label: "All actions" },
                ...labels.map((label) => ({ value: label, label })),
              ]}
              onChange={setFilter}
            />
          )
        }
      >
        {first.busy && !first.data ? (
          <Skeleton label="Loading the audit log" />
        ) : first.error && !first.data ? (
          <ErrorState error={first.error} onRetry={first.retry} />
        ) : rows.length ? (
          <div className="ad-table-scroll">
            <table className="ad-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>By</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item, index) => {
                  const [label, tone] = actionLabel(item);
                  return (
                    <tr key={`${item.at}-${item.target}-${index}`}>
                      <td>{received(item.at)}</td>
                      <td>
                        <span className={`ad-badge ${tone}`}>{label}</span>
                      </td>
                      <th scope="row">{target(item)}</th>
                      <td>
                        {item.actor_kind === "operator" || item.actor === "operator" ? (
                          <>
                            Developer
                            <small className="ad-mono" title="Developers are recorded by a pseudonym, not by email">
                              {item.actor.slice(0, 8)}
                            </small>
                          </>
                        ) : (
                          "Organization admin"
                        )}
                      </td>
                      <td className="op-wrap">{auditDetails(item)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ad-soft ad-pad">
            {entries.length
              ? "No loaded action matches this filter."
              : "No developer action has been recorded."}
          </p>
        )}
        {(next || Boolean(moreError)) && (
          <div className="ad-more">
            {next && (
              <button
                type="button"
                className="ad-btn"
                onClick={showOlder}
                disabled={loadingMore}
              >
                <Icon name="chevronDown" size={16} />
                {loadingMore ? "Loading" : "Show older actions"}
              </button>
            )}
            {Boolean(moreError) && (
              <ErrorState
                error={moreError}
                context="action"
                title="Older actions could not be loaded"
              />
            )}
          </div>
        )}
      </Card>
    </>
  );
}
