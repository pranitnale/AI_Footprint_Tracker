import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { unavailableCount } from "./counting-fixture";
import test from "node:test";
import { Ledger } from "@footprint/ledger";
import { Coordinator } from "../lib/coordinator";
import { observeScopeChanges } from "../lib/scope-notifications";
import { transitionOwnership, type OwnershipHistory } from "../lib/ownership";
import { canonicalJson } from "@footprint/contracts";
import { records } from "../../../packages/ledger/test/factory";

test("committed scope changes notify without a new capture and unchanged credential refresh stays quiet", async () => {
  const db = await Ledger.open("scope-notices-" + crypto.randomUUID());
  let consent = true;
  const notices: unknown[] = [];
  const c = new Coordinator(db, {
    hasConsent: async () => consent,
    count: unavailableCount,
    sendDisplay: async () => {},
    transport: (async () =>
      new Response(JSON.stringify({ revoked: true }))) as typeof fetch,
  });
  const personal = await c.currentScope();
  const observer = await observeScopeChanges(
    db,
    () => c.currentScope(),
    async () => {
      notices.push({ target: "footprint-scope-changed" });
    },
  );
  try {
    async function connect(n: number) {
      const history = (await db.get<OwnershipHistory>(
        "policy",
        "ownership-history",
      ))!;
      const company = crypto.randomUUID(),
        user = crypto.randomUUID(),
        era = crypto.randomUUID(),
        secret = String(n).repeat(64);
      const credentials: any = {
        key: "credentials",
        namespace: `company:${company}:${user}`,
        company_id: company,
        user_id: user,
        device_id: crypto.randomUUID(),
        origin: `https://company${n}.example`,
        access_token: "test-only-access",
        refresh_token: "test-only-refresh",
        enrollment_era: { id: era, start: new Date().toISOString(), end: null },
        user_hmac_key: secret,
        policy: { policy_version: "1.0.0", deletion_epoch: 0 },
      };
      await db.policyTransaction([
        credentials,
        transitionOwnership(history, {
          scope: { namespace: credentials.namespace, mode: "company", era },
          secret,
          policyVersion: "1.0.0",
        }) as any,
      ]);
      await observer.settled();
      return credentials;
    }
    const first = await connect(1);
    assert.equal(notices.length, 1);
    await db.put("policy", {
      ...first,
      access_token: "rotated-only",
      refresh_token: "rotated-refresh",
    });
    await observer.settled();
    assert.equal(notices.length, 1);
    await c.company.disconnect();
    await observer.settled();
    assert.equal(notices.length, 2);
    assert.equal((await c.currentScope()).namespace, personal.namespace);
    await connect(2);
    assert.equal(notices.length, 3);
    const third = await connect(3);
    assert.equal(notices.length, 4);
    await db.put("policy", { ...third, enrollment_state: "revoked" });
    await observer.settled();
    assert.equal(notices.length, 5);
    await connect(4);
    assert.equal(notices.length, 6);
    consent = false;
    await c.permissionRemoved();
    await observer.settled();
    assert.equal(notices.length, 7);
    assert.ok(
      notices.every(
        (value) =>
          JSON.stringify(value) === '{"target":"footprint-scope-changed"}',
      ),
    );
    assert.equal((await db.rows(personal.namespace)).length, 0);
  } finally {
    observer.stop();
    db.close();
  }
});

for (const mode of ["range_ack_failure", "retention_same_epoch"] as const)
  test(`committed ${mode} invalidates visible data before network acknowledgement`, async () => {
    const db = await Ledger.open("erase-notices-" + crypto.randomUUID());
    const signer = await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ]);
    const encode = (value: ArrayBuffer) =>
      Buffer.from(value).toString("base64url");
    let credentials: any;
    let observer: Awaited<ReturnType<typeof observeScopeChanges>> | undefined;
    let notices = 0,
      ackCalls = 0;
    const c = new Coordinator(db, {
      hasConsent: async () => true,
      count: unavailableCount,
      sendDisplay: async () => {},
      transport: (async (input: any) => {
        const path = new URL(String(input)).pathname;
        if (path === "/v1/deletions/status") {
          const instruction = {
            company_id: credentials.company_id,
            device_id: credentials.device_id,
            deletion_epoch: mode === "range_ack_failure" ? 1 : 0,
            current_deletion_epoch: mode === "range_ack_failure" ? 1 : 0,
            has_more: false,
            issued_at: new Date().toISOString(),
            retention_cutoff:
              mode === "retention_same_epoch" ? "2021-01-01T00:00:00Z" : null,
            changes:
              mode === "range_ack_failure"
                ? [
                    {
                      scope: "range",
                      user_id: null,
                      start: "2019-01-01T00:00:00Z",
                      end: "2021-01-01T00:00:00Z",
                      epoch: 1,
                    },
                  ]
                : [],
          };
          const signature = encode(
            await crypto.subtle.sign(
              "Ed25519",
              signer.privateKey,
              new TextEncoder().encode(canonicalJson(instruction)),
            ),
          );
          return new Response(
            JSON.stringify({
              instruction,
              algorithm: "Ed25519",
              key_version: "1",
              signature,
            }),
          );
        }
        assert.equal(path, "/v1/deletions/ack");
        ackCalls++;
        await observer!.settled();
        assert.ok(
          notices > 0,
          "committed erasure must notify before an ACK response exists",
        );
        if (mode === "range_ack_failure")
          throw new TypeError("synthetic offline");
        return new Response(JSON.stringify({ acknowledged: true }));
      }) as typeof fetch,
    });
    await c.whenReady();
    try {
      const history = (await db.get<OwnershipHistory>(
        "policy",
        "ownership-history",
      ))!;
      const company = crypto.randomUUID(),
        user = crypto.randomUUID(),
        era = crypto.randomUUID();
      credentials = {
        key: "credentials",
        namespace: `company:${company}:${user}`,
        company_id: company,
        user_id: user,
        device_id: crypto.randomUUID(),
        origin: "https://company.example",
        user_hmac_key: "b".repeat(64),
        enrollment_era: { id: era, start: "2019-01-01T00:00:00Z", end: null },
        policy: { policy_version: "1.0.0", deletion_epoch: 0 },
        deletion_receipt_credential: "test-only-proof",
        deletion_public_key: encode(
          await crypto.subtle.exportKey("raw", signer.publicKey),
        ),
      };
      const scope = {
        namespace: credentials.namespace,
        mode: "company" as const,
        era,
      };
      await db.policyTransaction([
        credentials,
        transitionOwnership(history, {
          scope,
          secret: credentials.user_hmac_key,
          policyVersion: "1.0.0",
        }) as any,
      ]);
      const pair = records();
      pair[0].dispatched_at = "2020-01-01T00:00:00.000Z";
      await db.commit(scope, pair);
      observer = await observeScopeChanges(
        db,
        () => c.currentScope(),
        async () => {
          notices++;
        },
      );
      if (mode === "range_ack_failure")
        await assert.rejects(c.company.applyDeletions(credentials));
      else assert.equal(await c.company.applyDeletions(credentials), true);
      await observer.settled();
      assert.equal(ackCalls, 1);
      assert.equal((await db.rows(scope.namespace)).length, 0);
      assert.equal(
        (await db.get<any>("policy", "credentials"))!.policy.deletion_epoch,
        0,
      );
      assert.ok(
        notices >= 1 && notices <= 2,
        "a range publishes bounded start/end notifications",
      );
    } finally {
      observer?.stop();
      db.close();
    }
  });
