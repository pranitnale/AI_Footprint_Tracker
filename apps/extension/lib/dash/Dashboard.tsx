import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_DISPLAY_SCENARIO } from "@footprint/contracts";
import { Icon, LivingGaugeMark, PUBLIC_WEBSITE, type IconName } from "@footprint/ui/icons";
import { formatInteger } from "@footprint/ui/formatters";
import { createDashboardClient, runtimePermissionRequest, runtimeTransport, type PermissionRequest, type Transport } from "../dashboard/client";
import type { Dashboard as DashboardData } from "../dashboard/types";
import { organizationName, organizationSharing, syncedText } from "../dashboard/organization";
import type { BundledNotices } from "../dashboard/about-notices";
import { Credit, ScenarioChip, Segmented, SITE_LABELS } from "../ui/components";
import { dashWindow, decodePeriod, encodePeriod, todayIn, type DashPeriod } from "../ui/dash-periods";
import { readPreference, writePreference } from "../ui/preferences";
import { Toast } from "../ui/dialog";
import type { Metric } from "../ui/figure-math";
import { useDashboardState } from "./data";
import { PeriodMenu } from "./PeriodMenu";
import { LocalSummaryCard, Overview } from "./Overview";
import { OrgOverview } from "./OrgOverview";
import { Models } from "./Models";
import { Recap, RecapMonthNav, recapMonth } from "./Recap";
import { Settings } from "./Settings";
import { Tracking } from "./Tracking";
import { Licences } from "./Licences";
import { ConnectPage } from "./Connect";
import { ConnectDialog } from "./dialogs";
import { isActionable } from "../health";
import { consentRequired } from "../tracking-consent";
import { openWelcomePage } from "../ui/navigation";

export type Route = "overview" | "models" | "recap" | "settings" | "tracking" | "licences" | "connect";
export type Scope = "me" | "org";
const ROUTES: Route[] = ["overview", "models", "recap", "settings", "tracking", "licences", "connect"];

/** "#recap/2026-09" names the month; every other route is just its name. */
function readHash(): { route: Route; month: string | null } {
  const [name, month] = location.hash.replace(/^#/, "").split("/");
  const route = ROUTES.includes(name as Route) ? (name as Route) : "overview";
  return { route, month: route === "recap" && /^\d{4}-\d{2}$/.test(month ?? "") ? month! : null };
}

export type PageContext = {
  client: ReturnType<typeof createDashboardClient>;
  dashboard: DashboardData;
  scope: Scope;
  period: DashPeriod;
  metric: Metric;
  setMetric: (m: Metric) => void;
  now: Date;
  revision: number;
  reload: () => Promise<void>;
  rescope: () => void;
  notify: (text: string) => void;
  go: (route: Route, month?: string) => void;
  requestPermission: PermissionRequest;
  openConnect: () => void;
};

const systemClock = () => new Date();

export default function Dashboard({
  transport = runtimeTransport,
  requestPermission = runtimePermissionRequest,
  clock = systemClock,
  notices,
}: {
  notices?: BundledNotices;
  transport?: Transport;
  requestPermission?: PermissionRequest;
  clock?: () => Date;
}) {
  const client = useMemo(() => createDashboardClient(transport), [transport]);
  const { dashboard, error, reload, revision } = useDashboardState(client);
  const [{ route, month }, setLocation] = useState(readHash);
  const [scope, setScopeState] = useState<Scope>("me");
  const [period, setPeriodState] = useState<DashPeriod>({ kind: "30d" });
  const [metric, setMetricState] = useState<Metric>("energy");
  const [toast, setToast] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const onHash = () => setLocation(readHash());
    window.addEventListener("hashchange", onHash);
    void readPreference("dashboard").then((saved) => {
      if (saved?.scope === "me" || saved?.scope === "org") setScopeState(saved.scope);
      const p = decodePeriod(saved?.period);
      if (p) setPeriodState(p);
      if (["energy", "carbon", "water", "requests"].includes(String(saved?.metric))) setMetricState(saved!.metric as Metric);
    });
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  // The popup's "Connect organization" opens #connect: show the organization side with the dialog open.
  useEffect(() => {
    if (route === "connect") {
      setScopeState("org");
      setConnecting(true);
    }
  }, [route]);

  const remember = (next: Record<string, unknown>) => void readPreference("dashboard").then((saved) => writePreference("dashboard", { ...saved, ...next }));
  const setScope = (s: Scope) => {
    setScopeState(s);
    remember({ scope: s });
  };
  const setPeriod = (p: DashPeriod) => {
    setPeriodState(p);
    remember({ period: encodePeriod(p) });
  };
  const setMetric = (m: Metric) => {
    setMetricState(m);
    remember({ metric: m });
  };
  const go = useCallback((next: Route, m?: string) => {
    location.hash = next === "overview" && !m ? "overview" : m ? `${next}/${m}` : next;
  }, []);

  const now = clock();
  if (!dashboard)
    return (
      <Shell route={route} go={go} empty={false} status={null}>
        <div className="dh-loading" role="status" aria-live="polite">
          {error ? (
            <>
              <p>The dashboard could not load. Your records are kept in this browser.</p>
              <button type="button" className="lg-btn lg-btn-secondary" onClick={() => void reload()}>
                Try again
              </button>
            </>
          ) : (
            <p>Loading your footprint</p>
          )}
        </div>
      </Shell>
    );

  const scenario = dashboard.settings.displayScenario ?? DEFAULT_DISPLAY_SCENARIO;
  const connected = dashboard.mode === "company";
  const empty =
    dashboard.summary.requests === 0 &&
    dashboard.summary.attempts === 0 &&
    BigInt(dashboard.history?.local.prompt_count ?? "0") === 0n &&
    BigInt(dashboard.history?.local.response_count ?? "0") === 0n;
  const window_ = dashWindow(period, dashboard.settings.timezone, now);
  const ctx: PageContext = {
    client,
    dashboard,
    scope: connected || scope === "me" ? scope : "org",
    period,
    metric,
    setMetric,
    now,
    revision,
    reload: () => reload(),
    rescope: () => void reload(),
    notify: setToast,
    go,
    requestPermission,
    openConnect: () => setConnecting(true),
  };
  const figurePage = route === "overview" || route === "models" || route === "recap" || route === "connect";
  const orgView = figurePage && scope === "org";
  const orgName = organizationName(dashboard.company);
  // Members see organization totals only while an administrator has sharing on; the policy says which.
  const sharing = organizationSharing(dashboard.company?.policy);
  const orgSubtitle = sharing === true ? `${orgName} · totals your organization shares with its members` : sharing === false ? `${orgName} · totals kept for administrators` : orgName;
  const titles: Record<Route, [string, string]> = {
    overview: orgView ? ["Organization footprint", connected ? orgSubtitle : ""] : ["Your AI footprint", empty ? "Nothing recorded yet" : `Recorded in this browser${window_.range ? ` · ${window_.range}` : ""}`],
    connect: ["Organization footprint", ""],
    models: orgView ? ["Tools and models", `Across ${orgName}, with your own count beside each`] : ["Tools and models", "The AI tools and models you used, and what each one used"],
    recap: orgView ? ["Monthly recap", `${orgName} · organization totals`] : ["Monthly recap", "Recorded in this browser"],
    settings: ["Settings", connected ? `Connected to ${orgName}. Some choices are set by your organization.` : "Changes apply right away. Changing the scenario, pausing and erasing ask first."],
    tracking: ["Tracking status", "Whether every site is read correctly in this browser"],
    licences: ["Open-source licences", ""],
  };
  const [title, subtitle] = titles[route];
  const showControls = figurePage && !empty && (scope === "me" || connected);

  const page = (() => {
    if (route === "settings") return <Settings ctx={ctx} />;
    if (route === "tracking") return <Tracking ctx={ctx} />;
    if (route === "licences") return <Licences notices={notices} />;
    if (scope === "org" && figurePage) {
      if (!connected) return <ConnectPage onConnect={() => setConnecting(true)} pending={dashboard.pending} client={client} reload={reload} now={now} />;
      if (route === "models") return <Models ctx={ctx} org />;
      if (route === "recap") return <Recap ctx={ctx} month={month} org />;
      return <OrgOverview ctx={ctx} />;
    }
    if (empty) return <EmptyState dashboard={dashboard} />;
    if (route === "models") return <Models ctx={ctx} />;
    if (route === "recap") return <Recap ctx={ctx} month={month} />;
    return <Overview ctx={ctx} />;
  })();

  return (
    <Shell route={route} go={go} empty={empty} status={<SidebarStatus dashboard={dashboard} orgName={orgName} go={go} />}>
      <header className="dh-head">
        <div className="dh-titles">
          <h1 className="lg-display">{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className="dh-controls">
          {route === "licences" && (
            <button type="button" className="lg-btn lg-btn-quiet" onClick={() => go("settings")}>
              <Icon name="chevronLeft" size={16} />
              Back to Settings
            </button>
          )}
          {figurePage && (
            <Segmented
              label="Show figures for"
              options={[
                { value: "me" as const, label: "Me" },
                { value: "org" as const, label: "Organization" },
              ]}
              value={scope}
              onChange={setScope}
            />
          )}
          {showControls && route === "recap" && <RecapMonthNav month={recapMonth(month, todayIn(dashboard.settings.timezone, now))} today={todayIn(dashboard.settings.timezone, now)} go={go} />}
          {showControls && route !== "recap" && <PeriodMenu value={period} label={window_.label} today={todayIn(dashboard.settings.timezone, now)} onChange={setPeriod} />}
          {showControls && <ScenarioChip scenario={scenario} />}
          {showControls && orgView && (
            <button
              type="button"
              className="lg-btn lg-btn-secondary"
              disabled={syncing}
              onClick={async () => {
                setSyncing(true);
                try {
                  await client.command("sync");
                  setToast(syncedText(orgName, consentRequired(dashboard.settings)));
                } catch {
                  setToast("Sync did not finish. Your records stay in this browser and sync later.");
                } finally {
                  setSyncing(false);
                  void reload();
                }
              }}
            >
              <Icon name="refresh" size={16} className={syncing ? "pp-spin" : undefined} />
              Sync now
            </button>
          )}
          {route === "tracking" && (
            <button
              type="button"
              className="lg-btn lg-btn-secondary"
              onClick={async () => {
                await reload();
                setToast("Checked again");
              }}
            >
              <Icon name="refresh" size={16} />
              Check again
            </button>
          )}
        </div>
      </header>
      {error && (
        <p className="dh-banner" role="alert">
          The latest figures could not load. The page shows the last complete figures.{" "}
          <button type="button" className="lg-btn lg-btn-quiet lg-btn-sm" onClick={() => void reload()}>
            Try again
          </button>
        </p>
      )}
      {page}
      {connecting && (
        <ConnectDialog
          client={client}
          requestPermission={requestPermission}
          onClose={() => {
            setConnecting(false);
            if (route === "connect") go("overview");
          }}
          onDone={async (message) => {
            setConnecting(false);
            if (message) setToast(message);
            if (route === "connect") go("overview");
            await reload();
          }}
          onStarted={() => reload()}
          pending={dashboard.pending}
          company={dashboard.company}
          now={now}
          onCancelPending={async () => {
            await client.command("cancel-connection").catch(() => {});
            await reload();
          }}
        />
      )}
      {toast && <Toast onDone={() => setToast(null)}>{toast}</Toast>}
    </Shell>
  );
}

const NAV: { route: Route | "methodology"; label: string; icon: IconName }[] = [
  { route: "overview", label: "Overview", icon: "overview" },
  { route: "models", label: "Tools and models", icon: "layers" },
  { route: "recap", label: "Monthly recap", icon: "calendar" },
  { route: "methodology", label: "Methodology", icon: "book" },
  { route: "settings", label: "Settings", icon: "sliders" },
];

function Shell({ route, go, empty, status, children }: { route: Route; go: (r: Route) => void; empty: boolean; status: ReactNode; children: ReactNode }) {
  const current = route === "connect" ? "overview" : route === "tracking" || route === "licences" ? "settings" : route;
  return (
    <div className="dh">
      <aside className="dh-side">
        {/* The logo opens the public website; Overview stays in the navigation (owner, 12 October 2026). */}
        <a className="dh-brand" href={PUBLIC_WEBSITE} target="_blank" rel="noopener noreferrer" aria-label="AI Footprint Tracker website">
          <LivingGaugeMark size={30} className="pp-mark" />
          <span>AI Footprint Tracker</span>
        </a>
        <nav aria-label="Dashboard">
          <ul>
            {NAV.filter((item) => !(empty && item.route === "recap")).map((item) => (
              <li key={item.route}>
                {item.route === "methodology" ? (
                  <a className="dh-nav" href="methodology.html">
                    <Icon name={item.icon} size={18} />
                    {item.label}
                  </a>
                ) : (
                  <a className="dh-nav" href={`#${item.route}`} aria-current={current === item.route ? "page" : undefined}>
                    <Icon name={item.icon} size={18} />
                    {item.label}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </nav>
        {status}
      </aside>
      <main className="dh-main">
        {children}
        <Credit />
      </main>
    </div>
  );
}

function SidebarStatus({ dashboard, orgName, go }: { dashboard: DashboardData; orgName: string; go: (r: Route) => void }) {
  // Page problems are earlier events; the Tracking page lists them separately. Solved problems
  // and those not seen for 3 days are no longer current, so they are not counted.
  const problems = dashboard.health.filter((issue) => issue.code !== "sync_delayed" && isActionable(issue));
  const paused = dashboard.settings.paused;
  const connected = dashboard.mode === "company";
  // Before the person agreed nothing is tracked, whatever else is set (lib/tracking-consent.ts).
  if (consentRequired(dashboard.settings))
    return (
      <button type="button" className="dh-status" onClick={() => void openWelcomePage()}>
        <span className="dh-status-title">
          <span className="dh-dot dh-dot-paused" aria-hidden="true" />
          Tracking is off
        </span>
        <span className="dh-status-detail">Nothing is counted until you agree.</span>
      </button>
    );
  const title = paused ? "Tracking is paused" : problems.length ? `Tracking, ${problems.length} ${problems.length === 1 ? "problem" : "problems"}` : "Tracking is on";
  // Sharing waits for the person to agree to what the server's operator switches change.
  const held = connected && dashboard.company?.consent_required === true;
  const detail = paused
    ? "Nothing is recorded until you resume."
    : problems.length
      ? problemSummary(problems[0]!.code, problems[0]!.count)
      : held
        ? `Sharing with ${orgName} waits for your agreement in Settings`
        : connected
          ? `Connected to ${orgName}${dashboard.queueCount ? ` · ${formatInteger(dashboard.queueCount)} waiting to sync` : ""}`
          : `${Object.keys(SITE_LABELS).length} sites · personal mode · records stay in this browser`;
  return (
    <button type="button" className={`dh-status${problems.length && !paused ? " dh-status-problem" : ""}`} onClick={() => go(paused || (held && !problems.length) ? "settings" : "tracking")}>
      <span className="dh-status-title">
        <span className={`dh-dot dh-dot-${paused ? "paused" : problems.length ? "warn" : "ok"}`} aria-hidden="true" />
        {title}
      </span>
      <span className="dh-status-detail">{detail}</span>
    </button>
  );
}

export function problemSummary(code: string, count: number) {
  switch (code) {
    case "protocol_unsupported":
      return `${formatInteger(count)} ${count === 1 ? "reply" : "replies"} not counted`;
    case "capture_hook_missing":
      return "An open AI tab stopped reporting replies";
    case "storage_write_failed":
      return "This browser could not save new usage";
    case "auth_reconnect_required":
      return "The organization connection needs renewing";
    case "enrollment_revoked":
      return "Organization access was removed";
    case "policy_unavailable":
      return "Organization rules could not be checked";
    default:
      return "Something needs a look";
  }
}

function EmptyState({ dashboard }: { dashboard: DashboardData }) {
  return (
    <>
      <section className="dh-hero dh-empty">
        <div className="dh-empty-text">
          <h2 className="lg-display">Your footprint starts with your next chat</h2>
          <p>Open one of these sites and chat as usual. The figures appear under the chat box and fill this page.</p>
          <ul className="dh-sites">
            {(["chatgpt", "claude", "gemini", "perplexity", "notebooklm"] as const).map((site) => (
              <li key={site}>
                <span className="lg-swatch" style={{ background: `var(--lg-tool-${site})` }} />
                {SITE_LABELS[site]}
              </li>
            ))}
          </ul>
        </div>
        <div className="dh-empty-bars" aria-hidden="true">
          {[34, 52, 40, 70, 28, 12, 58, 64, 46, 20, 8, 4].map((h, i) => (
            <span key={i} style={{ height: `${h}%` }} />
          ))}
          <small>Each day of AI use becomes a bar here.</small>
        </div>
      </section>
      <div className="dh-tiles">
        {(
          [
            ["Electricity", "0 Wh", "energy"],
            ["Carbon", "0 g", "carbon"],
            ["Water", "0 mL", "water"],
            ["Requests", "0", "requests"],
          ] as const
        ).map(([label, value, key]) => (
          <div key={key} className="dh-tile">
            <span className={`dh-tile-label dh-ink-${key}`}>{label}</span>
            <span className="dh-tile-value">
              <span className="lg-display lg-num">{value.split(" ")[0]}</span>
              {value.includes(" ") && <span className="dh-tile-unit">{value.split(" ")[1]}</span>}
            </span>
          </div>
        ))}
      </div>
      <div className="dh-two">
        <div className="dh-card dh-hint">
          <span className="dh-hint-icon" aria-hidden="true">
            <Icon name="refresh" size={16} />
          </span>
          <div>
            <b>Old chats count too</b>
            <p>Open a chat from before you installed the tracker and its earlier messages are read and estimated.</p>
          </div>
        </div>
        <div className="dh-card dh-hint">
          <span className="dh-hint-icon" aria-hidden="true">
            <Icon name="book" size={16} />
          </span>
          <div>
            <b>Curious how it works?</b>
            <p>
              The methodology explains every step in plain words. <a href="methodology.html">Read it</a>
            </p>
          </div>
        </div>
      </div>
      <LocalSummaryCard dashboard={dashboard} id="dh-local" methodology />
    </>
  );
}

