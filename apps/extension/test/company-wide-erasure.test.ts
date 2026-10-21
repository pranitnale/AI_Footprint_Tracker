import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Ledger, digest } from "@footprint/ledger";
import { canonicalJson } from "@footprint/contracts";
import { CompanyClient } from "../lib/company";
import { transitionOwnership, type OwnershipHistory } from "../lib/ownership";
import { records } from "../../../packages/ledger/test/factory";

const b64 = (bytes: ArrayBuffer) => Buffer.from(bytes).toString("base64url");
const BEFORE = "2026-10-17T10:00:00.000Z";
const AFTER = "2026-10-18T21:50:00.000Z";

/**
 * A connected browser that was offline while an administrator erased usage, as on 17 and
 * 18 October 2026: two erasure jobs (epochs 1 and 2) wait for it when it syncs again.
 */
async function offlineBrowser(changes: Array<Record<string, unknown>>) {
  const db = await Ledger.open("company-wide-erasure-" + crypto.randomUUID());
  const signer = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const company = crypto.randomUUID(),
    user = crypto.randomUUID(),
    era = crypto.randomUUID();
  const credentials: any = {
    key: "credentials",
    origin: "https://company.example",
    namespace: `company:${company}:${user}`,
    access_token: "test-only-access",
    refresh_token: "test-only-refresh",
    access_expires_at: new Date(Date.now() + 600000).toISOString(),
    refresh_expires_at: new Date(Date.now() + 86400000).toISOString(),
    company_id: company,
    user_id: user,
    device_id: crypto.randomUUID(),
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
      deletion_epoch: 0,
    },
    enrollment_era: { id: era, start: "2026-10-01T00:00:00.000Z", end: null },
    deletion_public_key: b64(
      await crypto.subtle.exportKey("raw", signer.publicKey),
    ),
  };
  const personal = { namespace: "personal:test", secret: "a".repeat(64) };
  const history: OwnershipHistory = {
    eras: [
      {
        scope: { namespace: personal.namespace, mode: "personal", era: null },
        secret: personal.secret,
        policyVersion: "1.0.0",
        start: 0,
        end: null,
      },
    ],
  } as any;
  const scope = {
    namespace: credentials.namespace,
    mode: "company" as const,
    era,
  };
  await db.policyTransaction([
    { key: "personal", ...personal },
    credentials,
    transitionOwnership(history, {
      scope,
      secret: credentials.user_hmac_key,
      policyVersion: "1.0.0",
    }) as any,
  ]);
  const ids: Record<"before" | "after", string> = { before: "", after: "" };
  for (const [name, at] of [
    ["before", BEFORE],
    ["after", AFTER],
  ] as const) {
    const pair = records();
    pair[0].dispatched_at = at;
    pair[1].started_at = at;
    ids[name] = pair[0].request_id;
    await db.commit(scope, pair);
  }
  const current = Math.max(0, ...changes.map((change) => change.epoch as number));
  const paths: string[] = [];
  const transport = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    paths.push(path);
    let response: unknown = { ok: true };
    if (path === "/v1/deletions/status") {
      const instruction = {
        company_id: company,
        device_id: credentials.device_id,
        deletion_epoch: current,
        current_deletion_epoch: current,
        has_more: false,
        changes: changes.filter(
          (change) => (change.epoch as number) > body.last_epoch,
        ),
        issued_at: new Date().toISOString(),
        retention_cutoff: null,
      };
      response = {
        instruction,
        signature: b64(
          await crypto.subtle.sign(
            "Ed25519",
            signer.privateKey,
            new TextEncoder().encode(canonicalJson(instruction)),
          ),
        ),
        algorithm: "Ed25519",
        key_version: "1",
      };
    } else if (path === "/v1/deletions/ack")
      response = { acknowledged_epoch: body.last_epoch };
    else if (path === "/v1/config")
      response = { policy: { ...credentials.policy, deletion_epoch: current } };
    else if (path === "/v1/usage/batches")
      response = {
        batch_id: body.batch_id,
        results: await Promise.all(
          body.records.map(async (r: any) => ({
            kind: r.kind,
            record_id: r.kind === "request" ? r.request_id : r.attempt_id,
            revision: r.revision,
            server_record_version: r.revision,
            payload_hash: await digest(r),
            status: "applied",
          })),
        ),
      };
    return new Response(JSON.stringify(response), {
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  const client = new CompanyClient(db, transport);
  const requests = async () =>
    (await db.rows(scope.namespace))
      .map((row: any) => row.record)
      .filter((record: any) => record.kind === "request")
      .map((record: any) => record.request_id);
  const mode = async () =>
    (await db.get<OwnershipHistory>("policy", "ownership-history"))!.eras.at(-1)!
      .scope.mode;
  return { db, client, credentials, ids, paths, requests, mode };
}

/** The whole organization's usage as the server sends it: the range the preview froze. */
const companyWide = (epoch: number, end: string) => ({
  scope: "company",
  user_id: null,
  start: "1970-01-01T00:00:00.000Z",
  end,
  epoch,
  created_at: end,
  record_ids: [],
  job_id: crypto.randomUUID(),
});

for (const agreed of [true, false])
  test(`erasing the organization's usage keeps the browser connected and erases the frozen range (agreed to tracking: ${agreed})`, async () => {
    const s = await offlineBrowser([
      companyWide(1, "2026-10-17T12:49:00.000Z"),
      companyWide(2, "2026-10-17T12:53:00.000Z"),
    ]);
    try {
      // Ignored by builds from before the agreement step, so the test runs on both.
      (s.client as any).trackingAllowed = async () => agreed;
      await s.client.maintenance();
      const kept = await s.client.credentials();
      assert.ok(kept, "the browser is still connected");
      assert.equal(kept!.device_id, s.credentials.device_id);
      assert.equal(kept!.refresh_token, s.credentials.refresh_token);
      assert.equal(kept!.policy.deletion_epoch, 2);
      assert.equal(kept!.enrollment_state ?? "active", "active");
      assert.equal(await s.mode(), "company", "organization mode stays");
      const left = await s.requests();
      assert.equal(left.includes(s.ids.before), false, "the erased record is gone");
      assert.equal(left.includes(s.ids.after), true, "usage after the erasure stays");
      assert.ok(s.paths.includes("/v1/deletions/ack"));
      assert.equal(
        s.paths.includes("/v1/config"),
        agreed,
        "a sync after the erasure goes on only once the person agreed",
      );
      // The next sync finds nothing new and does not erase again.
      await s.client.maintenance();
      assert.ok(await s.client.credentials());
      assert.equal((await s.requests()).includes(s.ids.after), true);
    } finally {
      s.db.close();
    }
  });

test("deleting the person still erases everything and ends the connection", async () => {
  const t = await offlineBrowser([
    {
      scope: "user",
      user_id: null,
      start: null,
      end: null,
      epoch: 1,
      created_at: BEFORE,
      record_ids: [],
      job_id: crypto.randomUUID(),
    },
  ]);
  try {
    (t.client as any).trackingAllowed = async () => true;
    await t.client.maintenance();
    assert.equal(await t.client.credentials(), undefined);
    assert.equal(await t.mode(), "personal");
    assert.deepEqual(await t.requests(), []);
    assert.equal(t.paths.includes("/v1/config"), false);
  } finally {
    t.db.close();
  }
});
