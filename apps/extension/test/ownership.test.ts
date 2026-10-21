import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ownershipAt,
  transitionOwnership,
  hmacIdentity,
  createIdentityKeyer,
  type OwnershipHistory,
} from "../lib/ownership";
test("PE10 delayed personal dispatch remains personal after Connect and terminal processing", async () => {
  let history: OwnershipHistory = {
    key: "ownership-history",
    eras: [
      {
        scope: { namespace: "personal:p", mode: "personal", era: null },
        secret: "a".repeat(64),
        policyVersion: "1.0.0",
        start: 0,
        end: null,
      },
    ],
  };
  const dispatchAt = 1000;
  const captured = ownershipAt(history, dispatchAt);
  history = transitionOwnership(
    history,
    {
      scope: { namespace: "company:a", mode: "company", era: "era-a" },
      secret: "b".repeat(64),
      policyVersion: "1.0.0",
    },
    1001,
  );
  assert.deepEqual(ownershipAt(history, dispatchAt), {
    ...captured,
    end: 1001,
  });
  assert.equal(ownershipAt(history, dispatchAt).scope.mode, "personal");
  assert.equal(
    await hmacIdentity(captured.secret, "claude", "conversation", "same"),
    await hmacIdentity(
      ownershipAt(history, dispatchAt).secret,
      "claude",
      "conversation",
      "same",
    ),
  );
});
test("PE11 company A work survives disconnect and B enrollment without B attribution or key use", async () => {
  let history: OwnershipHistory = {
    key: "ownership-history",
    eras: [
      {
        scope: { namespace: "company:a", mode: "company", era: "era-a" },
        secret: "a".repeat(64),
        policyVersion: "1.0.0",
        start: 0,
        end: null,
      },
    ],
  };
  history = transitionOwnership(
    history,
    {
      scope: { namespace: "personal:p", mode: "personal", era: null },
      secret: "b".repeat(64),
      policyVersion: "1.0.0",
    },
    2000,
  );
  history = transitionOwnership(
    history,
    {
      scope: { namespace: "company:b", mode: "company", era: "era-b" },
      secret: "c".repeat(64),
      policyVersion: "1.0.0",
    },
    3000,
  );
  const original = ownershipAt(history, 1999);
  assert.equal(original.scope.namespace, "company:a");
  assert.equal(ownershipAt(history, 2000).scope.mode, "personal");
  assert.equal(ownershipAt(history, 3000).scope.namespace, "company:b");
  assert.notEqual(
    await hmacIdentity(original.secret, "chatgpt", "attempt", "id"),
    await hmacIdentity(
      ownershipAt(history, 3000).secret,
      "chatgpt",
      "attempt",
      "id",
    ),
  );
});
test("an import keyer produces the same identities as hmacIdentity for hex and base64url secrets", async () => {
  const secrets = [
    "0123456789abcdef".repeat(4),
    btoa("k".repeat(32)).replace(/\+/g, "-").replace(/\//g, "_"),
  ];
  const inputs: Array<[string, string, string]> = [
    ["claude", "conversation", "00000000-0000-4000-8000-000000000042"],
    ["claude", "history-message", JSON.stringify(["c", "prompt", "é"])],
    ["gemini", "attempt", "rc_0123456789abcdef"],
  ];
  for (const secret of secrets) {
    const keyer = createIdentityKeyer(secret);
    for (const [site, kind, id] of inputs) {
      const expected = await hmacIdentity(secret, site, kind, id);
      assert.equal(await keyer(site, kind, id), expected);
      // A repeated identity is answered from the same import's memo.
      assert.equal(await keyer(site, kind, id), expected);
    }
  }
  assert.notEqual(
    await createIdentityKeyer(secrets[0]!)("claude", "attempt", "x"),
    await createIdentityKeyer(secrets[1]!)("claude", "attempt", "x"),
  );
});
