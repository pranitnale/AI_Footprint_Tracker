import { browser } from "wxt/browser";
import type { Dashboard, Settings, UsageBreakdownView } from "../dashboard/types";
import type { PeriodWindow, PopupPeriod } from "../ui/periods";
import { longChatTipSettings } from "../long-chat-tip";
import { consentRequired } from "../tracking-consent";

export type PersonalView = {
  window: PeriodWindow;
  current: UsageBreakdownView;
  previous: UsageBreakdownView;
};
/** A saved copy of one period's figures and what they were calculated from. */
export type SavedView = PersonalView & {
  scopeToken: string;
  settings: string;
  summary: string;
  mode: Dashboard["mode"];
};
/** The background's quick answer that a saved copy is checked against before the dashboard. */
export type ViewToken = { scopeToken: string; erasing: boolean; settings: Settings };

const KEY = "popup:last-views";
// Session copy kept by versions before 16 October 2026.
const OLD_SESSION_KEY = "popup:last-view";

/**
 * The popup's last personal figures for each period, kept in this browser's extension storage
 * so they survive a browser restart (owner decision of 16 October 2026). The next popup shows
 * them at once, marked as updating, and replaces them when fresh figures arrive. A copy is shown
 * only for the same data scope (its token changes with every erasure, connection and
 * disconnection), the same settings and no erasure in progress; it may lag the newest records.
 */
async function readAll(): Promise<Partial<Record<PopupPeriod, SavedView>>> {
  try {
    const value = (await browser.storage.local.get(KEY))[KEY];
    return value && typeof value === "object" ? (value as Partial<Record<PopupPeriod, SavedView>>) : {};
  } catch {
    return {};
  }
}

export async function readLastView(period: PopupPeriod): Promise<SavedView | null> {
  const entry = (await readAll())[period];
  return entry && typeof entry === "object" && entry.window?.period === period ? entry : null;
}

export async function writeLastView(dashboard: Dashboard, view: PersonalView) {
  try {
    const entries = await readAll();
    // Copies of another data scope can never be shown again, so they are not kept.
    for (const period of Object.keys(entries) as PopupPeriod[])
      if (entries[period]?.scopeToken !== dashboard.scopeToken) delete entries[period];
    entries[view.window.period] = {
      ...view,
      scopeToken: dashboard.scopeToken,
      settings: settingsKey(dashboard.settings),
      summary: JSON.stringify(dashboard.summary),
      mode: dashboard.mode,
    };
    await browser.storage.local.set({ [KEY]: entries });
  } catch {
    /* the next popup waits for fresh figures */
  }
}

/** Erasing records must never let an earlier view show again, even briefly. */
export async function clearLastView() {
  for (const [area, key] of [
    ["local", KEY],
    ["session", OLD_SESSION_KEY],
  ] as const)
    try {
      await browser.storage[area].remove(key);
    } catch {
      /* nothing was kept */
    }
}

function settingsKey(settings: Settings) {
  return JSON.stringify({
    paused: settings.paused,
    budget: settings.budget,
    timezone: settings.timezone,
    displayScenario: settings.displayScenario,
    ...longChatTipSettings(settings),
  });
}

function sameScope(entry: SavedView, scopeToken: string) {
  return entry.scopeToken === scopeToken && entry.current?.scopeToken === scopeToken && entry.previous?.scopeToken === scopeToken;
}

/** A saved copy that may be shown before the dashboard arrives, or null. */
export function earlyView(entry: SavedView | null, token: ViewToken | null): SavedView | null {
  // Before the person agreed, or after they turned tracking off, the popup asks for the
  // agreement instead of showing figures.
  if (!entry || !token || token.erasing || token.settings.paused || consentRequired(token.settings)) return null;
  return sameScope(entry, token.scopeToken) && entry.settings === settingsKey(token.settings) ? entry : null;
}

/**
 * Whether a saved copy may stay once the dashboard arrived: null when it belongs to another
 * scope, other settings or another calculation. `confirmed` when the current summary shows
 * nothing recorded or erased since and the period window is the same, so the figures are the
 * current ones.
 */
export function reusableView(
  entry: SavedView | null,
  dashboard: Dashboard,
  window: PeriodWindow,
): { view: PersonalView; confirmed: boolean } | null {
  if (
    !entry ||
    !sameScope(entry, dashboard.scopeToken) ||
    entry.settings !== settingsKey(dashboard.settings) ||
    entry.window?.period !== window.period ||
    calculationKey(entry.current.calculation) !== calculationKey(dashboard.calculation) ||
    calculationKey(entry.previous.calculation) !== calculationKey(dashboard.calculation)
  )
    return null;
  // While the summary is rebuilt after a new reply, the dashboard still carries the earlier one,
  // so an unchanged summary proves nothing until it is current again (seen live, 16 Oct 2026).
  const confirmed =
    dashboard.aggregate_status === "current" &&
    entry.summary === JSON.stringify(dashboard.summary) &&
    entry.window.start === window.start &&
    entry.window.end === window.end;
  return { view: { window: entry.window, current: entry.current, previous: entry.previous }, confirmed };
}

function calculationKey(calculation: { view?: string; methodId?: string | null } | undefined) {
  return JSON.stringify({ view: calculation?.view ?? "original", methodId: calculation?.methodId ?? null });
}
