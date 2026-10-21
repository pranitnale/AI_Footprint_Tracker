import test from "node:test";
import assert from "node:assert/strict";
import {
  createMemoryRepository,
  methodTrustIdentity,
  type ApplicationRepository,
  type Scope,
  type StoredCredentials,
  type StoredMethodCatalog,
} from "@footprint/ledger";
import {
  canonicalJson,
  parseUsageBatch,
  payloadHash,
} from "@footprint/contracts";
import {
  BASELINE_BUNDLE,
  BASELINE_METHOD_ID,
  estimateAttempt,
  type MethodBundle,
  type SignedMethodUpdate,
} from "@footprint/estimator";
import { CompanyClient } from "../lib/company";
import {
  codeSent,
  connectCompany,
  TEST_CODE,
  TEST_COMPANY_NAME,
  TEST_WORK_EMAIL,
  verifiedConnection,
} from "./connect-fixture";
import { MethodService } from "../lib/method-service";
import { hmacIdentity } from "../lib/ownership";
import { records } from "../../../packages/ledger/test/factory";

const origin = "https://company.example";
const routingSecret = "a".repeat(64);
const personal = {
  namespace: "personal:repository-test",
  secret: "b".repeat(64),
};
const personalScope: Scope = {
  namespace: personal.namespace,
  mode: "personal",
  era: null,
};
const json = (value: unknown) => new Response(JSON.stringify(value));

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function transport(
  handle: (path: string, init: RequestInit) => Promise<Response> | Response,
): typeof fetch {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    assert.equal(url.origin, origin);
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "error");
    return handle(url.pathname, init);
  };
}

function credentials(now = Date.now()): StoredCredentials {
  const company_id = crypto.randomUUID(),
    user_id = crypto.randomUUID();
  return {
    origin,
    namespace: `company:${company_id}:${user_id}`,
    company_id,
    user_id,
    device_id: crypto.randomUUID(),
    access_token: "test-access",
    refresh_token: "test-refresh",
    access_expires_at: new Date(now + 600_000).toISOString(),
    refresh_expires_at: new Date(now + 86_400_000).toISOString(),
    installation_reconnect_secret: "test-reconnect",
    deletion_receipt_credential: "test-deletion-receipt",
    key_version: "1",
    user_hmac_key: "c".repeat(64),
    policy: {
      policy_version: "1.0.0",
      disclosure_version: "1.0.0",
      pause_mode: "user_controlled",
      usage_retention_months: null,
      timezone: "UTC",
      ip_retention_days: 0,
      deletion_epoch: 0,
    },
    enrollment_era: {
      id: crypto.randomUUID(),
      start: new Date(now - 60_000).toISOString(),
      end: null,
    },
    deletion_public_key: "public-key-pinned-by-start",
    method_public_key: null,
  };
}

function scopeOf(c: StoredCredentials): Scope {
  return { namespace: c.namespace, mode: "company", era: c.enrollment_era.id };
}

async function seedPersonal(repository: ApplicationRepository) {
  await repository.applySessionChanges({
    personal,
    installation: { routingSecret },
    ownershipHistory: {
      eras: [
        {
          scope: personalScope,
          secret: personal.secret,
          policyVersion: "1.0.0",
          start: 0,
          end: null,
        },
      ],
    },
  });
}

async function seedCompany(
  repository: ApplicationRepository,
  c: StoredCredentials,
) {
  await seedPersonal(repository);
  const start = Date.parse(c.enrollment_era.start);
  await repository.applySessionChanges(
    {
      credentials: c,
      ownershipHistory: {
        eras: [
          {
            scope: personalScope,
            secret: personal.secret,
            policyVersion: "1.0.0",
            start: 0,
            end: start,
          },
          {
            scope: scopeOf(c),
            secret: c.user_hmac_key,
            policyVersion: c.policy.policy_version,
            start,
            end: null,
          },
        ],
      },
    },
    { deviceId: null },
  );
}

test("company enrollment and disconnect commit coherent routing through the memory repository", async () => {
  const repository = createMemoryRepository();
  await seedPersonal(repository);
  const c = credentials();
  const routes: string[] = [];
  const client = new CompanyClient(
    repository,
    transport((path, init) => {
      routes.push(path);
      if (path === "/v1/connections/otp/request") return json(codeSent());
      if (path === "/v1/connections") {
        const body = JSON.parse(String(init.body));
        assert.equal(body.challenge_method, "S256");
        assert.match(body.verifier_challenge, /^[a-f0-9]{64}$/);
        return json(verifiedConnection(origin, c.deletion_public_key));
      }
      if (path === "/v1/connections/exchange")
        return json({ ...c, deletion_public_key: "untrusted-exchange-key" });
      if (path === "/v1/connections/disconnect") {
        assert.equal(
          new Headers(init.headers).get("Authorization"),
          `Bearer ${c.access_token}`,
        );
        return json({ ok: true });
      }
      throw new Error(`Unexpected endpoint: ${path}`);
    }),
  );
  const snapshots: Array<ReturnType<ApplicationRepository["routingSnapshot"]>> =
    [];
  const unsubscribe = repository.onRoutingChange(() => {
    snapshots.push(repository.routingSnapshot());
  });
  try {
    await client.requestCode(origin, TEST_WORK_EMAIL);
    const pending = await client.verifyCode(TEST_CODE, "chrome");
    assert.equal("key" in pending, false);
    assert.equal(await client.confirm(), "connected");
    // A server that hands out no company key leaves it null (W11). The deletion key is the one
    // the verified connection named, not the exchange's.
    assert.deepEqual(await client.credentials(), {
      ...c,
      company_dedup_key: null,
      company_name: TEST_COMPANY_NAME,
    });
    assert.equal(await client.pending(), undefined);
    assert.equal(snapshots.length, 1);
    assert.deepEqual((await snapshots[0]!).ownership?.scope, scopeOf(c));
    assert.deepEqual((await snapshots[0]!).credentials, {
      ...c,
      company_dedup_key: null,
      company_name: TEST_COMPANY_NAME,
    });

    await client.disconnect();
    assert.equal(await client.credentials(), undefined);
    assert.equal(snapshots.length, 2);
    const disconnected = await snapshots[1]!;
    assert.equal(disconnected.credentials, undefined);
    assert.deepEqual(disconnected.ownership?.scope, personalScope);
    const reconnect = await repository.readReconnect(origin);
    assert.equal(reconnect?.device_id, c.device_id);
    assert.equal(reconnect?.disconnect_pending, false);
    assert.equal(reconnect?.access_token, "");
    assert.equal(reconnect?.refresh_token, "");
    assert.equal(
      reconnect?.installation_reconnect_secret,
      c.installation_reconnect_secret,
    );
    assert.deepEqual(routes, [
      "/v1/connections/otp/request",
      "/v1/connections",
      "/v1/connections/exchange",
      "/v1/connections/disconnect",
    ]);
  } finally {
    unsubscribe();
  }
});

test("failed enrollment commit preserves personal ownership and the resumable exchange", async () => {
  let rejectCommit = false;
  const repository = createMemoryRepository({
    beforeCommit(operation) {
      if (rejectCommit && operation === "applySessionChanges") {
        rejectCommit = false;
        throw new Error("injected session commit failure");
      }
    },
  });
  await seedPersonal(repository);
  const before = await repository.routingSnapshot(),
    c = credentials();
  const exchanges: unknown[] = [];
  const client = new CompanyClient(
    repository,
    transport((path, init) => {
      if (path === "/v1/connections/otp/request") return json(codeSent());
      if (path === "/v1/connections")
        return json(verifiedConnection(origin, c.deletion_public_key));
      if (path === "/v1/connections/exchange") {
        exchanges.push(JSON.parse(String(init.body)));
        rejectCommit = exchanges.length === 1;
        return json(c);
      }
      throw new Error(`Unexpected endpoint: ${path}`);
    }),
  );
  let notifications = 0;
  const unsubscribe = repository.onRoutingChange(() => {
    notifications++;
  });
  try {
    await assert.rejects(
      connectCompany(client, origin, "firefox"),
      /injected session commit failure/,
    );
    assert.deepEqual(await repository.routingSnapshot(), before);
    assert.equal(notifications, 0);
    const pending = await client.pending();
    assert.equal(pending?.exchange_started, true);
    // The person already confirmed, so maintenance repeats the same exchange.
    await client.maintenance();
    assert.deepEqual(exchanges[1], exchanges[0]);
    assert.equal(notifications, 1);
    assert.deepEqual(await client.credentials(), {
      ...c,
      company_dedup_key: null,
      company_name: TEST_COMPANY_NAME,
    });
  } finally {
    unsubscribe();
  }
});

test("a delayed refresh cannot overwrite newer credentials for the same device", async () => {
  const repository = createMemoryRepository(),
    c = credentials();
  c.access_expires_at = new Date(Date.now() - 1_000).toISOString();
  await seedCompany(repository, c);
  const started = gate(),
    reply = gate();
  const client = new CompanyClient(
    repository,
    transport(async (path, init) => {
      assert.equal(path, "/v1/auth/refresh");
      assert.equal(
        JSON.parse(String(init.body)).refresh_token,
        c.refresh_token,
      );
      started.release();
      await reply.promise;
      return json({
        ...c,
        access_token: "stale-response-access",
        refresh_token: "stale-response-refresh",
      });
    }),
  );
  const rejected = assert.rejects(
    client.authorized("/v1/me/summary"),
    /auth_reconnect_required/,
  );
  await started.promise;
  const newer = {
    ...c,
    access_token: "newer-access",
    refresh_token: "newer-refresh",
    access_expires_at: new Date(Date.now() + 600_000).toISOString(),
  };
  await repository.applySessionChanges(
    { credentials: newer, refreshOperation: null },
    { deviceId: c.device_id, refreshToken: c.refresh_token },
  );
  reply.release();
  await rejected;
  assert.deepEqual(await client.credentials(), newer);
  assert.equal(await repository.readRefreshOperation(), undefined);
});

for (const status of ["applied", "erased", "stale"] as const) {
  test(`company sync applies ${status} acknowledgements through memory domain operations`, async () => {
    const repository = createMemoryRepository(),
      c = credentials();
    const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ]);
    c.deletion_public_key = Buffer.from(
      await crypto.subtle.exportKey("raw", pair.publicKey),
    ).toString("base64url");
    await seedCompany(repository, c);
    const [request, attempt] = records();
    request.dispatched_at = new Date().toISOString();
    attempt.started_at = request.dispatched_at;
    await repository.capture(scopeOf(c), [request, attempt]);
    assert.equal(await repository.pendingCount(c.namespace), 2);
    const canonical = { ...attempt, revision: 2 };
    let batches = 0,
      deletionAcks = 0;
    const client = new CompanyClient(
      repository,
      transport(async (path, init) => {
        if (path === "/v1/deletions/status") {
          const instruction = {
            company_id: c.company_id,
            device_id: c.device_id,
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
              pair.privateKey,
              new TextEncoder().encode(canonicalJson(instruction)),
            ),
          ).toString("base64url");
          return json({
            instruction,
            signature,
            algorithm: "Ed25519",
            key_version: "1",
          });
        }
        if (path === "/v1/deletions/ack") {
          deletionAcks++;
          return json({ acknowledged_epoch: 0 });
        }
        if (path === "/v1/config") return json({ policy: c.policy });
        if (path === "/v1/health/reports") return json({ ok: true });
        if (path === "/v1/usage/batches") {
          batches++;
          const batch = parseUsageBatch(JSON.parse(String(init.body)));
          assert.equal(batch.records.length, 2);
          return json({
            batch_id: batch.batch_id,
            results: batch.records.map((record) => ({
              kind: record.kind,
              record_id:
                record.kind === "request"
                  ? record.request_id
                  : record.attempt_id,
              revision: record.revision,
              server_record_version:
                status === "stale" && record.kind === "attempt"
                  ? 2
                  : record.revision,
              payload_hash: payloadHash(record),
              status:
                status === "stale" && record.kind === "request"
                  ? "applied"
                  : status,
            })),
          });
        }
        if (path === `/v1/usage/records/attempt/${attempt.attempt_id}`)
          return json({
            record: canonical,
            payload_hash: payloadHash(canonical),
          });
        throw new Error(`Unexpected endpoint: ${path}`);
      }),
    );
    const recalculated: unknown[] = [];
    client.canonicalEstimation = async (scope, record) => {
      assert.deepEqual(scope, scopeOf(c));
      assert.equal(
        (await repository.getRecord(c.namespace, "attempt", attempt.attempt_id))
          ?.hash,
        payloadHash(record),
      );
      recalculated.push(record);
    };
    await client.sync();
    assert.equal(deletionAcks, 1);
    assert.equal(batches, 1);
    assert.equal(await repository.pendingCount(c.namespace), 0);
    assert.deepEqual(await repository.readDeletionEpoch(c.device_id), {
      epoch: 0,
    });
    assert.equal(
      (await repository.readDeletionReceipt(c.device_id))
        ?.deletion_receipt_credential,
      c.deletion_receipt_credential,
    );
    if (status === "erased") {
      assert.equal(
        await repository.getRecord(c.namespace, "request", request.request_id),
        undefined,
      );
      assert.equal(
        await repository.getRecord(c.namespace, "attempt", attempt.attempt_id),
        undefined,
      );
      await assert.rejects(
        repository.capture(scopeOf(c), [request, attempt]),
        /record_erased/,
      );
    } else {
      assert.equal(
        (await repository.getRecord(c.namespace, "request", request.request_id))
          ?.hash,
        payloadHash(request),
      );
      assert.equal(
        (await repository.getRecord(c.namespace, "attempt", attempt.attempt_id))
          ?.hash,
        payloadHash(status === "stale" ? canonical : attempt),
      );
    }
    assert.deepEqual(recalculated, status === "stale" ? [canonical] : []);
  });
}

async function signedMethod(
  now: number,
  id = "repository-signed-v1",
  pair?: CryptoKeyPair,
) {
  pair ??= await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const publicKey = Buffer.from(
    await crypto.subtle.exportKey("spki", pair.publicKey),
  ).toString("base64");
  const bundle = structuredClone(BASELINE_BUNDLE) as MethodBundle;
  bundle.method_id = id;
  bundle.coefficients.energyAlpha = "0.2";
  const envelope: SignedMethodUpdate = {
    bundle,
    bundle_hash: payloadHash(bundle),
    issued_at: new Date(now).toISOString(),
    expires_at: new Date(now + 600_000).toISOString(),
    signature: "",
  };
  envelope.signature = Buffer.from(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      pair.privateKey,
      new TextEncoder().encode(
        canonicalJson({
          bundle_hash: envelope.bundle_hash,
          issued_at: envelope.issued_at,
          expires_at: envelope.expires_at,
        }),
      ),
    ),
  ).toString("base64");
  const fingerprint = Buffer.from(
    await crypto.subtle.digest("SHA-256", Buffer.from(publicKey, "base64")),
  ).toString("hex");
  return { envelope, publicKey, fingerprint, pair };
}

function methodClient(
  repository: ApplicationRepository,
  signed: Awaited<ReturnType<typeof signedMethod>>,
  download?: () => Promise<void>,
) {
  return new CompanyClient(
    repository,
    transport(async (path, init) => {
      assert.equal(
        new Headers(init.headers).get("Authorization"),
        "Bearer test-access",
      );
      const envelope = signed.envelope,
        id = (envelope.bundle as MethodBundle).method_id;
      if (path === "/v1/me/method-updates")
        return json({
          delivery_status: "available",
          trust_fingerprint: signed.fingerprint,
          methods: [
            {
              method_id: id,
              method_hash: envelope.bundle_hash,
              issued_at: envelope.issued_at,
              expires_at: envelope.expires_at,
            },
          ],
        });
      if (path === `/v1/me/method-updates/${id}`) {
        await download?.();
        return json(envelope);
      }
      throw new Error(`Unexpected endpoint: ${path}`);
    }),
  );
}

async function catalogGuard(
  repository: ApplicationRepository,
  namespace: string,
) {
  const snapshot = await repository.publicationSnapshot(namespace);
  return {
    trust: methodTrustIdentity(snapshot),
    erasureVersion: snapshot.erasureVersion,
    ownershipStart: snapshot.ownership?.start ?? null,
    previousHash:
      (await repository.readMethodCatalog(namespace))?.revision ?? null,
  };
}

test("MethodService admits and seals signed methods, reloads them, and rejects a corrupted seal", async () => {
  const now = Date.now(),
    signed = await signedMethod(now),
    c = credentials(now);
  c.method_public_key = signed.publicKey;
  const repository = createMemoryRepository();
  await seedCompany(repository, c);
  const company = methodClient(repository, signed);
  const service = new MethodService(
    repository,
    company,
    async () => scopeOf(c),
    () => now,
  );
  assert.equal((await service.status()).state, "baseline_only");
  const status = await service.refresh(true);
  assert.equal(status.state, "current");
  assert.equal(status.reason, null);
  assert.deepEqual(
    status.methods.map((entry) => [entry.id, entry.source]),
    [
      [BASELINE_METHOD_ID, "packaged"],
      ["repository-signed-v1", "enrollment"],
    ],
  );
  const saved = await repository.readMethodCatalog(c.namespace);
  assert.ok(saved);
  const { seal, ...payload } = saved.catalog;
  assert.equal(
    seal,
    await hmacIdentity(
      routingSecret,
      "methods",
      "catalog",
      repository.methodCatalogDigest(payload),
    ),
  );
  assert.deepEqual(saved.catalog.records[0]?.envelope, signed.envelope);
  const reloaded = new MethodService(
    repository,
    company,
    async () => scopeOf(c),
    () => now,
  );
  assert.deepEqual(await reloaded.status(), status);
  const selected = await reloaded.selection(scopeOf(c), "repository-signed-v1");
  assert.equal(selected.methodHash, signed.envelope.bundle_hash);
  const [, attempt] = records();
  attempt.proposed_method_id = BASELINE_METHOD_ID;
  const original = estimateAttempt(attempt);
  const recalculated = selected.estimate(attempt, original);
  assert.equal(recalculated.method_hash, signed.envelope.bundle_hash);
  assert.equal(recalculated.original_method_hash, original.method_hash);

  const corrupted: StoredMethodCatalog = {
    ...saved.catalog,
    seal: "0".repeat(64),
  };
  await repository.commitMethodCatalog(
    c.namespace,
    corrupted,
    await catalogGuard(repository, c.namespace),
    () => true,
  );
  const invalid = await reloaded.status();
  assert.equal(invalid.state, "failed");
  assert.equal(invalid.reason, "stored_method_invalid");
  assert.deepEqual(
    invalid.methods.map((entry) => entry.id),
    [BASELINE_METHOD_ID],
  );
  await assert.rejects(
    reloaded.selection(scopeOf(c), "repository-signed-v1"),
    /method_update_invalid/,
  );
});

test("a late signed catalog download cannot overwrite a newer catalog committed by another service", async () => {
  const now = Date.now(),
    slow = await signedMethod(now, "slow-repository-v1");
  const winner = await signedMethod(now, "winner-repository-v1", slow.pair);
  const c = credentials(now);
  c.method_public_key = slow.publicKey;
  const repository = createMemoryRepository();
  await seedCompany(repository, c);
  const started = gate(),
    reply = gate();
  const delayed = new MethodService(
    repository,
    methodClient(repository, slow, async () => {
      started.release();
      await reply.promise;
    }),
    async () => scopeOf(c),
    () => now,
  );
  const current = new MethodService(
    repository,
    methodClient(repository, winner),
    async () => scopeOf(c),
    () => now,
  );
  const waiting = delayed.refresh(true);
  await started.promise;
  assert.equal((await current.refresh(true)).state, "current");
  const committed = await repository.readMethodCatalog(c.namespace);
  assert.ok(committed);
  reply.release();
  await waiting;
  assert.deepEqual(await repository.readMethodCatalog(c.namespace), committed);
  assert.deepEqual(
    (await current.status()).methods.map((entry) => entry.id),
    [BASELINE_METHOD_ID, "winner-repository-v1"],
  );
  await assert.rejects(
    current.selection(scopeOf(c), "slow-repository-v1"),
    /method_unsupported/,
  );
});
