import { useState } from "react";
import type { DisplayScenario } from "@footprint/contracts";
import { addCalendarDays } from "@footprint/ui/dates";
import { formatInteger } from "@footprint/ui/formatters";
import { Icon } from "@footprint/ui/icons";
import type { UsageBreakdownView } from "../dashboard/types";
import { Segmented, SITE_LABELS, SITE_ORDER, shares } from "../ui/components";
import { addMonths, dayText, monthDays, monthName, monthOf, monthWindow, todayIn } from "../ui/dash-periods";
import { zonedMidnight } from "@footprint/ui/dates";
import { baseParts, baseText, baseValue, changeText, requestsPhrase, partFigures, partKeys, totalFigures, type Metric } from "../ui/figure-math";
import { modelName } from "../ui/model-names";
import type { UsageFigures } from "../ui/usage-figures";
import { longEquivalent, METRIC_LABELS, useBreakdown } from "./Overview";
import { OrgUnavailable, orgFigures, orgUnused, useServerSummary, type OrgSummary } from "./OrgOverview";
import type { PageContext } from "./Dashboard";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAY_NAMES = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];

const weekday = (day: string) => (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
const shortDay = (day: string) => `${new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })} ${dayText(day, true)}`;

/** Five shades from light to dark by each day's share of the busiest day. */
function level(value: number, max: number) {
  if (!(value > 0) || !(max > 0)) return 0;
  return Math.min(4, 1 + Math.floor((value / max) * 4 - 1e-9));
}

/** The month a recap shows: the one named in the address, or else the last complete month. */
export function recapMonth(requested: string | null, today: string) {
  const current = monthOf(today);
  return requested && requested <= current ? requested : addMonths(current, -1);
}

/** Month picker for the page header (canvas DashRecap: "< September 2026 >"). */
export function RecapMonthNav({ month, today, go }: { month: string; today: string; go: PageContext["go"] }) {
  const before = addMonths(month, -1);
  const current = monthOf(today);
  return (
    <div className="rc-month" role="group" aria-label="Month">
      <button type="button" className="lg-btn lg-btn-secondary lg-btn-sm" aria-label={`${monthName(before)} ${before.slice(0, 4)}`} onClick={() => go("recap", before)}>
        <Icon name="chevronLeft" size={16} />
      </button>
      <b aria-live="polite">
        {monthName(month)} {month.slice(0, 4)}
      </b>
      <button
        type="button"
        className="lg-btn lg-btn-secondary lg-btn-sm"
        aria-label={`${monthName(addMonths(month, 1))} ${addMonths(month, 1).slice(0, 4)}`}
        disabled={month >= current}
        onClick={() => go("recap", addMonths(month, 1))}
      >
        <Icon name="chevronRight" size={16} />
      </button>
    </div>
  );
}

export function Recap({ ctx, month: requested, org = false }: { ctx: PageContext; month: string | null; org?: boolean }) {
  const timezone = ctx.dashboard.settings.timezone;
  const today = todayIn(timezone, ctx.now);
  const month = recapMonth(requested, today);
  const window = monthWindow(month, timezone);
  const previousWindow = monthWindow(addMonths(month, -1), timezone);
  return org ? <OrgRecap ctx={ctx} month={month} /> : <MyRecap ctx={ctx} month={month} window={window} previousWindow={previousWindow} today={today} />;
}

function MyRecap({ ctx, month, window, previousWindow, today }: { ctx: PageContext; month: string; window: ReturnType<typeof monthWindow>; previousWindow: ReturnType<typeof monthWindow>; today: string }) {
  const scenario = ctx.dashboard.settings.displayScenario;
  const [metric, setMetric] = useState<Metric>("energy");
  const [picked, setPicked] = useState<string | null>(null);
  const view = useBreakdown(ctx, window);
  const previous = useBreakdown(ctx, previousWindow);
  const before = addMonths(month, -1);
  const lastDay = month === monthOf(today) ? today : addCalendarDays(`${addMonths(month, 1)}-01`, -1);
  const dayKeys = window.keys.filter((k) => k <= lastDay);

  if (!view.data)
    return (
      <>
        {view.error ? (
          <div className="dh-card dh-loading" role="alert">
            <p>This month could not be loaded.</p>
            <button type="button" className="lg-btn lg-btn-secondary" onClick={view.retry}>
              Try again
            </button>
          </div>
        ) : (
          <div className="dh-loading" role="status">
            Loading {monthName(month)}
          </div>
        )}
      </>
    );

  const data = view.data;
  const total = totalFigures(data, scenario);
  const prevTotal = previous.data ? totalFigures(previous.data, scenario) : null;
  const value = (f: UsageFigures | null, m: Metric) => (f ? baseValue(f, m) : null);
  const dayValue = (key: string, m: Metric) => value(partFigures(data, "buckets", key, scenario), m) ?? 0;
  const values = dayKeys.map((k) => dayValue(k, metric));
  const max = Math.max(0, ...values);
  const used = dayKeys.filter((k) => dayValue(k, "requests") > 0);
  const busiest = used.length ? used.reduce((a, b) => (dayValue(b, "energy") > dayValue(a, "energy") ? b : a)) : null;
  const quietest = used.length ? used.reduce((a, b) => (dayValue(b, "energy") < dayValue(a, "energy") ? b : a)) : null;
  const selected = picked && dayKeys.includes(picked) ? picked : busiest;
  const sites = SITE_ORDER.flatMap((site) => {
    const f = partFigures(data, "sites", site, scenario);
    return f && f.requests ? [{ site, figures: f }] : [];
  }).sort((a, b) => (value(b.figures, "energy") ?? 0) - (value(a.figures, "energy") ?? 0));
  const models = partKeys(data, "models")
    .flatMap((id) => {
      const f = partFigures(data, "models", id, scenario);
      return f && f.requests ? [{ id, figures: f, per: (value(f, "energy") ?? 0) / Number(f.requests) }] : [];
    })
    .sort((a, b) => b.per - a.per);
  const parts = baseParts("energy", value(total, "energy"));
  const energyChange = changeText(value(total, "energy"), value(prevTotal, "energy"), monthName(before));
  const reqChange = changeText(value(total, "requests"), value(prevTotal, "requests"), monthName(before));
  const perReq = (f: UsageFigures | null) => {
    const wh = value(f, "energy");
    return f && wh !== null && f.requests ? wh / Number(f.requests) : null;
  };
  const weekdayAverages = WEEKDAYS.map((_, wd) => {
    const keys = dayKeys.filter((k) => weekday(k) === wd);
    return keys.length ? keys.reduce((a, k) => a + dayValue(k, metric), 0) / keys.length : 0;
  });
  const topWeekday = weekdayAverages.indexOf(Math.max(...weekdayAverages));
  const weekdayMax = Math.max(0, ...weekdayAverages);
  const lead = weekday(`${month}-01`);

  return (
    <>
      <section className="dh-hero rc-hero" aria-labelledby="rc-title">
        <div className="dh-hero-text">
          <span className="dh-hero-label">Electricity · {window.phrase}</span>
          <h2 id="rc-title" className="lg-display rc-title">
            Your {monthName(month)} in AI
          </h2>
          <div className="dh-hero-figure">
            <span className="dh-approx" aria-hidden="true">
              ≈
            </span>
            {parts ? (
              <>
                <span className="dh-hero-num lg-display lg-num rc-num">{parts.number}</span>
                <span className="dh-hero-unit lg-display dh-unit-energy">{parts.unit}</span>
              </>
            ) : (
              <span className="dh-hero-unknown">Not available</span>
            )}
          </div>
          <p className="dh-hero-eq">
            {(longEquivalent("energy", value(total, "energy"), total, null) ?? "").replace(/\.$/, "")}, across {requestsPhrase(total.requestsText)} in {sites.length} {sites.length === 1 ? "tool" : "tools"}.
          </p>
          {energyChange && (
            <span className="dh-pill">
              {energyChange.change !== 0 && <Icon name={energyChange.up ? "arrowUp" : "arrowDown"} size={14} />}
              {energyChange.text.replace("more than", "more than").replace("less than", "less than")}
            </span>
          )}
        </div>
        <div className="rc-side">
          {(["carbon", "water", "requests"] as const).map((m) => {
            const p = baseParts(m, value(total, m));
            const sub =
              m === "requests"
                ? [reqChange ? reqChange.text.replace("more than", "more than").replace("less than", "fewer than").replace(/^Same as/, "Same as") : null, perReq(total) !== null ? `≈ ${baseText("energy", perReq(total), 2)} each` : null].filter(Boolean).join(" · ")
                : longEquivalent(m, value(total, m), total, null)?.replace(/^About as much as /, "≈ ").replace(/\.$/, "");
            return (
              <div key={m} className="rc-side-card">
                <span>{METRIC_LABELS[m]}</span>
                <b className="lg-display lg-num">
                  {p?.number ?? "Not available"}
                  {m !== "requests" && p && <small> {p.unit}</small>}
                </b>
                {sub && <small>{sub}</small>}
              </div>
            );
          })}
        </div>
      </section>

      <section className="dh-card rc-days" aria-labelledby="rc-every">
        <div className="rc-days-main">
          <h2 id="rc-every" className="lg-display">
            Every day of {monthName(month)}
          </h2>
          <p className="dh-soft">Click a day to see what happened.</p>
          <Segmented
            label="Figure on the calendar"
            options={(["energy", "carbon", "water", "requests"] as const).map((m) => ({ value: m, label: METRIC_LABELS[m] }))}
            value={metric}
            onChange={setMetric}
          />
          <div className="rc-cal" role="grid" aria-label={`${monthName(month)} by day`}>
            {WEEKDAYS.map((d) => (
              <span key={d} className="rc-wd" aria-hidden="true">
                {d}
              </span>
            ))}
            {Array.from({ length: lead }, (_, i) => (
              <span key={`lead-${i}`} aria-hidden="true" />
            ))}
            {window.keys.map((key) => {
              const future = key > lastDay;
              const v = future ? 0 : dayValue(key, metric);
              return (
                <button
                  key={key}
                  type="button"
                  className={`rc-day rc-l${future ? 0 : level(v, max)}`}
                  aria-pressed={selected === key}
                  disabled={future}
                  aria-label={`${longDay(key)} ${dayText(key)}: ${future ? "still to come" : baseText(metric, v)}`}
                  onClick={() => setPicked(key)}
                >
                  <b>{Number(key.slice(8))}</b>
                  {!future && <span>{baseText(metric, v, 2).replace(" requests", "")}</span>}
                </button>
              );
            })}
          </div>
          <div className="rc-weekdays" aria-label="Average per weekday">
            {weekdayAverages.map((avg, wd) => (
              <div key={wd} className="rc-weekday">
                <small>{baseText(metric, avg, 2)}</small>
                <span className={`rc-l${level(avg, weekdayMax)}`} style={{ height: `${weekdayMax ? Math.max(4, (avg / weekdayMax) * 26) : 4}px` }} />
              </div>
            ))}
          </div>
          <p className="dh-soft">
            Average per weekday{weekdayMax > 0 ? `: ${WEEKDAY_NAMES[topWeekday]} are the highest at ${baseText(metric, weekdayMax, 2)}.` : "."}
          </p>
          <p className="rc-scale dh-soft" aria-hidden="true">
            Less {[0, 1, 2, 3, 4].map((l) => <span key={l} className={`rc-l${l}`} />)} More
          </p>
        </div>
        {selected && <DayPanel ctx={ctx} day={selected} busiest={selected === busiest} data={data} scenario={scenario} dayKeys={dayKeys} />}
      </section>

      {busiest && quietest && (
        <div className="rc-highlights">
          {sites[0] && (
            <div className="dh-card">
              <small>Top tool</small>
              <b className="lg-display">{SITE_LABELS[sites[0].site]}</b>
              <p className="dh-soft">
                {shares(Object.fromEntries(sites.map((s) => [s.site, value(s.figures, "energy") ?? 0]))).find((s) => s.site === sites[0]!.site)?.pct ?? 0}% of your electricity, {requestsPhrase(sites[0].figures.requestsText)}
              </p>
            </div>
          )}
          {models[0] && (
            <div className="dh-card">
              <small>Heaviest model</small>
              <b className="lg-display">{modelName(models[0].id)}</b>
              <p className="dh-soft">{baseText("energy", models[0].per, 2)} per request, the most of any model</p>
            </div>
          )}
          <div className="dh-card">
            <small>Busiest day</small>
            <b className="lg-display">{shortDay(busiest)}</b>
            <p className="dh-soft">
              {baseText("energy", dayValue(busiest, "energy"))} in {requestsPhrase(dayValue(busiest, "requests"))}
            </p>
          </div>
          <div className="dh-card">
            <small>Quietest day</small>
            <b className="lg-display">{shortDay(quietest)}</b>
            <p className="dh-soft">
              {baseText("energy", dayValue(quietest, "energy"))}. You used AI on {used.length === dayKeys.length ? `all ${dayKeys.length}` : `${used.length} of ${dayKeys.length}`} days.
            </p>
          </div>
        </div>
      )}

      {previous.data && prevTotal && (
        <Changes month={month} data={data} previous={previous.data} total={total} prevTotal={prevTotal} scenario={scenario} />
      )}

      <p className="dh-note">
        <Icon name="info" size={16} />
        <span>
          Estimates, not meter readings. Covers {requestsPhrase(total.requestsText)} seen in this browser in {monthName(month)}.
        </span>
        <a href="methodology.html" className="dh-link">
          How the estimate works
        </a>
      </p>
    </>
  );
}

function DayPanel({ ctx, day, busiest, data, scenario, dayKeys }: { ctx: PageContext; day: string; busiest: boolean; data: UsageBreakdownView; scenario: DisplayScenario; dayKeys: string[] }) {
  const timezone = ctx.dashboard.settings.timezone;
  const detail = useBreakdown(ctx, { start: zonedMidnight(day, timezone), end: zonedMidnight(addCalendarDays(day, 1), timezone), bucket: "day" });
  const f = partFigures(data, "buckets", day, scenario);
  const energy = f ? baseValue(f, "energy") : null;
  const used = dayKeys.map((k) => partFigures(data, "buckets", k, scenario)).filter((x): x is UsageFigures => !!x && !!x.requests);
  const average = used.length ? used.reduce((a, x) => a + (baseValue(x, "energy") ?? 0), 0) / dayKeys.length : null;
  const change = energy !== null && average ? changeText(energy, average, `your daily average of ${baseText("energy", average, 2)}`) : null;
  const tools = detail.data
    ? SITE_ORDER.flatMap((site) => {
        const t = partFigures(detail.data!, "sites", site, scenario);
        const v = t ? baseValue(t, "energy") : null;
        return v ? [{ site, value: v }] : [];
      }).sort((a, b) => b.value - a.value)
    : [];
  const pct = shares(Object.fromEntries(tools.map((t) => [t.site, t.value])));
  return (
    <aside className="rc-panel" aria-live="polite" aria-label={`${longDay(day)} ${dayText(day)}`}>
      <div className="rc-panel-head">
        <div>
          <small>{longDay(day)}</small>
          <b className="lg-display">{dayText(day)}</b>
        </div>
        {busiest && <span className="rc-badge">Busiest day</span>}
      </div>
      <div className="rc-panel-grid">
        {(["energy", "requests", "carbon", "water"] as const).map((m) => {
          const p = f ? baseParts(m, baseValue(f, m)) : null;
          return (
            <div key={m}>
              <small className={`dh-ink-${m}`}>{METRIC_LABELS[m]}</small>
              <b className="lg-display lg-num">
                {p?.number ?? "0"}
                {m !== "requests" && p && <small> {p.unit}</small>}
              </b>
            </div>
          );
        })}
      </div>
      {change && <p>{change.text.replace("more than", "above").replace("less than", "below")}.</p>}
      {tools.length > 0 && (
        <>
          <small className="rc-panel-label">By tool</small>
          <div className="lg-share" aria-hidden="true">
            {pct.map((p) => (
              <span key={p.site} style={{ width: `${p.pct}%`, background: `var(--lg-tool-${p.site})` }} />
            ))}
          </div>
          <ul className="rc-panel-tools">
            {tools.map((t) => (
              <li key={t.site}>
                <span>
                  <span className="lg-swatch" style={{ background: `var(--lg-tool-${t.site})` }} /> {SITE_LABELS[t.site]}
                </span>
                <span className="lg-num">
                  <b>{baseText("energy", t.value)}</b> · {pct.find((p) => p.site === t.site)?.pct ?? 0}%
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {f && energy !== null && f.requests ? <small className="dh-soft">≈ {baseText("energy", energy / Number(f.requests), 2)} per request</small> : null}
    </aside>
  );
}

function Changes({ month, data, previous, total, prevTotal, scenario }: { month: string; data: UsageBreakdownView; previous: UsageBreakdownView; total: UsageFigures; prevTotal: UsageFigures; scenario: DisplayScenario }) {
  const before = addMonths(month, -1);
  const rows = SITE_ORDER.flatMap((site) => {
    const now = partFigures(data, "sites", site, scenario);
    const then = partFigures(previous, "sites", site, scenario);
    const a = now ? (baseValue(now, "energy") ?? 0) : 0;
    const b = then ? (baseValue(then, "energy") ?? 0) : 0;
    return a || b ? [{ site, now: a, then: b }] : [];
  }).sort((x, y) => y.now - x.now);
  // Bars stop at three quarters of the row so the value beside the longest one never meets the change badge.
  const max = Math.max(1, ...rows.flatMap((r) => [r.now, r.then])) / 0.75;
  const delta = rows.map((r) => ({ ...r, diff: r.now - r.then })).sort((x, y) => x.diff - y.diff);
  const drop = (baseValue(total, "energy") ?? 0) < (baseValue(prevTotal, "energy") ?? 0);
  const movers = (drop ? delta.filter((d) => d.diff < 0) : [...delta].reverse().filter((d) => d.diff > 0)).slice(0, 2);
  const newTools = rows.filter((r) => r.then === 0 && r.now > 0).map((r) => SITE_LABELS[r.site]!);
  const newModels = partKeys(data, "models").filter((id) => !partKeys(previous, "models").includes(id));
  const per = (f: UsageFigures) => {
    const wh = baseValue(f, "energy");
    return wh !== null && f.requests ? wh / Number(f.requests) : null;
  };
  const stat = (label: string, a: number | null, b: number | null, fmt: (v: number) => string) => {
    const c = a !== null && b !== null && b > 0 ? Math.round(((a - b) / b) * 100) : null;
    return (
      <div className="rc-stat">
        <small>{label}</small>
        <span>
          <span className="dh-soft">{b !== null ? fmt(b) : "Not available"} →</span> <b className="lg-num">{a !== null ? fmt(a) : "Not available"}</b>
        </span>
        {c !== null && c !== 0 && (
          <small className={c > 0 ? "rc-up" : "rc-down"}>
            <Icon name={c > 0 ? "arrowUp" : "arrowDown"} size={12} />
            {Math.abs(c)}%
          </small>
        )}
      </div>
    );
  };
  return (
    <section className="dh-card rc-changes" aria-labelledby="rc-changed">
      <div>
        <h2 id="rc-changed" className="lg-display">
          What changed since {monthName(before)}
        </h2>
        <p className="dh-soft">
          Electricity by tool. Light bars are {monthName(before)}, coloured bars {monthName(month)}.
        </p>
        <ul className="rc-compare">
          {rows.map((r) => {
            const c = r.then ? Math.round(((r.now - r.then) / r.then) * 100) : null;
            return (
              <li key={r.site}>
                <span className="rc-compare-name">
                  <span className="lg-swatch" style={{ background: `var(--lg-tool-${r.site})` }} /> {SITE_LABELS[r.site]}
                </span>
                <span className="rc-compare-bars">
                  {r.then ? (
                    <span className="rc-bar rc-bar-then" style={{ width: `${(r.then / max) * 100}%` }}>
                      <small>{baseText("energy", r.then)}</small>
                    </span>
                  ) : (
                    <small className="dh-soft">not used</small>
                  )}
                  {r.now ? (
                    <span className="rc-bar" style={{ width: `${(r.now / max) * 100}%`, background: `var(--lg-tool-${r.site})` }}>
                      <b>{baseText("energy", r.now)}</b>
                    </span>
                  ) : (
                    <small className="dh-soft">not used</small>
                  )}
                </span>
                <span className={`rc-change${c === null ? " rc-change-new" : c > 0 ? " rc-change-up" : ""}`}>
                  {c === null ? "New" : c === 0 ? "Same" : (
                    <>
                      <Icon name={c > 0 ? "arrowUp" : "arrowDown"} size={12} />
                      {Math.abs(c)}%
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="rc-changes-side">
        <div className="rc-stats">
          {stat("Electricity", baseValue(total, "energy"), baseValue(prevTotal, "energy"), (v) => baseText("energy", v))}
          {stat("Requests", baseValue(total, "requests"), baseValue(prevTotal, "requests"), (v) => formatInteger(Math.round(v)))}
          {stat("Per request", per(total), per(prevTotal), (v) => baseText("energy", v, 2))}
        </div>
        {movers.length > 0 && (
          <div className="rc-insight">
            <b>
              Most of the {drop ? "drop" : "rise"} came from {movers.map((m) => SITE_LABELS[m.site]).join(" and ")}
            </b>
            <p>
              Together they used {baseText("energy", Math.abs(movers.reduce((a, m) => a + m.diff, 0)))} {drop ? "less" : "more"} than in {monthName(before)}.
            </p>
          </div>
        )}
        {(newTools.length > 0 || newModels.length > 0) && (
          <>
            <small className="rc-panel-label">New this month</small>
            <p className="rc-new">
              {[...newTools, ...newModels.map(modelName)].map((n) => (
                <span key={n}>{n}</span>
              ))}
            </p>
          </>
        )}
      </div>
    </section>
  );
}

function OrgRecap({ ctx, month }: { ctx: PageContext; month: string }) {
  const timezone = ctx.dashboard.settings.timezone;
  const scenario = ctx.dashboard.settings.displayScenario;
  const before = addMonths(month, -1);
  const company = useServerSummary(ctx, "company", monthWindow(month, timezone));
  const previous = useServerSummary(ctx, "company", monthWindow(before, timezone), true);
  const mine = useServerSummary(ctx, "my", monthWindow(month, timezone));
  const summary: OrgSummary | null = company.data;
  if (!summary)
    return (
      <>
        {company.error ? (
          <OrgUnavailable summary={null} onRetry={company.retry} />
        ) : (
          <div className="dh-loading" role="status">
            Loading organization figures
          </div>
        )}
      </>
    );
  if (summary.suppressed || summary.aggregate_status !== "current")
    return (
      <>
        <OrgUnavailable summary={summary} onRetry={company.retry} />
      </>
    );
  const total = orgFigures(summary, scenario)!;
  if (orgUnused(summary, total)) return <OrgUnavailable summary={summary} onRetry={company.retry} empty />;
  const prev = previous.data && !previous.data.suppressed ? orgFigures(previous.data, scenario) : null;
  const own = mine.data && !mine.data.suppressed ? orgFigures(mine.data, scenario) : null;
  const wh = baseValue(total, "energy");
  const change = changeText(wh, prev ? baseValue(prev, "energy") : null, monthName(before));
  const parts = baseParts("energy", wh);
  const myWh = own ? baseValue(own, "energy") : null;
  const days = summary.days;
  const keys = Array.from({ length: monthDays(month) }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  const dayValues = days ? keys.map((k) => (orgFigures(days[k], scenario) ? (baseValue(orgFigures(days[k], scenario)!, "energy") ?? 0) : 0)) : [];
  const max = Math.max(0, ...dayValues);
  return (
    <>
      <section className="dh-hero rc-hero" aria-labelledby="rc-org-title">
        <div className="dh-hero-text">
          <span className="dh-hero-label">Electricity · {monthName(month)}</span>
          <h2 id="rc-org-title" className="lg-display rc-title">
            Your organization's {monthName(month)} in AI
          </h2>
          <div className="dh-hero-figure">
            <span className="dh-approx" aria-hidden="true">
              ≈
            </span>
            <span className="dh-hero-num lg-display lg-num rc-num">{parts?.number ?? "Not available"}</span>
            {parts && <span className="dh-hero-unit lg-display dh-unit-energy">{parts.unit}</span>}
          </div>
          <p className="dh-hero-eq">
            Across {requestsPhrase(total.requestsText)}{myWh !== null && wh ? `. Your part: ${baseText("energy", myWh)}, ${Math.round((myWh / wh) * 100)}%.` : "."}
          </p>
          {change && (
            <span className="dh-pill">
              {change.change !== 0 && <Icon name={change.up ? "arrowUp" : "arrowDown"} size={14} />}
              {change.text}
            </span>
          )}
        </div>
      </section>
      {days ? (
        <section className="dh-card" aria-labelledby="rc-org-days">
          <h2 id="rc-org-days" className="lg-display">
            Every day of {monthName(month)}
          </h2>
          <div className="rc-cal" role="grid" aria-label={`${monthName(month)} by day`}>
            {WEEKDAYS.map((d) => (
              <span key={d} className="rc-wd" aria-hidden="true">
                {d}
              </span>
            ))}
            {Array.from({ length: weekday(`${month}-01`) }, (_, i) => (
              <span key={`lead-${i}`} aria-hidden="true" />
            ))}
            {keys.map((k, i) => (
              <span key={k} className={`rc-day rc-l${level(dayValues[i]!, max)}`} role="gridcell" aria-label={`${dayText(k)}: ${baseText("energy", dayValues[i]!)}`}>
                <b>{Number(k.slice(8))}</b>
                <span>{baseText("energy", dayValues[i]!, 2)}</span>
              </span>
            ))}
          </div>
        </section>
      ) : null}
      <p className="dh-note">
        <Icon name="shield" size={16} />
        <span>Totals only. No one sees your chats, and your own figures are shown only to you.</span>
      </p>
    </>
  );
}
