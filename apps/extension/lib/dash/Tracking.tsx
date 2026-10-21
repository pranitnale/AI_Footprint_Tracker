import { formatInteger } from "@footprint/ui/formatters";
import { Icon } from "@footprint/ui/icons";
import { browser } from "wxt/browser";
import { isActionable, isNote, isOpenProblem, isPageEvent, type TrackingHealthIssue } from "../health";
import { ageText, SITE_LABELS } from "../ui/components";
import { lastReplyAt } from "../ui/figure-math";
import { useBreakdown } from "./Overview";
import type { PageContext } from "./Dashboard";

const ORDER = ["chatgpt", "claude", "gemini", "perplexity", "notebooklm"] as const;

/** Plain explanations per problem code; anything unlisted gets the general text. */
const PROBLEMS: Record<string, { title: (n: number) => string; what: string; fix: string }> = {
  protocol_unsupported: {
    title: (n) => `${formatInteger(n)} ${n === 1 ? "reply" : "replies"} not counted`,
    what: "The page changed while an answer was still arriving, or the site sent it in a form the tracker does not read yet, so the tracker missed that reply.",
    fix: "open the chat again or reload it. The tracker reads the chat again and adds the reply.",
  },
  capture_hook_missing: {
    title: () => "An open AI tab stopped reporting replies",
    what: "The tracker lost its connection to an open AI tab, often after the extension updated.",
    fix: "reload the AI tab. New replies are counted again from then on.",
  },
  storage_write_failed: {
    title: () => "New usage could not be saved",
    what: "This browser refused to store new records, for example because its storage is full.",
    fix: "free some disk space or browser storage, then restart the browser.",
  },
  sync_delayed: {
    title: () => "Usage is waiting to sync",
    what: "Your organization's server did not answer, so records wait in this browser.",
    fix: "nothing. They are sent automatically when the server answers, or use Sync now.",
  },
  // A refusal is final, so it is reported here once instead of as records waiting to sync.
  revision_conflict: {
    title: () => "Your organization's server refused some updates",
    what: "The server already held an earlier version of these replies and did not accept the newer one, so its figures for them can be lower than the ones in this browser. Your records stay in this browser.",
    fix: "nothing in this browser. Copy the details for your administrator if the organization's figures look too low.",
  },
  payload_rejected: {
    title: () => "Your organization's server refused some records",
    what: "The server did not accept these records in the form this version of the tracker sends, so they are missing from the organization's figures. Your records stay in this browser.",
    fix: "update the extension. Copy the details for your administrator if it keeps happening.",
  },
  auth_reconnect_required: {
    title: () => "The organization connection needs renewing",
    what: "Your organization asked this browser to sign in again. Your records stay in this browser.",
    fix: "connect again from Settings.",
  },
  enrollment_revoked: {
    title: () => "Organization access was removed",
    what: "An administrator removed this browser from the organization. Your records stay in this browser.",
    fix: "ask your administrator, or keep using personal mode.",
  },
  policy_unavailable: {
    title: () => "Organization rules could not be checked",
    what: "The tracker could not confirm your organization's rules, so sharing waits.",
    fix: "check the connection and try again later.",
  },
};
const GENERAL = {
  title: () => "Something needs a look",
  what: "The tracker hit a problem it could not solve on its own. Recorded data was kept.",
  fix: "reload the AI tab. If it comes back, copy the details for support.",
};

function when(at: number, now: number) {
  const date = new Date(at);
  const today = new Date(now).toDateString() === date.toDateString();
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(date);
  return today ? `today, ${time}` : `${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(date).replace("Sept", "Sep")}, ${time}`;
}

/** The support text holds the problem code, times and versions only, never chat text or addresses. */
export function supportText(issue: TrackingHealthIssue, version: string | null) {
  return [
    `AI Footprint Tracker${version ? ` ${version}` : ""}`,
    `Problem: ${issue.code}`,
    `First seen: ${new Date(issue.firstAt).toISOString()}`,
    `Last seen: ${new Date(issue.lastAt).toISOString()}`,
    // Only a problem not seen since its success counts as resolved.
    ...(issue.state === "resolved" && issue.resolvedAt !== null ? [`Resolved: ${new Date(issue.resolvedAt).toISOString()}`] : []),
    `Times: ${issue.count}`,
    `Kept: ${issue.persistence}`,
  ].join("\n");
}

function Problem({ issue, now, version, notify }: { issue: TrackingHealthIssue; now: number; version: string | null; notify: (text: string) => void }) {
  const text = PROBLEMS[issue.code] ?? GENERAL;
  const solved = issue.state === "resolved" && issue.resolvedAt !== null;
  const note = isNote(issue);
  return (
    <li className="tr-problem">
      <span className="tr-problem-icon" aria-hidden="true">
        <Icon name={solved || note ? "check" : "alert"} size={18} />
      </span>
      <div className="tr-problem-body">
        <b>{text.title(issue.count)}</b>
        <p>{text.what}</p>
        {/* A solved problem or a note needs nothing from the person. */}
        {!solved && !note && (
          <p>
            <b>What you can do:</b> {text.fix}
          </p>
        )}
        <small className="dh-soft">
          Last seen {when(issue.lastAt, now)} · {formatInteger(issue.count)} {issue.count === 1 ? "time" : "times"}
          {solved
            ? ` · Solved ${when(issue.resolvedAt!, now)}`
            : note
              ? " · Nothing to fix in this browser"
              : issue.state === "inactive"
                ? " · Not seen for 3 days"
                : ""}
        </small>
      </div>
      <button
        type="button"
        className="lg-btn lg-btn-secondary lg-btn-sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(supportText(issue, version));
            notify("Copied for support, without chat text");
          } catch {
            notify("The browser did not allow copying. Select the details and copy them by hand.");
          }
        }}
      >
        <Icon name="copy" size={14} />
        Copy for support
      </button>
    </li>
  );
}

export function Tracking({ ctx }: { ctx: PageContext }) {
  const { dashboard } = ctx;
  const all = useBreakdown(ctx, { bucket: "day" });
  const now = ctx.now.getTime();
  // Open: seen in the last 3 days and not solved since (owner decision of 16 October 2026).
  // Page events are always earlier: only the open tab knows whether one still applies. Notes
  // are facts nothing in this browser can fix, so they are never open either.
  const issues = dashboard.health.filter(isActionable);
  const earlier = dashboard.health.filter((issue) => !isActionable(issue));
  const pageEventsOpen = earlier.some((issue) => isPageEvent(issue) && isOpenProblem(issue));
  const closedEarlier = earlier.some((issue) => !isPageEvent(issue));
  const version = (() => {
    try {
      return browser.runtime.getManifest().version;
    } catch {
      return null;
    }
  })();

  return (
    <>
      <div className="tr-sites">
        {ORDER.map((site) => {
          const last = all.data ? lastReplyAt(all.data, site) : null;
          // A reply counted from a saved chat does not show that live reading works: the latest
          // live reply decides (live QA, 19 Oct 2026, when ChatGPT replies were missed live but
          // counted from history and the page still said Working).
          const missed = all.data?.siteLastMissed?.[site];
          const state = all.data ? (missed ? "missed" : last ? "ok" : "unused") : "loading";
          return (
            <section key={site} className="dh-card tr-site" aria-labelledby={`tr-${site}`}>
              <div className="tr-site-head">
                <h2 id={`tr-${site}`}>{SITE_LABELS[site]}</h2>
                <span className={`tr-badge tr-badge-${state}`} aria-hidden="true">
                  <Icon name={state === "ok" ? "check" : state === "missed" ? "alert" : state === "unused" ? "range" : "clock"} size={14} />
                </span>
              </div>
              <b className="tr-state">
                {state === "ok" ? "Working" : state === "missed" ? "Last reply not read" : state === "unused" ? "Not used yet" : "Checking"}
              </b>
              <p className="dh-soft">
                {state === "ok" && last
                  ? `Last reply read ${ageText(last, now)}.`
                  : state === "missed"
                    ? `The last reply, ${ageText(Date.parse(missed!), now)}, could not be read while it arrived. It is counted once the saved chat is read. If this repeats, reload the ${SITE_LABELS[site]} tab.`
                    : state === "unused"
                      ? `Open ${SITE_LABELS[site]} to start.`
                      : ""}
              </p>
            </section>
          );
        })}
      </div>

      <section className="dh-card" aria-labelledby="tr-open">
        <h2 id="tr-open" className="lg-display">
          Open problems
        </h2>
        {issues.length === 0 ? (
          <p className="tr-none">
            <Icon name="check" size={16} />
            No open problems. Every reply seen in this browser was read.
          </p>
        ) : (
          <ul className="tr-problems">
            {issues.map((issue) => (
              <Problem key={`${issue.scope}-${issue.code}-${issue.firstAt}`} issue={issue} now={now} version={version} notify={ctx.notify} />
            ))}
          </ul>
        )}
      </section>

      {/* Closed until the person opens it (owner decision of 16 October 2026, evening). */}
      {earlier.length > 0 && (
        <details className="dh-card tr-earlier">
          <summary>
            <h2 id="tr-earlier" className="lg-display">
              Earlier problems
            </h2>
            <span className="tr-earlier-count">{formatInteger(earlier.length)}</span>
            <Icon name="chevronDown" size={18} className="tr-earlier-chevron" />
          </summary>
          <div className="tr-earlier-body">
          {pageEventsOpen && <p className="dh-soft">These happened on an AI page. Click the extension icon while the page is open to see whether one still applies there.</p>}
          {closedEarlier && <p className="dh-soft">Problems solved when the same work succeeded again, notes nothing in this browser can fix, and problems not seen for 3 days are kept here for support.</p>}
          <ul className="tr-problems">
            {earlier.map((issue) => (
              <Problem key={`${issue.scope}-${issue.code}-${issue.firstAt}`} issue={issue} now={now} version={version} notify={ctx.notify} />
            ))}
          </ul>
          </div>
        </details>
      )}
    </>
  );
}
