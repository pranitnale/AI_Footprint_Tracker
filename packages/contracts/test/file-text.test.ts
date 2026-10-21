import assert from "node:assert/strict";
import { test } from "node:test";
import { pythonReference } from "../../../tools/python-reference.cjs";
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
    started_at: "2026-09-10T12:00:00.000Z",
    ended_at: "2026-09-10T12:00:05.000Z",
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

import {
  ObservationSchema,
  UsageBatchSchema,
  parseObservation,
  payloadHash,
  canonicalJson,
  emptyTokenFields,
  emptyGeneration,
  emptyAttemptMedia,
  type AttemptObservation,
  extractedFileText,
  type RequestObservation,
  type ExtractedFileTextComponent,
} from "../src/index";

function request(): RequestObservation {
  return {
    schema_version: "3.0.0",
    kind: "request",
    request_id: attempt().request_id,
    revision: 1,
    conversation_key: "a".repeat(64),
    key_version: "1",
    provider_request_key: null,
    site: "chatgpt",
    adapter_version: "0.1.0",
    action: "send",
    dispatched_at: attempt().started_at,
    ended_at: null,
    state: "dispatched",
    model_id: null,
    model_evidence: "unknown",
    features: ["text"],
    observed_search_operations: null,
    documents: {
      upload_count: "1",
      types: ["text_pdf"],
      processing: "opaque",
      extracted_text: null,
    },
    media: { input_images: [], requested_operations: [], coverage_reasons: [] },
    coverage_reasons: [],
    policy_version: "1.0.0",
    company_dedup_key: null,
  };
}
function component(): ExtractedFileTextComponent {
  return {
    component_id: "00000000-0000-4000-8000-000000000003",
    origin: "new_upload",
    extraction_profile_id: "local-file-text-utf8-pdfjs6.3.289-opc-v1",
    page_count: 2,
    tokens: {
      value: "9223372036854775807",
      evidence: "heuristic_estimate",
      scope: "extracted_file_text",
      completeness: "partial",
      profile_id: "o200k-base-4.0.0-reference",
      reason: "tokenizer_mapping_unverified",
    },
    missing: ["provider_processing", "ocr"],
  };
}
function current(): RequestObservation {
  return {
    ...request(),
    schema_version: "3.0.0",
    documents: { ...request().documents, extracted_text: [component()] },
  };
}
function python(cases: unknown[], batch = false) {
  const code = `import json,sys\nfrom footprint_contracts import validate_${batch ? "batch" : "observation"},payload_hash,ContractError\nresult=[]\nfor x in json.load(sys.stdin):\n try:\n  before=payload_hash(x);validate_${batch ? "batch" : "observation"}(x);result.append([True,before,payload_hash(x)])\n except ContractError: result.append([False])\nprint(json.dumps(result))`;
  const run = pythonReference(["-c", code], {
    input: JSON.stringify(cases),
  });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout) as [boolean, string?, string?][];
}

test("current observations preserve exact hashes and reject obsolete versions", () => {
  const value = current();
  const before = canonicalJson(value);
  assert.deepEqual(parseObservation(value), value);
  assert.deepEqual(extractedFileText(value), [component()]);
  assert.equal(canonicalJson(value), before);
  for (const schema_version of ["1.0.0", "1.1.0", "1.2.0"])
    assert.equal(
      ObservationSchema.safeParse({ ...value, schema_version }).success,
      false,
    );
  const missing = structuredClone(value) as any;
  delete missing.documents.extracted_text;
  assert.equal(ObservationSchema.safeParse(missing).success, false);
});

test("Current recursive whitelist, extraction bounds and unknown/partial evidence match Python", () => {
  const valid = current();
  const variants: unknown[] = [
    valid,
    { ...valid, documents: { ...valid.documents, extracted_text: null } },
    { ...valid, documents: { ...valid.documents, extracted_text: [] } },
    request(),
    attempt(),
    { ...attempt(), schema_version: "3.0.0" },
  ];
  const validCount = variants.length;
  for (const change of [
    { component_id: "00000000-0000-1000-8000-000000000003" },
    { page_count: 201 },
    { page_count: true },
    { origin: "filename.pdf" },
    { extraction_profile_id: "https://private.invalid" },
    { filename: "PRIVATE_MARKER" },
    { content_hash: "a".repeat(64) },
    { missing: ["ocr"] },
    { missing: ["provider_processing", "provider_processing"] },
  ]) {
    const c = structuredClone(valid);
    Object.assign(c.documents.extracted_text![0]!, change);
    variants.push(c);
  }
  for (const change of [
    { value: "9223372036854775808" },
    { value: "1e3" },
    { text: "PRIVATE_MARKER" },
    { scope: "observed_text" },
    { profile_id: null },
    { evidence: "official_tokenizer" },
    { reason: null },
    { completeness: "unknown" },
    { value: null },
    { value: null, evidence: "unknown", completeness: "partial" },
  ]) {
    const c = structuredClone(valid);
    Object.assign(c.documents.extracted_text![0]!.tokens, change);
    variants.push(c);
  }
  variants.push({
    ...valid,
    documents: {
      ...valid.documents,
      extracted_text: [component(), component()],
    },
  });
  variants.push({
    ...valid,
    documents: { ...valid.documents, upload_count: "0" },
  });
  for (const value of [
    "not-a-counter",
    "1.5",
    "1e3",
    "01",
    "-1",
    "",
    "9223372036854775808",
    true,
    {},
    [],
  ]) {
    const bad = {
      ...valid,
      documents: { ...valid.documents, upload_count: value },
    };
    assert.doesNotThrow(() => ObservationSchema.safeParse(bad));
    assert.equal(ObservationSchema.safeParse(bad).success, false);
    variants.push(bad);
  }
  const many = structuredClone(valid);
  many.documents.upload_count = null;
  many.documents.extracted_text = Array.from({ length: 101 }, (_, i) => ({
    ...component(),
    component_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  }));
  variants.push(many);
  const combined = structuredClone(many);
  combined.documents.extracted_text!.pop();
  combined.media.requested_operations = [
    {
      operation_key: "a".repeat(64),
      kind: "text_to_image",
      requested_count: null,
      settings: {
        width: null,
        height: null,
        steps: null,
        precision: "unknown",
        architecture: "unknown",
      },
    },
  ];
  variants.push(combined);
  variants.push(
    { ...valid, schema_version: "1.3.0" },
    { ...valid, schema_version: {} },
    { ...valid, schema_version: [] },
  );
  const answers = python(variants);
  for (const [index, value] of variants.entries()) {
    const parsed = ObservationSchema.safeParse(value);
    assert.equal(parsed.success, index < validCount, `case ${index}`);
    assert.equal(answers[index]![0], parsed.success, `Python case ${index}`);
    if (parsed.success)
      assert.deepEqual(answers[index], [
        true,
        payloadHash(value),
        payloadHash(value),
      ]);
  }
  const unknown = current();
  unknown.documents.extracted_text![0]!.tokens = {
    value: null,
    evidence: "unknown",
    scope: "extracted_file_text",
    completeness: "unknown",
    profile_id: null,
    reason: "tokenizer_unavailable",
  };
  assert.equal(ObservationSchema.safeParse(unknown).success, true);
  assert.equal(python([unknown])[0]![0], true);
  const ordinary = {
    ...attempt(),
    schema_version: "3.0.0",
    tokens: { ...attempt().tokens, answer_output: component().tokens },
  };
  assert.equal(ObservationSchema.safeParse(ordinary).success, false);
  assert.equal(python([ordinary])[0]![0], false);
});

test("current batch rejects old envelopes and mixed obsolete observations", () => {
  const base = {
    schema_version: "3.0.0",
    batch_id: attempt().request_id,
    sent_at: attempt().started_at,
    client_version: "0.1.0",
    deletion_epoch: 0,
    records: [request(), current(), attempt()],
  };
  const variants = [
    base,
    ...["1.0.0", "1.1.0", "1.2.0"].flatMap((schema_version) => [
      { ...base, schema_version },
      { ...base, records: [request(), { ...attempt(), schema_version }] },
    ]),
  ];
  const expected = [true, ...Array(6).fill(false)];
  assert.deepEqual(
    variants.map((x) => UsageBatchSchema.safeParse(x).success),
    expected,
  );
  assert.deepEqual(
    python(variants, true).map((x) => x[0]),
    expected,
  );
});

test("approved inline profile has strict TS/Python parity without changing historical observations", () => {
  const historical = [request(), current()];
  const hashes = historical.map(payloadHash);
  const inline = current();
  inline.site = "claude";
  inline.documents.upload_count = null;
  inline.documents.processing = "unknown";
  Object.assign(inline.documents.extracted_text![0]!, {
    origin: "unknown_origin",
    page_count: null,
    extraction_profile_id: "observed-inline-file-text-v1",
  });
  const bad = structuredClone(inline);
  (bad.documents.extracted_text![0] as any).extraction_profile_id =
    "observed-inline-file-text-v2";
  const values = [...historical, inline, bad];
  assert.deepEqual(
    values.map((value) => ObservationSchema.safeParse(value).success),
    [true, true, true, false],
  );
  const checked = python(values);
  assert.deepEqual(
    checked.map((value) => value[0]),
    [true, true, true, false],
  );
  assert.deepEqual(historical.map(payloadHash), hashes);
  for (let i = 0; i < 3; i++)
    assert.deepEqual(checked[i], [
      true,
      payloadHash(values[i]!),
      payloadHash(values[i]!),
    ]);
});
