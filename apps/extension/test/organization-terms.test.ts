// What connecting shares follows the server's operator switches (CONTRACTS.md section 8,
// lib/organization-terms.ts): unknown or missing switches read as off, each switch that is on
// changes the text and its agreement version, and an agreement covers only what it named.
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_FEATURES,
  ORGANIZATION_CONSENT_VERSIONS,
  isOrganizationConsentVersion,
  organizationConsentCovers,
  organizationConsentVersion,
  organizationFeatures,
  organizationPolicyLines,
  organizationTerms,
  storedFeatures,
} from "../lib/organization-terms";
import { ORGANIZATION_CONSENT_VERSION, organizationConsent } from "../lib/tracking-consent";

const ORIGIN = "https://aifootprinttracker.com";
const both = { person_analytics: true, ip_collection: true };
const people = { person_analytics: true, ip_collection: false };
const address = { person_analytics: false, ip_collection: true };
// Written by code point so this file holds no em dash itself.
const EM_DASH = new RegExp(String.fromCharCode(0x2014));

test("switches: an older server, a missing field or anything but true reads as off", () => {
  for (const config of [
    undefined,
    null,
    {},
    { policy: {} },
    { features: null },
    { features: [] },
    { features: { person_analytics: "true", ip_collection: 1 } },
  ])
    assert.deepEqual(organizationFeatures(config), DEFAULT_FEATURES, JSON.stringify(config));
  assert.deepEqual(organizationFeatures({ features: { person_analytics: true, ip_collection: false } }), people);
  assert.deepEqual(organizationFeatures({ features: { ...both, extra: true } }), both);
  // The start of per-person views is kept only while they are on and only as a date.
  assert.deepEqual(
    organizationFeatures({ features: { ...people, person_analytics_since: "2026-10-20T00:00:00Z" } }),
    { ...people, person_analytics_since: "2026-10-20T00:00:00Z" },
  );
  assert.deepEqual(organizationFeatures({ features: people, person_analytics_since: "2026-10-20" }), {
    ...people,
    person_analytics_since: "2026-10-20",
  });
  assert.deepEqual(organizationFeatures({ features: { ...address, person_analytics_since: "2026-10-20" } }), address);
  assert.deepEqual(organizationFeatures({ features: { ...people, person_analytics_since: "soon" } }), people);
  assert.deepEqual(storedFeatures(undefined), DEFAULT_FEATURES);
});

test("versions: the default keeps the text of 18 October 2026, and every switch that is on changes it", () => {
  assert.equal(organizationConsentVersion(DEFAULT_FEATURES), ORGANIZATION_CONSENT_VERSION);
  const versions = [DEFAULT_FEATURES, people, address, both].map(organizationConsentVersion);
  assert.equal(new Set(versions).size, 4, "each combination has its own version");
  assert.deepEqual([...versions].sort(), [...ORGANIZATION_CONSENT_VERSIONS].sort());
  for (const version of versions) {
    assert.ok(isOrganizationConsentVersion(version));
    // The stored agreement accepts each version.
    assert.ok(organizationConsent({ version, at: 5, origin: ORIGIN }));
  }
  assert.equal(isOrganizationConsentVersion("2026-10-19-everything"), false);
});

test("agreement: needed only while a switch is on, for this server, naming every switch that is on", () => {
  const agreed = (version: string, origin = ORIGIN) => ({ version, at: 5, origin });
  // Both off: connections from before the agreement step keep sharing.
  assert.equal(organizationConsentCovers(null, ORIGIN, DEFAULT_FEATURES), true);
  assert.equal(organizationConsentCovers(null, ORIGIN, people), false);
  assert.equal(organizationConsentCovers(agreed(ORGANIZATION_CONSENT_VERSION), ORIGIN, people), false);
  assert.equal(organizationConsentCovers(agreed(ORGANIZATION_CONSENT_VERSION), ORIGIN, address), false);
  assert.equal(organizationConsentCovers(agreed(organizationConsentVersion(people)), ORIGIN, people), true);
  assert.equal(organizationConsentCovers(agreed(organizationConsentVersion(people)), ORIGIN, both), false);
  assert.equal(organizationConsentCovers(agreed(organizationConsentVersion(both)), ORIGIN, address), true, "less than agreed stays covered");
  assert.equal(organizationConsentCovers(agreed(organizationConsentVersion(both), "https://other.example"), ORIGIN, both), false);
});

test("text: with both switches off the dialog's words of 18 October 2026 stay as they were", () => {
  const terms = organizationTerms(DEFAULT_FEATURES);
  assert.equal(terms.never, "Your prompts, the AI's answers, files and chat titles. Your connection address is not collected.");
  assert.match(terms.administrators, /Never your usage next to your name\.$/);
  assert.doesNotMatch(terms.shared, /connection address/);
  assert.deepEqual(organizationPolicyLines(DEFAULT_FEATURES), {
    administrators: "Administrators never see your usage next to your name",
    address: "Your connection address is not collected",
  });
});

test("text: person analytics says administrators see usage by name from the date the server reports", () => {
  const dated = organizationTerms({ ...people, person_analytics_since: "2026-10-20T00:00:00Z" }, { timezone: "Europe/Berlin" });
  assert.doesNotMatch(dated.administrators, /Never your usage/);
  assert.match(dated.administrators, /each member's usage next to their name, yours included, recorded from 20 October 2026\./);
  const undated = organizationTerms(people);
  assert.match(undated.administrators, /recorded from when the organization turned it on\./);
  assert.match(undated.never, /Your connection address is not collected\./, "the address switch is separate");
  assert.equal(
    organizationPolicyLines(people).administrators,
    "Administrators can see each member's usage by name, yours included, from when the organization turned it on",
  );
  for (const text of [...Object.values(dated), ...Object.values(undated)]) assert.doesNotMatch(text, EM_DASH);
});

test("text: address collection drops the not-collected promise and names the retention period", () => {
  const kept = organizationTerms(address, { ip_retention_days: 30 });
  assert.doesNotMatch(kept.never, /not collected/);
  assert.match(kept.shared, /Your connection address is collected with each upload and kept for 30 days\./);
  assert.match(kept.administrators, /Never your usage next to your name\./, "per-person views stay off");
  // A server that sends 0 or nothing for the period is described without a number.
  assert.match(organizationTerms(address, { ip_retention_days: 0 }).shared, /kept for the retention period your organization's server sets\./);
  assert.equal(organizationPolicyLines(address, { ip_retention_days: 30 }).address, "Your connection address is kept for 30 days");
  // With both on, the address is shown next to members and browsers (the Network page).
  assert.match(organizationTerms(both).administrators, /connection addresses next to members and browsers/);
});
