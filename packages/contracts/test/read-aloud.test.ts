import assert from "node:assert/strict";
import { test } from "node:test";
import { pythonReference } from "../../../tools/python-reference.cjs";
import {
  ObservationSchema,
  countsAsRequest,
  type RequestObservation,
} from "../src/index";

// ChatGPT read aloud (G1): speech made from a reply already shown, never a request.
function readAloud(): RequestObservation {
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
    action: "read_aloud",
    dispatched_at: "2026-10-04T12:00:00.000Z",
    ended_at: null,
    state: "dispatched",
    model_id: null,
    model_evidence: "unknown",
    features: ["audio"],
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
  const code = `import json,sys\nfrom footprint_contracts import validate_observation,ContractError\nresult=[]\nfor x in json.load(sys.stdin):\n try:\n  validate_observation(x);result.append(True)\n except ContractError: result.append(False)\nprint(json.dumps(result))`;
  const run = pythonReference(["-c", code], { input: JSON.stringify(cases) });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout) as boolean[];
}

test("read aloud is ChatGPT audio only, so no other request can leave the request counts", () => {
  const valid = readAloud();
  assert.equal(countsAsRequest(valid), false);
  // The image a send carries when it edits an earlier image (coordinator shape).
  const image = {
    count: "1",
    origin: "retained_context",
    width: null,
    height: null,
    dimension_source: "unknown",
    detail: "unknown",
    token_profile_id: null,
    tokens: {
      value: null,
      evidence: "unknown",
      scope: "observed_text",
      completeness: "unknown",
      profile_id: null,
      reason: "media_processing_unobserved",
    },
  };
  const cases: unknown[] = [
    valid,
    { ...valid, site: "claude" },
    { ...valid, features: ["text"] },
    { ...valid, features: ["audio", "text"] },
    { ...valid, action: "send", features: ["text"] },
    // Request work of another kind would leave the request counts with it.
    {
      ...valid,
      documents: {
        upload_count: "1",
        types: ["text_pdf"],
        processing: "opaque",
        extracted_text: null,
      },
    },
    { ...valid, observed_search_operations: "2" },
    { ...valid, media: { ...valid.media, input_images: [image] } },
    // A request that names no uploads and no searches is still read aloud.
    {
      ...valid,
      documents: { ...valid.documents, upload_count: "0" },
      observed_search_operations: "0",
    },
    // The same work is valid on a send, so each case above fails for read aloud alone.
    {
      ...valid,
      action: "send",
      features: ["text"],
      documents: {
        upload_count: "1",
        types: ["text_pdf"],
        processing: "opaque",
        extracted_text: null,
      },
      observed_search_operations: "2",
      media: { ...valid.media, input_images: [image] },
    },
  ];
  const expected = [
    true,
    false,
    false,
    false,
    true,
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
  assert.deepEqual(python(cases), expected);
});
