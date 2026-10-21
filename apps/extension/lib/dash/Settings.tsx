import { useEffect, useMemo, useState } from "react";
import type { DisplayScenario } from "@footprint/contracts";
import { formatInteger, metricParts } from "@footprint/ui/formatters";
import { Icon } from "@footprint/ui/icons";
import { browser } from "wxt/browser";
import { SCENARIO_NAMES, Segmented } from "../ui/components";
import { currentTheme, saveTheme, type ThemeChoice } from "../ui/theme";
import { dashWindow, dayText } from "../ui/dash-periods";
import { writePreference } from "../ui/preferences";
import { partKeys, requestsPhrase, totalFigures } from "../ui/figure-math";
import { DisconnectDialog, EraseDialog, OrganizationTermsList, PauseDialog, ScenarioDialog, TurnOffDialog } from "./dialogs";
import { DEFAULT_FEATURES, organizationPolicyLines, organizationTerms } from "../organization-terms";
import { LocalSummaryCard, useBreakdown } from "./Overview";
import type { PageContext } from "./Dashboard";
import { connectionEndedText, isHostedOrigin, organizationName, sharingText, syncedText } from "../dashboard/organization";
import { clearLastView } from "../popup/last-view";
import { DEFAULT_TIP_REQUEST_LIMIT, longChatTipSettings, validTipRequestLimit } from "../long-chat-tip";
import { OWN_READ_SETTING_KEYS, OWN_READ_SETTING_NAMES, ownReadSettings } from "../own-read-settings";
import { consentRequired, trackingConsent } from "../tracking-consent";
import { openWelcomePage } from "../ui/navigation";

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/** Light, dark or the device's setting for the popup and dashboard. */
function Appearance({ notify }: { notify: (text: string) => void }) {
  const [theme, setTheme] = useState<ThemeChoice>(currentTheme);
  // Another open extension page can change it too.
  useEffect(() => {
    const follow = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      const next = (changes["ui:theme"]?.newValue as { choice?: unknown } | undefined)?.choice;
      if (area === "local" && (next === "light" || next === "dark" || next === "system")) setTheme(next);
    };
    try {
      browser.storage.onChanged.addListener(follow);
      return () => browser.storage.onChanged.removeListener(follow);
    } catch {
      return undefined;
    }
  }, []);
  return (
    <section className="dh-card st-row" aria-labelledby="st-theme">
      <div>
        <h2 id="st-theme" className="lg-display">
          Appearance
        </h2>
        <p className="dh-soft">For the popup and dashboard. The bar on AI sites follows each site.</p>
      </div>
      <Segmented
        label="Appearance"
        options={THEMES}
        value={theme}
        onChange={(choice) => {
          setTheme(choice);
          void saveTheme(choice);
          notify(choice === "system" ? "Pages now follow your device" : `Pages now use the ${choice} theme`);
        }}
      />
    </section>
  );
}

const SCENARIOS: { key: DisplayScenario; hint: string; at: number }[] = [
  { key: "minimum", hint: "The low end of each range.", at: 0 },
  { key: "midpoint", hint: "Halfway between the low and the high end. The default.", at: 50 },
  { key: "maximum", hint: "The high end of each range. The most cautious view.", at: 100 },
];

function partsFrom(value: string | null, unit: string) {
  const parts = metricParts(value, unit);
  return parts ? `${parts.number} ${parts.unit}` : null;
}

function extensionVersion() {
  try {
    return browser.runtime.getManifest().version;
  } catch {
    return null;
  }
}

/** "18 October 2026" in the person's time zone, for when they agreed. */
function agreedOn(at: number, timezone: string) {
  try {
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: timezone }).format(at);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(at);
  }
}

/**
 * Sharing is held because the organization's server collects or shows more than the text the
 * person agreed to (lib/organization-terms.ts). The full text and its own agreement, in Settings
 * rather than on the bar (AGENTS.md, compact bar).
 */
function OrganizationReview({ ctx, name }: { ctx: PageContext; name: string }) {
  const company = ctx.dashboard.company;
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!company?.consent_version) return null;
  const version = company.consent_version;
  return (
    <section className="st-review" aria-labelledby="st-review-title">
      <h3 id="st-review-title" className="st-review-title">
        <Icon name="alert" size={16} />
        Sharing with {name} is on hold
      </h3>
      <p>
        Your organization's server is set up to collect or show more than the text you agreed to. Nothing new is shared until you agree to the text below. Your records wait in this browser.
      </p>
      <OrganizationTermsList terms={organizationTerms(company.features ?? DEFAULT_FEATURES, company.policy)} id="st-review" />
      <label className="lg-ack lg-ack-agree">
        <input type="checkbox" checked={agreed} disabled={busy} onChange={(event) => setAgreed(event.target.checked)} />
        I agree to share this browser's AI use with {name} as described.
      </label>
      {error && (
        <p className="lg-dialog-error" role="alert">
          {error}
        </p>
      )}
      <div>
        <button
          type="button"
          className="lg-btn lg-btn-primary"
          disabled={busy || !agreed}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await ctx.client.agreeOrganization(version);
              ctx.notify(`Sharing with ${name} resumes`);
              await ctx.reload();
            } catch (caught) {
              setError(caught instanceof Error && caught.message ? caught.message : "The agreement could not be saved.");
              // The text may have changed, so a new agreement needs a new tick.
              setAgreed(false);
              await ctx.reload();
            } finally {
              setBusy(false);
            }
          }}
        >
          Agree and share
        </button>
      </div>
    </section>
  );
}

function zones(current: string) {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
    return list.includes(current) ? list : [current, ...list];
  } catch {
    return [current];
  }
}

export function Settings({ ctx }: { ctx: PageContext }) {
  const { dashboard, client } = ctx;
  const settings = dashboard.settings;
  const connected = dashboard.mode === "company";
  const pauseLocked = connected && dashboard.company?.policy.pause_mode === "disabled_by_company";
  const month = useBreakdown(ctx, dashWindow({ kind: "30d" }, settings.timezone, ctx.now));
  const all = useBreakdown(ctx, { bucket: "day" });
  const [ask, setAsk] = useState<null | { kind: "scenario"; to: DisplayScenario } | { kind: "pause" } | { kind: "erase" } | { kind: "disconnect" } | { kind: "turn-off" }>(null);
  const [budget, setBudget] = useState(settings.budget ? String(settings.budget) : "");
  const tip = longChatTipSettings(settings);
  const olderChats = ownReadSettings(settings);
  const [requestLimit, setRequestLimit] = useState(String(tip.contextTipRequestLimit));
  const [error, setError] = useState<{ field: string; text: string } | null>(null);
  const [changed, setChanged] = useState(false);
  const detected = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  const figure = month.data ? totalFigures(month.data, settings.displayScenario).energy : null;
  const scenarioValue = (key: DisplayScenario) => {
    if (!figure) return null;
    const value = key === "minimum" ? figure.low : key === "midpoint" ? figure.mid : figure.high;
    return partsFrom(value ?? (key === settings.displayScenario ? figure.value : null), figure.unit);
  };
  const days = all.data ? partKeys(all.data, "buckets").sort() : [];
  const allFigures = all.data ? totalFigures(all.data, settings.displayScenario) : null;
  const saved = allFigures ? allFigures.requestsText : formatInteger(dashboard.summary.requests);
  const since = days[0] ? dayText(days[0]) : null;
  const methodId = month.data?.calculation.methodId ?? null;
  const ecologits = methodId?.match(/^ecologits-(.+)$/)?.[1] ?? null;
  const name = organizationName(dashboard.company);
  const ended = connected ? null : connectionEndedText(dashboard.company);
  const policyLines = organizationPolicyLines(dashboard.company?.features ?? DEFAULT_FEATURES, dashboard.company?.policy);
  const version = extensionVersion();

  const save = async (field: string, changes: Partial<typeof settings>) => {
    setError(null);
    try {
      await client.settings({ ...settings, ...changes });
      await ctx.reload();
      return true;
    } catch (caught) {
      setError({ field, text: caught instanceof Error ? caught.message : "The change could not be saved." });
      return false;
    }
  };

  return (
    <div className="dh-settings">
      <section className="dh-card" aria-labelledby="st-scenario">
        <h2 id="st-scenario" className="lg-display">
          Scenario
        </h2>
        <p className="dh-soft">
          {connected
            ? "Which end of each estimate you see. Applies to your figures and to the organization totals you see."
            : "AI organizations do not publish how large their models are, so each estimate is a range from low to high. Choose which value you want to see."}
        </p>
        <div className="st-scenarios" role="radiogroup" aria-labelledby="st-scenario">
          {SCENARIOS.map((s) => {
            const on = settings.displayScenario === s.key;
            const value = scenarioValue(s.key);
            return (
              <button
                key={s.key}
                type="button"
                role="radio"
                aria-checked={on}
                className="st-scenario"
                onClick={() => {
                  if (!on) setAsk({ kind: "scenario", to: s.key });
                }}
              >
                <span className="st-scenario-head">
                  <b>{SCENARIO_NAMES[s.key]}</b>
                  <span className="st-radio" aria-hidden="true" />
                </span>
                <span className="dh-soft">{s.hint}</span>
                {value && <span className="st-scenario-value lg-display lg-num">{value}</span>}
                {value && <small className="dh-soft">your last 30 days</small>}
              </button>
            );
          })}
        </div>
        {figure && (
          <div className="st-range" aria-hidden="true">
            <div className="st-range-line">
              {SCENARIOS.map((s) => (
                <span key={s.key} className="st-range-mark" data-on={settings.displayScenario === s.key || undefined} style={{ left: `${s.at}%` }} />
              ))}
            </div>
            <div className="st-range-labels">
              <span>Low {scenarioValue("minimum")}</span>
              <span>Halfway {scenarioValue("midpoint")}</span>
              <span>High {scenarioValue("maximum")}</span>
            </div>
          </div>
        )}
        <p className="st-note">
          <Icon name="check" size={16} />
          {changed
            ? `${SCENARIO_NAMES[settings.displayScenario]} now applies everywhere: the bar under each chat, the popup, this dashboard and Details. Saved records stay as they are.`
            : "This is the only place to change it. It applies everywhere at once: the bar under each chat, the popup, this dashboard and Details. Saved records stay as they are."}
        </p>
        {error?.field === "scenario" && (
          <p className="dh-error" role="alert">
            {error.text}
          </p>
        )}
      </section>

      <section className="dh-card st-row" aria-labelledby="st-tracking">
        <div>
          <h2 id="st-tracking" className="lg-display">
            Tracking
          </h2>
          <p className="dh-soft">
            {/* Before the agreement, or after it was withdrawn, a switch saying Tracking is on
                would contradict Your agreement below, so the card only says why it is off. */}
            {consentRequired(settings)
              ? "Off until you agree under Your agreement. Once you agree you can pause any time; nothing is recorded while paused."
              : pauseLocked
              ? `${name} keeps tracking on for connected browsers, so pausing is not available.`
              : "Count AI chats on ChatGPT, Claude, Gemini, Perplexity and NotebookLM. Pause any time; nothing is recorded while paused."}
          </p>
          {error?.field === "paused" && (
            <p className="dh-error" role="alert">
              {error.text}
            </p>
          )}
        </div>
        {consentRequired(settings) ? null : pauseLocked ? (
          <span className="st-locked">
            <Icon name="lock" size={14} />
            Always on
          </span>
        ) : (
          <Toggle
            label={settings.paused ? "Tracking is paused" : "Tracking is on"}
            on={!settings.paused}
            onChange={async (on) => {
              if (!on) return setAsk({ kind: "pause" });
              if (await save("paused", { paused: false })) {
                await writePreference("paused", {});
                ctx.notify("Tracking resumed");
              }
            }}
          />
        )}
      </section>

      {/* The agreement to tracking and how to withdraw it (owner decision of 18 October 2026).
          Turning tracking off is not Pause: it withdraws the agreement, on every site. */}
      <section className="dh-card st-row" aria-labelledby="st-consent">
        <div>
          <h2 id="st-consent" className="lg-display">
            Your agreement
          </h2>
          <p className="dh-soft">
            {consentRequired(settings)
              ? "Tracking is off. Nothing is counted, stored or read from the sites until you agree."
              : trackingConsent(settings.consent).at !== null
                ? `You agreed on ${agreedOn(trackingConsent(settings.consent).at!, settings.timezone)}. Turn off tracking to withdraw: counting stops at once on every site.`
                : "You agreed to tracking in this browser. Turn off tracking to withdraw: counting stops at once on every site."}
          </p>
          {error?.field === "consent" && (
            <p className="dh-error" role="alert">
              {error.text}
            </p>
          )}
        </div>
        {consentRequired(settings) ? (
          <button type="button" className="lg-btn lg-btn-primary" onClick={() => void openWelcomePage()}>
            Review and agree
          </button>
        ) : (
          <button type="button" className="lg-btn lg-btn-danger" onClick={() => setAsk({ kind: "turn-off" })}>
            Turn off tracking
          </button>
        )}
      </section>

      <section className="dh-card" aria-labelledby="st-own-read">
        <div className="st-row">
          <div>
            <h2 id="st-own-read" className="lg-display">
              Load full chat history automatically
            </h2>
            <p className="dh-soft" id="st-own-read-help">
              If a site does not load all of a chat you open, the tracker asks that site once for the missing messages, read-only, with your sign-in there. When off, the tracker counts what the site loads on its own, and some older messages may not be counted.
            </p>
          </div>
          <Toggle
            label={olderChats.ownRead ? "Load full chat history is on" : "Load full chat history is off"}
            on={olderChats.ownRead}
            onChange={async (on) => {
              if (await save("own-read", { ownRead: on }))
                ctx.notify(on ? "Full chat history now loads automatically" : "Full chat history no longer loads automatically");
            }}
          />
        </div>
        <fieldset className="st-sites" disabled={!olderChats.ownRead} aria-describedby="st-own-read-help">
          <legend>Sites</legend>
          {OWN_READ_SETTING_KEYS.map((key) => (
            <label key={key} className="st-site">
              <input
                type="checkbox"
                checked={olderChats.ownReadSites[key]}
                onChange={async (event) => {
                  const on = event.target.checked;
                  if (await save("own-read", { ownReadSites: { ...olderChats.ownReadSites, [key]: on } }))
                    ctx.notify(on ? `Full chat history now loads automatically on ${OWN_READ_SETTING_NAMES[key]}` : `Full chat history no longer loads automatically on ${OWN_READ_SETTING_NAMES[key]}`);
                }}
              />
              {OWN_READ_SETTING_NAMES[key]}
            </label>
          ))}
        </fieldset>
        {error?.field === "own-read" && (
          <p className="dh-error" role="alert">
            {error.text}
          </p>
        )}
      </section>

      <section className="dh-card" aria-labelledby="st-tip">
        <div>
          <h2 id="st-tip" className="lg-display">
            Long-chat tip
          </h2>
          <p className="dh-soft">Show a short tip above the chat box once a chat gets long. You can close it in each chat.</p>
        </div>
        <div className="st-tip-option">
          <div className="st-row">
            <div>
              <h3 id="st-tip-requests">Requests</h3>
              <p className="dh-soft">Show the tip once a chat has this many requests.</p>
            </div>
            <Toggle
              label={tip.contextTipRequests ? "Long-chat tip by requests is on" : "Long-chat tip by requests is off"}
              on={tip.contextTipRequests}
              onChange={async (on) => {
                if (await save("tip-requests", { contextTipRequests: on }))
                  ctx.notify(on ? "The long-chat tip now shows by requests" : "The long-chat tip no longer shows by requests");
              }}
            />
          </div>
          <form
            className="st-budget"
            onSubmit={async (event) => {
              event.preventDefault();
              const text = requestLimit.replace(/[\s,._']/g, "");
              const value = /^\d+$/.test(text) ? Number(text) : NaN;
              if (!validTipRequestLimit(value)) return setError({ field: "requestLimit", text: "Choose a whole number of requests between 1 and 10,000." });
              if (await save("requestLimit", { contextTipRequestLimit: value })) ctx.notify(`The tip now shows at ${formatInteger(value)} requests`);
            }}
          >
            <label htmlFor="st-request-limit">Requests per chat</label>
            <input
              id="st-request-limit"
              inputMode="numeric"
              value={requestLimit}
              disabled={!tip.contextTipRequests}
              onChange={(event) => setRequestLimit(event.target.value)}
              aria-invalid={error?.field === "requestLimit" || undefined}
              aria-describedby={error?.field === "requestLimit" ? "st-request-limit-error" : "st-request-limit-help"}
            />
            <button
              type="submit"
              className="lg-btn lg-btn-secondary lg-btn-sm"
              disabled={!tip.contextTipRequests || requestLimit.replace(/[\s,._']/g, "") === String(tip.contextTipRequestLimit)}
            >
              Save
            </button>
            <small id="st-request-limit-help" className="dh-soft">
              A whole number from 1 to 10,000. The default is {DEFAULT_TIP_REQUEST_LIMIT}.
            </small>
            {error?.field === "requestLimit" && (
              <p className="dh-error" id="st-request-limit-error" role="alert">
                {error.text}
              </p>
            )}
          </form>
          {error?.field === "tip-requests" && (
            <p className="dh-error" role="alert">
              {error.text}
            </p>
          )}
        </div>
        <div className="st-tip-option">
          <div className="st-row">
            <div>
              <h3 id="st-tip-tokens">Tokens</h3>
              <p className="dh-soft">Show the tip once a chat uses more than half of its context. Off by default, because not every tool publishes its context size.</p>
            </div>
            <Toggle
              label={tip.contextTipTokens ? "Long-chat tip by tokens is on" : "Long-chat tip by tokens is off"}
              on={tip.contextTipTokens}
              onChange={async (on) => {
                if (await save("tip-tokens", { contextTipTokens: on }))
                  ctx.notify(on ? "The long-chat tip now shows by tokens" : "The long-chat tip no longer shows by tokens");
              }}
            />
          </div>
          <form
            className="st-budget"
            onSubmit={async (event) => {
              event.preventDefault();
              const text = budget.replace(/[\s,._']/g, "");
              const value = text ? Number(text) : null;
              if (value !== null && (!Number.isInteger(value) || value < 1000 || value > 10_000_000))
                return setError({ field: "budget", text: "Choose a limit between 1,000 and 10,000,000 tokens, or leave it empty." });
              if (await save("budget", { budget: value })) ctx.notify(value ? `Custom limit set to ${formatInteger(value)} tokens` : "Custom limit removed");
            }}
          >
            <label htmlFor="st-budget">Custom limit (optional)</label>
            <input
              id="st-budget"
              inputMode="numeric"
              placeholder="e.g. 100,000 tokens"
              value={budget}
              disabled={!tip.contextTipTokens}
              onChange={(event) => setBudget(event.target.value)}
              aria-invalid={error?.field === "budget" || undefined}
              aria-describedby={error?.field === "budget" ? "st-budget-error" : "st-budget-help"}
            />
            <button
              type="submit"
              className="lg-btn lg-btn-secondary lg-btn-sm"
              disabled={!tip.contextTipTokens || budget.replace(/[\s,._']/g, "") === String(settings.budget ?? "")}
            >
              Save
            </button>
            <small id="st-budget-help" className="dh-soft">
              Leave empty to use each model's own context size.
            </small>
            {error?.field === "budget" && (
              <p className="dh-error" id="st-budget-error" role="alert">
                {error.text}
              </p>
            )}
          </form>
          {error?.field === "tip-tokens" && (
            <p className="dh-error" role="alert">
              {error.text}
            </p>
          )}
        </div>
      </section>

      <section className="dh-card st-row" aria-labelledby="st-zone">
        <div>
          <h2 id="st-zone" className="lg-display">
            Time zone
          </h2>
          <p className="dh-soft">
            {connected ? "Your own days and months. Organization totals use the organization's time zone." : "Decides where your days and months begin and end."}
          </p>
          {error?.field === "timezone" && (
            <p className="dh-error" role="alert">
              {error.text}
            </p>
          )}
        </div>
        <select
          aria-labelledby="st-zone"
          className="st-select"
          value={settings.timezone}
          onChange={async (event) => {
            const timezone = event.target.value;
            if (await save("timezone", { timezone })) ctx.notify(`Days now follow ${timezone}`);
          }}
        >
          {zones(settings.timezone).map((zone) => (
            <option key={zone} value={zone}>
              {zone}
              {zone === detected ? " (detected)" : ""}
            </option>
          ))}
        </select>
      </section>

      <Appearance notify={ctx.notify} />

      {connected ? (
        <section className="dh-card" aria-labelledby="st-org">
          <div className="st-row">
            <div>
              <h2 id="st-org" className="lg-display">
                {name}
              </h2>
              <p className="dh-soft">
                {dashboard.company && !isHostedOrigin(dashboard.company.origin) ? `Own server at ${new URL(dashboard.company.origin).host}` : "Hosted service"} · connected
              </p>
            </div>
            <span className="st-pill-ok">
              <Icon name="check" size={14} />
              Connected
            </span>
          </div>
          <div className="st-sync">
            <span>
              {dashboard.queueCount ? (
                <>
                  Waiting to sync <b>{formatInteger(dashboard.queueCount)}</b> {dashboard.queueCount === 1 ? "record" : "records"}
                </>
              ) : dashboard.refusedCount ? (
                // Refused records are never sent again, so they are not "waiting"; Tracking explains them.
                <>
                  <b>{formatInteger(dashboard.refusedCount)}</b> {dashboard.refusedCount === 1 ? "update was" : "updates were"} refused by your organization's server. See Tracking.
                </>
              ) : (
                "Everything has been sent"
              )}
            </span>
            <button
              type="button"
              className="lg-btn lg-btn-secondary lg-btn-sm"
              onClick={async () => {
                try {
                  await client.command("sync");
                  ctx.notify(syncedText(name, consentRequired(settings)));
                } catch {
                  ctx.notify("Sync did not finish. Your records stay in this browser and sync later.");
                }
                await ctx.reload();
              }}
            >
              <Icon name="refresh" size={14} />
              Sync now
            </button>
          </div>
          <ul className="st-policy">
            <li>
              <Icon name="clock" size={16} />
              {dashboard.company?.policy.usage_retention_months
                ? `Your organization keeps usage for ${dashboard.company.policy.usage_retention_months} months`
                : "Your organization keeps usage until an administrator deletes it"}
            </li>
            <li>
              <Icon name="building" size={16} />
              {sharingText(dashboard.company?.policy)}
            </li>
            <li>
              <Icon name="user" size={16} />
              {policyLines.administrators}
            </li>
            <li>
              <Icon name="shield" size={16} />
              {policyLines.address}
            </li>
            <li>
              <Icon name="lock" size={16} />
              Your records from before connecting stay in this browser
            </li>
          </ul>
          {dashboard.company?.consent_required && <OrganizationReview ctx={ctx} name={name} />}
          <button type="button" className="lg-btn lg-btn-danger" onClick={() => setAsk({ kind: "disconnect" })}>
            <Icon name="buildingOff" size={16} />
            Disconnect this browser
          </button>
        </section>
      ) : (
        <section className="dh-card st-row" aria-labelledby="st-org">
          <div>
            <h2 id="st-org" className="lg-display">
              Organization
            </h2>
            <p className="dh-soft">
              {dashboard.pending?.state === "code_sent"
                ? "A code was sent to your work email. Enter it to finish connecting."
                : dashboard.pending?.state === "verified"
                  ? `Confirm the connection to ${dashboard.pending.company_name ?? "your organization"} to finish.`
                  : ended ??
                    "Not connected. Connect to share your totals with your organization. Only numbers are sent, never what you or the AI wrote, and earlier personal records stay in this browser."}
            </p>
          </div>
          <button type="button" className="lg-btn lg-btn-secondary" onClick={ctx.openConnect}>
            <Icon name="building" size={16} />
            {dashboard.pending ? "Continue" : ended ? "Connect again" : "Connect"}
          </button>
        </section>
      )}

      {!connected && (
        <section className="dh-card st-row" aria-labelledby="st-records">
          <div>
            <h2 id="st-records" className="lg-display">
              Your records
            </h2>
            <p className="dh-soft">
              {requestsPhrase(saved)}{since ? ` since ${since}` : ""}, stored only in this browser profile.
            </p>
          </div>
          <button type="button" className="lg-btn lg-btn-danger" onClick={() => setAsk({ kind: "erase" })}>
            <Icon name="trash" size={16} />
            Erase all records
          </button>
        </section>
      )}

      <LocalSummaryCard dashboard={dashboard} id="st-local" />

      <p className="st-about">
        {version && <span>Version {version}</span>}
        {ecologits && <span>Estimates by EcoLogits {ecologits}, MPL 2.0</span>}
        <a href="methodology.html" className="dh-link">
          Methodology
        </a>
        <a href="#licences" className="dh-link">
          Open-source licences
        </a>
      </p>

      {ask?.kind === "scenario" && (
        <ScenarioDialog
          from={settings.displayScenario}
          to={ask.to}
          fromValue={scenarioValue(settings.displayScenario)}
          toValue={scenarioValue(ask.to)}
          onCancel={() => setAsk(null)}
          onConfirm={async () => {
            await client.settings({ ...settings, displayScenario: ask.to });
            setAsk(null);
            setChanged(true);
            ctx.notify(`${SCENARIO_NAMES[ask.to]} now applies everywhere`);
            await ctx.reload();
          }}
        />
      )}
      {ask?.kind === "pause" && (
        <PauseDialog
          saved={saved}
          onCancel={() => setAsk(null)}
          onConfirm={async () => {
            await client.settings({ ...settings, paused: true });
            await writePreference("paused", { at: Date.now() });
            setAsk(null);
            ctx.notify("Tracking paused. Nothing is recorded until you resume.");
            await ctx.reload();
          }}
        />
      )}
      {ask?.kind === "turn-off" && (
        <TurnOffDialog
          onCancel={() => setAsk(null)}
          onConfirm={async () => {
            await client.consent({ agreed: false });
            await clearLastView();
            setAsk(null);
            ctx.notify("Tracking is off. Nothing is counted until you agree again.");
            await ctx.reload();
          }}
        />
      )}
      {ask?.kind === "erase" && (
        <EraseDialog
          requests={saved}
          since={since}
          onCancel={() => setAsk(null)}
          onConfirm={async () => {
            await clearLastView();
            const result = await client.eraseLocal();
            setAsk(null);
            ctx.notify(`${formatInteger(result.count)} records erased. This browser starts fresh.`);
            await ctx.reload();
          }}
        />
      )}
      {ask?.kind === "disconnect" && (
        <DisconnectDialog
          name={name}
          waiting={dashboard.queueCount ?? 0}
          trackingOff={consentRequired(settings)}
          onCancel={() => setAsk(null)}
          onSync={async () => {
            await client.command("sync");
            await ctx.reload();
          }}
          onConfirm={async () => {
            await client.command("disconnect");
            setAsk(null);
            ctx.notify("Disconnected. You are in personal mode.");
            await ctx.reload();
          }}
        />
      )}
    </div>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="lg-switch" onClick={() => onChange(!on)}>
      <span aria-hidden="true" />
    </button>
  );
}
