import assert from "node:assert/strict";
import { test } from "node:test";
import { pythonReference } from "../../../tools/python-reference.cjs";
import {
  HistorySummarySchema,
  ObservationSchema,
  countsAsRequest,
  type HistorySummary,
  type RequestObservation,
} from "../src/index";

// A NotebookLM notebook guide (W9): text the page asks for when a source is added.
function guide(): RequestObservation {
  return {
    schema_version: "3.0.0",
    kind: "request",
    request_id: "00000000-0000-4000-8000-000000000002",
    revision: 1,
    conversation_key: "a".repeat(64),
    key_version: "1",
    provider_request_key: null,
    site: "notebooklm",
    adapter_version: "0.1.0",
    action: "notebook_guide",
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
      processing: "none",
      extracted_text: null,
    },
    media: { input_images: [], requested_operations: [], coverage_reasons: [] },
    coverage_reasons: [],
    policy_version: "1.0.0",
    company_dedup_key: null,
  };
}

function python(cases: unknown[]) {
  const code = `import json,sys\nfrom footprint_contracts import validate_observation,counts_as_request,ContractError\nresult=[]\nfor x in json.load(sys.stdin):\n try:\n  validate_observation(x);result.append([True, counts_as_request(x)])\n except ContractError: result.append([False, counts_as_request(x)])\nprint(json.dumps(result))`;
  const run = pythonReference(["-c", code], { input: JSON.stringify(cases) });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout) as Array<[boolean, boolean]>;
}

test("W9 a notebook guide is NotebookLM text only and never a request", () => {
  const valid = guide();
  assert.equal(countsAsRequest(valid), false);
  assert.equal(countsAsRequest({ action: "send" }), true);
  const cases: unknown[] = [
    valid,
    { ...valid, site: "gemini" },
    { ...valid, features: ["audio"] },
    { ...valid, features: ["text", "image"] },
    {
      ...valid,
      documents: {
        ...valid.documents,
        upload_count: "1",
        processing: "opaque",
      },
    },
    { ...valid, documents: { ...valid.documents, types: ["text_pdf"] } },
    { ...valid, documents: { ...valid.documents, processing: "opaque" } },
    { ...valid, observed_search_operations: "1" },
    // No uploads and no searches named is still a guide.
    {
      ...valid,
      documents: { ...valid.documents, upload_count: "0" },
      observed_search_operations: "0",
    },
    // A NotebookLM chat send of the same shape is a request.
    { ...valid, action: "send" },
  ];
  const expected = [
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    true,
    true,
  ];
  assert.deepEqual(
    cases.map((value) => ObservationSchema.safeParse(value).success),
    expected,
  );
  assert.deepEqual(
    python(cases),
    expected.map((ok, index) => [ok, index === cases.length - 1]),
  );
});

function summary(counts: Partial<HistorySummary>): HistorySummary {
  return {
    schema_version: "3.0.0",
    scope: "loaded_history",
    status: "available",
    observed_prompt_count: "1",
    observed_response_count: "1",
    prompt_count: "1",
    response_count: "1",
    dated_message_count: "2",
    undated_message_count: "0",
    calculated_message_count: "2",
    uncalculated_message_count: "0",
    matched_live_message_count: "0",
    unresolved_overlap_message_count: "2",
    conflicting_message_count: "0",
    first_request_verified: false,
    branch_scope: "loaded_messages",
    provider_history_complete: false,
    tokens: [],
    resources: [],
    file_text: [],
    file_text_coverage: {
      observed_message_count: "2",
      unknown_message_count: "0",
      scope: "extracted_file_text",
      additive: false,
    },
    ...counts,
  };
}

test("W9 saved rows without a live request contribute without unresolved matching", () => {
  // Studio rows (no_live_request) count, yet none of them waits for a live match.
  for (const unresolved of ["0", "1", "2"])
    assert.ok(
      HistorySummarySchema.safeParse(
        summary({ unresolved_overlap_message_count: unresolved }),
      ).success,
      unresolved,
    );
  // More unresolved rows than contributing rows is never consistent.
  assert.equal(
    HistorySummarySchema.safeParse(
      summary({ unresolved_overlap_message_count: "3" }),
    ).success,
    false,
  );
});
