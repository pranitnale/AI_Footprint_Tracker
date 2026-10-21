import type { DisplayScenario } from "@footprint/contracts";
import { addCalendarDays } from "@footprint/ui/dates";
import { Icon, type IconName } from "@footprint/ui/icons";
import { carDistance, LED_BULB_WATTS, ledDuration, spelledUnit, waterAmount } from "@footprint/ui/comparisons";
import { formatInteger } from "@footprint/ui/formatters";
import { LocalCard, SITE_LABELS, SITE_ORDER, shares } from "../ui/components";
import { addMonths, dashAxis, dashWindow, dayText, monthDays, monthName, monthOf, monthWindow, rangeText, todayIn, type DashWindow } from "../ui/dash-periods";
import { baseParts, baseText, baseValue, changeText, requestsPhrase, equivalentText, partFigures, partKeys, totalFigures, type Metric } from "../ui/figure-math";
import type { UsageFigures } from "../ui/usage-figures";
import type { Dashboard, UsageBreakdownView } from "../dashboard/types";
import { organizationName } from "../dashboard/organization";
import { breakdownKey, breakdownPending, breakdownRequest, useScoped } from "./data";
import { Donut, HeroBars, PaceChart, type BarPoint } from "./charts";
import type { PageContext } from "./Dashboard";

export const METRIC_LABELS: Record<Metric, string> = { energy: "Electricity", carbon: "Carbon", water: "Water", requests: "Requests" };
const METRIC_ICONS: Record<Metric, IconName> = { energy: "bolt", carbon: "cloud", water: "drop", requests: "message" };

/**
 * "Everything here was calculated on your computer", the last card of the overview and the About
 * card in Settings (canvas DetailsNew, owner decision of 17 October 2026). Connected to an
 * organization it says that only numbers are shared with it. On the overview it sits at the bottom
 * and links to the methodology, in Settings to the code (owner request of 21 October 2026).
 */
export function LocalSummaryCard({ dashboard, id, methodology = false }: { dashboard: Dashboard; id: string; methodology?: boolean }) {
  return dashboard.mode === "company" ? (
    <LocalCard
      id={id}
      layout="row"
      readCode="button"
      readMethodology={methodology}
      title="Calculated on your computer."
      text={`Only numbers are shared with ${organizationName(dashboard.company)}, never your chats.`}
    />
  ) : (
    <LocalCard
      id={id}
      layout="row"
      readCode="button"
      readMethodology={methodology}
      title="Everything here was calculated on your computer."
      text="Your history is stored in this browser only. Nothing is sent to us. The code is open source under the MIT License."
    />
  );
}

/** Fetches one breakdown for the current scope; null key skips it. */
export function useBreakdown(ctx: PageContext, window: { start?: string; end?: string; bucket: "hour" | "day" } | null) {
  const request = window ? breakdownRequest(window, ctx.dashboard.settings.timezone) : null;
  return useScoped<UsageBreakdownView>(
    request ? breakdownKey(request) : null,
    ctx.dashboard.scopeToken,
    ctx.revision,
    () => ctx.client.usageBreakdown(request!),
    ctx.rescope,
    breakdownPending,
  );
}

/** Long sentence under the hero figure (canvas: "About as much as a 10 W LED bulb uses in 104 hours."). */
export function longEquivalent(metric: Metric, value: number | null, f: UsageFigures, days: number | null) {
  if (value === null) return null;
  if (metric === "energy") {
    const d = ledDuration(value);
    if (d.value === "<1") return `About as much as an ${LED_BULB_WATTS} W LED bulb uses in under a minute.`;
    return `About as much as an ${LED_BULB_WATTS} W LED bulb uses in ${d.value} ${spelledUnit(d)}.`;
  }
  if (metric === "carbon") {
    const d = carDistance(value);
    return `About as much as driving a car for ${d.value} ${d.unit}.`;
  }
  if (metric === "water") {
    const d = waterAmount(value);
    if (d.value === "<1") return "About as much as under a tablespoon of water.";
    return `About as much as ${d.value} ${spelledUnit(d)} of water.`;
  }
  const wh = baseValue(f, "energy");
  const perDay = days ? value / days : null;
  const each = wh !== null && value > 0 ? baseText("energy", wh / value, 2) : null;
  const bits = [perDay !== null && days! > 1 ? `About ${formatInteger(Math.round(perDay))} a day` : null, each ? `${perDay !== null && days! > 1 ? "at about" : "About"} ${each} of electricity each` : null].filter(Boolean);
  return bits.length ? `${bits.join(", ")}.` : null;
}

/** Short line on each tile: "≈ 104 hours of LED light", "≈ 2.5 Wh of electricity each". */
function tileHint(metric: Metric, f: UsageFigures) {
  const value = baseValue(f, metric);
  if (metric === "requests") {
    const wh = baseValue(f, "energy");
    return wh !== null && value ? `≈ ${baseText("energy", wh / value, 2)} of electricity each` : null;
  }
  const eq = equivalentText(metric, value);
  return eq;
}

export function Tiles({ figures, metric, onPick, plain = false }: { figures: UsageFigures; metric?: Metric; onPick?: (m: Metric) => void; plain?: boolean }) {
  return (
    <div className="dh-tiles" role={onPick ? "group" : undefined} aria-label={onPick ? "Choose the figure shown above" : undefined}>
      {(["energy", "carbon", "water", "requests"] as const).map((m) => {
        const parts = baseParts(m, baseValue(figures, m));
        const body = (
          <>
            <span className={`dh-tile-label dh-ink-${m}`}>
              {!plain && (
                <span className={`dh-tile-icon dh-tint-${m}`} aria-hidden="true">
                  <Icon name={METRIC_ICONS[m]} size={16} />
                </span>
              )}
              {METRIC_LABELS[m]}
            </span>
            <span className="dh-tile-value">
              {parts ? (
                <>
                  <span className="lg-display lg-num">{parts.number}</span>
                  {m !== "requests" && <span className="dh-tile-unit">{parts.unit}</span>}
                </>
              ) : (
                <span className="lg-unknown">Not available</span>
              )}
            </span>
            {tileHint(m, figures) && <span className="dh-tile-hint">{tileHint(m, figures)}</span>}
          </>
        );
        return onPick ? (
          <button key={m} type="button" className="dh-tile" aria-pressed={metric === m} onClick={() => onPick(m)}>
            {body}
          </button>
        ) : (
          <div key={m} className="dh-tile">
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** Daily (or hourly) points for a window; all time folds into months once it is longer than two months. */
export function seriesPoints(view: UsageBreakdownView, window: DashWindow, metric: Metric, scenario: DisplayScenario, now: Date, timezone: string): { points: BarPoint[]; axis: string[]; highlight: number } {
  let keys = window.keys;
  if (!keys.length) {
    const found = partKeys(view, "buckets").sort();
    const today = todayIn(timezone, now);
    if (found.length) {
      keys = [];
      for (let day = found[0]!; day <= today; day = addCalendarDays(day, 1)) keys.push(day);
    }
  }
  const valueOf = (key: string) => {
    const f = partFigures(view, "buckets", key, scenario);
    return f ? baseValue(f, metric) : 0;
  };
  const requestsOf = (key: string) => {
    const f = partFigures(view, "buckets", key, scenario);
    return f?.requests ?? 0n;
  };
  if (window.bucket === "day" && keys.length > 62) {
    const months = [...new Set(keys.map(monthOf))];
    const points = months.map((month) => {
      const days = keys.filter((k) => monthOf(k) === month);
      const value = days.reduce((a, k) => a + (valueOf(k) ?? 0), 0);
      const req = days.reduce((a, k) => a + Number(requestsOf(k)), 0);
      return { key: month, value, label: `${monthName(month)} ${month.slice(0, 4)}`, detail: metric === "requests" ? undefined : requestsPhrase(req) };
    });
    return { points, axis: [points[0]!.label, points.at(-1)!.label], highlight: points.length - 1 };
  }
  const points = keys.map((key) => {
    const req = Number(requestsOf(key));
    const label = window.bucket === "hour" ? `${key}:00` : `${new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })} ${dayText(key, true)}`;
    return { key, value: valueOf(key), label, detail: metric === "requests" ? undefined : `${formatInteger(req)} ${req === 1 ? "request" : "requests"}` };
  });
  const hour = window.bucket === "hour" ? Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: timezone }).format(now)) : points.length - 1;
  return { points, axis: dashAxis(window, keys), highlight: hour };
}

/** Values per tool for the chosen figure; requests fall back to counts. */
export function toolValues(view: UsageBreakdownView, metric: Metric, scenario: DisplayScenario) {
  const rows = SITE_ORDER.flatMap((site) => {
    const f = partFigures(view, "sites", site, scenario);
    if (!f || !f.requests) return [];
    return [{ site, figures: f, value: baseValue(f, metric) ?? 0 }];
  });
  return rows.sort((a, b) => b.value - a.value);
}

export function Overview({ ctx }: { ctx: PageContext }) {
  const { dashboard, metric, setMetric, now } = ctx;
  const timezone = dashboard.settings.timezone;
  const scenario = dashboard.settings.displayScenario;
  const window = dashWindow(ctx.period, timezone, now);
  const today = todayIn(timezone, now);
  const thisMonth = monthOf(today);
  const monthW = dashWindow({ kind: "month" }, timezone, now);
  const prevMonthW = monthWindow(addMonths(thisMonth, -1), timezone);

  const current = useBreakdown(ctx, window);
  const previous = useBreakdown(ctx, window.previous ? { start: window.previous.start, end: window.previous.end, bucket: "day" } : null);
  const month = useBreakdown(ctx, ctx.period.kind === "month" ? null : monthW);
  const prevMonth = useBreakdown(ctx, prevMonthW);
  const monthView = ctx.period.kind === "month" ? current.data : month.data;

  if (!current.data)
    return current.error ? (
      <div className="dh-card dh-loading" role="alert">
        <p>Your figures could not be loaded.</p>
        <button type="button" className="lg-btn lg-btn-secondary" onClick={current.retry}>
          Try again
        </button>
      </div>
    ) : (
      <div className="dh-loading" role="status">
        Loading your figures
      </div>
    );

  const view = current.data;
  const figures = totalFigures(view, scenario);
  const value = baseValue(figures, metric);
  const prevValue = previous.data ? baseValue(totalFigures(previous.data, scenario), metric) : null;
  const change = window.previous ? changeText(value, prevValue, window.previous.phrase, ctx.period.kind === "today" ? window.previous.days : undefined) : null;
  const series = seriesPoints(view, window, metric, scenario, now, timezone);
  const parts = baseParts(metric, value);
  const days = window.keys.length && window.bucket === "day" ? window.keys.length : null;
  const tools = toolValues(view, metric, scenario);
  const toolShares = shares(Object.fromEntries(tools.map((t) => [t.site, t.value])));
  const pct = (site: string) => toolShares.find((s) => s.site === site)?.pct ?? 0;
  const notCounted = dashboard.health.filter((h) => h.code === "protocol_unsupported").reduce((a, h) => a + h.count, 0);
  const shareMetric: Metric = metric;

  return (
    <>
      <section className="dh-hero" aria-label={`${METRIC_LABELS[metric]} · ${window.phrase}`}>
        <div className="dh-hero-text">
          <span className="dh-hero-label">
            {METRIC_LABELS[metric]} · {window.phrase}
          </span>
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
          {longEquivalent(metric, value, figures, days) && <p className="dh-hero-eq">{longEquivalent(metric, value, figures, days)}</p>}
          {change && (
            <span className="dh-pill">
              {change.change !== 0 && <Icon name={change.up ? "arrowUp" : "arrowDown"} size={14} />}
              {change.text}
            </span>
          )}
        </div>
        <HeroBars points={series.points} metric={metric} highlight={series.highlight} axis={series.axis} />
      </section>

      <Tiles figures={figures} metric={metric} onPick={setMetric} />

      <div className="dh-two">
        <section className="dh-card" aria-labelledby="dh-where">
          <div className="dh-card-head">
            <h2 id="dh-where" className="lg-display">
              Where it comes from
            </h2>
            <span className="dh-soft">Share of {METRIC_LABELS[shareMetric].toLowerCase()}</span>
            <a href="#models" className="dh-link">
              All tools and models
            </a>
          </div>
          {tools.length ? (
            <div className="dh-where">
              <Donut
                parts={tools.map((t) => ({ key: t.site, value: t.value, color: `var(--lg-tool-${t.site})` }))}
                center={parts?.number ?? "0"}
                sub={`${metric === "requests" ? "requests" : parts?.unit ?? ""} · ${tools.length} ${tools.length === 1 ? "tool" : "tools"}`}
              />
              <table className="dh-where-table">
                <caption className="lg-visually-hidden">Share of {METRIC_LABELS[shareMetric].toLowerCase()} by tool</caption>
                <tbody>
                  {tools.map((t) => (
                    <tr key={t.site}>
                      <th scope="row">
                        <span className="lg-swatch" style={{ background: `var(--lg-tool-${t.site})` }} />
                        <b>{SITE_LABELS[t.site]}</b>
                        <span className="dh-soft">
                          {" "}
                          · {metric === "requests" ? baseText("energy", baseValue(t.figures, "energy")) : requestsPhrase(t.figures.requestsText)}
                        </span>
                      </th>
                      <td className="lg-num">{baseText(metric, t.value)}</td>
                      <td className="lg-num dh-soft">{pct(t.site)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="dh-soft">No tool has figures in this period yet.</p>
          )}
        </section>

        <MonthSoFar ctx={ctx} month={thisMonth} view={monthView} previous={prevMonth.data} metric={metric} />
      </div>

      <p className="dh-note">
        <Icon name="info" size={16} />
        <span>
          Estimates, not meter readings. Covers {requestsPhrase(figures.requestsText)} seen in this browser
          {notCounted ? `; ${formatInteger(notCounted)} ${notCounted === 1 ? "reply" : "replies"} could not be read` : ""}.
        </span>
        <a href="methodology.html" className="dh-link">
          How the estimate works
        </a>
      </p>
      <LocalSummaryCard dashboard={dashboard} id="dh-local" methodology />
    </>
  );
}

function MonthSoFar({ ctx, month, view, previous, metric }: { ctx: PageContext; month: string; view: UsageBreakdownView | null; previous: UsageBreakdownView | null; metric: Metric }) {
  const scenario = ctx.dashboard.settings.displayScenario;
  const today = todayIn(ctx.dashboard.settings.timezone, ctx.now);
  const before = addMonths(month, -1);
  const elapsed = Number(today.slice(8));
  const total = monthDays(month);
  const daily = (v: UsageBreakdownView | null, m: string, n: number) =>
    Array.from({ length: n }, (_, i) => {
      const f = v ? partFigures(v, "buckets", `${m}-${String(i + 1).padStart(2, "0")}`, scenario) : null;
      return f ? (baseValue(f, metric) ?? 0) : 0;
    });
  const current = daily(view, month, elapsed);
  const prev = daily(previous, before, monthDays(before));
  const sum = current.reduce((a, b) => a + b, 0);
  const prevSame = prev.slice(0, elapsed).reduce((a, b) => a + b, 0);
  const prevTotal = prev.reduce((a, b) => a + b, 0);
  const change = changeText(sum, prevSame, rangeText(`${before}-01`, `${before}-${String(Math.min(elapsed, prev.length)).padStart(2, "0")}`));
  const pace = elapsed ? (sum / elapsed) * total : 0;
  const parts = baseParts(metric, view ? sum : null);
  return (
    <section className="dh-card" aria-labelledby="dh-month">
      <div className="dh-card-head">
        <h2 id="dh-month" className="lg-display">
          {monthName(month)} so far
        </h2>
        <button type="button" className="dh-link dh-link-btn" onClick={() => ctx.go("recap", before)}>
          {monthName(before)} recap
        </button>
      </div>
      {view ? (
        <>
          <p className="dh-month-figure">
            <span className="lg-display lg-num">{parts?.number ?? "0"}</span> <span className="dh-month-unit">{parts?.unit ?? (metric === "requests" ? "requests" : "")}</span>
            <span className="dh-soft">
              {" "}
              in {elapsed} {elapsed === 1 ? "day" : "days"}
              {change ? ` · ${change.text}` : ""}
            </span>
          </p>
          <PaceChart current={current} previous={prev} daysInMonth={total} label={monthName(month)} previousLabel={monthName(before)} />
          <p className="dh-soft">
            At this pace {monthName(month)} ends near {baseText(metric, pace)}
            {previous ? `, against ${baseText(metric, prevTotal)} in ${monthName(before)}` : ""}.
          </p>
        </>
      ) : (
        <p className="dh-soft" role="status">
          Loading this month
        </p>
      )}
    </section>
  );
}
