// Response fixtures for the redesigned popup and dashboard. They pass the real response validators,
// so a fixture that drifts from the extension's shapes fails loudly instead of rendering wrongly.
// Figures follow the canvas sample data (30 days: 1.04 kWh, 412 requests) and the canvas scenario
// factors (midpoint 1.45 x and maximum 1.9 x the minimum for electricity and carbon, 1.67 and 2.34 for water).
import type { HistorySummary } from "@footprint/contracts";
import type { Transport, DashboardAction } from "../lib/dashboard/client";
import { organizationConsentVersion, type OrganizationFeatures } from "../lib/organization-terms";

export const SCOPE = "a".repeat(64);
const TOKEN_KEYS = [
  "newInput",
  "toolOutput",
  "imageInput",
  "logicalInput",
  "output",
  "answer",
  "thinking",
  "toolInput",
  "intermediate",
  "reasoning",
  "otherModels",
  "input",
] as const;

const fixed = (value: number, digits = 9) => value.toFixed(digits).replace(/\.?0+$/, "") || "0";

// Like the background's groups, these carry no record selection: replies of several models add up
// in one group, so the breakdown names each model's selections beside it (`selections`).
function ranged(min: number, unit: string, scope: string, known: number, factors: [number, number]) {
  const group = {
    signature: `${scope}:${unit}`,
    scope,
    unit,
    method_id: "ecologits-0.11.2",
    value: fixed(min * factors[0]),
    known,
    value_kind: "midpoint_sum" as const,
    scenario_low: fixed(min),
    scenario_high: fixed(min * factors[1]),
    interval_kind: null,
  };
  return { value: group.value, known, unknown: 0, unit, groups: [group], reason: null, ...pick(group) };
}
const pick = (g: { value_kind: "midpoint_sum"; scenario_low: string; scenario_high: string; value: string }) => ({
  value_kind: g.value_kind,
  scenario_low: g.scenario_low,
  scenario_high: g.scenario_high,
  interval_kind: null,
});

function tokens(input: number, output: number) {
  const metric = (value: number | null) => ({
    value: value === null ? null : String(Math.round(value)),
    known: value === null ? 0 : 1,
    unknown: 0,
    partial: 0,
    notApplicable: 0,
    groups: [],
  });
  return Object.fromEntries(
    TOKEN_KEYS.map((key) => [
      key,
      metric(key === "newInput" ? input : key === "output" ? output : key === "answer" ? output * 0.8 : key === "thinking" ? output * 0.2 : null),
    ]),
  );
}

/** One summary bucket. `kwh` is the Minimum electricity; carbon and water follow the canvas factors. */
export function summary(requests: number, kwh: number, sites: Partial<Record<string, number>> = {}) {
  const energy = ranged(kwh, "kWh", "modeled_text_component", requests, [1.45, 1.9]);
  const carbon = ranged(kwh * 384.4, "gCO2e", "modeled_text_component", requests, [1.45, 1.9]);
  const water = ranged(kwh * 3.25, "L", "modeled_text_component", requests, [1.67, 2.34]);
  const tools = { chatgpt: 0, claude: 0, gemini: 0, perplexity: 0, notebooklm: 0, ...sites };
  return {
    requests,
    attempts: requests,
    tokens: tokens(requests * 2465, requests * 537),
    metrics: { energy, carbon, waterDirect: { value: null, known: 0, unknown: requests, groups: [] }, waterUpstream: { value: null, known: 0, unknown: requests, groups: [] }, water },
    tools,
    models: ["gpt-5.6-sol", "claude-opus-5-5"],
    outcomes: { completed: requests, cancelled: 0, failed: 0, interrupted_unconfirmed: 0, generating: 0 },
  };
}

const SHARES: Record<string, number> = { claude: 0.45, chatgpt: 0.3, perplexity: 0.12, notebooklm: 0.08, gemini: 0.05 };
/**
 * Canvas DashModels sample: request share, Wh per request and how each model's replies were
 * matched to a record (kind, reason, record), as config/estimation.build.json matches them.
 */
const MODELS: [string, string, number, number, string, string | null, string | null][] = [
  ["claude-opus-5-5", "claude", 0.233, 3.8, "direct_mapping", "exact_record", "anthropic/claude-opus-5-5"],
  ["claude-sonnet-5-5", "claude", 0.175, 1.5, "direct_mapping", "exact_record", "anthropic/claude-sonnet-5-5"],
  ["chatgpt-gpt-5-6-sol", "chatgpt", 0.286, 2.3, "direct_mapping", "exact_record", "openai/gpt-5.6-sol"],
  ["chatgpt-o3-pro", "chatgpt", 0.056, 1.6, "model_override", "nearest_record", "openai/gpt-6-astra"],
  ["perplexity-best", "perplexity", 0.126, 2.4, "model_override", "model_not_named", "openai/gpt-6.1-sol"],
  ["gemini-3-8-flash", "gemini", 0.092, 1.4, "direct_mapping", "exact_record", "google_genai/gemini-3.8-flash"],
  ["notebooklm-default", "notebooklm", 0.032, 6.4, "model_override", "model_not_named", "google_genai/gemini-3-flash-preview"],
];
/** Organization sample from the canvas: requests and kWh per model over 30 days. */
const ORG_MODELS: [string, string, number, number][] = [
  ["chatgpt-gpt-5-6-sol", "chatgpt", 3980, 9.35],
  ["claude-sonnet-5-5", "claude", 2860, 4.58],
  ["claude-opus-5-5", "claude", 2140, 8.13],
  ["perplexity-best", "perplexity", 1520, 3.48],
  ["gemini-3-8-flash", "gemini", 1210, 1.69],
  ["chatgpt-gpt-5-6-luna", "chatgpt", 1080, 1.71],
];
const DAILY_30 = [42, 51, 47, 55, 38, 9, 6, 46, 58, 44, 49, 35, 12, 4, 39, 44, 62, 41, 33, 7, 10, 45, 40, 48, 52, 30, 8, 5, 43, 37];
const HOURLY = [0, 0, 0, 0, 0, 0, 0, 0, 2, 4, 5, 3, 1, 2, 6, 5, 4, 3, 1, 1, 0, 0, 0, 0];

function addDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** A breakdown reply for the popup's request, with buckets matching the requested window. */
export function breakdown(request: { start?: string; end?: string; bucket: "hour" | "day"; timezone: string }, scale = 1) {
  const startDay = (request.start ?? "2026-09-07T00:00:00.000Z").slice(0, 10);
  const days = request.start && request.end ? Math.round((Date.parse(request.end) - Date.parse(request.start)) / 86400000) : 30;
  const series = request.bucket === "hour" ? HOURLY : DAILY_30.slice(-Math.min(days, 30));
  const keys = request.bucket === "hour" ? HOURLY.map((_, h) => String(h).padStart(2, "0")) : series.map((_, i) => addDays(startDay, i + 1));
  const whPerRequest = 2.524;
  const buckets: Record<string, ReturnType<typeof summary>> = {};
  let totalRequests = 0;
  series.forEach((requests, i) => {
    const r = Math.round(requests * scale * (request.bucket === "hour" ? 1 : 0.38));
    if (!r) return;
    totalRequests += r;
    buckets[keys[i]!] = summary(r, (r * whPerRequest) / 1000);
  });
  const sites = Object.fromEntries(Object.entries(SHARES).map(([site, share]) => [site, summary(Math.round(totalRequests * share), (totalRequests * whPerRequest * share) / 1000, { [site]: Math.round(totalRequests * share) })]));
  return {
    scopeToken: SCOPE,
    generatedAt: Date.now() - 60_000,
    bucket: request.bucket,
    timezone: request.timezone,
    total: summary(totalRequests, (totalRequests * whPerRequest) / 1000, Object.fromEntries(Object.entries(SHARES).map(([s, sh]) => [s, Math.round(totalRequests * sh)]))),
    buckets,
    sites,
    models: Object.fromEntries(
      MODELS.map(([id, , share, wh, kind, basis, record]) => {
        const requests = Math.round(totalRequests * share);
        return [id, { ...summary(requests, (totalRequests * share * wh) / 1000), selections: [{ kind, basis, record, replies: requests }] }];
      }),
    ),
    modelSites: Object.fromEntries(MODELS.map(([id, site]) => [id, site])),
    siteLastAt: { claude: new Date(Date.now() - 4 * 60_000).toISOString(), chatgpt: new Date(Date.now() - 12 * 60_000).toISOString(), gemini: new Date(Date.now() - 26 * 3600_000).toISOString(), perplexity: new Date(Date.now() - 3 * 3600_000).toISOString() },
    chats: Array.from({ length: 24 }, (_, i) => ({
      key: String(i).padStart(64, "0"),
      requests: 3 + (i % 7),
      site: Object.keys(SHARES)[i % 5]!,
      metrics: (() => {
        const s = summary(3 + (i % 7), (0.0014 * (1 + (i % 9))) / 1);
        return { energy: s.metrics.energy, carbon: s.metrics.carbon, water: s.metrics.water };
      })(),
    })),
    calculation: { view: "recalculated", methodId: "ecologits-0.11.2", pending: false },
    history: null,
  };
}

export type DashboardOverrides = {
  mode?: "personal" | "company";
  paused?: boolean;
  empty?: boolean;
  /** true is a connection waiting for the email code. */
  pending?: boolean | "code_sent" | "verified";
  scenario?: "minimum" | "midpoint" | "maximum";
  /** Open problems by default; state and times as the background computes them otherwise. */
  health?: { code: string; state?: "unresolved" | "resolved" | "inactive"; lastAt?: number; resolvedAt?: number; count?: number }[];
  queueCount?: number;
  /** A saved connection the server refused, which leaves the browser in personal mode. */
  ended?: "revoked" | "reconnect_needed";
  /** The organization's sharing policy; "threshold" (on) by default, null leaves it out of the policy. */
  companySharing?: "disabled" | "threshold" | null;
  /** Further saved settings, such as the long-chat tip fields. */
  settings?: Record<string, unknown>;
  /**
   * The agreement to tracking as the background sends it (18 October 2026): false before the
   * person agreed or after they turned tracking off. Left out, the settings carry no agreement,
   * as fixtures written before the step expect.
   */
  consent?: boolean;
  /** The server's operator switches as the background last read them; left out, the company carries none. */
  features?: OrganizationFeatures;
  /** Sharing waits for the person to agree to the text for those switches. */
  held?: boolean;
};

/** When the fixture person agreed: 3 October 2026. */
export const AGREED_AT = Date.UTC(2026, 9, 3, 9, 0);

export function dashboard(o: DashboardOverrides = {}) {
  return {
    scopeToken: SCOPE,
    summary: o.empty ? summary(0, 0) : summary(939, 2.37),
    generatedAt: Date.now() - 60_000,
    aggregate_status: "current",
    settings: {
      paused: !!o.paused,
      budget: null,
      timezone: "Europe/Berlin",
      displayScenario: o.scenario ?? "minimum",
      ...(o.consent === undefined
        ? {}
        : { consent: o.consent ? { agreed: true, version: "2026-10-18", at: AGREED_AT } : { agreed: false, version: null, at: null } }),
      ...o.settings,
    },
    // The same selected calculation as the breakdowns below, as the background reports it.
    calculation: { view: "recalculated", methodId: "ecologits-0.11.2", methodHash: "a".repeat(64), pending: false },
    mode: o.mode ?? "personal",
    company:
      o.mode === "company" || o.ended
        ? {
            origin: "https://aifootprinttracker.com",
            company_name: "Example Consulting",
            enrollment_state: o.mode === "company" ? "active" : o.ended,
            policy: {
              pause_mode: "user_controlled",
              policy_version: "1.0.0",
              usage_retention_months: null,
              ip_retention_days: 30,
              ...(o.companySharing === null ? {} : { company_sharing: o.companySharing ?? "threshold" }),
            },
            ...(o.features
              ? { features: o.features, consent_version: organizationConsentVersion(o.features), consent_required: !!o.held }
              : {}),
          }
        : null,
    pending:
      o.pending === "verified"
        ? {
            origin: "https://aifootprinttracker.com",
            state: "verified",
            expires_at: new Date(Date.now() + 9 * 60_000).toISOString(),
            company_name: "Example Consulting",
          }
        : o.pending
          ? {
              origin: "https://aifootprinttracker.com",
              state: "code_sent",
              expires_at: new Date(Date.now() + 4 * 60_000).toISOString(),
              email: "sam@example-consulting.com",
              retry_at: new Date(Date.now() - 1_000).toISOString(),
            }
          : null,
    queue: [],
    queueCount: o.queueCount ?? 0,
    heldQueues: [],
    health: (o.health ?? []).map((issue) => ({
      code: issue.code,
      at: issue.lastAt ?? Date.now() - 120_000,
      firstAt: issue.lastAt ?? Date.now() - 120_000,
      lastAt: issue.lastAt ?? Date.now() - 120_000,
      count: issue.count ?? 1,
      persistence: "persisted",
      scope: "current",
      resolvedAt: issue.resolvedAt ?? null,
      state: issue.state ?? "unresolved",
    })),
  };
}

function serverRows(kwh: number, attempts: number) {
  const row = (quantity: string, unit: string, min: number, f: [number, number]) => ({
    quantity,
    scope: "modeled_text_component",
    unit,
    value: fixed(min * f[0]),
    unknown_count: "0",
    contributing_attempt_count: String(attempts),
    method_id: "ecologits-0.11.2",
    value_kind: "midpoint_sum",
    scenario_low: fixed(min),
    scenario_high: fixed(min * f[1]),
    interval_kind: null,
  });
  return [row("energy", "kWh", kwh, [1.45, 1.9]), row("carbon", "gCO2e", kwh * 384.4, [1.45, 1.9]), row("water_total", "L", kwh * 3.25, [1.67, 2.34])];
}

function siteSummary(kwh: number, requests: number) {
  return { scopeToken: SCOPE, aggregate_status: "current", request_count: String(requests), attempt_count: String(requests), resources: serverRows(kwh, requests), tokens: [] };
}

/**
 * Saved history as the organization server sends it inside a summary and inside each day, tool and
 * model split: the plain HistorySummary, which the background turns into a view for the pages.
 */
export function serverHistory(prompts: string): HistorySummary {
  return {
    schema_version: "3.0.0",
    scope: "loaded_history",
    status: "available",
    observed_prompt_count: prompts,
    observed_response_count: prompts,
    prompt_count: prompts,
    response_count: prompts,
    dated_message_count: String(2 * Number(prompts)),
    undated_message_count: "0",
    calculated_message_count: String(2 * Number(prompts)),
    uncalculated_message_count: "0",
    matched_live_message_count: "0",
    unresolved_overlap_message_count: "0",
    conflicting_message_count: "0",
    first_request_verified: false,
    branch_scope: "loaded_messages",
    provider_history_complete: false,
    tokens: [],
    resources: [],
    file_text: [],
    file_text_coverage: { observed_message_count: "0", unknown_message_count: "0", scope: "extracted_file_text", additive: false },
  };
}

export function serverSummary(kind: "company" | "my", o: { offline?: boolean; stale?: boolean; previous?: boolean; kwh?: number } = {}) {
  const kwh = o.kwh ?? (kind === "company" ? (o.previous ? 29.8 : 31.6) : 1.04);
  const requests = kind === "company" ? 13820 : 412;
  return {
    scopeToken: SCOPE,
    aggregate_status: "current",
    request_count: String(requests),
    attempt_count: String(requests),
    generated_at: new Date(Date.now() - 3 * 60_000).toISOString(),
    resources: serverRows(kwh, requests),
    tokens: [],
    ...(o.offline ? { offline: true, snapshot_source: "cached", cached_at: Date.now() - 40 * 60_000 } : {}),
    // A cached copy served because the server answered with an error: reachable, not offline.
    ...(o.stale ? { offline: false, snapshot_source: "cached", cached_at: Date.now() - 40 * 60_000 } : {}),
    ...(kind === "company" ? { active_users: "34" } : {}),
    // The organization splits by tool and day that the server adds for shared totals.
    ...(kind === "company" && !o.offline ? { sites: Object.fromEntries(Object.entries(SHARES).map(([site, share]) => [site, siteSummary(kwh * share, Math.round(requests * share))])) } : {}),
    // Daily parts for the last 30 days and the models the organization used (canvas DashModelsCompany sample).
    ...(kind === "company" && !o.offline
      ? {
          days: Object.fromEntries(
            DAILY_30.map((r, i) => {
              const day = new Date(Date.now() - (29 - i) * 86400000).toISOString().slice(0, 10);
              return [day, siteSummary((kwh * r) / 1040, Math.round((requests * r) / 1040))];
            }),
          ),
          models: Object.fromEntries(
            ORG_MODELS.map(([id, site, r, k]) => [id, { ...siteSummary(k, r), site }]),
          ),
        }
      : {}),
  };
}

export type Scenario = {
  dashboard?: DashboardOverrides;
  orgOffline?: boolean;
  orgStale?: boolean;
  orgFails?: boolean;
  /**
   * The browser's saved copy of each organization summary, which a cached=only read returns.
   * Without it the background has no copy and answers summary_not_cached.
   */
  orgCached?: { ageMs: number; kwh?: number; previousKwh?: number; scopeToken?: string };
  /** The background also holds a saved copy of the person's own summary (with orgCached). */
  myCached?: boolean;
  calls?: { action: DashboardAction; payload?: Record<string, unknown> }[];
  /**
   * The server's operator switches, which the background reads once connected. A switch that is
   * on makes Connect answer review, and sharing waits for the agreement to the updated text.
   */
  serverFeatures?: OrganizationFeatures;
};

/** A transport that answers like the background, from the fixtures above. */
export function fakeTransport(scenario: Scenario = {}): Transport {
  const initial = scenario.dashboard?.pending;
  const state: { paused: boolean; pending: false | "code_sent" | "verified"; connected: boolean; consent: boolean | undefined; ownRead: boolean | undefined; held: boolean } = {
    consent: scenario.dashboard?.consent,
    ownRead: undefined,
    paused: !!scenario.dashboard?.paused,
    pending: initial === "verified" ? "verified" : initial ? "code_sent" : false,
    connected: false,
    held: !!scenario.dashboard?.held,
  };
  const switches = scenario.serverFeatures;
  const switchOn = !!switches && (switches.person_analytics || switches.ip_collection);
  return async (action, payload = {}) => {
    scenario.calls?.push({ action, payload });
    const current = () =>
      dashboard({
        ...scenario.dashboard,
        paused: state.paused,
        pending: state.pending,
        consent: state.consent,
        ...(state.ownRead === undefined ? {} : { settings: { ...scenario.dashboard?.settings, ownRead: state.ownRead } }),
        ...(state.connected ? { mode: "company" } : {}),
        ...(switches ? { features: switches } : {}),
        held: state.held,
      });
    switch (action) {
      case "dashboard":
        return current();
      case "view-token": {
        const now = current() as { scopeToken: string; settings: unknown };
        return { scopeToken: now.scopeToken, erasing: false, settings: now.settings };
      }
      case "usage-breakdown":
        return breakdown(payload as never, scenario.dashboard?.empty ? 0 : 1);
      case "company-summary": {
        const query = String(payload.query ?? "");
        const previous = query.includes("2026-08");
        if (/[?&]cached=only(&|$)/.test(query)) {
          const saved = scenario.orgCached;
          if (!saved) throw new Error("summary_not_cached");
          const copy = serverSummary("company", { previous, kwh: previous ? saved.previousKwh : saved.kwh });
          return { ...copy, scopeToken: saved.scopeToken ?? SCOPE, snapshot_source: "cached", cached_at: Date.now() - saved.ageMs, offline: false };
        }
        if (scenario.orgFails) throw new Error("organization_unavailable");
        return serverSummary("company", { offline: scenario.orgOffline, stale: scenario.orgStale, previous });
      }
      case "my-summary": {
        if (/[?&]cached=only(&|$)/.test(String(payload.query ?? ""))) {
          const saved = scenario.orgCached;
          if (!saved || !scenario.myCached) throw new Error("summary_not_cached");
          return { ...serverSummary("my"), scopeToken: saved.scopeToken ?? SCOPE, snapshot_source: "cached", cached_at: Date.now() - saved.ageMs, offline: false };
        }
        return serverSummary("my");
      }
      case "settings":
        if (typeof (payload as { changes?: { paused?: boolean } }).changes?.paused === "boolean")
          state.paused = (payload as { changes: { paused: boolean } }).changes.paused;
        return { ok: true };
      case "cancel-connection":
        state.pending = false;
        return { ok: true };
      case "consent": {
        const change = payload as { agreed?: unknown; version?: unknown; ownRead?: unknown };
        if (typeof change.agreed !== "boolean" || (change.agreed && change.version !== "2026-10-18"))
          throw new Error("payload_rejected");
        state.consent = change.agreed;
        if (typeof change.ownRead === "boolean") state.ownRead = change.ownRead;
        return { ok: true };
      }
      case "connect":
        state.pending = "code_sent";
        return { ok: true };
      // runtimeTransport turns the background's refusal (ok false, code, words) into this error.
      case "verify-code":
        if ((payload as { code?: string }).code !== "123456")
          throw Object.assign(new Error("The code is wrong or has expired. Check the latest email, or send a new code."), { code: "otp_invalid_or_expired", detail: null });
        state.pending = "verified";
        return { ok: true };
      case "confirm-connection":
        // The background refuses a connection without the organization agreement.
        if ((payload as { agreed?: unknown }).agreed !== true || (payload as { version?: unknown }).version !== "2026-10-18")
          throw new Error("payload_rejected");
        state.pending = false;
        state.connected = true;
        if (!switchOn) return { ok: true };
        state.held = true;
        return { ok: true, review: true };
      case "organization-consent":
        // The background accepts only the version for the switches it last read.
        if ((payload as { agreed?: unknown }).agreed !== true || !switches || (payload as { version?: unknown }).version !== organizationConsentVersion(switches))
          throw new Error("payload_rejected");
        state.held = false;
        return { ok: true };
      case "tracking-health":
        return { health: [], status: "available", scopeToken: SCOPE };
      case "sync":
      case "expand":
      case "disconnect":
        return { ok: true };
      case "erase-local":
        return { count: 939 };
      default:
        throw new Error(`fixture has no answer for ${action}`);
    }
  };
}
