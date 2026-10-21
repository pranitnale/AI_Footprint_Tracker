import assert from "node:assert/strict";
import test from "node:test";
import { emptyHistorySummary } from "@footprint/estimator";
import type { HistorySummary, HistoryView } from "@footprint/contracts";
import {
  combinedUsage,
  HISTORY_LOADING_HINT,
  type UsageSummary,
} from "../lib/history-presentation";
import { formatInteger } from "@footprint/ui/formatters";
import { usageFigures } from "../lib/ui/usage-figures";
import type { ServerSummary } from "../lib/dashboard/types";

const hash = "a".repeat(64);
function history(changes: Partial<HistorySummary> = {}): HistorySummary {
  return {
    ...emptyHistorySummary(),
    status: "available",
    prompt_count: "8",
    observed_prompt_count: "10",
    matched_live_message_count: "2",
    unresolved_overlap_message_count: "8",
    tokens: [
      {
        role: "prompt",
        part: "total",
        profile_id: "reference",
        evidence: "heuristic_estimate",
        value: "9007199254740993",
        known_message_count: "8",
        unknown_message_count: "0",
      },
    ],
    resources: [
      {
        quantity: "energy",
        value: "0.0004",
        unit: "kWh",
        scope: "historical_visible_response",
        method_id: "baseline-public-v1",
        method_hash: hash,
        status: "partial_estimate",
        validation_state: "unvalidated_reference",
        profile_selection: "highest_comparable",
        selected_profile_id: "reference",
        reasons: [],
        missing_components: [],
        known_message_count: "8",
        unknown_message_count: "0",
      },
    ],
    ...changes,
  };
}
function view(
  local = history(),
  changes: Partial<HistoryView> = {},
): HistoryView {
  return {
    local,
    pending: null,
    server: null,
    server_status: "personal",
    coverage: "partial_loaded_history",
    ...changes,
  };
}
const live: UsageSummary = {
  requests: 2,
  tokens: {
    input: { value: "5", profile_id: "reference" },
    output: { value: null },
  },
  metrics: {
    energy: {
      value: "0.0001",
      unit: "kWh",
      groups: [
        {
          value: "0.0001",
          unit: "kWh",
          scope: "modeled_text_component",
          method_hash: hash,
        },
      ],
    },
    carbon: { value: null },
    water: { value: null },
  },
};

test("one provisional request total excludes confirmed live matches and retains exact token arithmetic", () => {
  const result = combinedUsage(live, view())!;
  assert.equal(result.requests, "≈ 10");
  assert.equal(result.input.value, "9007199254740998");
  assert.ok(result.text.includes(formatInteger("9007199254740998")));
  assert.equal(result.energy.value, "0.0005");
  assert.equal(result.water.text, "Unknown");
  assert.equal(result.status, "Estimated · Matching incomplete");
  assert.doesNotMatch(result.text, /Imported|Historical|Calculated messages/);
  assert.equal(live.requests, 2);
});

test("earlier-only conversations have normal Requests and independent loading coverage", () => {
  const partial = combinedUsage({ requests: 0 }, view())!;
  assert.equal(partial.requests, "8");
  assert.equal(partial.loading, HISTORY_LOADING_HINT);
  const loaded = combinedUsage(
    { requests: 0 },
    view(history({ first_request_verified: true })),
  )!;
  assert.equal(loaded.loading, null);
  assert.equal(loaded.status, "Estimated");
});

test("read aloud and NotebookLM guides add their output and energy without a request", () => {
  // Seen on 5 October 2026: a notebook guide in a notebook with saved Studio items but no
  // chat sent in this browser was missing from the bar's Out and Electricity.
  const guide: UsageSummary = {
    ...structuredClone(live),
    requests: 0,
    attempts: 1,
  };
  guide.tokens = {
    input: { value: "0" },
    output: { value: "35", profile_id: "reference" },
  };
  const result = combinedUsage(guide, view())!;
  assert.equal(result.requests, "8");
  assert.equal(result.matchingIncomplete, false);
  assert.equal(result.output.value, "35");
  assert.equal(result.energy.value, "0.0005");
  // The synced conversation summary counts attempts the same way.
  const synced = {
    request_count: "0",
    attempt_count: "1",
    tokens: [{ quantity: "output_total", value: "35" }],
    resources: [
      {
        quantity: "energy",
        value: "0.0001",
        unit: "kWh",
        scope: "modeled_text_component",
        method_hash: hash,
      },
    ],
  };
  const server = view(history(), { server: history() });
  assert.equal(combinedUsage(synced, server)!.output.value, "35");
  assert.equal(combinedUsage(synced, server)!.energy.value, "0.0005");
  // Attempts that never ran add nothing.
  assert.equal(
    combinedUsage({ ...synced, attempt_count: "0" }, server)!.energy.value,
    "0.0004",
  );
});

test("repeated snapshots do not accumulate and new requests increase the same count", () => {
  const snapshot = view();
  assert.equal(combinedUsage(live, snapshot)!.requests, "≈ 10");
  assert.equal(combinedUsage(live, snapshot)!.requests, "≈ 10");
  assert.equal(
    combinedUsage({ ...live, requests: 3 }, snapshot)!.requests,
    "≈ 11",
  );
});

test("different methods and resource scopes are never silently summed; approximate token counts add", () => {
  const changed = structuredClone(live);
  changed.tokens = {
    input: { value: "5", profile_id: "different" },
    output: { value: null },
  };
  changed.metrics!.energy.groups![0]!.method_hash = "b".repeat(64);
  const result = combinedUsage(changed, view())!;
  // Another tokenizer counts the same kind of thing: the ≈ figure adds, Details lists rows.
  assert.equal(result.input.value, "9007199254740998");
  assert.equal(result.energy.text, "See Details");
  changed.metrics!.energy.groups![0]!.method_hash = hash;
  changed.metrics!.energy.groups![0]!.scope = "gpu_associated_reference";
  assert.equal(combinedUsage(changed, view())!.energy.value, null);
  changed.metrics!.energy.groups![0]!.scope = "modeled_text_component";
  changed.metrics!.energy.groups![0]!.unit = "Wh";
  assert.equal(combinedUsage(changed, view())!.energy.value, null);
  // Two local groups were kept apart by the local rule (here, the view); adding saved
  // history must not join them.
  const views = structuredClone(live);
  const group = views.metrics!.energy.groups![0]!;
  // Local groups carry their full lineage, the view included.
  views.metrics!.energy.groups = [
    { ...group, view: "original" },
    { ...group, view: "recalculated" },
  ] as unknown as (typeof group)[];
  assert.equal(combinedUsage(views, view())!.energy.value, null);
  assert.equal(combinedUsage(views, view())!.energy.multiple, true);
});

test("server and local summaries use matching history snapshots and exclude pending replacements", () => {
  const snapshots = view(history({ prompt_count: "20" }), {
    server: history({ prompt_count: "8" }),
    pending: history({ prompt_count: "100" }),
    server_status: "offline",
  });
  assert.equal(
    combinedUsage({ request_count: "2" }, snapshots)!.requests,
    "≈ 10",
  );
  assert.equal(combinedUsage({ requests: 2 }, snapshots)!.requests, "≈ 22");
  assert.equal(
    combinedUsage({ request_count: "2" }, { ...snapshots, server: null }),
    null,
  );
});

test("missing measurements remain unknown and unavailable history never supplies a zero contribution", () => {
  assert.equal(
    combinedUsage(live, view(history({ status: "unavailable" }))),
    null,
  );
  const result = combinedUsage(
    { requests: 0 },
    view(history({ tokens: [], resources: [] })),
  )!;
  assert.equal(result.input.text, "Unknown");
  assert.equal(result.energy.text, "Unknown");
  assert.equal(result.water.text, "Unknown");
});

test("organization figures add the saved history that came with the server summary", () => {
  // The organization popup, dashboard and admin website pass a server summary with its own saved
  // history. Until 14 October 2026 usageFigures put that history where only local summaries look,
  // so organization figures showed live records alone.
  const organization = {
    request_count: "2",
    attempt_count: "2",
    resources: [
      {
        quantity: "energy",
        value: "0.0001",
        unit: "kWh",
        scope: "modeled_text_component",
        method_hash: hash,
      },
    ],
  };
  const figures = usageFigures(
    organization as unknown as ServerSummary,
    history(),
    "midpoint",
  );
  assert.equal(figures.energy.value, "0.0005");
  assert.equal(figures.requests, 10n);
  assert.equal(figures.approximate, true);
  // A local summary with the same saved history adds it the same way.
  assert.equal(usageFigures(live as never, history(), "midpoint").energy.value, "0.0005");
});
