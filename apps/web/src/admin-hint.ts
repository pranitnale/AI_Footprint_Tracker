// Lets the public home page send a signed-in administrator to the dashboard without asking every
// visitor's browser for a session (owner request of 16 October 2026). The admin pages keep a hint
// that an administrator session existed in this browser. It holds "1" only: no email, token or
// organization. Storage can be missing or throw (private windows, blocked site data), so every
// access falls back to "no hint", which shows the public page at once.

const HINT = "aift.admin-session";
const STAY = "aift.stay-on-website";

/**
 * The address of the admin panel's Main website entry. The marker reaches the home page also when
 * the entry opens in a new tab, where the panel's own click handler does not run.
 */
export const PANEL_WEBSITE_LINK = "/?from=admin";

function readFlag(storage: () => Storage, key: string): boolean {
  try {
    return storage().getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(storage: () => Storage, key: string, on: boolean) {
  try {
    if (on) storage().setItem(key, "1");
    else storage().removeItem(key);
  } catch {
    // Without storage the home page never redirects, which is the safe default.
  }
}

const local = () => window.localStorage;
const tab = () => window.sessionStorage;

/** True when an administrator session was last seen in this browser. */
export const hasAdminHint = () => readFlag(local, HINT);
export const rememberAdminSession = () => writeFlag(local, HINT, true);
/** Called on sign-out, an expired or refused session and a non-admin session. */
export const forgetAdminSession = () => writeFlag(local, HINT, false);

/**
 * Keeps this tab on the public website after the panel's Main website entry, also across reloads,
 * because the home page would otherwise send the administrator straight back to the panel.
 */
export const stayOnWebsite = () => writeFlag(tab, STAY, true);
export const staysOnWebsite = () => readFlag(tab, STAY);

/**
 * Takes the Main website marker from the address: the tab stays on the website and the marker is
 * removed, so a bookmark or a shared link does not carry it. Safe to call more than once.
 */
export function takeWebsiteMarker() {
  let url: URL;
  try {
    url = new URL(window.location.href);
  } catch {
    return;
  }
  if (url.searchParams.get("from") !== "admin") return;
  stayOnWebsite();
  url.searchParams.delete("from");
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
}
