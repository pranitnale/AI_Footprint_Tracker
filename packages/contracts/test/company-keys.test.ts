import assert from "node:assert/strict";
import { test } from "node:test";
import { pythonReference } from "../../../tools/python-reference.cjs";
import {
  HistoryPageSchema,
  UsageBatchSchema,
  emptyAttemptMedia,
  emptyGeneration,
  emptyTokenFields,
  historyResponseParts,
  type AttemptObservation,
  type RequestObservation,
} from "../src/index";

// Company keys (W11) travel beside records and messages, never inside them.
const KEY = "e".repeat(64);

function request(): RequestObservation {
  return {
    schema_version: "3.0.0",
    kind: "request",
    request_id: "00000000-0000-4000-8000-000000000001",
    revision: 1,
    conversation_key: "a".repeat(64),
    key_version: "1",
    provider_request_key: null,
    site: "chatgpt",
    adapter_version: "0.1.0",
    action: "send",
    dispatched_at: "2026-10-04T12:00:00.000Z",
    ended_at: null,
    state: "dispatched",
    model_id: null,
    model_evidence: "unknown",
    features: ["text"],
    observed_search_operations: null,
    documents: {
      upload_count: null,
      types: [],
      processing: "unknown",
      extracted_text: null,
    },
    media: { input_images: [], requested_operations: [], coverage_reasons: [] },
    coverage_reasons: [],
    policy_version: "1.0.0",
    company_dedup_key: null,
  };
}

function attempt(): AttemptObservation {
  return {
    schema_version: "3.0.0",
    kind: "attempt",
    timing: null,
    attempt_id: "00000000-0000-4000-8000-000000000002",
    request_id: "00000000-0000-4000-8000-000000000001",
    revision: 1,
    provider_attempt_key: null,
    key_version: "1",
    started_at: "2026-10-04T12:00:00.000Z",
    ended_at: "2026-10-04T12:00:05.000Z",
    state: "completed",
    execution_evidence: "content_observed",
    model_id: null,
    model_evidence: "unknown",
    tokens: emptyTokenFields(),
    media: emptyAttemptMedia(),
    generation: emptyGeneration(),
    coverage_reasons: ["cross_device_dedup_unverified"],
    tokenizer_profile_id: null,
    tokenizer_asset_hash: null,
    proposed_method_id: null,
    company_dedup_key: null,
  };
}

function batch() {
  return {
    schema_version: "3.0.0",
    batch_id: "00000000-0000-4000-8000-0000000000aa",
    sent_at: "2026-10-04T12:00:06.000Z",
    client_version: "0.1.0",
    deletion_epoch: 0,
    records: [request(), attempt()],
  };
}

function page() {
  const tokens = {
    value: "12",
    evidence: "heuristic_estimate",
    scope: "observed_text",
    completeness: "complete_for_scope",
    profile_id: "o200k-base-4.0.0-reference",
    reason: "tokenizer_mapping_unverified",
  } as const;
  return {
    schema_version: "3.0.0",
    site: "claude",
    conversation_key: "b".repeat(64),
    observed_at: "2026-10-04T12:00:00.000Z",
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
        occurred_at: "2026-10-04T11:00:00.000Z",
        date_basis: "message_created",
        observed_at: "2026-10-04T12:00:00.000Z",
        proposed_method_id: "fixture-method-v1",
        company_dedup_key: null,
        proposed_method_hash: "c".repeat(64),
        model_id: null,
        text_complete: true,
        inline_file_text: null,
        parts: historyResponseParts(tokens),
        generation: emptyGeneration(),
        coverage_reasons: ["history_only"],
        tokens,
      },
    ],
  };
}

function python(kind: "batch" | "page", cases: unknown[]): boolean[] {
  const validator =
    kind === "batch" ? "validate_batch" : "validate_history_page";
  const code = [
    "import json,sys",
    `from footprint_contracts import ${validator} as validate,ContractError`,
    "results=[]",
    "for value in json.load(sys.stdin):",
    " try:",
    "  validate(value);results.append(True)",
    " except ContractError: results.append(False)",
    "print(json.dumps(results))",
  ].join("\n");
  const run = pythonReference(["-c", code], { input: JSON.stringify(cases) });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

test("W11 a usage batch names each record's company key beside it, in TypeScript and Python", () => {
  const valid = batch();
  const entry = (kind: string, id: string, key = KEY) => ({
    kind,
    record_id: id,
    company_dedup_key: key,
  });
  const requestId = valid.records[0]!.request_id;
  const attemptId = (valid.records[1] as AttemptObservation).attempt_id;
  const cases: Array<[unknown, boolean]> = [
    [valid, true],
    [
      {
        ...valid,
        company_dedup_keys: [
          entry("request", requestId),
          entry("attempt", attemptId, "f".repeat(64)),
        ],
      },
      true,
    ],
    // An empty list is valid; the extension leaves it out, an older server rejects it.
    [{ ...valid, company_dedup_keys: [] }, true],
    // One record named twice.
    [
      {
        ...valid,
        company_dedup_keys: [
          entry("request", requestId),
          entry("request", requestId),
        ],
      },
      false,
    ],
    // A record that is not in the batch, or the right id under the wrong kind.
    [
      {
        ...valid,
        company_dedup_keys: [
          entry("attempt", "00000000-0000-4000-8000-0000000000ff"),
        ],
      },
      false,
    ],
    [{ ...valid, company_dedup_keys: [entry("attempt", requestId)] }, false],
    // Keys are lowercase hex HMACs, never a raw provider id.
    [
      {
        ...valid,
        company_dedup_keys: [entry("request", requestId, "E".repeat(64))],
      },
      false,
    ],
    [
      {
        ...valid,
        company_dedup_keys: [
          { ...entry("request", requestId), provider_id: "msg_1" },
        ],
      },
      false,
    ],
    // The key never travels inside a record.
    [
      {
        ...valid,
        records: [{ ...request(), company_dedup_key: KEY }, attempt()],
      },
      false,
    ],
    [
      {
        ...valid,
        records: [request(), { ...attempt(), company_dedup_key: KEY }],
      },
      false,
    ],
  ];
  const expected = cases.map(([, ok]) => ok);
  assert.deepEqual(
    cases.map(([value]) => UsageBatchSchema.safeParse(value).success),
    expected,
  );
  assert.deepEqual(
    python(
      "batch",
      cases.map(([value]) => value),
    ),
    expected,
  );
  const tooMany = {
    ...valid,
    company_dedup_keys: Array.from({ length: 101 }, () =>
      entry("request", requestId),
    ),
  };
  assert.equal(UsageBatchSchema.safeParse(tooMany).success, false);
  assert.deepEqual(python("batch", [tooMany]), [false]);
});

test("W11 a history page names each message's company key beside it, in TypeScript and Python", () => {
  const valid = page();
  const key = valid.messages[0]!.message_key;
  const cases: Array<[unknown, boolean]> = [
    [valid, true],
    [
      {
        ...valid,
        company_dedup_keys: [{ message_key: key, company_dedup_key: KEY }],
      },
      true,
    ],
    [
      {
        ...valid,
        company_dedup_keys: [
          { message_key: key, company_dedup_key: KEY },
          { message_key: key, company_dedup_key: KEY },
        ],
      },
      false,
    ],
    [
      {
        ...valid,
        company_dedup_keys: [
          { message_key: "d".repeat(64), company_dedup_key: KEY },
        ],
      },
      false,
    ],
    [
      {
        ...valid,
        company_dedup_keys: [{ message_key: key, company_dedup_key: "msg_1" }],
      },
      false,
    ],
    [
      {
        ...valid,
        messages: [{ ...valid.messages[0]!, company_dedup_key: KEY }],
      },
      false,
    ],
  ];
  const expected = cases.map(([, ok]) => ok);
  assert.deepEqual(
    cases.map(([value]) => HistoryPageSchema.safeParse(value).success),
    expected,
  );
  assert.deepEqual(
    python(
      "page",
      cases.map(([value]) => value),
    ),
    expected,
  );
});
