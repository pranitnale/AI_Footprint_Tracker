import {
  DisplayScenarioSchema,
  EngineMethodIdentitySchema,
  EstimationEnvelopeSchema,
  CounterSchema,
  NonnegativeFiniteDecimalSchema,
  HistorySummarySchema,
} from "@footprint/contracts";
import { LOCAL_TOKEN_LABELS } from "./types";
import { validTipRequestLimit } from "../long-chat-tip";
import { validOwnReadSites } from "../own-read-settings";
import { organizationConsent, trackingConsent } from "../tracking-consent";
import { isOrganizationConsentVersion, storedFeatures } from "../organization-terms";
import type {
  BreakdownSummary,
  Dashboard,
  LocalSummary,
  MonthlySummary,
  ServerSummary,
  UsageBreakdownView,
} from "./types";
import {
  scopeTokenPattern,
  validatedCalculation,
  validatedTrackingHealth,
} from "./response-validators";

export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const integer = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const decimal = (value: unknown) =>
  value === null || NonnegativeFiniteDecimalSchema.safeParse(value).success;
const tokenCount = (value: unknown) =>
  value === null || CounterSchema.safeParse(value).success;
const counter = (value: unknown) =>
  value === null ||
  integer(value) ||
  (typeof value === "bigint" && value >= 0n) ||
  (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value));
const strings = (value: unknown) =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");
const optionalText = (value: Record<string, unknown>, fields: string[]) =>
  fields.every(
    (field) =>
      value[field] === undefined ||
      value[field] === null ||
      typeof value[field] === "string",
  );
function requireShape(valid: unknown): asserts valid {
  if (!valid) throw new Error("summary_response_invalid");
}
function metric(value: unknown, tokens = false) {
  requireShape(object(value));
  requireShape(
    (tokens ? tokenCount(value.value) : decimal(value.value)) &&
      integer(value.known) &&
      integer(value.unknown) &&
      optionalText(value, ["unit", "reason"]),
  );
  if (value.groups !== undefined) {
    requireShape(Array.isArray(value.groups));
    for (const group of value.groups) {
      requireShape(object(group));
      requireShape(
        (tokens ? tokenCount(group.value) : decimal(group.value)) &&
          typeof group.scope === "string" &&
          integer(group.known),
      );
      requireShape(
        optionalText(group, [
          "signature",
          "method_id",
          "method_hash",
          "profile_id",
          "profile_selection",
          "selected_profile_id",
          "cohort_id",
          "unit",
          "evidence",
          "completeness",
        ]),
      );
      requireShape(
        group.method_releases === undefined ||
          (Array.isArray(group.method_releases) &&
            group.method_releases.length <= 256 &&
            group.method_releases.every(
              (release: unknown) =>
                typeof release === "string" && release.length <= 160,
            )),
      );
      range(group);
    }
  }
  range(value);
}
function range(value: Record<string, unknown>) {
  if (value.selection !== undefined)
    EstimationEnvelopeSchema.shape.selection.parse(value.selection);
  if (value.comparability !== undefined)
    EstimationEnvelopeSchema.shape.comparability.parse(value.comparability);
  if (value.requested_method !== undefined)
    EngineMethodIdentitySchema.parse(value.requested_method);
  if (value.effective_method !== undefined)
    EngineMethodIdentitySchema.parse(value.effective_method);
  if (value.phase !== undefined) requireShape(value.phase === "usage");
  if (value.value_kind === undefined) return;
  requireShape(
    ["scalar", "midpoint", "midpoint_sum", "unavailable"].includes(
      String(value.value_kind),
    ),
  );
  requireShape((value.value_kind === "unavailable") === (value.value === null));
  // A midpoint record always carries its interval. A midpoint_sum group carries scenario
  // sums when every contribution had endpoints; older snapshots carry none.
  const bounded = value.scenario_low != null || value.scenario_high != null;
  if (value.value_kind === "midpoint" || bounded) {
    requireShape(
      value.value_kind === "midpoint" || value.value_kind === "midpoint_sum",
    );
    requireShape(
      value.scenario_low != null &&
        value.scenario_high != null &&
        decimal(value.scenario_low) &&
        decimal(value.scenario_high),
    );
    requireShape(
      Number(value.scenario_low) <= Number(value.value) &&
        Number(value.value) <= Number(value.scenario_high),
    );
  }
  if (value.value_kind === "midpoint") {
    requireShape(
      ["upstream_approximation", "scenario"].includes(
        String(value.interval_kind),
      ),
    );
  } else requireShape(value.interval_kind == null);
}
function history(value: unknown) {
  if (value === undefined) return;
  requireShape(object(value));
  HistorySummarySchema.parse(value.local);
  if (value.pending !== null) HistorySummarySchema.parse(value.pending);
  if (value.server !== null) HistorySummarySchema.parse(value.server);
  requireShape(
    ["current", "offline", "unavailable", "personal"].includes(
      String(value.server_status),
    ) && value.coverage === "partial_loaded_history",
  );
}
function files(value: Record<string, unknown>) {
  if (value.file_text != null) {
    requireShape(Array.isArray(value.file_text));
    for (const row of value.file_text) {
      requireShape(object(row) && object(row.measurement_group));
      requireShape(
        counter(row.value) &&
          row.scope === "extracted_file_text" &&
          row.additive === false &&
          row.unit === "tokens",
      );
      requireShape(
        optionalText(row.measurement_group, [
          "origin",
          "extraction_profile_id",
          "profile_id",
          "evidence",
        ]),
      );
      for (const field of ["reason_counts", "missing_counts"])
        if (row[field] !== undefined)
          requireShape(
            object(row[field]) && Object.values(row[field]).every(integer),
          );
      for (const field of [
        "applicable_count",
        "contributing_component_count",
        "unknown_count",
        "partial_count",
        "unvalidated_count",
      ])
        requireShape(counter(row[field]));
    }
  }
  if (value.file_text_coverage != null) {
    requireShape(object(value.file_text_coverage));
    const coverage = value.file_text_coverage;
    requireShape(
      coverage.scope === "extracted_file_text" &&
        coverage.additive === false &&
        counter(coverage.observed_request_count) &&
        counter(coverage.unknown_request_count),
    );
  }
}
export function validatedLocalSummary(value: unknown): LocalSummary {
  requireShape(
    object(value) &&
      integer(value.requests) &&
      integer(value.attempts) &&
      object(value.tokens) &&
      object(value.metrics),
  );
  for (const key of Object.keys(LOCAL_TOKEN_LABELS))
    metric(value.tokens[key], true);
  for (const key of [
    "energy",
    "carbon",
    "waterDirect",
    "waterUpstream",
    "water",
  ])
    metric(value.metrics[key]);
  requireShape(
    strings(value.models) &&
      object(value.tools) &&
      Object.values(value.tools).every(integer) &&
      object(value.outcomes) &&
      Object.values(value.outcomes).every(integer),
  );
  if (value.images !== undefined) {
    requireShape(
      object(value.images) &&
        [
          value.images.operations,
          value.images.unknown,
          value.images.completed,
        ].every(integer) &&
        counter(value.images.returned),
    );
  }
  if (value.estimate != null) requireShape(object(value.estimate));
  files(value);
  return value as LocalSummary;
}
export function validatedServerSummary(value: unknown): ServerSummary {
  requireShape(
    object(value) &&
      typeof value.scopeToken === "string" &&
      scopeTokenPattern.test(value.scopeToken),
  );
  summaryBody(value);
  // The organization summary's optional splits are summaries themselves, keyed by day, tool or model.
  const parts = (field: string, key: RegExp) => {
    const map = (value as Record<string, unknown>)[field];
    if (map === undefined) return;
    requireShape(object(map) && Object.keys(map).length <= 400);
    for (const [k, part] of Object.entries(map as Record<string, unknown>)) {
      requireShape(key.test(k) && object(part));
      summaryBody(part);
      if (field === "models")
        requireShape(optionalText(part as Record<string, unknown>, ["site"]));
    }
  };
  parts("days", /^\d{4}-\d{2}-\d{2}$/);
  parts("sites", /^(chatgpt|claude|gemini|perplexity|notebooklm)$/);
  parts("models", /^[A-Za-z0-9._:/-]{1,128}$/);
  return value as ServerSummary;
}
function summaryBody(value: Record<string, unknown>) {
  requireShape(
    typeof value.aggregate_status === "string" &&
      optionalText(value, [
        "safe_message",
        "request_count",
        "attempt_count",
        "generated_at",
        "retention_cutoff",
        "pending_estimates",
      ]),
  );
  for (const field of ["request_count", "attempt_count", "pending_estimates"])
    if (value[field] !== undefined)
      requireShape(CounterSchema.safeParse(value[field]).success);
  for (const field of ["suppressed", "offline"])
    if (value[field] !== undefined)
      requireShape(typeof value[field] === "boolean");
  for (const field of ["resources", "tokens"]) {
    if (value[field] === undefined) continue;
    requireShape(Array.isArray(value[field]));
    for (const row of value[field]) {
      requireShape(
        object(row) &&
          typeof row.quantity === "string" &&
          typeof row.scope === "string" &&
          typeof row.unit === "string" &&
          (field === "tokens" ? tokenCount(row.value) : decimal(row.value)) &&
          counter(row.unknown_count) &&
          counter(row.contributing_attempt_count),
      );
      requireShape(
        optionalText(row, [
          "profile_selection",
          "selected_profile_id",
          "cohort_id",
          "method_id",
          "validation_state",
        ]),
      );
      if (row.method_group !== undefined)
        requireShape(
          object(row.method_group) &&
            optionalText(row.method_group, ["method_id", "method_hash"]),
        );
      range(row);
    }
  }
  if (value.coverage !== undefined)
    requireShape(
      object(value.coverage) &&
        typeof value.coverage.resource_scope === "string",
    );
  if (value.calculation !== undefined)
    requireShape(validatedCalculation(value.calculation));
  history(value.history);
  files(value);
}
export function validatedDashboard(value: unknown): Dashboard {
  requireShape(
    object(value) &&
      typeof value.scopeToken === "string" &&
      scopeTokenPattern.test(value.scopeToken),
  );
  validatedLocalSummary(value.summary);
  requireShape(
    integer(value.generatedAt) &&
      ["current", "rebuilding"].includes(String(value.aggregate_status)) &&
      ["personal", "company"].includes(String(value.mode)),
  );
  requireShape(
    object(value.settings) &&
      typeof value.settings.paused === "boolean" &&
      (value.settings.budget === null || integer(value.settings.budget)) &&
      typeof value.settings.timezone === "string" &&
      DisplayScenarioSchema.safeParse(value.settings.displayScenario).success &&
      (value.settings.contextTip === undefined || typeof value.settings.contextTip === "boolean") &&
      (value.settings.contextTipRequests === undefined ||
        typeof value.settings.contextTipRequests === "boolean") &&
      (value.settings.contextTipRequestLimit === undefined ||
        validTipRequestLimit(value.settings.contextTipRequestLimit)) &&
      (value.settings.contextTipTokens === undefined ||
        typeof value.settings.contextTipTokens === "boolean") &&
      (value.settings.ownRead === undefined || typeof value.settings.ownRead === "boolean") &&
      (value.settings.ownReadSites === undefined || validOwnReadSites(value.settings.ownReadSites)) &&
      // The agreements are shown as the background normalized them (lib/tracking-consent.ts).
      (value.settings.consent === undefined ||
        JSON.stringify(trackingConsent(value.settings.consent)) === JSON.stringify(value.settings.consent)) &&
      (value.settings.organizationConsent === undefined ||
        value.settings.organizationConsent === null ||
        organizationConsent(value.settings.organizationConsent) !== null),
  );
  new Intl.DateTimeFormat(undefined, { timeZone: value.settings.timezone });
  if (value.company !== null) {
    requireShape(
      object(value.company) &&
        typeof value.company.origin === "string" &&
        (value.company.company_name === undefined ||
          typeof value.company.company_name === "string") &&
        object(value.company.policy),
    );
    const policy = value.company.policy;
    requireShape(
      ["user_controlled", "disabled_by_company"].includes(
        String(policy.pause_mode),
      ) &&
        typeof policy.policy_version === "string" &&
        (policy.usage_retention_months === null ||
          integer(policy.usage_retention_months)) &&
        // Optional since connection addresses are no longer collected (18 October 2026).
        (policy.ip_retention_days === undefined || integer(policy.ip_retention_days)),
    );
    // The operator switches as the background normalized them (lib/organization-terms.ts).
    const company = value.company;
    requireShape(
      (company.features === undefined ||
        JSON.stringify(storedFeatures(company.features)) === JSON.stringify(company.features)) &&
        (company.consent_version === undefined ||
          isOrganizationConsentVersion(company.consent_version)) &&
        (company.consent_required === undefined || typeof company.consent_required === "boolean"),
    );
  }
  if (value.pending !== null) {
    const pending = value.pending;
    requireShape(object(pending));
    requireShape(
      typeof pending.origin === "string" &&
        typeof pending.expires_at === "string" &&
        ["code_sent", "verified"].includes(String(pending.state)) &&
        ["email", "retry_at", "company_name"].every(
          (key) => pending[key] === undefined || typeof pending[key] === "string",
        ),
    );
    // The confirmation step names the organization, so a verified connection must carry its name.
    requireShape(pending.state !== "verified" || typeof pending.company_name === "string");
  }
  requireShape(
    Array.isArray(value.queue) &&
      (value.queueCount === undefined || integer(value.queueCount)) &&
      (value.refusedCount === undefined || integer(value.refusedCount)),
  );
  if (value.heldQueues !== undefined) {
    requireShape(Array.isArray(value.heldQueues));
    for (const row of value.heldQueues)
      requireShape(
        object(row) &&
          typeof row.origin === "string" &&
          integer(row.count) &&
          typeof row.revocation_pending === "boolean" &&
          ["disconnected", "revoked", "reconnect_needed"].includes(
            String(row.state),
          ),
      );
  }
  validatedTrackingHealth({
    health: value.health,
    status: "available",
    scopeToken: value.scopeToken,
  });
  if (value.calculation !== undefined)
    requireShape(validatedCalculation(value.calculation));
  history(value.history);
  return value as Dashboard;
}
export function validatedMonthly(value: unknown): MonthlySummary | null {
  if (value === null) return null;
  requireShape(
    object(value) &&
      typeof value.month === "string" &&
      typeof value.timezone === "string" &&
      integer(value.generatedAt) &&
      object(value.summary),
  );
  if ("requests" in value.summary) validatedLocalSummary(value.summary);
  else validatedServerSummary(value.summary);
  if (value.calculation !== undefined)
    requireShape(validatedCalculation(value.calculation));
  return value as MonthlySummary;
}

/** A bucket of the usage breakdown: the totals' token and metric shapes without the optional extras. */
function breakdownSummary(value: unknown): BreakdownSummary {
  requireShape(
    object(value) &&
      integer(value.requests) &&
      integer(value.attempts) &&
      object(value.tokens) &&
      object(value.metrics) &&
      strings(value.models) &&
      object(value.tools) &&
      Object.values(value.tools).every(integer),
  );
  for (const key of Object.keys(LOCAL_TOKEN_LABELS))
    metric(value.tokens[key], true);
  for (const key of ["energy", "carbon", "waterDirect", "waterUpstream", "water"])
    metric(value.metrics[key]);
  return value as BreakdownSummary;
}

export function validatedBreakdown(value: unknown): UsageBreakdownView {
  requireShape(
    object(value) &&
      typeof value.scopeToken === "string" &&
      integer(value.generatedAt) &&
      (value.bucket === "hour" || value.bucket === "day") &&
      typeof value.timezone === "string" &&
      object(value.buckets) &&
      object(value.sites) &&
      object(value.models) &&
      Array.isArray(value.chats) &&
      object(value.calculation),
  );
  breakdownSummary(value.total);
  for (const map of [value.buckets, value.sites, value.models])
    for (const bucket of Object.values(map as Record<string, unknown>)) breakdownSummary(bucket);
  for (const model of Object.values(value.models as Record<string, Record<string, unknown>>)) modelSelections(model.selections);
  for (const chat of value.chats as unknown[]) {
    requireShape(object(chat) && typeof chat.key === "string" && integer(chat.requests) && typeof chat.site === "string" && object(chat.metrics));
    for (const key of ["energy", "carbon", "water"]) metric((chat.metrics as Record<string, unknown>)[key]);
  }
  stringMap(value.modelSites);
  isoMap(value.siteLastAt);
  isoMap(value.siteLastMissed);
  if (value.history !== null) {
    requireShape(object(value.history));
    const saved = value.history as Record<string, unknown>;
    HistorySummarySchema.parse(saved.total);
    for (const key of ["buckets", "sites", "models", "chats"]) {
      requireShape(object(saved[key]));
      for (const summary of Object.values(saved[key] as Record<string, unknown>)) HistorySummarySchema.parse(summary);
    }
    stringMap(saved.modelSites);
    isoMap(saved.siteLastAt);
  }
  return value as UsageBreakdownView;
}

// How a model's replies were matched to records (ModelSelection); older backgrounds omit it.
function modelSelections(value: unknown) {
  if (value === undefined) return;
  requireShape(Array.isArray(value) && value.length <= 16);
  for (const entry of value as unknown[])
    requireShape(
      object(entry) &&
        typeof entry.kind === "string" &&
        (entry.basis === null || typeof entry.basis === "string") &&
        (entry.record === null || typeof entry.record === "string") &&
        integer(entry.replies),
    );
}

// Older backgrounds omit these maps; when present every value must be a plain string or an ISO time.
function stringMap(value: unknown) {
  if (value === undefined) return;
  requireShape(object(value) && Object.values(value).every((v) => typeof v === "string"));
}
function isoMap(value: unknown) {
  if (value === undefined) return;
  requireShape(object(value) && Object.values(value).every((v) => typeof v === "string" && Number.isFinite(Date.parse(v))));
}
