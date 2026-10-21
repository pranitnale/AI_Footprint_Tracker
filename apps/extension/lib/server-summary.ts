import {
  digest,
  resolveApplicationRepository,
  type RepositorySource,
} from "@footprint/ledger";
import {
  CounterSchema,
  EngineMethodIdentitySchema,
  EstimateReasonSchema,
  EstimationEnvelopeSchema,
  EXTRACTION_PROFILES,
  FILE_COVERAGE_REASONS,
  PROFILE_IDS,
  REASON_CODES,
  SITES,
  HistorySummarySchema,
  NonnegativeFiniteDecimalSchema,
  type HistorySummary,
  type HistoryView,
} from "@footprint/contracts";
import { emptyHistorySummary } from "@footprint/estimator";
import { isNetworkFailure, type CompanySession } from "./company";
import { buildUsageFilters, type ViewKind } from "./ui-model";
import { scanSummary } from "./summary-scan";

function fileSummary(value: Record<string, any>) {
  const fail = (): never => {
    throw new Error("payload_rejected");
  };
  const object = (v: any, required: string[], optional: string[] = []) => {
    if (
      !v ||
      typeof v !== "object" ||
      Array.isArray(v) ||
      required.some((key) => !Object.hasOwn(v, key)) ||
      Object.keys(v).some(
        (key) => !required.includes(key) && !optional.includes(key),
      )
    )
      fail();
  };
  const count = (v: unknown): number =>
    typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : fail();
  const codes = (v: any, allowed: readonly string[], maximum: number) => {
    object(v, [], [...allowed]);
    return Object.fromEntries(
      Object.entries(v).map(([key, n]) => {
        const number = count(n);
        if (number > maximum) fail();
        return [key, number];
      }),
    );
  };
  const out: Record<string, any> = {};
  if (Object.hasOwn(value, "file_text_coverage")) {
    const coverage = value.file_text_coverage;
    if (coverage === null) out.file_text_coverage = null;
    else {
      object(coverage, [
        "observed_request_count",
        "unknown_request_count",
        "scope",
        "additive",
      ]);
      if (
        coverage.scope !== "extracted_file_text" ||
        coverage.additive !== false ||
        !CounterSchema.safeParse(coverage.observed_request_count).success ||
        !CounterSchema.safeParse(coverage.unknown_request_count).success
      )
        fail();
      if (
        value.request_count !== undefined &&
        (!CounterSchema.safeParse(value.request_count).success ||
          BigInt(coverage.observed_request_count) +
            BigInt(coverage.unknown_request_count) !==
            BigInt(value.request_count))
      )
        fail();
      out.file_text_coverage = { ...coverage };
    }
  }
  if (Object.hasOwn(value, "file_text")) {
    if (value.file_text === null) out.file_text = null;
    else {
      if (!Array.isArray(value.file_text) || value.file_text.length > 1000)
        fail();
      const groups = new Set<string>();
      out.file_text = value.file_text.map((row: any) => {
        const fields = [
          "applicable_count",
          "contributing_component_count",
          "unknown_count",
          "partial_count",
          "unvalidated_count",
        ];
        object(
          row,
          [
            "quantity",
            "scope",
            "unit",
            "additive",
            "value",
            "measurement_group",
            ...fields,
          ],
          ["reason_counts", "missing_counts"],
        );
        if (
          row.quantity !== "extracted_file_text" ||
          row.scope !== "extracted_file_text" ||
          row.unit !== "tokens" ||
          row.additive !== false ||
          (row.value !== null &&
            (typeof row.value !== "string" ||
              !/^(0|[1-9][0-9]{0,37})$/.test(row.value)))
        )
          fail();
        const group = row.measurement_group;
        object(group, [
          "origin",
          "extraction_profile_id",
          "evidence",
          "profile_id",
        ]);
        if (
          !["new_upload", "retained_context", "unknown_origin"].includes(
            group.origin,
          ) ||
          !EXTRACTION_PROFILES.includes(group.extraction_profile_id) ||
          !["heuristic_estimate", "unknown"].includes(group.evidence) ||
          (group.profile_id !== null && !PROFILE_IDS.includes(group.profile_id))
        )
          fail();
        const key = JSON.stringify([
          group.origin,
          group.extraction_profile_id,
          group.evidence,
          group.profile_id,
        ]);
        if (groups.has(key)) fail();
        groups.add(key);
        const counts = Object.fromEntries(
          fields.map((key) => [key, count(row[key])]),
        );
        const total = counts.applicable_count,
          known = counts.contributing_component_count;
        if (
          !total ||
          known > total ||
          counts.unknown_count !== total - known ||
          counts.partial_count > known ||
          counts.unvalidated_count !== known ||
          (group.evidence === "unknown"
            ? known !== 0 || row.value !== null
            : known !== total ||
              row.value === null ||
              group.profile_id === null)
        )
          fail();
        const result: Record<string, any> = {
          quantity: row.quantity,
          scope: row.scope,
          unit: row.unit,
          additive: false,
          value: row.value,
          measurement_group: { ...group },
          ...counts,
        };
        if (Object.hasOwn(row, "reason_counts"))
          result.reason_counts = codes(row.reason_counts, REASON_CODES, total);
        if (Object.hasOwn(row, "missing_counts"))
          result.missing_counts = codes(
            row.missing_counts,
            FILE_COVERAGE_REASONS,
            total,
          );
        return result;
      });
      if (
        out.file_text.length &&
        out.file_text_coverage?.observed_request_count === "0"
      )
        fail();
    }
  }
  return out;
}

function summaryQuery(query: string): string {
  if (query.length > 2048 || (query && !query.startsWith("?")))
    throw new Error("payload_rejected");
  const params = new URLSearchParams(query);
  const allowed = new Set([
    "period",
    "start",
    "end",
    "site",
    "model",
    "calculation_view",
    "method_id",
    "splits",
    "cached",
  ]);
  for (const [key, value] of params) {
    if (
      !allowed.has(key) ||
      params.getAll(key).length !== 1 ||
      value.length > (key === "method_id" ? 128 : 100) ||
      (key === "splits" && value !== "none") ||
      (key === "cached" && value !== "only")
    )
      throw new Error("payload_rejected");
  }
  const view = params.get("calculation_view") ?? "original",
    method = params.get("method_id");
  if (
    !["original", "recalculated"].includes(view) ||
    (view === "original" && method !== null) ||
    (view === "recalculated" &&
      (!method || !/^[a-z0-9][a-z0-9.-]{0,127}$/.test(method)))
  )
    throw new Error("payload_rejected");
  params.sort();
  return "?" + params.toString();
}
/** A canonical summary query without splits=none, for servers that do not know it. */
function withoutSplits(canonical: string): string {
  const params = new URLSearchParams(canonical);
  params.delete("splits");
  return "?" + params.toString();
}
/**
 * cached=only asks for this browser's last validated copy of the summary instead of the server's
 * answer, so the popup and dashboard can show it at once while the fresh summary loads. It is
 * read and removed here and never reaches the server or the cache key, so the copy is the one
 * stored for exactly the same query, scope and deletion epoch.
 */
function withoutCachedOnly(canonical: string): string {
  const params = new URLSearchParams(canonical);
  params.delete("cached");
  return "?" + params.toString();
}

const resourceBaseFields = [
  "quantity",
  "unit",
  "scope",
  "value",
  "method_group",
  "applicable_count",
  "unknown_count",
  "partial_count",
  "unvalidated_count",
  "contributing_attempt_count",
  "reason_counts",
] as const;
const aggregateFields = [
  "phase",
  "value_kind",
  "scenario_low",
  "scenario_high",
  "interval_kind",
] as const;
const methodGroupFields = [
  "method_id",
  "method_hash",
  "environment_scenario_id",
  "selected_profile_id",
  "profile_selection",
  "starting_energy_boundary",
  "result_scope",
  "cohort_id",
  "cohort_hash",
  "eligible_candidate_count",
  "eligible_candidate_signature",
  "validation_state",
  "requested_method",
  "effective_method",
  "comparability",
  "interval_kind",
] as const;

function validEngineSelection(
  requested: string,
  effective: string,
  selection: string,
) {
  if (selection === "original_fallback")
    return requested === "ecologits" && effective === "original";
  if (selection === "legacy_reference")
    return requested === "original" && effective === "original";
  if (
    ["direct_mapping", "model_override", "provider_flagship"].includes(
      selection,
    )
  )
    return requested === "ecologits" && effective === "ecologits";
  return selection === "unavailable" && requested === effective;
}

function validatedV2Resource(
  row: Record<string, any>,
  label: (value: unknown) => string,
) {
  const fail = (): never => {
    throw new Error("payload_rejected");
  };
  if (
    Object.keys(row).some(
      (key) =>
        !resourceBaseFields.includes(
          key as (typeof resourceBaseFields)[number],
        ) && !aggregateFields.includes(key as (typeof aggregateFields)[number]),
    ) ||
    [
      "quantity",
      "unit",
      "scope",
      "value",
      "method_group",
      "applicable_count",
      "unknown_count",
      "partial_count",
      "unvalidated_count",
      "contributing_attempt_count",
    ].some((key) => !Object.hasOwn(row, key))
  )
    fail();
  const group = row.method_group;
  if (
    !group ||
    typeof group !== "object" ||
    Array.isArray(group) ||
    Object.keys(group).some(
      (key) =>
        !methodGroupFields.includes(key as (typeof methodGroupFields)[number]),
    ) ||
    !Object.hasOwn(group, "requested_method") ||
    !Object.hasOwn(group, "effective_method") ||
    !Object.hasOwn(group, "comparability") ||
    !Object.hasOwn(group, "interval_kind")
  )
    fail();
  const requested = EngineMethodIdentitySchema.safeParse(
    group.requested_method,
  );
  const effective = EngineMethodIdentitySchema.safeParse(
    group.effective_method,
  );
  const comparability = EstimationEnvelopeSchema.shape.comparability.safeParse(
    group.comparability,
  );
  if (!requested.success || !effective.success || !comparability.success)
    fail();
  const requestedMethod = requested.data!;
  const effectiveMethod = effective.data!;
  const selection = label(group.profile_selection);
  const selectedProfileValid =
    group.selected_profile_id === null ||
    (typeof group.selected_profile_id === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,319}$/.test(
        group.selected_profile_id,
      ));
  if (
    !validEngineSelection(
      requestedMethod.engine_id,
      effectiveMethod.engine_id,
      selection,
    ) ||
    group.method_id !== requestedMethod.method_id ||
    group.method_hash !== requestedMethod.method_hash ||
    group.environment_scenario_id !== effectiveMethod.environment_policy_hash ||
    group.cohort_id !== effectiveMethod.method_id ||
    group.cohort_hash !== effectiveMethod.catalog_hash ||
    group.starting_energy_boundary !== "facility" ||
    group.result_scope !== row.scope ||
    ![null, "upstream_approximation", "scenario"].includes(
      group.interval_kind,
    ) ||
    (group.validation_state !== undefined &&
      group.validation_state !== "unvalidated_reference") ||
    !selectedProfileValid ||
    (["direct_mapping", "model_override", "provider_flagship"].includes(
      selection,
    ) &&
      group.selected_profile_id === null) ||
    (selection === "unavailable" && group.selected_profile_id !== null) ||
    (group.eligible_candidate_count !== null &&
      group.eligible_candidate_count !== undefined &&
      (!Number.isSafeInteger(group.eligible_candidate_count) ||
        group.eligible_candidate_count < 0)) ||
    (group.eligible_candidate_signature !== null &&
      group.eligible_candidate_signature !== undefined &&
      (typeof group.eligible_candidate_signature !== "string" ||
        !/^[a-f0-9]{64}$/.test(group.eligible_candidate_signature)))
  )
    fail();
  const value =
    row.value === null
      ? null
      : NonnegativeFiniteDecimalSchema.safeParse(row.value).success
        ? row.value
        : fail();
  if (
    ![
      "energy",
      "carbon",
      "water_direct",
      "water_upstream",
      "water_total",
    ].includes(row.quantity) ||
    ![
      "modeled_text_component",
      "historical_visible_response",
      "modeled_video_component",
    ].includes(row.scope) ||
    (row.quantity === "energy"
      ? row.unit !== "kWh"
      : row.quantity === "carbon"
        ? !["gCO2e", "gCO2"].includes(row.unit)
        : row.unit !== "L")
  )
    fail();
  const metadataPresent = aggregateFields
    .filter((key) => key !== "phase")
    .some((key) => Object.hasOwn(row, key));
  if (Object.hasOwn(row, "phase") && row.phase !== "usage") fail();
  if (metadataPresent) {
    if (
      !["value_kind", "scenario_low", "scenario_high", "interval_kind"].every(
        (key) => Object.hasOwn(row, key),
      ) ||
      !["scalar", "midpoint_sum", "unavailable"].includes(row.value_kind) ||
      row.interval_kind !== null ||
      (row.value_kind === "unavailable") !== (value === null) ||
      (row.value_kind === "midpoint_sum") !== (group.interval_kind !== null)
    )
      fail();
    // Scenario sums are only defined for midpoint_sum groups and must bracket the midpoint sum.
    // Servers written before scenario sums existed send null endpoints, which remain accepted.
    const bounded = row.scenario_low !== null || row.scenario_high !== null;
    if (
      bounded &&
      (row.value_kind !== "midpoint_sum" ||
        !NonnegativeFiniteDecimalSchema.safeParse(row.scenario_low).success ||
        !NonnegativeFiniteDecimalSchema.safeParse(row.scenario_high).success ||
        Number(row.scenario_low) > Number(value) ||
        Number(value) > Number(row.scenario_high))
    )
      fail();
  } else if (group.interval_kind !== null) fail();
  const result: Record<string, unknown> = {
    quantity: label(row.quantity),
    unit: label(row.unit),
    scope: label(row.scope),
    value,
  };
  const counts: Record<string, string> = {};
  for (const field of [
    "applicable_count",
    "unknown_count",
    "partial_count",
    "unvalidated_count",
    "contributing_attempt_count",
  ])
    if (row[field] !== undefined) {
      const parsed = String(row[field]);
      if (!CounterSchema.safeParse(parsed).success) fail();
      counts[field] = parsed;
      result[field] = parsed;
    }
  const applicable = BigInt(counts.applicable_count!),
    unknown = BigInt(counts.unknown_count!),
    partial = BigInt(counts.partial_count!),
    unvalidated = BigInt(counts.unvalidated_count!),
    contributing = BigInt(counts.contributing_attempt_count!);
  if (
    unknown + contributing !== applicable ||
    partial > applicable ||
    unvalidated > applicable ||
    (value === null) !== (contributing === 0n)
  )
    fail();
  if (row.reason_counts !== undefined) {
    if (
      !row.reason_counts ||
      typeof row.reason_counts !== "object" ||
      Array.isArray(row.reason_counts)
    )
      fail();
    result.reason_counts = Object.fromEntries(
      Object.entries(row.reason_counts).map(([reason, count]) => {
        if (!EstimateReasonSchema.safeParse(reason).success) fail();
        const parsed = String(count);
        if (!CounterSchema.safeParse(parsed).success) fail();
        return [reason, parsed];
      }),
    );
  }
  result.method_group = {
    ...group,
    requested_method: requestedMethod,
    effective_method: effectiveMethod,
    comparability: comparability.data,
  };
  for (const field of aggregateFields)
    if (Object.hasOwn(row, field)) result[field] = row[field];
  return result;
}

/**
 * The organization server's splits of a company summary (Analytics.splits): per day for windows of
 * up to 62 days, per tool and per registry model. Each part is a complete summary of its own and
 * never carries splits itself. The bounds match what the server can send, so anything larger is a
 * malformed answer, not a bigger organization.
 */
const SUMMARY_SPLITS = [
  { field: "days", maximum: 62, key: /^\d{4}-\d{2}-\d{2}$/ },
  { field: "sites", maximum: SITES.length, key: /^[a-z]{1,16}$/ },
  { field: "models", maximum: 200, key: /^[a-z0-9][a-z0-9._-]{0,127}$/ },
] as const;

function validDayKey(key: string) {
  // Rejects 2026-02-30 and similar, which the pattern alone lets through.
  const date = new Date(`${key}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === key;
}

/**
 * Validates a summary answer and keeps only the fields the extension knows. The splits are kept
 * because the dashboard draws its organization charts from them; each part passes the same checks
 * as the whole summary.
 */
export function validatedSummary(value: any): Record<string, unknown> {
  const out = validatedTotals(value);
  const fail = (): never => {
    throw new Error("payload_rejected");
  };
  for (const { field, maximum, key } of SUMMARY_SPLITS) {
    if (!Object.hasOwn(value, field)) continue;
    const parts = value[field];
    if (
      !parts ||
      typeof parts !== "object" ||
      Array.isArray(parts) ||
      Object.keys(parts).length > maximum ||
      // The server splits only current, shared totals; splits beside anything else contradict it.
      value.aggregate_status !== "current" ||
      value.suppressed === true
    )
      fail();
    out[field] = Object.fromEntries(
      Object.entries(parts).map(([name, part]: [string, any]) => {
        if (
          !key.test(name) ||
          (field === "days" && !validDayKey(name)) ||
          (field === "sites" && !(SITES as readonly string[]).includes(name)) ||
          !part ||
          typeof part !== "object" ||
          SUMMARY_SPLITS.some((split) => Object.hasOwn(part, split.field))
        )
          fail();
        const result = validatedTotals(part);
        if (field === "models") {
          // The tool that served most of the model's requests, which groups it on the Models page.
          if (!(SITES as readonly string[]).includes(part.site)) fail();
          result.site = part.site;
        }
        return [name, result];
      }),
    );
  }
  return out;
}

/**
 * The saved-history view of saved history that only the organization server holds: an organization
 * summary's, or one of its splits'. None of it was loaded in this browser, so the local side is
 * empty, and the pages read the server side (orgFigures in lib/dash/OrgOverview.tsx).
 */
export function serverHistoryView(history: unknown): HistoryView {
  const server = (history as HistorySummary | undefined) ?? null;
  return {
    local: emptyHistorySummary(),
    pending: null,
    server,
    server_status: server ? "current" : "unavailable",
    coverage: "partial_loaded_history",
  };
}

/**
 * A validated summary with each day, tool and model split's saved history in the view form the
 * whole summary's takes. validatedSummary keeps a split's history as the server sent it, which is
 * also what the saved copy stores; the dashboard checks every split like the whole summary and
 * reads `history.server`, so a split left in the server's form failed the whole answer
 * (21 October 2026) and would otherwise leave the split's saved requests out of its charts.
 */
export function withSplitHistoryViews<T extends Record<string, unknown>>(
  summary: T,
): T {
  const out: Record<string, unknown> = { ...summary };
  for (const { field } of SUMMARY_SPLITS) {
    const parts = summary[field] as Record<string, Record<string, unknown>> | undefined;
    if (!parts) continue;
    out[field] = Object.fromEntries(
      Object.entries(parts).map(([name, part]) => [
        name,
        Object.hasOwn(part, "history")
          ? { ...part, history: serverHistoryView(part.history) }
          : part,
      ]),
    );
  }
  return out as T;
}

function validatedTotals(value: any): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !["current", "rebuilding", "suppressed", "policy_disabled"].includes(
      value.aggregate_status,
    )
  )
    throw new Error("payload_rejected");
  const out: Record<string, any> = { aggregate_status: value.aggregate_status };
  Object.assign(out, fileSummary(value));
  if (Object.hasOwn(value, "history")) {
    const parsed = HistorySummarySchema.safeParse(value.history);
    if (!parsed.success) throw new Error("payload_rejected");
    out.history = parsed.data;
  }
  const numeric = (v: unknown) => {
    if (typeof v !== "string" || !/^(0|[1-9]\d{0,18})(\.\d{1,18})?$/.test(v))
      throw new Error("payload_rejected");
    return v;
  };
  const label = (v: unknown) => {
    if (typeof v !== "string" || !/^[a-zA-Z0-9_/. :+()-]{1,160}$/.test(v))
      throw new Error("payload_rejected");
    return v;
  };
  const counters = [
    "request_count",
    "attempt_count",
    "pending_estimates",
    "unconfirmed_attempt_count",
    "unresolved_request_count",
    "active_users",
    "active_installations",
  ];
  for (const key of counters)
    if (value[key] !== undefined) out[key] = numeric(value[key]);
  for (const key of [
    "generated_at",
    "range_start",
    "range_end",
    "retention_cutoff",
    "recalculated_at",
  ])
    if (value[key] !== undefined) {
      if (
        value[key] !== null &&
        (typeof value[key] !== "string" ||
          !Number.isFinite(Date.parse(value[key])))
      )
        throw new Error("payload_rejected");
      out[key] = value[key];
    }
  for (const key of ["timezone", "calculation_view"])
    if (value[key] !== undefined) out[key] = label(value[key]);
  if (value.calculation_view === "recalculated") {
    if (
      typeof value.method_id !== "string" ||
      !/^[a-z0-9][a-z0-9.-]{0,127}$/.test(value.method_id) ||
      typeof value.method_hash !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.method_hash) ||
      typeof value.recalculation_job_id !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.recalculation_job_id)
    )
      throw new Error("payload_rejected");
    out.method_id = value.method_id;
    out.method_hash = value.method_hash;
    out.recalculation_job_id = value.recalculation_job_id;
  }
  for (const key of ["suppressed", "mixed_methods"])
    if (typeof value[key] === "boolean") out[key] = value[key];
  if (value.aggregate_status !== "current")
    out.safe_message =
      value.aggregate_status === "rebuilding"
        ? "Totals are being rebuilt."
        : value.aggregate_status === "suppressed"
          ? "The organization server did not share totals for this date range."
          : "Company totals are not shared with members.";
  for (const key of ["resources", "tokens"])
    if (value[key] !== undefined) {
      if (!Array.isArray(value[key]) || value[key].length > 1000)
        throw new Error("payload_rejected");
      out[key] = value[key].map((row: any) => {
        if (!row || typeof row !== "object" || Array.isArray(row))
          throw new Error("payload_rejected");
        if (
          key === "resources" &&
          ((row?.method_group &&
            typeof row.method_group === "object" &&
            ["requested_method", "effective_method", "comparability"].some(
              (field) => Object.hasOwn(row.method_group, field),
            )) ||
            aggregateFields.some((field) => Object.hasOwn(row ?? {}, field)))
        )
          return validatedV2Resource(row, label);
        const result: Record<string, unknown> = {};
        for (const field of ["quantity", "unit", "scope"])
          result[field] = label(row[field]);
        result.value = row.value === null ? null : numeric(row.value);
        for (const field of [
          "applicable_count",
          "unknown_count",
          "partial_count",
          "unvalidated_count",
          "contributing_attempt_count",
        ])
          if (row[field] !== undefined)
            result[field] = numeric(String(row[field]));
        if (row.method_group) {
          const group: Record<string, unknown> = {};
          for (const field of [
            "method_id",
            "method_hash",
            "environment_scenario_id",
            "selected_profile_id",
            "profile_selection",
            "starting_energy_boundary",
            "result_scope",
            "cohort_id",
            "cohort_hash",
            "validation_state",
          ])
            if (row.method_group[field] !== undefined)
              group[field] =
                row.method_group[field] === null
                  ? null
                  : label(row.method_group[field]);
          result.method_group = group;
        }
        return result;
      });
    }
  if (value.coverage) {
    out.coverage = {
      resource_scope: "available compatible operational components only",
      unknown_is_zero: false,
      reference_only_excluded: true,
    };
    for (const field of [
      "recorded_attempts",
      "resource_applicable_count",
      "resource_unknown_count",
    ])
      if (value.coverage[field] !== undefined)
        out.coverage[field] = numeric(value.coverage[field]);
  }
  return out;
}
export interface ServerSummarySnapshot<History = HistorySummary> extends Record<
  string,
  unknown
> {
  snapshot_source: "server" | "cached";
  cached_at: number | null;
  offline: boolean;
  erasure_version: number;
  history?: History;
}

/**
 * Largest summary answer accepted, in bytes. A company summary carries per-day, per-site and
 * per-model splits, and a 30-day summary of a working organization measured just over 1 MiB on
 * 15 October 2026, which the general 1 MiB cap refused. 8 MiB leaves room for longer periods and
 * more models while still bounding the service worker's memory, since the whole answer is held
 * and parsed at once.
 */
export const SUMMARY_RESPONSE_BYTES = 8 * 1024 * 1024;
/**
 * Organization servers (by origin) that refused splits=none in this service worker's life. Servers
 * from before 15 October 2026 answer 422 unsupported_filter to it; their summaries are asked for
 * in full instead, so each costs one refused request per session, not one per summary.
 */
const splitsUnsupported = new Set<string>();

export async function serverSummary(
  repository: RepositorySource,
  company: CompanySession,
  view: ViewKind,
  query = "",
  conversation?: { key: string; namespace: string; maxAgeMs?: number },
  calculation?: { methodId: string; methodHash: string },
): Promise<ServerSummarySnapshot> {
  const ledger = resolveApplicationRepository(repository);
  const credentials = await company.credentials();
  if (
    !credentials ||
    (credentials.enrollment_state && credentials.enrollment_state !== "active")
  )
    throw new Error("auth_reconnect_required");
  if (
    conversation &&
    (!/^[a-f0-9]{64}$/.test(conversation.key) ||
      credentials.namespace !== conversation.namespace)
  )
    throw new Error("auth_reconnect_required");
  let canonical = summaryQuery(query);
  const cachedOnly = new URLSearchParams(canonical).get("cached") === "only";
  if (cachedOnly) {
    // A conversation summary has its own short-lived cache (maxAgeMs).
    if (conversation) throw new Error("payload_rejected");
    canonical = withoutCachedOnly(canonical);
  }
  const epoch = credentials.policy.deletion_epoch;
  const totalsOnly = new URLSearchParams(canonical).get("splits") === "none";
  if (totalsOnly && splitsUnsupported.has(credentials.origin))
    canonical = withoutSplits(canonical);
  if (
    new URLSearchParams(canonical).get("calculation_view") === "recalculated" &&
    !calculation
  )
    throw new Error("method_update_invalid");
  const erasureVersion = (await ledger.summaryVersion(credentials.namespace))
    .erasureVersion;
  const key = `server-summary:${credentials.namespace}:${view}:${await digest({ query: canonical, epoch, timezone: credentials.policy.timezone, conversation: conversation?.key ?? null, origin: credentials.origin, enrollmentEra: credentials.enrollment_era?.id ?? null, methodHash: calculation?.methodHash ?? null, methodTrust: credentials.method_public_key ?? null })}`;
  if (cachedOnly) {
    // The same checks as the offline fallback below: the copy must match the namespace, device,
    // deletion epoch and local erasure version, and no erasure may be in progress.
    const cached = await ledger.serverSnapshot(
      credentials.namespace,
      key,
      credentials.device_id,
      epoch,
      undefined,
      erasureVersion,
    );
    if (!cached) throw new Error("summary_not_cached");
    return {
      ...validatedSummary(cached.summary),
      snapshot_source: "cached",
      cached_at: cached.generatedAt,
      offline: false,
      erasure_version: erasureVersion,
    };
  }
  if (conversation?.maxAgeMs) {
    const cached = await ledger.serverSnapshot(
      credentials.namespace,
      key,
      credentials.device_id,
      epoch,
      undefined,
      erasureVersion,
    );
    if (
      cached &&
      Date.now() - cached.generatedAt < Math.min(conversation.maxAgeMs, 10000)
    )
      return {
        ...validatedSummary(cached.summary),
        snapshot_source: "cached",
        cached_at: cached.generatedAt,
        offline: false,
        erasure_version: erasureVersion,
      };
  }
  // Set once the server's answer was read, so the catch below can tell an answer that could not be
  // read (too large or not JSON) from one that was read and then failed validation.
  let answered = false;
  try {
    const answer = await company.authorized(
      conversation
        ? `/v1/me/conversations/${conversation.key}/summary${canonical}`
        : `/v1/${view === "my" ? "me" : "company"}/summary${canonical}`,
      undefined,
      undefined,
      SUMMARY_RESPONSE_BYTES,
    );
    answered = true;
    const result = validatedSummary(answer);
    if (
      calculation
        ? result.calculation_view !== "recalculated" ||
          result.method_id !== calculation.methodId ||
          result.method_hash !== calculation.methodHash ||
          (Array.isArray(result.resources) &&
            result.resources.some((resource: any) => {
              const requested = resource?.method_group?.requested_method;
              return (
                requested !== undefined &&
                (requested.method_id !== calculation.methodId ||
                  requested.method_hash !== calculation.methodHash)
              );
            }))
        : result.calculation_view !== undefined &&
          result.calculation_view !== "original"
    )
      throw new Error("method_update_invalid");
    const cached = await ledger.serverSnapshot(
      credentials.namespace,
      key,
      credentials.device_id,
      epoch,
      result,
      erasureVersion,
    );
    if (!cached) throw new Error("aggregate_inconsistent");
    return {
      ...result,
      snapshot_source: "server",
      cached_at: cached.generatedAt,
      offline: false,
      erasure_version: erasureVersion,
    };
  } catch (error) {
    // A server from before splits=none refuses the parameter. Ask once more for the full summary,
    // which holds the same totals, and remember the refusal for this session.
    if (
      totalsOnly &&
      !splitsUnsupported.has(credentials.origin) &&
      (error as { status?: unknown }).status === 422 &&
      (error as { serverCode?: unknown }).serverCode === "unsupported_filter"
    ) {
      splitsUnsupported.add(credentials.origin);
      return serverSummary(
        repository,
        company,
        view,
        withoutSplits(canonical),
        conversation,
        calculation,
      );
    }
    // An answer that could not be read (larger than the cap, or not JSON) is a summary that could
    // not be refreshed, like a timeout: the last validated copy stands in. A refusal with a status,
    // a summary that failed validation and authorization failures still cannot use the cache.
    const unreadable =
      !answered &&
      error instanceof Error &&
      error.message === "payload_rejected" &&
      (error as { status?: unknown }).status === undefined;
    if (
      !unreadable &&
      error instanceof Error &&
      [
        "auth_reconnect_required",
        "enrollment_revoked",
        "payload_rejected",
        "policy_unavailable",
        "aggregate_inconsistent",
        "recalculation_pending",
        "method_update_invalid",
        "method_unsupported",
      ].includes(error.message)
    )
      throw error;
    const cached = await ledger.serverSnapshot(
      credentials.namespace,
      key,
      credentials.device_id,
      epoch,
      undefined,
      erasureVersion,
    );
    if (!cached) throw error;
    // The cached copy stands in for a summary that could not be refreshed. It is offline only when
    // the server could not be reached; a server that answered (429, 5xx, a refusal) is reachable,
    // and the popup must not say Offline then. snapshot_source "cached" with cached_at says the
    // copy is not current.
    return {
      ...validatedSummary(cached.summary),
      snapshot_source: "cached",
      cached_at: cached.generatedAt,
      offline: isNetworkFailure(error),
      erasure_version: erasureVersion,
    };
  }
}
export async function monthlySummary(
  repository: RepositorySource,
  company: CompanySession,
  now = new Date(),
) {
  const ledger = resolveApplicationRepository(repository);
  const credentials = await company.credentials();
  if (!credentials) {
    const personal = await ledger.readPersonal();
    const settings = await ledger.readSettings();
    if (!personal || !settings?.timezone) return null;
    const filters = buildUsageFilters(
      {
        period: "last_month",
        start: "",
        end: "",
        site: "",
        model: "",
        calculationView: "original",
        methodId: "",
      },
      settings.timezone,
      now,
      "my",
    );
    const month = filters.startDate.slice(0, 7);
    const summary = await scanSummary(
      ledger,
      personal.namespace,
      filters.local,
    );
    const claimed = await ledger.claimPersonalMonthly(
      personal.namespace,
      month,
    );
    return claimed
      ? { month, timezone: settings.timezone, summary, generatedAt: Date.now() }
      : null;
  }
  if (credentials.enrollment_state && credentials.enrollment_state !== "active")
    return null;
  const timezone = credentials.policy.timezone;
  const filters = buildUsageFilters(
    {
      period: "last_month",
      start: "",
      end: "",
      site: "",
      model: "",
      calculationView: "original",
      methodId: "",
    },
    timezone,
    now,
    "my",
  );
  const month = filters.startDate.slice(0, 7);
  const previous = await ledger.lastClaimedMonth(credentials.namespace);
  if (previous === month) return null;
  const summary = await serverSummary(ledger, company, "my", filters.query);
  const claimed = await ledger.claimMonthly(
    credentials.namespace,
    month,
    credentials.device_id,
    credentials.policy.deletion_epoch,
  );
  return claimed ? { month, timezone, summary, generatedAt: Date.now() } : null;
}
