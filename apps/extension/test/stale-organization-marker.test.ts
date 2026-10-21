import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Ledger } from "@footprint/ledger";
import { canonicalJson } from "@footprint/contracts";
import { Coordinator } from "../lib/coordinator";
import { unavailableCount } from "./counting-fixture";
import { connectCompany, serverError, verifiedConnection } from "./connect-fixture";
import { records } from "../../../packages/ledger/test/factory";

// Owner decision of 20 October 2026. A browser whose organization records were erased in
// full keeps a marker for that membership (company:<organization>:<person>), and every
// record of the namespace is refused with record_erased. A full Personal erase flags such a
// marker; the next connection removes it only when the server issues credentials for that
// same membership, which it does only for an active one.

const b64 = (bytes: ArrayBuffer) => Buffer.from(bytes).toString("base64url");
const origin = "https://company.example";

type Exchange = "active" | "refused" | "unreachable" | "new-membership";

async function setup() {
  const db = await Ledger.open("stale-marker-" + crypto.randomUUID());
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
  const companyId = crypto.randomUUID(),
    userId = crypto.randomUUID();
  const namespace = `company:${companyId}:${userId}`;
  let exchange: Exchange = "active";
  const issued = (user: string) => ({
    company_id: companyId,
    user_id: user,
    device_id: crypto.randomUUID(),
    access_token: "test-only-access",
    refresh_token: "test-only-refresh",
    access_expires_at: new Date(Date.now() + 600000).toISOString(),
    refresh_expires_at: new Date(Date.now() + 86400000).toISOString(),
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
    enrollment_era: {
      id: crypto.randomUUID(),
      start: new Date().toISOString(),
      end: null,
    },
  });
  const transport = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    let response: unknown = { ok: true };
    if (path === "/v1/connections/otp/request")
      response = {
        challenge_id: "challenge-" + crypto.randomUUID(),
        delivery_state: "sent",
        expires_at: new Date(Date.now() + 300_000).toISOString(),
        retry_at: new Date(Date.now() + 60_000).toISOString(),
        error_code: null,
      };
    else if (path === "/v1/connections")
      response = verifiedConnection(origin, publicKey);
    else if (path === "/v1/connections/exchange") {
      if (exchange === "unreachable") throw new TypeError("Failed to fetch");
      // A deleted person's membership is gone: the server refuses the exchange.
      if (exchange === "refused") return serverError("connection_denied", 403);
      // A person deleted and invited again is a new member with a new user id.
      response = issued(
        exchange === "new-membership" ? crypto.randomUUID() : userId,
      );
    } else if (path === "/v1/deletions/status") {
      const instruction = {
        company_id: companyId,
        device_id: JSON.parse(String(init?.body)).device_id,
        deletion_epoch: 0,
        current_deletion_epoch: 0,
        has_more: false,
        changes: [],
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
    }
    return new Response(JSON.stringify(response), {
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  const c = new Coordinator(db, {
    hasConsent: async () => true,
    count: unavailableCount,
    sendDisplay: async () => {},
    transport,
  });
  await c.whenReady();
  // What the organization erasure left behind: the namespace marker of this membership.
  await db.eraseNamespace(namespace);
  const marker = () => db.get<any>("deletion_markers", namespace);
  /** Commits one new request in the scope the browser is connected to. */
  const record = async () => {
    const credentials = (await c.company.credentials())!;
    await db.commit(
      {
        namespace: credentials.namespace,
        mode: "company",
        era: credentials.enrollment_era.id,
      },
      records(),
    );
    return credentials.namespace;
  };
  return {
    db,
    c,
    namespace,
    marker,
    record,
    setExchange: (next: Exchange) => {
      exchange = next;
    },
  };
}

test("after a full erase, connecting to the same active membership removes the leftover marker and records again", async () => {
  const s = await setup();
  try {
    await s.c.clearPersonal();
    assert.ok(await s.marker(), "the erase alone does not remove the marker");
    assert.equal(await connectCompany(s.c.company, origin), "connected");
    assert.equal(await s.marker(), undefined, "the server confirmed the membership");
    assert.equal(await s.record(), s.namespace);
    const requests = (await s.db.rows(s.namespace)).filter(
      (row: any) => row.record?.kind === "request",
    );
    assert.equal(requests.length, 1);
  } finally {
    s.db.close();
  }
});

test("without a full erase the marker stays, also after range and single-record erasures", async () => {
  const s = await setup();
  try {
    const personal = await s.c.currentScope();
    const pair = records();
    await s.db.commit(personal, pair);
    await s.db.eraseFamily(personal.namespace, pair[0].request_id);
    await s.db.applyRange(personal, null, "2026-10-01T00:00:00.000Z", 1);
    await connectCompany(s.c.company, origin);
    assert.ok(await s.marker());
    await assert.rejects(s.record(), /record_erased/);
  } finally {
    s.db.close();
  }
});

test("the marker stays when the server refuses the membership or cannot be reached", async () => {
  for (const exchange of ["refused", "unreachable"] as const) {
    const s = await setup();
    try {
      await s.c.clearPersonal();
      s.setExchange(exchange);
      await assert.rejects(connectCompany(s.c.company, origin));
      assert.equal(await s.c.company.credentials(), undefined, exchange);
      assert.ok(await s.marker(), exchange);
    } finally {
      s.db.close();
    }
  }
});

test("a new membership after a deletion leaves the old marker in place", async () => {
  const s = await setup();
  try {
    await s.c.clearPersonal();
    s.setExchange("new-membership");
    await connectCompany(s.c.company, origin);
    assert.ok(await s.marker(), "the deleted membership stays erased");
    const connected = await s.record();
    assert.notEqual(connected, s.namespace);
  } finally {
    s.db.close();
  }
});

test("an erasure of the membership after the full erase keeps its marker", async () => {
  const s = await setup();
  try {
    await s.c.clearPersonal();
    // The server deletes the person again before the browser reconnects.
    await s.db.eraseNamespace(s.namespace);
    await connectCompany(s.c.company, origin);
    assert.ok(await s.marker());
    await assert.rejects(s.record(), /record_erased/);
  } finally {
    s.db.close();
  }
});
