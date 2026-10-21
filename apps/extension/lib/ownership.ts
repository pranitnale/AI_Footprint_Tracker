import type { Scope } from "@footprint/ledger";
export interface Ownership {
  scope: Scope;
  secret: string;
  policyVersion: string;
  start: number;
  end: number | null;
}
export interface OwnershipHistory {
  key: "ownership-history";
  eras: Ownership[];
}
export function transitionOwnership(
  history: Pick<OwnershipHistory, "eras">,
  next: Omit<Ownership, "start" | "end">,
  at = Date.now(),
): OwnershipHistory {
  const eras = history.eras.map((era) => ({ ...era, scope: { ...era.scope } }));
  const current = eras.at(-1);
  if (!Number.isFinite(at) || (current && at < current.start))
    throw new Error("clock_skew");
  if (
    current?.scope.namespace === next.scope.namespace &&
    current.scope.era === next.scope.era &&
    current.policyVersion === next.policyVersion
  )
    return "key" in history && history.key === "ownership-history"
      ? (history as OwnershipHistory)
      : { key: "ownership-history", eras: history.eras };
  if (current) current.end = at;
  eras.push({ ...next, start: at, end: null });
  return { key: "ownership-history", eras };
}
export function ownershipAt(
  history: Pick<OwnershipHistory, "eras">,
  at: number,
): Ownership {
  const era = [...history.eras]
    .reverse()
    .find((e) => e.start <= at && (e.end === null || at < e.end));
  if (!era) throw new Error("policy_unavailable");
  return structuredClone(era);
}
function identityKey(secret: string): Promise<CryptoKey> {
  const bytes = /^[0-9a-f]{64}$/i.test(secret)
    ? Uint8Array.from(secret.match(/../g)!, (b) => parseInt(b, 16))
    : Uint8Array.from(atob(secret.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
        c.charCodeAt(0),
      );
  return crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}
async function signIdentity(
  key: CryptoKey,
  site: string,
  kind: string,
  id: string,
): Promise<string> {
  const tuple = ["1", site, kind, id]
    .map((v) => `${new TextEncoder().encode(v).length}:${v}`)
    .join("");
  return [
    ...new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(tuple)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export async function hmacIdentity(
  secret: string,
  site: string,
  kind: string,
  id: string,
): Promise<string> {
  return signIdentity(await identityKey(secret), site, kind, id);
}
/**
 * The same identities as `hmacIdentity` for one secret, importing the key once.
 * Callers keep it only for one import so a rotated secret is never reused.
 */
export function createIdentityKeyer(secret: string) {
  let key: Promise<CryptoKey> | null = null;
  const known = new Map<string, Promise<string>>();
  return (site: string, kind: string, id: string): Promise<string> => {
    const memo = JSON.stringify([site, kind, id]);
    let value = known.get(memo);
    if (!value) {
      if (!key) {
        const pending = identityKey(secret);
        key = pending;
        pending.catch(() => {
          if (key === pending) key = null;
        });
      }
      value = key.then((imported) => signIdentity(imported, site, kind, id));
      // A failed signature must not stay cached for a later retry.
      value.catch(() => known.delete(memo));
      known.set(memo, value);
    }
    return value;
  };
}
