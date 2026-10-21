import assert from "node:assert/strict";
import test from "node:test";
import { HOSTED_ORIGIN, isHostedOrigin, organizationName } from "../lib/dashboard/organization";
import { validatedDashboard } from "../lib/dashboard/summary-validators";
import { dashboard } from "./ui-fixtures";

test("the organization's name is the one its server gave", () => {
  assert.equal(organizationName({ origin: HOSTED_ORIGIN, company_name: "Fern & Partners" }), "Fern & Partners");
  assert.equal(organizationName({ origin: "https://aift.example.org", company_name: "Example Org" }), "Example Org");
});

test("without a stored name the hosted address names no organization", () => {
  assert.equal(isHostedOrigin("https://aifootprinttracker.com"), true);
  assert.equal(organizationName({ origin: HOSTED_ORIGIN }), "your organization");
  assert.equal(organizationName({ origin: HOSTED_ORIGIN }, "Organization"), "Organization");
  assert.equal(organizationName(null), "your organization");
});

test("a connection saved before names were sent falls back to its own server's address", () => {
  assert.equal(organizationName({ origin: "https://example-consulting.aifootprinttracker.com" }), "Example Consulting");
  assert.equal(organizationName({ origin: "not an address" }, "Organization"), "Organization");
});

test("the dashboard accepts the email code states and requires the name before confirmation", () => {
  assert.equal(validatedDashboard(dashboard({ pending: true })).pending?.state, "code_sent");
  assert.equal(validatedDashboard(dashboard({ pending: "verified" })).pending?.company_name, "Example Consulting");
  assert.equal(validatedDashboard(dashboard({ mode: "company" })).company?.company_name, "Example Consulting");
  const unnamed = dashboard({ pending: "verified" });
  delete (unnamed.pending as { company_name?: string }).company_name;
  assert.throws(() => validatedDashboard(unnamed));
  const approval = dashboard({ pending: true });
  (approval.pending as { state: string }).state = "pending";
  assert.throws(() => validatedDashboard(approval), "the approval-page state is gone");
});

test("a server that collects no connection addresses may send 0 or leave the retention out", () => {
  // Since 18 October 2026 servers send ip_retention_days 0; a later one may drop the field.
  const zero = dashboard({ mode: "company" });
  zero.company!.policy.ip_retention_days = 0;
  assert.equal(validatedDashboard(zero).company?.policy.ip_retention_days, 0);
  const absent = dashboard({ mode: "company" });
  delete (absent.company!.policy as { ip_retention_days?: number }).ip_retention_days;
  assert.equal(validatedDashboard(absent).company?.policy.ip_retention_days, undefined);
  const broken = dashboard({ mode: "company" });
  (broken.company!.policy as { ip_retention_days?: unknown }).ip_retention_days = "30";
  assert.throws(() => validatedDashboard(broken));
});
