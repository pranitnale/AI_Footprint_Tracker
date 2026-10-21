import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  Button,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  ExtractedFileTextDetails,
  Filters,
  Loading,
  Notice,
  Pagination,
  PageTitle,
  Status,
  SummaryMetrics,
  formatDateTime,
  formatInteger,
  formatMetric,
  formatRetention,
} from "./components";
import { ApiClient, companyConfig, forgetSessionReads, idempotencyKey, queryString } from "./api";
import type { Navigate } from "./router";
import type {
  CalculationMethod,
  Member,
  MethodInventory,
  OtpChallenge,
  RequestRow,
  Session,
  Summary,
} from "./types";
import { buildDeletionExecution, buildDeletionPreview } from "./safety";
import { fetchAllPages, MEMBER_PAGE_LIMIT, useCursorPage } from "./paging";
import { previousMonthRange } from "@footprint/ui/dates";
import { AdminModels } from "./admin/AdminModels";
import { Card, ChipMenu, PeriodMenu, ScenarioMenu, ToolMenu, UpdatingNote } from "./admin/controls";
import { SITE_LABELS, adminFigures, baseText, dashWindow, modelName, periodQuery, type AdminSummary } from "./admin/figures";
import { cachedSince, useAdminView, useFigures } from "./admin/state";
import { ActionReauthSteps, useActionReauth } from "./admin/reauth";
import { OrganizationDeletion } from "./admin/AdminOrganization";
import { PersonFloorNote, personFloorDay } from "./admin/AdminPeopleNamed";
import type { HealthSummary } from "./admin/AdminOverview";
import type { ServerFeatures } from "./admin/features";
import { Icon } from "@footprint/ui/icons";
import { toGrams, toMillilitres, toWh } from "@footprint/ui/comparisons";
import { scenarioValue, type DisplayScenario } from "@footprint/contracts";

function useApi<T>(load: () => Promise<T>, dependencies: unknown[] = []) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState<unknown>(null),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  const retry = () => setRevision((value) => value + 1);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setData(null);
    load()
      .then((value) => active && setData(value))
      .catch((value) => active && setError(value))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [revision, ...dependencies]);
  return { data, error, loading, retry, setData };
}

function AsyncPage<T>({
  state,
  children,
}: {
  state: ReturnType<typeof useApi<T>>;
  children: (data: T) => React.ReactNode;
}) {
  if (state.loading && !state.data)
    return <Loading label="Loading current organization data" />;
  if (state.error && !state.data)
    return <ErrorState error={state.error} onRetry={state.retry} />;
  return (
    <>
      {state.error && <ErrorState error={state.error} onRetry={state.retry} />}{" "}
      {state.data && children(state.data)}
    </>
  );
}

function useCompanyTimezone(api: ApiClient) {
  return useApi(() => companyConfig<{ timezone: string }>(api));
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function AdminTools({ api, features }: { api: ApiClient; features?: ServerFeatures }) {
  const [filters, setFilters] = useState<Record<string, string>>({
    period: "month",
  });
  const state = useApi(
    () =>
      fetchAllPages<{
        site: string;
        model_id: string | null;
        request_count: string;
        attempt_count: string;
        active_users: string;
        unconfirmed_attempt_count: string;
      }>((cursor) =>
        api.get(
          "/v1/admin/breakdown" +
            queryString({
              ...filters,
              group_by: "site_model",
              limit: "100",
              cursor: cursor || undefined,
            }),
        ),
      ),
    [JSON.stringify(filters)],
  );
  const methods = useApi(() => api.get<MethodInventory>("/v1/methods"));
  const timezone = useCompanyTimezone(api);
  // Members are listed only for recalculating one person, which needs person analytics.
  const named = features?.person_analytics === true;
  const users = useApi(
    () =>
      named
        ? fetchAllPages<Member>((cursor) =>
            api.get("/v1/admin/users" + queryString({ limit: MEMBER_PAGE_LIMIT, cursor: cursor || undefined })),
          )
        : Promise.resolve(null),
    [named],
  );
  return (
    <AdminModels api={api}>
      <Card title="Calculation methods and coverage" className="ad-methods">
        <details>
          <summary>Requests and attempts per model</summary>
          <Filters
            values={filters}
            onChange={setFilters}
            timezone={timezone.data?.timezone}
          />
          <AsyncPage state={state}>
            {(data) => (
              <>
                <DataTable
                  headers={[
                    "Tool",
                    "Observed model",
                    "Requests",
                    "Attempts",
                    "Active users",
                    "Unconfirmed attempts",
                  ]}
                  rows={data.map((row) => [
                    siteName(row.site),
                    row.model_id ?? "Unknown",
                    formatInteger(row.request_count),
                    formatInteger(row.attempt_count),
                    formatInteger(row.active_users),
                    formatInteger(row.unconfirmed_attempt_count),
                  ])}
                />
                <p className="ad-soft">
                  Observed request and attempt coverage. Electricity, carbon
                  and water can have different scopes, which Details explains
                  for each request.
                </p>
              </>
            )}
          </AsyncPage>
        </details>
        <details>
          <summary>Calculation methods and recalculated views</summary>
          <AsyncPage state={methods}>
            {(inventory) => (
              <>
                <p>
                  Original calculations remain part of the audit history.
                  Recalculated views use a selected installed method and never
                  rewrite the observations collected by browsers.
                </p>
                <DataTable
                  headers={[
                    "Method",
                    "Equation",
                    "Validation",
                    "Approval",
                    "Installed",
                  ]}
                  rows={inventory.methods.map((method) => [
                    <details>
                      <summary>{method.method_id}</summary>
                      <code>{method.method_hash}</code>
                    </details>,
                    method.equation_id,
                    method.validation_state.replaceAll("_", " "),
                    method.approval.trust.replaceAll("_", " "),
                    method.installed_at
                      ? formatDateTime(method.installed_at)
                      : "Packaged with this release",
                  ])}
                />
                <RecalculationPanel
                  api={api}
                  methods={inventory.methods}
                  users={named ? (users.data ?? []) : undefined}
                />
              </>
            )}
          </AsyncPage>
        </details>
        {Boolean(users.error) && <ErrorState error={users.error} onRetry={users.retry} />}
        {Boolean(timezone.error) && (
          <ErrorState error={timezone.error} onRetry={timezone.retry} />
        )}
      </Card>
    </AdminModels>
  );
}

type RecalculationJob = {
  job_id: string;
  method_id: string;
  calculation_view: "recalculated";
  status: "pending" | "completed" | "invalidated" | "failed";
  /** Null for a job for one person, whose count would include records from before the switch. */
  processed_estimates: number | null;
  created_at: string;
  completed_at: string | null;
  error_code: string | null;
  requires_advance: false;
};

/**
 * Recalculates the organization's retained records with an installed method. One person can be
 * chosen (users) only while the server has person analytics switched on; otherwise the server
 * refuses it (owner decision of 18 October 2026) and the panel offers no choice.
 */
function RecalculationPanel({
  api,
  methods,
  users,
}: {
  api: ApiClient;
  methods: CalculationMethod[];
  users?: Member[];
}) {
  const [methodId, setMethodId] = useState(methods[0]?.method_id ?? ""),
    [userId, setUserId] = useState(""),
    [job, setJob] = useState<RecalculationJob | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  async function start(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setJob(
        await api.post<RecalculationJob>("/v1/admin/recalculations", {
          method_id: methodId,
          operation_id: idempotencyKey(),
          ...(users && userId ? { user_id: userId } : {}),
        }),
      );
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  const refresh = useCallback(async () => {
    if (!job) return;
    try {
      setJob(
        await api.get<RecalculationJob>(
          `/v1/admin/recalculations/${encodeURIComponent(job.job_id)}`,
        ),
      );
    } catch (caught) {
      setError(caught);
    }
  }, [api, job?.job_id]);
  useEffect(() => {
    if (job?.status !== "pending") return;
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [job?.status, refresh]);
  return (
    <section className="panel">
      <h2>Create a recalculated view</h2>
      <p>
        Installed methods are reference calculations. Their validation status is
        shown above and does not establish a preferred scientific method.
      </p>
      <form className="form-row" onSubmit={start}>
        <label>
          Method
          <select
            value={methodId}
            onChange={(event) => setMethodId(event.target.value)}
            required
          >
            {methods.map((method) => (
              <option key={method.method_id} value={method.method_id}>
                {method.method_id}
              </option>
            ))}
          </select>
        </label>
        {users ? (
          <label>
            Scope
            <select value={userId} onChange={(event) => setUserId(event.target.value)}>
              <option value="">All retained organization records</option>
              {users.map((user) => (
                <option key={user.user_id} value={user.user_id}>
                  {user.email ?? user.user_id}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="ad-soft">Recalculates all retained organization records.</p>
        )}
        <Button type="submit" variant="primary" disabled={busy || !methodId}>
          {busy ? "Starting calculation" : "Start recalculation"}
        </Button>
      </form>
      {job && (
        <Notice
          tone={
            job.status === "completed"
              ? undefined
              : job.status === "pending"
                ? "warning"
                : "danger"
          }
          title={`Calculation ${job.status.replaceAll("_", " ")}`}
        >
          {job.processed_estimates === null ? (
            <p>Recalculating one member's records with method {job.method_id}. Their number is not shown.</p>
          ) : (
            <p>
              {formatInteger(job.processed_estimates)} estimates saved with method{" "}
              {job.method_id}. This count can grow when corrected records create
              new estimate revisions.
            </p>
          )}
          {job.error_code && <p>{job.error_code.replaceAll("_", " ")}</p>}
          <Button onClick={() => void refresh()} disabled={busy}>
            Refresh status
          </Button>
        </Notice>
      )}
      {Boolean(error) && (
        <ErrorState
          error={error}
          context="action"
          title="Recalculation was not started"
        />
      )}
    </section>
  );
}
function siteName(value: string) {
  return value === "chatgpt"
    ? "ChatGPT"
    : value.charAt(0).toUpperCase() + value.slice(1);
}

function humanize(value: unknown) {
  return typeof value === "string" && value
    ? value.replaceAll("_", " ")
    : "Unknown";
}

// The per-person pages below (Requests, request details and Network) are shown only while the
// server has person analytics, and for Network also IP collection, switched on (operator
// settings, owner decision of 18 October 2026). Off, admin-app routes to the aggregate pages.
const MORE = 15;

/** The request list's status for one row, from what the server counted. */
function requestStatus(item: RequestRow): { label: string; tone: "good" | "info" | "warning" | "neutral" } {
  const figures = item.figures;
  if (figures?.energy_status === "pending") return { label: "Calculating", tone: "info" };
  if (item.state !== "completed" && !figures?.tokens_out) return { label: "Reply not counted", tone: "warning" };
  if (figures?.energy_status === "available") return { label: "Counted", tone: "good" };
  return { label: "Not estimated", tone: "neutral" };
}

export function AdminRequests({ api }: { api: ApiClient }) {
  const view = useAdminView();
  const config = useCompanyTimezone(api);
  const [now] = useState(() => new Date());
  const timezone = config.data?.timezone;
  const window = timezone ? dashWindow(view.period, timezone, now) : null;
  const [model, setModel] = useState("");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<RequestRow | null>(null);
  const filters = window
    ? { ...periodQuery(window), ...(view.site ? { site: view.site } : {}), ...(model ? { model } : {}) }
    : null;
  const key = JSON.stringify(filters);
  // The summary for all models lists the models to choose from. Without a chosen model it is also
  // the page's summary, so the same request is not sent twice.
  const allModels = filters ? "/v1/admin/summary" + queryString({ ...filters, model: undefined }) : null;
  const models = useFigures(api, allModels, () => api.get<AdminSummary>(allModels!));
  const oneModel = filters && model ? "/v1/admin/summary" + queryString(filters) : null;
  const chosen = useFigures(api, oneModel, () => api.get<AdminSummary>(oneModel!));
  const summary = model ? chosen : models;
  const members = useApi(() =>
    fetchAllPages<Member>((cursor) => api.get("/v1/admin/users" + queryString({ limit: MEMBER_PAGE_LIMIT, cursor: cursor || undefined }))),
  );
  const list = useApi(
    () =>
      filters
        ? api.get<{ items: RequestRow[]; next_cursor?: string | null; person_analytics_since?: string }>(
            "/v1/admin/requests" + queryString({ ...filters, limit: String(MORE) }),
          )
        : Promise.resolve({ items: [], next_cursor: null }),
    [key],
  );
  const [more, setMore] = useState<{ items: RequestRow[]; next: string | null; key: string }>({ items: [], next: null, key: "" });
  const [loadingMore, setLoadingMore] = useState(false),
    [moreError, setMoreError] = useState<unknown>(null);
  const extra = more.key === key ? more.items : [];
  const next = more.key === key && more.items.length ? more.next : (list.data?.next_cursor ?? null);
  async function showMore() {
    if (!filters || !next) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await api.get<{ items: RequestRow[]; next_cursor?: string | null }>(
        "/v1/admin/requests" + queryString({ ...filters, limit: String(MORE), cursor: next }),
      );
      setMore({ items: [...extra, ...page.items], next: page.next_cursor ?? null, key });
    } catch (caught) {
      setMoreError(caught);
    } finally {
      setLoadingMore(false);
    }
  }
  const emails = new Map((members.data ?? []).map((member) => [member.user_id, member.email]));
  const rows = [...(list.data?.items ?? []), ...extra].filter(
    (item) => !search.trim() || (emails.get(item.user_id) ?? "").toLowerCase().includes(search.trim().toLowerCase()),
  );
  const figures = summary.data ? adminFigures(summary.data, view.scenario) : null;
  const live = summary.data?.request_count ?? null;
  const saved = summary.data?.history?.status === "available" ? summary.data.history.prompt_count : null;
  const modelIds = Object.keys(models.data?.models ?? {}).sort((a, b) => modelName(a).localeCompare(modelName(b)));
  const error = config.error ?? list.error;
  const updating = cachedSince(summary);
  // The totals above cover the whole period, the list only the days from this one on.
  const floor = window && timezone ? personFloorDay(list.data?.person_analytics_since, window, timezone) : null;
  return (
    <>
      <PageTitle title="Requests" actions={<ScenarioMenu />}>
        {updating !== null && <UpdatingNote since={updating} />}
      </PageTitle>
      <div className="ad-card ad-filter-bar">
        <label className="ad-search">
          <Icon name="search" size={16} />
          <span className="ad-hidden">Search by work email</span>
          <input type="search" placeholder="Search by work email" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        {timezone && <PeriodMenu timezone={timezone} now={now} />}
        <ToolMenu />
        <ChipMenu<string>
          name="Model"
          label={model ? modelName(model) : "All models"}
          value={model}
          options={[{ value: "", label: "All models" }, ...modelIds.map((id) => ({ value: id, label: modelName(id) }))]}
          onChange={setModel}
        />
      </div>
      {summary.data && summary.data.aggregate_status === "current" && (
        <ul className="ad-stat-chips" aria-label="Requests in this view">
          <li className="ad-stat-total">
            <b>{figures?.requestsText ?? formatInteger(live)}</b> requests
          </li>
          <li className="ad-stat-good">
            <b>{formatInteger(live)}</b> seen live
          </li>
          {saved !== null && saved !== "0" && (
            <li>
              <b>{formatInteger(saved)}</b> from earlier messages
            </li>
          )}
          {summary.data.pending_estimates && summary.data.pending_estimates !== "0" && (
            <li className="ad-stat-info">
              <b>{formatInteger(summary.data.pending_estimates)}</b> calculating
            </li>
          )}
          {summary.data.unresolved_request_count && summary.data.unresolved_request_count !== "0" && (
            <li className="ad-stat-warn">
              <b>{formatInteger(summary.data.unresolved_request_count)}</b> replies not counted
            </li>
          )}
        </ul>
      )}
      {floor && <PersonFloorNote day={floor} />}
      {error ? (
        <ErrorState error={error} onRetry={() => (config.error ? config.retry() : list.retry())} />
      ) : list.loading && !list.data ? (
        <Loading label="Loading requests" />
      ) : (
        <section className="ad-card ad-card-table" aria-label="Recorded requests">
          {rows.length ? (
            <div className="ad-table-scroll">
              <table className="ad-table ad-table-stacked">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Work email</th>
                    <th>Tool and model</th>
                    <th className="num">Tokens in</th>
                    <th className="num">Tokens out</th>
                    <th className="num">Electricity</th>
                    <th>Source</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((item) => {
                    const status = requestStatus(item);
                    const energy = item.figures?.energy;
                    return (
                      <tr key={`${item.user_id}-${item.request_id}`}>
                        <td data-label="Time">
                          <button type="button" className="ad-link" onClick={() => setDetail(item)} aria-label={`Open Details for the request at ${formatDateTime(item.dispatched_at)}`}>
                            {shortTime(item.dispatched_at)}
                          </button>
                        </td>
                        <th scope="row">{emails.get(item.user_id) ?? "Email not available"}</th>
                        <td data-label="Tool and model">
                          <span className="ad-model-cell">
                            <i className={`ad-dot ad-tool-${item.site}`} aria-hidden="true" />
                            <span>
                              {item.model_id ? modelName(item.model_id) : "Model not named"}
                              <small>{SITE_LABELS[item.site] ?? siteName(item.site)}</small>
                            </span>
                          </span>
                        </td>
                        <td className="num" data-label="Tokens in">{item.figures?.tokens_in ? formatInteger(item.figures.tokens_in) : "Not seen"}</td>
                        <td className="num" data-label="Tokens out">{item.figures?.tokens_out ? formatInteger(item.figures.tokens_out) : "Not seen"}</td>
                        <td className="num" data-label="Electricity">
                          <b>
                            {energy
                              ? baseText("energy", toWh(scenarioValue(energy, view.scenario), energy.unit))
                              : item.figures?.energy_status === "pending"
                                ? "Calculating"
                                : "Not counted"}
                          </b>
                        </td>
                        <td data-label="Source">Live</td>
                        <td data-label="Status">
                          <span className={`ad-badge ad-badge-${status.tone}`}>{status.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="ad-soft ad-pad">{search ? "No request from a matching work email is loaded. Show more requests or clear the search." : "No request was recorded in this view."}</p>
          )}
          <div className="ad-more">
            {next && (
              <button type="button" className="ad-btn" onClick={showMore} disabled={loadingMore}>
                <Icon name="chevronDown" size={16} />
                {loadingMore ? "Loading" : `Show ${MORE} more`}
              </button>
            )}
            <span className="ad-soft">
              Showing {formatInteger(rows.length)}
              {live && !floor ? ` of ${formatInteger(live)}` : ""} requests seen live, newest first
            </span>
            {Boolean(moreError) && <ErrorState error={moreError} context="action" title="More requests could not be loaded" />}
          </div>
        </section>
      )}
      <p className="ad-foot-note">
        Select a time to see what was counted and how the estimate was made. Earlier messages read from chats are counted in the totals above, not listed one by one. Message text is never stored.
      </p>
      {detail && (
        <RequestDetail
          api={api}
          request={detail}
          email={emails.get(detail.user_id) ?? null}
          scenario={view.scenario}
          onClose={() => setDetail(null)}
        />
      )}
    </>
  );
}

function shortTime(iso: string) {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

const ESTIMATE_ROWS = [
  ["energy", "Electricity"],
  ["carbon", "Carbon"],
  ["water_total", "Water"],
] as const;

/** Adds one metric over the attempts that started this request, keeping each scenario end. */
function addMetric(attempts: any[], key: string) {
  let low = 0,
    mid = 0,
    high = 0,
    unit = "";
  for (const attempt of attempts) {
    const metric = attempt.estimate?.result?.metrics?.[key];
    if (!metric || metric.value === null || metric.value === undefined) return null;
    if (unit && metric.unit !== unit) return null;
    unit = metric.unit;
    mid += Number(metric.value);
    low += Number(metric.scenario_low ?? metric.value);
    high += Number(metric.scenario_high ?? metric.value);
  }
  return attempts.length ? { low, mid, high, unit } : null;
}

function metricText(key: string, value: number, unit: string) {
  const base =
    key === "energy" ? toWh(String(value), unit) : key === "carbon" ? toGrams(String(value), unit) : toMillilitres(String(value), unit);
  return baseText(key === "energy" ? "energy" : key === "carbon" ? "carbon" : "water", base);
}

function RequestDetail({
  api,
  request,
  email,
  scenario,
  onClose,
}: {
  api: ApiClient;
  request: RequestRow;
  email: string | null;
  scenario: DisplayScenario;
  onClose: () => void;
}) {
  const page = useCursorPage<
    any,
    { items: any[]; request?: any; next_cursor?: string | null }
  >(async (cursor) => {
    const result = await api.get<{
      request?: any;
      attempts: any[];
      next_cursor?: string | null;
    }>(
      request.detail_path +
        queryString({ limit: "50", cursor: cursor || undefined }),
    );
    return { ...result, items: result.attempts };
  }, request.detail_path);
  const [full, setFull] = useState(false);
  const attempts: any[] = page.data?.items ?? [];
  const own = attempts.filter((attempt) => attempt.contribution !== "shared_reference");
  const status = requestStatus(request);
  const first = own.find((attempt) => attempt.estimate?.result)?.estimate?.result;
  const columns = [
    ["minimum", "Minimum"],
    ["midpoint", "Midpoint"],
    ["maximum", "Maximum"],
  ] as const;
  return (
    <Dialog
      title="Recorded request details"
      onClose={onClose}
      actions={
        <>
          <a className="ad-btn" href="/methodology" target="_blank" rel="noopener noreferrer">
            How estimates work
          </a>
          <Button onClick={onClose}>Close</Button>
        </>
      }
      size="wide"
    >
      <p className="ad-soft">
        {email ?? "Email not available"} · {formatDateTime(request.dispatched_at)} · {SITE_LABELS[request.site] ?? siteName(request.site)}
      </p>
      <ul className="ad-chips">
        <li className="ad-chip-dark">{request.model_id ? modelName(request.model_id) : "Model not named"}</li>
        {own[0]?.model_evidence && (
          <li>
            {own[0].model_evidence === "unknown"
              ? "Model not named by the site"
              : own[0].model_evidence === "response_field" || own[0].model_evidence === "provider_reported"
                ? `Model named by ${SITE_LABELS[request.site] ?? siteName(request.site)}`
                : `Model from ${humanize(own[0].model_evidence)}`}
          </li>
        )}
        <li>Seen live</li>
        <li className={`ad-badge-${status.tone}`}>{status.label}</li>
      </ul>
      {page.loading && !page.data ? (
        <Loading label="Loading request details" />
      ) : page.error ? (
        <ErrorState error={page.error} onRetry={page.retry} />
      ) : (
        <>
          <h3 className="ad-h3">Estimate</h3>
          <div className="ad-table-scroll">
            <table className="ad-estimate">
              <thead>
                <tr>
                  <th>
                    <span className="ad-hidden">Figure</span>
                  </th>
                  {columns.map(([key, label]) => (
                    <th key={key} data-on={key === scenario || undefined}>
                      {label}
                      {key === scenario ? " · shown" : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ESTIMATE_ROWS.map(([key, label]) => {
                  const sum = addMetric(own, key);
                  return (
                    <tr key={key}>
                      <th scope="row">{label}</th>
                      {columns.map(([scenarioKey]) => (
                        <td key={scenarioKey} data-on={scenarioKey === scenario || undefined}>
                          {sum ? metricText(key, scenarioKey === "minimum" ? sum.low : scenarioKey === "maximum" ? sum.high : sum.mid, sum.unit) : "Not available"}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <h3 className="ad-h3">What was counted</h3>
          <dl className="ad-rows">
            <div>
              <dt>Tokens in</dt>
              <dd>{request.figures?.tokens_in ? `${formatInteger(request.figures.tokens_in)} tokens` : "Not seen"}</dd>
            </div>
            <div>
              <dt>Tokens out</dt>
              <dd>{request.figures?.tokens_out ? `${formatInteger(request.figures.tokens_out)} tokens` : "Not seen"}</dd>
            </div>
            <div>
              <dt>Attempts</dt>
              <dd>
                {formatInteger(own.length)}
                {attempts.length > own.length ? `, plus ${formatInteger(attempts.length - own.length)} shared with another request` : ""}
              </dd>
            </div>
          </dl>
          <p className="ad-soft">Edited messages and regenerated replies appear as more attempts and are all counted.</p>
          {first && (first.method_id || Object.keys(first.assumed_settings ?? {}).length > 0) && (
            <>
              <h3 className="ad-h3">Assumptions</h3>
              <dl className="ad-rows">
                {first.method_id && (
                  <div>
                    <dt>Calculation</dt>
                    <dd>{first.method_id}</dd>
                  </div>
                )}
                {Object.entries(first.assumed_settings ?? {}).map(([name, value]) => (
                  <div key={name}>
                    <dt>{humanize(name)}</dt>
                    <dd>{String(value ?? "Unknown")}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          <RequestCoverage
            reasons={
              page.data?.request?.coverage_reasons ?? request.coverage_reasons
            }
          />
          <ExtractedFileTextDetails
            extractedText={page.data?.request?.documents?.extracted_text}
            schemaVersion={page.data?.request?.schema_version}
          />
          <button
            type="button"
            className="ad-btn ad-btn-sm ad-attempts-toggle"
            aria-expanded={full}
            aria-controls="request-attempts"
            onClick={() => setFull((value) => !value)}
          >
            <Icon name={full ? "chevronUp" : "chevronDown"} size={16} />
            Each attempt in full
          </button>
          {full && (
            <div id="request-attempts">
              <div className="attempt-list">
                {attempts.map((attempt: any, index) => (
                  <AttemptDetails
                    key={attempt.attempt_id ?? `${request.request_id}-${index}`}
                    attempt={attempt}
                  />
                ))}
              </div>
              <Pagination {...page} />
            </div>
          )}
          <p className="ad-soft">The organization receives numbers, tools, models and times, never message text.</p>
        </>
      )}
    </Dialog>
  );
}

function RequestCoverage({ reasons }: { reasons: unknown }) {
  if (!Array.isArray(reasons) || reasons.length === 0) return null;
  const labels = [
    ...new Set(
      reasons.filter((reason): reason is string => typeof reason === "string"),
    ),
  ].map((reason) =>
    reason === "partial_capture"
      ? "Partial file association: some observed file references could not be matched to a local extraction result."
      : humanize(reason),
  );
  if (!labels.length) return null;
  return (
    <Notice tone="warning" title="Request coverage is incomplete">
      <ul>
        {labels.map((label) => (
          <li key={label}>{label}</li>
        ))}
      </ul>
      <p>
        Known components keep their stated scope. Missing components remain
        unknown and are not counted as zero.
      </p>
    </Notice>
  );
}

function AttemptDetails({ attempt }: { attempt: any }) {
  const estimate = attempt.estimate?.result ?? null;
  const tokenRows = Object.entries(attempt.tokens ?? {}).map(
    ([name, measurement]: [string, any]) => [
      humanize(name),
      formatInteger(measurement?.value),
      humanize(measurement?.scope),
      humanize(measurement?.evidence),
      humanize(measurement?.completeness),
      humanize(measurement?.reason),
    ],
  );
  const metricRows = Object.entries(estimate?.metrics ?? {}).map(
    ([name, metric]: [string, any]) => [
      humanize(name),
      formatMetric(metric?.value, metric?.unit ?? ""),
      humanize(metric?.scope),
      humanize(metric?.status),
      displayReasons(metric?.reasons),
    ],
  );
  const operations = attempt.media?.image_operations ?? [];
  const generated = attempt.media?.generated_images ?? [];
  const coverageReasons = [
    ...(attempt.coverage_reasons ?? []),
    ...(attempt.media?.coverage_reasons ?? []),
    ...Object.values(attempt.tokens ?? {}).flatMap((item: any) =>
      item?.reason ? [item.reason] : [],
    ),
    ...(estimate?.reasons ?? []),
  ];
  return (
    <article className="attempt-card">
      <header>
        <div>
          <h3>Attempt {attempt.attempt_id ?? "Unknown"}</h3>
          <p>
            {formatDateTime(attempt.started_at)} · {humanize(attempt.state)} ·{" "}
            {humanize(attempt.contribution)}
          </p>
        </div>
        <Status
          tone={
            attempt.state === "completed"
              ? "good"
              : attempt.state === "failed"
                ? "danger"
                : "warning"
          }
        >
          {humanize(attempt.execution_evidence)}
        </Status>
      </header>
      <div className="two-columns detail-grid">
        <section>
          <h4>Observed model</h4>
          <p>
            <strong>{attempt.model_id ?? "Unknown"}</strong>
            <br />
            Evidence: {humanize(attempt.model_evidence)}
          </p>
        </section>
        <section>
          <h4>Calculation profile</h4>
          {estimate ? (
            <p>
              <strong>
                {estimate.profile_selection === "highest_comparable"
                  ? `Highest comparable proxy: ${estimate.selected_profile_id ?? "Unknown"}`
                  : `${humanize(estimate.profile_selection)}: ${estimate.selected_profile_id ?? "Unknown"}`}
              </strong>
              <br />
              Method {estimate.method_id} · {humanize(estimate.view)} ·{" "}
              {humanize(estimate.validation_state)}
            </p>
          ) : (
            <p>Resource calculation is pending or unavailable.</p>
          )}
        </section>
      </div>
      <h4>Token components</h4>
      <DataTable
        headers={[
          "Component",
          "Tokens",
          "Scope",
          "Evidence",
          "Completeness",
          "Reason",
        ]}
        rows={tokenRows}
        empty="No token component measurements were retained for this attempt."
      />
      <h4>Operational resource estimates</h4>
      <DataTable
        headers={["Component", "Estimate", "Scope", "Status", "Limitations"]}
        rows={metricRows}
        empty="Resource calculation is pending or unavailable. A missing estimate is not zero work."
      />
      {estimate && (
        <details>
          <summary>Calculation assumptions and source details</summary>
          <dl>
            <Row
              label="Included components"
              value={displayReasons(estimate.included_components)}
            />
            <Row
              label="Missing components"
              value={displayReasons(estimate.missing_components)}
            />
            <Row
              label="Assumptions"
              value={displayRecord(estimate.assumed_settings)}
            />
            <Row
              label="Known settings"
              value={displayRecord(estimate.known_settings)}
            />
            <Row label="Source" value={displayRecord(estimate.provenance)} />
          </dl>
        </details>
      )}
      <h4>Image operations</h4>
      <DataTable
        headers={[
          "Kind",
          "Requested",
          "Observed outputs",
          "State",
          "Observed model",
          "Settings",
        ]}
        rows={operations.map((operation: any) => [
          humanize(operation.kind),
          formatInteger(operation.requested_count),
          formatInteger(operation.returned_count),
          humanize(operation.state),
          operation.model_id ?? "Unknown",
          displayRecord(operation.settings),
        ])}
        empty="No image operation was observed for this attempt."
      />
      {generated.length > 0 && (
        <p>
          Observed generated output groups:{" "}
          {generated.map((item: any) => formatInteger(item.count)).join(", ")}.
        </p>
      )}
      <h4>Coverage and limitations</h4>
      <p>{displayReasons(coverageReasons)}</p>
      <details>
        <summary>Advanced numerical record</summary>
        <pre className="numeric-json">
          {JSON.stringify(
            {
              tokens: attempt.tokens,
              media: attempt.media,
              documents: attempt.documents,
              estimate: attempt.estimate,
              coverage_reasons: attempt.coverage_reasons,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </article>
  );
}

function displayReasons(values: unknown) {
  if (!Array.isArray(values) || values.length === 0) return "None recorded";
  return [
    ...new Set(
      values.filter((item): item is string => typeof item === "string"),
    ),
  ]
    .map((item) => humanize(item))
    .join(", ");
}

function displayRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return "Unavailable";
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length
    ? entries
        .map(([key, item]) => `${humanize(key)}: ${String(item ?? "Unknown")}`)
        .join("; ")
    : "Unavailable";
}
function coverageDescription(value: string | undefined) {
  if (!value) return "Coverage details are unavailable.";
  if (value === "available compatible operational components only")
    return "Only compatible operational components with available estimates are included. Missing, partial and unvalidated work remains listed below.";
  return `${value.replaceAll("_", " ")}.`;
}
type Network = {
  label: string;
  coverage_start: string;
  incomplete_history: boolean;
  distinct_ips: string | null;
  distinct_ip_status?: "current" | "key_rotation_pending";
  key_versions?: string[];
  next_cursor?: string | null;
  items: {
    network_observation_id: string;
    user_id: string;
    device_id: string;
    observed_at: string;
    address: string | null;
    source_quality: string;
    accepted_record_count: number;
  }[];
};
const BROWSERS: Record<string, string> = { chrome: "Chrome", edge: "Edge", firefox: "Firefox" };

function useMemberEmails(api: ApiClient) {
  const members = useApi(() =>
    fetchAllPages<Member>((cursor) =>
      api.get("/v1/admin/users" + queryString({ limit: MEMBER_PAGE_LIMIT, cursor: cursor || undefined })),
    ),
  );
  return new Map((members.data ?? []).map((member) => [member.user_id, member.email]));
}

/**
 * Connection addresses are personal data and administrator sessions last 7 days, so the server
 * shows them only after a fresh email code opens them for this session, for 15 minutes.
 */
function NetworkAccess({ api, email, onOpened }: { api: ApiClient; email: string | null | undefined; onOpened: () => void }) {
  const reauth = useActionReauth(api);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  async function open() {
    if (!reauth.token) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/v1/admin/network/access", { reauth_token: reauth.token });
      onOpened();
    } catch (caught) {
      setError(caught);
      if ((caught as { code?: string }).code === "reauthentication_required") reauth.reset({ fresh: true });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="ad-card ad-pad" aria-label="Show connection addresses">
      <p>Connection addresses are personal data. Confirm with a fresh code from your email to show them for 15 minutes.</p>
      <ActionReauthSteps reauth={reauth} email={email} disabled={busy} />
      {reauth.token && <p className="small">Your code is verified. It is valid for 5 minutes and one action.</p>}
      <Button variant="primary" onClick={() => void open()} disabled={busy || !reauth.token}>
        {busy ? "Opening addresses" : "Show addresses"}
      </Button>
      {Boolean(error ?? reauth.error) && <ErrorState error={error ?? reauth.error} context="action" title="Addresses were not shown" />}
    </section>
  );
}

/**
 * Why the first address shown is from that date. The server shows addresses from the latest of
 * the period's start, the start of the 30 days it keeps them and the day person analytics was
 * switched on, since each row names a person (Analytics.person_floor). "Kept since" read as if
 * the date were when the server began keeping addresses (QA of 19 Oct 2026).
 */
export function networkCoverageNote(data: { coverage_start: string; incomplete_history: boolean }, now: Date) {
  if (!data.incomplete_history) return "The whole period is shown";
  const kept = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  // A start more than a day after the 30 days began is the first full day of person analytics.
  return Date.parse(data.coverage_start) > kept + 24 * 60 * 60 * 1000
    ? "Earlier addresses are not shown: they were recorded before person analytics was switched on"
    : "Earlier addresses are deleted after 30 days";
}

export function AdminNetwork({ api, session }: { api: ApiClient; session?: Session }) {
  const view = useAdminView();
  const timezone = useCompanyTimezone(api);
  const [now] = useState(() => new Date());
  const window = timezone.data?.timezone ? dashWindow(view.period, timezone.data.timezone, now) : null;
  const filters = window ? periodQuery(window) : null;
  const key = JSON.stringify(filters);
  const emails = useMemberEmails(api);
  const health = useApi(() => api.get<{ browsers?: { device_id: string; browser_family: string }[] }>("/v1/admin/health"));
  const families = new Map((health.data?.browsers ?? []).map((browser) => [browser.device_id, browser.browser_family]));
  const first = useApi(
    () => (filters ? api.get<Network>("/v1/admin/network" + queryString({ ...filters, limit: "15" })) : Promise.resolve(null)),
    [key],
  );
  const [more, setMore] = useState<{ items: Network["items"]; next: string | null; key: string }>({ items: [], next: null, key: "" });
  const [loadingMore, setLoadingMore] = useState(false),
    [moreError, setMoreError] = useState<unknown>(null),
    [search, setSearch] = useState("");
  const extra = more.key === key ? more.items : [];
  const next = more.key === key && more.items.length ? more.next : (first.data?.next_cursor ?? null);
  async function showMore() {
    if (!filters || !next) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await api.get<Network>("/v1/admin/network" + queryString({ ...filters, limit: "50", cursor: next }));
      setMore({ items: [...extra, ...page.items], next: page.next_cursor ?? null, key });
    } catch (caught) {
      // The 15 minutes ran out: reload, and the page asks for a new code.
      if ((caught as { code?: string }).code === "reauthentication_required") first.retry();
      else setMoreError(caught);
    } finally {
      setLoadingMore(false);
    }
  }
  const locked = (first.error as { code?: string } | null)?.code === "reauthentication_required";
  const data = first.data;
  const needle = search.trim().toLowerCase();
  const rows = [...(data?.items ?? []), ...extra].filter(
    (item) =>
      !needle ||
      [emails.get(item.user_id) ?? "", BROWSERS[families.get(item.device_id) ?? ""] ?? "", item.address ?? ""].some((text) => text.toLowerCase().includes(needle)),
  );
  const accepted = rows.reduce((sum, item) => sum + item.accepted_record_count, 0);
  const rotating = data?.distinct_ip_status === "key_rotation_pending";
  return (
    <>
      <PageTitle title="Network">
        Where connected browsers sent their records from. Use it to spot a browser that should not be connected. Addresses are deleted after 30 days.
      </PageTitle>
      {Boolean(timezone.error) && <ErrorState error={timezone.error} onRetry={timezone.retry} />}
      {locked ? (
        <NetworkAccess api={api} email={session?.email} onOpened={first.retry} />
      ) : first.error ? (
        <ErrorState error={first.error} onRetry={first.retry} />
      ) : !data ? (
        <Loading label="Loading network observations" />
      ) : (
        <>
          <div className="ad-stat-cards">
            <div className="ad-card ad-stat-card">
              <span>Distinct addresses</span>
              <b className="ad-num">{rotating ? "Unavailable while IP keys rotate" : formatInteger(data.distinct_ips)}</b>
              <small>{rotating ? `Retained key versions: ${(data.key_versions ?? []).join(", ") || "Unknown"}` : "Kept for 30 days"}</small>
            </div>
            <div className="ad-card ad-stat-card">
              <span>Addresses shown from</span>
              <b className="ad-num">{new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(new Date(data.coverage_start))}</b>
              <small>{networkCoverageNote(data, now)}</small>
            </div>
            {rows.length > 0 && (
              <div className="ad-card ad-stat-card">
                <span>Accepted records</span>
                <b className="ad-num">{formatInteger(accepted)}</b>
                <small>In the rows shown</small>
              </div>
            )}
          </div>
          <div className="ad-card ad-filter-bar">
            <label className="ad-search">
              <Icon name="search" size={16} />
              <span className="ad-hidden">Search by email, browser or address</span>
              <input type="search" placeholder="Search by email, browser or address" value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
            {timezone.data?.timezone && <PeriodMenu timezone={timezone.data.timezone} now={now} />}
          </div>
          <section className="ad-card ad-card-table" aria-label="Network observations">
            {rows.length ? (
              <div className="ad-table-scroll">
                <table className="ad-table ad-table-stacked">
                  <thead>
                    <tr>
                      <th>Last seen, newest first</th>
                      <th>Work email</th>
                      <th>Browser</th>
                      <th>Address</th>
                      <th className="num">Accepted records</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((item) => (
                      <tr key={item.network_observation_id}>
                        <td data-label="Last seen">{formatDateTime(item.observed_at)}</td>
                        <th scope="row">{emails.get(item.user_id) ?? "Email not available"}</th>
                        <td data-label="Browser">
                          {BROWSERS[families.get(item.device_id) ?? ""] ?? "Browser no longer connected"}
                          <small className="ad-mono">inst {item.device_id.slice(0, 4)} {item.device_id.slice(4, 8)}</small>
                        </td>
                        <td className="ad-mono" data-label="Address">{item.address ?? "Not kept"}</td>
                        <td className="num" data-label="Accepted records">{formatInteger(item.accepted_record_count)}</td>
                        <td data-label="Source">
                          <span className="ad-badge">{humanize(item.source_quality)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="ad-soft ad-pad">{needle ? "No loaded address matches this search." : "No connection address was kept for this period."}</p>
            )}
            <div className="ad-more">
              {next && (
                <button type="button" className="ad-btn" onClick={showMore} disabled={loadingMore}>
                  <Icon name="chevronDown" size={16} />
                  {loadingMore ? "Loading" : "Show more"}
                </button>
              )}
              <span className="ad-soft">Showing {formatInteger(rows.length)} address and browser pairs</span>
              {Boolean(moreError) && <ErrorState error={moreError} context="action" title="More addresses could not be loaded" />}
            </div>
          </section>
        </>
      )}
      <p className="ad-foot-note">
        An address is a network observation, such as an office or home connection. It is not where the AI ran, and VPNs and shared networks can combine people, so it is not a reliable count of people.
      </p>
    </>
  );
}

type HealthReport = { code: string; site: string | null; count: number; client_version: string; at: string };
type HealthBrowser = {
  device_id: string;
  user_id: string;
  browser_family: string;
  last_reporting_at: string | null;
  connected_at: string;
  client_version: string | null;
  report: HealthReport | null;
};
const PROBLEM_CODES: Record<string, string> = {
  capture_failed: "Capture failed",
  storage_failed: "Saving failed",
  sync_failed: "Sync failed",
  tokenizer_failed: "Counting failed",
  calculation_failed: "Estimate failed",
};

const STALE = 3 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function sinceText(iso: string | null, now: number) {
  if (!iso) return "Never";
  const minutes = Math.round((now - Date.parse(iso)) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} ${Math.round(minutes / 60) === 1 ? "hour" : "hours"} ago`;
  if (minutes < 48 * 60) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(new Date(iso));
}

/**
 * The method list loads beside the health reports and often answers later. Saying "not available"
 * until then told administrators the server had no method, so loading and a failed load each say so.
 */
function methodText(methods: ReturnType<typeof useApi<MethodInventory>>) {
  const id = methods.data?.default_method_id;
  if (id) {
    // EcoLogits method ids end in a 64-character hash; the engine and its version name the method.
    const method = methods.data!.methods.find((record) => record.method_id === id);
    if (method?.engine_id === "ecologits" && method.source_version) return `Calculated with EcoLogits ${method.source_version}.`;
    return `Calculated with ${id}.`;
  }
  if (methods.loading) return "Loading the calculation method.";
  if (methods.error) return "The calculation method could not be loaded. Reload the page to try again.";
  return "Calculation method not available.";
}

function browsersText(count: number) {
  return `${formatInteger(count)} ${count === 1 ? "browser" : "browsers"}`;
}

/**
 * The Health page shows counts only (owner decision of 18 October 2026): how many browsers are
 * connected, how many synced recently and how many reported each kind of failure. It names no
 * browser or member and no time of use; the server sends none.
 */
export function AdminHealth({ api }: { api: ApiClient }) {
  const state = useApi(() => api.get<HealthSummary>("/v1/admin/health"));
  const methods = useApi(() => api.get<MethodInventory>("/v1/methods"));
  return (
    <>
      <PageTitle title="Health">Counts for the whole organization. No browser or person is listed.</PageTitle>
      <AsyncPage state={state}>
        {(data) => {
          const connected = data.browsers_connected;
          const recent = data.browsers_synced_last_day;
          const stale = data.browsers_not_synced_3_days;
          return (
            <>
              <div className="ad-three">
                <div className="ad-note-card">
                  <span className="ad-note-icon ad-tone-good" aria-hidden="true">
                    <Icon name="check" size={18} />
                  </span>
                  <div>
                    <b>Server running</b>
                    <p>The organization server answered just now.</p>
                  </div>
                </div>
                <div className="ad-note-card">
                  <span className={`ad-note-icon ${connected && recent === connected ? "ad-tone-good" : "ad-tone-warn"}`} aria-hidden="true">
                    <Icon name="refresh" size={18} />
                  </span>
                  <div>
                    <b>
                      {formatInteger(recent)} of {browsersText(connected)} synced
                    </b>
                    <p>In the last 24 hours.</p>
                  </div>
                </div>
                <div className="ad-note-card">
                  <span className="ad-note-icon" aria-hidden="true">
                    <Icon name="layers" size={18} />
                  </span>
                  <div>
                    <b>Estimates</b>
                    <p>{methodText(methods)}</p>
                  </div>
                </div>
              </div>
              <Card title="Needs attention">
                {stale || data.problems.length ? (
                  <>
                    {stale > 0 && (
                      <Notice tone="warning" title={`${browsersText(stale)} ${stale === 1 ? "has" : "have"} not synced for 3 days`}>
                        Their figures arrive when the browser is next opened; nothing is lost while the extension keeps its records.
                      </Notice>
                    )}
                    {data.problems.map((problem) => (
                      <Notice
                        key={`${problem.code}-${problem.site ?? ""}`}
                        tone="danger"
                        title={`${PROBLEM_CODES[problem.code] ?? humanize(problem.code)}${problem.site ? ` on ${SITE_LABELS[problem.site] ?? problem.site}` : ""}`}
                      >
                        {browsersText(problem.browsers)} reported this in their latest health report.
                      </Notice>
                    ))}
                  </>
                ) : connected ? (
                  <p className="ad-soft">Nothing needs attention. Every connected browser synced in the last 3 days and reported no failure.</p>
                ) : (
                  <p className="ad-soft">No browser is connected yet. No reports does not prove that no AI use occurred.</p>
                )}
              </Card>
            </>
          );
        }}
      </AsyncPage>
      <p className="ad-foot-note">
        An offline, disabled or removed extension may miss activity. A browser that is not reporting is different from a confirmed failure.
      </p>
    </>
  );
}

/**
 * The Health page as it was before 18 October 2026: each connected browser with its member, last
 * sync and latest report. Shown only while the server has person analytics switched on.
 */
export function AdminHealthByBrowser({ api }: { api: ApiClient }) {
  const state = useApi(() => api.get<{ items: HealthReport[]; browsers?: HealthBrowser[] }>("/v1/admin/health"));
  const methods = useApi(() => api.get<MethodInventory>("/v1/methods"));
  const emails = useMemberEmails(api);
  const [now] = useState(() => Date.now());
  return (
    <>
      <PageTitle title="Health" />
      <AsyncPage state={state}>
        {(data) => {
          const browsers = data.browsers ?? [];
          const recent = browsers.filter((b) => b.last_reporting_at && now - Date.parse(b.last_reporting_at) < DAY_MS).length;
          // A browser that never synced is measured from its connection: one connected minutes ago
          // is "Not synced yet", not three days late.
          const stale = browsers.filter((b) => now - Date.parse(b.last_reporting_at ?? b.connected_at) >= STALE);
          const failing = browsers.filter((b) => b.report && PROBLEM_CODES[b.report.code]);
          const who = (b: HealthBrowser) => `${emails.get(b.user_id) ?? "A member"} (${BROWSERS[b.browser_family] ?? b.browser_family})`;
          const days = (b: HealthBrowser) => (b.last_reporting_at ? Math.floor((now - Date.parse(b.last_reporting_at)) / DAY_MS) : null);
          return (
            <>
              <div className="ad-three">
                <div className="ad-note-card">
                  <span className="ad-note-icon ad-tone-good" aria-hidden="true">
                    <Icon name="check" size={18} />
                  </span>
                  <div>
                    <b>Server running</b>
                    <p>The organization server answered just now.</p>
                  </div>
                </div>
                <div className="ad-note-card">
                  <span className={`ad-note-icon ${browsers.length && recent === browsers.length ? "ad-tone-good" : "ad-tone-warn"}`} aria-hidden="true">
                    <Icon name="refresh" size={18} />
                  </span>
                  <div>
                    <b>
                      {formatInteger(recent)} of {formatInteger(browsers.length)} browsers synced
                    </b>
                    <p>In the last 24 hours.</p>
                  </div>
                </div>
                <div className="ad-note-card">
                  <span className="ad-note-icon" aria-hidden="true">
                    <Icon name="layers" size={18} />
                  </span>
                  <div>
                    <b>Estimates</b>
                    <p>{methodText(methods)}</p>
                  </div>
                </div>
              </div>
              <Card title="Needs attention">
                {stale.length || failing.length ? (
                  <>
                    {stale.length > 0 && (
                      <Notice tone="warning" title={`${formatInteger(stale.length)} ${stale.length === 1 ? "browser has" : "browsers have"} not synced for 3 days`}>
                        {stale.map(who).join(", ")}. Their figures arrive when the browser is next opened; nothing is lost while the extension keeps its records.
                      </Notice>
                    )}
                    {failing.map((b) => (
                      <Notice key={b.device_id} tone="danger" title={`${PROBLEM_CODES[b.report!.code]}${b.report!.site ? ` on ${SITE_LABELS[b.report!.site] ?? b.report!.site}` : ""}`}>
                        {who(b)} reported this {sinceText(b.report!.at, now).toLowerCase()}, {formatInteger(b.report!.count)} {b.report!.count === 1 ? "time" : "times"}.
                      </Notice>
                    ))}
                  </>
                ) : (
                  <p className="ad-soft">Nothing needs attention. Every connected browser synced in the last 3 days and reported no failure.</p>
                )}
              </Card>
              <Card title="Connected browsers" aside={<span className="ad-soft">{formatInteger(browsers.length)} connected</span>} className="ad-card-table">
                {browsers.length ? (
                  <div className="ad-table-scroll">
                    <table className="ad-table ad-table-stacked">
                      <thead>
                        <tr>
                          <th>Work email</th>
                          <th>Browser</th>
                          <th>Extension</th>
                          <th>Last sync</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...browsers]
                          .sort((a, b) => (b.last_reporting_at ?? "").localeCompare(a.last_reporting_at ?? ""))
                          .map((b) => {
                            const age = days(b);
                            const problem = b.report && PROBLEM_CODES[b.report.code];
                            return (
                              <tr key={b.device_id}>
                                <th scope="row">{emails.get(b.user_id) ?? "Email not available"}</th>
                                <td data-label="Browser">{BROWSERS[b.browser_family] ?? b.browser_family}</td>
                                <td data-label="Extension">{b.client_version ?? "Not reported"}</td>
                                <td data-label="Last sync">{sinceText(b.last_reporting_at, now)}</td>
                                <td data-label="Status">
                                  {problem ? (
                                    <span className="ad-badge ad-badge-danger">{problem}</span>
                                  ) : age === null ? (
                                    <span className="ad-badge ad-badge-warning">Not synced yet</span>
                                  ) : age >= 3 ? (
                                    <span className="ad-badge ad-badge-warning">Not synced for {age} days</span>
                                  ) : (
                                    <span className="ad-badge ad-badge-good">Synced</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="ad-soft ad-pad">No browser is connected yet. No reports does not prove that no AI use occurred.</p>
                )}
              </Card>
            </>
          );
        }}
      </AsyncPage>
      <p className="ad-foot-note">An offline, disabled or removed extension may miss activity. A browser that is not reporting is different from a confirmed failure.</p>
    </>
  );
}

type Policy = {
  policy_version: string;
  timezone: string;
  pause_mode: "user_controlled" | "disabled_by_company";
  company_sharing: "disabled" | "threshold";
  usage_retention_months: number | null;
  /** Zero unless the server has IP collection switched on. */
  ip_retention_days?: number;
  features?: Partial<ServerFeatures>;
};
/** How long connection addresses are kept, or null while the server collects none. */
function addressRetention(config: Policy | null | undefined) {
  return config?.features?.ip_collection === true && config.ip_retention_days ? config.ip_retention_days : null;
}
const RETENTION_CHOICES = [
  ["until_deleted", "Until an administrator deletes it"],
  ["24", "24 months"],
  ["12", "12 months"],
  ["6", "6 months"],
  ["3", "3 months"],
] as const;
type Retention = (typeof RETENTION_CHOICES)[number][0];
const retentionOf = (months: number | null): Retention => (months === null ? "until_deleted" : (String(months) as Retention));
const retentionText = (choice: Retention) => RETENTION_CHOICES.find(([value]) => value === choice)?.[1] ?? `${choice} months`;

function zones(current: string) {
  try {
    const all = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
    return all.includes(current) ? all : [current, ...all];
  } catch {
    return [current];
  }
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <span className="ad-switch-row">
      <span aria-hidden="true">{checked ? "On" : "Off"}</span>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} className="ad-switch" onClick={() => onChange(!checked)}>
        <span />
      </button>
    </span>
  );
}

/**
 * Confirms one administrator action with a fresh email code. Administrator sessions last 7 days,
 * so policy changes, exports and plan change acknowledgements need the code like a role change.
 * Each dialog owns one idempotency key, so a retry after a lost answer replays the action.
 */
function CodeConfirmDialog({
  api,
  email,
  title,
  dangerous = false,
  confirmLabel,
  busyLabel,
  failureTitle,
  ready = true,
  children,
  onConfirm,
  onClose,
}: {
  api: ApiClient;
  email: string | null | undefined;
  title: string;
  dangerous?: boolean;
  confirmLabel: string;
  busyLabel: string;
  failureTitle: string;
  /** Other conditions the caller needs before the action may run, such as a review checkbox. */
  ready?: boolean;
  children: React.ReactNode;
  onConfirm: (code: { reauth_token: string; idempotency_key: string }) => Promise<void>;
  onClose: () => void;
}) {
  const reauth = useActionReauth(api);
  const [operation] = useState(idempotencyKey);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  async function confirm() {
    if (!reauth.token || !ready) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm({ reauth_token: reauth.token, idempotency_key: operation });
    } catch (caught) {
      setError(caught);
      // A refused or used code cannot be tried again; ask for a new one.
      if ((caught as { code?: string }).code === "reauthentication_required") reauth.reset({ fresh: true });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={title}
      dangerous={dangerous}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={dangerous ? "danger" : "primary"} onClick={() => void confirm()} disabled={busy || !ready || !reauth.token}>
            {busy ? busyLabel : confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      <p>Confirm with a fresh code from your email.</p>
      <ActionReauthSteps reauth={reauth} email={email} disabled={busy} />
      {reauth.token && <p className="small">Your code is verified. It is valid for 5 minutes and one action.</p>}
      {Boolean(error ?? reauth.error) && <ErrorState error={error ?? reauth.error} context="action" title={failureTitle} />}
    </Dialog>
  );
}

export function AdminPolicies({ api, session }: { api: ApiClient; session?: Session }) {
  const state = useApi(() => api.get<Policy>("/v1/config"));
  const plan = useApi(() => api.get<{ usage_retention_months: number | null }>("/v1/admin/plan"));
  const [draft, setDraft] = useState<{ timezone: string; pause_mode: Policy["pause_mode"]; company_sharing: Policy["company_sharing"]; retention: Retention } | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null),
    [confirming, setConfirming] = useState(false),
    [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (location.hash === "#export") document.getElementById("export")?.scrollIntoView();
  }, [state.data !== null]);
  const policy = state.data;
  const current = policy
    ? { timezone: policy.timezone, pause_mode: policy.pause_mode, company_sharing: policy.company_sharing, retention: retentionOf(policy.usage_retention_months) }
    : null;
  const value = draft ?? current;
  const changed = Boolean(current && value && JSON.stringify(current) !== JSON.stringify(value));
  const planLimit = plan.data?.usage_retention_months ?? null;
  const choices = RETENTION_CHOICES.filter(([choice]) => (planLimit === null ? true : choice !== "until_deleted" && Number(choice) <= planLimit));
  const shorter =
    current && value && value.retention !== current.retention && value.retention !== "until_deleted" && (current.retention === "until_deleted" || Number(value.retention) < Number(current.retention));
  async function save(code: { reauth_token: string; idempotency_key: string }) {
    if (!policy || !value) return;
    setError(null);
    try {
      const saved = await api.put<Policy>("/v1/admin/policy", {
        expected_version: policy.policy_version,
        timezone: value.timezone,
        pause_mode: value.pause_mode,
        company_sharing: value.company_sharing,
        ...(value.retention !== current?.retention ? { usage_retention: value.retention } : {}),
        ...code,
      });
      // Other pages read the time zone from the shared copy, so it is read again after a change, and
      // figures kept from before the change may no longer match the policy.
      forgetSessionReads(api);
      state.setData(saved);
      setDraft(null);
      setConfirming(false);
      setSavedAt(new Date().toISOString());
    } catch (caught) {
      // Someone else saved first: close the dialog and show the current policies.
      if ((caught as { code?: string }).code === "stale_version") {
        forgetSessionReads(api);
        setError(caught);
        setConfirming(false);
        state.retry();
        return;
      }
      throw caught;
    }
  }
  const set = (patch: Partial<NonNullable<typeof value>>) => value && setDraft({ ...value, ...patch });
  const cutoff = value && value.retention !== "until_deleted" ? new Date(new Date().setMonth(new Date().getMonth() - Number(value.retention))) : null;
  return (
    <>
      <PageTitle title="Policies and data" />
      <AsyncPage state={state}>
        {() =>
          value && (
            <section className="ad-card ad-policies" aria-labelledby="policies-title">
              <div className="ad-card-head">
                <h2 id="policies-title" className="ad-h2">
                  Policies
                </h2>
              </div>
              <p className="ad-soft ad-card-sub">How connected browsers track, what everyone sees and how long usage is kept. Browsers pick up changes at their next sync.</p>
              <ul className="ad-settings">
                <li>
                  <span className="ad-set-icon" aria-hidden="true">
                    <Icon name="pause" size={18} />
                  </span>
                  <div>
                    <b>Let people pause tracking</b>
                    <p>When on, each person can pause tracking in their extension. When off, tracking for the organization always runs.</p>
                  </div>
                  <Switch label="Let people pause tracking" checked={value.pause_mode === "user_controlled"} onChange={(on) => set({ pause_mode: on ? "user_controlled" : "disabled_by_company" })} />
                </li>
                <li>
                  <span className="ad-set-icon" aria-hidden="true">
                    <Icon name="user" size={18} />
                  </span>
                  <div>
                    <b>Show organization totals to everyone</b>
                    <p>Each person sees the organization's totals in their extension, however few people use AI. In a small team the totals can show one person's usage.</p>
                  </div>
                  <Switch label="Show organization totals to everyone" checked={value.company_sharing === "threshold"} onChange={(on) => set({ company_sharing: on ? "threshold" : "disabled" })} />
                </li>
                <li>
                  <span className="ad-set-icon" aria-hidden="true">
                    <Icon name="clock" size={18} />
                  </span>
                  <div>
                    <b>
                      <label htmlFor="policy-timezone">Organization time zone</label>
                    </b>
                    <p>Sets when each day starts in charts, exports and deletions. Changing it rebuilds the totals.</p>
                  </div>
                  <select id="policy-timezone" className="ad-select-control" value={value.timezone} onChange={(event) => set({ timezone: event.target.value })}>
                    {zones(value.timezone).map((zone) => (
                      <option key={zone} value={zone}>
                        {zone}
                      </option>
                    ))}
                  </select>
                </li>
                <li>
                  <span className="ad-set-icon" aria-hidden="true">
                    <Icon name="list" size={18} />
                  </span>
                  <div>
                    <b>
                      <label htmlFor="policy-retention">Keep usage records</label>
                    </b>
                    <p>
                      {planLimit === null
                        ? "Your plan keeps usage until an administrator deletes it. Choose a shorter period to delete older records automatically."
                        : `Your plan keeps usage for up to ${retentionText(retentionOf(planLimit)).toLowerCase()}. You can choose a shorter period.`}
                    </p>
                  </div>
                  <select id="policy-retention" className="ad-select-control" value={value.retention} onChange={(event) => set({ retention: event.target.value as Retention })}>
                    {choices.map(([choice, label]) => (
                      <option key={choice} value={choice}>
                        {label}
                      </option>
                    ))}
                    {!choices.some(([choice]) => choice === value.retention) && <option value={value.retention}>{retentionText(value.retention)}</option>}
                  </select>
                </li>
              </ul>
              <div className="ad-save-bar">
                <span className="ad-soft" role="status">
                  {changed ? (
                    "Unsaved changes"
                  ) : (
                    <>
                      <Icon name="check" size={16} /> All changes saved{savedAt ? ` · ${formatDateTime(savedAt)}` : ""}
                    </>
                  )}
                </span>
                <span className="actions">
                  {changed && (
                    <button type="button" className="ad-btn" onClick={() => setDraft(null)} disabled={confirming}>
                      Discard
                    </button>
                  )}
                  <button
                    type="button"
                    className="ad-btn ad-btn-primary"
                    disabled={!changed || confirming}
                    onClick={() => {
                      setError(null);
                      setConfirming(true);
                    }}
                  >
                    Save changes
                  </button>
                </span>
              </div>
              {Boolean(error) && <ErrorState error={error} context="action" title="Policy was not saved" />}
            </section>
          )
        }
      </AsyncPage>
      {confirming && value && current && !shorter && (
        <CodeConfirmDialog
          api={api}
          email={session?.email}
          title="Save policy changes?"
          confirmLabel="Save changes"
          busyLabel="Saving"
          failureTitle="Policy was not saved"
          onConfirm={save}
          onClose={() => setConfirming(false)}
        >
          <p>Connected browsers pick up the new policies at their next sync.</p>
        </CodeConfirmDialog>
      )}
      {confirming && value && current && shorter && (
        <CodeConfirmDialog
          api={api}
          email={session?.email}
          title={`Keep usage records for ${retentionText(value.retention).toLowerCase()}?`}
          dangerous
          confirmLabel="Save and delete"
          busyLabel="Saving"
          failureTitle="Policy was not saved"
          onConfirm={save}
          onClose={() => setConfirming(false)}
        >
          <dl className="ad-rows ad-compare">
            <div>
              <dt>Now</dt>
              <dd>{retentionText(current.retention)}</dd>
            </div>
            <div>
              <dt>After saving</dt>
              <dd>{retentionText(value.retention)}</dd>
            </div>
          </dl>
          <p>
            Requests and attempts recorded before {cutoff ? formatDateTime(cutoff.toISOString()) : "the new limit"} leave every view and are then deleted for good. This cannot be undone. Earlier messages read from chats are kept. Export anything you need first.
          </p>
        </CodeConfirmDialog>
      )}
      {state.data && (
        <Card title="Fixed retention">
          <p className="ad-soft ad-card-sub">These periods are the same for every organization.</p>
          <ul className="ad-settings">
            {addressRetention(state.data) !== null && (
              <li>
                <span className="ad-set-icon" aria-hidden="true">
                  <Icon name="link" size={18} />
                </span>
                <div>
                  <b>Connection addresses</b>
                  <p>IP addresses from browser connections.</p>
                </div>
                <b>{formatInteger(addressRetention(state.data)!)} days</b>
              </li>
            )}
            <li>
              <span className="ad-set-icon" aria-hidden="true">
                <Icon name="refresh" size={18} />
              </span>
              <div>
                <b>Earlier messages read from chats</b>
                <p>Figures for earlier messages, read from a chat's history, including messages with old or unknown dates.</p>
              </div>
              <b>Kept until deleted</b>
            </li>
          </ul>
        </Card>
      )}
      <AdminExports api={api} session={session} />
    </>
  );
}

export function AdminExports({ api, session }: { api: ApiClient; session?: Session }) {
  const [result, setResult] = useState<any>(null),
    [pending, setPending] = useState<Record<string, unknown> | null>(null),
    [calculationView, setCalculationView] = useState("original");
  const methods = useApi(() => api.get<MethodInventory>("/v1/methods"));
  // The form only collects the choices; the export starts after a fresh code in the dialog.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    const form = new FormData(event.currentTarget);
    setPending({
      period: "custom",
      start: form.get("start"),
      end: form.get("end"),
      format: "csv",
      report: "summary",
      calculation_view: calculationView,
      ...(calculationView === "recalculated" ? { method_id: form.get("method_id") } : {}),
    });
  }
  async function create(code: { reauth_token: string; idempotency_key: string }) {
    if (!pending) return;
    setResult(await api.post("/v1/admin/exports", { ...pending, ...code }));
    setPending(null);
  }
  return (
    <Card title="Export" id="export">
      <p className="ad-soft ad-card-sub">
        A CSV of the organization's totals with units and coverage. No row names a person. Each row carries the minimum, midpoint and maximum, so it works with any scenario. Earlier messages read from chats come as separate rows.
      </p>
      <form className="ad-export" onSubmit={submit}>
        <label>
          From
          <input type="date" name="start" required />
        </label>
        <label>
          To, exclusive
          <input type="date" name="end" required />
        </label>
        <label>
          Calculation view
          <select value={calculationView} onChange={(event) => setCalculationView(event.target.value)}>
            <option value="original">Original recorded calculations</option>
            <option value="recalculated">Completed recalculation</option>
          </select>
        </label>
        {calculationView === "recalculated" && (
          <label>
            Installed method
            <select name="method_id" required>
              {(methods.data?.methods ?? []).map((method) => (
                <option key={method.method_id} value={method.method_id}>
                  {method.method_id}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="submit" className="ad-btn ad-btn-primary" disabled={Boolean(pending)}>
          <Icon name="download" size={16} />
          Create CSV
        </button>
      </form>
      {pending && (
        <CodeConfirmDialog
          api={api}
          email={session?.email}
          title="Create this export?"
          confirmLabel="Create CSV"
          busyLabel="Creating CSV"
          failureTitle="Export was not created"
          onConfirm={create}
          onClose={() => setPending(null)}
        >
          <p>The CSV holds the organization's totals for the chosen dates. Only you can download it, for the next 24 hours.</p>
        </CodeConfirmDialog>
      )}
      {Boolean(methods.error) && <ErrorState error={methods.error} onRetry={methods.retry} />}
      {result && (
        <div className="ad-export-ready" role="status">
          <span>
            <Icon name="check" size={16} /> <b>Export ready.</b> The link expires {formatDateTime(result.expires_at)}.
          </span>
          <a className="ad-btn ad-btn-primary" href={result.download_path}>
            Download CSV
          </a>
        </div>
      )}
      <p className="ad-soft">A downloaded file cannot be recalled. Keep it as safe as the data inside.</p>
    </Card>
  );
}

const AUDIT_ACTIONS: Record<string, string> = {
  role_changed: "Role changed",
  policy_changed: "Policies changed",
  usage_export_started: "Export created",
  // Written when an administrator opens the Network page, which exists only while the server has
  // person analytics and IP collection switched on.
  network_viewed: "Connection addresses viewed",
  retention_transition_acknowledged: "Plan change acknowledged",
};

/** Detail fields that name a member of the organization, with the words shown for each. */
const AUDIT_PEOPLE: Record<string, string> = { user_id: "Person", requested_by: "Requested by" };

/**
 * An audit entry's details in words. A member is named by work email, as everywhere else on the
 * admin site, and never by the raw user id. The developer who reviewed a work email domain is not
 * named: the developer panel's own audit names developers only by pseudonym and organizations see
 * none (operator audit rules). Other ids mean nothing to an administrator and are left out.
 */
export function auditDetailText(details: Record<string, unknown>, member: (id: unknown) => string) {
  return Object.entries(details)
    .flatMap(([key, value]) => {
      if (AUDIT_PEOPLE[key]) return [`${AUDIT_PEOPLE[key]}: ${member(value)}`];
      if (key === "reviewer_id") return ["Reviewed by the service's developers"];
      if (key.endsWith("_id")) return [];
      const text =
        typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)
          ? formatDateTime(value)
          : typeof value === "object"
            ? JSON.stringify(value)
            : String(value);
      return [`${humanize(key).replace(/^./, (c) => c.toUpperCase())}: ${text}`];
    })
    .join("; ");
}

export function AdminAudit({ api }: { api: ApiClient }) {
  const emails = useMemberEmails(api);
  const first = useApi(() => api.get<{ items: any[]; next_cursor?: string | null }>("/v1/admin/audit" + queryString({ limit: "50" })));
  const [older, setOlder] = useState<{ items: any[]; next: string | null } | null>(null);
  const [loading, setLoading] = useState(false),
    [moreError, setMoreError] = useState<unknown>(null),
    [actor, setActor] = useState(""),
    [action, setAction] = useState("");
  const next = older ? older.next : (first.data?.next_cursor ?? null);
  async function showOlder() {
    if (!next) return;
    setLoading(true);
    setMoreError(null);
    try {
      const page = await api.get<{ items: any[]; next_cursor?: string | null }>("/v1/admin/audit" + queryString({ limit: "50", cursor: next }));
      setOlder({ items: [...(older?.items ?? []), ...page.items], next: page.next_cursor ?? null });
    } catch (caught) {
      setMoreError(caught);
    } finally {
      setLoading(false);
    }
  }
  const all = [...(first.data?.items ?? []), ...(older?.items ?? [])];
  // The server writes its own entries (retention erasure, rebuilt totals) with the actor "system".
  const name = (id: unknown) =>
    typeof id === "string" && id && id !== "system" ? (emails.get(id) ?? "A former member") : "The service";
  const member = (id: unknown) => (typeof id === "string" && emails.get(id)) || "a former member";
  const label = (value: unknown) => AUDIT_ACTIONS[String(value)] ?? humanize(value).replace(/^./, (c) => c.toUpperCase());
  const actors = [...new Set(all.map((item) => String(item.actor ?? "")))];
  const actions = [...new Set(all.map((item) => String(item.action ?? "")))];
  const rows = all.filter((item) => (!actor || String(item.actor ?? "") === actor) && (!action || String(item.action ?? "") === action));
  const groups: { day: string; items: any[] }[] = [];
  for (const item of rows) {
    const day = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(item.at));
    if (groups.at(-1)?.day !== day) groups.push({ day, items: [] });
    groups.at(-1)!.items.push(item);
  }
  return (
    <>
      <PageTitle title="Audit log">Every change administrators make, newest first.</PageTitle>
      {first.error ? (
        <ErrorState error={first.error} onRetry={first.retry} />
      ) : !first.data ? (
        <Loading label="Loading the audit log" />
      ) : (
        <>
          {all.length > 0 && (
            <div className="ad-card ad-filter-bar">
              <ChipMenu<string>
                name="Administrator"
                label={actor ? name(actor) : "All administrators"}
                value={actor}
                options={[{ value: "", label: "All administrators" }, ...actors.map((id) => ({ value: id, label: name(id) }))]}
                onChange={setActor}
              />
              <ChipMenu<string>
                name="Change"
                label={action ? label(action) : "All changes"}
                value={action}
                options={[{ value: "", label: "All changes" }, ...actions.map((value) => ({ value, label: label(value) }))]}
                onChange={setAction}
              />
            </div>
          )}
          <section className="ad-card ad-card-table" aria-label="Audit entries">
            {groups.length ? (
              groups.map((group) => (
                <div key={group.day} className="ad-audit-group">
                  <h3 className="ad-audit-day">{group.day}</h3>
                  <ul className="ad-audit">
                    {group.items.map((item, index) => (
                      <li key={`${item.at}-${index}`}>
                        <span className="ad-soft">{new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(item.at))}</span>
                        <div>
                          <b>{label(item.action)}</b>
                          {item.details && auditDetailText(item.details, member) && <span>{auditDetailText(item.details, member)}</span>}
                          <small>
                            by {name(item.actor)}
                            {item.target && item.target !== item.actor ? ` · ${emails.get(item.target) ?? `record ${String(item.target).slice(0, 8)}`}` : ""}
                          </small>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            ) : (
              <p className="ad-soft ad-pad">{all.length ? "No entry matches these choices." : "No administrator has changed anything yet."}</p>
            )}
            {next && (
              <div className="ad-more">
                <button type="button" className="ad-btn" onClick={showOlder} disabled={loading}>
                  {loading ? "Loading" : "Show older entries"}
                </button>
              </div>
            )}
            {Boolean(moreError) && <ErrorState error={moreError} context="action" title="Older entries could not be loaded" />}
          </section>
        </>
      )}
    </>
  );
}

type Plan = {
  plan_id: string;
  plan_version: number;
  version: number;
  member_capacity: number;
  usage_retention_months: number | null;
  mode: string;
  billing_status: string;
  transitions: any[];
};
export function AdminPlan({
  api,
  navigate,
  session,
  onDeletionScheduled,
}: {
  api: ApiClient;
  navigate?: Navigate;
  /** With both, the page offers to delete the organization. */
  session?: Session;
  onDeletionScheduled?: () => void;
}) {
  const [users, plan] = [
    useApi(() =>
      fetchAllPages<Member>((cursor) =>
        api.get(
          "/v1/admin/users" +
            queryString({ limit: MEMBER_PAGE_LIMIT, cursor: cursor || undefined }),
        ),
      ),
    ),
    useApi(() => api.get<Plan>("/v1/admin/plan")),
  ];
  // Only for the address retention row, shown while the server collects addresses.
  const config = useApi(() => companyConfig<Policy>(api).catch(() => null));
  const go = (to: string) => (event: { preventDefault(): void }) => {
    if (!navigate) return;
    event.preventDefault();
    navigate(to);
  };
  return (
    <>
      <PageTitle title="Plan" />
      <AsyncPage state={plan}>
        {(data) => {
          const members = users.data?.filter((member) => member.status === "active").length ?? null;
          const name = data.plan_id.replaceAll("-", " ").replace(/^./, (c) => c.toUpperCase());
          return (
            <>
              <div className="ad-two">
                <section className="ad-plan-hero" aria-label="Current plan">
                  <span className="ad-plan-kicker">Current plan</span>
                  <h2 className="ad-plan-name">{name}</h2>
                  <p>
                    Version {data.plan_version} · {data.mode === "self_hosted" ? "Self-hosted" : "Hosted"}
                  </p>
                  {/free/.test(data.plan_id) && <span className="ad-pill">Free forever for up to {formatInteger(data.member_capacity)} members</span>}
                  <div className="ad-plan-members">
                    <span>Members</span>
                    <b>
                      {/* The member list loads after the plan; "Unknown" read as a missing count. */}
                      {members !== null
                        ? `${formatInteger(members)} of ${formatInteger(data.member_capacity)}`
                        : users.error
                          ? `Not counted (limit ${formatInteger(data.member_capacity)})`
                          : "Counting members"}
                    </b>
                  </div>
                  <span className="ad-plan-track" aria-hidden="true">
                    <span style={{ width: `${members === null ? 0 : Math.min(100, (members / data.member_capacity) * 100)}%` }} />
                  </span>
                  <p className="ad-plan-note">
                    {members !== null && `${formatInteger(Math.max(0, data.member_capacity - members))} places left. `}
                    Extra browsers do not use another place.{" "}
                    {data.mode !== "self_hosted" && (
                      <>
                        Need more than {formatInteger(data.member_capacity)}? <a href="/contact">Contact us</a>
                      </>
                    )}
                  </p>
                </section>
                <Card title="What is kept">
                  <dl className="ad-rows">
                    <Row
                      label="Usage records"
                      value={
                        data.usage_retention_months === null
                          ? "Until an administrator deletes it"
                          : `Up to ${formatRetention(data.usage_retention_months)}`
                      }
                    />
                    <Row
                      label="A shorter period"
                      value={
                        <a href="/admin/policies" onClick={go("/admin/policies")}>
                          Choose in Policies and data
                        </a>
                      }
                    />
                    <Row label="Earlier messages read from chats" value="Until deleted" />
                    {addressRetention(config.data) !== null && (
                      <Row label="Connection addresses" value={`${addressRetention(config.data)} days`} />
                    )}
                    <Row
                      label="Billing"
                      value={
                        data.mode === "self_hosted"
                          ? "No hosted subscription"
                          : data.billing_status === "not_configured"
                            ? "No billing"
                            : humanize(data.billing_status)
                      }
                    />
                  </dl>
                </Card>
              </div>
              <Card title="Plan changes">
                {data.transitions.length ? (
                  data.transitions.map((item) => (
                    <TransitionItem
                      key={item.transition_id}
                      item={item}
                      api={api}
                      email={session?.email}
                      onChanged={plan.retry}
                    />
                  ))
                ) : (
                  <p className="ad-soft">No plan change is scheduled or recorded.</p>
                )}
                <p className="ad-soft">
                  {data.mode === "self_hosted"
                    ? "This service is operated by your deployment administrator."
                    : "Plan changes are made by the service. Contact us to review a change."}
                </p>
              </Card>
            </>
          );
        }}
      </AsyncPage>
      {session && onDeletionScheduled && (
        <OrganizationDeletion api={api} session={session} navigate={navigate} onScheduled={onDeletionScheduled} />
      )}
    </>
  );
}

function TransitionItem({
  item,
  api,
  email,
  onChanged,
}: {
  item: any;
  api: ApiClient;
  /** The signed-in administrator, whose email receives the action code. */
  email?: string | null;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState(false),
    [reviewed, setReviewed] = useState(false);
  const status = String(item.status ?? "pending");
  const acknowledgementRequired = item.acknowledgement_required === true;
  const canAcknowledge =
    status === "pending" && acknowledgementRequired && !item.acknowledged;
  const terminal = ["cancelled", "superseded", "applied"].includes(status);
  const current = item.current_entitlement;
  const target = item.target_entitlement;
  const displayedCurrent = terminal
    ? (item.base_entitlement ?? current)
    : current;
  const preview = item.retention_preview;
  const phaseTitle =
    status === "applied"
      ? "Applied"
      : status === "cancelled"
        ? "Cancelled"
        : status === "superseded"
          ? "Superseded"
          : status === "review_required"
            ? "Operator review required"
            : item.acknowledged
              ? "Acknowledged, waiting for application"
              : acknowledgementRequired
                ? "Admin review required"
                : "Scheduled for automatic application";
  const retentionLabel = (months: unknown) =>
    months === null
      ? "Until admin deletion"
      : typeof months === "number"
        ? formatRetention(months)
        : "Unknown";
  const countWithNoun = (value: unknown, singular: string, plural: string) =>
    `${formatInteger(value as string)} ${String(value) === "1" ? singular : plural}`;
  async function acknowledge(code: { reauth_token: string; idempotency_key: string }) {
    await api.post("/v1/admin/plan-transition/acknowledge", {
      transition_id: item.transition_id,
      expected_version: item.version,
      confirmed: true,
      ...code,
    });
    setConfirming(false);
    setReviewed(false);
    onChanged();
  }
  const close = () => {
    setConfirming(false);
    setReviewed(false);
  };
  return (
    <Notice
      title={phaseTitle}
      tone={
        status === "review_required" || canAcknowledge ? "warning" : "neutral"
      }
    >
      <p>
        {status === "applied"
          ? `This plan change was applied after its effective time, ${formatDateTime(item.effective_at)}.`
          : status === "cancelled"
            ? "This plan change was cancelled and will not take effect."
            : status === "superseded"
              ? "A later entitlement decision replaced this transition."
              : status === "review_required"
                ? "The entitlement changed after this transition was created. An operator must refresh its target and impact."
                : item.acknowledged
                  ? `The organization admin acknowledged this change. The current policy remains active until maintenance applies it at or after ${formatDateTime(item.effective_at)}.`
                  : acknowledgementRequired
                    ? `Retention would shorten at ${formatDateTime(item.effective_at)}. Review and acknowledge the impact before it can take effect.`
                    : `This change applies automatically at or after ${formatDateTime(item.effective_at)}. No organization admin acknowledgement is required.`}
      </p>
      <dl>
        <Row
          label={terminal ? "Plan when scheduled" : "Current plan"}
          value={
            displayedCurrent
              ? `${displayedCurrent.plan_id} v${displayedCurrent.plan_version}`
              : "Unavailable"
          }
        />
        <Row
          label={terminal ? "Capacity when scheduled" : "Current capacity"}
          value={
            displayedCurrent
              ? formatInteger(displayedCurrent.capacity)
              : "Unavailable"
          }
        />
        <Row
          label={terminal ? "Retention when scheduled" : "Current retention"}
          value={
            displayedCurrent
              ? retentionLabel(displayedCurrent.retention_months)
              : "Unavailable"
          }
        />
        <Row
          label={terminal ? "Transition target" : "Target plan"}
          value={
            target ? `${target.plan_id} v${target.plan_version}` : "Unavailable"
          }
        />
        <Row
          label="Target capacity"
          value={target ? formatInteger(target.capacity) : "Unavailable"}
        />
        <Row
          label="Target retention"
          value={
            target ? retentionLabel(target.retention_months) : "Unavailable"
          }
        />
      </dl>
      {item.retention_shortened && preview && (
        <div className="notice-detail">
          <p>
            {terminal
              ? `The historical preview counted ${countWithNoun(preview.request_count, "request family", "request families")} and ${countWithNoun(preview.attempt_count, "attempt", "attempts")}.`
              : status === "review_required"
                ? `The last stored preview counted ${countWithNoun(preview.request_count, "request family", "request families")} and ${countWithNoun(preview.attempt_count, "attempt", "attempts")}. It must be refreshed by the operator.`
                : `${item.acknowledged ? "The acknowledged preview" : "At the current preview"}, ${countWithNoun(preview.request_count, "request family", "request families")} and ${countWithNoun(preview.attempt_count, "attempt", "attempts")} ${item.acknowledged ? "were in scope" : "would be removed"}.`}
          </p>
          <p>
            {terminal ? "The preview cutoff was" : "The cutoff is"}{" "}
            {formatDateTime(preview.cutoff)}. Requests dispatched before that
            cutoff are considered with their entire attempt family.
          </p>
          {terminal ? (
            <p>
              Historical preview counted {formatDateTime(preview.counted_at)}.
            </p>
          ) : (
            <p>
              Preview counted {formatDateTime(preview.counted_at)}. The rolling
              retention policy also applies to later records when it takes
              effect.
            </p>
          )}
        </div>
      )}
      {status === "review_required" && (
        <p>
          Operator review is required before an organization admin can
          acknowledge this change.
        </p>
      )}
      {terminal && (
        <p>
          This transition has no remaining admin action. Its preview is retained
          as history.
        </p>
      )}
      {canAcknowledge && (
        <Button
          onClick={() => {
            setReviewed(false);
            setConfirming(true);
          }}
          disabled={confirming || !current || !target}
        >
          Review scheduled change
        </Button>
      )}
      {canAcknowledge && (!current || !target) && (
        <p>
          Current or target plan details are unavailable. Ask the operator to
          review this transition.
        </p>
      )}
      {confirming && (
        <CodeConfirmDialog
          api={api}
          email={email}
          title="Acknowledge retention change?"
          dangerous={Boolean(item.retention_shortened)}
          confirmLabel="Confirm acknowledgement"
          busyLabel="Acknowledging"
          failureTitle="Plan change was not acknowledged"
          ready={reviewed && Boolean(current) && Boolean(target)}
          onConfirm={acknowledge}
          onClose={close}
        >
          <p>
            {current?.plan_id} v{current?.plan_version} changes to{" "}
            {target?.plan_id} v{target?.plan_version}. Capacity changes from{" "}
            {formatInteger(current?.capacity)} to{" "}
            {formatInteger(target?.capacity)}; retention changes from{" "}
            {retentionLabel(current?.retention_months)} to{" "}
            {retentionLabel(target?.retention_months)}.
          </p>
          {item.retention_shortened && preview && (
            <Notice tone="warning" title="Records will be removed">
              <p>
                {countWithNoun(
                  preview.request_count,
                  "request family",
                  "request families",
                )}{" "}
                and{" "}
                {countWithNoun(preview.attempt_count, "attempt", "attempts")}{" "}
                are in the current preview. The cutoff is{" "}
                {formatDateTime(preview.cutoff)}.
              </p>
              <p>
                This acknowledgement applies to the exact transition version
                shown here. The server will reject it if the transition changes.
              </p>
            </Notice>
          )}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(event) => setReviewed(event.target.checked)}
            />
            I reviewed the target plan, capacity, retention cutoff and record
            impact.
          </label>
        </CodeConfirmDialog>
      )}
    </Notice>
  );
}

/**
 * The dates a deletion preview covers. Only a date-range deletion has a start of its own. A
 * deletion of one person or of the whole organization covers everything recorded until the
 * preview, and the server stores 1 January 1970 as the start of those, which nobody chose.
 */
export function deletionRangeText(preview: { scope?: string; range_start?: string | null; range_end?: string | null }) {
  if (preview.scope === "range" && preview.range_start)
    return `${formatDateTime(preview.range_start)} to ${formatDateTime(preview.range_end)}`;
  return preview.range_end ? `Everything recorded until ${formatDateTime(preview.range_end)}` : "Everything recorded";
}

export function AdminDeletion({
  api,
  session,
}: {
  api: ApiClient;
  session: Session;
}) {
  const [scope, setScope] = useState<"range" | "user" | "company">("range"),
    [preview, setPreview] = useState<any>(null),
    [confirmed, setConfirmed] = useState(false),
    [result, setResult] = useState<any>(null),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false),
    [deletionOperation] = useState(idempotencyKey),
    [chosenUser, setChosenUser] = useState("");
  const timezone = useCompanyTimezone(api);
  const actionCode = useActionReauth(api);
  const reauth = actionCode.token;
  // Members load only for a deletion of one person, who is chosen by work email.
  const people = useApi(
    () =>
      scope === "user"
        ? fetchAllPages<Member>((cursor) =>
            api.get(
              "/v1/admin/users" +
                queryString({ limit: MEMBER_PAGE_LIMIT, cursor: cursor || undefined }),
            ),
          )
        : Promise.resolve(null),
    [scope],
  );
  useEffect(() => {
    if (!preview || preview.counts_complete || preview.state !== "pending")
      return;
    const timer = setTimeout(() => {
      api
        .post(preview.status_path + "/advance", {})
        .then(setPreview)
        .catch(setError);
    }, 1500);
    return () => clearTimeout(timer);
  }, [
    preview?.state,
    preview?.request_count,
    preview?.record_count,
    preview?.historical_message_count,
    preview?.undated_historical_message_count,
  ]);
  useEffect(() => {
    if (!result || result.status === "completed" || !result.job_id) return;
    const timer = window.setTimeout(() => {
      api
        .post(
          `/v1/admin/deletions/${encodeURIComponent(result.job_id)}/advance`,
          {},
        )
        .then(setResult)
        .catch(setError);
    }, 1_500);
    return () => window.clearTimeout(timer);
  }, [result?.job_id, result?.status, result?.phase, result?.records_erased]);
  async function makePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const body = buildDeletionPreview(
        scope,
        {
          user_id: String(form.get("user_id") ?? ""),
          start: String(form.get("start") ?? ""),
          end: String(form.get("end") ?? ""),
        },
        timezone.data?.timezone ?? "",
      );
      setPreview(await api.post("/v1/admin/deletions/preview", body));
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  async function execute() {
    if (!preview || !reauth) return;
    setBusy(true);
    setError(null);
    try {
      setResult(
        await api.post(
          "/v1/admin/deletions",
          buildDeletionExecution(
            preview.preview_token,
            reauth,
            true,
            deletionOperation,
          ),
        ),
      );
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  const step = result ? 4 : !preview ? 1 : !preview.counts_complete || preview.state === "expired" ? 2 : 3;
  // A preview for one person lists what is deleted instead of counting their records, which would
  // show an administrator that person's usage (owner decision of 18 October 2026).
  const counted = preview?.counts_shown !== false;
  const scopeText =
    preview?.scope === "user" || scope === "user"
      ? `One person: ${people.data?.find((member) => member.user_id === chosenUser)?.email ?? "selected member"}`
      : scope === "company"
        ? "The whole organization's usage"
        : preview
          ? `Usage from ${deletionRangeText(preview)}`
          : "Usage in a date range";
  return (
    <>
      <PageTitle title={result ? "Deletion progress" : "Delete usage records"}>
        {result
          ? result.status === "completed"
            ? "Server records and derived totals were processed."
            : "The server is applying the committed deletion in bounded steps."
          : `Remove recorded usage from the organization server and from the connected browsers. Deleted records cannot be restored. Dates use the organization's time zone, ${timezone.data?.timezone ?? "loading"}.`}
      </PageTitle>
      {Boolean(timezone.error) && (
        <ErrorState error={timezone.error} onRetry={timezone.retry} />
      )}
      <ol className="ad-card ad-steps">
        <Step
          n={1}
          at={step}
          title="What to delete"
          sub={step > 1 ? scopeText : "A date range, one person or the whole organization"}
          action={
            step > 1 &&
            !result && (
              <button
                type="button"
                className="ad-btn ad-btn-sm"
                onClick={() => {
                  setPreview(null);
                  actionCode.reset();
                  setConfirmed(false);
                }}
              >
                Change
              </button>
            )
          }
        >
          {step === 1 && (
            <form onSubmit={makePreview} className="ad-step-form">
              <label>
                Scope
                <select
                  value={scope}
                  onChange={(event) => setScope(event.target.value as any)}
                >
                  <option value="range">Usage in a date range</option>
                  <option value="user">One person</option>
                  <option value="company">The whole organization's usage</option>
                </select>
              </label>
              {scope === "range" && (
                <div className="form-row">
                  <label>
                    Start
                    <input name="start" type="date" required />
                  </label>
                  <label>
                    End, exclusive
                    <input name="end" type="date" required />
                  </label>
                </div>
              )}
              {scope === "user" && (
                <label>
                  Person
                  <select
                    name="user_id"
                    required
                    value={chosenUser}
                    onChange={(event) => setChosenUser(event.target.value)}
                  >
                    <option value="">Choose a member</option>
                    {(people.data ?? []).map((member) => (
                      <option key={member.user_id} value={member.user_id}>
                        {member.email ?? member.user_id}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <Button
                variant="danger"
                type="submit"
                disabled={busy || (scope === "range" && !timezone.data?.timezone)}
              >
                Preview deletion
              </Button>
            </form>
          )}
        </Step>
        <Step
          n={2}
          at={step}
          title="Check what will go"
          sub={
            preview?.counts_complete
              ? counted
                ? `${formatInteger(preview.request_count)} requests, ${formatInteger(preview.record_count)} records`
                : "Everything recorded for this member"
              : "The exact records, counted by the server"
          }
        >
          {preview && step < 4 && (
            <section>
              <h3 className="ad-h3">Deletion preview</h3>
              {!counted && (
                <>
                  <p>For this member, the server deletes:</p>
                  <ul>
                    {(preview.deletes ?? []).map((line: string) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  <p className="ad-soft">The number of their records is not shown, so the preview does not reveal their usage.</p>
                </>
              )}
              <dl className="ad-rows">
                {counted && (
                  <>
                <Row
                  label="Requests"
                  value={formatInteger(preview.request_count)}
                />
                <Row label="Records" value={formatInteger(preview.record_count)} />
                <Row
                  label="Imported historical messages"
                  value={formatInteger(preview.historical_message_count)}
                />
                <Row
                  label="Imported historical messages without a source date"
                  value={formatInteger(preview.undated_historical_message_count)}
                />
                  </>
                )}
                <Row label="Range" value={deletionRangeText(preview)} />
                {counted && (
                  <Row
                    label="Daily totals affected"
                    value={
                      preview.contribution_date_range?.start
                        ? `${formatDateTime(preview.contribution_date_range.start)} to ${formatDateTime(preview.contribution_date_range.end)}`
                        : "No retained contribution dates"
                    }
                  />
                )}
                <Row
                  label="Preview expires"
                  value={formatDateTime(preview.expires_at)}
                />
              </dl>
              <Notice tone="warning">{preview.local_erasure}</Notice>
              {scope === "range" && counted && (
                <Notice tone="warning">
                  This explicit date-range deletion also includes{" "}
                  {formatInteger(preview.undated_historical_message_count)} imported
                  historical messages without a source date. Their dates cannot
                  prove that they fall outside the selected range. This does not
                  change the separate age-retention policy for imported history.
                </Notice>
              )}
              {preview.contribution_dates?.length > 0 && (
                <Notice>
                  Whole request families are erased. Attempts attached to matching
                  requests can change daily totals on these dates, including dates
                  outside the selected dispatch range:{" "}
                  {preview.contribution_dates.join(", ")}.
                </Notice>
              )}
              {preview.state === "expired" ? (
                <Notice tone="danger" title="Deletion preview expired">
                  <p>Create a new preview before verification or deletion.</p>
                  <Button onClick={() => setPreview(null)}>
                    Create new preview
                  </Button>
                </Notice>
              ) : (
                !preview.counts_complete && (
                  <Notice title="Calculating affected records">
                    The server is building the exact bounded preview. Final
                    confirmation stays unavailable until counting finishes.
                  </Notice>
                )
              )}
            </section>
          )}
        </Step>
        <Step n={3} at={step} title="Confirm it is you" sub="Email code and a final check">
          {step === 3 &&
            (!reauth ? (
              <ActionReauthSteps reauth={actionCode} email={session.email} disabled={busy} />
            ) : (
              <div className="ad-step-form">
                <label className="checkbox ad-danger-check">
                  <input
                    id="delete-confirm"
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  I understand these records, including the disclosed imported
                  history without source dates, and derived totals cannot be
                  restored by this service.
                </label>
                <div className="actions">
                  <Button
                    id="execute-delete"
                    variant="danger"
                    disabled={!confirmed || busy}
                    onClick={execute}
                  >
                    {!counted
                      ? "Delete this member's records"
                      : preview?.request_count
                        ? `Delete ${formatInteger(preview.request_count)} ${preview.request_count === "1" ? "request" : "requests"}`
                        : "Delete selected records"}
                  </Button>
                </div>
              </div>
            ))}
        </Step>
        <Step n={4} at={step} title="Deleting" sub="Browsers confirm as they come online">
          {result && (
            <>
              <Notice
                title={
                  result.status === "completed"
                    ? "Server deletion completed"
                    : "Deletion is still running"
                }
              >
                <p>
                  {result.records_erased === null
                    ? "The member's records are being erased; their number is not shown."
                    : `${formatInteger(result.records_erased)} records erased.`}{" "}
                  Deletion epoch {result.deletion_epoch}.
                </p>
                <p>Current phase: {humanize(result.phase)}.</p>
                <p>{result.offline_devices}</p>
              </Notice>
              <Status
                tone={result.device_acknowledgement_complete ? "good" : "warning"}
              >
                {result.device_acknowledgement_complete
                  ? "All browsers acknowledged"
                  : "Offline browser acknowledgements pending"}
              </Status>
            </>
          )}
        </Step>
      </ol>
      {Boolean(error ?? actionCode.error) && (
        <ErrorState
          error={error ?? actionCode.error}
          context="action"
          title="Deletion action was not completed"
        />
      )}
    </>
  );
}

/** One numbered step of a guided action (canvas AdminDeletion). */
function Step({
  n,
  at,
  title,
  sub,
  action,
  children,
}: {
  n: number;
  at: number;
  title: string;
  sub: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const state = n < at ? "done" : n === at ? "active" : "todo";
  return (
    <li className="ad-step" data-state={state} aria-current={state === "active" ? "step" : undefined}>
      <div className="ad-step-head">
        <span className="ad-step-n" aria-hidden="true">
          {n}
        </span>
        <div>
          <b>{title}</b>
          <small>{sub}</small>
        </div>
        {action}
      </div>
      {children && <div className="ad-step-body">{children}</div>}
    </li>
  );
}
