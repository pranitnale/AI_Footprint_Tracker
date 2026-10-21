import { request } from "./ledger-support";

/** Read one hash key and count its bucket. Missing pins stay in the denominator. */
export async function uniformOriginalMethodHash(
  tx: IDBTransaction,
  scopeKey: string,
  inputCount: number,
): Promise<string | null> {
  if (inputCount === 0) return null;
  const index = tx.objectStore("estimation_inputs").index("originalMethod");
  const first = await request(
    index.openKeyCursor(
      IDBKeyRange.bound([scopeKey, ""], [scopeKey, "\uffff"]),
    ),
  );
  const key = first?.key;
  if (
    !Array.isArray(key) ||
    typeof key[1] !== "string" ||
    !/^[a-f0-9]{64}$/.test(key[1]) ||
    key[1].length !== 64
  )
    return null;
  const hash = key[1];
  return (await request(index.count([scopeKey, hash]))) === inputCount
    ? hash
    : null;
}
