/**
 * The person's agreement before anything is tracked (owner decisions of 17 and 18 October 2026).
 *
 * The Chrome Web Store user data policy asks for a prominent disclosure and an affirmative
 * agreement before user data is collected. Until the person selects "Agree and start" on the
 * welcome page or in the popup, the extension captures, counts, records, reads from a site and
 * uploads nothing new: the background refuses every tracking message
 * (`Coordinator.trackingConsented`), and the content script passes nothing the page world observed
 * on and shows only "Tracking is off" on the bar. Estimates of records already saved in this
 * browser (from an earlier version, or before a withdrawal) may still be recalculated locally;
 * the privacy texts say so.
 *
 * The agreement is kept in the ledger's settings record, in this browser only: whether the person
 * agreed, the version of the text they agreed to and when. A record saved before this step existed
 * has no agreement, which reads as not agreed, so existing installations stay off until the person
 * agrees as well; the store requires the agreement from every user. Turning tracking off in
 * Settings withdraws it. Pause is separate and keeps the agreement.
 *
 * Connecting to an organization asks for a second, separate agreement in the Connect dialog,
 * kept beside it (`OrganizationConsent`).
 */

/** The welcome page's text. A new version is shown again only if the owner decides so. */
export const TRACKING_CONSENT_VERSION = "2026-10-18";
/** The Connect dialog's text, agreed to with its checkbox. */
export const ORGANIZATION_CONSENT_VERSION = "2026-10-18";

export type TrackingConsent = {
  agreed: boolean;
  /** The version of the text agreed to, or withdrawn from; null before any choice. */
  version: string | null;
  /** When the person agreed or withdrew (ms since 1970); null before any choice. */
  at: number | null;
};

export type OrganizationConsent = {
  version: string;
  at: number;
  /** The organization's server, so a later connection elsewhere is not taken as agreed. */
  origin: string;
};

const NOT_AGREED: TrackingConsent = { agreed: false, version: null, at: null };

const validTime = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const validVersion = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9A-Za-z.-]{1,32}$/.test(value);

/** The saved agreement with every field explicit. Anything absent or malformed is not agreed. */
export function trackingConsent(stored: unknown): TrackingConsent {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return NOT_AGREED;
  const value = stored as Record<string, unknown>;
  const version = validVersion(value.version) ? value.version : null;
  const at = validTime(value.at) ? value.at : null;
  // An agreement counts only with the text and the time it was given.
  return {
    agreed: value.agreed === true && version !== null && at !== null,
    version,
    at,
  };
}

/** The saved organization agreement, or null when there is none or it is malformed. */
export function organizationConsent(stored: unknown): OrganizationConsent | null {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
  const value = stored as Record<string, unknown>;
  return validVersion(value.version) &&
    validTime(value.at) &&
    typeof value.origin === "string" &&
    /^https:\/\/[^/\s]+$/.test(value.origin)
    ? { version: value.version, at: value.at, origin: value.origin }
    : null;
}

/**
 * Whether an extension page should show the agreement screens. The background always sends the
 * agreement with the settings; a copy without it is a popup's saved view or a test fixture of the
 * screens of an earlier version, which keeps those screens. The tracker itself never relies on
 * this: the background decides with `trackingConsent`.
 */
export function consentRequired(settings: { consent?: unknown } | null | undefined): boolean {
  return !!settings && settings.consent !== undefined && !trackingConsent(settings.consent).agreed;
}

/** A content script asks the background whether tracking is agreed: `{ target }`. */
export const TRACKING_STATE_TARGET = "tracking-state";
/** The background tells open provider tabs that the agreement changed; they ask again. */
export const TRACKING_STATE_CHANGED = "footprint-tracking-state";
/** The bar's Set up control asks the background to open the welcome page: `{ target }`. */
export const OPEN_WELCOME_TARGET = "open-welcome";
/** The welcome page, opened on install, once after an update while not agreed, and by Set up. */
export const WELCOME_PAGE = "welcome.html";
/**
 * Asked of open extension pages before the welcome page is opened: an open welcome page brings
 * itself to the front and answers `{ focused: true }`, so Set up never opens a second one
 * (live QA, 19 Oct 2026). The background also sends `TRACKING_STATE_CHANGED` to extension pages,
 * so an open welcome page follows an agreement made elsewhere.
 */
export const WELCOME_FOCUS_TARGET = "footprint-welcome-focus";

export type TrackingState = {
  consent: "agreed" | "required";
  /** The connected organization's name in organization mode, for the line in Details. */
  organization: string | null;
  /**
   * Tracking is paused (Settings or the popup) and no organization policy requires it, so the
   * background records nothing new. The bar then never shows Processing for a reply or read
   * that will not be counted (live, 21 Oct 2026), and Details says why. Pause keeps the
   * agreement; the background tells open provider tabs when it changes.
   */
  paused: boolean;
};

/**
 * The background's answer to `TRACKING_STATE_TARGET`, or null when it is not one. An answer
 * without `paused`, as before Pause was part of it, reads as not paused.
 */
export function trackingStateAnswer(value: unknown): TrackingState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const answer = value as Record<string, unknown>;
  const keys = Object.keys(answer).sort().join(",");
  if (
    (keys !== "consent,organization" && keys !== "consent,organization,paused") ||
    ("paused" in answer && typeof answer.paused !== "boolean") ||
    (answer.consent !== "agreed" && answer.consent !== "required") ||
    !(
      answer.organization === null ||
      (typeof answer.organization === "string" &&
        answer.organization.length > 0 &&
        answer.organization.length <= 200)
    )
  )
    return null;
  return {
    consent: answer.consent,
    organization: answer.organization as string | null,
    paused: answer.paused === true,
  };
}

/** The local storage key that remembers which welcome text was opened after an update. */
export const WELCOME_SHOWN_KEY = "welcome-shown";

/**
 * Whether the welcome page opens when the browser reports an install or update. It opens on every
 * install, and after an update only while the person has not agreed and has not been shown this
 * version of the text yet, so an installation that chose "Not now" is not asked on every update.
 */
export function welcomeDue(
  reason: string,
  agreed: boolean,
  shownVersion: unknown,
): boolean {
  if (agreed) return false;
  if (reason === "install") return true;
  return reason === "update" && shownVersion !== TRACKING_CONSENT_VERSION;
}

/** The Details line about where the figures were calculated (owner decision of 17 Oct 2026). */
export function localDetailsText(organization: string | null): { lead: string; rest: string } {
  return organization
    ? { lead: "Calculated on your computer.", rest: `Only numbers are shared with ${organization}.` }
    : { lead: "Calculated on your computer.", rest: "Nothing from this chat was sent to us." };
}
