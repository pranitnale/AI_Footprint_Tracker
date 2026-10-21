import test from "node:test";
import assert from "node:assert/strict";
import {
  createMemoryRepository,
  type ApplicationRepository,
  type Scope,
  type StoredCredentials,
} from "@footprint/ledger";
import { canonicalJson } from "@footprint/contracts";
import { CompanyClient, HEALTH_REPORT_WINDOW_MS } from "../lib/company";

const origin = "https://company.example";
const personalScope: Scope = {
  namespace: "personal:health-report-test",
  mode: "personal",
  era: null,
};

async function connected(repository: ApplicationRepository) {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ]);
  const company_id = crypto.randomUUID(),
    user_id = crypto.randomUUID(),
    start = Date.now() - 10 * HEALTH_REPORT_WINDOW_MS;
  const c: StoredCredentials = {
    origin,
    namespace: `company:${company_id}:${user_id}`,
    company_id,
    user_id,
    device_id: crypto.randomUUID(),
    access_token: "test-access",
    refresh_token: "test-refresh",
    access_expires_at: new Date(Date.now() + 600_000).toISOString(),
    refresh_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
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
      start: new Date(start).toISOString(),
      end: null,
    },
    deletion_public_key: Buffer.from(
      await crypto.subtle.exportKey("raw", pair.publicKey),
    ).toString("base64url"),
    method_public_key: null,
  };
  const scope: Scope = {
    namespace: c.namespace,
    mode: "company",
    era: c.enrollment_era.id,
  };
  await repository.applySessionChanges(
    {
      personal: { namespace: personalScope.namespace, secret: "b".repeat(64) },
      installation: { routingSecret: "a".repeat(64) },
      credentials: c,
      ownershipHistory: {
        eras: [
          {
            scope: personalScope,
            secret: "b".repeat(64),
            policyVersion: "1.0.0",
            start: 0,
            end: start,
          },
          {
            scope,
            secret: c.user_hmac_key,
            policyVersion: "1.0.0",
            start,
            end: null,
          },
        ],
      },
    },
    { deviceId: null },
  );
  return { c, signer: pair.privateKey };
}

/** One sync against a server that accepts everything; returns the health report it received. */
async function reported(
  repository: ApplicationRepository,
  c: StoredCredentials,
  signer: CryptoKey,
) {
  const reports: unknown[] = [];
  const client = new CompanyClient(repository, (async (input, init = {}) => {
    const path = new URL(String(input)).pathname;
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
          signer,
          new TextEncoder().encode(canonicalJson(instruction)),
        ),
      ).toString("base64url");
      return new Response(
        JSON.stringify({ instruction, signature, algorithm: "Ed25519", key_version: "1" }),
      );
    }
    if (path === "/v1/deletions/ack")
      return new Response(JSON.stringify({ acknowledged_epoch: 0 }));
    if (path === "/v1/config")
      return new Response(JSON.stringify({ policy: c.policy }));
    if (path === "/v1/health/reports") {
      reports.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ received: true }));
    }
    return new Response(JSON.stringify({ items: [], next_cursor: null }));
  }) as typeof fetch);
  await client.sync();
  assert.equal(reports.length, 1);
  return reports[0] as { code: string; count: number };
}

test("a capture problem from days ago is not reported as this browser's current health", async () => {
  let now = Date.now() - 3 * HEALTH_REPORT_WINDOW_MS;
  const repository = createMemoryRepository({ now: () => now });
  const { c, signer } = await connected(repository);
  // An unrecognised page (for example a Perplexity Computer task) had a capture gap once.
  await repository.health(c.namespace, "protocol_unsupported");
  await repository.health(c.namespace, "sync_delayed");
  now = Date.now();
  const report = await reported(repository, c, signer);
  assert.equal(report.code, "healthy");
  assert.equal(report.count, 0);
});

// Owner decision of 16 October 2026: a successful sync closes the problems of that work.
test("a successful sync closes sync, rules, connection, deletion and earlier refusal problems and keeps notes open", async () => {
  let now = Date.now() - 60_000;
  const repository = createMemoryRepository({ now: () => now });
  const { c, signer } = await connected(repository);
  const codes = [
    "sync_delayed",
    "policy_unavailable",
    "auth_reconnect_required",
    "deletion_in_progress",
    "revision_conflict",
    "payload_rejected",
    "protocol_unsupported",
  ] as const;
  for (const code of codes) await repository.health(c.namespace, code);
  await repository.health(c.namespace, "sync_delayed");
  now = Date.now();
  // Reported as it stood when the sync began.
  assert.equal((await reported(repository, c, signer)).code, "capture_failed");
  const rows = await repository.listHealth(c.namespace);
  assert.equal(rows.length, codes.length, "nothing is deleted");
  const solved = Object.fromEntries(
    rows.map((row) => [row.code, typeof row.resolvedAt === "number"]),
  );
  assert.deepEqual(solved, {
    sync_delayed: true,
    policy_unavailable: true,
    auth_reconnect_required: true,
    deletion_in_progress: true,
    // A note stays a note; a record refused earlier closes once an upload works again
    // (owner decision of 16 October 2026, evening).
    revision_conflict: false,
    payload_rejected: true,
    protocol_unsupported: false,
  });
  assert.equal(rows.find((row) => row.code === "sync_delayed")!.count, 2);
});

test("a solved sync problem is not reported again as current health", async () => {
  const repository = createMemoryRepository();
  const { c, signer } = await connected(repository);
  await repository.health(c.namespace, "sync_delayed");
  assert.deepEqual(await reported(repository, c, signer), {
    code: "sync_failed",
    site: null,
    count: 1,
    client_version: "0.1.0",
  });
  assert.equal((await reported(repository, c, signer)).code, "healthy");
});

test("a sync the server does not answer keeps the problem open", async () => {
  const repository = createMemoryRepository();
  const { c } = await connected(repository);
  await repository.health(c.namespace, "sync_delayed");
  const client = new CompanyClient(repository, (async () =>
    new Response("{}", { status: 503 })) as typeof fetch);
  await client.sync();
  const row = (await repository.listHealth(c.namespace)).find(
    (entry) => entry.code === "sync_delayed",
  )!;
  assert.equal(row.resolvedAt, undefined);
});

test("a capture problem of the last day is still reported, with old ones left out", async () => {
  let now = Date.now() - 3 * HEALTH_REPORT_WINDOW_MS;
  const repository = createMemoryRepository({ now: () => now });
  const { c, signer } = await connected(repository);
  await repository.health(c.namespace, "protocol_unsupported");
  now = Date.now() - 60_000;
  await repository.health(c.namespace, "partial_capture");
  now = Date.now();
  const report = await reported(repository, c, signer);
  assert.equal(report.code, "capture_failed");
  assert.equal(report.count, 1);
});
