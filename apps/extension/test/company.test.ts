import "fake-indexeddb/auto";
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { countByTextLength, unavailableCount } from "./counting-fixture";
import { archivedEstimation, settleStartup } from "./archived-engine-fixture";
import { Ledger, digest, historyAuthority } from "@footprint/ledger";
import {
  CompanyClient,
  companyOrigin,
  connectFailureCode,
  connectFailureMessage,
  connectFailureReply,
  isNetworkFailure,
  serverErrorCode,
  sha256,
  type Credentials,
} from "../lib/company";
import {
  canonicalJson,
  emptyGeneration,
  historyResponseParts,
  parseUsageBatch,
  HistoryPageSchema,
} from "@footprint/contracts";
import {
  BASELINE_METHOD_ID,
  BASELINE_METHOD_HASH,
  emptyHistorySummary,
  estimateHistoricalText,
} from "@footprint/estimator";
import { records } from "../../../packages/ledger/test/factory";
import { Coordinator } from "../lib/coordinator";
import { ORGANIZATION_CONSENT_VERSION } from "../lib/tracking-consent";
import { hmacIdentity } from "../lib/ownership";
import {
  ChatgptSession,
  initialSnapshot,
  NotebooklmChatSession,
  parseDispatch,
} from "@footprint/adapters";
import { createHistoryTextObserver } from "../lib/passive-history-text";
import {
  codeSent,
  connectCompany,
  serverError,
  TEST_CODE,
  TEST_COMPANY_NAME,
  TEST_WORK_EMAIL,
  verifiedConnection,
} from "./connect-fixture";
const b64 = (bytes: ArrayBuffer) => Buffer.from(bytes).toString("base64url");
async function setup() {
  const dbName = "company-" + crypto.randomUUID();
  const db = await Ledger.open(dbName);
  const origin = "https://company.example";
  const companyId = crypto.randomUUID(),
    userId = crypto.randomUUID(),
    deviceId = crypto.randomUUID();
  await db.policyTransaction([
    { key: "personal", namespace: "personal:test", secret: "a".repeat(64) },
    {
      key: "ownership-history",
      eras: [
        {
          scope: { namespace: "personal:test", mode: "personal", era: null },
          secret: "a".repeat(64),
          policyVersion: "1.0.0",
          start: 0,
          end: null,
        },
      ],
    },
  ]);
  const signer = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicKey = b64(await crypto.subtle.exportKey("raw", signer.publicKey));
  const credentials: Credentials = {
    origin,
    namespace: `company:${companyId}:${userId}`,
    access_token: "access-proof",
    refresh_token: "refresh-proof",
    access_expires_at: new Date(Date.now() + 600000).toISOString(),
    refresh_expires_at: new Date(Date.now() + 86400000).toISOString(),
    company_id: companyId,
    user_id: userId,
    device_id: deviceId,
    installation_reconnect_secret: "r".repeat(43),
    deletion_receipt_credential: "d".repeat(43),
    key_version: "1",
    user_hmac_key: "c".repeat(64),
    policy: {
      policy_version: "1.0.0",
      disclosure_version: "1.0.0",
      pause_mode: "user_controlled",
      usage_retention_months: null,
      timezone: "UTC",
      ip_retention_days: 30,
      deletion_epoch: 0,
    },
    enrollment_era: {
      id: crypto.randomUUID(),
      start: new Date().toISOString(),
      end: null,
    },
    deletion_public_key: publicKey,
  };
  const calls: Array<{ url: string; body: any; authorization: string | null }> =
    [];
  // One-shot answers a test sets for a path, such as a server error in a connection step.
  const answers = new Map<string, Response | object>();
  let mode:
    | "normal"
    | "partial"
    | "bad-signature"
    | "large"
    | "retention_expired"
    | "erased" = "normal";
  // The server's operator switches in /v1/config; left out, as servers before 18 October 2026 do.
  let features: unknown = undefined;
  const transport = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input),
      path = new URL(url).pathname,
      body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({
      url,
      body,
      authorization: new Headers(init?.headers).get("Authorization"),
    });
    assert.equal(new URL(url).origin, origin);
    assert.equal(init?.redirect, "error");
    assert.equal(init?.credentials, "omit");
    let response: any;
    const answer = answers.get(path);
    if (answer) {
      answers.delete(path);
      if (answer instanceof Response) return answer;
      response = answer;
    } else if (path === "/v1/connections/otp/request") response = codeSent();
    else if (path === "/v1/connections")
      response = verifiedConnection(origin, publicKey, {
        policyVersion: credentials.policy.policy_version,
        connectionId: "connection",
      });
    else if (path === "/v1/connections/exchange") response = credentials;
    else if (path === "/v1/config")
      response = {
        policy: credentials.policy,
        ...(features === undefined ? {} : { features }),
      };
    else if (path === "/v1/deletions/status") {
      const instruction = {
        company_id: companyId,
        device_id: deviceId,
        deletion_epoch: 0,
        current_deletion_epoch: 0,
        has_more: false,
        changes: [],
        issued_at: new Date().toISOString(),
        retention_cutoff: null,
      };
      const signature = await crypto.subtle.sign(
        "Ed25519",
        signer.privateKey,
        new TextEncoder().encode(canonicalJson(instruction)),
      );
      response = {
        instruction,
        signature:
          mode === "bad-signature"
            ? b64(new Uint8Array(64).buffer)
            : b64(signature),
        algorithm: "Ed25519",
        key_version: "1",
      };
    } else if (path === "/v1/deletions/ack")
      response = { acknowledged_epoch: 0 };
    else if (path === "/v1/usage/batches")
      response = {
        batch_id: body.batch_id,
        results: await Promise.all(
          body.records
            .slice(0, mode === "partial" ? 1 : undefined)
            .map(async (r: any) => ({
              kind: r.kind,
              record_id: r.kind === "request" ? r.request_id : r.attempt_id,
              revision: r.revision,
              server_record_version: r.revision,
              payload_hash: await digest(r),
              status:
                mode === "retention_expired" || mode === "erased"
                  ? mode
                  : "applied",
            })),
        ),
      };
    else if (path === "/v1/auth/refresh")
      response = {
        ...credentials,
        access_token: "new-access",
        refresh_token: "new-refresh",
      };
    else response = { ok: true };
    if (mode === "large")
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(1048577));
          },
          cancel() {},
        }),
      );
    return new Response(JSON.stringify(response), {
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return {
    db,
    dbName,
    origin,
    credentials,
    calls,
    client: new CompanyClient(db, transport),
    transport,
    setMode: (next: typeof mode) => {
      mode = next;
    },
    setFeatures: (next: unknown) => {
      features = next;
    },
    answer: (path: string, value: Response | object) => {
      answers.set(path, value);
    },
  };
}
test("PE01 personal mode and local Company state have no backend calls", async () => {
  const s = await setup();
  await s.client.sync();
  await s.client.pending();
  assert.equal(s.calls.length, 0);
  s.db.close();
});
test("PE03 connect proves exact origin, private verifier and durable scoped credentials", async () => {
  const s = await setup();
  const sent = await s.client.requestCode(s.origin, " " + TEST_WORK_EMAIL + " ");
  assert.equal(sent.state, "code_sent");
  assert.equal(sent.email, TEST_WORK_EMAIL);
  assert.deepEqual(Object.keys(s.calls[0]!.body).sort(), ["dispatch_id", "email"]);
  assert.equal(s.calls[0]!.body.email, TEST_WORK_EMAIL);
  const p = await s.client.verifyCode("123 456", "chrome");
  const create = s.calls.find((c) => new URL(c.url).pathname === "/v1/connections")!;
  assert.equal(create.body.verifier_challenge, await sha256(p.verifier));
  assert.equal(create.body.challenge_id, sent.challenge_id);
  assert.equal(create.body.code, TEST_CODE);
  assert.equal(create.body.operation_id, sent.operation_id);
  assert.ok(!s.calls.some((c) => c.url.includes(p.verifier)));
  assert.equal(p.state, "verified");
  assert.equal(p.company_name, TEST_COMPANY_NAME);
  // The email is needed only to send another code, so it goes once the code is accepted.
  assert.equal(p.email, undefined);
  assert.equal(await s.client.credentials(), undefined, "nothing is shared before Connect");
  assert.equal(await s.client.confirm(), "connected");
  const exchange = s.calls.find((c) => c.url.endsWith("/v1/connections/exchange"))!;
  assert.equal(exchange.body.policy_version, "1.0.0");
  assert.equal(exchange.body.disclosure_acknowledged, true);
  assert.equal(exchange.body.exchange_id, sent.exchange_id);
  assert.equal(
    (await s.client.credentials())!.device_id,
    s.credentials.device_id,
  );
  assert.equal((await s.client.credentials())!.company_name, TEST_COMPANY_NAME);
  assert.equal(await s.client.pending(), undefined);
  assert.equal(
    (await s.db.get<any>("policy", "ownership-history")).eras.at(-1).scope.era,
    s.credentials.enrollment_era.id,
  );
  s.db.close();
});
test("Y03 signed deletion check precedes upload and missing ACK preserves only unconfirmed record", async () => {
  const s = await setup();
  await connectCompany(s.client, s.origin, "edge");
  await s.db.commit(
    {
      namespace: s.credentials.namespace,
      mode: "company",
      era: s.credentials.enrollment_era.id,
    },
    records(),
  );
  s.setMode("partial");
  await s.client.sync();
  const paths = s.calls.map((c) => new URL(c.url).pathname);
  assert.ok(
    paths.indexOf("/v1/deletions/status") < paths.indexOf("/v1/usage/batches"),
  );
  assert.equal((await s.db.pending(s.credentials.namespace)).length, 1);
  const payload = s.calls.find((c) => c.url.endsWith("/v1/usage/batches"))!;
  assert.equal(payload.authorization, "Bearer access-proof");
  assert.ok(!JSON.stringify(payload.body).includes("prompt"));
  s.db.close();
});
test("operator switches: turning person analytics on holds sharing until the person agrees to the new text (19 Oct 2026)", async () => {
  const s = await setup();
  try {
    await connectCompany(s.client, s.origin, "edge");
    const scope = {
      namespace: s.credentials.namespace,
      mode: "company" as const,
      era: s.credentials.enrollment_era.id,
    };
    let agreed = false;
    s.client.organizationAgreed = async (_origin, features) =>
      agreed || (!features.person_analytics && !features.ip_collection);
    const paths = (from: number) => s.calls.slice(from).map((c) => new URL(c.url).pathname);
    // A server that names no switches (released before 18 October 2026) shares as before.
    await s.db.commit(scope, records());
    let from = s.calls.length;
    await s.client.sync();
    assert.ok(paths(from).includes("/v1/usage/batches"));
    assert.equal(s.client.sharingHeld(), false);
    assert.equal((await s.client.credentials())!.features, undefined, "nothing new is stored for the default");
    // The operator turns per-person views on: the next policy check holds everything after it.
    s.setFeatures({ person_analytics: true, ip_collection: false });
    await s.db.commit(scope, records());
    from = s.calls.length;
    await s.client.sync();
    assert.ok(paths(from).includes("/v1/config"), "the switches are read with the policy");
    for (const path of ["/v1/health/reports", "/v1/usage/batches"])
      assert.equal(paths(from).includes(path), false, path);
    assert.equal(s.client.sharingHeld(), true);
    assert.deepEqual((await s.client.credentials())!.features, {
      person_analytics: true,
      ip_collection: false,
    });
    assert.ok((await s.db.pending(s.credentials.namespace)).length > 0, "the records wait in this browser");
    // Saved history and thread links wait too, without reaching the server.
    from = s.calls.length;
    await assert.rejects(s.client.threadRequest(scope, "/v1/me/history", { entries: [] }), /sync_delayed/);
    assert.deepEqual(paths(from), []);
    let maintained = 0;
    s.client.historyMaintenance = async () => {
      maintained++;
    };
    await s.client.maintenance();
    assert.equal(maintained, 0, "no history upload while held");
    agreed = true;
    from = s.calls.length;
    await s.client.maintenance();
    assert.ok(paths(from).includes("/v1/usage/batches"), "the same sync shares once agreed");
    assert.equal(s.client.sharingHeld(), false);
    assert.equal(maintained, 1);
  } finally {
    s.db.close();
  }
});
test("operator switches: an agreement covers the switches it named, and switching one off needs no new agreement", async () => {
  const s = await setup();
  try {
    s.setFeatures({ person_analytics: true, ip_collection: true, person_analytics_since: "2026-10-20" });
    await connectCompany(s.client, s.origin, "chrome");
    const coordinator = new Coordinator(s.db, {
      estimation: archivedEstimation,
      hasConsent: async () => true,
      count: unavailableCount,
      sendDisplay: async () => {},
      transport: s.transport,
    });
    await settleStartup(coordinator);
    // The dialog's agreement is for its text with both switches off.
    await coordinator.recordOrganizationConsent(ORGANIZATION_CONSENT_VERSION, s.origin);
    assert.equal(await coordinator.organizationReviewAfterConnect(), true, "the dialog asks again");
    assert.deepEqual((await coordinator.company.credentials())!.features, {
      person_analytics: true,
      ip_collection: true,
      person_analytics_since: "2026-10-20",
    });
    let company = (await coordinator.dashboard()).company!;
    assert.equal(company.consent_required, true);
    assert.equal(company.consent_version, "2026-10-19-people-address");
    assert.notEqual(company.consent_version, ORGANIZATION_CONSENT_VERSION);
    await coordinator.company.sync();
    assert.equal(coordinator.company.sharingHeld(), true);
    // An agreement to an older text is refused, so a stale page cannot release sharing.
    await assert.rejects(coordinator.agreeOrganization(ORGANIZATION_CONSENT_VERSION), /changed again/);
    await coordinator.agreeOrganization("2026-10-19-people-address");
    company = (await coordinator.dashboard()).company!;
    assert.equal(company.consent_required, false);
    await coordinator.company.sync();
    assert.equal(coordinator.company.sharingHeld(), false);
    // Less than was agreed to stays covered; an agreement elsewhere does not count here.
    s.setFeatures({ person_analytics: false, ip_collection: true });
    await coordinator.company.sync();
    assert.equal(coordinator.company.sharingHeld(), false);
    assert.equal(
      await coordinator.organizationAgreed("https://elsewhere.example", { person_analytics: true, ip_collection: false }),
      false,
    );
    coordinator.history.invalidate();
    coordinator.engines.dispose();
  } finally {
    s.db.close();
  }
});
test("before the person agreed to tracking a sync applies erasures only and uploads nothing (18 Oct 2026)", async () => {
  const s = await setup();
  try {
    await connectCompany(s.client, s.origin, "edge");
    await s.db.commit(
      {
        namespace: s.credentials.namespace,
        mode: "company",
        era: s.credentials.enrollment_era.id,
      },
      records(),
    );
    let agreed = false;
    let maintained = 0;
    s.client.trackingAllowed = async () => agreed;
    s.client.historyMaintenance = async () => {
      maintained++;
    };
    s.client.estimationMaintenance = async () => {
      maintained++;
    };
    const from = s.calls.length;
    await s.client.maintenance();
    const paths = s.calls.slice(from).map((c) => new URL(c.url).pathname);
    assert.ok(paths.includes("/v1/deletions/status"), "an erasure still reaches the server");
    for (const path of ["/v1/config", "/v1/health/reports", "/v1/usage/batches"])
      assert.equal(paths.includes(path), false, path);
    assert.equal(maintained, 0, "no history or estimation maintenance");
    const waiting = (await s.db.pending(s.credentials.namespace)).length;
    assert.ok(waiting > 0, "the records wait in this browser");
    agreed = true;
    await s.client.maintenance();
    assert.ok(s.calls.some((c) => c.url.endsWith("/v1/usage/batches")), "the same sync uploads once agreed");
    assert.equal(maintained, 2);
  } finally {
    s.db.close();
  }
});

for (const status of ["retention_expired", "erased"] as const)
  test(`live ${status} ACK preserves the correct imported-history deletion boundary`, async () => {
    const s = await setup();
    try {
      await connectCompany(s.client, s.origin, "chrome");
      const scope = {
        namespace: s.credentials.namespace,
        mode: "company" as const,
        era: s.credentials.enrollment_era.id,
      };
      const [r, a] = records();
      r.provider_request_key = "b".repeat(64);
      a.provider_attempt_key = "c".repeat(64);
      await s.db.commit(scope, [r, a]);
      const page = HistoryPageSchema.parse({
        schema_version: "3.0.0",
        site: "claude",
        conversation_key: r.conversation_key,
        observed_at: new Date().toISOString(),
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
            timing: null,
            schema_version: "3.0.0",
            kind: "history_message",
            site: "claude",
            key_version: "1",
            message_key: "d".repeat(64),
            role: "response",
            conversation_key: r.conversation_key,
            parent_key: null,
            prompt_key: null,
            provider_request_key: r.provider_request_key,
            provider_attempt_key: a.provider_attempt_key,
            occurred_at: "2020-01-01T00:00:00.000001Z",
            date_basis: "message_created",
            observed_at: new Date().toISOString(),
            model_id: null,
            proposed_method_id: BASELINE_METHOD_ID,
            proposed_method_hash: BASELINE_METHOD_HASH,
            tokens: a.tokens.answer_output,
            inline_file_text: null,
            parts: historyResponseParts(a.tokens.answer_output),
            generation: emptyGeneration(),
            company_dedup_key: null,
            text_complete: true,
            coverage_reasons: ["history_only"],
          },
        ],
      });
      const snapshot = await s.db.publicationSnapshot(scope.namespace);
      await s.db.commitHistory(
        scope,
        page,
        {
          authority: historyAuthority(snapshot),
          erasureVersion: snapshot.erasureVersion,
          estimates: {
            [page.messages[0].message_key]: estimateHistoricalText(
              page.messages[0],
            ),
          },
        },
        () => true,
      );
      s.setMode(status);
      await s.client.sync();
      assert.equal((await s.db.rows(scope.namespace)).length, 0);
      assert.equal((await s.db.pending(scope.namespace)).length, 0);
      assert.equal(
        (await s.db.historyPage(scope, undefined)).length,
        status === "erased" ? 0 : 1,
      );
      assert.equal(
        await s.db.historyErased(scope, page.messages[0]),
        status === "erased",
      );
      assert.equal(
        (await s.db.list<any>("health", scope.namespace)).some(
          (row) => row.code === "ledger_integrity_failed",
        ),
        false,
      );
    } finally {
      s.db.close();
    }
  });
test("D08 invalid erasure signature blocks uploads and retains numeric records", async () => {
  const s = await setup();
  await connectCompany(s.client, s.origin, "firefox");
  await s.db.commit(
    {
      namespace: s.credentials.namespace,
      mode: "company",
      era: s.credentials.enrollment_era.id,
    },
    records(),
  );
  s.setMode("bad-signature");
  await s.client.sync();
  assert.equal((await s.db.pending(s.credentials.namespace)).length, 2);
  assert.equal(
    s.calls.filter((c) => c.url.endsWith("/v1/usage/batches")).length,
    0,
  );
  assert.ok(
    (await s.db.list<any>("health", s.credentials.namespace)).some(
      (h) => h.code === "deletion_in_progress",
    ),
  );
  s.db.close();
});
test("I06 refresh commits new credentials and operation completion atomically", async () => {
  const s = await setup();
  await s.db.application.applySessionChanges({
    credentials: {
      ...s.credentials,
      access_expires_at: new Date(Date.now() - 1).toISOString(),
    },
  });
  await s.client.authorized("/v1/config");
  assert.equal((await s.client.credentials())!.refresh_token, "new-refresh");
  assert.equal(await s.db.application.readRefreshOperation(), undefined);
  s.db.close();
});
/**
 * An administrator removing this browser or suspending its member deletes the tokens on the server,
 * so the next call or refresh is refused. The connection must end once: held, personal mode, no
 * further authenticated calls or refreshes on later syncs.
 */
async function assertConnectionEnded(
  s: Awaited<ReturnType<typeof setup>>,
  state: "revoked" | "reconnect_needed",
  code: "enrollment_revoked" | "auth_reconnect_required",
) {
  assert.equal((await s.client.credentials())?.enrollment_state, state);
  assert.ok(
    (await s.db.list<any>("health", s.credentials.namespace)).some(
      (h) => h.code === code,
    ),
  );
  assert.equal(
    (await s.db.get<any>("policy", "ownership-history")).eras.at(-1).scope.mode,
    "personal",
  );
  const before = s.calls.length;
  await s.client.sync();
  await s.client.sync();
  await s.client.maintenance();
  const later = s.calls.slice(before);
  assert.equal(
    later.some((c) => c.authorization !== null),
    false,
    "no authenticated call after the connection ended",
  );
  assert.equal(
    later.some((c) => new URL(c.url).pathname === "/v1/auth/refresh"),
    false,
    "no refresh loop",
  );
  await assert.rejects(s.client.authorized("/v1/config"), new RegExp(code));
}
async function expireAccess(s: Awaited<ReturnType<typeof setup>>) {
  const current = (await s.client.credentials())!;
  await s.db.application.applySessionChanges({
    credentials: {
      ...current,
      access_expires_at: new Date(Date.now() - 1).toISOString(),
    },
  });
}
test("a removed browser's refused call ends the connection without retrying", async () => {
  const s = await setup();
  await connectCompany(s.client, s.origin);
  s.answer("/v1/config", serverError("enrollment_revoked", 403));
  await s.client.sync();
  await assertConnectionEnded(s, "revoked", "enrollment_revoked");
  s.db.close();
});
test("a refresh refused as enrollment_revoked ends the connection without retrying", async () => {
  const s = await setup();
  await connectCompany(s.client, s.origin);
  await expireAccess(s);
  s.answer("/v1/auth/refresh", serverError("enrollment_revoked", 403));
  await s.client.sync();
  await assertConnectionEnded(s, "revoked", "enrollment_revoked");
  s.db.close();
});
test("every refusal that means this browser lost access ends the connection", async () => {
  // Checked against apps/server: enrollment_revoked (removed browser or member),
  // refresh_reuse_detected (revoked token family), installation_required, identity_unavailable.
  for (const code of [
    "enrollment_revoked",
    "refresh_reuse_detected",
    "installation_required",
    "identity_unavailable",
  ]) {
    const s = await setup();
    await connectCompany(s.client, s.origin);
    s.answer("/v1/config", serverError(code, 403));
    await s.client.sync();
    await assertConnectionEnded(s, "revoked", "enrollment_revoked");
    s.db.close();
  }
});
test("an organization paused or scheduled for deletion keeps the connection and retries later", async () => {
  // An administrator can cancel a scheduled deletion within 7 days; members must not reconnect.
  const s = await setup();
  await connectCompany(s.client, s.origin);
  const scope = {
    namespace: s.credentials.namespace,
    mode: "company" as const,
    era: s.credentials.enrollment_era.id,
  };
  await s.db.commit(scope, records());
  s.answer("/v1/config", serverError("service_suspended", 403));
  await s.client.sync();
  const kept = await s.client.credentials();
  assert.ok(kept);
  assert.equal(kept.enrollment_state ?? "active", "active");
  assert.equal(s.client.sharingPaused(), true);
  assert.equal((await s.db.pending(scope.namespace)).length, 2, "records wait in this browser");
  assert.equal(
    (await s.db.get<any>("policy", "ownership-history")).eras.at(-1).scope.mode,
    "company",
  );
  const health = await s.db.list<any>("health", scope.namespace);
  assert.ok(health.some((h) => h.code === "sync_delayed"));
  assert.equal(health.some((h) => h.code === "enrollment_revoked"), false);
  // Sharing waits: the next sync sends nothing authenticated until the pause has passed. The
  // signed deletion check, which needs no access token, still runs.
  const before = s.calls.length;
  await s.client.sync();
  assert.equal(
    s.calls.slice(before).some((c) => c.authorization !== null),
    false,
  );
  // Once the wait has passed and the organization is active again, sharing resumes.
  (s.client as any).pausedUntil = 0;
  await s.client.sync();
  assert.equal(s.client.sharingPaused(), false);
  assert.equal((await s.db.pending(scope.namespace)).length, 0);
  s.db.close();
});
test("a 403 that does not end access keeps the connection and records the error", async () => {
  for (const answer of [
    () => serverError("origin_mismatch", 403),
    () => serverError("csrf_failed", 403),
    // A proxy in front of the server can refuse with an HTML page.
    () =>
      new Response("<html><body>Forbidden</body></html>", {
        status: 403,
        headers: { "Content-Type": "text/html" },
      }),
  ]) {
    const s = await setup();
    await connectCompany(s.client, s.origin);
    s.answer("/v1/config", answer());
    await s.client.sync();
    const kept = await s.client.credentials();
    assert.equal(kept?.enrollment_state ?? "active", "active");
    assert.equal(s.client.sharingPaused(), false);
    assert.ok(
      (await s.db.list<any>("health", s.credentials.namespace)).some(
        (h) => h.code === "policy_unavailable",
      ),
    );
    // The next sync asks the server again.
    const before = s.calls.length;
    await s.client.sync();
    assert.ok(s.calls.length > before);
    s.db.close();
  }
});
test("an error page from a proxy keeps its status and Retry-After", async () => {
  const s = await setup();
  await connectCompany(s.client, s.origin);
  const page = (status: number, headers: Record<string, string> = {}) =>
    new Response("<html><body>Bad gateway</body></html>", {
      status,
      headers: { "Content-Type": "text/html", ...headers },
    });
  for (const status of [502, 503]) {
    s.answer("/v1/config", page(status, { "Retry-After": "120" }));
    await assert.rejects(s.client.authorized("/v1/config"), (error: any) => {
      assert.equal(error.status, status);
      assert.equal(error.message, "sync_delayed");
      assert.equal(error.retryAfter, 120000);
      return true;
    });
  }
  s.answer("/v1/config", page(429, { "Retry-After": "30" }));
  await assert.rejects(s.client.authorized("/v1/config"), (error: any) => {
    assert.equal(error.status, 429);
    assert.equal(error.retryAfter, 30000);
    return true;
  });
  // An HTML 401 still renews the access token and repeats the call.
  s.answer("/v1/config", page(401));
  await s.client.authorized("/v1/config");
  assert.ok(s.calls.some((c) => new URL(c.url).pathname === "/v1/auth/refresh"));
  // A JSON error body still names its code.
  s.answer("/v1/config", serverError("recalculation_pending", 409));
  await assert.rejects(s.client.authorized("/v1/config"), (error: any) => {
    assert.equal(error.status, 409);
    assert.equal(error.code, "recalculation_pending");
    assert.equal(serverErrorCode(error), "recalculation_pending");
    return true;
  });
  // A 503 during sync waits for the time the server asked for.
  await s.db.commit(
    {
      namespace: s.credentials.namespace,
      mode: "company",
      era: s.credentials.enrollment_era.id,
    },
    records(),
  );
  s.answer("/v1/usage/batches", page(503, { "Retry-After": "120" }));
  await s.client.sync();
  assert.equal((await s.client.credentials())?.enrollment_state ?? "active", "active");
  const waiting = await s.db.list<any>("outbox", s.credentials.namespace);
  assert.ok(waiting.length > 0);
  assert.ok(
    waiting.every((row) => row.nextAt >= Date.now() + 100000),
    "the queued records wait for Retry-After",
  );
  s.db.close();
});
test("a deadline that passes while the answer arrives is a timeout, which counts as offline", async (t) => {
  const s = await setup();
  await connectCompany(s.client, s.origin);
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  let more: (() => void) | null = null;
  s.answer(
    "/v1/config",
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("{"));
        },
        pull(controller) {
          return new Promise<void>((resolve) => {
            more = () => {
              controller.enqueue(new TextEncoder().encode("}"));
              resolve();
            };
          });
        },
      }),
      { headers: { "Content-Type": "application/json" } },
    ),
  );
  const pending = s.client.authorized("/v1/config");
  for (let i = 0; i < 200 && !more; i++)
    await new Promise((resolve) => setImmediate(resolve));
  assert.ok(more, "the body is being read");
  t.mock.timers.tick(21000);
  (more as unknown as () => void)();
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof DOMException);
    assert.equal(error.name, "TimeoutError");
    assert.equal(isNetworkFailure(error), true);
    return true;
  });
  t.mock.timers.reset();
  s.db.close();
});
test("a refresh whose token was deleted asks to reconnect once and never loops", async () => {
  for (const expired of [true, false]) {
    const s = await setup();
    await connectCompany(s.client, s.origin);
    // Expired: the refresh comes first. Not expired: the deleted access token is refused, then the refresh.
    if (expired) await expireAccess(s);
    else s.answer("/v1/config", serverError("authentication_required", 401));
    s.answer("/v1/auth/refresh", serverError("authentication_required", 401));
    await s.client.sync();
    assert.equal(
      s.calls.filter((c) => new URL(c.url).pathname === "/v1/auth/refresh")
        .length,
      1,
    );
    await assertConnectionEnded(s, "reconnect_needed", "auth_reconnect_required");
    s.db.close();
  }
});
test("the dashboard reports a removed connection in personal mode", async () => {
  const s = await setup();
  const coordinator = schemaCoordinator(s);
  try {
    await connectCompany(coordinator.company, s.origin);
    assert.equal((await coordinator.dashboard({})).mode, "company");
    s.answer("/v1/config", serverError("enrollment_revoked", 403));
    await coordinator.company.sync();
    const view = await coordinator.dashboard({});
    assert.equal(view.mode, "personal");
    assert.equal(view.company?.enrollment_state, "revoked");
  } finally {
    coordinator.engines.dispose();
    s.db.close();
  }
});
test("S04 wrong-origin URLs and oversized API responses fail without credential redirects", async () => {
  for (const value of [
    "http://company.example",
    "https://u:p@company.example",
    "https://company.example/path",
    "https://company.example/#secret",
  ])
    assert.throws(() => companyOrigin(value));
  const s = await setup();
  s.setMode("large");
  await assert.rejects(
    s.client.requestCode(s.origin, TEST_WORK_EMAIL),
    /payload_rejected/,
  );
  assert.equal(await s.client.credentials(), undefined);
  s.db.close();
});

const schemaSender = {
  tab: { id: 31 },
  frameId: 0,
  documentId: "schema-transition",
  url: "https://claude.ai/new",
};
const schemaDispatch = (at = new Date().toISOString()) => ({
  timing: null,
  channel: "ai-footprint-observation-v1",
  version: 1,
  id: crypto.randomUUID(),
  revision: 1,
  event: "dispatch",
  site: "claude",
  at,
  dispatch: {
    site: "claude",
    action: "send",
    input: "Synthetic schema test",
    conversationId: crypto.randomUUID(),
    parentId: null,
    requestId: crypto.randomUUID(),
    model: null,
    attachments: null,
    imageEditParentId: null,
  },
  snapshot: initialSnapshot(),
  failure: null,
});
const schemaCoordinator = (s: Awaited<ReturnType<typeof setup>>) =>
  new Coordinator(s.db, {
    hasConsent: async () => true,
    count: unavailableCount,
    sendDisplay: async () => {},
    transport: s.transport,
  });

test("SCHEMA new captures use the current schema with unknown extracted text and Connect never queues personal history", async () => {
  const s = await setup(),
    coordinator = schemaCoordinator(s),
    personal = await coordinator.currentScope();
  await coordinator.capture(schemaDispatch(), schemaSender);
  const before = await s.db.rows(personal.namespace);
  assert.equal(before.length, 2);
  for (const row of before) {
    assert.equal(row.record.schema_version, "3.0.0");
    if (row.record.kind === "request") {
      assert.equal(row.record.schema_version, "3.0.0");
      if (row.record.schema_version === "3.0.0")
        assert.equal(row.record.documents.extracted_text, null);
      assert.equal(row.record.documents.upload_count, null);
    }
  }
  assert.equal(s.calls.length, 0);
  assert.equal(await s.db.pendingCount(personal.namespace), 0);
  const original = before.map((row) => ({
    key: row.key,
    hash: row.hash,
    json: canonicalJson(row.record),
  }));
  await connectCompany(s.client, s.origin, "chrome");
  assert.equal(await s.db.pendingCount(s.credentials.namespace), 0);
  const companyDispatch = schemaDispatch(
    new Date(Date.now() + 1).toISOString(),
  );
  await coordinator.capture(companyDispatch, schemaSender);
  await coordinator.settleConversationDisplays();
  const companyRows = await s.db.rows(s.credentials.namespace);
  assert.equal(companyRows.length, 2);
  assert.ok(companyRows.every((row) => row.record.schema_version === "3.0.0"));
  assert.deepEqual(
    (await s.db.rows(personal.namespace)).map((row) => ({
      key: row.key,
      hash: row.hash,
      json: canonicalJson(row.record),
    })),
    original,
  );
  assert.equal(await s.db.pendingCount(personal.namespace), 0);
  s.db.close();
});

test("SCHEMA current batches preserve revision payload hashes during sync", async () => {
  const s = await setup(),
    coordinator = schemaCoordinator(s);
  await coordinator.whenReady();
  await connectCompany(s.client, s.origin, "edge");
  const scope = {
    namespace: s.credentials.namespace,
    mode: "company" as const,
    era: s.credentials.enrollment_era.id,
  };
  const legacyMessage = schemaDispatch(new Date(Date.now() + 1).toISOString());
  const legacy = records();
  legacy[0].dispatched_at = legacyMessage.at;
  legacy[1].started_at = legacy[0].dispatched_at;
  const installation = (await s.db.get<{ routingSecret: string }>(
    "policy",
    "installation",
  ))!;
  const jobKey = await hmacIdentity(
    installation.routingSecret,
    "claude",
    "local-capture",
    `capture:${schemaSender.tab.id}:${schemaSender.documentId}:${legacyMessage.id}`,
  );
  await s.db.commit(scope, legacy, [
    {
      store: "provider_key_map",
      value: {
        key: jobKey,
        namespace: scope.namespace,
        scope,
        request: legacy[0],
        attempt: legacy[1],
        captureRevision: 1,
        parentKey: null,
        outputKey: null,
        branchId: legacy[0].conversation_key,
        imageParentKey: null,
        at: Date.now(),
      },
    },
  ]);
  const legacyBefore = (await s.db.pending(scope.namespace)).map((row) => ({
    key: row.key,
    hash: row.hash,
  }));
  const legacyCanonical = legacy.map((row) => canonicalJson(row));
  await coordinator.capture(
    {
      ...legacyMessage,
      event: "progress",
      revision: 2,
      dispatch: null,
      snapshot: { ...initialSnapshot(), started: true },
    },
    schemaSender,
  );
  await coordinator.settleConversationDisplays();
  const continued = await s.db.getRecord(
    scope.namespace,
    "request",
    legacy[0].request_id,
  );
  assert.equal(continued!.record.schema_version, "3.0.0");
  assert.equal(continued!.record.revision, 2);
  await coordinator.capture(
    schemaDispatch(new Date(Date.now() + 1).toISOString()),
    schemaSender,
  );
  await coordinator.settleConversationDisplays();
  const queued = await s.db.pending(scope.namespace),
    originals = new Map<string, { hash: string; json: string }>();
  for (const row of queued)
    originals.set(row.key, {
      hash: row.hash,
      json: canonicalJson(await s.db.queuedRecord(row)),
    });
  assert.ok(queued.length >= 4);
  await s.client.sync();
  const sent = s.calls.filter(
    (call) => new URL(call.url).pathname === "/v1/usage/batches",
  );
  assert.equal(sent.length, 1);
  const batch = parseUsageBatch(sent[0]!.body);
  assert.equal(batch.schema_version, "3.0.0");
  assert.deepEqual(
    new Set(batch.records.map((row) => row.schema_version)),
    new Set(["3.0.0", "3.0.0"]),
  );
  for (const row of batch.records) {
    const id = row.kind === "request" ? row.request_id : row.attempt_id,
      key = `${scope.namespace}:${row.kind}:${id}:${row.revision}`,
      old = originals.get(key)!;
    assert.ok(old);
    assert.equal(canonicalJson(row), old.json);
    assert.equal(await digest(row), old.hash);
  }
  assert.equal(await s.db.pendingCount(scope.namespace), 0);
  for (let i = 0; i < legacyBefore.length; i++) {
    const old = legacyBefore[i]!,
      persisted = await s.db.get<any>("measurements", old.key);
    assert.equal(persisted.hash, old.hash);
    assert.ok(legacyCanonical.includes(canonicalJson(persisted.record)));
    assert.equal(persisted.record.schema_version, "3.0.0");
    if (persisted.record.kind === "request")
      assert.deepEqual(
        persisted.record.documents.extracted_text,
        legacy[0].documents.extracted_text,
      );
  }
  s.db.close();
});

test("SCHEMA current job survives reopen and Connect without rewriting original revisions", async () => {
  const s = await setup(),
    coordinator = schemaCoordinator(s),
    scope = await coordinator.currentScope();
  const message = schemaDispatch(),
    legacy = records();
  legacy[0].dispatched_at = message.at;
  legacy[1].started_at = message.at;
  const installation = (await s.db.get<{ routingSecret: string }>(
    "policy",
    "installation",
  ))!;
  const key = await hmacIdentity(
    installation.routingSecret,
    "claude",
    "local-capture",
    `capture:${schemaSender.tab.id}:${schemaSender.documentId}:${message.id}`,
  );
  const job = {
    key,
    namespace: scope.namespace,
    scope,
    request: legacy[0],
    attempt: legacy[1],
    captureRevision: 1,
    parentKey: null,
    outputKey: null,
    branchId: legacy[0].conversation_key,
    imageParentKey: null,
    at: Date.now(),
  };
  await s.db.commit(scope, legacy, [{ store: "provider_key_map", value: job }]);
  const history = await s.db.list<any>("measurements", scope.namespace);
  const snapshots = history.map((row) => ({
    key: row.key,
    hash: row.hash,
    json: canonicalJson(row.record),
  }));
  const name = s.dbName;
  s.db.close();
  const reopened = await Ledger.open(name),
    active = new Coordinator(reopened, {
      hasConsent: async () => true,
      count: unavailableCount,
      sendDisplay: async () => {},
      transport: s.transport,
    });
  await active.whenReady();
  const client = new CompanyClient(reopened, s.transport);
  await connectCompany(client, s.origin, "firefox");
  const callsBefore = s.calls.length;
  await active.capture(
    {
      ...message,
      event: "end",
      revision: 2,
      dispatch: null,
      snapshot: { ...initialSnapshot(), started: true, state: "completed" },
    },
    schemaSender,
  );
  for (const row of snapshots) {
    const saved = await reopened.get<any>("measurements", row.key);
    assert.equal(saved.hash, row.hash);
    assert.equal(canonicalJson(saved.record), row.json);
  }
  const current = await reopened.rows(scope.namespace);
  assert.equal(current.length, 2);
  assert.ok(
    current.every(
      (row) =>
        row.record.schema_version === "3.0.0" &&
        row.record.revision === 2 &&
        row.record.state === "completed",
    ),
  );
  const request = current.find((row) => row.record.kind === "request")!.record;
  if (request.kind === "request")
    assert.deepEqual(
      request.documents.extracted_text,
      legacy[0].documents.extracted_text,
    );
  assert.equal(s.calls.length, callsBefore);
  assert.equal(await reopened.pendingCount(scope.namespace), 0);
  assert.equal(await reopened.pendingCount(s.credentials.namespace), 0);
  reopened.close();
});

/** The change a concurrent write makes to saved totals, such as a sync acknowledgement. */
async function invalidateSavedTotals(s: Awaited<ReturnType<typeof setup>>) {
  const key = `epoch:${s.credentials.namespace}`;
  const epoch = await s.db.get<{ version?: number }>("dashboard_cache", key);
  await s.db.put("dashboard_cache", {
    ...epoch,
    key,
    namespace: s.credentials.namespace,
    version: (epoch?.version ?? 0) + 1,
  });
}

/**
 * A company reply, then read aloud of it. With `changed`, saved totals change while
 * the first read after the speech upload is open. With `overtaken`, the calculation
 * changes during the recent view read before the upload.
 */
async function companyReadAloud(changed: boolean, overtaken = false) {
  const s = await setup();
  // Each conversation summary read returns a new server request count, so the display
  // shows which read it came from.
  let summaries = 0;
  let overlapped = 0;
  const order: string[] = [];
  const transport = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (/^\/v1\/me\/conversations\/[a-f0-9]{64}\/summary$/.test(path)) {
      order.push("summary");
      const read = ++summaries;
      if (changed && !overlapped && order.includes("batch:read_aloud")) {
        overlapped = read;
        await invalidateSavedTotals(s);
      }
      return new Response(
        JSON.stringify({
          aggregate_status: "current",
          request_count: String(read),
          attempt_count: "1",
          tokens: [],
          resources: [],
          history: emptyHistorySummary(),
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }
    if (path === "/v1/usage/batches") {
      const body = JSON.parse(String(init!.body));
      order.push(
        body.records.some((r: any) => r.action === "read_aloud")
          ? "batch:read_aloud"
          : "batch",
      );
    }
    return s.transport(input, init);
  }) as typeof fetch;
  const client = new CompanyClient(s.db, transport);
  await connectCompany(client, s.origin, "firefox");
  const displays: any[] = [];
  const coordinator = new Coordinator(s.db, {
    // The original view's server summary carries no method to match.
    estimation: archivedEstimation,
    hasConsent: async () => true,
    count: countByTextLength,
    sendDisplay: async (_, message) => {
      displays.push(message);
    },
    transport,
  });
  await settleStartup(coordinator);
  assert.equal((await coordinator.currentScope()).mode, "company");
  const conversationId = crypto.randomUUID();
  const sender = {
    tab: { id: 32 },
    frameId: 0,
    documentId: "company-read-aloud",
    url: `https://chatgpt.com/c/${conversationId}`,
  };
  const binding = (captureId: string) => ({
    documentNonce: "00000000-0000-4000-8000-0000000000e1",
    navigationNonce: "00000000-0000-4000-8000-0000000000e2",
    captureId,
  });
  const frame = (id: string, action: string, input: string) => ({
    timing: null,
    channel: "ai-footprint-observation-v1",
    version: 1,
    id,
    revision: 1,
    event: "dispatch",
    site: "chatgpt",
    at: new Date().toISOString(),
    dispatch: {
      site: "chatgpt",
      action,
      input,
      conversationId,
      parentId: null,
      requestId: null,
      model: null,
      attachments: 0,
      imageEditParentId: null,
    },
    snapshot: initialSnapshot(),
    failure: null,
  });
  const reply = frame(crypto.randomUUID(), "send", "Synthetic question");
  await coordinator.capture(reply as any, sender, binding(reply.id));
  await coordinator.capture(
    {
      ...reply,
      revision: 2,
      event: "end",
      dispatch: null,
      snapshot: {
        ...initialSnapshot(),
        text: "Synthetic answer.",
        thinking: "",
        started: true,
        state: "completed",
        conversationId,
        outputId: "answer-1",
        attemptId: "answer-1",
      },
    } as any,
    sender,
    binding(reply.id),
  );
  await coordinator.settleConversationDisplays();
  const shown = displays.at(-1);
  assert.equal(shown.displayBinding.captureId, reply.id);
  const before = displays.length;
  order.length = 0;
  // The recent view before the upload reports that the calculation changed during it.
  let refused = 0;
  if (overtaken) {
    const view = (coordinator as any).conversationView.bind(coordinator);
    (coordinator as any).conversationView = async (...args: any[]) => {
      if ((args[2] ?? 0) > 0 && !refused++)
        throw new Error("aggregate_inconsistent");
      return view(...args);
    };
  }
  const speech = frame(crypto.randomUUID(), "read_aloud", "");
  await coordinator.capture(speech as any, sender, binding(speech.id));
  await coordinator.capture(
    {
      ...speech,
      revision: 2,
      event: "end",
      dispatch: null,
      snapshot: {
        ...initialSnapshot(),
        text: "",
        thinking: "",
        toolInput: "",
        intermediate: "",
        toolOutput: "",
        started: true,
        state: "completed",
        conversationId,
        media: [
          {
            kind: "speech",
            basis: "audio_frames",
            seconds: 10.24,
            characters: null,
          },
        ],
      },
    } as any,
    sender,
    binding(speech.id),
  );
  await coordinator.settleConversationDisplays();
  const after = displays.slice(before);
  // Every display after the read aloud is the reply's, never the read aloud's.
  assert.ok(after.length >= 2);
  assert.ok(after.every((d) => d.displayBinding.captureId === reply.id));
  // The speech is uploaded at once, and the reply is then shown from a fresh server read.
  // A read that overlapped a change is made again, and its figures are never shown.
  assert.deepEqual(order.slice(changed ? -3 : -2), [
    "batch:read_aloud",
    "summary",
    ...(changed ? ["summary"] : []),
  ]);
  if (changed) {
    assert.ok(overlapped > 0);
    assert.ok(
      !displays.some(
        (d) => d.conversation.server?.request_count === String(overlapped),
      ),
    );
  }
  if (overtaken) assert.equal(refused, 1);
  const last = after.at(-1);
  assert.equal(last.conversation.source, "server");
  assert.equal(last.conversation.server.request_count, String(summaries));
  assert.equal(last.conversation.pendingObservationCount, 0);
  assert.equal(last.summary.requests, 1);
  assert.equal(last.summary.attempts, 2);
  assert.equal(await s.db.pendingCount(s.credentials.namespace), 0);
  assert.equal(
    (await s.db.list<any>("health", s.credentials.namespace)).some(
      (row) => row.code === "sync_delayed",
    ),
    false,
  );
  coordinator.engines.dispose();
  s.db.close();
}
test("G1 company read aloud syncs at once and shows the reply again from the server", () =>
  companyReadAloud(false));
test("G1 company read aloud reads the server again when the calculation changes during the read after its upload", () =>
  companyReadAloud(true));
test("G1 company read aloud still uploads and shows the server when its recent view was overtaken", () =>
  companyReadAloud(false, true));

/**
 * One company ChatGPT reply. Each conversation read returns a higher server request
 * count, so a display shows which read it came from. A read can be held at the server,
 * or run a step before it answers, to change the local calculation while it is open.
 */
async function companyReply(s: Awaited<ReturnType<typeof setup>>) {
  let reads = 0;
  let beforeAnswer: ((read: number) => Promise<void> | void) | null = null;
  const order: string[] = [];
  const transport = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (/^\/v1\/me\/conversations\/[a-f0-9]{64}\/summary$/.test(path)) {
      order.push("summary");
      const read = ++reads;
      await beforeAnswer?.(read);
      return new Response(
        JSON.stringify({
          aggregate_status: "current",
          request_count: String(read),
          attempt_count: "1",
          tokens: [],
          resources: [],
          history: emptyHistorySummary(),
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }
    if (path === "/v1/usage/batches") order.push("batch");
    return s.transport(input, init);
  }) as typeof fetch;
  const client = new CompanyClient(s.db, transport);
  await connectCompany(client, s.origin, "chrome");
  const displays: any[] = [];
  const coordinator = new Coordinator(s.db, {
    // The original view's server summary carries no method to match.
    estimation: archivedEstimation,
    hasConsent: async () => true,
    count: countByTextLength,
    sendDisplay: async (_, message) => {
      displays.push(message);
    },
    transport,
  });
  await settleStartup(coordinator);
  assert.equal((await coordinator.currentScope()).mode, "company");
  const conversationId = crypto.randomUUID();
  const sender = {
    tab: { id: 33 },
    frameId: 0,
    documentId: "company-reply-sync",
    url: `https://chatgpt.com/c/${conversationId}`,
  };
  const id = crypto.randomUUID();
  const binding = {
    documentNonce: "00000000-0000-4000-8000-0000000000f1",
    navigationNonce: "00000000-0000-4000-8000-0000000000f2",
    captureId: id,
  };
  const dispatch = {
    timing: null,
    channel: "ai-footprint-observation-v1",
    version: 1,
    id,
    revision: 1,
    event: "dispatch",
    site: "chatgpt",
    at: new Date().toISOString(),
    dispatch: {
      site: "chatgpt",
      action: "send",
      input: "Synthetic question",
      conversationId,
      parentId: null,
      requestId: null,
      model: null,
      attachments: 0,
      imageEditParentId: null,
    },
    snapshot: initialSnapshot(),
    failure: null,
  };
  const reply = (
    revision: number,
    event: "progress" | "end",
    text: string,
  ) => ({
    ...dispatch,
    revision,
    event,
    dispatch: null,
    snapshot: {
      ...initialSnapshot(),
      text,
      thinking: "",
      started: true,
      state: event === "end" ? "completed" : "generating",
      conversationId,
      outputId: "answer-1",
      attemptId: "answer-1",
    },
  });
  return {
    coordinator,
    displays,
    order,
    reads: () => reads,
    scope: {
      namespace: s.credentials.namespace,
      mode: "company" as const,
      era: s.credentials.enrollment_era.id,
    },
    replyId: id,
    capture: (message: unknown) =>
      coordinator.capture(message as any, sender, binding),
    dispatch,
    progress: (revision: number, text: string) =>
      reply(revision, "progress", text),
    end: (revision: number, text: string) => reply(revision, "end", text),
    beforeAnswer: (step: typeof beforeAnswer) => {
      beforeAnswer = step;
    },
    /** Holds the next read at the server; `reached` resolves once it arrives there. */
    hold() {
      let arrived!: () => void, open!: () => void;
      const reached = new Promise<void>((resolve) => (arrived = resolve));
      const gate = new Promise<void>((resolve) => (open = resolve));
      beforeAnswer = () => {
        beforeAnswer = null;
        arrived();
        return gate;
      };
      return { reached, release: open };
    },
    invalidateSavedTotals: () => invalidateSavedTotals(s),
    async health(code: string) {
      return (await s.db.list<any>("health", s.credentials.namespace)).some(
        (row) => row.code === code,
      );
    },
  };
}

// A read that began before the end frame committed is rejected by the calculation guard.
// Progress frames share that read. The reply still uploads at once and then shows the
// server figures, and no frame records a delayed sync.
for (const progress of [false, true])
  test(`company end frame uploads at once while ${progress ? "the read shared by the dispatch and progress frames" : "the dispatch frame's read"} is still open`, async () => {
    const s = await setup();
    const c = await companyReply(s);
    try {
      const held = c.hold();
      await c.capture(c.dispatch);
      // The dispatch frame's read has its calculation token and waits for the server.
      await held.reached;
      if (progress) await c.capture(c.progress(2, "Synthetic"));
      await c.capture(c.end(progress ? 3 : 2, "Synthetic answer."));
      held.release();
      await c.coordinator.settleConversationDisplays();
      assert.deepEqual(c.order.slice(-2), ["batch", "summary"]);
      assert.equal(await s.db.pendingCount(c.scope.namespace), 0);
      const last = c.displays.at(-1);
      assert.equal(last.displayBinding.captureId, c.replyId);
      assert.equal(last.state, "completed");
      assert.equal(last.conversation.source, "server");
      assert.equal(last.conversation.server.request_count, String(c.reads()));
      assert.equal(last.conversation.pendingObservationCount, 0);
      assert.equal(last.summary.requests, 1);
      assert.equal(last.summary.attempts, 1);
      assert.equal(await c.health("sync_delayed"), false);
    } finally {
      c.coordinator.engines.dispose();
      s.db.close();
    }
  });

test("company end frame does not read the server again after an erasure during its read", async () => {
  const s = await setup();
  const c = await companyReply(s);
  try {
    const held = c.hold();
    await c.capture(c.dispatch);
    await held.reached;
    await c.capture(c.end(2, "Synthetic answer."));
    // A signed range deletion is applied while the read waits for the server.
    await s.db.applyRange(
      c.scope,
      null,
      new Date(Date.now() + 5000).toISOString(),
      1,
    );
    held.release();
    await c.coordinator.settleConversationDisplays();
    // The server may still be deleting the range, so it is neither read again nor cached.
    assert.deepEqual(c.order, ["summary"]);
    assert.equal(
      (await s.db.list<any>("dashboard_cache", c.scope.namespace)).filter(
        (row) => row.server,
      ).length,
      0,
    );
    const last = c.displays.at(-1);
    assert.equal(last.displayBinding.captureId, c.replyId);
    assert.equal(last.conversation.server, null);
    assert.equal(last.summary.requests, 0);
  } finally {
    c.coordinator.engines.dispose();
    s.db.close();
  }
});

test("company reply reads the server again when the calculation changes during the read after its upload", async () => {
  const s = await setup();
  const c = await companyReply(s);
  try {
    await c.capture(c.dispatch);
    await c.coordinator.settleConversationDisplays();
    // Saved totals change while the first read after the upload is open.
    let overlapped = 0;
    c.beforeAnswer(async (read) => {
      if (!c.order.includes("batch")) return;
      c.beforeAnswer(null);
      overlapped = read;
      await c.invalidateSavedTotals();
    });
    await c.capture(c.end(2, "Synthetic answer."));
    await c.coordinator.settleConversationDisplays();
    assert.deepEqual(c.order.slice(c.order.indexOf("batch") + 1), [
      "summary",
      "summary",
    ]);
    // The read that overlapped the change is never shown; the next read is.
    assert.ok(overlapped > 0);
    assert.ok(
      !c.displays.some(
        (d) => d.conversation.server?.request_count === String(overlapped),
      ),
    );
    const last = c.displays.at(-1);
    assert.equal(last.displayBinding.captureId, c.replyId);
    assert.equal(last.conversation.source, "server");
    assert.equal(last.conversation.server.request_count, String(c.reads()));
    assert.equal(last.conversation.pendingObservationCount, 0);
    assert.equal(await c.health("sync_delayed"), false);
  } finally {
    c.coordinator.engines.dispose();
    s.db.close();
  }
});

test("company reply reads the server again when the calculation changes between the read after its upload and its display", async () => {
  const s = await setup();
  const c = await companyReply(s);
  try {
    await c.capture(c.dispatch);
    await c.coordinator.settleConversationDisplays();
    // Saved totals change once the first read after the upload has answered, while
    // its display is built. The local view is read once per display attempt.
    const history = c.coordinator.history;
    const localView = history.localView.bind(history);
    let answered = 0;
    history.localView = async (...args) => {
      if (
        !answered &&
        c.order.includes("batch") &&
        c.order.at(-1) === "summary"
      ) {
        answered = c.reads();
        await c.invalidateSavedTotals();
      }
      return localView(...args);
    };
    await c.capture(c.end(2, "Synthetic answer."));
    await c.coordinator.settleConversationDisplays();
    assert.deepEqual(c.order.slice(c.order.indexOf("batch") + 1), [
      "summary",
      "summary",
    ]);
    // The figures read before the change are never shown; the next read's are.
    assert.ok(answered > 0);
    assert.ok(
      !c.displays.some(
        (d) => d.conversation.server?.request_count === String(answered),
      ),
    );
    const last = c.displays.at(-1);
    assert.equal(last.displayBinding.captureId, c.replyId);
    assert.equal(last.conversation.source, "server");
    assert.equal(last.conversation.server.request_count, String(c.reads()));
    assert.equal(last.conversation.pendingObservationCount, 0);
    assert.equal(await c.health("sync_delayed"), false);
  } finally {
    c.coordinator.engines.dispose();
    s.db.close();
  }
});

test("company display refreshed by a saved-history commit reads the server again when the calculation changes before its display", async () => {
  const s = await setup();
  const c = await companyReply(s);
  try {
    await c.capture(c.dispatch);
    await c.capture(c.end(2, "Synthetic answer."));
    await c.coordinator.settleConversationDisplays();
    const conversationKey = (
      await s.db.list<any>("requests", c.scope.namespace)
    )[0].record.conversation_key;
    const before = c.reads();
    // Saved totals change once the first read of the refresh has answered, while its
    // display is built.
    const history = c.coordinator.history;
    const localView = history.localView.bind(history);
    let answered = 0;
    history.localView = async (...args) => {
      if (!answered && c.reads() > before) {
        answered = c.reads();
        await c.invalidateSavedTotals();
      }
      return localView(...args);
    };
    (c.coordinator as any).refreshFileDisplays(c.scope, conversationKey);
    await c.coordinator.settleConversationDisplays();
    assert.ok(answered > 0);
    assert.equal(c.reads(), answered + 1);
    assert.ok(
      !c.displays.some(
        (d) => d.conversation.server?.request_count === String(answered),
      ),
    );
    const last = c.displays.at(-1);
    assert.equal(last.displayBinding.captureId, c.replyId);
    assert.equal(last.conversation.source, "server");
    assert.equal(last.conversation.server.request_count, String(c.reads()));
  } finally {
    c.coordinator.engines.dispose();
    s.db.close();
  }
});

test("company reply never shows server figures from reads whose calculation kept changing", async () => {
  const s = await setup();
  const c = await companyReply(s);
  try {
    await c.capture(c.dispatch);
    await c.coordinator.settleConversationDisplays();
    const shown = c.displays.length;
    // Saved totals change during every read after the upload.
    c.beforeAnswer(async () => {
      if (c.order.includes("batch")) await c.invalidateSavedTotals();
    });
    await c.capture(c.end(2, "Synthetic answer."));
    await c.coordinator.settleConversationDisplays();
    // The upload still runs, and the read after it is tried a bounded number of times.
    const upload = c.order.indexOf("batch");
    assert.deepEqual(c.order.slice(upload + 1), [
      "summary",
      "summary",
      "summary",
    ]);
    const readsBeforeUpload = c.order
      .slice(0, upload)
      .filter((step) => step === "summary").length;
    const after = c.displays.slice(shown);
    assert.ok(after.length > 0);
    assert.ok(
      after.every(
        (d) =>
          d.conversation.server === null ||
          Number(d.conversation.server.request_count) <= readsBeforeUpload,
      ),
    );
    const last = after.at(-1);
    assert.equal(last.displayBinding.captureId, c.replyId);
    assert.equal(last.conversation.source, "local");
    assert.equal(last.conversation.pendingObservationCount, 0);
    // The figures could not be refreshed from the server, which stays visible in health.
    assert.equal(await c.health("sync_delayed"), true);
  } finally {
    c.coordinator.engines.dispose();
    s.db.close();
  }
});

// Company keys (W11): 32 synthetic bytes in the server's base64url form.
const COMPANY_KEY = Buffer.from("w11-synthetic-company-key-32byte").toString(
  "base64url",
);
type Run = {
  action: "send" | "regenerate" | "continue" | "read_aloud";
  requestId: string | null;
  attemptId: string | null;
  /** The prompt a Claude reply's stream names as its parent. */
  parentId?: string;
};
/**
 * A ChatGPT send, a regenerated reply, a continued reply and a read aloud of one chat,
 * captured and uploaded in company mode. Returns every upload batch the server received.
 */
function capturedChat(companyKey: string | null) {
  return capturedRuns(companyKey, "chatgpt", [
    { action: "send", requestId: "user-message-1", attemptId: "answer-1" },
    { action: "regenerate", requestId: null, attemptId: "answer-2" },
    { action: "continue", requestId: null, attemptId: "answer-3" },
    { action: "read_aloud", requestId: null, attemptId: null },
  ]);
}
async function capturedRuns(
  companyKey: string | null,
  site: "chatgpt" | "claude",
  runs: Run[],
  prepare?: (coordinator: Coordinator) => void,
) {
  const s = await setup();
  if (companyKey !== null)
    (s.credentials as any).company_dedup_key = companyKey;
  assert.equal(await connectCompany(s.client, s.origin, "chrome"), "connected");
  const coordinator = new Coordinator(s.db, {
    estimation: archivedEstimation,
    hasConsent: async () => true,
    count: countByTextLength,
    sendDisplay: async () => {},
    transport: s.transport,
  });
  try {
    await coordinator.whenReady();
    assert.equal((await coordinator.currentScope()).mode, "company");
    prepare?.(coordinator);
    const conversationId = crypto.randomUUID();
    const sender = {
      tab: { id: 41 },
      frameId: 0,
      documentId: "w11-company-keys",
      url:
        site === "chatgpt"
          ? `https://chatgpt.com/c/${conversationId}`
          : `https://claude.ai/chat/${conversationId}`,
    };
    const run = async ({ action, requestId, attemptId, parentId }: Run) => {
      const id = crypto.randomUUID();
      const binding = {
        documentNonce: "00000000-0000-4000-8000-0000000000a1",
        navigationNonce: "00000000-0000-4000-8000-0000000000a2",
        captureId: id,
      };
      const speech = action === "read_aloud";
      const dispatch = {
        timing: null,
        channel: "ai-footprint-observation-v1",
        version: 1,
        id,
        revision: 1,
        event: "dispatch",
        site,
        at: new Date().toISOString(),
        dispatch: {
          site,
          action,
          input: speech ? "" : "Synthetic question",
          conversationId,
          parentId: null,
          requestId,
          model: null,
          attachments: 0,
          imageEditParentId: null,
        },
        snapshot: initialSnapshot(),
        failure: null,
      };
      await coordinator.capture(dispatch as any, sender, binding);
      await coordinator.capture(
        {
          ...dispatch,
          revision: 2,
          event: "end",
          dispatch: null,
          snapshot: speech
            ? {
                ...initialSnapshot(),
                text: "",
                thinking: "",
                toolInput: "",
                intermediate: "",
                toolOutput: "",
                started: true,
                state: "completed",
                conversationId,
                media: [
                  {
                    kind: "speech",
                    basis: "audio_frames",
                    seconds: 10.24,
                    characters: null,
                  },
                ],
              }
            : {
                ...initialSnapshot(),
                text: "Synthetic answer.",
                thinking: "",
                started: true,
                state: "completed",
                conversationId,
                outputId: attemptId,
                ...(site === "chatgpt" ? { attemptId } : {}),
                ...(parentId ? { parentId } : {}),
              },
        } as any,
        sender,
        binding,
      );
    };
    for (const item of runs) await run(item);
    await coordinator.settleConversationDisplays();
    await coordinator.company.sync();
    assert.equal(await s.db.pendingCount(s.credentials.namespace), 0);
    return s.calls
      .filter((call) => call.url.endsWith("/v1/usage/batches"))
      .map((call) => parseUsageBatch(call.body));
  } finally {
    coordinator.engines.dispose();
    s.db.close();
  }
}

test("W11 the connection's company key names each prompt and new reply beside the records it uploads", async () => {
  const batches = await capturedChat(COMPANY_KEY);
  const records = batches.flatMap((batch) => batch.records);
  const keys = new Map<string, string>();
  for (const batch of batches)
    for (const entry of batch.company_dedup_keys ?? []) {
      const name = `${entry.kind}:${entry.record_id}`;
      // A record named again in a later batch keeps its key.
      assert.equal(
        keys.get(name) ?? entry.company_dedup_key,
        entry.company_dedup_key,
      );
      keys.set(name, entry.company_dedup_key);
    }
  const requests = new Map(
    records
      .filter((r) => r.kind === "request")
      .map((r) => [r.request_id, r as any]),
  );
  const named = (action: string) => {
    const request = [...requests.values()].find((r) => r.action === action)!;
    const attempt = records.find(
      (r) => r.kind === "attempt" && r.request_id === request.request_id,
    ) as any;
    return {
      request: keys.get(`request:${request.request_id}`) ?? null,
      attempt: keys.get(`attempt:${attempt.attempt_id}`) ?? null,
    };
  };
  const sign = (kind: string, id: string) =>
    hmacIdentity(COMPANY_KEY, "chatgpt", kind, id);
  // A send names its prompt and its reply.
  assert.deepEqual(named("send"), {
    request: await sign("company-request", "user-message-1"),
    attempt: await sign("company-attempt", "answer-1"),
  });
  // A regenerated reply is a new reply of the same prompt, already named by its send.
  assert.deepEqual(named("regenerate"), {
    request: null,
    attempt: await sign("company-attempt", "answer-2"),
  });
  // A continued reply extends one already named, and read aloud makes speech from a reply
  // already counted, so neither is ever merged with another member's copy.
  assert.deepEqual(named("continue"), { request: null, attempt: null });
  assert.deepEqual(named("read_aloud"), { request: null, attempt: null });
  // The key never travels inside a record, and differs from the member's own keys.
  assert.ok(records.every((r) => r.company_dedup_key === null));
  const reply = records.find(
    (r) => r.kind === "attempt" && keys.get(`attempt:${r.attempt_id}`),
  ) as any;
  assert.notEqual(
    reply.provider_attempt_key,
    keys.get(`attempt:${reply.attempt_id}`),
  );
});

test("a routing change while a reply's figures are built rebuilds them instead of failing the capture (16 October 2026)", async () => {
  // An organization key refresh changes the routing, which invalidates the history service.
  // Here that happens once, inside the first history view a display builds.
  let builds = 0;
  let invalidated = false;
  const batches = await capturedRuns(
    COMPANY_KEY,
    "chatgpt",
    [{ action: "send", requestId: "user-message-1", attemptId: "answer-1" }],
    (coordinator) => {
      const history = (coordinator as any).history;
      const localView = history.localView.bind(history);
      const currentScope = history.currentScope;
      let armed = false;
      history.currentScope = async () => {
        const scope = await currentScope();
        if (armed) {
          armed = false;
          invalidated = true;
          history.invalidate();
        }
        return scope;
      };
      history.localView = (...args: unknown[]) => {
        builds++;
        if (!invalidated) armed = true;
        return localView(...args);
      };
    },
  );
  assert.ok(invalidated);
  assert.ok(builds >= 2, "the display was built again");
  // The reply was saved and uploaded once as a record (revisions may repeat it in later batches).
  const records = batches.flatMap((batch) => batch.records);
  const replies = new Set(
    records.filter((r) => r.kind === "attempt").map((r: any) => r.attempt_id),
  );
  assert.equal(replies.size, 1);
});

test("W11 a Claude reply names its prompt by the message it answers, and a retry names no prompt", async () => {
  const batches = await capturedRuns(COMPANY_KEY, "claude", [
    {
      action: "send",
      requestId: crypto.randomUUID(),
      attemptId: "assistant-1",
      parentId: "human-1",
    },
    {
      action: "regenerate",
      requestId: crypto.randomUUID(),
      attemptId: "assistant-2",
      parentId: "human-1",
    },
  ]);
  const records = batches.flatMap((batch) => batch.records);
  const keys = new Map(
    batches.flatMap((batch) =>
      (batch.company_dedup_keys ?? []).map(
        (e) => [`${e.kind}:${e.record_id}`, e.company_dedup_key] as const,
      ),
    ),
  );
  const sign = (kind: string, id: string) =>
    hmacIdentity(COMPANY_KEY, "claude", kind, id);
  const named = (action: string) => {
    const request = records.find(
      (r) => r.kind === "request" && r.action === action,
    ) as any;
    const attempt = records.find(
      (r) => r.kind === "attempt" && r.request_id === request.request_id,
    ) as any;
    return {
      request: keys.get(`request:${request.request_id}`) ?? null,
      attempt: keys.get(`attempt:${attempt.attempt_id}`) ?? null,
    };
  };
  // The saved prompt is the message the reply answers, so the live prompt takes its id.
  assert.deepEqual(named("send"), {
    request: await sign("company-request", "human-1"),
    attempt: await sign("company-attempt", "assistant-1"),
  });
  // A retry answers the same prompt again: a new reply, but no new prompt to merge.
  assert.deepEqual(named("regenerate"), {
    request: null,
    attempt: await sign("company-attempt", "assistant-2"),
  });
});

test("W11 a saved NotebookLM answer linked to its live reply takes the live capture's company key (16 Oct 2026)", async () => {
  // The saved answer keeps another turn id than the stream named, so its own id would name
  // it apart from the live reply; linked by content, it takes the live capture's key.
  const notebook = "f0000000-0000-4000-8000-0000000000a1";
  const session = "11111111-1111-4111-8111-111111111111";
  const liveTurn = "39a01db2-0000-4000-8000-000000000001";
  const answerTurn = "852ef1d5-0000-4000-8000-000000000002";
  const questionTurn = "7d3c9e10-0000-4000-8000-000000000003";
  const answer = "The source names two causes and one remedy for the delay.";
  const origin = "https://notebook.google.com";
  const path = `/notebook/${notebook}`;
  const previous = (globalThis as any).location;
  Object.assign(globalThis, {
    location: { origin, hostname: "notebook.google.com", pathname: path, href: origin + path },
  });
  const s = await setup();
  (s.credentials as any).company_dedup_key = COMPANY_KEY;
  assert.equal(await connectCompany(s.client, s.origin, "chrome"), "connected");
  const coordinator = new Coordinator(s.db, {
    estimation: archivedEstimation,
    hasConsent: async () => true,
    hasSiteConsent: async () => true,
    count: countByTextLength,
    sendDisplay: async () => {},
    transport: s.transport,
  });
  try {
    await coordinator.whenReady();
    assert.equal((await coordinator.currentScope()).mode, "company");
    const sender = { tab: { id: 42 }, frameId: 0, documentId: "w11-notebooklm", url: origin + path };
    const binding = {
      documentNonce: "00000000-0000-4000-8000-0000000000b1",
      navigationNonce: "00000000-0000-4000-8000-0000000000b2",
      captureId: null,
    };
    const live = new NotebooklmChatSession();
    live.gemini([
      [
        "wrb.fr",
        null,
        JSON.stringify([
          [answer, null, [session, liveTurn, 2748674754], null, [null, null, null, null, 1]],
          [[["an echoed source passage"]]],
          null,
          [["One?", "Two?"]],
          true,
          [[["One?", 1], ["Two?", 1]]],
        ]),
      ],
    ]);
    const id = crypto.randomUUID();
    const frame = {
      channel: "ai-footprint-observation-v1",
      version: 1,
      id,
      site: "notebooklm",
      at: new Date().toISOString(),
      failure: null,
      timing: null,
    };
    await coordinator.capture(
      {
        ...frame,
        revision: 1,
        event: "dispatch",
        dispatch: {
          site: "notebooklm",
          action: "send",
          input: "What changed?",
          conversationId: notebook,
          parentId: null,
          requestId: null,
          model: null,
          attachments: 0,
          imageEditParentId: null,
          inputImages: [],
        },
        snapshot: initialSnapshot(),
      } as any,
      sender,
    );
    await coordinator.capture(
      { ...frame, revision: 2, event: "end", dispatch: null, snapshot: live.snapshot() } as any,
      sender,
    );
    // The page reads the notebook's session list and its saved turns, newest first.
    const line = (rows: unknown[]) => {
      const text = JSON.stringify(rows);
      return `${text.length + 2}\n${text}\n`;
    };
    const wire = (rpc: string, payload: unknown) =>
      ")]}'\n\n" + line([["wrb.fr", rpc, JSON.stringify(payload), null, null, null, "generic"]]);
    const call = (rpc: string, args: unknown[]) =>
      new URLSearchParams({
        "f.req": JSON.stringify([[[rpc, JSON.stringify(args), null, "generic"]]]),
        at: "synthetic",
      }).toString();
    const batchUrl = (rpc: string) =>
      new URL(`${origin}/_/LabsTailwindUi/data/batchexecute?rpcids=${rpc}&source-path=${encodeURIComponent(path)}&rt=c`);
    const at = Math.floor(Date.now() / 1000) - 60;
    const turns = [
      [answerTurn, [at + 2, 0], 2, null, [
        [answer, null, [session, session, 543618897], null, [null, null, null, null, 1]],
        [[["a quoted source passage"]]],
        null,
        [["One?", "Two?"]],
      ], 2],
      [questionTurn, [at + 1, 0], 1, "What changed?", null, 2],
    ];
    let started: Promise<unknown> = Promise.resolve();
    let finished = false;
    const observer = createHistoryTextObserver(
      (event) => {
        if (event.event === "start")
          started = coordinator.history.receive(event, binding, sender);
      },
      () => {},
      async (event) => {
        await started;
        const result = await coordinator.history.receiveStream(event, binding, sender);
        if (event.event === "finish") finished = result.accepted;
        return result.accepted;
      },
    );
    try {
      observer.observe(
        batchUrl("hPTbtc"),
        "POST",
        Promise.resolve(new Response(wire("hPTbtc", [[[session, [at, 0], [at, 0]]]]))),
        Date.now(),
        call("hPTbtc", [notebook, [2]]),
      );
      await new Promise((resolve) => setTimeout(resolve, 5));
      const context = [2, null, null, [1, null, null, null, null, null, null, null, null, null, [1]], [[1, 4, 8, 10, 14, 2, 3, 6]]];
      observer.observe(
        batchUrl("khqZz"),
        "POST",
        Promise.resolve(new Response(wire("khqZz", [turns]))),
        Date.now(),
        call("khqZz", [context, null, null, session, 20]),
      );
      for (let i = 0; i < 3000 && !finished; i++)
        await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(finished, true);
    } finally {
      observer.cancel();
    }
    const job = (await s.db.all<any>("provider_key_map"))[0];
    const liveKey = await hmacIdentity(COMPANY_KEY, "notebooklm", "company-attempt", liveTurn);
    assert.equal(job.companyKeys.attempt, liveKey);
    const saved = (await s.db.all<any>("history_records")).find(
      (row) => row.record.role === "response",
    );
    assert.equal(saved.record.provider_attempt_key, job.attempt.provider_attempt_key);
    assert.equal(saved.companyKey, liveKey);
  } finally {
    coordinator.history.invalidate();
    coordinator.engines.dispose();
    s.db.close();
    Object.assign(globalThis, { location: previous });
  }
});

test("W11 keys go only to a server that currently hands out a company key, once per record", async () => {
  const s = await setup();
  try {
    (s.credentials as any).company_dedup_key = COMPANY_KEY;
    assert.equal(await connectCompany(s.client, s.origin, "chrome"), "connected");
    const scope = {
      namespace: s.credentials.namespace,
      mode: "company" as const,
      era: s.credentials.enrollment_era.id,
    };
    const keys = { request: "1".repeat(64), attempt: "2".repeat(64) };
    const commit = async () => {
      const [request, attempt] = records();
      await s.db.application.commitCapture({
        scope,
        observations: [request, attempt],
        checkpoint: {
          key: crypto.randomUUID(),
          namespace: scope.namespace,
          scope,
          request,
          attempt,
          captureRevision: 1,
          parentKey: null,
          outputKey: null,
          branchId: "w11-gating",
          imageParentKey: null,
          companyKeys: keys,
          at: Date.now(),
        },
      });
      return [request, attempt] as const;
    };
    const batches = () =>
      s.calls
        .filter((call) => call.url.endsWith("/v1/usage/batches"))
        .map((call) => call.body);
    const hold = async (key: string | null) =>
      s.db.application.applySessionChanges({
        credentials: {
          ...(await s.client.credentials())!,
          company_dedup_key: key,
        },
      });
    // The server withdrew its key: queued records go without one.
    await hold(null);
    await commit();
    await s.client.sync();
    assert.equal(batches().length, 1);
    assert.equal(batches()[0].company_dedup_keys, undefined);
    // Handed out again: keys travel beside the records, one per record even when a
    // record goes with two revisions.
    await hold(COMPANY_KEY);
    const [request, attempt] = await commit();
    await s.db.application.commitCapture({
      scope,
      observations: [{ ...attempt, revision: 2 }],
    });
    await s.client.sync();
    const last = batches().at(-1);
    assert.equal(
      last.records.filter((r: any) => r.attempt_id === attempt.attempt_id)
        .length,
      2,
    );
    assert.deepEqual(last.company_dedup_keys, [
      {
        kind: "request",
        record_id: request.request_id,
        company_dedup_key: keys.request,
      },
      {
        kind: "attempt",
        record_id: attempt.attempt_id,
        company_dedup_key: keys.attempt,
      },
    ]);
    assert.equal(await s.db.pendingCount(scope.namespace), 0);
  } finally {
    s.db.close();
  }
});

test("W11 without a company key from the server an upload carries no key list", async () => {
  const batches = await capturedChat(null);
  assert.ok(batches.length > 0);
  assert.ok(batches.every((batch) => batch.company_dedup_keys === undefined));
});

test("W11 a refresh hands out the company key to an earlier enrolment and withdraws it when the server stops", async () => {
  const s = await setup();
  try {
    const expire = async () =>
      s.db.application.applySessionChanges({
        credentials: {
          ...((await s.client.credentials()) ?? s.credentials),
          access_expires_at: new Date(Date.now() - 1).toISOString(),
        },
      });
    await expire();
    assert.equal((await s.client.credentials())!.company_dedup_key, undefined);
    (s.credentials as any).company_dedup_key = COMPANY_KEY;
    await s.client.authorized("/v1/config");
    assert.equal(
      (await s.client.credentials())!.company_dedup_key,
      COMPANY_KEY,
    );
    delete (s.credentials as any).company_dedup_key;
    await expire();
    await s.client.authorized("/v1/config");
    assert.equal((await s.client.credentials())!.company_dedup_key, null);
    // A malformed key is refused and the saved credentials stay as they were.
    (s.credentials as any).company_dedup_key = "not a key";
    await expire();
    const before = await s.client.credentials();
    await assert.rejects(s.client.authorized("/v1/config"), /payload_rejected/);
    assert.deepEqual(await s.client.credentials(), before);
  } finally {
    s.db.close();
  }
});

test("W11 an upload built before a refresh that withdrew the company key goes without keys", async () => {
  const s = await setup();
  try {
    (s.credentials as any).company_dedup_key = COMPANY_KEY;
    assert.equal(await connectCompany(s.client, s.origin, "chrome"), "connected");
    const scope = {
      namespace: s.credentials.namespace,
      mode: "company" as const,
      era: s.credentials.enrollment_era.id,
    };
    const [request, attempt] = records();
    await s.db.application.commitCapture({
      scope,
      observations: [request, attempt],
      checkpoint: {
        key: crypto.randomUUID(),
        namespace: scope.namespace,
        scope,
        request,
        attempt,
        captureRevision: 1,
        parentKey: null,
        outputKey: null,
        branchId: "w11-withdrawn",
        imageParentKey: null,
        companyKeys: { request: "1".repeat(64), attempt: "2".repeat(64) },
        at: Date.now(),
      },
    });
    // The token has expired, and the server's next refresh hands out no key. The upload
    // reads its credentials before the policy check refreshes them.
    delete (s.credentials as any).company_dedup_key;
    await s.db.application.applySessionChanges({
      credentials: {
        ...(await s.client.credentials())!,
        access_expires_at: new Date(Date.now() - 1).toISOString(),
      },
    });
    await s.client.sync();
    assert.equal((await s.client.credentials())!.company_dedup_key, null);
    const batches = s.calls
      .filter((call) => call.url.endsWith("/v1/usage/batches"))
      .map((call) => call.body);
    assert.equal(batches.length, 1);
    assert.equal(batches[0].records.length, 2);
    assert.equal(batches[0].company_dedup_keys, undefined);
    // A saved page built with keys goes without them once the key is withdrawn.
    const page = {
      messages: [],
      company_dedup_keys: [
        { message_key: "a".repeat(64), company_dedup_key: "b".repeat(64) },
      ],
    };
    await s.client.threadRequest(scope, "/v1/me/history", page);
    const sent = s.calls
      .filter((call) => call.url.endsWith("/v1/me/history"))
      .at(-1)!.body;
    assert.deepEqual(sent, { messages: [] });
    assert.ok(page.company_dedup_keys, "the caller's page is left as it was");
  } finally {
    s.db.close();
  }
});

test("W11 a connection that hands out a malformed company key is refused", async () => {
  for (const malformed of ["short", COMPANY_KEY + "=", 42]) {
    const s = await setup();
    try {
      (s.credentials as any).company_dedup_key = malformed;
      await s.client.requestCode(s.origin, TEST_WORK_EMAIL);
      await s.client.verifyCode(TEST_CODE, "chrome");
      await assert.rejects(s.client.confirm(), /payload_rejected/);
      assert.equal(await s.client.credentials(), undefined);
    } finally {
      s.db.close();
    }
  }
});

/**
 * Saved totals change during every display attempt that follows the dispatch frame's
 * background read, as the later commits of a streaming reply do. The read waits at the
 * server until the changes start, and they stop once that background work ends. A
 * `newer` frame, if given, is captured during the first attempt and replaces the display
 * there. Its displays, including its own background work, finish while saved totals
 * hold still.
 */
async function conflictingDispatchDisplay(
  t: TestContext,
  c: Awaited<ReturnType<typeof companyReply>>,
  newer?: unknown,
) {
  const dispatchRead = c.hold();
  await c.capture(c.dispatch);
  await dispatchRead.reached;
  const shown = c.displays.length;
  const displayWork = (c.coordinator as any).displayWork as Set<Promise<void>>;
  // The dispatch frame's read and its display run in this background work only.
  const work = [...displayWork];
  assert.equal(work.length, 1);
  const history = c.coordinator.history;
  const localView = history.localView.bind(history);
  let changing = true;
  let attempts = 0;
  // A display attempt for a captured chat reads local history once, between the two
  // guarded snapshots that detect a calculation change.
  t.mock.method(
    history,
    "localView",
    async (...args: Parameters<typeof localView>) => {
      if (changing) {
        attempts++;
        await c.invalidateSavedTotals();
        if (newer && attempts === 1) {
          changing = false;
          await c.capture(newer);
          await Promise.all(
            [...displayWork].filter((other) => !work.includes(other)),
          );
          changing = true;
        }
      }
      return localView(...args);
    },
  );
  dispatchRead.release();
  await Promise.all(work);
  changing = false;
  return { attempts, shown };
}

// Company work shows a frame's figures outside the capture queue, so later frames of the
// reply commit while an earlier frame's display retries. Once a newer frame replaced that
// display, it can never be sent, and its retries must not report a calculation failure.
test("company display that a newer frame replaced during its retries records no estimate_unavailable", async (t) => {
  const s = await setup();
  const c = await companyReply(s);
  try {
    const dispatch = await conflictingDispatchDisplay(
      t,
      c,
      c.progress(2, "Synthetic"),
    );
    // The attempt that was open when the progress frame replaced the display was its last.
    assert.equal(dispatch.attempts, 1);
    await c.coordinator.settleConversationDisplays();
    assert.equal(await c.health("estimate_unavailable"), false);
    assert.equal(await c.health("sync_delayed"), false);
    // Only the progress frame's figures appeared after the dispatch frame's read.
    const after = c.displays.slice(dispatch.shown);
    assert.ok(after.length > 0);
    assert.ok(after.every((d) => d.state === "generating"));
    const last = after.at(-1);
    assert.equal(last.displayBinding.captureId, c.replyId);
    assert.equal(last.conversation.server.request_count, String(c.reads()));
  } finally {
    c.coordinator.engines.dispose();
    s.db.close();
  }
});

test("company display that stays current records estimate_unavailable when every attempt conflicts", async (t) => {
  const s = await setup();
  const c = await companyReply(s);
  try {
    const dispatch = await conflictingDispatchDisplay(t, c);
    // The display is still the tab's newest, so it uses every retry.
    assert.ok(dispatch.attempts >= 3);
    // Nothing from a changing calculation is shown, and the failure stays visible.
    assert.equal(c.displays.length, dispatch.shown);
    assert.equal(await c.health("estimate_unavailable"), true);
  } finally {
    c.coordinator.engines.dispose();
    s.db.close();
  }
});
test("a code request that never reached a server leaves nothing behind, so a corrected address works", async () => {
  // Owner, 13 Oct 2026: a mistyped server address (no certificate) left a pending connection
  // that refused the correct address, and the dialog offered no way to cancel it.
  const s = await setup();
  const typo = "https://typo.example";
  const transport = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith(typo)) throw new TypeError("Failed to fetch");
    return s.transport(url, init);
  }) as typeof fetch;
  const client = new CompanyClient(s.db, transport);
  const failure = await client
    .requestCode(typo, TEST_WORK_EMAIL)
    .catch((error: unknown) => error);
  assert.ok(failure instanceof TypeError);
  assert.match(connectFailureMessage(failure)!, /could not be reached/);
  assert.equal(await client.pending(), undefined);
  const sent = await client.requestCode(s.origin, TEST_WORK_EMAIL);
  assert.equal(sent.origin, s.origin);
  const p = await client.verifyCode(TEST_CODE, "chrome");
  assert.ok(p.connection_id);
  // A connection the server already holds has to be finished or cancelled first.
  await assert.rejects(
    client.requestCode(typo, TEST_WORK_EMAIL),
    /Finish or cancel the connection in progress before starting again\./,
  );
  s.db.close();
});
test("the company client calls the browser's fetch unbound", async () => {
  // Owner, 13 Oct 2026: every organization connect failed in Chrome because the client called
  // the global fetch as its own method. Browsers refuse that with this TypeError; Node does not,
  // so this transport copies the browser's check.
  const s = await setup();
  const strict = function (this: unknown, url: string | URL | Request, init?: RequestInit) {
    if (this !== undefined && this !== globalThis)
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    return s.transport(url, init);
  } as typeof fetch;
  const client = new CompanyClient(s.db, strict);
  assert.equal(await connectCompany(client, s.origin), "connected");
  s.db.close();
});
test("connect failures from local records keep the general handling", () => {
  assert.equal(
    connectFailureMessage(new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation")),
    null,
  );
  assert.equal(connectFailureMessage(new Error("ledger_integrity_failed")), null);
  assert.equal(connectFailureMessage(new Error("payload_rejected")), null);
  assert.match(
    connectFailureMessage(new DOMException("timed out", "TimeoutError"))!,
    /could not be reached/,
  );
});
test("connect failures name the server's answer only for the codes a person can act on", () => {
  const refused = (code: string, status = 400) =>
    Object.assign(new Error("payload_rejected"), { status, serverCode: code });
  assert.match(
    connectFailureMessage(refused("organization_not_found", 404))!,
    /No organization uses this work email domain\. Check that you used your work email, ask your administrator which work email the organization was registered with, or register your organization at aifootprinttracker\.com\./,
  );
  assert.match(connectFailureMessage(refused("work_email_required"))!, /Use your work email/);
  assert.match(connectFailureMessage(refused("admin_required", 403))!, /Members connect from/);
  assert.match(connectFailureMessage(refused("otp_invalid_or_expired", 401))!, /code is wrong or has expired/);
  assert.match(connectFailureMessage(refused("policy_changed", 409))!, /changed what it collects/);
  assert.match(connectFailureMessage(refused("capacity_reached", 409))!, /member limit/);
  assert.match(connectFailureMessage(refused("capacity", 403))!, /member limit/);
  assert.match(connectFailureMessage(refused("member_unavailable", 403))!, /removed or blocked/);
  assert.equal(connectFailureCode(refused("otp_invalid_or_expired", 401)), "otp_invalid_or_expired");
  // Other server codes keep the general handling and its technical detail.
  assert.equal(connectFailureMessage(refused("idempotency_conflict", 409)), null);
  assert.equal(connectFailureCode(refused("idempotency_conflict", 409)), "connect_failed");
  assert.equal(connectFailureCode(new TypeError("Failed to fetch")), "connect_failed");
});
test("call() keeps its general message and adds the server's code beside it", async () => {
  const s = await setup();
  await s.client.requestCode(s.origin, TEST_WORK_EMAIL);
  s.answer("/v1/connections", serverError("otp_invalid_or_expired", 401));
  const error = await s.client
    .verifyCode(TEST_CODE, "chrome")
    .catch((caught: unknown) => caught);
  assert.equal((error as Error).message, "auth_reconnect_required");
  assert.equal(serverErrorCode(error), "otp_invalid_or_expired");
  s.db.close();
});
test("a wrong code keeps the code step, so the person can try again or ask for a new code", async () => {
  const s = await setup();
  const sent = await s.client.requestCode(s.origin, TEST_WORK_EMAIL);
  s.answer("/v1/connections", serverError("otp_invalid_or_expired", 401));
  const error = await s.client
    .verifyCode(TEST_CODE, "chrome")
    .catch((caught: unknown) => caught);
  assert.match(connectFailureMessage(error)!, /code is wrong or has expired/);
  assert.deepEqual(await s.client.pending(), sent);
  const p = await s.client.verifyCode(TEST_CODE, "chrome");
  assert.equal(p.state, "verified");
  s.db.close();
});
test("a new code for the same address keeps this browser's verifier and operation ids", async () => {
  const s = await setup();
  const first = await s.client.requestCode(s.origin, TEST_WORK_EMAIL);
  const second = await s.client.requestCode(s.origin, "other@company.example");
  assert.equal(second.verifier, first.verifier);
  assert.equal(second.operation_id, first.operation_id);
  assert.equal(second.exchange_id, first.exchange_id);
  assert.notEqual(second.challenge_id, first.challenge_id);
  assert.equal(second.email, "other@company.example");
  const [a, b] = s.calls.map((c) => c.body.dispatch_id);
  assert.notEqual(a, b, "each request is a new dispatch, so the server sends a new code");
  s.db.close();
});
test("connection steps refuse malformed input before calling the server", async () => {
  const s = await setup();
  await assert.rejects(
    s.client.requestCode(s.origin, "not-an-email"),
    /Enter your work email/,
  );
  await assert.rejects(
    s.client.verifyCode(TEST_CODE, "chrome"),
    /The connection in progress has ended/,
  );
  await s.client.requestCode(s.origin, TEST_WORK_EMAIL);
  await assert.rejects(s.client.verifyCode("12345", "chrome"), /6-digit code/);
  await assert.rejects(s.client.confirm(), /The connection in progress has ended/);
  assert.deepEqual(
    s.calls.map((c) => new URL(c.url).pathname),
    ["/v1/connections/otp/request"],
  );
  assert.ok(connectFailureMessage(new Error("Enter the 6-digit code from the email.")));
  s.db.close();
});
for (const [code, status, pattern] of [
  ["organization_not_found", 404, /No organization uses this work email domain/],
  ["capacity_reached", 409, /member limit/],
  ["member_unavailable", 403, /removed or blocked/],
] as const)
  test(`${code} after the code ends the connection in progress`, async () => {
    const s = await setup();
    await s.client.requestCode(s.origin, TEST_WORK_EMAIL);
    s.answer("/v1/connections", serverError(code, status));
    const error = await s.client
      .verifyCode(TEST_CODE, "chrome")
      .catch((caught: unknown) => caught);
    assert.match(connectFailureMessage(error)!, pattern);
    assert.equal(connectFailureCode(error), code);
    assert.equal(await s.client.pending(), undefined);
    assert.equal(await s.client.credentials(), undefined);
    s.db.close();
  });
test("a free email domain is refused before anything is stored", async () => {
  const s = await setup();
  s.answer("/v1/connections/otp/request", serverError("work_email_required", 400));
  const error = await s.client
    .requestCode(s.origin, "someone@gmail.com")
    .catch((caught: unknown) => caught);
  assert.match(connectFailureMessage(error)!, /Use your work email/);
  assert.equal(await s.client.pending(), undefined);
  s.db.close();
});
test("an email the server could not send is reported and stores no code step", async () => {
  const s = await setup();
  s.answer("/v1/connections/otp/request", {
    ...codeSent(),
    delivery_state: "failed",
    error_code: "email_service_unavailable",
  });
  const error = await s.client
    .requestCode(s.origin, TEST_WORK_EMAIL)
    .catch((caught: unknown) => caught);
  assert.match(connectFailureMessage(error)!, /could not be sent/);
  assert.equal(await s.client.pending(), undefined);
  s.db.close();
});
test("a policy that changed before Connect ends the connection so the current terms are shown", async () => {
  const s = await setup();
  await s.client.requestCode(s.origin, TEST_WORK_EMAIL);
  await s.client.verifyCode(TEST_CODE, "chrome");
  s.answer("/v1/connections/exchange", serverError("policy_changed", 409));
  const error = await s.client.confirm().catch((caught: unknown) => caught);
  assert.match(connectFailureMessage(error)!, /changed what it collects/);
  assert.equal(await s.client.pending(), undefined);
  assert.equal(await s.client.credentials(), undefined);
  s.db.close();
});
test("a verified connection from a server that names another address is refused", async () => {
  const s = await setup();
  await s.client.requestCode(s.origin, TEST_WORK_EMAIL);
  s.answer(
    "/v1/connections",
    verifiedConnection("https://elsewhere.example", "key", { connectionId: "connection" }),
  );
  await assert.rejects(s.client.verifyCode(TEST_CODE, "chrome"), /policy_unavailable/);
  assert.equal((await s.client.pending())?.state, "code_sent");
  s.db.close();
});
test("a verified connection without the organization's name is refused", async () => {
  const s = await setup();
  await s.client.requestCode(s.origin, TEST_WORK_EMAIL);
  s.answer("/v1/connections", {
    ...verifiedConnection(s.origin, "key", { connectionId: "connection" }),
    company_name: "  ",
  });
  await assert.rejects(s.client.verifyCode(TEST_CODE, "chrome"), /payload_rejected/);
  s.db.close();
});
test("maintenance never confirms a connection for the person and never polls a code", async () => {
  const s = await setup();
  await s.client.requestCode(s.origin, TEST_WORK_EMAIL);
  await s.client.maintenance();
  await s.client.verifyCode(TEST_CODE, "chrome");
  const before = s.calls.length;
  await s.client.maintenance();
  assert.equal(s.calls.length, before);
  assert.equal(await s.client.credentials(), undefined);
  s.db.close();
});
// Status of 19 Oct 2026, item 7: when the Connect dialog's exchange failed on the way and the
// background's maintenance finished it, the person's organization agreement was never stored,
// so sharing stayed held and Settings asked them to agree again.
test("an organization agreement given in Connect is stored when maintenance finishes the connection", async () => {
  const s = await setup();
  let offline = true;
  const transport = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (offline && String(input).endsWith("/v1/connections/exchange"))
      throw new TypeError("Failed to fetch");
    return s.transport(input, init);
  }) as typeof fetch;
  const coordinator = new Coordinator(s.db, {
    estimation: archivedEstimation,
    hasConsent: async () => true,
    count: unavailableCount,
    sendDisplay: async () => {},
    transport,
  });
  try {
    await settleStartup(coordinator);
    await coordinator.company.requestCode(s.origin, TEST_WORK_EMAIL);
    await coordinator.company.verifyCode(TEST_CODE, "chrome");
    await assert.rejects(coordinator.company.confirm(ORGANIZATION_CONSENT_VERSION));
    assert.equal(await coordinator.company.credentials(), undefined);
    assert.equal((await coordinator.settings()).organizationConsent ?? null, null);
    offline = false;
    await coordinator.company.maintenance();
    assert.ok(await coordinator.company.credentials(), "maintenance finished the connection");
    const consent = (await coordinator.settings()).organizationConsent;
    assert.equal(consent?.version, ORGANIZATION_CONSENT_VERSION);
    assert.equal(consent?.origin, s.origin);
    assert.equal(await coordinator.organizationReviewAfterConnect(), false, "sharing is not held");
  } finally {
    coordinator.engines.dispose();
    s.db.close();
  }
});

test("a connection the dialog confirms without an agreement version stores none", async () => {
  const s = await setup();
  const coordinator = new Coordinator(s.db, {
    estimation: archivedEstimation,
    hasConsent: async () => true,
    count: unavailableCount,
    sendDisplay: async () => {},
    transport: s.transport,
  });
  try {
    await settleStartup(coordinator);
    await coordinator.company.requestCode(s.origin, TEST_WORK_EMAIL);
    await coordinator.company.verifyCode(TEST_CODE, "chrome");
    assert.equal(await coordinator.company.confirm(), "connected");
    assert.equal((await coordinator.settings()).organizationConsent ?? null, null);
  } finally {
    coordinator.engines.dispose();
    s.db.close();
  }
});

test("cancelling a code step needs no server, cancelling a verified connection tells the server", async () => {
  const s = await setup();
  await s.client.requestCode(s.origin, TEST_WORK_EMAIL);
  await s.client.cancel();
  assert.equal(await s.client.pending(), undefined);
  assert.equal(s.calls.length, 1);
  await s.client.requestCode(s.origin, TEST_WORK_EMAIL);
  await s.client.verifyCode(TEST_CODE, "chrome");
  await s.client.cancel();
  const cancel = s.calls.at(-1)!;
  assert.ok(cancel.url.endsWith("/v1/connections/cancel"));
  assert.equal(cancel.body.connection_id, "connection");
  assert.equal(await s.client.pending(), undefined);
  s.db.close();
});
test("a refused connection step replies with the words, and with the technical detail only for a failure on the way", () => {
  const refused = Object.assign(new Error("auth_reconnect_required"), {
    status: 401,
    serverCode: "otp_invalid_or_expired",
  });
  assert.deepEqual(connectFailureReply(refused), {
    ok: false,
    code: "otp_invalid_or_expired",
    error: "The code is wrong or has expired. Check the latest email, or send a new code.",
  });
  const unreachable = connectFailureReply(new TypeError("Failed to fetch"));
  assert.equal(unreachable?.code, "connect_failed");
  assert.equal(unreachable?.detail, "TypeError: Failed to fetch");
  assert.equal(connectFailureReply(new Error("ledger_integrity_failed")), null);
});
test("the dashboard shows a connection in progress and then the organization's name", async () => {
  const s = await setup();
  const coordinator = schemaCoordinator(s);
  try {
    await coordinator.company.requestCode(s.origin, TEST_WORK_EMAIL);
    let view = await coordinator.dashboard({});
    assert.equal(view.pending?.state, "code_sent");
    assert.equal(view.pending?.email, TEST_WORK_EMAIL);
    assert.equal("challenge_id" in view.pending!, false, "only what the dialog shows leaves the background");
    await coordinator.company.verifyCode(TEST_CODE, "chrome");
    view = await coordinator.dashboard({});
    assert.equal(view.pending?.state, "verified");
    assert.equal(view.pending?.company_name, TEST_COMPANY_NAME);
    assert.equal("email" in view.pending!, false);
    await coordinator.company.confirm();
    view = await coordinator.dashboard({});
    assert.equal(view.pending, null);
    assert.equal(view.company?.company_name, TEST_COMPANY_NAME);
  } finally {
    coordinator.engines.dispose();
    s.db.close();
  }
});
/**
 * An organization server that keeps the identity rules of ingest_record in
 * apps/server/aift/analytics.py: once a revision of a record carried a provider key or a
 * company key, a later revision that names another is refused as a conflict, and the
 * server keeps the figures it had.
 */
function identityServer(transport: typeof fetch) {
  const stored = new Map<
    string,
    { stable: string | null; companyKey: string | null; record: any }
  >();
  const refused: string[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const answer = await transport(input, init);
    if (!String(input).endsWith("/v1/usage/batches")) return answer;
    const body = JSON.parse(String(init!.body));
    const keys = new Map<string, string>(
      (body.company_dedup_keys ?? []).map((e: any) => [
        `${e.kind}:${e.record_id}`,
        e.company_dedup_key,
      ]),
    );
    const results = [];
    for (const r of body.records) {
      const id = r.kind === "request" ? r.request_id : r.attempt_id;
      const name = `${r.kind}:${id}`;
      const stable =
        r.kind === "request" ? r.provider_request_key : r.provider_attempt_key;
      const companyKey = keys.get(name) ?? null;
      const old = stored.get(name);
      const result = (status: string, version: number) => ({
        kind: r.kind,
        record_id: id,
        revision: r.revision,
        server_record_version: version,
        payload_hash: "",
        status,
      });
      if (
        old &&
        (r.revision <= old.record.revision ||
          (old.stable !== null && old.stable !== stable) ||
          (old.companyKey !== null &&
            companyKey !== null &&
            old.companyKey !== companyKey))
      ) {
        refused.push(`${name}:${r.revision}`);
        results.push({
          ...result("conflict", old.record.revision),
          payload_hash: await digest(r),
        });
        continue;
      }
      stored.set(name, {
        stable,
        companyKey: old?.companyKey ?? companyKey,
        record: r,
      });
      results.push({
        ...result("applied", r.revision),
        payload_hash: await digest(r),
      });
    }
    return new Response(JSON.stringify({ batch_id: body.batch_id, results }), {
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { fetcher, stored, refused };
}

/**
 * ChatGPT replies as the live stream sends them since 6 Oct 2026: two thoughts messages
 * (slots 0 and 1) before the answer (slot 2), captured in organization mode. A slow reply
 * is uploaded by the regular sync while it still thinks and again while it answers.
 */
async function organizationChatgptReplies(
  replies: Array<{ answer: string; slow?: boolean }>,
) {
  const s = await setup();
  (s.credentials as any).company_dedup_key = COMPANY_KEY;
  const server = identityServer(s.transport);
  assert.equal(await connectCompany(s.client, s.origin, "chrome"), "connected");
  const coordinator = new Coordinator(s.db, {
    estimation: archivedEstimation,
    hasConsent: async () => true,
    count: countByTextLength,
    sendDisplay: async () => {},
    transport: server.fetcher,
  });
  const chat = crypto.randomUUID();
  const assistant = (
    id: string,
    content: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    author: { role: "assistant" },
    content,
    status: "finished_successfully",
    end_turn: false,
    recipient: "all",
    channel: null,
    metadata: { model_slug: "gpt-5-5-thinking" },
    ...extra,
  });
  const thoughts = (...items: unknown[]) => ({
    content_type: "thoughts",
    thoughts: items,
    source_analysis_msg_id: "analysis",
  });
  try {
    await coordinator.whenReady();
    assert.equal((await coordinator.currentScope()).mode, "company");
    let parent = "client-created-root";
    for (const [index, reply] of replies.entries()) {
      const first = index === 0;
      const id = crypto.randomUUID();
      const prompt = crypto.randomUUID();
      const answerId = `answer-${index}`;
      // A new chat has no address until its stream names the chat.
      const sender = {
        tab: { id: 52 },
        frameId: 0,
        documentId: "organization-chatgpt-final",
        url: first ? "https://chatgpt.com/" : `https://chatgpt.com/c/${chat}`,
      };
      const binding = {
        documentNonce: "00000000-0000-4000-8000-0000000000b1",
        navigationNonce: "00000000-0000-4000-8000-0000000000b2",
        captureId: id,
      };
      const common = {
        channel: "ai-footprint-observation-v1",
        version: 1,
        id,
        site: "chatgpt",
        at: new Date().toISOString(),
        failure: null,
        timing: null,
      };
      await coordinator.capture(
        {
          ...common,
          event: "dispatch",
          revision: 1,
          dispatch: parseDispatch(
            "chatgpt",
            new URL("https://chatgpt.com/backend-api/f/conversation"),
            JSON.stringify({
              action: "next",
              ...(first ? {} : { conversation_id: chat }),
              parent_message_id: parent,
              model: "gpt-5-5-thinking",
              messages: [
                {
                  id: prompt,
                  author: { role: "user" },
                  content: {
                    content_type: "text",
                    parts: [`Synthetic question ${index}`],
                  },
                },
              ],
            }),
          ),
          snapshot: initialSnapshot(),
        } as any,
        sender,
        binding,
      );
      const session = new ChatgptSession();
      const delta = (value: any) =>
        session.frame({ event: "delta", data: "", value });
      session.frame({ event: "delta_encoding", data: "", value: "v1" });
      delta({
        p: "",
        o: "add",
        c: 0,
        v: {
          message: assistant(`t0-${index}`, thoughts()),
          conversation_id: chat,
        },
      });
      delta({
        c: 1,
        v: {
          message: assistant(
            `t1-${index}`,
            thoughts({ summary: "", content: "Weighing", finished: false }),
            { status: "in_progress" },
          ),
          conversation_id: chat,
        },
      });
      let revision = 2;
      const progress = async (event: "progress" | "end") =>
        coordinator.capture(
          {
            ...common,
            event,
            revision: revision++,
            dispatch: null,
            snapshot: session.snapshot(),
          } as any,
          sender,
          binding,
        );
      // The first frame shows only the thoughts.
      await progress("progress");
      if (reply.slow) {
        await coordinator.settleConversationDisplays();
        await coordinator.company.sync();
      }
      delta({
        c: 1,
        o: "patch",
        v: [
          { p: "/message/content/thoughts/0/summary", o: "replace", v: "Plan" },
          { p: "/message/content/thoughts/0/finished", o: "replace", v: true },
          { p: "/message/status", o: "replace", v: "finished_successfully" },
        ],
      });
      delta({
        c: 2,
        o: "add",
        p: "",
        v: {
          message: assistant(
            answerId,
            { content_type: "text", parts: [""] },
            {
              channel: "final",
              status: "in_progress",
            },
          ),
          conversation_id: chat,
        },
      });
      const words = reply.answer.split(" ");
      delta({
        c: 2,
        o: "patch",
        v: [{ p: "/message/content/parts/0", o: "append", v: words[0] }],
      });
      await progress("progress");
      if (reply.slow) {
        await coordinator.settleConversationDisplays();
        await coordinator.company.sync();
      }
      delta({
        c: 2,
        o: "patch",
        v: [
          {
            p: "/message/content/parts/0",
            o: "append",
            v: " " + words.slice(1).join(" "),
          },
        ],
      });
      delta({
        v: [
          { p: "/message/status", o: "replace", v: "finished_successfully" },
          { p: "/message/end_turn", o: "replace", v: true },
        ],
      });
      session.frame({
        event: "message",
        data: "",
        value: { type: "message_stream_complete", conversation_id: chat },
      });
      assert.equal(session.snapshot().state, "completed");
      await progress("end");
      await coordinator.settleConversationDisplays();
      parent = answerId;
    }
    await coordinator.company.sync();
    const local = (await s.db.rows(s.credentials.namespace)).map(
      (row) => row.record,
    );
    return {
      server,
      local,
      pending: await s.db.pendingCount(s.credentials.namespace),
    };
  } finally {
    await coordinator.settleConversationDisplays();
    coordinator.engines.dispose();
    s.db.close();
  }
}

test("organization uploads of ChatGPT replies that think first end with each reply's final figures (14 Oct)", async () => {
  // Live on 14 Oct 2026: a new chat's first prompt, a follow-up and a slow third reply.
  // The bar showed 14, 10 and 8 tokens out; the server kept 1, 1 and 0, the figures of
  // each reply's first thoughts, because a later revision named the reply by its answer.
  const { server, local, pending } = await organizationChatgptReplies([
    { answer: "Synthetic first answer with a few more words." },
    { answer: "Synthetic follow-up answer." },
    { answer: "Synthetic slow answer that took a while.", slow: true },
  ]);
  assert.deepEqual(server.refused, []);
  // Nothing waits in the outbox, not even a quarantined revision.
  assert.equal(pending, 0);
  const attempts = local.filter((r) => r.kind === "attempt");
  assert.equal(attempts.length, 3);
  for (const attempt of attempts) {
    if (attempt.kind !== "attempt") throw new Error("attempt expected");
    const kept = server.stored.get(`attempt:${attempt.attempt_id}`);
    assert.ok(kept, "reply uploaded");
    // The server holds the reply's last revision, the one the bar shows.
    assert.deepEqual(kept.record, attempt);
    assert.equal(attempt.state, "completed");
    assert.ok(Number(attempt.tokens.answer_output.value) > 1);
    assert.notEqual(attempt.provider_attempt_key, null);
  }
  // Each reply is named by its answer, as its saved copy is, also for the organization.
  assert.deepEqual(
    new Set(
      attempts.map(
        (a) =>
          server.stored.get(`attempt:${(a as any).attempt_id}`)?.companyKey,
      ),
    ),
    new Set(
      await Promise.all(
        [0, 1, 2].map((index) =>
          hmacIdentity(
            COMPANY_KEY,
            "chatgpt",
            "company-attempt",
            `answer-${index}`,
          ),
        ),
      ),
    ),
  );
  for (const request of local.filter((r) => r.kind === "request"))
    assert.deepEqual(
      server.stored.get(`request:${(request as any).request_id}`)?.record,
      request,
    );
});

test("a revision the organization server refused is reported once as refused, never as waiting to sync (14 Oct)", async () => {
  const s = await setup();
  // The server applies the first revision of the reply and refuses the second for good.
  const refusing = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const answer = await s.transport(input, init);
    if (!String(input).endsWith("/v1/usage/batches")) return answer;
    const body = await answer.json();
    return new Response(
      JSON.stringify({
        ...body,
        results: body.results.map((r: any) =>
          r.kind === "attempt" && r.revision === 2
            ? {
                ...r,
                status: "conflict",
                error_code: "immutable_identity",
                server_record_version: 1,
              }
            : r,
        ),
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  const coordinator = new Coordinator(s.db, {
    hasConsent: async () => true,
    count: unavailableCount,
    sendDisplay: async () => {},
    transport: refusing,
  });
  try {
    assert.equal(
      await connectCompany(coordinator.company, s.origin, "chrome"),
      "connected",
    );
    const scope = {
      namespace: s.credentials.namespace,
      mode: "company" as const,
      era: s.credentials.enrollment_era.id,
    };
    const [request, attempt] = records();
    await s.db.application.commitCapture({
      scope,
      observations: [request, attempt],
    });
    await s.db.application.commitCapture({
      scope,
      observations: [{ ...attempt, revision: 2 }],
    });
    assert.equal(await s.db.pendingCount(scope.namespace), 3);
    await coordinator.company.sync();
    // Nothing waits: the refused revision is never sent again.
    assert.equal(await s.db.pendingCount(scope.namespace), 0);
    assert.equal(await s.db.refusedCount(scope.namespace), 1);
    assert.equal(
      await s.db.application.pendingRevision(
        scope.namespace,
        "attempt",
        attempt.attempt_id,
        2,
      ),
      false,
    );
    const view = await coordinator.dashboard({});
    assert.equal(view.queueCount, 0);
    assert.equal(view.refusedCount, 1);
    // Reported once, as a sync problem with its own plain explanation on the Tracking page.
    assert.deepEqual(
      view.health
        .filter((issue: any) => issue.code === "revision_conflict")
        .map((issue: any) => issue.count),
      [1],
    );
  } finally {
    coordinator.engines.dispose();
    s.db.close();
  }
});

// Owner decision of 16 October 2026, evening: a record the server refused stays open after the
// upload that refused it, and closes once a later upload works.
test("a refused record stays an open problem after its own upload and closes after the next working sync", async () => {
  const s = await setup();
  const refusing = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const answer = await s.transport(input, init);
    if (!String(input).endsWith("/v1/usage/batches")) return answer;
    const body = await answer.json();
    return new Response(
      JSON.stringify({
        ...body,
        results: body.results.map((r: any) =>
          r.kind === "attempt" ? { ...r, status: "rejected", error_code: "payload_rejected" } : r,
        ),
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  const coordinator = new Coordinator(s.db, {
    hasConsent: async () => true,
    count: unavailableCount,
    sendDisplay: async () => {},
    transport: refusing,
  });
  try {
    assert.equal(await connectCompany(coordinator.company, s.origin, "chrome"), "connected");
    const scope = {
      namespace: s.credentials.namespace,
      mode: "company" as const,
      era: s.credentials.enrollment_era.id,
    };
    const [request, attempt] = records();
    await s.db.application.commitCapture({ scope, observations: [request, attempt] });
    await coordinator.company.sync();
    const state = async () =>
      (await coordinator.dashboard({})).health
        .filter((issue: any) => issue.code === "payload_rejected")
        .map((issue: any) => issue.state);
    assert.deepEqual(await state(), ["unresolved"], "the upload that refused it does not close it");
    await coordinator.company.sync();
    assert.deepEqual(await state(), ["resolved"], "a later working sync closes it");
  } finally {
    coordinator.engines.dispose();
    s.db.close();
  }
});
