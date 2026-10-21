import { canonicalJson, payloadHash } from "@footprint/contracts";
import { approveBundle, deepFreeze, type MethodBundle } from "./bundle";
import { registerMethodBundle } from "./index";
export type SignedMethodUpdate = {
  bundle: unknown;
  bundle_hash: string;
  issued_at: string;
  expires_at: string;
  signature: string;
};
export function immutableMethodEnvelope(
  input: unknown,
): Readonly<SignedMethodUpdate> {
  try {
    const text = canonicalJson(input);
    if (new TextEncoder().encode(text).length > 2 * 1024 * 1024)
      throw new Error();
    const value = JSON.parse(text);
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(",") !==
        "bundle,bundle_hash,expires_at,issued_at,signature"
    )
      throw new Error();
    return deepFreeze(value);
  } catch {
    throw new Error("method_update_invalid");
  }
}
function bytes(base64: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))
    throw new Error("method_update_invalid");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}
// The trust key comes from the packaged baseline or authenticated enrollment, never this envelope.
export async function installSignedMethodUpdate(
  input: SignedMethodUpdate,
  trustedSpkiBase64: string,
  now = Date.now(),
): Promise<string> {
  const bundle = await verifySignedMethodUpdate(input, trustedSpkiBase64, now);
  return registerMethodBundle(bundle);
}
/** Verify data without mutating any process-global method catalog. */
export async function verifySignedMethodUpdate(
  input: SignedMethodUpdate,
  trustedSpkiBase64: string,
  now = Date.now(),
): Promise<Readonly<MethodBundle>> {
  try {
    input = immutableMethodEnvelope(input);
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).sort().join(",") !==
        "bundle,bundle_hash,expires_at,issued_at,signature" ||
      new TextEncoder().encode(canonicalJson(input)).length > 2 * 1024 * 1024 ||
      typeof trustedSpkiBase64 !== "string" ||
      trustedSpkiBase64.length > 512
    )
      throw new Error();
    const issued = Date.parse(input.issued_at),
      expires = Date.parse(input.expires_at);
    if (
      typeof input.issued_at !== "string" ||
      typeof input.expires_at !== "string" ||
      !Number.isFinite(issued) ||
      !Number.isFinite(expires) ||
      new Date(issued).toISOString() !== input.issued_at ||
      new Date(expires).toISOString() !== input.expires_at ||
      typeof input.bundle_hash !== "string" ||
      !/^[a-f0-9]{64}$/.test(input.bundle_hash) ||
      typeof input.signature !== "string" ||
      input.signature.length !== 88 ||
      !Number.isFinite(now) ||
      issued > now + 300000 ||
      expires <= now ||
      expires <= issued
    )
      throw new Error();
    const bundle = approveBundle(input.bundle);
    if (
      bundle.equation_id === "test-linear-v1" ||
      bundle.method_id.length > 128
    )
      throw new Error();
    for (const value of [
      bundle.provenance.url,
      bundle.scenario.provenance.url,
      ...bundle.profiles.map((profile) => profile.architecture_source),
    ]) {
      const url = new URL(value);
      if (
        value.length > 2048 ||
        url.protocol !== "https:" ||
        url.username ||
        url.password
      )
        throw new Error();
    }
    if (payloadHash(bundle) !== input.bundle_hash) throw new Error();
    const key = await crypto.subtle.importKey(
      "spki",
      bytes(trustedSpkiBase64),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const message = new TextEncoder().encode(
      canonicalJson({
        bundle_hash: input.bundle_hash,
        issued_at: input.issued_at,
        expires_at: input.expires_at,
      }),
    );
    if (
      !(await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        key,
        bytes(input.signature),
        message,
      ))
    )
      throw new Error();
    return bundle;
  } catch {
    throw new Error("method_update_invalid");
  }
}
