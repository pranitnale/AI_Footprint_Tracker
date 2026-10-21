import test from "node:test";
import assert from "node:assert/strict";
import { pythonReference } from "../../../tools/python-reference.cjs";
import {
  HistoryPageSchema,
  historyNumericPayloadHash,
  compareHistoricalInstants,
  refineHistory,
  emptyGeneration,
  historyResponseParts,
  mergeHistoryCoverage,
  regeneratedHistoryReplies,
  HistorySummarySchema,
  type HistoryMessage,
  type HistorySummary,
} from "../src/index";

function page() {
  return HistoryPageSchema.parse({
    schema_version: "3.0.0",
    site: "claude",
    conversation_key: "b".repeat(64),
    observed_at: "2026-09-14T12:00:00.000Z",
    deletion_epoch: 0,
    branch_scope: "loaded_messages",
    selected_leaf_key: null,
    branch_message_keys: null,
    root_message_key: null,
    first_request_verified: false,
    has_earlier: null,
    has_later: null,
    messages: [
      {
        schema_version: "3.0.0",
        kind: "history_message",
        timing: null,
        site: "claude",
        key_version: "1",
        conversation_key: "b".repeat(64),
        message_key: "a".repeat(64),
        role: "response",
        parent_key: null,
        prompt_key: null,
        provider_request_key: null,
        provider_attempt_key: null,
        occurred_at: "2020-01-01T00:00:00.000001Z",
        date_basis: "message_created",
        observed_at: "2026-09-14T12:00:00.000Z",
        proposed_method_id: "fixture-method-v1",
        company_dedup_key: null,
        proposed_method_hash: "c".repeat(64),
        model_id: null,
        text_complete: true,
        inline_file_text: null,
        parts: historyResponseParts({
          value: "9223372036854775807",
          evidence: "heuristic_estimate",
          scope: "observed_text",
          completeness: "complete_for_scope",
          profile_id: "o200k-base-4.0.0-reference",
          reason: "tokenizer_mapping_unverified",
        }),
        generation: emptyGeneration(),
        coverage_reasons: ["history_only"],
        tokens: {
          value: "9223372036854775807",
          evidence: "heuristic_estimate",
          scope: "observed_text",
          completeness: "complete_for_scope",
          profile_id: "o200k-base-4.0.0-reference",
          reason: "tokenizer_mapping_unverified",
        },
      },
    ],
  });
}

test("historical whitelist, date precision, counts and numeric hashes agree across Python and TypeScript", () => {
  const valid = page();
  const changes: Array<(value: any) => void> = [
    (p) => {
      p.messages[0].occurred_at = null;
      p.messages[0].date_basis = "unknown";
    },
    (p) => {
      p.messages[0].text = "PRIVATE_SENTINEL";
    },
    (p) => {
      p.messages[0].occurred_at = "2020-02-30T00:00:00.000001Z";
    },
    (p) => {
      p.messages[0].occurred_at = "2020-01-01T00:00:00.0000001Z";
    },
    (p) => {
      p.messages[0].tokens.value = "9223372036854775808";
    },
    (p) => {
      p.messages[0].date_basis = "unknown";
    },
    (p) => {
      p.messages.push(structuredClone(p.messages[0]));
    },
    (p) => {
      p.messages[0].conversation_key = "d".repeat(64);
    },
    (p) => {
      p.messages[0].role = "prompt";
      p.messages[0].provider_attempt_key = "d".repeat(64);
    },
    (p) => {
      p.messages[0].tokens.value = null;
    },
    (p) => {
      p.first_request_verified = true;
    },
  ];
  const cases = [
    valid,
    ...changes.map((change) => {
      const p = structuredClone(valid);
      change(p);
      return p;
    }),
  ];
  const expected = [true, true, ...Array(10).fill(false)];
  assert.deepEqual(
    cases.map((p) => HistoryPageSchema.safeParse(p).success),
    expected,
  );
  const run = pythonReference(
    [
      "-c",
      [
        "import json,sys",
        "from footprint_contracts import validate_history_page,ContractError,payload_hash",
        "results=[]",
        "for page in json.load(sys.stdin):",
        " try:",
        "  validate_history_page(page)",
        "  results.append([True,payload_hash({k:v for k,v in page['messages'][0].items() if k!='observed_at'})])",
        " except ContractError: results.append([False,None])",
        "print(json.dumps(results))",
      ].join("\n"),
    ],
    { input: JSON.stringify(cases) },
  );
  assert.equal(run.status, 0, run.stderr);
  const results = JSON.parse(run.stdout);
  assert.deepEqual(
    results.map((r: any) => r[0]),
    expected,
  );
  assert.equal(results[0][1], historyNumericPayloadHash(valid.messages[0]));
});

test("historical comparison preserves microseconds and only missing evidence can refine originals", () => {
  assert.equal(
    compareHistoricalInstants(
      "2020-01-01T00:00:00.000Z",
      "2020-01-01T00:00:00.000000Z",
    ),
    0,
  );
  assert.equal(
    compareHistoricalInstants(
      "2020-01-01T00:00:00.000001Z",
      "2020-01-01T00:00:00.000Z",
    ),
    1,
  );
  const original = page().messages[0];
  assert.equal(
    refineHistory(original, {
      ...original,
      observed_at: "2026-09-14T13:00:00.000Z",
    }),
    "duplicate",
  );
  assert.equal(
    refineHistory(
      { ...original, occurred_at: null, date_basis: "unknown" },
      original,
    ),
    "improved",
  );
  assert.equal(
    refineHistory(original, {
      ...original,
      occurred_at: "2021-01-01T00:00:00.000001Z",
    }),
    "conflict",
  );
});

test("an older read that proves the first request keeps its proof when it commits after a newer one", () => {
  const coverage = (
    observed: string,
    root: string | null,
    verified: boolean,
    leaf: string | null,
  ) => ({
    ...page(),
    messages: [],
    observed_at: observed,
    root_message_key: root,
    first_request_verified: verified,
    selected_leaf_key: leaf,
  });
  const root = "c".repeat(64),
    leaf = "d".repeat(64),
    other = "e".repeat(64);
  // A newest-turns poll committed first; the earlier page that reaches the start was
  // requested before it but answered later (5 Oct 2026 review).
  const newer = coverage("2026-10-05T12:00:02.000Z", null, false, leaf);
  const older = coverage("2026-10-05T12:00:01.000Z", root, true, null);
  const merged = mergeHistoryCoverage(newer, older);
  assert.equal(merged.first_request_verified, true);
  assert.equal(merged.root_message_key, root);
  assert.equal(merged.selected_leaf_key, leaf);
  assert.equal(merged.observed_at, newer.observed_at);
  // An older read without proof, or with a different root, changes nothing.
  assert.equal(
    mergeHistoryCoverage(
      newer,
      coverage("2026-10-05T12:00:01.000Z", null, false, null),
    ),
    newer,
  );
  const rooted = coverage("2026-10-05T12:00:02.000Z", other, false, leaf);
  assert.equal(mergeHistoryCoverage(rooted, older), rooted);
  // In order, the newer read still wins and a proven root stays proven.
  const later = mergeHistoryCoverage(older, newer);
  assert.equal(later.first_request_verified, true);
  assert.equal(later.root_message_key, root);
  assert.equal(later.selected_leaf_key, leaf);
});

test("a regenerated Claude reply is every reply to a prompt after its first, in TypeScript and Python", () => {
  const key = (n: number) => n.toString(16).padStart(64, "0");
  let next = 100;
  const reply = (
    prompt: number,
    occurredAt: string | null,
    changes: Partial<HistoryMessage> = {},
  ) => ({
    message_key: key(next++),
    role: "response" as const,
    site: "claude" as const,
    conversation_key: key(1),
    parent_key: key(prompt),
    prompt_key: key(prompt),
    provider_attempt_key: key(next + 1000),
    occurred_at: occurredAt,
    ...changes,
  });
  // Times compare as instants, not as text: as text, ".10001Z" sorts before ".100Z".
  const first = reply(2, "2020-01-01T12:00:01.100Z");
  const retry = reply(2, "2020-01-01T12:00:01.10001Z");
  const undated = reply(2, null);
  const records = [
    retry,
    undated,
    first,
    // The only reply to another prompt.
    reply(3, "2020-01-01T12:00:00.000Z"),
    // Not regenerations: another chat, a reply to a reply, a Cowork result (no reply id),
    // another site.
    reply(2, "2020-01-01T12:00:09.000Z", { conversation_key: key(9) }),
    reply(2, "2020-01-01T12:00:09.000Z", { parent_key: first.message_key }),
    reply(4, "2020-01-01T12:00:09.000Z", { provider_attempt_key: null }),
    reply(4, "2020-01-01T12:00:10.000Z", { provider_attempt_key: null }),
    reply(5, "2020-01-01T12:00:09.000Z", { site: "chatgpt" }),
    reply(5, "2020-01-01T12:00:10.000Z", { site: "chatgpt" }),
  ];
  const expected = [retry, undated]
    .map((r) => r.message_key)
    .sort();
  assert.deepEqual([...regeneratedHistoryReplies(records)].sort(), expected);
  // Two undated replies, or two at one instant written with different precision: the
  // message key decides, so every reader picks the same first.
  const a = reply(6, null),
    b = reply(6, null);
  assert.deepEqual([...regeneratedHistoryReplies([b, a])], [b.message_key]);
  const c = reply(7, "2020-01-01T12:00:01.100000Z"),
    d = reply(7, "2020-01-01T12:00:01.100Z");
  assert.deepEqual([...regeneratedHistoryReplies([d, c])], [d.message_key]);
  const run = pythonReference(
    [
      "-c",
      [
        "import json,sys",
        "from footprint_contracts import regenerated_history_replies",
        "cases=json.load(sys.stdin)",
        "print(json.dumps([sorted(regenerated_history_replies(c)) for c in cases]))",
      ].join("\n"),
    ],
    { input: JSON.stringify([records, [b, a], [d, c]]) },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), [
    expected,
    [b.message_key],
    [d.message_key],
  ]);
});

test("a history summary counts regenerated replies as requests without breaking its coverage", () => {
  const summary = (counts: Partial<HistorySummary>): HistorySummary => ({
    schema_version: "3.0.0",
    scope: "loaded_history",
    status: "available",
    observed_prompt_count: "1",
    observed_response_count: "2",
    prompt_count: "1",
    response_count: "2",
    dated_message_count: "3",
    undated_message_count: "0",
    calculated_message_count: "3",
    uncalculated_message_count: "0",
    matched_live_message_count: "0",
    unresolved_overlap_message_count: "3",
    conflicting_message_count: "0",
    first_request_verified: false,
    branch_scope: "loaded_messages",
    provider_history_complete: false,
    tokens: [],
    resources: [],
    file_text: [],
    file_text_coverage: {
      observed_message_count: "3",
      unknown_message_count: "0",
      scope: "extracted_file_text",
      additive: false,
    },
    ...counts,
  });
  const valid = (counts: Partial<HistorySummary>) =>
    HistorySummarySchema.safeParse(summary(counts)).success;
  // One prompt, two replies: Req 1, or 2 when the second reply was a regeneration.
  assert.equal(valid({}), true);
  assert.equal(valid({ prompt_count: "2" }), true);
  // Every reply a regeneration is the most a summary can hold; fewer requests than
  // contributing prompts, or more than prompts and replies together, never.
  assert.equal(valid({ prompt_count: "3" }), true);
  assert.equal(valid({ prompt_count: "4" }), false);
  assert.equal(valid({ prompt_count: "0" }), false);
  assert.equal(valid({ response_count: "1" }), false);
});
