import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  Ledger,
  historyAuthority,
  type ApplicationRepository,
} from "@footprint/ledger";
import {
  canonicalJson,
  emptyGeneration,
  historyResponseParts,
  payloadHash,
  parseUsageBatch,
  HistoryMessageSchema,
  HistoryPageSchema,
  historyNumericPayloadHash,
  OrganizationSelectionRequestSchema,
  type OrganizationSelectionRequest,
  type OrganizationSelectionResponse,
  type HistorySummary,
} from "@footprint/contracts";
import {
  createMethodRegistry,
  LocalEstimateExecutor,
  historicalResources,
} from "@footprint/estimator";
import { archivedConfiguration as build } from "./archived-engine-fixture";
import mappings from "../../../config/estimation.mappings.json";
import media from "../../../config/estimation.media.json";
import { records } from "../../../packages/ledger/test/factory";
import { Coordinator } from "../lib/coordinator";
import { CompanyClient } from "../lib/company";
import { codeSent, connectCompany, verifiedConnection } from "./connect-fixture";

type ServerKind = "missing-endpoints" | "unsupported-engine" | "supported";
const origin = "https://synthetic-legacy-server.example";
const registry = createMethodRegistry(build, mappings, media);
const executor = new LocalEstimateExecutor(registry);
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
const missing = () => response({ detail: "Not Found" }, 404);

async function setup(t: test.TestContext, kind: ServerKind) {
  const name = `legacy-server-${crypto.randomUUID()}`;
  let db = await Ledger.open(name);
  let repository: ApplicationRepository = db.application;
  const signer = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicKey = Buffer.from(
    await crypto.subtle.exportKey("raw", signer.publicKey),
  ).toString("base64url");
  const policy = {
    policy_version: "1.0.0",
    disclosure_version: "1.0.0",
    pause_mode: "user_controlled",
    timezone: "UTC",
    usage_retention_months: null,
    ip_retention_days: 0,
    deletion_epoch: 0,
  };
  const enrollment = {
    company_id: crypto.randomUUID(),
    user_id: crypto.randomUUID(),
    device_id: crypto.randomUUID(),
    access_token: "synthetic-access",
    refresh_token: "synthetic-refresh",
    user_hmac_key: "c".repeat(64),
    access_expires_at: "2099-01-01T00:00:00.000Z",
    refresh_expires_at: "2099-01-01T00:00:00.000Z",
    installation_reconnect_secret: "synthetic-reconnect",
    deletion_receipt_credential: "synthetic-receipt",
    key_version: "1",
    policy,
    enrollment_era: {
      id: crypto.randomUUID(),
      start: new Date().toISOString(),
      end: null,
    },
  };
  const config =
    kind === "supported"
      ? {
          ...policy,
          supported_schema_versions: ["1.1.0", "1.2.0"],
          supported_result_schema_versions: ["1.0.0", "3.0.0"],
          supported_history_schema_versions: ["1.0.0"],
          engine_selection_schema_version: "1.0.0",
          supported_methods: [registry.original, registry.ecologits].map(
            (method) => ({
              method_id: method.method_id,
              method_hash: method.method_hash,
            }),
          ),
        }
      : { ...policy, supported_schema_versions: ["1.1.0"] };
  const calls: Array<{ path: string; body: unknown; method: string }> = [];
  let selection: OrganizationSelectionRequest | null = null;
  let serverHistory: HistorySummary | null = null;
  const selectionResponse = (): OrganizationSelectionResponse =>
    selection
      ? {
          selection: {
            ...selection,
            selection_generation: 1,
            job_id: "a".repeat(64),
            updated_at: new Date().toISOString(),
          },
          compatibility:
            kind === "supported"
              ? { status: "supported", reason: null }
              : { status: "pending", reason: "method_unsupported" },
          recalculation: {
            job_id: "a".repeat(64),
            method_id: selection.method_id,
            calculation_view: "recalculated",
            status: kind === "supported" ? "completed" : "pending",
            processed_estimates: 0,
            created_at: new Date().toISOString(),
            completed_at:
              kind === "supported" ? new Date().toISOString() : null,
            error_code: null,
            requires_advance: false,
            selection_revision: selection.selection_revision,
            selection_generation: 1,
          },
        }
      : { selection: null, compatibility: null, recalculation: null };
  const transport: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    assert.equal(url.origin, origin);
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "error");
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({
      path: url.pathname + url.search,
      body,
      method: init.method ?? "GET",
    });
    if (url.pathname === "/v1/connections/otp/request")
      return response(codeSent());
    if (url.pathname === "/v1/connections")
      return response(
        verifiedConnection(origin, publicKey, {
          policyVersion: enrollment.policy.policy_version,
        }),
      );
    if (url.pathname === "/v1/connections/exchange")
      return response(enrollment);
    assert.equal(
      new Headers(init.headers).get("Authorization"),
      url.pathname.startsWith("/v1/deletions/")
        ? null
        : `Bearer ${enrollment.access_token}`,
    );
    if (url.pathname === "/v1/config") return response(config);
    if (url.pathname === "/v1/health/reports") return response({ ok: true });
    if (url.pathname === "/v1/deletions/status") {
      const instruction = {
        company_id: enrollment.company_id,
        device_id: enrollment.device_id,
        deletion_epoch: 0,
        current_deletion_epoch: 0,
        has_more: false,
        changes: [],
        issued_at: new Date().toISOString(),
        retention_cutoff: null,
      };
      const signature = Buffer.from(
        await crypto.subtle.sign(
          "Ed25519",
          signer.privateKey,
          new TextEncoder().encode(canonicalJson(instruction)),
        ),
      ).toString("base64url");
      return response({
        instruction,
        signature,
        algorithm: "Ed25519",
        key_version: "1",
      });
    }
    if (url.pathname === "/v1/deletions/ack")
      return response({ acknowledged_epoch: 0 });
    if (url.pathname === "/v1/me/estimation-selection") {
      if (kind === "missing-endpoints") return missing();
      if (init.method === "PUT")
        selection = OrganizationSelectionRequestSchema.parse(body);
      return response(selectionResponse());
    }
    if (url.pathname === "/v1/usage/batches") {
      const batch = parseUsageBatch(body);
      assert.ok(
        batch.records.some(
          (row) =>
            row.kind === "attempt" &&
            row.proposed_method_id === registry.ecologits.method_id,
        ),
      );
      if (kind !== "supported")
        return response({ error: { code: "method_unsupported" } }, 422);
      return response({
        batch_id: batch.batch_id,
        results: batch.records.map((row) => ({
          kind: row.kind,
          record_id: row.kind === "request" ? row.request_id : row.attempt_id,
          revision: row.revision,
          server_record_version: row.revision,
          payload_hash: payloadHash(row),
          status: "applied",
        })),
      });
    }
    if (url.pathname === "/v1/me/history") {
      const page = HistoryPageSchema.parse(body);
      assert.ok(
        page.messages.every(
          (row) => row.proposed_method_id === registry.ecologits.method_id,
        ),
      );
      if (kind !== "supported") return missing();
      return response({
        schema_version: "3.0.0",
        deletion_epoch: 0,
        results: page.messages.map((row) => ({
          message_key: row.message_key,
          payload_hash: historyNumericPayloadHash(row),
          status: "applied",
        })),
      });
    }
    if (
      url.pathname.startsWith("/v1/me/history/") &&
      url.pathname.endsWith("/summary")
    ) {
      assert.equal(url.searchParams.get("calculation_view"), "recalculated");
      assert.equal(
        url.searchParams.get("method_id"),
        registry.ecologits.method_id,
      );
      if (kind !== "supported") return missing();
      assert.ok(serverHistory);
      return response({ deletion_epoch: 0, history: serverHistory });
    }
    assert.fail(`Unexpected synthetic route: ${url.pathname}`);
  };
  const c = new Coordinator(repository, {
    transport,
    hasConsent: async () => true,
    count: async () =>
      assert.fail(
        "Server compatibility must not retokenize saved numerical observations",
      ),
    sendDisplay: async () => {},
    estimation: { methods: registry, executor },
  });
  await c.whenReady();
  assert.ok(c.company instanceof CompanyClient);
  assert.equal(await connectCompany(c.company, origin), "connected");
  const scope = await c.currentScope();
  const beforeSelection = await c.engines.status();
  await c.engines.select({
    preference: "ecologits",
    expectedRevision: beforeSelection.selectionRevision,
  });
  await c.engines.maintainOrganization();
  const pair = records();
  pair[0].dispatched_at = pair[1].started_at = new Date().toISOString();
  pair[0].ended_at = pair[1].ended_at = pair[0].dispatched_at;
  pair[0].state = pair[1].state = "completed";
  pair[1].proposed_method_id = (await c.engines.admission()).method_id;
  const original = (
    await c.engines.original({
      family: "live",
      request: pair[0],
      attempt: pair[1],
    })
  ).result;
  assert.ok(original);
  assert.equal(
    original.requested_method.method_hash,
    registry.ecologits.method_hash,
  );
  await repository.commitCapture({
    scope,
    observations: pair,
    originals: [original],
    currentEstimate: { attemptId: pair[1].attempt_id, estimate: original },
  });
  const message = HistoryMessageSchema.parse({
    timing: null,
    schema_version: "3.0.0",
    kind: "history_message",
    message_key: "d".repeat(64),
    role: "response",
    conversation_key: "e".repeat(64),
    key_version: "1",
    site: "claude",
    parent_key: null,
    prompt_key: null,
    provider_request_key: null,
    provider_attempt_key: null,
    occurred_at: "2026-08-01T12:00:00.000Z",
    date_basis: "message_created",
    observed_at: new Date().toISOString(),
    model_id: null,
    proposed_method_id: registry.ecologits.method_id,
    proposed_method_hash: registry.ecologits.method_hash,
    tokens: pair[1].tokens.answer_output,
    inline_file_text: null,
    parts: historyResponseParts(pair[1].tokens.answer_output),
    generation: emptyGeneration(),
    company_dedup_key: null,
    text_complete: true,
    coverage_reasons: ["history_only"],
  });
  const historical = (
    await c.engines.original({ family: "history", record: message })
  ).result;
  assert.ok(historical);
  assert.equal(
    historical.requested_method.method_hash,
    registry.ecologits.method_hash,
  );
  const page = HistoryPageSchema.parse({
    schema_version: "3.0.0",
    site: "claude",
    conversation_key: message.conversation_key,
    observed_at: message.observed_at,
    deletion_epoch: 0,
    branch_scope: "loaded_messages",
    selected_leaf_key: null,
    branch_message_keys: null,
    root_message_key: null,
    first_request_verified: false,
    has_earlier: null,
    has_later: null,
    messages: [message],
  });
  const publication = await repository.publicationSnapshot(scope.namespace);
  await repository.commitHistory(
    scope,
    page,
    {
      authority: historyAuthority(publication),
      erasureVersion: publication.erasureVersion,
      estimates: {
        [message.message_key]: historicalResources(historical, message),
      },
      envelopes: { [message.message_key]: historical },
    },
    () => true,
  );
  const completeLocal = async () => {
    for (let pass = 0; pass < 4; pass++) {
      await c.engines.maintainLocal();
      if (!(await c.engines.view(scope)).pending) return;
    }
    assert.fail(
      "The two saved numerical inputs did not finish within bounded local maintenance",
    );
  };
  await completeLocal();
  serverHistory = await c.history.local(scope, message.conversation_key);
  const snapshot = async () =>
    canonicalJson({
      request: (
        await repository.getRecord(
          scope.namespace,
          "request",
          pair[0].request_id,
        )
      )?.record,
      attempt: (
        await repository.getRecord(
          scope.namespace,
          "attempt",
          pair[1].attempt_id,
        )
      )?.record,
      history: (await repository.findHistoryMessage(scope, message.message_key))
        ?.record,
      originals: (
        await repository.estimation.viewPage({ scope, view: "original" })
      ).rows.map((row) => row.result),
    });
  t.after(() => {
    c.engines.dispose();
    c.history.invalidate();
    db.close();
  });
  return {
    c,
    scope,
    calls,
    config,
    completeLocal,
    message,
    pair,
    snapshot,
    get repository() {
      return repository;
    },
    reopen: async () => {
      c.engines.dispose();
      c.history.invalidate();
      db.close();
      db = await Ledger.open(name);
      repository = db.application;
    },
  };
}

for (const kind of [
  "missing-endpoints",
  "unsupported-engine",
  "supported",
] as const) {
  test(`ST10 actual organization client preserves requested Eco data with ${kind} server`, async (t) => {
    const f = await setup(t, kind);
    const before = await f.snapshot();
    assert.equal((await f.repository.pending(f.scope.namespace)).length, 2);
    assert.equal((await f.repository.pendingHistory(f.scope)).length, 1);
    assert.equal(
      (await f.repository.pendingHistoryCoverage(f.scope)).length,
      1,
    );
    await f.c.company.sync();
    if (kind === "supported") await f.c.history.sync();
    else await assert.rejects(f.c.history.sync(), /payload_rejected/);
    await f.c.engines.maintainOrganization();
    await f.completeLocal();
    const status = await f.c.engines.status();
    assert.equal(status.preference, "ecologits");
    assert.equal(status.effectiveEngine, "ecologits");
    assert.equal(status.method?.method_hash, registry.ecologits.method_hash);
    assert.equal(status.local.status, "complete");
    assert.deepEqual(
      status.organization,
      kind === "supported"
        ? { status: "current", reason: null }
        : kind === "unsupported-engine"
          ? { status: "unavailable", reason: "method_unsupported" }
          : { status: "pending", reason: "sync_delayed" },
    );
    const view = await f.c.history.view(f.scope, f.message.conversation_key);
    assert.equal(view.local.observed_response_count, "1");
    assert.ok(view.local.resources.length > 0);
    assert.ok(
      view.local.resources.every(
        (row) => row.method_id === registry.ecologits.method_id,
      ),
    );
    assert.equal(
      view.server_status,
      kind === "supported" ? "current" : "unavailable",
    );
    if (kind !== "supported") {
      assert.equal(view.server, null);
      assert.equal(view.pending?.observed_response_count, "1");
      assert.ok(
        (await f.c.trackingHealth()).health.some(
          (row) => row.code === "sync_delayed",
        ),
      );
    }
    for (const advert of [
      "supported_result_schema_versions",
      "supported_history_schema_versions",
      "engine_selection_schema_version",
      "supported_methods",
    ])
      assert.equal(Object.hasOwn(f.config, advert), kind === "supported");
    assert.ok(f.calls.some((call) => call.path === "/v1/config"));
    assert.ok(
      f.calls.some((call) => call.path === "/v1/me/estimation-selection"),
    );
    assert.ok(f.calls.some((call) => call.path === "/v1/me/history"));
    assert.ok(
      !f.calls.some((call) => call.path.includes("calculation_view=original")),
    );
    const writes = f.calls.filter(
      (call) =>
        call.path === "/v1/me/estimation-selection" && call.method === "PUT",
    );
    if (kind === "missing-endpoints") assert.equal(writes.length, 0);
    else
      assert.ok(
        writes.every(
          (call) =>
            OrganizationSelectionRequestSchema.parse(call.body).method_id ===
            registry.ecologits.method_id,
        ),
      );
    assert.equal(await f.snapshot(), before);
    await f.reopen();
    assert.equal(await f.snapshot(), before);
    assert.equal(
      (await f.repository.estimation.readPreference())?.preference,
      "ecologits",
    );
    const retainedQueue = await f.repository.pending(f.scope.namespace);
    assert.equal(retainedQueue.length, kind === "supported" ? 0 : 2);
    for (const row of retainedQueue) {
      assert.equal(row.quarantined, null);
      assert.ok(row.attempts > 0);
      assert.equal(payloadHash(await f.repository.queuedRecord(row)), row.hash);
    }
    assert.equal(
      (await f.repository.pendingHistory(f.scope)).length,
      kind === "supported" ? 0 : 1,
    );
    assert.equal(
      (await f.repository.pendingHistoryCoverage(f.scope)).length,
      kind === "supported" ? 0 : 1,
    );
  });
}
