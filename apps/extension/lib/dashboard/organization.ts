/**
 * The hosted service's one address (owner, 13 October 2026). Every hosted organization is reached
 * here and the server finds it from the member's work email, so this address names no organization.
 * An organization that runs its own server has its own address instead.
 */
export const HOSTED_ORIGIN = "https://aifootprinttracker.com";

export const isHostedOrigin = (origin: string) => origin === HOSTED_ORIGIN;

/**
 * The organization's name as its server gave it. Connections saved before servers sent a name
 * fall back to one read from their own address ("example-consulting.example.com" reads as
 * "Example Consulting"); the hosted address names no organization, so it gives the fallback.
 */
export function organizationName(
  company: { origin: string; company_name?: string } | null | undefined,
  fallback = "your organization",
): string {
  if (company?.company_name) return company.company_name;
  if (!company || isHostedOrigin(company.origin)) return fallback;
  try {
    const label = new URL(company.origin).hostname.split(".")[0] ?? "";
    const name = label
      .split("-")
      .filter(Boolean)
      .map((part) => part[0]!.toUpperCase() + part.slice(1))
      .join(" ");
    return name || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Whether members see organization totals, from the policy the organization's server sent at
 * connection and after each policy change. Sharing is off ("disabled") until an administrator
 * turns it on; "threshold" is the stored value for on, kept for compatibility with older servers.
 * A policy that does not name it, or names an unknown value, gives null, so the text stays true
 * either way.
 */
export function organizationSharing(policy: { company_sharing?: unknown } | null | undefined): boolean | null {
  if (policy?.company_sharing === "threshold") return true;
  if (policy?.company_sharing === "disabled") return false;
  return null;
}

/** The Settings line for organization sharing. */
/**
 * The note after Sync now. Before the agreement to tracking, or after Turn off tracking, a sync
 * applies erasures only and sends no record (lib/tracking-consent.ts), so it must not say
 * "Synced".
 */
export function syncedText(name: string, trackingOff: boolean): string {
  return trackingOff ? `Tracking is off, so nothing was sent to ${name}.` : `Synced with ${name}`;
}

export function sharingText(policy: { company_sharing?: unknown } | null | undefined): string {
  const shared = organizationSharing(policy);
  if (shared === true) return "Organization totals are shared with members";
  if (shared === false) return "Organization totals are not shared with members";
  return "Organization totals are shared with members only if an administrator turns sharing on";
}

/**
 * Why a saved connection no longer shares, or null while it is active or absent. When the server
 * says this browser lost access (an administrator removed it or suspended the member), the
 * extension keeps the connection marked and returns to personal mode. Without this, the person
 * would see only "Not connected" and never learn that the connection ended. An organization that
 * is suspended or scheduled for deletion does not end the connection: sharing waits, since an
 * administrator can cancel the deletion, and Details says the organization paused sharing.
 */
export function connectionEndedText(
  company:
    | { origin: string; company_name?: string; enrollment_state?: string }
    | null
    | undefined,
): string | null {
  const name = organizationName(company);
  if (company?.enrollment_state === "revoked")
    return `This browser was removed from ${name}, so it no longer shares usage. Your records stay in this browser and tracking continues in personal mode. Ask your administrator if this is unexpected.`;
  if (company?.enrollment_state === "reconnect_needed")
    return `The connection to ${name} has ended, so this browser no longer shares usage. Your records stay in this browser and tracking continues in personal mode. Connect again to resume sharing.`;
  return null;
}
