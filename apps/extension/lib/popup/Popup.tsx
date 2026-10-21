import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_DISPLAY_SCENARIO, type DisplayScenario } from "@footprint/contracts";
import { Icon, LivingGaugeMark, PUBLIC_WEBSITE } from "@footprint/ui/icons";
import { carbonEquivalent, energyEquivalent, toGrams, toMillilitres, toWh, waterEquivalent } from "@footprint/ui/comparisons";
import { formatInteger, formatMetric } from "@footprint/ui/formatters";
import { createDashboardClient, runtimeTransport, type Transport } from "../dashboard/client";
import type { Dashboard, ServerSummary, UsageBreakdownView } from "../dashboard/types";
import { connectionEndedText, isHostedOrigin, organizationName } from "../dashboard/organization";
import { buildUsageFilters, cachedOnlyQuery, totalsOnlyQuery } from "../ui-model";
import { usageFigures, type UsageFigures } from "../ui/usage-figures";
import { peopleOf } from "../ui/figure-math";
import { axisLabels, periodWindow, PERIOD_LABELS, type PeriodWindow, type PopupPeriod } from "../ui/periods";
import {
  Bars,
  Credit,
  FigureParts,
  LocalCard,
  ResourceTiles,
  ScenarioChip,
  Segmented,
  StatusLine,
  ToolShare,
  ageText,
  figureText,
  shares,
  RESOURCE_LABELS,
  SITE_LABELS,
  SITE_ORDER,
  type Resource,
} from "../ui/components";
import { readPreference, writePreference } from "../ui/preferences";
import { earlyView, readLastView, reusableView, writeLastView, type SavedView } from "./last-view";
import type { Settings } from "../dashboard/types";
import { consentRequired } from "../tracking-consent";
import { ownReadSettings } from "../own-read-settings";
import { FULL_HISTORY_LABEL, TAKE_TOUR_LABEL } from "../welcome/copy";
import { openExtensionPage, openWelcomePage, reloadActiveProviderTab, activeProviderTab, providerTabCapture, type TabCapture } from "../ui/navigation";

type Scope = "me" | "org";
type PersonalData = {
  window: PeriodWindow;
  current: UsageBreakdownView;
  previous: UsageBreakdownView;
  /**
   * A saved copy from an earlier popup, shown with an Updating note until the fresh figures
   * replace it. It may lag the newest records; it is removed if the refresh fails.
   */
  updating?: boolean;
};
type OrgData = {
  window: PeriodWindow;
  company: ServerSummary;
  previous: ServerSummary | null;
  mine: ServerSummary | null;
  /** The person's own summary is still being read, so the share is not known yet. */
  mineLoading?: boolean;
  /** The person's own summary is this browser's saved copy, shown until the fresh one arrives. */
  mineCached?: boolean;
  /**
   * The figures are this browser's last saved copy of the same organization summary, shown while
   * the fresh one loads. They are replaced by the fresh answer and removed if it fails.
   */
  cached?: boolean;
};

/** The organization summary query for a calendar window of the popup. */
function orgQuery(start: string, end: string, timezone: string, now: Date) {
  return buildUsageFilters(
    {
      period: "custom",
      start,
      end,
      site: "",
      model: "",
      calculationView: "selected",
      methodId: "",
    },
    timezone,
    now,
    "company",
  ).query;
}

const systemClock = () => new Date();

function wh(f: UsageFigures, resource: Resource): number | null {
  const figure = f[resource];
  return resource === "energy"
    ? toWh(figure.value, figure.unit)
    : resource === "carbon"
      ? toGrams(figure.value, figure.unit)
      : toMillilitres(figure.value, figure.unit);
}

function equivalent(f: UsageFigures, resource: Resource) {
  const v = wh(f, resource);
  if (v === null) return null;
  return resource === "energy" ? energyEquivalent(v) : resource === "carbon" ? carbonEquivalent(v) : waterEquivalent(v);
}

/** "12% less than the 30 days before"; null when there is nothing to compare with. */
function comparison(current: number | null, previous: number | null, window: PeriodWindow) {
  if (current === null || previous === null || !(previous > 0)) return null;
  const base = window.period === "today" ? previous / window.previous.days : previous;
  if (!(base > 0)) return null;
  const change = Math.round(((current - base) / base) * 100);
  const against = window.period === "today" ? "your daily average" : `the ${PERIOD_LABELS[window.period]} before`;
  if (change === 0)
    return {
      up: false,
      text: window.period === "today" ? "Same as your daily average" : `Same as ${against}`,
    };
  if (window.period === "today")
    return {
      up: change > 0,
      text: `${Math.abs(change)}% ${change > 0 ? "above" : "below"} ${against}`,
    };
  return {
    up: change > 0,
    text: `${Math.abs(change)}% ${change > 0 ? "more" : "less"} than ${against}`,
  };
}

function bucketFigures(view: UsageBreakdownView, key: string, scenario: DisplayScenario) {
  const live = view.buckets[key] ?? null;
  const saved = view.history?.buckets[key] ?? (view.history ? null : undefined);
  if (!live && !saved) return null;
  return usageFigures(live ?? emptyLike(view), saved ?? null, scenario);
}

/** A zero bucket shaped like the totals, for days that only have saved history. */
function emptyLike(view: UsageBreakdownView) {
  const zero = { value: null, known: 0, unknown: 0, groups: [] };
  return {
    requests: 0,
    attempts: 0,
    tokens: Object.fromEntries(Object.keys(view.total.tokens).map((k) => [k, { ...zero, partial: 0, notApplicable: 0 }])),
    metrics: {
      energy: zero,
      carbon: zero,
      waterDirect: zero,
      waterUpstream: zero,
      water: zero,
    },
    tools: {},
    models: [],
  } as unknown as UsageBreakdownView["total"];
}

export default function Popup({
  transport = runtimeTransport,
  clock = systemClock,
  // A test or preview transport has no session of its own to reuse.
  keepLastView = transport === runtimeTransport,
}: {
  transport?: Transport;
  clock?: () => Date;
  keepLastView?: boolean;
}) {
  const client = useMemo(() => createDashboardClient(transport), [transport]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [scope, setScopeState] = useState<Scope>("me");
  const [period, setPeriodState] = useState<PopupPeriod>("30d");
  const [metric, setMetricState] = useState<Resource>("energy");
  const [personal, setPersonal] = useState<PersonalData | null>(null);
  // A saved copy shown before the dashboard arrived, with the settings the quick check returned.
  const [early, setEarly] = useState<{ view: SavedView; settings: Settings } | null>(null);
  // The saved period is read before the first load, so a saved copy of another period never flashes.
  const [preferencesRead, setPreferencesRead] = useState(false);
  const [org, setOrg] = useState<OrgData | null>(null);
  const [orgError, setOrgError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Me and Organization update separately: the organization summary can take seconds after the
  // person's own figures are final, and must not keep the Me view updating.
  const [busy, setBusy] = useState(false);
  const [orgBusy, setOrgBusy] = useState(false);
  const [providerTab, setProviderTab] = useState<{
    id: number;
    site: string;
  } | null>(null);
  const [tabCapture, setTabCapture] = useState<TabCapture>({ state: "unknown" });
  const epoch = useRef(0);
  const [pausedAt, setPausedAt] = useState<number | null>(null);

  useEffect(() => {
    void readPreference("popup")
      .then((saved) => {
        if (saved?.period === "today" || saved?.period === "7d" || saved?.period === "30d") setPeriodState(saved.period);
        if (saved?.metric === "energy" || saved?.metric === "carbon" || saved?.metric === "water") setMetricState(saved.metric);
      })
      .catch(() => {})
      .finally(() => setPreferencesRead(true));
    void activeProviderTab().then((tab) => {
      setProviderTab(tab);
      if (tab) void providerTabCapture(tab.id).then(setTabCapture);
    });
    void readPreference("paused").then((saved) => setPausedAt(typeof saved?.at === "number" ? saved.at : null));
  }, []);

  // The popup no longer remembers its scope (owner, 14 Oct 2026), so a scope saved by an earlier
  // version is dropped on the next write instead of being carried along.
  const remember = (next: Partial<{ period: PopupPeriod; metric: Resource }>) =>
    void readPreference("popup").then((saved) => {
      const { scope: _obsolete, ...kept } = saved ?? {};
      return writePreference("popup", { ...kept, ...next });
    });
  // The popup always opens on the person's own figures; Organization is one click away and is
  // not remembered (owner, 14 Oct 2026).
  const setScope = (value: Scope) => setScopeState(value);
  const setPeriod = (value: PopupPeriod) => {
    setPeriodState(value);
    remember({ period: value });
  };
  const setMetric = (value: Resource) => {
    setMetricState(value);
    remember({ metric: value });
  };

  const load = useCallback(async () => {
    const run = ++epoch.current;
    setBusy(true);
    setError(null);
    // Set once the fresh organization answer arrived or failed; a saved copy read later is dropped.
    let orgSettled = false;
    let orgQueries: { current: string; previous: string; mine: string } | null = null;
    try {
      const dashboardRead = client.dashboard({});
      dashboardRead.catch(() => {});
      const saved = keepLastView ? await readLastView(period) : null;
      if (saved) {
        // The saved copy of this period shows as soon as the quick check confirms its data scope
        // (erasures change it) and settings, before the dashboard reads the records (owner
        // decision of 16 October 2026). It carries an Updating note until fresh figures arrive.
        const token = await client.viewToken().catch(() => null);
        const shown = earlyView(saved, token);
        if (run !== epoch.current) return;
        if (shown && token) {
          setEarly({ view: shown, settings: token.settings });
          setPersonal((current) =>
            current && !current.updating && current.window.period === period && current.current.scopeToken === token.scopeToken
              ? current
              : { window: shown.window, current: shown.current, previous: shown.previous, updating: true },
          );
        }
      }
      const next = await dashboardRead;
      if (run !== epoch.current) return;
      setDashboard(next);
      setEarly(null);
      const timezone = next.settings.timezone;
      const window = periodWindow(period, timezone, clock());
      // Fresh figures of this period stay until replaced. A saved copy stays only for the same
      // scope, settings and calculation; it is current when nothing was recorded since, and
      // otherwise keeps its Updating note until the fresh figures below replace it.
      const reuse = reusableView(saved, next, window);
      setPersonal((current) =>
        current && !current.updating && current.window.period === period && current.current.scopeToken === next.scopeToken
          ? current
          : reuse
            ? { ...reuse.view, updating: !reuse.confirmed }
            : null,
      );
      // The organization queries are fixed once, so the saved copy and the fresh answer are read
      // for exactly the same windows. The popup reads totals only: it draws no organization
      // charts, and the day, tool and model splits make the answer many times larger and slower.
      const month = periodWindow("30d", timezone, clock());
      orgQueries =
        next.mode === "company"
          ? {
              current: totalsOnlyQuery(orgQuery(month.startDate, month.endDate, timezone, clock())),
              previous: totalsOnlyQuery(orgQuery(month.previous.startDate, month.previous.endDate, timezone, clock())),
              mine: orgQuery(month.startDate, month.endDate, timezone, clock()),
            }
          : null;
      if (orgQueries)
        // The last saved organization figures and the person's share show at once, marked with
        // their age, until the fresh answers below replace them. A saved copy never replaces
        // fresh figures already shown.
        void Promise.all([
          client.serverSummary("company", cachedOnlyQuery(orgQueries.current)),
          client.serverSummary("company", cachedOnlyQuery(orgQueries.previous)).catch(() => null),
          client.serverSummary("my", cachedOnlyQuery(orgQueries.mine)).catch(() => null),
        ]).then(
          ([company, before, mine]) => {
            if (run !== epoch.current || orgSettled || company.scopeToken !== next.scopeToken) return;
            const savedMine = mine && mine.scopeToken === next.scopeToken ? mine : null;
            setOrg((current) =>
              current && !current.cached && current.company.scopeToken === next.scopeToken
                ? current
                : {
                    window: month,
                    company,
                    previous: before && before.scopeToken === next.scopeToken ? before : null,
                    mine: savedMine,
                    mineLoading: !savedMine,
                    mineCached: !!savedMine,
                    cached: true,
                  },
            );
          },
          () => {
            /* nothing saved for this query: the fresh answer is awaited as before */
          },
        );
      const [current, previous] = await Promise.all([
        client.usageBreakdown({
          start: window.start,
          end: window.end,
          bucket: window.bucket,
          timezone,
        }),
        client.usageBreakdown({
          start: window.previous.start,
          end: window.previous.end,
          bucket: "day",
          timezone,
        }),
      ]);
      if (run !== epoch.current) return;
      // A reply from another data scope (a connect or disconnect in between) must never be shown.
      if (current.scopeToken !== next.scopeToken || previous.scopeToken !== next.scopeToken) throw new Error("scope_changed");
      setPersonal({ window, current, previous });
      if (keepLastView) void writeLastView(next, { window, current, previous });
      setBusy(false);
      if (orgQueries) {
        setOrgBusy(true);
        try {
          const mineRead = client.serverSummary("my", orgQueries.mine).catch(() => null);
          const [company, before] = await Promise.all([
            client.serverSummary("company", orgQueries.current),
            client.serverSummary("company", orgQueries.previous).catch(() => null),
          ]);
          if (run !== epoch.current) return;
          if (company.scopeToken !== next.scopeToken) throw new Error("scope_changed");
          orgSettled = true;
          // The organization's figures show as soon as its totals arrive. The person's own summary
          // took 6 to 20 s on 15 October 2026 against under 2 s for the totals, and only adds the
          // share, so it follows; a share read earlier in this scope stays until then.
          setOrg((shown) => {
            const kept = shown && shown.company.scopeToken === next.scopeToken ? shown.mine : null;
            return { window: month, company, previous: before, mine: kept, mineLoading: !kept, mineCached: !!kept && !!shown?.mineCached };
          });
          setOrgError(null);
          const mine = await mineRead;
          if (run !== epoch.current) return;
          setOrg((shown) => (shown && shown.company === company ? { ...shown, mine, mineLoading: false, mineCached: false } : shown));
        } catch (caught) {
          if (run === epoch.current) {
            orgSettled = true;
            // A saved copy is never left to look current after the fresh answer failed.
            setOrg((shown) => (shown?.cached ? null : shown));
            setOrgError(caught instanceof Error ? caught.message : "organization_unavailable");
          }
        }
      } else setOrg(null);
    } catch (caught) {
      if (run === epoch.current) {
        setError(caught instanceof Error ? caught.message : "load_failed");
        // A saved copy is never left to look current after the refresh failed.
        setPersonal((shown) => (shown?.updating ? null : shown));
        setEarly(null);
      }
    } finally {
      if (run === epoch.current) {
        setBusy(false);
        setOrgBusy(false);
        // The load stopped before the fresh organization answer (the person's own figures failed):
        // a saved copy shown meanwhile goes, and the Organization view offers Try again, as it
        // does when the organization answer itself fails.
        if (orgQueries && !orgSettled) {
          orgSettled = true;
          setOrg((shown) => (shown?.cached ? null : shown));
          setOrgError((shown) => shown ?? "organization_unavailable");
        }
      }
    }
  }, [client, clock, period, keepLastView]);

  useEffect(() => {
    if (preferencesRead) void load();
  }, [load, preferencesRead]);

  const scenario = dashboard?.settings.displayScenario ?? early?.settings.displayScenario ?? DEFAULT_DISPLAY_SCENARIO;
  const now = clock().getTime();
  // Figures are only ever shown under their own period's label, also while another period loads.
  const shown = personal && personal.window.period === period ? personal : null;

  // Only the open AI tab's own answer is shown; saved records stay on the Tracking page.
  const health =
    providerTab && tabCapture.state === "problem"
      ? { code: tabCapture.code, count: tabCapture.count }
      : providerTab && tabCapture.state === "silent"
        ? { code: "capture_hook_missing", count: 1 }
        : null;
  const reloadTab = async () => {
    await reloadActiveProviderTab(providerTab!.id);
    window.close();
  };

  const meView = (connected: boolean, timezone: string, queueCount: number) => {
    const figures = shown ? usageFigures(shown.current.total, shown.current.history?.total, scenario) : null;
    const previousFigures = shown ? usageFigures(shown.previous.total, shown.previous.history?.total, scenario) : null;
    return (
      <PopupShell
        scope={scope}
        onScope={setScope}
        connected={connected}
        footer={
          <PopupFooter
            status={
              error ? (
                <StatusLine icon="alert" tone="warn">
                  Figures could not refresh
                </StatusLine>
              ) : shown?.updating ? (
                // A saved copy from an earlier popup, until the fresh figures replace it.
                <StatusLine icon="refresh" tone="muted">
                  Updating · {ageText(shown.current.generatedAt, now)}
                </StatusLine>
              ) : health && shown ? (
                <StatusLine icon="clock" tone="muted">
                  Figures from {ageText(shown.current.generatedAt, now)}
                </StatusLine>
              ) : busy ? (
                <StatusLine icon="refresh" tone="muted">
                  Updating
                </StatusLine>
              ) : connected && queueCount > 0 ? (
                <StatusLine icon="refresh" tone="muted">
                  {formatInteger(queueCount)} waiting to sync
                </StatusLine>
              ) : (
                <StatusLine>Up to date · {shown ? ageText(shown.current.generatedAt, now) : "just now"}</StatusLine>
              )
            }
          />
        }
      >
        {figures && shown ? (
          <>
            <Hero
              label={`${RESOURCE_LABELS[metric]} · ${period === "today" ? "today" : `last ${PERIOD_LABELS[period]}`}`}
              figures={figures}
              metric={metric}
              scenario={scenario}
              period={period}
              onPeriod={setPeriod}
              updating={busy || !!shown.updating}
              requests={figures.requestsText}
              currentHour={period === "today" ? currentHour(timezone, clock()) : undefined}
              compare={comparison(wh(figures, metric), previousFigures ? wh(previousFigures, metric) : null, shown.window)}
              bars={shown.window.keys.map((key) => {
                const f = bucketFigures(shown.current, key, scenario);
                return f ? wh(f, metric) : 0;
              })}
              axis={axisLabels(shown.window)}
            />
            <ResourceTiles figures={figures} selected={metric} onSelect={setMetric} />
            <RequestsCard figures={figures} view={shown.current} scenario={scenario} />
            {/* Problems sit below every figure, as in Details (owner, 12 October 2026). */}
            {health && (
              <ProblemNotice
                code={health.code}
                count={health.count}
                site={providerTab!.site}
                onReload={reloadTab}
              />
            )}
          </>
        ) : (
          <div className="pp-loading" role="status">
            {error ? "Your figures could not be loaded." : "Loading your figures"}
          </div>
        )}
      </PopupShell>
    );
  };

  // A saved copy confirmed by the quick check shows while the dashboard is still being read.
  if (!dashboard && early && scope === "me" && shown?.updating) return meView(early.view.mode === "company", early.settings.timezone, 0);

  if (!dashboard)
    return (
      <PopupShell
        scope={scope}
        onScope={setScope}
        connected={false}
        footer={
          <PopupFooter
            status={
              <StatusLine icon="clock" tone="muted">
                Loading
              </StatusLine>
            }
          />
        }
      >
        <div className="pp-loading" role="status" aria-live="polite">
          {error ? (
            <>
              <p>The tracker could not load your figures. Your records are kept in this browser.</p>
              <button type="button" className="lg-btn lg-btn-secondary" onClick={() => void load()}>
                Try again
              </button>
            </>
          ) : (
            <p>Loading your figures</p>
          )}
        </div>
      </PopupShell>
    );

  // Nothing is counted until the person agrees (owner decisions of 17 and 18 October 2026), so the
  // popup asks first, also after tracking was turned off in Settings.
  if (consentRequired(dashboard.settings))
    return (
      <ConsentPopup
        ownRead={ownReadSettings(dashboard.settings).ownRead}
        onAgree={async (ownRead) => {
          await client.consent({ agreed: true, ownRead });
          await load();
        }}
      />
    );

  const connected = dashboard.mode === "company";
  // Paused with nothing recorded (before the first chat, or after a full erase) must still say it
  // is paused and offer Resume; the first-run page would claim tracking starts on its own.
  const firstRun =
    scope === "me" &&
    !dashboard.settings.paused &&
    dashboard.summary.requests === 0 &&
    dashboard.summary.attempts === 0 &&
    BigInt(dashboard.history?.local.prompt_count ?? "0") === 0n &&
    BigInt(dashboard.history?.local.response_count ?? "0") === 0n;

  // A tab opened before the tracker was installed has none until it reloads (Codex review, 12 Oct).
  if (firstRun)
    return (
      <FirstRun
        notice={health && <ProblemNotice code={health.code} count={health.count} site={providerTab!.site} onReload={reloadTab} start />}
      />
    );

  if (scope === "org" && !connected) {
    if (dashboard.pending)
      return (
        <PopupShell
          scope={scope}
          onScope={setScope}
          connected={false}
          footer={
            <PopupFooter
              status={
                <StatusLine icon="clock" tone="muted">
                  Not connected yet
                </StatusLine>
              }
              quiet
            />
          }
        >
          <Pending
            pending={dashboard.pending}
            now={now}
            onCancel={async () => {
              await client.command("cancel-connection").catch(() => {});
              void load();
            }}
          />
        </PopupShell>
      );
    return (
      <PopupShell
        scope={scope}
        onScope={setScope}
        connected={false}
        footer={
          <PopupFooter
            status={
              <StatusLine icon="shield" tone="muted">
                Personal mode
              </StatusLine>
            }
            quiet
          />
        }
      >
        <ConnectInvite ended={connectionEndedText(dashboard.company)} />
      </PopupShell>
    );
  }

  if (dashboard.settings.paused && scope === "me")
    return (
      <PopupShell
        scope={scope}
        onScope={setScope}
        connected={connected}
        footer={
          <PopupFooter
            status={
              <StatusLine icon="pause" tone="muted">
                Paused by you
              </StatusLine>
            }
            quiet
          />
        }
      >
        <Paused
          busy={busy}
          since={pausedAt}
          now={now}
          timezone={dashboard.settings.timezone}
          onResume={async () => {
            setBusy(true);
            try {
              await client.settings({ ...dashboard.settings, paused: false });
              await writePreference("paused", {});
            } catch {
              setError("resume_failed");
            }
            void load();
          }}
        />
        {error === "resume_failed" && (
          <p className="pp-error" role="alert">
            Tracking could not be resumed. Try again, or use Settings on the dashboard.
          </p>
        )}
        {personal && dashboard.summary.requests > 0 && <PausedTotals data={personal} scenario={scenario} />}
      </PopupShell>
    );

  if (scope === "org") {
    // A cached copy stands in when the organization figures could not be refreshed. Only an
    // unreachable server is called unreachable; one that answered with an error is not. A saved
    // copy shown while the fresh answer loads (org.cached) is neither: it is being refreshed.
    const offline = !!org && !org.cached && (org.company.offline || org.company.snapshot_source === "cached");
    const unreachable = !!org && !org.cached && org.company.offline === true;
    return (
      <PopupShell
        scope={scope}
        onScope={setScope}
        connected
        footer={
          <PopupFooter
            status={
              offline || orgError ? (
                <span className="pp-sync-pill">{formatInteger(dashboard.queueCount ?? 0)} waiting to sync</span>
              ) : org?.cached ? (
                <StatusLine icon="refresh" tone="muted">
                  Updating
                </StatusLine>
              ) : (
                <StatusLine>Synced {org?.company.generated_at ? ageText(Date.parse(org.company.generated_at), now) : "recently"}</StatusLine>
              )
            }
            action={
              offline || orgError ? (
                <button
                  type="button"
                  className="lg-btn lg-btn-secondary"
                  disabled={orgBusy}
                  onClick={async () => {
                    await client.command("sync").catch(() => {});
                    void load();
                  }}
                >
                  <Icon name="refresh" size={16} />
                  Try again
                </button>
              ) : undefined
            }
          />
        }
      >
        {orgError && !org ? (
          <div className="pp-card pp-notice-card" role="alert">
            <b>Organization figures are unavailable</b>
            <p>Your own records are safe in this browser and sync when the organization server answers.</p>
          </div>
        ) : org ? (
          <OrgView data={org} dashboard={dashboard} scenario={scenario} metric={metric} onMetric={setMetric} offline={offline} unreachable={unreachable} personal={personal} now={now} />
        ) : (
          <div className="pp-loading" role="status">
            Loading organization figures
          </div>
        )}
      </PopupShell>
    );
  }

  return meView(connected, dashboard.settings.timezone, dashboard.queueCount ?? 0);
}

function PopupShell({
  scope,
  onScope,
  connected,
  footer,
  children,
}: {
  scope: Scope;
  onScope: (s: Scope) => void;
  connected: boolean;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="pp">
      <header className="pp-head">
        <WebsiteBrand />
        <Segmented
          label="Show usage for"
          options={[
            { value: "me" as const, label: "Me" },
            { value: "org" as const, label: "Organization" },
          ]}
          value={scope}
          onChange={onScope}
        />
        <button type="button" className="pp-icon-btn" aria-label="Settings" onClick={() => void openExtensionPage("dashboard.html#settings")}>
          <Icon name="sliders" />
        </button>
      </header>
      <main className="pp-main" data-connected={connected || undefined}>
        {children}
      </main>
      {footer}
    </div>
  );
}

function PopupFooter({ status, action, quiet = false }: { status: React.ReactNode; action?: React.ReactNode; quiet?: boolean }) {
  return (
    <>
      {/* The status beside the Dashboard button and the credit centred below them; the
          methodology opens from the dashboard and Details (owner, 16 October 2026). */}
      <footer className="pp-foot">
        <div className="pp-foot-status">{status}</div>
        {action ?? (
          <button
            type="button"
            className={`lg-btn ${quiet ? "lg-btn-secondary" : "lg-btn-primary"}`}
            onClick={() => void openExtensionPage("dashboard.html")}
          >
            Dashboard
          </button>
        )}
      </footer>
      <div className="pp-meta">
        <Credit />
      </div>
    </>
  );
}

function Hero({
  label,
  figures,
  metric,
  scenario,
  period,
  onPeriod,
  compare,
  bars,
  axis,
  updating = false,
  requests,
  currentHour,
}: {
  label: string;
  figures: UsageFigures;
  metric: Resource;
  scenario: DisplayScenario;
  period: PopupPeriod;
  onPeriod: (p: PopupPeriod) => void;
  compare: { up: boolean; text: string } | null;
  bars: (number | null)[];
  axis: string[];
  /**
   * The figures are being updated, or are a saved copy that fresh ones replace. The period
   * buttons stay in place but cannot be used meanwhile (owner decision of 16 October 2026).
   */
  updating?: boolean;
  requests: string;
  currentHour?: number;
}) {
  const eq = equivalent(figures, metric);
  const today = period === "today";
  return (
    <section className="pp-hero" aria-label={label} aria-busy={updating || undefined}>
      <div className="pp-hero-top">
        <span className="pp-hero-label pp-hero-label-one-line">{label}</span>
        <Segmented
          tone="hero"
          label="Period"
          options={(["today", "7d", "30d"] as const).map((value) => ({ value, label: PERIOD_LABELS[value] }))}
          value={period}
          onChange={onPeriod}
          disabled={updating}
        />
      </div>
      <div className="pp-hero-figure">
        <span className="pp-approx" aria-hidden="true">
          ≈
        </span>
        <span className={`pp-hero-value pp-hero-${metric}`}>
          <FigureParts figure={figures[metric]} />
        </span>
        <ScenarioChip scenario={scenario} tone="hero" />
      </div>
      <div className="pp-hero-sub">
        {today ? (
          <span>{[eq, `${requests} request${requests === "1" ? "" : "s"}`].filter(Boolean).join(" · ")}</span>
        ) : (
          <>
            {eq && <span>{eq}</span>}
            {compare && (
              <span className="pp-compare">
                <Icon name={compare.up ? "arrowUp" : "arrowDown"} size={14} />
                {compare.text}
              </span>
            )}
          </>
        )}
      </div>
      <Bars
        values={bars}
        highlight={today ? currentHour : bars.length - 1}
        future={today && currentHour !== undefined ? currentHour + 1 : undefined}
        height={today ? 40 : 52}
        label={`${today ? "Hourly" : "Daily"} ${RESOURCE_LABELS[metric].toLowerCase()}`}
      />
      {!today && (
        <div className="pp-axis" aria-hidden="true">
          {axis.map((a) => (
            <span key={a}>{a}</span>
          ))}
        </div>
      )}
    </section>
  );
}

/** The hour of day (0 to 23) in the user's time zone, for dimming the hours of today that have not happened yet. */
function currentHour(timezone: string, now: Date) {
  try {
    return Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: timezone }).format(now));
  } catch {
    return now.getHours();
  }
}

function RequestsCard({ figures, view, scenario }: { figures: UsageFigures; view: UsageBreakdownView; scenario: DisplayScenario }) {
  const perRequest =
    figures.requests && figures.requests > 0n && figures.energy.value !== null
      ? formatMetric(String(Number(figures.energy.value) / Number(figures.requests)), figures.energy.unit)
      : null;
  const energyBySite: Record<string, number> = {};
  for (const site of SITE_ORDER) {
    const live = view.sites[site];
    const saved = view.history?.sites[site];
    if (!live && !saved) continue;
    const f = usageFigures(live ?? emptyLike(view), saved ?? null, scenario);
    const value = toWh(f.energy.value, f.energy.unit);
    if (value !== null) energyBySite[site] = value;
  }
  return (
    <section className="pp-card" aria-label="Requests and tools">
      <div className="pp-row">
        <span>
          <b className="lg-num">{figures.requestsText}</b> requests
        </span>
        {perRequest && <span className="lg-soft lg-num">{perRequest} each</span>}
      </div>
      <ToolShare items={shares(energyBySite)} />
    </section>
  );
}

function ProblemNotice({ code, count, site, onReload, start = false }: { code: string; count: number; site: string; onReload: () => void; start?: boolean }) {
  const tool = SITE_LABELS[site] ?? "AI";
  const text =
    code === "capture_hook_missing"
      ? start
        ? `Reload your open ${tool} tab to start tracking it.`
        : `Your open ${tool} tab stopped reporting replies.`
      : `${formatInteger(count)} ${count === 1 ? "reply" : "replies"} in your open ${tool} tab ${count === 1 ? "was" : "were"} not counted.`;
  return (
    <div className="pp-problem" role="status">
      <Icon name="alert" size={15} />
      <span>{text}</span>
      <button type="button" className="pp-problem-btn" onClick={onReload}>
        Reload tab
      </button>
    </div>
  );
}

function Paused({ onResume, busy, since, now, timezone }: { onResume: () => void; busy: boolean; since: number | null; now: number; timezone: string }) {
  return (
    <section className="pp-paused" aria-labelledby="pp-paused-title">
      <span className="pp-paused-icon" aria-hidden="true">
        <Icon name="pause" size={20} />
      </span>
      <h1 id="pp-paused-title" className="lg-display">
        Tracking is paused
      </h1>
      <p>Nothing is recorded while paused. Chats you have now will not appear in your totals.</p>
      {since !== null && since <= now && <span className="pp-paused-since lg-num">Paused since {pausedSince(since, now, timezone)}</span>}
      <button type="button" className="lg-btn lg-btn-primary" disabled={busy} onClick={onResume}>
        <Icon name="play" size={16} />
        Resume tracking
      </button>
    </section>
  );
}

/** "14:20 today", "14:20 yesterday" or "3 Oct, 14:20" in the user's time zone. */
function pausedSince(at: number, now: number, timezone: string) {
  const day = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(t);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(at);
  if (day(at) === day(now)) return `${time} today`;
  if (day(at) === day(now - 86_400_000)) return `${time} yesterday`;
  return `${new Intl.DateTimeFormat("en-GB", { timeZone: timezone, day: "numeric", month: "short" }).format(at).replace("Sept", "Sep")}, ${time}`;
}

function PausedTotals({ data, scenario }: { data: PersonalData; scenario: DisplayScenario }) {
  const figures = usageFigures(data.current.total, data.current.history?.total, scenario);
  return (
    <div className="pp-paused-totals">
      <div className="pp-subhead">
        <span>Last {PERIOD_LABELS[data.window.period]}, until you paused</span>
        <ScenarioChip scenario={scenario} />
      </div>
      <ResourceTiles figures={figures} />
      <RequestsCard figures={figures} view={data.current} scenario={scenario} />
    </div>
  );
}

function OrgView({
  data,
  dashboard,
  scenario,
  metric,
  onMetric,
  offline,
  unreachable,
  personal,
  now,
}: {
  data: OrgData;
  dashboard: Dashboard;
  scenario: DisplayScenario;
  metric: Resource;
  onMetric: (r: Resource) => void;
  /** The figures are a cached copy because current ones could not be read. */
  offline: boolean;
  /** The organization server could not be reached at all. */
  unreachable: boolean;
  personal: PersonalData | null;
  now: number;
}) {
  const figures = usageFigures(data.company, data.company.history?.server ?? null, scenario);
  const before = data.previous ? usageFigures(data.previous, data.previous.history?.server ?? null, scenario) : null;
  const mine = data.mine ? usageFigures(data.mine, data.mine.history?.server ?? null, scenario) : null;
  const total = wh(figures, metric);
  const own = mine ? wh(mine, metric) : null;
  const share = total && own !== null ? Math.round((own / total) * 100) : null;
  const name = organizationName(dashboard.company, "Organization");
  const people = peopleOf(data.company as ServerSummary & { active_users?: string });
  const days = (data.company as ServerSummary & { days?: Record<string, ServerSummary> }).days;
  const snapshot = data.company.cached_at ? new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(data.company.cached_at) : null;
  const eq = equivalent(figures, metric);
  if (offline)
    return (
      <>
        <div className="pp-info" role="status">
          <Icon name="offline" size={18} />
          <span>
            <b>{unreachable ? "Organization server unreachable" : "Organization figures not refreshed"}</b>
            {unreachable
              ? `Showing organization figures from ${snapshot ?? "earlier"}. Your new activity is safe here and syncs when the server is back.`
              : `The organization server answered but could not send current figures. Showing organization figures from ${snapshot ?? "earlier"}. Your new activity is safe here and syncs in the background.`}
          </span>
        </div>
        <section className="pp-hero pp-hero-org" aria-label={`${name} · last 30 days`}>
          <div className="pp-hero-top">
            <span className="pp-hero-label">{name} · last 30 days</span>
            {snapshot && <span className="pp-hero-pill">Snapshot {snapshot}</span>}
          </div>
          <div className="pp-hero-figure">
            <span className="pp-approx" aria-hidden="true">
              ≈
            </span>
            <span className={`pp-hero-value pp-hero-${metric}`}>
              <FigureParts figure={figures[metric]} />
            </span>
            <ScenarioChip scenario={scenario} tone="hero" />
          </div>
          <div className="pp-hero-sub">
            <span>{[eq, people !== null ? `${formatInteger(people)} people` : null].filter(Boolean).join(" · ")}</span>
          </div>
        </section>
        {personal && (
          <>
            <div className="pp-subhead">
              <span>You, from this browser, {personal.updating ? "updating" : "up to date"}</span>
            </div>
            <ResourceTiles figures={usageFigures(personal.current.total, personal.current.history?.total, scenario)} />
            <RequestsCard
              figures={usageFigures(personal.current.total, personal.current.history?.total, scenario)}
              view={personal.current}
              scenario={scenario}
            />
          </>
        )}
      </>
    );
  const change = comparison(total, before ? wh(before, metric) : null, data.window);
  return (
    <>
      <section className="pp-hero pp-hero-org" aria-label={`${name} · last 30 days`}>
        <div className="pp-hero-top">
          <span className="pp-hero-label">{name} · last 30 days</span>
          {/* A saved copy shown while the fresh answer loads says how old it is. */}
          {data.cached && data.company.cached_at ? (
            <span className="pp-hero-pill" role="status">
              Updated {ageText(data.company.cached_at, now)}
            </span>
          ) : people !== null ? (
            <span className="pp-hero-meta">{formatInteger(people)} people</span>
          ) : null}
        </div>
        <div className="pp-hero-figure">
          <span className="pp-approx" aria-hidden="true">
            ≈
          </span>
          <span className={`pp-hero-value pp-hero-${metric}`}>
            <FigureParts figure={figures[metric]} />
          </span>
          <ScenarioChip scenario={scenario} tone="hero" />
        </div>
        <div className="pp-hero-sub">
          {eq && <span>{eq}</span>}
          {change && (
            <span className="pp-compare">
              <Icon name={change.up ? "arrowUp" : "arrowDown"} size={14} />
              {change.text}
            </span>
          )}
        </div>
        {days && (
          <>
            <Bars
              values={data.window.keys.map((key) => (days[key] ? wh(usageFigures(days[key]!, null, scenario), metric) : 0))}
              highlight={data.window.keys.length - 1}
              label={`Daily organization ${RESOURCE_LABELS[metric].toLowerCase()}`}
              height={52}
            />
            <div className="pp-axis" aria-hidden="true">
              {axisLabels(data.window).map((a) => (
                <span key={a}>{a}</span>
              ))}
            </div>
          </>
        )}
      </section>
      <ResourceTiles figures={figures} selected={metric} onSelect={onMetric} />
      <section className="pp-card" aria-label="Your share">
        <div className="pp-row">
          <span>{data.mineCached ? "Your share · Updating" : "Your share"}</span>
          <span className="lg-soft lg-num">
            <b>{mine ? figureText(mine[metric]) : data.mineLoading ? "Loading" : "Unknown"}</b>
            {share !== null ? ` · ${share}%` : ""}
          </span>
        </div>
        {share !== null && (
          <div className="pp-meter" aria-hidden="true">
            <span style={{ width: `${Math.min(100, Math.max(share, 1))}%` }} />
          </div>
        )}
        <p className="pp-small">{figures.requestsText} requests across the organization. Only totals are shared; no chat text leaves any browser.</p>
      </section>
    </>
  );
}

/** The logo and name open the public website (owner, 12 October 2026). */
function WebsiteBrand() {
  return (
    <a className="pp-brand" href={PUBLIC_WEBSITE} target="_blank" rel="noopener noreferrer" aria-label="AI Footprint Tracker website">
      <LivingGaugeMark className="pp-mark" />
      <span className="pp-title">AI Footprint Tracker</span>
    </a>
  );
}

function FirstRun({ notice }: { notice?: React.ReactNode }) {
  return (
    <div className="pp pp-first">
      <header className="pp-head">
        <WebsiteBrand />
        <button type="button" className="pp-icon-btn" aria-label="Settings" onClick={() => void openExtensionPage("dashboard.html#settings")}>
          <Icon name="sliders" />
        </button>
      </header>
      <main className="pp-main">
        <section className="pp-welcome" aria-labelledby="pp-first-title">
          <a className="pp-welcome-mark" href={PUBLIC_WEBSITE} target="_blank" rel="noopener noreferrer" aria-label="AI Footprint Tracker website">
            <LivingGaugeMark size={58} />
          </a>
          <span className="pp-welcome-text">
            <h1 id="pp-first-title" className="lg-display">
              Ready when you are
            </h1>
            <span>Chat as usual. The footprint of each chat appears right under the chat box.</span>
          </span>
        </section>
        <ol className="pp-card pp-steps">
          <li>
            <span className="pp-step">1</span>
            <span>
              <b>Open a supported site.</b> Tracking starts on its own.
            </span>
          </li>
          <li>
            <span className="pp-step">2</span>
            <span>
              <b>See electricity, carbon and water</b> under every chat as it happens.
            </span>
          </li>
          <li>
            <span className="pp-step">3</span>
            <span>
              <b>Come back here</b> for your day, week and month at a glance.
            </span>
          </li>
        </ol>
        {/* First run follows the agreement; agreeing in the popup skips the welcome page's tour.
            Placed above the fold, since the popup's 600 px frame cuts off the lower part. */}
        <button type="button" className="pp-link pp-tour-link" onClick={() => void openWelcomePage()}>
          {TAKE_TOUR_LABEL}
        </button>
        <div className="pp-works">
          <span>Works on</span>
          <ul>
            {(["chatgpt", "claude", "gemini", "perplexity", "notebooklm"] as const).map((site) => (
              <li key={site}>
                <span className="lg-swatch" style={{ background: `var(--lg-tool-${site})` }} />
                {SITE_LABELS[site]}
              </li>
            ))}
          </ul>
        </div>
        <p className="pp-note">
          <Icon name="shield" size={18} />
          Your chats stay in this browser. The tracker saves numbers only, never what you or the AI wrote.
        </p>
        {notice}
      </main>
      <footer className="pp-foot">
        <a href="methodology.html" target="_blank" rel="noopener" className="pp-link pp-link-lg">
          How estimates work
        </a>
        <button type="button" className="lg-btn lg-btn-secondary" onClick={() => void openExtensionPage("dashboard.html")}>
          Dashboard
        </button>
      </footer>
      <div className="pp-meta">
        <Credit />
      </div>
    </div>
  );
}

/** The popup before the person agreed (canvas PopupNew): the welcome page's agreement in short. */
function ConsentPopup({ ownRead: saved, onAgree }: { ownRead: boolean; onAgree: (ownRead: boolean) => Promise<void> }) {
  const [ownRead, setOwnRead] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="pp pp-consent">
      <header className="pp-head">
        <WebsiteBrand />
      </header>
      <main className="pp-main">
        <LocalCard
          id="pp-local"
          heading="h1"
          title="Runs on your computer"
          text="Everything is calculated in this browser. Nothing is sent to us. Open source."
        />
        <p className="pp-consent-lead">Nothing is counted until you agree.</p>
        <ol className="pp-card pp-steps">
          <li>
            <span className="pp-step">1</span>
            <span>Reads the chat in this browser on the five supported sites to count tokens.</span>
          </li>
          <li>
            <span className="pp-step">2</span>
            <span>Keeps numbers only. The text is discarded after counting.</span>
          </li>
          <li>
            <span className="pp-step">3</span>
            <span>Nothing leaves this browser unless you connect to an organization.</span>
          </li>
        </ol>
        <label className="pp-consent-check">
          <input type="checkbox" checked={ownRead} disabled={busy} onChange={(event) => setOwnRead(event.target.checked)} />
          <span>{FULL_HISTORY_LABEL}</span>
        </label>
        <button
          type="button"
          className="lg-btn lg-btn-primary lg-btn-block pp-consent-agree"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setFailed(false);
            try {
              await onAgree(ownRead);
            } catch {
              setFailed(true);
              setBusy(false);
            }
          }}
        >
          {busy ? "Starting" : "Agree and start"}
        </button>
        {failed && (
          <p className="pp-error" role="alert">
            Your choice could not be saved. Nothing is counted yet. Try again.
          </p>
        )}
        <button type="button" className="pp-link pp-consent-more" onClick={() => void openWelcomePage()}>
          How it works in detail
        </button>
      </main>
      <div className="pp-meta">
        <Credit />
      </div>
    </div>
  );
}

function ConnectInvite({ ended }: { ended: string | null }) {
  return (
    <>
      <section className="pp-panel" aria-labelledby="pp-connect-title">
        <span className="pp-panel-status">
          <span className="pp-panel-dot" />
          {ended ? "Disconnected" : "Not connected"}
        </span>
        <h1 id="pp-connect-title" className="lg-display">
          Connect this browser to your organization
        </h1>
        <span className="pp-panel-text">
          {ended ?? "Connect with your work email. Then you see your organization's totals here and in the dashboard."}
        </span>
        <button type="button" className="pp-panel-btn" onClick={() => void openExtensionPage("dashboard.html#connect")}>
          <Icon name="link" size={17} />
          Connect organization
        </button>
        <span className="pp-panel-small">Opens the dashboard, where a code sent to your work email confirms it.</span>
      </section>
      <section className="pp-card pp-after" aria-labelledby="pp-after-title">
        <b id="pp-after-title">After you connect</b>
        <ul>
          <li>
            <Icon name="check" size={15} className="pp-yes" />
            <span>Your organization receives numbers: tokens, estimates, tools, models and times.</span>
          </li>
          <li>
            <Icon name="close" size={15} className="pp-no" />
            <span>Never your prompts, the AI's answers, files or chat titles.</span>
          </li>
          <li>
            <Icon name="check" size={15} className="pp-yes" />
            <span>Records from before connecting stay in this browser.</span>
          </li>
        </ul>
      </section>
    </>
  );
}

/** A connection started in the dashboard: the popup says where it stands and sends the person back there. */
function Pending({ pending, now, onCancel }: { pending: NonNullable<Dashboard["pending"]>; now: number; onCancel: () => void }) {
  const minutes = Math.max(0, Math.ceil((Date.parse(pending.expires_at) - now) / 60000));
  const verified = pending.state === "verified";
  let server: string | null = null;
  try {
    // The hosted address names no organization, so only an organization's own server is shown.
    if (!isHostedOrigin(pending.origin)) server = new URL(pending.origin).host;
  } catch {
    server = pending.origin;
  }
  return (
    <>
      <section className="pp-panel" aria-labelledby="pp-pending-title">
        <span className="pp-panel-status pp-panel-status-wait">
          <Icon name="clock" size={15} />
          {verified ? "Waiting for you to confirm" : "Waiting for your code"}
        </span>
        <h1 id="pp-pending-title" className="lg-display">
          {verified ? `Connect to ${pending.company_name ?? "your organization"}?` : "Enter the code from your email"}
        </h1>
        <span className="pp-panel-text">
          {verified ? "Check what your organization receives, then connect in the dashboard." : "Enter the 6-digit code in the dashboard to continue."}
        </span>
        <dl className="pp-kv">
          <div className="pp-kv-stack">
            <dt>{verified ? "Organization" : "Code sent to"}</dt>
            <dd>{verified ? pending.company_name : (pending.email ?? "your work email")}</dd>
          </div>
          {server && (
            <div className="pp-kv-stack">
              <dt>Server</dt>
              <dd>{server}</dd>
            </div>
          )}
          <div>
            <dt>Expires</dt>
            <dd className="lg-num">{minutes > 0 ? `in ${minutes} minute${minutes === 1 ? "" : "s"}` : "Expired"}</dd>
          </div>
        </dl>
      </section>
      <div className="pp-actions">
        <button
          type="button"
          className="lg-btn lg-btn-primary pp-grow"
          onClick={() => void openExtensionPage("dashboard.html#connect")}
        >
          <Icon name="external" size={16} />
          Continue in the dashboard
        </button>
        <button type="button" className="lg-btn lg-btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p className="pp-note">
        <Icon name="shield" size={18} />
        Your earlier personal records stay in this browser. Only activity after connecting is shared.
      </p>
    </>
  );
}
