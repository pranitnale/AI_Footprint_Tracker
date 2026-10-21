import { formatInteger, formatMetric } from "@footprint/ui/formatters";
import { comparableTotal } from "@footprint/ui/totals";
import {
  DEFAULT_DISPLAY_SCENARIO,
  REASON_CODES,
  scenarioValue,
  type DisplayScenario,
  type ReasonCode,
} from "@footprint/contracts";
import { tokenPairText } from "./conversation-display";
import {
  INPUT_FIELDS,
  OUTPUT_QUANTITIES,
  TOKEN_TOTAL_FIELDS,
  type TokenTotalKey,
} from "./token-summary";
export {
  TOKEN_LABELS,
  partlyMeasuredText,
  tokenTotalText,
  type TokenTotalKey,
} from "./token-summary";
export {
  attachmentNote,
  countSourceNote,
  coverageNotes,
  estimateDetailLines,
} from "./estimate-details";

export type PageHealthCode =
  ReasonCode | "site_access_removed" | "conversation_summary_unavailable";
export type PageHealthIssue = {
  code: PageHealthCode;
  context: "capture" | "saved_totals" | "permission" | "status";
  firstAt: number;
  lastAt: number;
  count: number;
  active: boolean;
};

const PAGE_HEALTH_MESSAGES: Record<
  PageHealthCode,
  { title: string; effect: string; action: string }
> = {
  capture_limit_exceeded: {
    title: "Capture limit reached",
    effect:
      "One or more page observations were dropped before they could be recorded.",
    action: "Reload the page if this keeps happening.",
  },
  request_identity_ambiguous: {
    title: "Observation could not be matched",
    effect:
      "One or more page observations could not be matched to their request and may be missing from totals.",
    action: "Reload the page before continuing this conversation.",
  },
  storage_write_failed: {
    title: "Browser storage failed",
    effect:
      "One or more observations could not be saved and may be missing from totals.",
    action: "Free browser storage, then restart the extension.",
  },
  capture_hook_missing: {
    title: "Site capture is unavailable",
    effect:
      "The page capture hook did not respond, so activity during this period may be missing.",
    action: "Reload the AI page.",
  },
  protocol_unsupported: {
    title: "Site response could not be observed",
    effect:
      "Visible response activity was detected without a matching captured request. Activity may be missing.",
    action:
      "Reload the page. If it continues, the site may need a tracker update.",
  },
  policy_unavailable: {
    title: "Tracking status unavailable",
    effect:
      "The page could not confirm whether tracking is enabled. No activity is assumed to be recorded during this problem.",
    action: "Open the extension and check tracking health.",
  },
  site_access_removed: {
    title: "Site access removed",
    effect:
      "The extension cannot observe this page while browser permission is missing.",
    action: "Restore site access and reload the page.",
  },
  conversation_summary_unavailable: {
    title: "Saved conversation totals unavailable",
    effect:
      "Saved numerical totals for this conversation could not be loaded. This does not indicate that new activity failed to save.",
    action: "Retry reads saved totals only and does not create an AI request.",
  },
  payload_rejected: {
    title: "Observation was rejected",
    effect:
      "One or more observations failed validation and may be missing from totals.",
    action: "Reload the page. If it continues, the tracker may need an update.",
  },
  ledger_integrity_failed: {
    title: "Observation could not be recorded",
    effect:
      "One or more observations could not be confirmed and may be missing from totals.",
    action: "Open the extension and check tracking health.",
  },
  buffer_overflow: {
    title: "Too many updates at once",
    effect:
      "The extension was busy and dropped at least one observation from this page, so its activity may be missing from totals.",
    action: "Reload the page if this keeps happening.",
  },
  aggregate_inconsistent: {
    title: "Figures could not be refreshed",
    effect:
      "The latest observation was saved, but its figures could not be shown because the calculation kept changing. Totals refresh with the next update.",
    action: "Use Retry conversation totals or reload the page to read the saved figures.",
  },
} as Record<PageHealthCode, { title: string; effect: string; action: string }>;

const FALLBACK_PAGE_HEALTH_MESSAGE = {
  title: "Tracking needs attention",
  effect:
    "One or more observations were not fully processed and may be missing from totals.",
  action: "Open the extension and check tracking health.",
};

export function pageHealthCode(value: unknown): PageHealthCode {
  return typeof value === "string" && REASON_CODES.includes(value as ReasonCode)
    ? (value as ReasonCode)
    : "ledger_integrity_failed";
}

export function pageHealthMessage(code: PageHealthCode) {
  return PAGE_HEALTH_MESSAGES[code] ?? FALLBACK_PAGE_HEALTH_MESSAGE;
}

/**
 * The short action a current tracking problem offers on the bar, or null when the person cannot
 * fix it (owner, 13 Oct 2026): those causes are explained in Details only. The actions follow
 * the advice in PAGE_HEALTH_MESSAGES; "Open the extension and check tracking health" is not a
 * fix, so its causes stay in Details.
 */
const PAGE_HEALTH_BAR_ACTIONS: Partial<Record<PageHealthCode, string>> = {
  site_access_removed: "allow access",
  capture_limit_exceeded: "reload page",
  request_identity_ambiguous: "reload page",
  capture_hook_missing: "reload page",
  protocol_unsupported: "reload page",
  payload_rejected: "reload page",
  buffer_overflow: "reload page",
  aggregate_inconsistent: "reload page",
  storage_write_failed: "free browser storage",
};
const ACTION_ORDER = [
  "allow access",
  "reload page",
  "retry",
  "free browser storage",
];
export function trackingProblemAction(
  issues: Iterable<PageHealthIssue>,
  retryAvailable = false,
): string | null {
  const actions = new Set<string>();
  for (const issue of issues) {
    if (!issue.active || issue.context === "status") continue;
    const action =
      issue.context === "permission"
        ? "allow access"
        : issue.context === "saved_totals"
          ? retryAvailable
            ? "retry"
            : "reload page"
          : PAGE_HEALTH_BAR_ACTIONS[issue.code];
    if (action) actions.add(action);
  }
  return ACTION_ORDER.find((action) => actions.has(action)) ?? null;
}

export function pageHealthSummary(issues: Iterable<PageHealthIssue>) {
  const values = [...issues];
  const active = values.filter((issue) => issue.active).length;
  const occurrences = values.reduce((total, issue) => total + issue.count, 0);
  if (!values.length)
    return { active: 0, occurrences: 0, status: "No page tracking problems" };
  return {
    active,
    occurrences,
    status: active
      ? `${formatInteger(active)} current tracking ${active === 1 ? "problem" : "problems"}`
      : `${formatInteger(occurrences)} earlier tracking ${occurrences === 1 ? "problem" : "problems"}`,
  };
}

/**
 * Where Details opens and how tall it may be. `visible` is the part of the window the bar's
 * scrolling containers leave on screen: claude.ai puts the composer in a scroll pane below its
 * fixed header, and a panel taller than the room inside that pane lost its heading (live,
 * 12 October 2026).
 */
const HEADER_INSET = 64;
export function detailsPanelPlacement(
  anchor: { top: number; bottom: number },
  viewportHeight: number,
  visible: { top: number; bottom: number } = { top: 0, bottom: viewportHeight },
) {
  const margin = 12;
  const gap = 6;
  // Provider pages keep a header bar along the top, and Perplexity's fades what passes under it
  // without taking clicks, so it cannot be measured; Details stays below the usual 64 px.
  const top = Math.max(HEADER_INSET, visible.top);
  const bottom = Math.min(viewportHeight, visible.bottom);
  const availableAbove = Math.max(0, anchor.top - top - margin - gap);
  const availableBelow = Math.max(0, bottom - anchor.bottom - margin - gap);
  const placement =
    availableAbove >= 160 || availableAbove >= availableBelow
      ? ("above" as const)
      : ("below" as const);
  return {
    placement,
    maxHeight: Math.min(
      460,
      placement === "above" ? availableAbove : availableBelow,
    ),
  };
}

type RangeFields = {
  value_kind?: "scalar" | "midpoint" | "midpoint_sum" | "unavailable";
  scenario_low?: string | null;
  scenario_high?: string | null;
};
type CompactMetric = RangeFields & {
  value: string | null;
  unit?: string;
  unknown?: number;
  reason?: string | null;
  groups?: unknown[];
};

type WaterReading =
  | { state: "known"; value: string; unit: string; partial: boolean }
  | { state: "unknown" }
  | { state: "multiple" };

type ServerResource = RangeFields & {
  quantity: string;
  value: string | null;
  unit: string;
  unknown_count?: string | number;
};

function mixed(metric: CompactMetric | undefined) {
  return (
    metric?.reason === "incompatible_scopes" ||
    (metric?.groups?.length ?? 0) > 1
  );
}

function hasUnknown(value: string | number | undefined) {
  if (value === undefined) return false;
  if (typeof value === "number")
    return !Number.isSafeInteger(value) || value < 0 || value > 0;
  try {
    return !/^\d+$/.test(value) || BigInt(value) > 0n;
  } catch {
    return true;
  }
}

function localReading(
  metric: CompactMetric | undefined,
  scenario: DisplayScenario,
): WaterReading {
  if (mixed(metric)) return { state: "multiple" };
  if (metric?.value == null) return { state: "unknown" };
  return {
    state: "known",
    value: scenarioValue(metric, scenario) ?? metric.value,
    unit: metric.unit ?? "L",
    partial: hasUnknown(metric.unknown),
  };
}

/**
 * A synced figure: series are kept per model on the server, and rows calculated alike add
 * up (D4). Rows that cannot be added stay "multiple".
 */
function serverReading(
  resources: ServerResource[],
  quantity: string,
  scenario: DisplayScenario,
): WaterReading {
  const rows = resources.filter((row) => row.quantity === quantity);
  const total = comparableTotal(rows);
  if (total.multiple) return { state: "multiple" };
  if (total.value === null) return { state: "unknown" };
  return {
    state: "known",
    value: scenarioValue(total, scenario) ?? total.value,
    unit: total.unit || "L",
    partial: rows.some((row) => hasUnknown(row.unknown_count)),
  };
}

/** A synced resource figure as text: its unit, "See Details" or "Unknown". */
export function serverResourceText(
  resources: ServerResource[] | undefined,
  quantity: string,
  scenario: DisplayScenario = DEFAULT_DISPLAY_SCENARIO,
) {
  const reading = serverReading(resources ?? [], quantity, scenario);
  return reading.state === "known"
    ? formatMetric(reading.value, reading.unit)
    : reading.state === "multiple"
      ? "See Details"
      : "Unknown";
}

type ServerTokenRow = {
  quantity: string;
  value: string | null;
  unknown_count?: string | number;
  partial_count?: string | number;
};
/**
 * Synced token figures add every known count of the named fields: token counts are
 * approximate, so a reply's tokenizer never splits them. In adds new input text, tool
 * results and uploaded images; Out adds the output total and other models' output.
 */
export function serverTokenTotal(
  rows: ServerTokenRow[] | undefined,
  side: "input" | "output",
): string | null {
  const fields: readonly string[] =
    side === "input" ? INPUT_FIELDS : OUTPUT_QUANTITIES;
  const known = (rows ?? []).filter(
    (row) => fields.includes(row.quantity) && row.value !== null,
  );
  return known.length
    ? known.reduce((sum, row) => sum + BigInt(row.value!), 0n).toString()
    : null;
}

/**
 * One synced token figure for Details with its missing and partial reply counts. The
 * combined "In" has no per-reply counts, as its parts are kept as separate series. The
 * server keeps no series for a field that applies to none of the confirmed replies.
 */
export function serverTokenFigure(
  rows: ServerTokenRow[] | undefined,
  key: TokenTotalKey,
  attempts = 0,
): {
  value: string | null;
  unknown?: number;
  partial?: number;
  notApplicable?: number;
} {
  if (key === "input") {
    const value = serverTokenTotal(rows, "input");
    return value === null ? { value, unknown: 1 } : { value };
  }
  if (key === "output") {
    // Out adds two series. Replies without an output total are unknown; an unknown
    // count of another model leaves Out measured in part.
    const total = serverTokenFigure(rows, "otherModels", attempts);
    const own = (rows ?? []).filter((row) => row.quantity === "output_total");
    const count = (field: "unknown_count" | "partial_count") =>
      own.reduce((sum, row) => sum + Number(row[field] ?? 0), 0);
    return {
      value: serverTokenTotal(rows, "output"),
      unknown: count("unknown_count"),
      partial: count("partial_count") + (total.unknown ?? 0),
      notApplicable: own.length ? 0 : attempts,
    };
  }
  const matching = (rows ?? []).filter(
    (row) => row.quantity === TOKEN_TOTAL_FIELDS[key],
  );
  const known = matching.filter((row) => row.value !== null);
  const count = (field: "unknown_count" | "partial_count") =>
    matching.reduce((sum, row) => sum + Number(row[field] ?? 0), 0);
  return {
    value: known.length
      ? known.reduce((sum, row) => sum + BigInt(row.value!), 0n).toString()
      : null,
    unknown: count("unknown_count"),
    partial: count("partial_count"),
    notApplicable: matching.length ? 0 : attempts,
  };
}

// The compact bar shows one water figure. Direct and electricity-supply parts,
// and why a combined total is unavailable, belong in Details.
function waterText(total: WaterReading) {
  if (total.state === "known")
    return `Water ${formatMetric(total.value, total.unit)}${total.partial ? " (partial)" : ""}`;
  return total.state === "multiple" ? "Water See Details" : "Water Unknown";
}

export function localWaterText(
  metrics: {
    water: CompactMetric;
    waterDirect?: CompactMetric;
    waterUpstream?: CompactMetric;
  },
  scenario: DisplayScenario = DEFAULT_DISPLAY_SCENARIO,
) {
  return waterText(localReading(metrics.water, scenario));
}

export function serverWaterText(
  resources: ServerResource[] | undefined,
  scenario: DisplayScenario = DEFAULT_DISPLAY_SCENARIO,
) {
  return waterText(serverReading(resources ?? [], "water_total", scenario));
}

export function conversationBar(
  summary: any,
  options: {
    failure: boolean;
    state?: string;
    pending?: boolean;
  },
  scenario: DisplayScenario = DEFAULT_DISPLAY_SCENARIO,
) {
  const metrics = [
    summary.metrics.energy,
    summary.metrics.carbon,
    summary.metrics.water,
  ];
  // With no request yet, every value is empty. That is not a measurement.
  const measured =
    String(summary.requests ?? "0") !== "0" ||
    metrics.some((metric: any) => metric.value !== null);
  // A partial measurement is ordinary uncertainty, not an error: Details explains it and
  // the bar never shows it as a status (owner decision, 2 Oct). A waiting recalculation
  // leaves values empty for a moment, so it reads as Updating. Sync state is shown in
  // Details only (owner, 13 Oct 2026), so a waiting upload changes nothing here.
  const status = options.failure
    ? "Tracking problem"
    : options.state === "generating"
      ? "Processing"
      : options.pending && measured
        ? "Updating"
        : measured
          ? "Recorded"
          : "";
  const tokens = (value: unknown) =>
    value == null ? formatInteger(null) : `≈ ${formatInteger(value as string)}`;
  // In adds new input text, tool results and uploaded images; Out is the output total.
  // Generated images, speech and video are inside the resource figures, not separate labels.
  const text = [
    `Req ${formatInteger(summary.requests)}`,
    tokenPairText(
      tokens(summary.tokens.input.value),
      tokens(summary.tokens.output.value),
    ),
    `Electricity ${formatMetric(scenarioValue(summary.metrics.energy, scenario), "kWh")}`,
    `Carbon ${formatMetric(scenarioValue(summary.metrics.carbon, scenario), summary.metrics.carbon.unit ?? "")}`,
    localWaterText(summary.metrics, scenario),
  ];
  return { status, text: text.join(" · ") };
}

/**
 * The bar shows only the figures, or one short state before the chat has any (barStateText),
 * and the Details control (owner, 14 Oct 2026, replacing the statuses kept on the bar on
 * 13 Oct). Every status still reaches Details: one the person can
 * act on opens Details with its action, progress goes to the line at the bottom of Details,
 * and the rest go under "Not everything could be counted". "Recorded" is the ordinary state
 * and is not shown. See the compact-bar decision in AGENTS.md.
 */
const BAR_PROGRESS = new Set([
  "Processing",
  "Updating",
  "Loading earlier messages",
  "Calculating earlier messages",
  "Loading conversation totals",
]);
const QUIET = new Set(["Recorded"]);
const BAR_ACTIONS: Record<string, string> = {
  "Reload required": "reload page",
  "Site access removed": "allow access",
  "History not loaded": "reload page",
  "History update problem": "reload page",
  "History calculation unavailable": "reload page",
  "Conversation totals unavailable": "retry",
  "Saved totals refresh problem": "retry",
};
/*
 * "Thread not loaded" (Perplexity's "History not loaded") has no action (17 Oct 2026, when
 * Perplexity never sent a thread's messages on a page load). Since 19 Oct 2026 a full page load
 * sends them and the thread is normally counted, so the state is rarely reached; Details says
 * that reloading usually counts them.
 *
 * "Partially loaded" has no action on any site. A long ChatGPT chat loads its earlier turns when
 * the person scrolls up (seen live 5 Oct 2026), but the tracker now reads the missing pages
 * itself, so the part it still could not read is listed with what could not be counted.
 */

/*
 * Until the open chat has figures the bar shows one short state instead of the figure labels,
 * never "Req 0" (owner decision of 14 Oct 2026, afternoon). Each is plain text in the figures
 * slot, so screen readers read it like the figures, without a live region.
 */
export const BAR_WAITING = "Waiting for your request";
export const BAR_PROCESSING = "Processing";
export const BAR_NO_FIGURES = "No figures yet";
/**
 * Before the person agreed to tracking the bar shows only this, with Set up in place of
 * Details, which opens the welcome page (lib/tracking-consent.ts). It is the one state beside the
 * figures, an exception the owner approved on 18 October 2026; after agreeing the bar is
 * unchanged.
 */
export const BAR_TRACKING_OFF = "Tracking is off";
export const BAR_SET_UP = "Set up";

export type BarActivity = {
  /**
   * Something that can still bring this chat's first figures is pending: a reply streaming or
   * waiting for its figures, a history read or import, the tracker's own read, a saved-totals
   * read or a recalculation.
   */
  working: boolean;
  /**
   * The chat has messages, or tracking cannot continue on this page: an opened chat, a request
   * sent in this navigation, a notebook whose saved chat was read or refused, a stopped
   * extension or removed site access. Without it there is nothing to count yet.
   */
  started: boolean;
};

/** The bar's text while the open chat has no figures. Why a chat has none is in Details. */
export function barStateText(activity: BarActivity) {
  return activity.working
    ? BAR_PROCESSING
    : activity.started
      ? BAR_NO_FIGURES
      : BAR_WAITING;
}

const wholeCount = (value: unknown) =>
  /^(0|[1-9]\d*)$/.test(String(value ?? "")) ? BigInt(String(value)) : null;

/**
 * Whether a NotebookLM notebook's only counted work is its notebook guide: the title, summary
 * and suggested questions the page asks for after a source is added. A guide is not a request
 * (countsAsRequest), so its figures read Req 0, as Details counts them, and the bar shows
 * them instead of Waiting for your request (owner decision of 16 Oct 2026). On NotebookLM an
 * attempt without a request can only be a guide. A guide that wrote nothing (Out 0), as for a
 * notebook without sources, leaves Waiting for your request. Other sites keep the rule that
 * the bar shows figures only once a request is counted.
 */
export function notebookGuideOnly(
  site: string | null | undefined,
  summary:
    | {
        requests?: unknown;
        request_count?: unknown;
        attempts?: unknown;
        attempt_count?: unknown;
      }
    | null
    | undefined,
  output: string | null | undefined,
) {
  return (
    site === "notebooklm" &&
    wholeCount(summary?.requests ?? summary?.request_count) === 0n &&
    (wholeCount(summary?.attempts ?? summary?.attempt_count) ?? 0n) > 0n &&
    wholeCount(output) !== 0n
  );
}

export type BarStatusContext = {
  /** The provider site; kept for callers, no status depends on it now. */
  site?: string | null;
  /** The action a current tracking problem offers, from trackingProblemAction; null keeps it without one. */
  trackingAction?: string | null;
};

/**
 * Sorts a composed status for Details: statuses with an action (named in brackets), progress,
 * and the rest. None of them is shown on the bar.
 */
export function barStatusParts(status: string, context: BarStatusContext = {}) {
  const actionable: Array<{ label: string; action: string | null }> = [];
  const details: string[] = [];
  const progress: string[] = [];
  for (const part of status.split(" · ").filter(Boolean)) {
    if (
      actionable.some((item) => item.label === part) ||
      details.includes(part) ||
      progress.includes(part) ||
      QUIET.has(part)
    )
      continue;
    if (BAR_PROGRESS.has(part)) {
      progress.push(part);
      continue;
    }
    const action =
      part === "Tracking problem"
        ? (context.trackingAction ?? null)
        : (BAR_ACTIONS[part] ?? null);
    if (action) actionable.push({ label: part, action });
    else details.push(part);
  }
  // Neighbours that share an action name it once: "Tracking problem · Saved totals refresh
  // problem (retry)" keeps the line short.
  const text = actionable
    .map((item, index) =>
      item.action && actionable[index + 1]?.action !== item.action
        ? `${item.label} (${item.action})`
        : item.label,
    )
    .join(" · ");
  return { actionable: text, details: details.join(" · "), progress };
}

/**
 * Keeps the composed status on the bar's hidden state element for Details. The element has no
 * text, role or hover help: the bar shows figures or barStateText only (owner, 14 Oct 2026).
 */
export function setBarStatus(
  status: string,
  root: ParentNode | null | undefined,
  context: BarStatusContext = {},
) {
  const label = root?.querySelector<HTMLElement>("[data-status]");
  if (!label) return;
  const parts = barStatusParts(status, context);
  label.textContent = "";
  label.dataset.actionable = parts.actionable;
  label.dataset.details = parts.details;
  label.dataset.progress = parts.progress.join(" · ");
}
/** Every status the bar's state holds, as one text: actions, then the rest, then progress. */
export function detailsStatusText(label: HTMLElement) {
  return [
    label.dataset.actionable ?? "",
    label.dataset.details ?? "",
    label.dataset.progress ?? "",
  ]
    .filter(Boolean)
    .join(" · ");
}
