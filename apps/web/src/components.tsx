import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Icon, LivingGaugeMark, PUBLIC_WEBSITE, type IconName } from "@footprint/ui/icons";
import {
  Brand,
  Button,
  Dialog,
  ExtractedFileTextDetails,
  FileTextSummarySection,
  Metric,
  Notice,
  Status,
  formatDateTime,
  formatInteger,
  formatMetric,
  formatRetention,
} from "@footprint/ui";
import type { Navigate } from "./router";
import type { ServerFeatures } from "./admin/features";
import { PANEL_WEBSITE_LINK, stayOnWebsite } from "./admin-hint";
import { ErrorState, Loading } from "./status";
import type {
  CalculationMethod,
  HistorySummary,
  Series,
  Summary,
} from "./types";
import { previousMonthRange } from "@footprint/ui/dates";
import { comparableTotal } from "@footprint/ui/totals";

type NavItem = readonly [to: string, label: string, icon: IconName];
type NavGroup = readonly [group: string, items: readonly NavItem[]];

// Grouped as on the canvas boards (AdminOverview sidebar). Requests and Network appear only while
// the server has person analytics (and, for Network, IP collection) switched on; see
// admin/features.ts.
function adminGroups(features?: ServerFeatures): readonly NavGroup[] {
  const people = features?.person_analytics === true;
  const network = people && features?.ip_collection === true;
  return [
    [
      "Insights",
      [
        ["/admin", "Overview", "overview"],
        ["/admin/tools", "Tools and models", "layers"],
        ["/admin/people", "People", "user"],
        ["/admin/activity", "Activity", "message"],
        ...(people ? ([["/admin/requests", "Requests", "list"]] as const) : []),
      ],
    ],
    [
      "Operations",
      [
        ["/admin/health", "Health", "gauge"],
        ...(network ? ([["/admin/network", "Network", "link"]] as const) : []),
      ],
    ],
    [
      "Governance",
      [
        ["/admin/policies", "Policies and data", "shield"],
        ["/admin/deletions", "Deletion", "trash"],
        ["/admin/audit", "Audit log", "list"],
        ["/admin/plan", "Plan", "building"],
      ],
    ],
  ];
}
// One Service group, as on the developer panel boards (OpOrgs sidebar).
const operatorGroups: readonly NavGroup[] = [
  [
    "Service",
    [
      ["/operator", "Organizations", "building"],
      ["/operator/contacts", "Contact requests", "mail"],
      ["/operator/plans", "Plans", "panel"],
      ["/operator/exceptions", "Exceptions", "sliders"],
      ["/operator/health", "Health and audit", "gauge"],
    ],
  ],
];

/** The shell's organization name, shown above each page title. */
const ShellContext = createContext<{ company?: string | null }>({});

function current(path: string, to: string) {
  return to === "/admin" || to === "/operator" ? path === to : path === to || path.startsWith(to + "/");
}

export function AppLayout({
  mode,
  path,
  company,
  email,
  children,
  navigate,
  onLogout,
  logoutError,
  logoutPending = false,
  badges,
  features,
}: {
  mode: "admin" | "operator";
  /** The server's operator switches; they add the per-person pages to the admin navigation. */
  features?: ServerFeatures;
  /** Counts shown beside nav items, keyed by path; zero hides the badge. */
  badges?: Readonly<Record<string, number>>;
  path: string;
  company?: string | null;
  /** The signed-in work email, shown beside Sign out. */
  email?: string | null;
  children: ReactNode;
  navigate: Navigate;
  onLogout: () => void | Promise<void>;
  logoutError?: unknown;
  logoutPending?: boolean;
}) {
  const groups = mode === "admin" ? adminGroups(features) : operatorGroups;
  const role = mode === "admin" ? "Organization admin" : "Developer panel";
  const home = mode === "admin" ? "/admin" : "/operator";
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null),
    drawerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    drawerRef.current?.querySelector<HTMLElement>("a,button")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        toggleRef.current?.focus();
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = [
        ...drawerRef.current.querySelectorAll<HTMLElement>(
          "a,button:not(:disabled)",
        ),
      ];
      const first = focusable[0],
        last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open]);
  const go = (to: string) => (event: { preventDefault(): void }) => {
    event.preventDefault();
    setOpen(false);
    navigate(to);
  };
  // In the admin panel the logo opens the Overview and Main website below the navigation opens the
  // public site (owner, 16 October 2026). The developer panel's logo still opens the public
  // website (owner, 12 October 2026).
  const logo =
    mode === "admin"
      ? { href: home, label: `AI Footprint ${role}, Overview`, onClick: go(home) }
      : { href: PUBLIC_WEBSITE, label: `AI Footprint Tracker website, ${role}` };
  const brand = (
    <a className="brand" href={logo.href} aria-label={logo.label} onClick={logo.onClick}>
      <LivingGaugeMark size={28} className="brand-mark" />
      <span className="brand-lines">
        <b>AI Footprint</b>
        <small>{role}</small>
      </span>
    </a>
  );
  const nav = (
    <>
      {groups.map(([group, items]) => (
        <div className="nav-group" key={group}>
          <span>{group}</span>
          <nav aria-label={group}>
            {items.map(([to, label, icon]) => (
              <a
                key={to}
                href={to}
                className="nav-item"
                aria-current={current(path, to) ? "page" : undefined}
                onClick={go(to)}
              >
                <Icon name={icon} size={18} />
                {label}
                {Boolean(badges?.[to]) && (
                  <span className="nav-badge">
                    {badges![to]}
                    <span className="ad-hidden"> new</span>
                  </span>
                )}
              </a>
            ))}
          </nav>
        </div>
      ))}
      {mode === "admin" && (
        <div className="nav-group nav-website">
          <nav aria-label="Website">
            <a
              href={PANEL_WEBSITE_LINK}
              className="nav-item"
              onClick={(event) => {
                event.preventDefault();
                setOpen(false);
                // The home page would otherwise send a signed-in administrator back to the panel.
                stayOnWebsite();
                navigate("/");
              }}
            >
              <Icon name="external" size={18} />
              Main website
            </a>
          </nav>
        </div>
      )}
    </>
  );
  const signOut = (
    <Button onClick={onLogout} disabled={logoutPending}>
      {logoutPending
        ? "Signing out…"
        : logoutError
          ? "Try sign out again"
          : "Sign out"}
    </Button>
  );
  return (
    <ShellContext.Provider value={{ company }}>
      <div className="app-shell">
        <aside aria-label={`${mode} navigation`}>
          {brand}
          {nav}
          <div className="sidebar-bottom">
            {email && <small>{email}</small>}
            {signOut}
          </div>
        </aside>
        {open && (
          <>
            <button
              className="mobile-drawer-backdrop"
              aria-label="Close navigation"
              onClick={() => {
                setOpen(false);
                toggleRef.current?.focus();
              }}
            />
            <div
              ref={drawerRef}
              id="mobile-admin-nav"
              className="mobile-drawer"
              data-open
              role="dialog"
              aria-modal="true"
              aria-label={`${mode} navigation`}
            >
              <div className="mobile-drawer-head">
                {brand}
                <Button
                  variant="quiet"
                  onClick={() => {
                    setOpen(false);
                    toggleRef.current?.focus();
                  }}
                >
                  Close
                </Button>
              </div>
              {nav}
              <div className="sidebar-bottom">
                {email && <small>{email}</small>}
                {signOut}
              </div>
              {Boolean(logoutError) && (
                <ErrorState
                  error={logoutError}
                  context="action"
                  title="Sign out failed"
                />
              )}
            </div>
          </>
        )}
        <div className="app-main">
          <header className="app-top">
            <a className="brand" href={logo.href} aria-label={logo.label} onClick={logo.onClick}>
              <LivingGaugeMark size={26} className="brand-mark" />
            </a>
            <span className="app-top-name">
              {company ?? (mode === "operator" ? "Developer panel" : "")}
            </span>
            <button
              ref={toggleRef}
              className="mobile-menu"
              aria-expanded={open}
              aria-controls="mobile-admin-nav"
              onClick={() => setOpen((value) => !value)}
            >
              Menu
            </button>
          </header>
          {!open && Boolean(logoutError) && (
            <ErrorState
              error={logoutError}
              context="action"
              title="Sign out failed"
            />
          )}
          <main className="app-content">{children}</main>
          <p className="app-credit">
            Designed and built by{" "}
            <a href="https://www.linkedin.com/in/pranitnale/" target="_blank" rel="noopener noreferrer">
              Pranit Nale
            </a>
          </p>
        </div>
      </div>
    </ShellContext.Provider>
  );
}

export function PageTitle({
  title,
  children,
  actions,
  eyebrow,
}: {
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  /** Above the title; the organization name by default (canvas admin boards). */
  eyebrow?: ReactNode;
}) {
  const { company } = useContext(ShellContext);
  const above = eyebrow ?? company;
  return (
    <div className="page-title">
      <div>
        {above && <span className="eyebrow">{above}</span>}
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export { ErrorState, Loading };

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="empty-state">
      <h2>{title}</h2>
      <p>{children}</p>
    </section>
  );
}

export function Filters({
  values,
  onChange,
  includeUser = false,
  users = [],
  calculationMethods = [],
  timezone,
  now,
}: {
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  includeUser?: boolean;
  users?: { user_id: string; email: string | null }[];
  calculationMethods?: CalculationMethod[];
  timezone?: string;
  now?: Date;
}) {
  const [draft, setDraft] = useState(values);
  useEffect(() => setDraft(values), [JSON.stringify(values)]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = Object.fromEntries(
      Object.entries(draft).filter(([, value]) => Boolean(value)),
    );
    if (next._period_preset === "last_month") {
      if (!timezone) return;
      const range = previousMonthRange(timezone, now);
      next.period = "custom";
      next.start = range.start;
      next.end = range.end;
    } else if (next.period !== "custom") {
      delete next.start;
      delete next.end;
    }
    onChange(next);
  }
  return (
    <form className="filters" onSubmit={submit}>
      <label>
        Period
        <select
          name="period"
          value={draft._period_preset || draft.period || "month"}
          onChange={(event) => {
            const selected = event.target.value;
            setDraft({
              ...draft,
              period: selected,
              _period_preset: selected === "last_month" ? selected : "",
            });
          }}
        >
          <option value="week">This week</option>
          <option value="month">This month</option>
          <option value="last_month">Last month</option>
          <option value="all">All retained time</option>
          <option value="custom">Custom dates</option>
        </select>
      </label>
      <label>
        Start
        <input
          name="start"
          type="date"
          value={draft.start || ""}
          onChange={(event) =>
            setDraft({
              ...draft,
              start: event.target.value,
              period: "custom",
              _period_preset: "",
            })
          }
        />
      </label>
      <label>
        End
        <input
          name="end"
          type="date"
          value={draft.end || ""}
          onChange={(event) =>
            setDraft({
              ...draft,
              end: event.target.value,
              period: "custom",
              _period_preset: "",
            })
          }
        />
      </label>
      <label>
        Tool
        <select
          name="site"
          value={draft.site || ""}
          onChange={(event) => setDraft({ ...draft, site: event.target.value })}
        >
          <option value="">All tools</option>
          <option value="chatgpt">ChatGPT</option>
          <option value="claude">Claude</option>
          <option value="gemini">Gemini</option>
          <option value="perplexity">Perplexity</option>
          <option value="notebooklm">NotebookLM</option>
        </select>
      </label>
      {includeUser && (
        <label>
          User
          <select
            name="user_id"
            value={draft.user_id || ""}
            onChange={(event) =>
              setDraft({ ...draft, user_id: event.target.value })
            }
          >
            <option value="">All users</option>
            {users.map((user) => (
              <option value={user.user_id} key={user.user_id}>
                {user.email ?? user.user_id}
              </option>
            ))}
          </select>
        </label>
      )}
      {calculationMethods.length > 0 && (
        <label>
          Calculation view
          <select
            name="calculation_view"
            value={
              draft.calculation_view === "recalculated"
                ? draft.method_id
                : "original"
            }
            onChange={(event) =>
              setDraft(
                event.target.value === "original"
                  ? {
                      ...draft,
                      calculation_view: "original",
                      method_id: "",
                    }
                  : {
                      ...draft,
                      calculation_view: "recalculated",
                      method_id: event.target.value,
                    },
              )
            }
          >
            <option value="original">Original recorded calculations</option>
            {calculationMethods.map((method) => (
              <option key={method.method_id} value={method.method_id}>
                Recalculated: {method.method_id}
              </option>
            ))}
          </select>
        </label>
      )}
      <Button
        variant="primary"
        type="submit"
        disabled={draft._period_preset === "last_month" && !timezone}
      >
        Apply filters
      </Button>
    </form>
  );
}

function series(summary: Summary, quantity: string): Series[] {
  return summary.resources?.filter((item) => item.quantity === quantity) ?? [];
}

export function SummaryMetrics({ summary }: { summary: Summary }) {
  if (summary.suppressed)
    return (
      <Notice tone="warning" title="Company totals are hidden">
        <p>{summary.safe_message}</p>
        <p>No small-group value is shown.</p>
      </Notice>
    );
  const energy = series(summary, "energy"),
    carbon = series(summary, "carbon"),
    water = series(summary, "water_total");
  return (
    <>
      <div className="metrics">
        <Metric
          label="Requests"
          value={formatInteger(summary.request_count)}
          detail={
            summary.unresolved_request_count &&
            summary.unresolved_request_count !== "0"
              ? `${summary.unresolved_request_count} unresolved`
              : "Recorded requests"
          }
        />
        <Metric
          label="Electricity estimate"
          value={groupValue(energy, "kWh")}
          detail={metricDetail(energy)}
        />
        <Metric
          label="Carbon estimate"
          value={groupValue(carbon, "gCO2e")}
          detail={metricDetail(carbon)}
        />
        <Metric
          label="Water estimate"
          value={groupValue(water, "L")}
          detail={metricDetail(water)}
        />
      </div>
      <p className="coverage">
        Operational estimates only. Unknown values are unavailable, not zero.{" "}
        {summary.pending_estimates &&
          summary.pending_estimates !== "0" &&
          `${summary.pending_estimates} estimates are still processing. `}
        {summary.generated_at && (
          <>Updated {formatDateTime(summary.generated_at)}.</>
        )}
      </p>
      {summary.history && <HistoricalAggregate history={summary.history} />}
      <div className="two-columns detail-grid">
        <section className="panel">
          <h2>Search coverage</h2>
          <dl>
            <Row
              label="Observed search operations"
              value={formatInteger(summary.observed_search_operations)}
            />
            <Row
              label="Requests with known search count"
              value={formatInteger(summary.search_known_request_count)}
            />
            <Row
              label="Requests with unknown search count"
              value={formatInteger(summary.search_unknown_request_count)}
            />
          </dl>
        </section>
        <section className="panel">
          <h2>Observed media counts</h2>
          {summary.media_counts?.length ? (
            <dl>
              {summary.media_counts.map((item, index) => (
                <Row
                  key={`${item.quantity}-${item.scope}-${index}`}
                  label={`${item.quantity.replaceAll("_", " ")} (${item.scope.replaceAll("_", " ")})`}
                  value={formatInteger(item.value)}
                />
              ))}
            </dl>
          ) : (
            <p>No media count was observed in this view.</p>
          )}
        </section>
      </div>
      <FileTextSummarySection
        fileText={summary.file_text}
        coverage={summary.file_text_coverage}
        className="panel file-text-summary"
      />
      {[...energy, ...carbon, ...water].length > 0 && (
        <div className="series-groups">
          <h2>Calculation groups</h2>
          {[...energy, ...carbon, ...water].map((item, index) => (
            <div key={`${item.quantity}-${item.scope}-${item.unit}-${index}`}>
              <strong>{item.quantity.replaceAll("_", " ")}</strong>
              <span>
                {formatMetric(item.value, item.unit)} ·{" "}
                {item.scope.replaceAll("_", " ")} ·{" "}
                {item.contributing_attempt_count} included ·{" "}
                {item.unknown_count} unknown · {item.partial_count} partial ·{" "}
                {item.unvalidated_count} unvalidated
              </span>
              {item.reason_counts &&
                Object.keys(item.reason_counts).length > 0 && (
                  <small>
                    Limitations: {formatReasonCounts(item.reason_counts)}
                  </small>
                )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function HistoricalAggregate({ history }: { history: HistorySummary }) {
  if (history.status !== "available")
    return (
      <section className="panel historical-aggregate">
        <h2>Imported visible history</h2>
        <p>
          {history.status === "empty"
            ? "No historical messages are loaded in this view. Earlier provider activity remains unknown."
            : "Loaded historical activity is unavailable. This does not mean the provider performed zero work."}
        </p>
      </section>
    );
  return (
    <section className="panel historical-aggregate">
      <h2>Imported visible history</h2>
      <p>
        <strong>Partially calculated.</strong> Loaded prompts are historical
        message evidence, not observed API calls. These values remain separate
        from recorded live totals.
      </p>
      <dl>
        <Row
          label="Loaded prompts"
          value={formatInteger(history.observed_prompt_count)}
        />
        <Row
          label="Loaded responses"
          value={formatInteger(history.observed_response_count)}
        />
        <Row
          label="Imported prompt contributions"
          value={formatInteger(history.prompt_count)}
        />
        <Row
          label="Imported response contributions"
          value={formatInteger(history.response_count)}
        />
        <Row
          label="Calculated messages"
          value={formatInteger(history.calculated_message_count)}
        />
        <Row
          label="Messages awaiting calculation"
          value={formatInteger(history.uncalculated_message_count)}
        />
        <Row
          label="Messages with a source date"
          value={formatInteger(history.dated_message_count)}
        />
        <Row
          label="Messages with an unknown date"
          value={formatInteger(history.undated_message_count)}
        />
        <Row
          label="Matched to recorded live activity"
          value={formatInteger(history.matched_live_message_count)}
        />
        <Row
          label="Unresolved live overlap"
          value={formatInteger(history.unresolved_overlap_message_count)}
        />
      </dl>
      {history.tokens.map((item, index) => (
        <p
          key={`${item.role}-${item.part}-${item.profile_id ?? "unknown"}-${index}`}
        >
          {item.part === "image_input_tokens"
            ? "Uploaded images in loaded prompts"
            : item.part === "tool_output"
              ? "Tool results read by loaded responses"
              : item.part === "other_models"
                ? "Output of other models in loaded responses"
                : item.role === "prompt"
                  ? "Loaded prompt text"
                  : "Loaded response output"}
          :{" "}
          {item.value === null
            ? "Unknown"
            : `≈ ${formatInteger(item.value)} tokens`}
          . {formatInteger(item.known_message_count)} calculated;{" "}
          {formatInteger(item.unknown_message_count)} unknown.
        </p>
      ))}
      <FileTextSummarySection
        fileText={history.file_text}
        coverage={{
          observed_request_count:
            history.file_text_coverage.observed_message_count,
          unknown_request_count:
            history.file_text_coverage.unknown_message_count,
          scope: "extracted_file_text",
          additive: false,
        }}
        coverageLabel="Historical messages"
        headingLevel={3}
        className="historical-file-text"
      />
      {history.resources.map((item, index) => (
        <div key={`${item.quantity}-${item.method_hash}-${index}`}>
          <p>
            {item.quantity.replaceAll("_", " ")}:{" "}
            {formatMetric(item.value, item.unit)}.{" "}
            {item.status === "partial_estimate"
              ? "Partial estimate for visible historical responses."
              : "Unavailable for visible historical responses."}
          </p>
          <small>
            Recorded calculation method: {item.method_id}. Method hash:{" "}
            {item.method_hash}. Selected profile:{" "}
            {item.selected_profile_id ?? "Unavailable"}. Missing components:{" "}
            {item.missing_components.length
              ? item.missing_components
                  .map((value) => value.replaceAll("_", " "))
                  .join(", ")
              : "None recorded"}
            .
          </small>
        </div>
      ))}
      <p>
        {history.first_request_verified
          ? "First available request loaded. This verifies the reviewed source boundary, not every alternative branch or complete provider execution history."
          : "The first available request has not been verified. More earlier messages may still load."}
      </p>
      <p>
        Imported contributions exclude messages already matched to immutable
        live records and conflicting messages. Loaded counts still include those
        messages, with overlap and conflicts disclosed separately.
      </p>
      <p>
        Source-reported message, entry or turn dates may predate enrollment;
        they are not observed dispatch or response completion times.
        Unknown-date history is included only in all-time and conversation
        history views. Imported numeric history is kept beyond hosted age
        retention until deletion.
      </p>
      <p>
        Historical estimates stay pinned to their recorded calculation method
        and profile; changing the live recalculation view does not relabel them.{" "}
        <a href="/methodology#method-models">
          Review the methodology and source catalog
        </a>
        .
      </p>
    </section>
  );
}
// Series are kept per model; series calculated alike add up, so a company using several
// models still sees one total (D4).
function groupValue(items: Series[], fallbackUnit: string) {
  if (!items.length) return "Unknown";
  const total = comparableTotal(items);
  return total.multiple
    ? "Multiple groups"
    : formatMetric(total.value, total.unit || items[0]!.unit || fallbackUnit);
}
function metricDetail(items: Series[]) {
  if (!items.length) return "No compatible estimate";
  if (comparableTotal(items).multiple) return "See separate scopes below";
  const count = (field: "contributing_attempt_count" | "unknown_count") =>
    items.reduce((sum, item) => sum + BigInt(item[field]), 0n);
  return `${count("contributing_attempt_count")} included, ${count("unknown_count")} unknown`;
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function formatReasonCounts(values: Record<string, number | string>) {
  const entries = Object.entries(values);
  return entries.length
    ? entries
        .map(
          ([reason, count]) =>
            `${reason.replaceAll("_", " ")} (${formatInteger(count)})`,
        )
        .join(", ")
    : "No additional reason recorded";
}

export function DataTable({
  headers,
  rows,
  empty = "No records match this view.",
}: {
  headers: string[];
  rows: ReactNode[][];
  empty?: string;
}) {
  if (!rows.length)
    return <EmptyState title="Nothing to show">{empty}</EmptyState>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({
  previous,
  next,
  hasPrevious,
  hasNext,
  loading,
}: {
  previous: () => void;
  next: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
  loading?: boolean;
}) {
  return (
    <nav className="pagination" aria-label="Result pages">
      <Button onClick={previous} disabled={!hasPrevious || loading}>
        Previous page
      </Button>
      <Button onClick={next} disabled={!hasNext || loading}>
        Next page
      </Button>
    </nav>
  );
}

export function useDialogFocus(open: boolean, onClose: () => void) {
  const previous = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    previous.current = document.activeElement as HTMLElement;
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handle);
    document
      .querySelector<HTMLElement>(
        ".dialog button, .dialog input, .dialog select",
      )
      ?.focus();
    return () => {
      document.removeEventListener("keydown", handle);
      previous.current?.focus();
    };
  }, [open, onClose]);
}

export {
  Brand,
  Button,
  Dialog,
  ExtractedFileTextDetails,
  FileTextSummarySection,
  Metric,
  Notice,
  Status,
  formatDateTime,
  formatInteger,
  formatMetric,
  formatRetention,
};
