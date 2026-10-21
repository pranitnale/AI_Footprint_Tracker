import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { pythonReference } from "../../../tools/python-reference.cjs";
import { Ledger, type RecordRow } from "@footprint/ledger";
import {
  ObservationSchema,
  payloadHash,
  type ExtractedFileTextComponent,
  type RequestObservation,
} from "@footprint/contracts";
import { estimateAttempt, BASELINE_METHOD_ID } from "@footprint/estimator";
import { records, scope } from "../../../packages/ledger/test/factory";
import { scanSummary } from "../lib/summary-scan";
import { summarize } from "../lib/summary";
import {
  FileTextAccumulator,
  type FileTextSummary,
} from "../lib/file-text-summary";

function component(
  value: string | null = "7",
  origin: ExtractedFileTextComponent["origin"] = "new_upload",
  partial = false,
): ExtractedFileTextComponent {
  return {
    component_id: crypto.randomUUID(),
    origin,
    extraction_profile_id: "local-file-text-utf8-pdfjs6.3.289-opc-v1",
    page_count: 2,
    tokens: {
      value,
      evidence: value === null ? "unknown" : "heuristic_estimate",
      scope: "extracted_file_text",
      completeness:
        value === null ? "unknown" : partial ? "partial" : "complete_for_scope",
      profile_id: value === null ? null : "o200k-base-4.0.0-reference",
      reason:
        value === null
          ? "tokenizer_unavailable"
          : "tokenizer_mapping_unverified",
    },
    missing: ["provider_processing", "ocr"],
  };
}
function current(
  components: ExtractedFileTextComponent[] | null = [component()],
): RequestObservation {
  const [r] = records();
  return {
    ...r,
    // These tests cover the projection itself; Claude's token factor is checked below.
    site: "chatgpt",
    schema_version: "3.0.0",
    documents: {
      ...r.documents,
      upload_count: String(
        components?.filter((component) => component.origin === "new_upload")
          .length ?? 0,
      ),
      extracted_text: components,
    },
  };
}
const row = (record: RecordRow["record"]): RecordRow => ({
  key: record.kind,
  namespace: scope.namespace,
  era: scope.era,
  hash: payloadHash(record),
  record,
});
const files = (summary: FileTextSummary) => ({
  file_text: summary.file_text,
  file_text_coverage: summary.file_text_coverage,
});

test("local projections match server group semantics and preserve huge tokens, unknowns and empty coverage", async () => {
  const db = await Ledger.open("file-projection-" + crypto.randomUUID());
  try {
    const [legacy, attempt] = records();
    legacy.documents.extracted_text = null;
    const beforeHash = payloadHash(legacy);
    attempt.proposed_method_id = BASELINE_METHOD_ID;
    await db.commit(scope, [legacy, attempt]);
    const estimate = estimateAttempt(attempt);
    await db.put("local_estimates", {
      key: `current:${scope.namespace}:${attempt.attempt_id}`,
      namespace: scope.namespace,
      estimate,
    });
    const baseline = await scanSummary(db, scope.namespace);
    const r = current([
      component("9223372036854775807"),
      component("9223372036854775807", "new_upload", true),
      component(null, "retained_context"),
      component("0", "unknown_origin"),
    ]);
    const unknown = current(null),
      empty = current([]);
    await db.commit(scope, [r, unknown, empty]);
    const actual = await scanSummary(db, scope.namespace);
    assert.deepEqual(actual.tokens, baseline.tokens);
    assert.deepEqual(actual.metrics, baseline.metrics);
    assert.deepEqual(actual.file_text_coverage, {
      observed_request_count: "2",
      unknown_request_count: "2",
      scope: "extracted_file_text",
      additive: false,
    });
    const known = actual.file_text.find(
      (g) => g.measurement_group.origin === "new_upload",
    )!;
    assert.equal(known.value, "18446744073709551614");
    assert.equal(known.contributing_component_count, 2);
    assert.equal(known.partial_count, 1);
    assert.deepEqual(known.missing_counts, { provider_processing: 2, ocr: 2 });
    assert.equal(
      actual.file_text.find(
        (g) => g.measurement_group.origin === "retained_context",
      )!.value,
      null,
    );
    assert.equal(
      actual.file_text.find(
        (g) => g.measurement_group.origin === "unknown_origin",
      )!.value,
      "0",
    );
    assert.deepEqual(
      files(
        summarize([legacy, attempt, r, unknown, empty].map(row), [estimate]),
      ),
      files(actual),
    );
    assert.equal(
      payloadHash(
        (await db.getRecord(scope.namespace, "request", legacy.request_id))!
          .record,
      ),
      beforeHash,
    );

    const one = current([component("17", "retained_context", true)]);
    const accumulator = new FileTextAccumulator();
    accumulator.request(one);
    const python = pythonReference(
      [
        "-c",
        "import json,sys;from aift.file_text import projections,coverage;p=json.load(sys.stdin);print(json.dumps({'file_text':[v for k,v in projections(p)],'file_text_coverage':coverage(p)},default=str))",
      ],
      { input: JSON.stringify(one) },
    );
    assert.equal(python.status, 0, python.stderr);
    assert.deepEqual(accumulator.result(), JSON.parse(python.stdout));
    // File text sent to Claude carries the Claude token factor, alike on both sides.
    const claude = { ...one, site: "claude" as const };
    const claudeFiles = new FileTextAccumulator();
    claudeFiles.request(claude);
    assert.equal(claudeFiles.result().file_text[0]!.value, "27");
    const server = pythonReference(
      [
        "-c",
        "import json,sys;from footprint_contracts import claude_factor_for;from aift.engine_adapter import packaged_claude_token_factor;from aift.file_text import projections,coverage;p=json.load(sys.stdin);f=claude_factor_for(p['site'],p['model_id'],packaged_claude_token_factor());print(json.dumps({'file_text':[v for k,v in projections(p,f)],'file_text_coverage':coverage(p)},default=str))",
      ],
      { input: JSON.stringify(claude) },
    );
    assert.equal(server.status, 0, server.stderr);
    assert.deepEqual(claudeFiles.result(), JSON.parse(server.stdout));
  } finally {
    db.close();
  }
});

test("canonical request correction replaces file quantities once; alias reconciliation excludes duplicates after restart", async () => {
  const name = "file-revisions-" + crypto.randomUUID();
  let db = await Ledger.open(name);
  try {
    const canonical = current([component("100")]);
    await db.commit(scope, [canonical]);
    const revised = {
      ...canonical,
      revision: 2,
      documents: {
        ...canonical.documents,
        extracted_text: [component("7", "retained_context", true)],
      },
    };
    await db.commit(scope, [revised]);
    await db.commit(scope, [revised]);
    assert.equal(
      (await scanSummary(db, scope.namespace)).file_text[0].value,
      "7",
    );
    const alias = { ...revised, request_id: crypto.randomUUID() };
    await db.commit(scope, [alias]);
    await db.reconcile(
      scope.namespace,
      revised,
      payloadHash(revised),
      alias.request_id,
      alias.revision,
    );
    db.close();
    db = await Ledger.open(name);
    const actual = await scanSummary(db, scope.namespace);
    assert.equal(actual.requests, 1);
    assert.equal(actual.file_text[0].value, "7");
    assert.equal(actual.file_text_coverage.observed_request_count, "1");
    assert.equal(
      actual.file_text[0].measurement_group.origin,
      "retained_context",
    );
  } finally {
    db.close();
  }
});

test("file projection follows request-time filters across bounded pages and retries a concurrent correction", async () => {
  const db = await Ledger.open("file-pages-" + crypto.randomUUID());
  try {
    const inputs = Array.from({ length: 205 }, () => current([component("1")]));
    for (let start = 0; start < inputs.length; start += 100)
      await db.commit(scope, inputs.slice(start, start + 100));
    const original = db.scanRecords.bind(db);
    let largest = 0,
      corrected = false;
    db.scanRecords = async (namespace, kind, consume) =>
      original(namespace, kind, async (rows) => {
        largest = Math.max(largest, rows.length);
        await consume(rows);
        if (kind === "request" && !corrected) {
          corrected = true;
          const r = inputs[0];
          await db.commit(scope, [
            {
              ...r,
              revision: 2,
              documents: { ...r.documents, extracted_text: [component("9")] },
            },
          ]);
        }
      });
    const actual = await scanSummary(db, scope.namespace);
    assert.equal(largest, 200);
    assert.equal(actual.file_text[0].value, "213");
    assert.equal(actual.file_text_coverage.observed_request_count, "205");
    const outside = await scanSummary(db, scope.namespace, {
      start: "2026-09-11T00:00:00.000Z",
    });
    assert.deepEqual(outside.file_text, []);
    assert.equal(outside.file_text_coverage.observed_request_count, "0");
  } finally {
    db.close();
  }
});

test("file caches rebuild after upgrade and cannot survive erasure/retention or repopulate erased families", async () => {
  const name = "file-retention-" + crypto.randomUUID();
  let db = await Ledger.open(name);
  try {
    const old = current([component("5")]);
    old.dispatched_at = "2026-08-01T00:00:00.000Z";
    const kept = current([component("7")]);
    await db.commit(scope, [old, kept]);
    await db.put("dashboard_cache", {
      key: "summary:legacy",
      namespace: scope.namespace,
      summary: { requests: 2 },
    });
    assert.equal(await db.get("dashboard_cache", "summary:legacy"), undefined);
    const before = await scanSummary(db, scope.namespace);
    const epoch = await db.get<{ version: number }>(
      "dashboard_cache",
      `epoch:${scope.namespace}`,
    );
    await db.cacheSummary(
      scope.namespace,
      "summary:current",
      before,
      epoch!.version,
    );
    assert.ok(await db.get("dashboard_cache", "summary:current"));
    await db.applyRange(scope, null, "2026-09-01T00:00:00.000Z", 1);
    assert.equal(await db.get("dashboard_cache", "summary:current"), undefined);
    await assert.rejects(
      db.cacheSummary(scope.namespace, "summary:stale", before, epoch!.version),
      /aggregate_inconsistent/,
    );
    await assert.rejects(db.commit(scope, [old]), /record_erased/);
    db.close();
    db = await Ledger.open(name);
    assert.equal(
      (await scanSummary(db, scope.namespace)).file_text[0].value,
      "7",
    );
    await db.put("deletion_markers", {
      key: `range:${scope.namespace}:pending`,
      namespace: scope.namespace,
      status: "purging",
    });
    await assert.rejects(
      scanSummary(db, scope.namespace),
      /deletion_in_progress/,
    );
    await db.put("deletion_markers", {
      key: `range:${scope.namespace}:pending`,
      namespace: scope.namespace,
      status: "complete",
    });
    await db.eraseNamespace(scope.namespace);
    const after = await scanSummary(db, scope.namespace);
    assert.deepEqual(after.file_text, []);
    assert.equal(after.file_text_coverage.observed_request_count, "0");
  } finally {
    db.close();
  }
});

test("pending-only conversation file coverage follows unacknowledged request revisions", async () => {
  const db = await Ledger.open("file-pending-" + crypto.randomUUID());
  try {
    const r = current();
    await db.commit(scope, [r]);
    assert.equal(
      (await scanSummary(db, scope.namespace, {}, r.conversation_key, true))
        .file_text[0].value,
      "7",
    );
    const sent = await db.pending(scope.namespace);
    await db.acknowledge(
      scope.namespace,
      crypto.randomUUID(),
      [
        {
          kind: "request",
          id: r.request_id,
          revision: 1,
          payload_hash: payloadHash(r),
          server_record_version: 1,
          status: "applied",
        },
      ],
      sent,
    );
    const pending = await scanSummary(
      db,
      scope.namespace,
      {},
      r.conversation_key,
      true,
    );
    assert.deepEqual(pending.file_text, []);
    assert.equal(pending.file_text_coverage.observed_request_count, "0");
  } finally {
    db.close();
  }
});

test("W9 review: read aloud and notebook guides stay out of request file coverage", async () => {
  const db = await Ledger.open("file-side-captures-" + crypto.randomUUID());
  try {
    const sent = current([]);
    const side = (site: "chatgpt" | "notebooklm"): RequestObservation => ({
      ...current(null),
      request_id: crypto.randomUUID(),
      site,
      action: site === "chatgpt" ? "read_aloud" : "notebook_guide",
      features: [site === "chatgpt" ? "audio" : "text"],
      documents: {
        upload_count: null,
        types: [],
        processing: "none",
        extracted_text: null,
      },
    });
    const speech = side("chatgpt"),
      guide = side("notebooklm");
    for (const record of [speech, guide])
      assert.ok(ObservationSchema.safeParse(record).success, record.action);
    await db.commit(scope, [sent, speech, guide]);
    const actual = await scanSummary(db, scope.namespace);
    assert.equal(actual.requests, 1);
    // Their file text is never read, yet it is no request's unknown file text.
    assert.deepEqual(actual.file_text_coverage, {
      observed_request_count: "1",
      unknown_request_count: "0",
      scope: "extracted_file_text",
      additive: false,
    });
    assert.deepEqual(
      files(summarize([sent, speech, guide].map(row), [])),
      files(actual),
    );
  } finally {
    db.close();
  }
});
