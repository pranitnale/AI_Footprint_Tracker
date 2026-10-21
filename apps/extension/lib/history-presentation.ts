import { formatInteger, formatMetric } from "@footprint/ui/formatters";
import {
  DEFAULT_DISPLAY_SCENARIO,
  scenarioValue,
  type DisplayScenario,
  type HistorySummary,
  type HistoryView,
} from "@footprint/contracts";
import {
  resourceValue,
  resourceProvenance,
  isVisibleResource,
  methodReleaseNote,
  type ResourceProvenance,
} from "./dashboard/resource-presentation";
import { comparableTotal } from "@footprint/ui/totals";
import { tokenPairText } from "./conversation-display";
import { INPUT_FIELDS, OUTPUT_QUANTITIES } from "./token-summary";

// A status label for Details; the bar shows figures only (owner, 14 Oct 2026).
export const HISTORY_LOADING_HINT = "Partially loaded";

type UsageGroup = ResourceProvenance & {
  value: string | null;
  unit?: string;
  scope?: string;
  profile_id?: string | null;
  method_hash?: string;
  measurement_group?: { profile_id?: string | null };
  method_group?: { method_id?: string; method_hash?: string };
};
type UsageMetric = UsageGroup & { groups?: UsageGroup[] };
export type UsageSummary = {
  requests?: string | number;
  request_count?: string;
  attempts?: string | number;
  attempt_count?: string;
  tokens?:
    | { input: UsageMetric; output: UsageMetric }
    | Array<UsageGroup & { quantity: string }>;
  metrics?: { energy: UsageMetric; carbon: UsageMetric; water: UsageMetric };
  resources?: Array<UsageGroup & { quantity: string }>;
};

/**
 * Saved-history token rows of one side of the bar. In adds the prompt text, uploaded images
 * and the tool results replies read (A6, A7); Out adds each reply's output total and the
 * output of other models in it (D3).
 */
export function historyTokenRows(
  tokens: HistorySummary["tokens"],
  side: "input" | "output",
) {
  return tokens.filter((row) =>
    side === "input"
      ? row.role === "prompt" || row.part === "tool_output"
      : row.role === "response" &&
        (row.part === "total" || row.part === "other_models"),
  );
}

/** Token counts are approximate, so every known count adds whatever its tokenizer. */
function tokenSum(values: ReadonlyArray<string | null | undefined>) {
  const known = values.filter((value): value is string => value != null);
  return known.length
    ? known.reduce((sum, value) => sum + BigInt(value), 0n).toString()
    : null;
}

const NOTEBOOK_CHAT_PROBLEM_TEXT = new Map([
  [
    "notebooklm_chat_busy",
    "NotebookLM loaded this notebook's saved chat while the tracker was still reading other parts of the notebook, so the chat was not counted.",
  ],
  [
    "notebooklm_chat_timeout",
    "NotebookLM loaded this notebook's saved chat, but counting it did not finish within 30 seconds, so the chat was not counted.",
  ],
  [
    "notebooklm_chat_unread",
    "NotebookLM loaded this notebook's saved chat, but the tracker could not read or save it, so the chat was not counted.",
  ],
]);

/**
 * The Details entry for a page of a notebook's saved chat that was not counted, listed under
 * "Not everything could be counted" (owner, 14 Oct 2026: nothing on the bar). Null for any
 * other value.
 */
export function notebookChatProblemNote(
  problem: string | null,
): { chip: string; text: string; tone: "warn" } | null {
  const text = problem ? NOTEBOOK_CHAT_PROBLEM_TEXT.get(problem) : undefined;
  return text
    ? {
        chip: "Saved chat not counted",
        text: `${text} Reloading the page reads it again and does not send a message.`,
        tone: "warn",
      }
    : null;
}

/**
 * Why the open chat has no figures, for Details when the bar shows No figures yet and no other
 * entry says why (owner: every chat without figures names its reason). Saved messages that all
 * match requests recorded when they were sent add no request of their own; those requests show
 * once they are linked to this chat (seen live on a Perplexity Computer task, 14 Oct 2026).
 */
export function noFiguresNote(
  history:
    | Pick<
        HistorySummary,
        "status" | "prompt_count" | "matched_live_message_count"
      >
    | null
    | undefined,
  siteName: string,
): { chip: string; text: string; tone: "warn" } {
  if (
    history?.status === "available" &&
    BigInt(history.prompt_count) === 0n &&
    BigInt(history.matched_live_message_count) > 0n
  )
    return {
      chip: "Requests not linked to this chat",
      text: `The messages ${siteName} saved for this chat match requests the tracker recorded when they were sent, but those requests are not linked to this chat yet, so no figures are shown. They are linked when the chat is read again, for example after reloading the page, which does not send a message.`,
      tone: "warn",
    };
  return {
    chip: "No request counted",
    text: "The tracker found no request in this chat that it could count, so there are no figures yet. A request sent here, or the chat's saved messages once the tracker reads them, will be counted.",
    tone: "warn",
  };
}

/**
 * Whether a notebook's saved history holds chat turns. Studio rows never wait for a live
 * match, so only saved chat turns are matched to a live reply or wait for one. A notebook
 * with Studio items alone has no chat whose start could be missing.
 */
export function notebookChatRead(
  history:
    | Pick<
        HistorySummary,
        "matched_live_message_count" | "unresolved_overlap_message_count"
      >
    | null
    | undefined,
): boolean {
  return (
    !!history &&
    BigInt(history.matched_live_message_count) +
      BigInt(history.unresolved_overlap_message_count) >
      0n
  );
}

/** Select the same ownership snapshot as the live total; pending rows can replace it. */
export function selectedHistory(summary: UsageSummary, view: HistoryView) {
  return summary.requests !== undefined ? view.local : view.server;
}

/**
 * The Details note when the electricity figure Details shows adds several releases of one method
 * family: the live and saved figure when history is combined, else this browser's one group.
 * Null for a single release or for figures that do not add.
 */
export function methodReleasesNote(
  local:
    | { groups?: ReadonlyArray<{ method_releases?: readonly string[] }> }
    | undefined,
  combined: { energy: { methodReleases: number } } | null | undefined,
) {
  const groups = local?.groups ?? [];
  return methodReleaseNote(
    combined
      ? combined.energy.methodReleases
      : groups.length === 1
        ? (groups[0]!.method_releases?.length ?? 1)
        : 1,
  );
}

export function combinedUsage(
  summary: UsageSummary,
  view: HistoryView,
  scenario: DisplayScenario = DEFAULT_DISPLAY_SCENARIO,
) {
  const history = selectedHistory(summary, view);
  if (history?.status !== "available") return null;
  const liveCount = summary.requests ?? summary.request_count;
  if (liveCount === undefined) return null;
  const hasRequests = BigInt(liveCount) > 0n;
  // Read aloud and NotebookLM guides add output and energy but no request (countsAsRequest),
  // so live figures count once any attempt ran. Saved prompts only match live requests.
  const hasLive =
    hasRequests || BigInt(summary.attempts ?? summary.attempt_count ?? 0) > 0n;
  const matchingIncomplete =
    hasRequests && BigInt(history.unresolved_overlap_message_count) > 0n;
  const requests = (
    BigInt(liveCount) + BigInt(history.prompt_count)
  ).toString();
  // In and Out add the live figure and the saved rows of the same side.
  const tokens = (side: "input" | "output") => {
    const fields: readonly string[] =
      side === "input" ? INPUT_FIELDS : OUTPUT_QUANTITIES;
    const live = !hasLive
      ? []
      : Array.isArray(summary.tokens)
        ? summary.tokens
            .filter((row) => fields.includes(row.quantity))
            .map((row) => row.value)
        : [summary.tokens?.[side]?.value];
    const value = tokenSum([
      ...live,
      ...historyTokenRows(history.tokens, side).map((row) => row.value),
    ]);
    const text = value === null ? "Unknown" : `≈ ${formatInteger(value)}`;
    return {
      value,
      unit: "tokens",
      multiple: false,
      scenario_low: null,
      scenario_high: null,
      compactText: text,
      text,
    };
  };
  const metric = (kind: "energy" | "carbon" | "water") => {
    const quantity = kind === "water" ? "water_total" : kind;
    const local = summary.metrics?.[kind];
    const live = !hasLive
      ? []
      : local
        ? local.groups?.length
          ? local.groups
          : [local]
        : (summary.resources ?? []).filter((row) => row.quantity === quantity);
    const earlier: UsageGroup[] = history.resources.filter(
      (row) => row.quantity === quantity,
    );
    const known = [...live, ...earlier].filter((row) => row.value !== null);
    const unit =
      known[0]?.unit ??
      (kind === "energy" ? "kWh" : kind === "water" ? "L" : "gCO2e");
    // Live totals and saved-history rows add when they were calculated alike (D4); the
    // model, profile choice and tokenizer of each reply never split them. Other methods,
    // gas units and image boundaries remain separate in Details. Local groups already
    // differ in view, scope or another field that keeps them apart, so two never add.
    const total = comparableTotal(known);
    const localGroups = local
      ? live.filter((row) => row.value !== null).length
      : 0;
    const multiple =
      known.length > 1 &&
      (total.multiple ||
        localGroups > 1 ||
        known.some(
          (row) =>
            row.unit !== unit ||
            !["modeled_text_component", "historical_visible_response"].includes(
              row.scope ?? "",
            ),
        ));
    const value = multiple || !known.length ? null : total.value;
    const ranged = total.value_kind === "midpoint_sum";
    // Scenario sums add the same endpoint of every row, a point counting as both. One
    // ranged row without endpoints (an older snapshot) leaves them unavailable.
    const scenario_low = value !== null && ranged ? total.scenario_low : null;
    const scenario_high = value !== null && ranged ? total.scenario_high : null;
    return {
      value,
      unit,
      multiple,
      scenario_low,
      scenario_high,
      // Releases of one method family the figure adds, for the note in Details.
      methodReleases: value === null ? 0 : total.methodReleases,
      compactText: multiple
        ? "See Details"
        : formatMetric(
            scenarioValue(
              {
                value,
                value_kind: ranged ? "midpoint_sum" : "scalar",
                scenario_low,
                scenario_high,
              },
              scenario,
            ),
            unit,
          ),
      text: multiple
        ? "See Details"
        : resourceValue(
            value,
            unit,
            ranged
              ? { value_kind: "midpoint_sum", scenario_low, scenario_high }
              : {},
            scenario,
          ),
    };
  };
  const input = tokens("input"),
    output = tokens("output"),
    energy = metric("energy"),
    carbon = metric("carbon"),
    water = metric("water");
  return {
    requests: `${matchingIncomplete ? "≈ " : ""}${formatInteger(requests)}`,
    input,
    output,
    energy,
    carbon,
    water,
    matchingIncomplete,
    matchingConflict: BigInt(history.conflicting_message_count) > 0n,
    status: matchingIncomplete
      ? "Estimated · Matching incomplete"
      : "Estimated",
    loading: history.first_request_verified ? null : HISTORY_LOADING_HINT,
    text: [
      `Req ${matchingIncomplete ? "≈ " : ""}${formatInteger(requests)}`,
      tokenPairText(input.text, output.text),
      `Electricity ${energy.compactText}`,
      `Carbon ${carbon.compactText}`,
      `Water ${water.compactText}`,
    ].join(" · "),
  };
}

const readable = (value: string) => value.replaceAll("_", " ");

const count = (value: string) => formatInteger(value);

export type HistoryTokenPresentation = {
  key: string;
  role: string;
  tokens: string;
  profile: string;
  evidence: string;
  knownMessages: string;
  unknownMessages: string;
};

export type HistoryResourcePresentation = {
  key: string;
  quantity: string;
  value: string;
  status: string;
  method: string;
  methodHash: string;
  profileSelection: string;
  selectedProfile: string;
  knownMessages: string;
  unknownMessages: string;
  reasons: string;
  missing: string;
  provenance: string;
};

export type HistorySummaryPresentation = {
  state: HistorySummary["status"];
  status: string;
  compact: string;
  counts: Array<[string, string]>;
  coverage: string[];
  tokens: HistoryTokenPresentation[];
  resources: HistoryResourcePresentation[];
};

export function presentHistorySummary(
  summary: HistorySummary,
  scenario: DisplayScenario = DEFAULT_DISPLAY_SCENARIO,
): HistorySummaryPresentation {
  if (summary.status === "unavailable")
    return {
      state: summary.status,
      status: "History calculation unavailable",
      compact:
        "Loaded historical activity is unavailable. This does not mean the provider performed zero work.",
      counts: [],
      coverage: [
        "Only history loaded by the page can be considered. Complete provider execution history is not established.",
      ],
      tokens: [],
      resources: [],
    };
  if (summary.status === "empty")
    return {
      state: summary.status,
      status: "History not yet loaded",
      compact:
        "No historical messages are loaded in this view. Earlier provider activity remains unknown.",
      counts: [],
      coverage: [
        "Loading or reopening a conversation does not prove that every earlier message or execution is available.",
      ],
      tokens: [],
      resources: [],
    };
  const counts: Array<[string, string]> = [
    ["Loaded prompts", count(summary.observed_prompt_count)],
    ["Loaded responses", count(summary.observed_response_count)],
    ["Earlier requests", count(summary.prompt_count)],
    ["Earlier responses", count(summary.response_count)],
    ["Calculated messages", count(summary.calculated_message_count)],
    [
      "Messages awaiting calculation",
      count(summary.uncalculated_message_count),
    ],
    ["Messages with a source date", count(summary.dated_message_count)],
    ["Messages with an unknown date", count(summary.undated_message_count)],
    [
      "Messages matched to recorded live activity",
      count(summary.matched_live_message_count),
    ],
    [
      "Messages with unverified matching",
      count(summary.unresolved_overlap_message_count),
    ],
    ["Conflicting message records", count(summary.conflicting_message_count)],
  ];
  const coverage = [
    summary.first_request_verified
      ? "First message: loaded"
      : HISTORY_LOADING_HINT,
    `Branch: ${summary.branch_scope === "selected_branch" ? "selected conversation" : summary.branch_scope === "loaded_messages" ? "loaded messages" : "unknown"}`,
    "Estimate: visible text only",
    summary.resources.some((item) => "requested_method" in item)
      ? "Calculation lineage is listed for each resource group."
      : "Method: original recorded estimate",
  ];
  const tokenCompact = (["input", "output"] as const).map((side) => {
    const value = tokenSum(
      historyTokenRows(summary.tokens, side).map((row) => row.value),
    );
    return value === null ? "Unknown" : `≈ ${count(value)}`;
  });
  const resourceLabels = {
    energy: "Electricity",
    carbon: "Carbon",
    water_direct: "Direct water",
    water_upstream: "Electricity-supply water",
    water_total: "Water",
  } as const;
  const resourceCompact = Object.entries(resourceLabels).flatMap(
    ([quantity, label]) => {
      const rows = summary.resources.filter(
        (item) =>
          item.quantity === quantity &&
          isVisibleResource(
            item.quantity,
            "effective_method" in item ? item : {},
          ),
      );
      if (!rows.length) return [];
      // Saved rows are kept per model; rows calculated alike add up (D4).
      const total = comparableTotal(rows);
      const known = rows.filter((row) => row.value !== null);
      return [
        `${label} ${
          total.multiple
            ? "Multiple groups"
            : known.length === 1
              ? resourceValue(
                  known[0]!.value,
                  known[0]!.unit,
                  "value_kind" in known[0]! ? known[0]! : {},
                  scenario,
                )
              : resourceValue(
                  total.value,
                  total.unit ?? rows[0]!.unit,
                  total.value_kind === "midpoint_sum"
                    ? {
                        value_kind: "midpoint_sum",
                        scenario_low: total.scenario_low,
                        scenario_high: total.scenario_high,
                      }
                    : {},
                  scenario,
                )
        }`,
      ];
    },
  );
  const compactParts = [
    `Req ${count(summary.prompt_count)}`,
    tokenPairText(tokenCompact[0]!, tokenCompact[1]!),
    ...resourceCompact,
  ];
  return {
    state: summary.status,
    status: "Estimated",
    compact: compactParts.join(" · "),
    counts,
    coverage,
    tokens: summary.tokens.map((item, index) => ({
      key: `${item.role}-${item.part}-${item.profile_id ?? "unknown"}-${index}`,
      role:
        item.part === "image_input_tokens"
          ? "Uploaded images in loaded prompts"
          : item.part === "tool_output"
            ? "Tool results read by loaded responses"
            : item.part === "other_models"
              ? "Output of other models in loaded responses"
              : item.role === "prompt"
                ? "Loaded prompt text"
                : "Loaded response output",
      tokens:
        item.value === null
          ? "Unknown token count"
          : `≈ ${count(item.value)} tokens`,
      profile: item.profile_id ?? "Tokenizer profile unavailable",
      evidence:
        item.evidence === "heuristic_estimate"
          ? "Local heuristic estimate"
          : item.evidence === "provider_reported"
            ? "Reported by the provider"
            : "Unknown",
      knownMessages: count(item.known_message_count),
      unknownMessages: count(item.unknown_message_count),
    })),
    resources: summary.resources
      .filter((item) =>
        isVisibleResource(
          item.quantity,
          "effective_method" in item ? item : {},
        ),
      )
      .map((item, index) => ({
        key: `${item.quantity}-${item.method_hash}-${index}`,
        quantity:
          item.quantity === "energy"
            ? "Electricity"
            : item.quantity === "carbon"
              ? "Carbon"
              : item.quantity === "water_direct"
                ? "Direct water"
                : item.quantity === "water_upstream"
                  ? "Electricity-supply water"
                  : "Water consumption",
        value: resourceValue(
          item.value,
          item.unit,
          "value_kind" in item ? item : {},
          scenario,
        ),
        provenance:
          "value_kind" in item
            ? resourceProvenance(item, item.unit, scenario)
            : "",
        status:
          item.status === "partial_estimate"
            ? "Partial estimate"
            : "Unavailable",
        method: item.method_id,
        methodHash: item.method_hash,
        profileSelection: readable(item.profile_selection),
        selectedProfile: item.selected_profile_id ?? "Unavailable",
        knownMessages: count(item.known_message_count),
        unknownMessages: count(item.unknown_message_count),
        reasons: item.reasons.length
          ? item.reasons.map(readable).join(", ")
          : "None recorded",
        missing: item.missing_components.length
          ? item.missing_components.map(readable).join(", ")
          : "None recorded",
      })),
  };
}

export type HistoryViewSection = {
  key: "server" | "local" | "pending";
  label: string;
  summary: HistorySummary;
  presentation: HistorySummaryPresentation;
};

export function presentHistoryView(
  view: HistoryView,
  scenario: DisplayScenario = DEFAULT_DISPLAY_SCENARIO,
): {
  status: string;
  compact: string;
  sections: HistoryViewSection[];
  serverNotice: string | null;
} {
  const sections: HistoryViewSection[] = [];
  if (view.server)
    sections.push({
      key: "server",
      label:
        view.server_status === "offline"
          ? "Offline synced messages"
          : "Synced messages",
      summary: view.server,
      presentation: presentHistorySummary(view.server, scenario),
    });
  if (view.local.status !== "empty" || view.server_status === "personal")
    sections.push({
      key: "local",
      label:
        view.server_status === "personal"
          ? "Earlier messages in this browser"
          : "Local messages, separate snapshot",
      summary: view.local,
      presentation: presentHistorySummary(view.local, scenario),
    });
  if (view.pending)
    sections.push({
      key: "pending",
      label: "Messages waiting to sync",
      summary: view.pending,
      presentation: presentHistorySummary(view.pending, scenario),
    });
  const available = sections.find(
    (section) => section.presentation.state === "available",
  );
  return {
    status: available ? "Estimated" : "Earlier activity unknown",
    compact:
      sections.length === 1
        ? `${sections[0]!.label} · ${sections[0]!.presentation.compact}`
        : available
          ? `${available.label} · ${available.presentation.compact} · Other snapshots in Details`
          : "Historical activity is not available from the messages loaded so far",
    sections,
    serverNotice:
      view.server_status === "unavailable"
        ? "Synced messages unavailable. Local and pending snapshots are separate."
        : view.server_status === "offline"
          ? "Offline snapshot. New local messages are not added to it."
          : null,
  };
}
