import { useState } from "react";
import type { DisplayScenario } from "@footprint/contracts";
import { Icon } from "@footprint/ui/icons";
import { formatInteger } from "@footprint/ui/formatters";
import { ApiClient, companyConfig, queryString, summaryTotals } from "../api";
import { ErrorState, PageTitle } from "../components";
import type { Navigate } from "../router";
import { Card, PeriodMenu, ScenarioMenu, Skeleton, SourceNote, StateCard, ToolMenu, UpdatingNote } from "./controls";
import {
  SITE_LABELS,
  SITE_ORDER,
  adminFigures,
  baseParts,
  baseText,
  baseValue,
  changeText,
  dashAxis,
  dashWindow,
  dayText,
  equivalentText,
  modelName,
  peopleOf,
  periodQuery,
  type AdminFigures,
  type AdminSummary,
  type DashWindow,
  type Metric,
  type UsageFigures,
} from "./figures";
import { cachedSince, useAdminView, useApi, useFigures } from "./state";

export const METRIC_LABELS: Record<Metric, string> = {
  energy: "Electricity",
  carbon: "Carbon",
  water: "Water",
  requests: "Requests",
};

/**
 * The organization's usage spread. By default the server sends aggregates only, never requests per
 * member (owner decision of 18 October 2026), so nothing here can be shown next to a name.
 */
export type PeopleSummary = {
  /**
   * Requests per member id, sent only while the server has person analytics switched on, and
   * counted only from the first full day after it was (person_analytics_since).
   */
  requests?: Record<string, string>;
  person_analytics_since?: string;
  used: number;
  members: number;
  administrators: number;
  capacity: number;
  median_requests: string | null;
  average_requests: string | null;
  /** The most active person's requests, without saying who. */
  max_requests: string | null;
  bins: { from: number; to: number | null; people: number }[];
};
/**
 * Sync health as counts: no browser, member or time of use is listed. Only while the server has
 * person analytics switched on do the reports (items) and each browser with its member come too.
 */
export type HealthSummary = {
  browsers_connected: number;
  browsers_synced_last_day: number;
  browsers_not_synced_3_days: number;
  problems: { code: string; site: string | null; browsers: number }[];
  items?: { code: string; site: string | null; count: number; client_version: string; at: string }[];
  browsers?: {
    device_id: string;
    user_id: string;
    browser_family: string;
    last_reporting_at: string | null;
    connected_at: string;
    client_version: string | null;
    report: { code: string; count: number; at: string } | null;
  }[];
};

/** The organization's time zone, from the policy every admin page already reads. */
export function useTimezone(api: ApiClient) {
  return useApi(() => companyConfig<{ timezone: string; usage_retention_months?: number | null }>(api));
}

/**
 * The admin summary for the chosen period and tool, with the server's day, tool and model splits.
 * `totalsOnly` leaves the splits out for a summary whose totals alone are read. A summary already
 * read for the same request on this signed-in page shows at once while it is read again.
 */
export function useSummary(
  api: ApiClient,
  window: { startDate?: string; endDate?: string } | null,
  site: string,
  extra: Record<string, string> = {},
  totalsOnly = false,
) {
  const path = window ? "/v1/admin/summary" + queryString({ ...periodQuery(window), ...(site ? { site } : {}), ...extra }) : null;
  // A totals-only read is a different request from the full one, so it is kept under its own key.
  const key = path && (totalsOnly ? "totals " + path : path);
  return useFigures<AdminSummary>(api, key, () =>
    totalsOnly ? summaryTotals<AdminSummary>(api, path!) : api.get<AdminSummary>(path!),
  );
}

/** How usage spreads across the organization in the period, for the People page. */
export function usePeopleSummary(api: ApiClient, window: { startDate?: string; endDate?: string } | null) {
  const path = window ? "/v1/admin/people" + queryString(periodQuery(window)) : null;
  return useFigures<PeopleSummary | null>(api, path, () => api.get<PeopleSummary | null>(path!));
}

export function AdminOverview({ api, navigate }: { api: ApiClient; navigate: Navigate }) {
  const view = useAdminView();
  const config = useTimezone(api);
  const [metric, setMetric] = useState<Metric>("energy");
  const [now] = useState(() => new Date());
  const timezone = config.data?.timezone;
  const window = timezone ? dashWindow(view.period, timezone, now) : null;
  const summary = useSummary(api, window, view.site);
  // Only the previous period's totals are compared, so it is read without its splits.
  const before = useSummary(api, window?.previous ?? null, view.site, {}, true);
  const people = usePeopleSummary(api, window);
  const health = useApi(() => api.get<HealthSummary>("/v1/admin/health"));

  const actions = (
    <>
      {timezone && <PeriodMenu timezone={timezone} now={now} />}
      <ToolMenu />
      <ScenarioMenu />
      <a
        className="ad-chip"
        href="/admin/policies#export"
        onClick={(event) => {
          event.preventDefault();
          navigate("/admin/policies#export");
        }}
      >
        <Icon name="download" size={16} />
        Export
      </a>
    </>
  );
  const error = config.error ?? summary.error;
  const updating = error ? null : cachedSince(summary, before, people);
  return (
    <>
      <PageTitle title="Organization footprint" actions={actions}>
        {updating !== null && <UpdatingNote since={updating} />}
      </PageTitle>
      {error ? (
        <ServerProblem error={error} onRetry={() => (config.error ? config.retry() : summary.retry())} />
      ) : !summary.data || !window ? (
        <Skeleton />
      ) : (
        <OverviewBody
          summary={summary.data}
          before={before.data}
          window={window}
          scenario={view.scenario}
          metric={metric}
          setMetric={setMetric}
          people={people.data}
          health={health.data}
          navigate={navigate}
        />
      )}
    </>
  );
}

/** Could not load (canvas AdminStates): the data is safe, try again, with the error code. */
export function ServerProblem({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const code = (error as { code?: string })?.code;
  if ((error as { status?: number })?.status === 401) return <ErrorState error={error} />;
  return (
    <StateCard
      icon="alert"
      tone="danger"
      title="The server did not answer"
      actions={
        <>
          <button type="button" className="ad-btn" onClick={onRetry}>
            <Icon name="refresh" size={16} />
            Try again
          </button>
          {code && <span className="ad-soft">Error code: {code}</span>}
        </>
      }
    >
      <p>Your data is safe. Browsers keep their records and send them later. Try again in a moment.</p>
    </StateCard>
  );
}

function OverviewBody({
  summary,
  before,
  window,
  scenario,
  metric,
  setMetric,
  people,
  health,
  navigate,
}: {
  summary: AdminSummary;
  before: AdminSummary | null;
  window: DashWindow;
  scenario: DisplayScenario;
  metric: Metric;
  setMetric: (metric: Metric) => void;
  people: PeopleSummary | null;
  health: HealthSummary | null;
  navigate: Navigate;
}) {
  if (summary.aggregate_status !== "current")
    return (
      <StateCard icon="refresh" tone="info" title="Figures are being rebuilt">
        <p>{summary.safe_message ?? "The organization's totals are being prepared. Check again in a few minutes."}</p>
      </StateCard>
    );
  const figures = adminFigures(summary, scenario);
  // A period without usage has no browser in its summary either, so whether any browser is
  // connected comes from Health; until it answers the page assumes some are.
  if (!figures || (figures.requests === 0n && !hasHistory(summary)))
    return <NoUsage navigate={navigate} empty={health?.browsers_connected === 0} phrase={window.phrase} />;

  const value = baseValue(figures, metric);
  const previousFigures = adminFigures(before, scenario);
  const previous = previousFigures ? baseValue(previousFigures, metric) : null;
  const change = window.previous ? changeText(value, previous, window.previous.phrase, window.period.kind === "today" ? window.previous.days : undefined) : null;
  const active = peopleOf(summary);
  const parts = baseParts(metric, value);
  const perPerson = active && value !== null ? value / active : null;
  const equivalent = equivalentText(metric, value);
  const sentence =
    perPerson === null
      ? null
      : metric === "requests"
        ? `About ${formatInteger(Math.round(perPerson))} requests per active person.`
        : `About ${baseText(metric, perPerson)} per active person${equivalent ? `, or ${equivalent.replace(/^≈ /, "")}` : ""}.`;

  return (
    <>
      <section className="ad-hero" aria-label={`${METRIC_LABELS[metric]}, ${window.phrase}`}>
        <div className="ad-hero-text">
          <span className="ad-hero-label">
            {METRIC_LABELS[metric]} · {window.phrase}
            {active ? ` · ${formatInteger(active)} active ${active === 1 ? "person" : "people"}` : ""}
          </span>
          <div className="ad-hero-figure">
            {metric !== "requests" && parts && (
              <span className="ad-approx" aria-hidden="true">
                ≈
              </span>
            )}
            {parts ? (
              <>
                <span className="ad-hero-num">{parts.number}</span>
                {metric !== "requests" && <span className={`ad-hero-unit ad-unit-${metric}`}>{parts.unit}</span>}
              </>
            ) : (
              <span className="ad-hero-unknown">Not available</span>
            )}
          </div>
          {sentence && <p className="ad-hero-eq">{sentence}</p>}
          {change && (
            <span className="ad-pill">
              {change.change !== 0 && <Icon name={change.up ? "arrowUp" : "arrowDown"} size={14} />}
              {change.text}
            </span>
          )}
        </div>
        {summary.days && window.bucket === "day" && window.keys.length > 1 && (
          <DayBars
            keys={window.keys}
            axis={dashAxis(window)}
            values={window.keys.map((key) => {
              const f = adminFigures(summary.days![key], scenario);
              return f ? baseValue(f, metric) : 0;
            })}
            metric={metric}
            label={`${METRIC_LABELS[metric]} each day`}
            tone="dark"
          />
        )}
      </section>

      <div className="ad-tiles" role="group" aria-label="Choose the figure shown above">
        {(["energy", "carbon", "water", "requests"] as const).map((m) => (
          <Tile key={m} figures={figures} metric={m} pressed={metric === m} onPick={() => setMetric(m)} />
        ))}
        <div className="ad-tile">
          <span className="ad-tile-label">Active people</span>
          <span className="ad-tile-value">
            <span className="ad-num">{active === null ? "0" : formatInteger(active)}</span>
            {people && <span className="ad-tile-unit">of {formatInteger(people.capacity)}</span>}
          </span>
          <span className="ad-tile-hint">{browsersWithUsage(summary.active_installations)}</span>
        </div>
      </div>

      <div className="ad-two">
        <ByTool summary={summary} metric={metric} scenario={scenario} />
        <TopModels summary={summary} scenario={scenario} navigate={navigate} />
      </div>

      <div className="ad-three">
        <SyncCard health={health} navigate={navigate} />
        <div className="ad-note-card">
          <span className="ad-note-icon" aria-hidden="true">
            <Icon name="shield" size={18} />
          </span>
          <div>
            <b>Numbers only</b>
            <p>The server receives counts and estimates, never prompts, answers or file contents.</p>
          </div>
        </div>
        <div className="ad-note-card">
          <span className="ad-note-icon ad-tone-warn" aria-hidden="true">
            <Icon name="info" size={18} />
          </span>
          <div>
            <b>Estimates, not meter readings</b>
            <p>
              Showing the {scenario} scenario. <a href="/methodology">How it works</a>
            </p>
          </div>
        </div>
      </div>
      {figures.approximate && <SourceNote>Some live requests could not be matched with messages read from chats, so the request count is approximate.</SourceNote>}
      <MethodNote figures={figures} />
    </>
  );
}

/**
 * Says how the resource figures were combined: several method releases that add up (the contract's
 * mixed-method indicator), or the largest comparable part when estimates cannot all add up.
 */
export function MethodNote({ figures }: { figures: AdminFigures }) {
  return (
    <>
      {figures.releases > 1 && (
        <SourceNote>
          These figures add estimates from {formatInteger(figures.releases)} releases of the EcoLogits method, made as
          browsers were updated. The releases use the same EcoLogits data and boundaries, so their figures add up.
        </SourceNote>
      )}
      {figures.partial.length > 0 && (
        <SourceNote>
          Some estimates use EcoLogits data or boundaries that cannot be added to the others, so{" "}
          {figures.partial.map((resource) => METRIC_LABELS[resource].toLowerCase()).join(", ")} show the largest group
          of estimates that add up, not every estimate.
        </SourceNote>
      )}
    </>
  );
}

/**
 * The summary counts the browsers that sent usage in the period, not every connected one (Health
 * counts those), so the tile says "with usage".
 */
function browsersWithUsage(count: string | undefined) {
  const n = Number(count ?? "0");
  return `${formatInteger(n)} ${n === 1 ? "browser" : "browsers"} with usage`;
}

export function hasHistory(summary: AdminSummary) {
  return summary.history?.status === "available" && summary.history.prompt_count !== "0";
}

function NoUsage({ navigate, empty, phrase }: { navigate: Navigate; empty: boolean; phrase: string }) {
  const [copied, setCopied] = useState(false);
  return empty ? (
    <StateCard
      icon="link"
      title="Connect the first browser"
      actions={
        <>
          <button type="button" className="ad-btn ad-btn-primary" onClick={() => navigate("/downloads")}>
            Get the extension
          </button>
          <button
            type="button"
            className="ad-btn"
            onClick={() =>
              void navigator.clipboard
                ?.writeText(`${location.origin}/downloads`)
                .then(() => setCopied(true))
                .catch(() => setCopied(false))
            }
          >
            {copied ? "Download link copied" : "Copy download link"}
          </button>
        </>
      }
    >
      <p>
        Figures appear here once people connect the extension to your organization. Each person installs it, chooses
        Connect organization and signs in with their work email and the code sent to it. Their email must be on your
        organization's domain.
      </p>
    </StateCard>
  ) : (
    <StateCard icon="calendar" tone="info" title="No usage in this period">
      <p>Connected browsers recorded no AI use in the {phrase}. Choose a longer period to see earlier figures.</p>
    </StateCard>
  );
}

export function Tile({ figures, metric, pressed, onPick, hint }: { figures: UsageFigures; metric: Metric; pressed?: boolean; onPick?: () => void; hint?: string | null }) {
  const value = baseValue(figures, metric);
  const parts = baseParts(metric, value);
  const energy = baseValue(figures, "energy");
  const shown =
    hint !== undefined
      ? hint
      : metric === "requests"
        ? energy !== null && value
          ? `≈ ${baseText("energy", energy / value, 2)} each`
          : null
        : equivalentText(metric, value);
  const body = (
    <>
      <span className="ad-tile-label">
        {metric !== "requests" && <i className={`ad-dot ad-dot-${metric}`} aria-hidden="true" />}
        {METRIC_LABELS[metric]}
      </span>
      <span className="ad-tile-value">
        {parts ? (
          <>
            <span className="ad-num">{parts.number}</span>
            {metric !== "requests" && <span className="ad-tile-unit">{parts.unit}</span>}
          </>
        ) : (
          <span className="ad-unknown">Not available</span>
        )}
      </span>
      {shown && <span className="ad-tile-hint">{shown}</span>}
    </>
  );
  return onPick ? (
    <button type="button" className="ad-tile" aria-pressed={pressed} onClick={onPick}>
      {body}
    </button>
  ) : (
    <div className="ad-tile">{body}</div>
  );
}

/** Daily bars with the busiest day marked; each bar is a button that names its day and figure. */
export function DayBars({
  keys,
  values,
  axis,
  metric,
  label,
  tone,
}: {
  keys: string[];
  values: (number | null)[];
  axis: string[];
  metric: Metric;
  label: string;
  tone: "dark" | "light";
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(0, ...values.map((v) => v ?? 0));
  const busiest = max > 0 ? values.indexOf(max) : -1;
  return (
    <div className={`ad-days ad-days-${tone}`}>
      <div className="ad-days-head">
        {/* On a light card the card's own heading already names the chart. */}
        <span className={tone === "light" ? "ad-hidden" : undefined}>{label}</span>
        {busiest >= 0 && (
          <span>
            Busiest day: <b>{dayText(keys[busiest]!, true)} · {baseText(metric, max, 3)}</b>
          </span>
        )}
      </div>
      <ol className="ad-days-plot" aria-label={label}>
        {values.map((value, index) => {
          const height = value && max ? Math.max(2, (value / max) * 100) : 0;
          return (
            <li key={keys[index]}>
              <button
                type="button"
                className="ad-day"
                data-on={index === busiest || index === active || undefined}
                style={{ height: `${height}%` }}
                aria-label={`${dayText(keys[index]!)}: ${value === null ? "unknown" : baseText(metric, value)}`}
                onMouseEnter={() => setActive(index)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
              />
              {active === index && (
                <span className="ad-day-tip" role="tooltip">
                  <b>{dayText(keys[index]!, true)}</b> · {value === null ? "Unknown" : baseText(metric, value)}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <div className="ad-axis" aria-hidden="true">
        {axis.map((text, index) => (
          <span key={`${text}-${index}`}>{text}</span>
        ))}
      </div>
    </div>
  );
}

function ByTool({ summary, metric, scenario }: { summary: AdminSummary; metric: Metric; scenario: DisplayScenario }) {
  const rows = SITE_ORDER.flatMap((site) => {
    const f = adminFigures(summary.sites?.[site], scenario);
    const value = f ? baseValue(f, metric) : null;
    return value ? [{ site, value }] : [];
  }).sort((a, b) => b.value - a.value);
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return (
    <Card title="By tool" aside={<span className="ad-soft">{METRIC_LABELS[metric]}</span>}>
      {rows.length ? (
        <table className="ad-bars-table">
          <caption className="ad-hidden">Organization {METRIC_LABELS[metric].toLowerCase()} by tool</caption>
          <tbody>
            {rows.map((row) => (
              <tr key={row.site}>
                <th scope="row">{SITE_LABELS[row.site]}</th>
                <td className="ad-bar-cell">
                  <span className="ad-track">
                    <span style={{ width: `${(row.value / rows[0]!.value) * 100}%` }} className={`ad-fill ad-tool-${row.site}`} />
                  </span>
                </td>
                <td className="num">{baseText(metric, row.value)}</td>
                <td className="num ad-soft">{Math.round((row.value / total) * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="ad-soft">No tool has a figure for this period.</p>
      )}
    </Card>
  );
}

/** Why a model with electricity can have no request of its own (shown on hover). */
export const NO_MODEL_REQUEST =
  "No request was counted for this model. NotebookLM starts notebook guides itself, so they add electricity but no request, and when a request names no model and only its reply does, the request is counted for the tool, not the model.";

function TopModels({ summary, scenario, navigate }: { summary: AdminSummary; scenario: DisplayScenario; navigate: Navigate }) {
  const rows = Object.entries(summary.models ?? {})
    .map(([id, part]) => {
      const f = adminFigures(part, scenario);
      const energy = f ? baseValue(f, "energy") : null;
      const requests = f ? baseValue(f, "requests") : null;
      return { id, people: peopleOf(part), energy, requests, perRequest: energy !== null && requests ? energy / requests : null };
    })
    .sort((a, b) => (b.energy ?? -1) - (a.energy ?? -1))
    .slice(0, 5);
  return (
    <Card
      title="Top models"
      aside={
        <a
          href="/admin/tools"
          onClick={(event) => {
            event.preventDefault();
            navigate("/admin/tools");
          }}
        >
          All models
        </a>
      }
      className="ad-card-table"
    >
      {rows.length ? (
        <div className="ad-table-scroll">
          <table className="ad-table ad-table-stacked">
            <thead>
              <tr>
                <th>Model</th>
                <th className="num">People</th>
                <th className="num">Electricity</th>
                <th className="num">Per request</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row">{modelName(row.id)}</th>
                  <td className="num" data-label="People">{row.people === null ? "Not shared" : formatInteger(row.people)}</td>
                  <td className="num" data-label="Electricity">{baseText("energy", row.energy)}</td>
                  <td className="num" data-label="Per request">
                    {row.perRequest !== null ? (
                      baseText("energy", row.perRequest, 2)
                    ) : row.energy !== null && !row.requests ? (
                      <span title={NO_MODEL_REQUEST}>No request</span>
                    ) : (
                      "Not available"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="ad-soft ad-pad">No model was recorded in this period.</p>
      )}
    </Card>
  );
}

function SyncCard({ health, navigate }: { health: HealthSummary | null; navigate: Navigate }) {
  if (!health || typeof health.browsers_connected !== "number") return <div className="ad-note-card ad-note-empty" aria-hidden="true" />;
  const connected = health.browsers_connected;
  const recent = health.browsers_synced_last_day;
  const good = connected > 0 && recent === connected;
  return (
    <div className="ad-note-card">
      <span className={`ad-note-icon ${good ? "ad-tone-good" : "ad-tone-warn"}`} aria-hidden="true">
        <Icon name={good ? "check" : "clock"} size={18} />
      </span>
      <div>
        <b>{good ? "Data is current" : connected ? "Some browsers have not synced" : "No browser connected"}</b>
        <p>
          {formatInteger(recent)} of {formatInteger(connected)} browsers synced in the last 24 hours.{" "}
          <a
            href="/admin/health"
            onClick={(event) => {
              event.preventDefault();
              navigate("/admin/health");
            }}
          >
            Health
          </a>
        </p>
      </div>
    </div>
  );
}
