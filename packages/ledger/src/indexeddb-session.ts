import { payloadHash } from "@footprint/contracts";
import type { Ledger } from "./index";
import {
  MODEL_LABEL_LIMIT,
  type HealthRepository,
  type ModelLabelRepository,
  type StoredModelLabel,
  type MethodCatalogRepository,
  type SessionChanges,
  type SessionMaintenanceEntry,
  type SessionStateRepository,
  type StoredCredentials,
  type StoredDeletionReceipt,
  type StoredHealth,
  type StoredMethodCatalog,
  type StoredReconnect,
} from "./session-contracts";

function domainValue<T>(
  value: (T & { key: string }) | undefined,
): T | undefined {
  if (value === undefined) return undefined;
  const { key: _, ...rest } = value;
  return rest as T;
}

const singletonKeys = {
  settings: "settings",
  personal: "personal",
  installation: "installation",
  ownershipHistory: "ownership-history",
  credentials: "credentials",
  pendingConnection: "pending-connection",
  pendingPolicy: "pending-policy",
  refreshOperation: "refresh-operation",
} as const;
const changeFields: Record<keyof SessionChanges, true> = {
  settings: true,
  personal: true,
  installation: true,
  ownershipHistory: true,
  credentials: true,
  pendingConnection: true,
  pendingPolicy: true,
  refreshOperation: true,
  reconnects: true,
  deletionEpochs: true,
  deletionReceipts: true,
};

/** Adapts domain commands to the existing atomic enrollment and catalog transactions. */
export function createIndexedDbSessionRepositories(
  ledger: Ledger,
): SessionStateRepository &
  MethodCatalogRepository &
  HealthRepository &
  ModelLabelRepository {
  const read = async <T>(key: string) =>
    domainValue(await ledger.get<T & { key: string }>("policy", key));
  return {
    readSettings: () => read(singletonKeys.settings),
    readPersonal: () => read(singletonKeys.personal),
    readInstallation: () => read(singletonKeys.installation),
    readOwnershipHistory: () => read(singletonKeys.ownershipHistory),
    readCredentials: () => read(singletonKeys.credentials),
    readPendingConnection: () => read(singletonKeys.pendingConnection),
    readPendingPolicy: () => read(singletonKeys.pendingPolicy),
    readRefreshOperation: () => read(singletonKeys.refreshOperation),
    readReconnect: (origin) => read(`reconnect:${origin}`),
    readDeletionEpoch: (deviceId) => read(`deletion-epoch:${deviceId}`),
    readDeletionReceipt: (deviceId) => read(`deletion-receipt:${deviceId}`),
    readMonthlyClaim: (namespace) => read(`monthly:${namespace}`),
    async routingSnapshot() {
      const saved = await ledger.routingSnapshot();
      return {
        credentials: domainValue<StoredCredentials>(saved.credentials),
        personal: domainValue(saved.personal),
        ownership: saved.ownership,
      };
    },
    onRoutingChange: (listener) => ledger.onRoutingChange(listener),
    async listSessionMaintenance() {
      const entries: SessionMaintenanceEntry[] = [];
      const saved = await ledger.all<{ key: string }>("policy");
      for (const row of saved) {
        if (row.key === "credentials")
          entries.push({
            kind: "active",
            session: domainValue(row as StoredCredentials & { key: string })!,
          });
        else if (row.key.startsWith("reconnect:"))
          entries.push({
            kind: "reconnect",
            session: domainValue(row as StoredReconnect & { key: string })!,
          });
        else if (row.key.startsWith("deletion-receipt:"))
          entries.push({
            kind: "deletion_receipt",
            receipt: domainValue(
              row as StoredDeletionReceipt & { key: string },
            )!,
          });
      }
      return entries;
    },
    async applySessionChanges(changes, expected) {
      const command = structuredClone(changes);
      const guard = expected === undefined ? undefined : { ...expected };
      if (
        !command ||
        typeof command !== "object" ||
        Array.isArray(command) ||
        Object.keys(command).some(
          (field) => !Object.hasOwn(changeFields, field),
        )
      )
        throw new Error("payload_rejected");
      const put: Array<{ key: string; [field: string]: unknown }> = [];
      const remove: string[] = [];
      const touched = new Set<string>();
      const add = (key: string, value: object | null | undefined) => {
        if (value === undefined) return;
        if (
          touched.has(key) ||
          (value !== null &&
            (typeof value !== "object" || Array.isArray(value)))
        )
          throw new Error("payload_rejected");
        touched.add(key);
        if (value === null) remove.push(key);
        else put.push({ ...value, key });
      };
      for (const field of Object.keys(singletonKeys) as Array<
        keyof typeof singletonKeys
      >)
        add(singletonKeys[field], command[field]);
      for (const change of command.reconnects ?? []) {
        if (
          typeof change.origin !== "string" ||
          !change.origin ||
          (change.value !== null && change.value.origin !== change.origin)
        )
          throw new Error("policy_unavailable");
        add(`reconnect:${change.origin}`, change.value);
      }
      for (const change of command.deletionEpochs ?? []) {
        if (typeof change.deviceId !== "string" || !change.deviceId)
          throw new Error("payload_rejected");
        add(`deletion-epoch:${change.deviceId}`, change.value);
      }
      for (const change of command.deletionReceipts ?? []) {
        if (
          typeof change.deviceId !== "string" ||
          !change.deviceId ||
          (change.value !== null && change.value.device_id !== change.deviceId)
        )
          throw new Error("policy_unavailable");
        add(`deletion-receipt:${change.deviceId}`, change.value);
      }
      await ledger.policyTransaction(put, remove, guard);
    },
    claimMonthly: (namespace, month, deviceId, deletionEpoch) =>
      ledger.claimMonthly(namespace, month, deviceId, deletionEpoch),
    claimPersonalMonthly: (namespace, month) =>
      ledger.claimPersonalMonthly(namespace, month),
    async readMethodCatalog(namespace) {
      const saved = await ledger.get<StoredMethodCatalog & { key: string }>(
        "method_catalogs",
        namespace,
      );
      return saved === undefined
        ? undefined
        : { catalog: domainValue(saved)!, revision: payloadHash(saved) };
    },
    methodCatalogDigest: (catalog) =>
      payloadHash({ ...catalog, key: catalog.namespace }),
    commitMethodCatalog: (namespace, catalog, expected, validNow) =>
      ledger.commitMethodCatalog(
        namespace,
        { ...catalog, key: namespace },
        expected,
        validNow,
      ),
    health: (namespace, code) => ledger.health(namespace, code),
    async listHealth(namespace, limit = 1000) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
        throw new Error("payload_rejected");
      return (
        await ledger.list<StoredHealth & { key: string }>(
          "health",
          namespace,
          limit,
        )
      ).map((row) => domainValue(row)!);
    },
    onHealthFailure: (listener) => ledger.onHealthFailure(listener),
    resolveHealth: (namespace, codes) => ledger.resolveHealth(namespace, codes),
    onHealthResolved: (listener) => ledger.onHealthResolved(listener),
    recordModelLabel: (namespace, site, label) =>
      ledger.recordModelLabel(namespace, site, label),
    async listModelLabels(namespace) {
      return (
        await ledger.list<StoredModelLabel & { key: string }>(
          "model_labels",
          namespace,
          MODEL_LABEL_LIMIT,
        )
      )
        .map((row) => domainValue(row)!)
        .sort((a, b) => b.lastAt - a.lastAt || a.label.localeCompare(b.label));
    },
  };
}
