import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { canonicalJson, payloadHash } from "@footprint/contracts";
import { Ledger, methodTrustIdentity } from "../src/index";
import { createIndexedDbSessionRepositories } from "../src/indexeddb-session";
import type {
  HealthRepository,
  MethodCatalogRepository,
  SessionChanges,
  SessionStateRepository,
  StoredCredentials,
  StoredMethodCatalogPayload,
  StoredOwnershipHistory,
  StoredPersonal,
} from "../src/session-contracts";

const personal: StoredPersonal = {
  namespace: "personal:session-test",
  secret: "personal-test-secret",
};
const personalHistory: StoredOwnershipHistory = {
  eras: [
    {
      scope: { namespace: personal.namespace, mode: "personal", era: null },
      secret: personal.secret,
      policyVersion: "1.0.0",
      start: 0,
      end: null,
    },
  ],
};
const credentials: StoredCredentials = {
  origin: "https://company.example",
  namespace: "company:session-test",
  access_token: "synthetic-access-token",
  refresh_token: "synthetic-refresh-token",
  access_expires_at: "2026-09-15T13:00:00.000Z",
  refresh_expires_at: "2026-10-15T13:00:00.000Z",
  company_id: "company-test",
  user_id: "user-test",
  device_id: "device-test",
  installation_reconnect_secret: "synthetic-reconnect-secret",
  deletion_receipt_credential: "synthetic-receipt-secret",
  key_version: "1",
  user_hmac_key: "synthetic-hmac-key",
  policy: {
    policy_version: "1.0.0",
    disclosure_version: "1.0.0",
    pause_mode: "user_controlled",
    usage_retention_months: 6,
    timezone: "Europe/Berlin",
    ip_retention_days: 30,
    deletion_epoch: 0,
  },
  enrollment_era: {
    id: "era-test",
    start: "2026-09-15T12:00:00.000Z",
    end: null,
  },
  deletion_public_key: "synthetic-deletion-key",
  method_public_key: "synthetic-method-key",
  enrollment_state: "active",
};
const enrolledHistory: StoredOwnershipHistory = {
  eras: [
    { ...personalHistory.eras[0], end: 1 },
    {
      scope: {
        namespace: credentials.namespace,
        mode: "company",
        era: credentials.enrollment_era.id,
      },
      secret: credentials.user_hmac_key,
      policyVersion: credentials.policy.policy_version,
      start: 1,
      end: null,
    },
  ],
};

async function open(t: TestContext) {
  const ledger = await Ledger.open(`session-contracts-${crypto.randomUUID()}`);
  t.after(() => ledger.close());
  return { ledger, repositories: createIndexedDbSessionRepositories(ledger) };
}

// These checks compile against domain capabilities without referring to a database implementation.
function portableContractChecks(
  session: SessionStateRepository,
  health: HealthRepository,
  catalogs: MethodCatalogRepository,
) {
  const transition: SessionChanges = {
    credentials,
    ownershipHistory: enrolledHistory,
    pendingConnection: null,
  };
  const result: Promise<void> = session.applySessionChanges(transition, {
    deviceId: null,
  });
  const report: Promise<void> = health.health(
    personal.namespace,
    "sync_delayed",
  );
  const catalogRead = catalogs.readMethodCatalog(credentials.namespace);
  // @ts-expect-error Domain session ports cannot read arbitrary storage records.
  session.get("arbitrary", "identifier");
  // @ts-expect-error The command cannot carry arbitrary table mutations.
  const arbitrary: SessionChanges = { put: [] };
  // @ts-expect-error Credential DTOs do not carry a physical storage identifier.
  const keyed: StoredCredentials = { ...credentials, key: "arbitrary" };
  return [result, report, catalogRead, arbitrary, keyed];
}

test("session DTOs expose named portable capabilities and omit physical identifiers", async (t) => {
  void portableContractChecks;
  const { repositories } = await open(t);
  assert.equal(await repositories.readPersonal(), undefined);
  assert.equal(await repositories.readCredentials(), undefined);
  assert.deepEqual(await repositories.routingSnapshot(), {
    credentials: undefined,
    personal: undefined,
    ownership: null,
  });
  await repositories.applySessionChanges({
    personal,
    installation: { routingSecret: "synthetic-routing-secret" },
    settings: { paused: false, budget: null, timezone: "Europe/Berlin" },
    ownershipHistory: personalHistory,
  });
  assert.deepEqual(await repositories.readPersonal(), personal);
  assert.deepEqual(await repositories.readInstallation(), {
    routingSecret: "synthetic-routing-secret",
  });
  assert.deepEqual(await repositories.readSettings(), {
    paused: false,
    budget: null,
    timezone: "Europe/Berlin",
  });
  assert.deepEqual(await repositories.readOwnershipHistory(), personalHistory);
  const read = (await repositories.readOwnershipHistory())!;
  read.eras[0].secret = "changed only by reader";
  assert.deepEqual(await repositories.readOwnershipHistory(), personalHistory);
  assert.equal(
    Object.hasOwn((await repositories.readPersonal())!, "key"),
    false,
  );
});

test("guarded enrollment commits credentials and ownership together and stale guards preserve all state", async (t) => {
  const { ledger, repositories } = await open(t);
  await repositories.applySessionChanges({
    personal,
    ownershipHistory: personalHistory,
    pendingConnection: {
      origin: credentials.origin,
      verifier: "synthetic-verifier",
      operation_id: "operation-test",
      exchange_id: "exchange-test",
    },
    refreshOperation: { id: "refresh-test" },
  });
  let notifications = 0;
  const stop = repositories.onRoutingChange(() => notifications++);
  t.after(stop);
  const changes: SessionChanges = {
    credentials: structuredClone(credentials),
    ownershipHistory: structuredClone(enrolledHistory),
    pendingConnection: null,
    refreshOperation: null,
  };
  const saving = repositories.applySessionChanges(changes, { deviceId: null });
  changes.credentials!.refresh_token = "caller mutation after dispatch";
  await saving;
  assert.equal(notifications, 1);
  assert.deepEqual(await repositories.readCredentials(), credentials);
  assert.deepEqual(await repositories.readOwnershipHistory(), enrolledHistory);
  assert.equal(await repositories.readPendingConnection(), undefined);
  assert.equal(await repositories.readRefreshOperation(), undefined);
  assert.deepEqual(await repositories.routingSnapshot(), {
    credentials,
    personal,
    ownership: enrolledHistory.eras.at(-1),
  });

  const before = canonicalJson(await ledger.all("policy"));
  for (const guard of [
    { deviceId: null },
    { deviceId: credentials.device_id, refreshToken: "stale-token" },
  ]) {
    await assert.rejects(
      repositories.applySessionChanges(
        {
          credentials: null,
          ownershipHistory: personalHistory,
          personal: { ...personal, secret: "must not be saved" },
          refreshOperation: { id: "must not be saved" },
        },
        guard,
      ),
      /auth_reconnect_required/,
    );
    assert.equal(canonicalJson(await ledger.all("policy")), before);
    assert.equal(notifications, 1);
  }
  await repositories.applySessionChanges(
    {
      credentials: null,
      ownershipHistory: personalHistory,
      reconnects: [
        {
          origin: credentials.origin,
          value: {
            ...credentials,
            disconnect_pending: true,
            disconnect_operation_id: "disconnect-test",
          },
        },
      ],
    },
    {
      deviceId: credentials.device_id,
      refreshToken: credentials.refresh_token,
    },
  );
  assert.equal(await repositories.readCredentials(), undefined);
  assert.deepEqual(await repositories.readOwnershipHistory(), personalHistory);
  assert.equal(
    (await repositories.readReconnect(credentials.origin))?.disconnect_pending,
    true,
  );
  assert.equal(notifications, 2);
});

test("named maintenance and deletion bookkeeping round-trip without exposing other session records", async (t) => {
  const { repositories } = await open(t);
  const receipt = {
    origin: credentials.origin,
    company_id: credentials.company_id,
    user_id: credentials.user_id,
    device_id: credentials.device_id,
    deletion_receipt_credential: credentials.deletion_receipt_credential,
    deletion_public_key: credentials.deletion_public_key,
    namespace: credentials.namespace,
    enrollment_era: credentials.enrollment_era,
  };
  await repositories.applySessionChanges({
    credentials,
    personal,
    settings: { paused: false, budget: null, timezone: "UTC" },
    pendingPolicy: {
      device_id: credentials.device_id,
      offered_at: 10,
      policy: credentials.policy,
    },
    deletionEpochs: [{ deviceId: credentials.device_id, value: { epoch: 3 } }],
    deletionReceipts: [{ deviceId: credentials.device_id, value: receipt }],
  });
  assert.deepEqual(
    await repositories.readDeletionEpoch(credentials.device_id),
    { epoch: 3 },
  );
  assert.deepEqual(
    await repositories.readDeletionReceipt(credentials.device_id),
    receipt,
  );
  assert.equal((await repositories.readPendingPolicy())?.offered_at, 10);
  assert.deepEqual(await repositories.listSessionMaintenance(), [
    { kind: "active", session: credentials },
    { kind: "deletion_receipt", receipt },
  ]);
  await repositories.applySessionChanges({
    pendingPolicy: null,
    deletionEpochs: [{ deviceId: credentials.device_id, value: null }],
    deletionReceipts: [{ deviceId: credentials.device_id, value: null }],
  });
  assert.equal(
    await repositories.readDeletionEpoch(credentials.device_id),
    undefined,
  );
  assert.equal(
    await repositories.readDeletionReceipt(credentials.device_id),
    undefined,
  );
  assert.equal(await repositories.readPendingPolicy(), undefined);
});

test("unknown command fields and conflicting scoped mutations reject before saving", async (t) => {
  const { repositories } = await open(t);
  await assert.rejects(
    repositories.applySessionChanges({
      personal,
      arbitrary: { secret: "invalid" },
    } as SessionChanges),
    /payload_rejected/,
  );
  await assert.rejects(
    repositories.applySessionChanges({
      personal,
      reconnects: [
        {
          origin: "https://other.example",
          value: {
            ...credentials,
            disconnect_pending: true,
            disconnect_operation_id: "operation",
          },
        },
      ],
    }),
    /policy_unavailable/,
  );
  await assert.rejects(
    repositories.applySessionChanges({
      personal,
      deletionEpochs: [
        { deviceId: "device", value: { epoch: 1 } },
        { deviceId: "device", value: null },
      ],
    }),
    /payload_rejected/,
  );
  assert.equal(await repositories.readPersonal(), undefined);
});

test("catalog adapter preserves sealed digest bytes and guarded compare-and-set semantics", async (t) => {
  const { ledger, repositories } = await open(t);
  await repositories.applySessionChanges({
    personal,
    credentials,
    ownershipHistory: enrolledHistory,
  });
  const trust = methodTrustIdentity(await repositories.routingSnapshot());
  const payload: StoredMethodCatalogPayload = {
    namespace: credentials.namespace,
    version: 1,
    trust,
    records: [],
    checkedAt: "2026-09-15T12:00:00.000Z",
    lastValidAt: null,
    reason: null,
  };
  assert.equal(
    repositories.methodCatalogDigest(payload),
    payloadHash({ ...payload, key: credentials.namespace }),
  );
  const catalog = { ...payload, seal: "synthetic-seal" };
  const guard = {
    trust,
    erasureVersion: 0,
    previousHash: null,
    ownershipStart: 1,
  };
  await repositories.commitMethodCatalog(
    credentials.namespace,
    catalog,
    guard,
    () => true,
  );
  const saved = await repositories.readMethodCatalog(credentials.namespace);
  assert.ok(saved);
  assert.deepEqual(saved.catalog, catalog);
  assert.equal(
    saved.revision,
    payloadHash(await ledger.get("method_catalogs", credentials.namespace)),
  );
  assert.equal(Object.hasOwn(saved.catalog, "key"), false);
  await assert.rejects(
    repositories.commitMethodCatalog(
      credentials.namespace,
      { ...catalog, checkedAt: null },
      guard,
      () => true,
    ),
    /policy_unavailable/,
  );
  await assert.rejects(
    repositories.commitMethodCatalog(
      credentials.namespace,
      { ...catalog, checkedAt: null },
      { ...guard, previousHash: saved.revision },
      () => false,
    ),
    /policy_unavailable/,
  );
  assert.deepEqual(
    await repositories.readMethodCatalog(credentials.namespace),
    saved,
  );
  const next = { ...catalog, checkedAt: "2026-09-15T13:00:00.000Z" };
  await repositories.commitMethodCatalog(
    credentials.namespace,
    next,
    { ...guard, previousHash: saved.revision },
    () => true,
  );
  assert.deepEqual(
    (await repositories.readMethodCatalog(credentials.namespace))?.catalog,
    next,
  );
});

test("health reads enforce their bound and remain scoped while writes retain counts", async (t) => {
  const { repositories } = await open(t);
  await repositories.health(personal.namespace, "sync_delayed");
  await repositories.health(personal.namespace, "sync_delayed");
  await repositories.health(personal.namespace, "policy_unavailable");
  await repositories.health("personal:other", "storage_write_failed");
  assert.equal(
    (await repositories.listHealth(personal.namespace, 1)).length,
    1,
  );
  const health = await repositories.listHealth(personal.namespace);
  assert.equal(health.length, 2);
  assert.equal(health.find((entry) => entry.code === "sync_delayed")?.count, 2);
  assert.ok(
    health.every(
      (entry) =>
        entry.namespace === personal.namespace && !Object.hasOwn(entry, "key"),
    ),
  );
  for (const limit of [0, 1001, 1.5, NaN])
    await assert.rejects(
      repositories.listHealth(personal.namespace, limit),
      /payload_rejected/,
    );
});
