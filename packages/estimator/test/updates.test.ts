import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalJson, payloadHash } from "@footprint/contracts";
import { BASELINE_BUNDLE, BASELINE_METHOD_HASH } from "../src/index";
import { installSignedMethodUpdate } from "../src/updates";
test("E12 MU05 signed data-only update validates key, bytes, time and immutable identity", async () => {
  const key = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const publicKey = Buffer.from(
    await crypto.subtle.exportKey("spki", key.publicKey),
  ).toString("base64");
  const bundle = structuredClone(
    BASELINE_BUNDLE,
  ) as import("../src/bundle").MethodBundle;
  bundle.method_id = "test-signed-v1";
  const envelope = {
    bundle,
    bundle_hash: payloadHash(bundle),
    issued_at: "2026-09-10T00:00:00.000Z",
    expires_at: "2026-10-10T00:00:00.000Z",
    signature: "",
  };
  const message = new TextEncoder().encode(
    canonicalJson({
      bundle_hash: envelope.bundle_hash,
      issued_at: envelope.issued_at,
      expires_at: envelope.expires_at,
    }),
  );
  envelope.signature = Buffer.from(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key.privateKey,
      message,
    ),
  ).toString("base64");
  const now = Date.parse("2026-09-10T12:00:00Z");
  assert.equal(
    await installSignedMethodUpdate(envelope, publicKey, now),
    envelope.bundle_hash,
  );
  await assert.rejects(
    installSignedMethodUpdate(
      { ...envelope, bundle_hash: "0".repeat(64) },
      publicKey,
      now,
    ),
  );
  await assert.rejects(
    installSignedMethodUpdate(
      { ...envelope, signature: "AA==" },
      publicKey,
      now,
    ),
  );
  await assert.rejects(
    installSignedMethodUpdate(envelope, publicKey, Date.parse("2027-01-01")),
  );
  assert.equal(payloadHash(BASELINE_BUNDLE), BASELINE_METHOD_HASH);
});

test("all signed fields are snapshotted before importKey yields", async () => {
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const publicKey = Buffer.from(
    await crypto.subtle.exportKey("spki", keys.publicKey),
  ).toString("base64");
  const bundle = structuredClone(
    BASELINE_BUNDLE,
  ) as import("../src/bundle").MethodBundle;
  bundle.method_id = "test-envelope-snapshot-v1";
  const other = { ...bundle, reviewer: "other synthetic approval" };
  const header = {
    bundle_hash: payloadHash(other),
    issued_at: "2026-09-10T00:00:00.000Z",
    expires_at: "2026-10-10T00:00:00.000Z",
  };
  const signature = Buffer.from(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      keys.privateKey,
      new TextEncoder().encode(canonicalJson(header)),
    ),
  ).toString("base64");
  const input = {
    bundle,
    bundle_hash: payloadHash(bundle),
    issued_at: header.issued_at,
    expires_at: header.expires_at,
    signature,
  };
  const original = crypto.subtle.importKey;
  let changed = false;
  crypto.subtle.importKey = (async (...args: any[]) => {
    changed = true;
    input.bundle_hash = header.bundle_hash;
    return (original as any).apply(crypto.subtle, args);
  }) as typeof original;
  try {
    await assert.rejects(
      installSignedMethodUpdate(
        input,
        publicKey,
        Date.parse("2026-09-10T12:00:00Z"),
      ),
      /method_update_invalid/,
    );
    assert.equal(changed, true);
  } finally {
    crypto.subtle.importKey = original;
  }
});
