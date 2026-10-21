/**
 * What connecting to an organization shares and what its administrators see, following the
 * server's two operator switches (docs/implementation/CONTRACTS.md section 8, owner decisions of
 * 17 and 18 October 2026).
 *
 * `/v1/config` reports `features: { person_analytics, ip_collection }`, read-only and outside the
 * policy. Both default to false, and a server released before 18 October 2026 sends none, which
 * reads as false. With both off the Connect dialog's text of 18 October 2026 applies unchanged
 * and needs no new agreement, so connections made before the agreement step keep sharing.
 *
 * Each switch that is on changes that text, so each combination has its own agreement version.
 * A person who agreed to an earlier text is asked again, and the browser shares nothing new with
 * the organization until they agree (`CompanyClient.organizationAgreed`). An agreement to a text
 * that disclosed more still covers a server that later shows less.
 */
import {
  ORGANIZATION_CONSENT_VERSION,
  type OrganizationConsent,
} from "./tracking-consent";

export type OrganizationFeatures = {
  /** Administrators can see each member's usage by name (per-person views). */
  person_analytics: boolean;
  /** The server keeps each upload's connection address for its retention period. */
  ip_collection: boolean;
  /** From when per-person views show usage, as the server reports it (ISO 8601). Absent when not reported. */
  person_analytics_since?: string;
};

export const DEFAULT_FEATURES: OrganizationFeatures = Object.freeze({
  person_analytics: false,
  ip_collection: false,
});

const SINCE = /^\d{4}-\d{2}-\d{2}(?:T[0-9:.]{5,18}(?:Z|[+-]\d{2}:\d{2}))?$/;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * The switches from a `/v1/config` answer. Anything other than `true` is off, so an older server,
 * a missing field or a malformed value never widens what the texts promise.
 */
export function organizationFeatures(config: unknown): OrganizationFeatures {
  const root = record(config);
  const features = record(root?.features);
  const person = features?.person_analytics === true;
  const since = features?.person_analytics_since ?? root?.person_analytics_since;
  return {
    person_analytics: person,
    ip_collection: features?.ip_collection === true,
    ...(person &&
    typeof since === "string" &&
    SINCE.test(since) &&
    Number.isFinite(Date.parse(since))
      ? { person_analytics_since: since }
      : {}),
  };
}

/** The switches kept with the credentials; absent (connections saved before 19 October 2026) reads as off. */
export function storedFeatures(value: unknown): OrganizationFeatures {
  return organizationFeatures({ features: value });
}

export function sameFeatures(a: unknown, b: unknown): boolean {
  return JSON.stringify(storedFeatures(a)) === JSON.stringify(storedFeatures(b));
}

const SWITCH_TEXT = "2026-10-19";

/** The version of the Connect dialog's text for these switches. */
export function organizationConsentVersion(features: OrganizationFeatures): string {
  if (!features.person_analytics && !features.ip_collection)
    return ORGANIZATION_CONSENT_VERSION;
  return [
    SWITCH_TEXT,
    ...(features.person_analytics ? ["people"] : []),
    ...(features.ip_collection ? ["address"] : []),
  ].join("-");
}

export const ORGANIZATION_CONSENT_VERSIONS: readonly string[] = [
  ORGANIZATION_CONSENT_VERSION,
  `${SWITCH_TEXT}-people`,
  `${SWITCH_TEXT}-address`,
  `${SWITCH_TEXT}-people-address`,
];

export function isOrganizationConsentVersion(value: unknown): value is string {
  return typeof value === "string" && ORGANIZATION_CONSENT_VERSIONS.includes(value);
}

/**
 * Whether the person's organization agreement covers what this server does. With both switches
 * off nothing beyond the original text applies, so no agreement is needed (as before 19 October
 * 2026). Otherwise the agreement must be for this server and name every switch that is on.
 */
export function organizationConsentCovers(
  consent: OrganizationConsent | null | undefined,
  origin: string,
  features: OrganizationFeatures,
): boolean {
  if (!features.person_analytics && !features.ip_collection) return true;
  if (!consent || consent.origin !== origin) return false;
  const parts = consent.version.startsWith(`${SWITCH_TEXT}-`)
    ? consent.version.slice(SWITCH_TEXT.length + 1).split("-")
    : [];
  return (
    (!features.person_analytics || parts.includes("people")) &&
    (!features.ip_collection || parts.includes("address"))
  );
}

type PolicyFacts = { ip_retention_days?: number; timezone?: string } | null | undefined;

/** "20 October 2026" in the organization's time zone, where the server counts its days. */
function dayText(value: string, timezone: string | undefined) {
  const options = { day: "numeric", month: "long", year: "numeric" } as const;
  try {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: timezone ?? "UTC" }).format(Date.parse(value));
  } catch {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(Date.parse(value));
  }
}

function since(features: OrganizationFeatures, policy: PolicyFacts) {
  return features.person_analytics_since
    ? `from ${dayText(features.person_analytics_since, policy?.timezone)}`
    : "from when the organization turned it on";
}

function kept(policy: PolicyFacts) {
  const days = policy?.ip_retention_days;
  return typeof days === "number" && Number.isSafeInteger(days) && days > 0
    ? `for ${days} ${days === 1 ? "day" : "days"}`
    : "for the retention period your organization's server sets";
}

export type OrganizationTerms = {
  never: string;
  shared: string;
  administrators: string;
  stays: string;
};

/** The Connect dialog's four sections for these switches. */
export function organizationTerms(
  features: OrganizationFeatures,
  policy?: PolicyFacts,
): OrganizationTerms {
  return {
    never: features.ip_collection
      ? "Your prompts, the AI's answers, files and chat titles."
      : "Your prompts, the AI's answers, files and chat titles. Your connection address is not collected.",
    shared:
      "Token counts, estimates, tools, models and times, linked to your work email. Chats you open after connecting are counted from their start, earlier messages included." +
      (features.ip_collection
        ? ` Your connection address is collected with each upload and kept ${kept(policy)}.`
        : ""),
    administrators: features.person_analytics
      ? `Organization totals and how usage spreads across people. Your email and browsers, so they can manage access. Also each member's usage next to their name, yours included, recorded ${since(features, policy)}.` +
        (features.ip_collection
          ? " They can also see connection addresses next to members and browsers."
          : "")
      : "Organization totals and how usage spreads across people. Your email and browsers, so they can manage access. Never your usage next to your name.",
    stays: "Records of chats you do not open again after connecting.",
  };
}

/** The two short lines in Settings about what administrators see and the connection address. */
export function organizationPolicyLines(
  features: OrganizationFeatures,
  policy?: PolicyFacts,
): { administrators: string; address: string } {
  return {
    administrators: features.person_analytics
      ? `Administrators can see each member's usage by name, yours included, ${since(features, policy)}`
      : "Administrators never see your usage next to your name",
    address: features.ip_collection
      ? `Your connection address is kept ${kept(policy)}`
      : "Your connection address is not collected",
  };
}
