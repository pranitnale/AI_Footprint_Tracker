import { canonicalJson } from "@footprint/contracts";
import type {
  MonthlyViewClaim,
  MonthlyViewClaimResult,
} from "./repository-contracts";
import { localSelectionCurrent } from "./local-selection";
import {
  checkedScope,
  estimationTransactionStores,
} from "./estimation-storage";
import { completed, hasPendingPurge, request } from "./ledger-support";

/** The monthly claim and final calculation/routing/timezone guard share one write transaction. */
export async function claimMonthlyView(
  db: IDBDatabase,
  untrusted: MonthlyViewClaim,
): Promise<MonthlyViewClaimResult> {
  const command = structuredClone(untrusted);
  checkedScope(command.scope);
  if (
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(command.month) ||
    command.month.length !== 7 ||
    typeof command.timezone !== "string" ||
    !command.timezone ||
    command.timezone.length > 128
  )
    throw new Error("payload_rejected");
  const tx = db.transaction(estimationTransactionStores, "readwrite"),
    done = completed(tx);
  try {
    const store = tx.objectStore("policy");
    const [credentials, personal, settings] = await Promise.all([
      request(store.get("credentials")),
      request(store.get("personal")),
      request(store.get("settings")),
    ]);
    const sameScope =
      canonicalJson(command.scope) ===
      canonicalJson(command.selection.authorityScope);
    const routing =
      command.scope.mode === "company"
        ? !!command.company &&
          credentials?.namespace === command.scope.namespace &&
          credentials.device_id === command.company.deviceId &&
          credentials.enrollment_era?.id === command.scope.era &&
          credentials.policy?.deletion_epoch ===
            command.company.deletionEpoch &&
          credentials.policy?.timezone === command.timezone &&
          (!credentials.enrollment_state ||
            credentials.enrollment_state === "active")
        : command.company === null &&
          personal?.namespace === command.scope.namespace &&
          settings?.timezone === command.timezone;
    if (
      !sameScope ||
      !routing ||
      (await hasPendingPurge(tx, command.scope.namespace)) ||
      !(await localSelectionCurrent(
        tx,
        command.scope,
        command.selection.localSelectionToken,
      ))
    ) {
      await done;
      return "stale";
    }
    const key = `monthly:${command.scope.namespace}`,
      previous = await request(store.get(key));
    if (previous?.month && previous.month >= command.month) {
      await done;
      return "already_claimed";
    }
    store.put({
      key,
      namespace: command.scope.namespace,
      month: command.month,
      claimedAt: Date.now(),
    });
    await done;
    return "claimed";
  } catch (error) {
    try {
      tx.abort();
    } catch {}
    await done.catch(() => {});
    throw error;
  }
}
