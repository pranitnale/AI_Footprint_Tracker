import { useEffect } from "react";
import type { DisplayScenario } from "@footprint/contracts";
import { formatInteger } from "@footprint/ui/formatters";
import { Icon } from "@footprint/ui/icons";
import type { ServerSummary } from "../dashboard/types";
import { SITE_LABELS, SITE_ORDER, ageText } from "../ui/components";
import { dashAxis, dashWindow, dayText } from "../ui/dash-periods";
import { baseParts, baseText, baseValue, changeText, peopleOf, type Metric } from "../ui/figure-math";
import { usageFigures, type UsageFigures } from "../ui/usage-figures";
import { serverQuery, useScoped } from "./data";
import { cachedOnlyQuery, totalsOnlyQuery } from "../ui-model";
import { HeroBars, Donut } from "./charts";
import { METRIC_LABELS, Tiles } from "./Overview";
import type { PageContext } from "./Dashboard";
import { organizationName } from "../dashboard/organization";

/** Optional splits the organization server adds to its summary (days, tools, models, people). */
export type OrgSummary = ServerSummary & {
  active_users?: string;
  days?: Record<string, ServerSummary>;
  sites?: Record<string, ServerSummary>;
  models?: Record<string, ServerSummary & { site?: string }>;
};

const ignoreScope = () => {};

/**
 * `totalsOnly` leaves out the organization splits for a summary whose totals alone are read.
 *
 * `showCached` shows this browser's last validated copy of the same summary while the fresh one
 * loads. `cached` is true while that copy is shown, so the page can say how old it is. The copy is
 * used only for the exact query and data scope asked for, and never once the fresh read failed:
 * the page then shows the failure as before.
 */
export function useServerSummary(ctx: PageContext, kind: "company" | "my", window: { startDate?: string; endDate?: string } | null, totalsOnly = false, showCached = false) {
  const full = window ? serverQuery(window, ctx.dashboard.settings.timezone, ctx.now) : null;
  const query = full && totalsOnly ? totalsOnlyQuery(full) : full;
  const key = query ? `${kind}${query}` : null;
  const scopeToken = ctx.dashboard.scopeToken;
  const fresh = useScoped<OrgSummary>(key, scopeToken, ctx.revision, () => ctx.client.serverSummary(kind, query!) as Promise<OrgSummary>, ctx.rescope);
  // Read once per query and scope (revision 0). A copy from another scope is simply not shown;
  // the fresh read reports the scope change.
  const cachedKey = showCached && key ? `cached:${key}` : null;
  const stored = useScoped<OrgSummary>(cachedKey, scopeToken, 0, () => ctx.client.serverSummary(kind, cachedOnlyQuery(query!)) as Promise<OrgSummary>, ignoreScope);
  const freshData = fresh.dataKey === key && fresh.data?.scopeToken === scopeToken ? fresh.data : null;
  const storedData = cachedKey && stored.dataKey === cachedKey && stored.data?.scopeToken === scopeToken ? stored.data : null;
  if (!freshData && storedData && !fresh.error) return { ...fresh, data: storedData, cached: true };
  return { ...fresh, cached: false };
}

export function orgFigures(summary: ServerSummary | null | undefined, scenario: DisplayScenario): UsageFigures | null {
  return summary ? usageFigures(summary, summary.history?.server ?? null, scenario) : null;
}


/**
 * True when nobody in the organization synced anything for the period. The server answers such a
 * period with a current summary of zeros, which the pages show as a calm "No organization usage
 * yet" instead of empty charts and "Not available" figures.
 */
export function orgUnused(summary: ServerSummary, figures: UsageFigures): boolean {
  return figures.requests === 0n && Number(summary.attempt_count ?? "0") === 0;
}

export const ORG_RECHECK_MS = 5 * 60_000;

/**
 * Why organization totals are not shown. Only a server that could not answer is an error with a
 * retry. Since 13 Oct 2026 a server with sharing on shows totals whatever the group size, and a
 * period nobody used is a summary of zeros ("empty"). "withheld" covers a server that still holds
 * totals back (an older self-hosted version, for example) without claiming why. Waiting states
 * reload on their own, so the totals appear without a click.
 */
export function OrgUnavailable({ summary, onRetry, empty = false }: { summary: OrgSummary | null; onRetry?: () => void; empty?: boolean }) {
  const status = summary?.aggregate_status;
  const kind = empty
    ? "empty"
    : status === "policy_disabled"
      ? "admins_only"
      : status === "rebuilding"
        ? "rebuilding"
        : summary && (status === "suppressed" || summary.suppressed)
          ? "withheld"
          : "error";
  const [title, text] = {
    admins_only: [
      "Your organization keeps organization totals for administrators only.",
      "Your own figures are under Me. No organization figures appear here.",
    ],
    rebuilding: ["Organization totals are being updated.", "They appear here when the update finishes."],
    empty: [
      "No organization usage yet",
      "Nothing has synced for this period yet. Organization figures appear here on their own once members' records sync. Your own figures are under Me.",
    ],
    withheld: [
      "Organization totals are not shared for this period",
      "The organization server did not share totals for this period. They appear here on their own when it does. Your own figures are under Me.",
    ],
    error: [
      "Organization totals could not load.",
      "The organization server could not answer. Your own records are safe in this browser and sync later.",
    ],
  }[kind];
  // Other members' records arrive while the page stays open, so look again now and then. A check
  // keeps this card until the answer arrives, so nothing flickers.
  const waiting = kind === "empty" || kind === "withheld" || kind === "rebuilding";
  useEffect(() => {
    if (!waiting || !onRetry) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") onRetry();
    }, ORG_RECHECK_MS);
    return () => clearInterval(timer);
  }, [waiting, onRetry]);
  return (
    <section className="dh-card dh-unavailable" role="status">
      <Icon name={kind === "admins_only" ? "lock" : "info"} size={18} />
      <div>
        <b>{title}</b>
        <p className="dh-soft">{text}</p>
        {onRetry && kind === "error" && (
          <button type="button" className="lg-btn lg-btn-secondary lg-btn-sm" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    </section>
  );
}

export function OrgOverview({ ctx }: { ctx: PageContext }) {
  const { dashboard, metric, setMetric, now } = ctx;
  const scenario = dashboard.settings.displayScenario;
  const window = dashWindow(ctx.period, dashboard.settings.timezone, now);
  const company = useServerSummary(ctx, "company", window, false, true);
  const before = useServerSummary(ctx, "company", window.previous, true, true);
  const mine = useServerSummary(ctx, "my", window);
  const name = organizationName(dashboard.company);
  // A saved copy only stands in for figures. A saved "being updated", "not shared" or "no usage"
  // answer is not shown while the current one loads.
  const placeholder = company.cached && company.data;
  const waiting = !!placeholder && (placeholder.suppressed || placeholder.aggregate_status !== "current" || orgUnused(placeholder, orgFigures(placeholder, scenario)!));

  if (!company.data || waiting)
    return company.error ? (
      <OrgUnavailable summary={null} onRetry={company.retry} />
    ) : (
      <div className="dh-loading" role="status">
        Loading organization figures
      </div>
    );
  const summary = company.data;
  if (summary.suppressed || summary.aggregate_status !== "current") return <OrgUnavailable summary={summary} onRetry={company.retry} />;

  const figures = orgFigures(summary, scenario)!;
  if (orgUnused(summary, figures)) return <OrgUnavailable summary={summary} onRetry={company.retry} empty />;
  const value = baseValue(figures, metric);
  // The change is worked out from two saved copies or two fresh answers, never one of each.
  const previous = before.data && !before.data.suppressed && before.cached === company.cached ? baseValue(orgFigures(before.data, scenario)!, metric) : null;
  const change = window.previous ? changeText(value, previous, window.previous.phrase, ctx.period.kind === "today" ? window.previous.days : undefined) : null;
  const people = peopleOf(summary);
  const parts = baseParts(metric, value);
  // A saved copy shown while the fresh answer loads is not a failed refresh; it carries an age note.
  const offline = !company.cached && (summary.offline || summary.snapshot_source === "cached");
  const days = summary.days;
  const myFigures = orgFigures(mine.data && !mine.data.suppressed ? mine.data : null, scenario);

  const perPerson = people && value !== null ? value / people : null;
  const eq = perPerson !== null ? (metric === "requests" ? `About ${formatInteger(Math.round(perPerson))} requests per person who used AI.` : `About ${baseText(metric, perPerson)} per person who used AI.`) : null;

  return (
    <>
      {offline && (
        <p className="pp-info" role="status">
          <Icon name="offline" size={18} />
          <span>
            <b>{summary.offline ? "Organization server unreachable" : "Organization figures not refreshed"}</b>
            {summary.offline ? "" : "The organization server answered but could not send current figures. "}
            Showing organization figures from {summary.cached_at ? new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(summary.cached_at) : "earlier"}. Your new activity is safe here and syncs {summary.offline ? "when the server is back" : "in the background"}.
          </span>
        </p>
      )}
      <section className="dh-hero" aria-label={`${name} · ${window.phrase}`}>
        <div className="dh-hero-text">
          <span className="dh-hero-label">
            {METRIC_LABELS[metric]} · {window.phrase}
            {people ? ` · ${formatInteger(people)} people` : ""}
          </span>
          {company.cached && summary.cached_at ? (
            <span className="dh-pill dh-pill-age" role="status">
              Updated {ageText(summary.cached_at, now.getTime())}
            </span>
          ) : null}
          <div className="dh-hero-figure">
            {metric !== "requests" && (
              <span className="dh-approx" aria-hidden="true">
                ≈
              </span>
            )}
            {parts ? (
              <>
                <span className="dh-hero-num lg-display lg-num">{parts.number}</span>
                <span className={`dh-hero-unit lg-display dh-unit-${metric}`}>{parts.unit}</span>
              </>
            ) : (
              <span className="dh-hero-unknown">Not available</span>
            )}
          </div>
          {eq && <p className="dh-hero-eq">{eq}</p>}
          {change && (
            <span className="dh-pill">
              {change.change !== 0 && <Icon name={change.up ? "arrowUp" : "arrowDown"} size={14} />}
              {change.text}
            </span>
          )}
        </div>
        {days && window.keys.length > 0 && (
          <HeroBars
            points={window.keys.map((key) => {
              const f = orgFigures(days[key], scenario);
              return { key, value: f ? baseValue(f, metric) : 0, label: dayText(key, true) };
            })}
            metric={metric}
            highlight={window.keys.length - 1}
            axis={dashAxis(window)}
          />
        )}
      </section>

      <Tiles figures={figures} metric={metric} onPick={setMetric} plain />

      <div className="dh-two">
        <YourPart ctx={ctx} org={figures} mine={myFigures} metric={metric} people={people} phrase={window.phrase} />
        <Compare org={figures} mine={myFigures} people={people} days={window.keys.length || null} />
      </div>

      {summary.sites && <ByTool sites={summary.sites} metric={metric} scenario={scenario} />}

      <p className="dh-note">
        <Icon name="shield" size={16} />
        <span>Totals only. No one sees your chats, and your own figures are shown only to you.</span>
        <a href="methodology.html" className="dh-link">
          How the estimate works
        </a>
      </p>
    </>
  );
}

function YourPart({ ctx, org, mine, metric, people, phrase }: { ctx: PageContext; org: UsageFigures; mine: UsageFigures | null; metric: Metric; people: number | null; phrase: string }) {
  const total = baseValue(org, metric);
  const own = mine ? baseValue(mine, metric) : null;
  const share = total && own !== null ? Math.min(100, Math.round((own / total) * 100)) : null;
  return (
    <section className="dh-card" aria-labelledby="oo-part">
      <h2 id="oo-part" className="lg-display">
        Your part
      </h2>
      <p className="dh-soft">
        Your share of the organization's {METRIC_LABELS[metric].toLowerCase()} in the {phrase}.
      </p>
      {share !== null && own !== null && total !== null ? (
        <>
          <div className="oo-part">
            <Donut
              parts={[
                { key: "you", value: own, color: "var(--lg-fern)" },
                { key: "rest", value: Math.max(0, total - own), color: "var(--lg-track)" },
              ]}
              size={220}
              stroke={34}
              center={`${share}%`}
              sub="of the organization"
            />
          </div>
          <p className="oo-legend">
            <span>
              <i className="dh-key-sq" style={{ background: "var(--lg-fern)" }} /> You <b>{baseText(metric, own)}</b>
            </span>
            <span>
              <i className="dh-key-sq" style={{ background: "var(--lg-track)" }} /> {people && people > 1 ? `The other ${formatInteger(people - 1)} people` : "Everyone else"} <b>{baseText(metric, Math.max(0, total - own))}</b>
            </span>
          </p>
          <p>
            You used <b>{baseText(metric, own)}</b> of the organization's {baseText(metric, total)}.
          </p>
        </>
      ) : (
        <p className="dh-soft" role="status">
          {ctx.dashboard.queueCount ? "Your share appears once your records have synced." : "Your share is not available for this period."}
        </p>
      )}
      <p className="dh-soft">
        Organization totals appear here because your organization shares them with its members, however few people use AI. In a small team they can show one person's use. If sharing stops, only your own figures remain.
      </p>
    </section>
  );
}

function Compare({ org, mine, people, days }: { org: UsageFigures; mine: UsageFigures | null; people: number | null; days: number | null }) {
  const orgWh = baseValue(org, "energy");
  const orgReq = baseValue(org, "requests");
  const myWh = mine ? baseValue(mine, "energy") : null;
  const myReq = mine ? baseValue(mine, "requests") : null;
  const rows = [
    { label: "Electricity per request", you: myWh !== null && myReq ? myWh / myReq : null, avg: orgWh !== null && orgReq ? orgWh / orgReq : null, metric: "energy" as const },
    { label: "Electricity per day", you: myWh !== null && days ? myWh / days : null, avg: orgWh !== null && people && days ? orgWh / people / days : null, metric: "energy" as const },
    { label: "Requests per day", you: myReq !== null && days ? myReq / days : null, avg: orgReq !== null && people && days ? orgReq / people / days : null, metric: "requests" as const },
  ].filter((r) => r.you !== null && r.avg !== null && r.avg > 0);
  return (
    <section className="dh-card" aria-labelledby="oo-compare">
      <h2 id="oo-compare" className="lg-display">
        How you compare
      </h2>
      <p className="dh-soft">Your figures against the organization's average per person.</p>
      {rows.length ? (
        <dl className="oo-compare">
          {rows.map((r) => {
            const diff = Math.round(((r.you! - r.avg!) / r.avg!) * 100);
            const max = Math.max(r.you!, r.avg!);
            const fmt = (v: number) => (r.metric === "requests" ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(v) : baseText("energy", v, 2));
            return (
              <div key={r.label} className="oo-compare-row">
                <dt>
                  <b>{r.label}</b>
                  <span className={`oo-badge${Math.abs(diff) <= 3 ? "" : " oo-badge-diff"}`}>{Math.abs(diff) <= 3 ? "About the same" : `${Math.abs(diff)}% ${diff > 0 ? "above" : "below"}`}</span>
                </dt>
                <dd>
                  <span>You</span>
                  <span className="oo-bar">
                    <span style={{ width: `${(r.you! / max) * 100}%` }} />
                  </span>
                  <b className="lg-num">{fmt(r.you!)}</b>
                </dd>
                <dd className="oo-avg">
                  <span>Organization average</span>
                  <span className="oo-bar">
                    <span style={{ width: `${(r.avg! / max) * 100}%` }} />
                  </span>
                  <span className="lg-num">{fmt(r.avg!)}</span>
                </dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <p className="dh-soft">The comparison needs your synced figures and the number of people, which the organization server has not shared for this period.</p>
      )}
    </section>
  );
}

function ByTool({ sites, metric, scenario }: { sites: Record<string, ServerSummary>; metric: Metric; scenario: DisplayScenario }) {
  const shown: Metric = metric;
  const rows = SITE_ORDER.flatMap((site) => {
    const f = orgFigures(sites[site], scenario);
    const v = f ? baseValue(f, shown) : null;
    return v ? [{ site, value: v }] : [];
  }).sort((a, b) => b.value - a.value);
  const total = rows.reduce((a, r) => a + r.value, 0);
  if (!rows.length) return null;
  return (
    <section className="dh-card" aria-labelledby="oo-tools">
      <h2 id="oo-tools" className="lg-display">
        By tool
      </h2>
      <table className="oo-tools">
        <caption className="lg-visually-hidden">Organization {METRIC_LABELS[shown].toLowerCase()} by tool</caption>
        <tbody>
          {rows.map((r) => (
            <tr key={r.site}>
              <th scope="row">{SITE_LABELS[r.site]}</th>
              <td className="oo-tools-bar">
                <span className="oo-track">
                  <span style={{ width: `${(r.value / rows[0]!.value) * 100}%`, background: `var(--lg-tool-${r.site})` }} />
                </span>
              </td>
              <td className="lg-num">{baseText(shown, r.value)}</td>
              <td className="lg-num dh-soft">{Math.round((r.value / total) * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
