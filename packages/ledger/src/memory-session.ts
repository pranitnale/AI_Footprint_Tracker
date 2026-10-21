import {
  canonicalJson,
  payloadHash,
  ReasonCodeSchema,
  SiteSchema,
  type ReasonCode,
} from "@footprint/contracts";
import {
  MODEL_LABEL_LIMIT,
  MODEL_LABEL_PATTERN,
  healthSolved,
  type SessionStateRepository,
  type MethodCatalogRepository,
  type HealthRepository,
  type ModelLabelRepository,
  type SessionMaintenanceEntry,
  type SessionChanges,
} from "./session-contracts";
import {
  MemoryKernel,
  clone,
  routing,
  authority,
  refreshHistoryAuthority,
  methodTrust,
  guardCurrent,
  invalidate,
  epoch,
  limitOf,
} from "./memory-core";

export function createMemorySession(
  k: MemoryKernel,
): SessionStateRepository &
  MethodCatalogRepository &
  HealthRepository &
  ModelLabelRepository {
  return {
    readSettings: () => k.read((s) => s.session.settings),
    readPersonal: () => k.read((s) => s.session.personal),
    readInstallation: () => k.read((s) => s.session.installation),
    readOwnershipHistory: () => k.read((s) => s.session.ownership),
    readCredentials: () => k.read((s) => s.session.credentials),
    readPendingConnection: () => k.read((s) => s.session.pendingConnection),
    readPendingPolicy: () => k.read((s) => s.session.pendingPolicy),
    readRefreshOperation: () => k.read((s) => s.session.refreshOperation),
    readReconnect: (origin) => k.read((s) => s.session.reconnects?.[origin]),
    readDeletionEpoch: (deviceId) =>
      k.read((s) => s.session.deletionEpochs?.[deviceId]),
    readDeletionReceipt: (deviceId) =>
      k.read((s) => s.session.deletionReceipts?.[deviceId]),
    readMonthlyClaim: (namespace) =>
      k.read((s) => s.session.monthly?.[namespace]),
    routingSnapshot: () => k.read(routing),
    onRoutingChange: (listener) => {
      k.routingListeners.add(listener);
      return () => {
        k.routingListeners.delete(listener);
      };
    },
    listSessionMaintenance: () =>
      k.read((s) => {
        const rows: SessionMaintenanceEntry[] = [];
        if (s.session.credentials)
          rows.push({ kind: "active", session: s.session.credentials });
        for (const session of Object.values(s.session.reconnects ?? {}))
          rows.push({ kind: "reconnect", session: session as any });
        for (const receipt of Object.values(s.session.deletionReceipts ?? {}))
          rows.push({ kind: "deletion_receipt", receipt: receipt as any });
        return rows;
      }),
    async applySessionChanges(changes, expected) {
      const command = clone(changes),
        guard = clone(expected);
      const fields = [
        "settings",
        "personal",
        "installation",
        "ownershipHistory",
        "credentials",
        "pendingConnection",
        "pendingPolicy",
        "refreshOperation",
        "reconnects",
        "deletionEpochs",
        "deletionReceipts",
      ];
      if (
        !command ||
        typeof command !== "object" ||
        Array.isArray(command) ||
        Object.keys(command).some((f) => !fields.includes(f))
      )
        throw new Error("payload_rejected");
      await k.mutate("applySessionChanges", (s) => {
        const oldAuthority = authority(s).fingerprint;
        const current = s.session.credentials;
        if (
          guard &&
          ((current?.device_id ?? null) !== guard.deviceId ||
            (guard.refreshToken !== undefined &&
              current?.refresh_token !== guard.refreshToken))
        )
          throw new Error("auth_reconnect_required");
        for (const field of fields.slice(0, 8) as Array<keyof SessionChanges>) {
          const value = command[field];
          if (value === undefined) continue;
          if (
            value !== null &&
            (typeof value !== "object" || Array.isArray(value))
          )
            throw new Error("payload_rejected");
          const key = field === "ownershipHistory" ? "ownership" : field;
          if (value === null) delete s.session[key];
          else s.session[key] = value;
        }
        const seen = new Set<string>();
        for (const field of [
          "reconnects",
          "deletionEpochs",
          "deletionReceipts",
        ] as const) {
          for (const change of command[field] ?? []) {
            const id = "origin" in change ? change.origin : change.deviceId;
            if (typeof id !== "string" || !id)
              throw new Error("payload_rejected");
            if (seen.has(`${field}:${id}`)) throw new Error("payload_rejected");
            seen.add(`${field}:${id}`);
            if (
              change.value !== null &&
              (typeof change.value !== "object" || Array.isArray(change.value))
            )
              throw new Error("payload_rejected");
            if (
              field === "reconnects" &&
              change.value !== null &&
              (change.value as any).origin !== id
            )
              throw new Error("policy_unavailable");
            if (
              field === "deletionReceipts" &&
              change.value !== null &&
              (change.value as any).device_id !== id
            )
              throw new Error("policy_unavailable");
            const map = (s.session[field] ??= Object.create(null));
            if (change.value === null) delete map[id];
            else map[id] = change.value;
          }
        }
        if (oldAuthority !== authority(s).fingerprint)
          refreshHistoryAuthority(s);
      });
      if (
        ["personal", "credentials", "ownershipHistory"].some((f) =>
          Object.hasOwn(command, f),
        )
      )
        for (const listener of k.routingListeners) {
          try {
            listener();
          } catch {}
        }
    },
    claimMonthly: (namespace, month, deviceId, deletionEpoch) =>
      k.mutate("claimMonthly", (s) => {
        const c = s.session.credentials,
          previous = s.monthly.get(namespace);
        const allowed =
          c?.namespace === namespace &&
          c.device_id === deviceId &&
          c.policy.deletion_epoch === deletionEpoch &&
          (!c.enrollment_state || c.enrollment_state === "active") &&
          (!previous || previous < month) &&
          !s.erasedNamespaces.has(namespace);
        if (allowed) {
          s.monthly.set(namespace, month);
          (s.session.monthly ??= {})[namespace] = {
            namespace,
            month,
            claimedAt: k.now(),
          };
        }
        return allowed;
      }),
    claimPersonalMonthly: (namespace, month) =>
      k.mutate("claimPersonalMonthly", (s) => {
        const previous = s.monthly.get(namespace),
          allowed =
            s.session.personal?.namespace === namespace &&
            (!previous || previous < month) &&
            !s.erasedNamespaces.has(namespace);
        if (allowed) {
          s.monthly.set(namespace, month);
          (s.session.monthly ??= {})[namespace] = {
            namespace,
            month,
            claimedAt: k.now(),
          };
        }
        return allowed;
      }),
    readMethodCatalog: (namespace) =>
      k.read((s) => {
        const catalog = s.catalogs.get(namespace);
        return catalog
          ? { catalog, revision: payloadHash({ ...catalog, key: namespace }) }
          : undefined;
      }),
    methodCatalogDigest: (catalog) =>
      payloadHash({ ...catalog, key: catalog.namespace }),
    commitMethodCatalog: (namespace, catalog, expected, validNow) => {
      const value = clone(catalog),
        guard = clone(expected);
      return k.mutate(
        "commitMethodCatalog",
        (s) => {
          if (
            value.namespace !== namespace ||
            new TextEncoder().encode(canonicalJson(value)).length >
              8 * 1024 * 1024
          )
            throw new Error("method_update_invalid");
          const r = routing(s),
            old = s.catalogs.get(namespace);
          if (
            methodTrust(s) !== guard.trust ||
            (r.ownership?.start ?? null) !== guard.ownershipStart ||
            r.credentials?.namespace !== namespace ||
            (r.credentials.enrollment_state &&
              r.credentials.enrollment_state !== "active") ||
            (old ? payloadHash({ ...old, key: namespace }) : null) !==
              guard.previousHash ||
            !guardCurrent(s, namespace, {
              erasureVersion: guard.erasureVersion,
              dependencies: [],
            }) ||
            !validNow()
          )
            throw new Error("policy_unavailable");
          s.catalogs.set(namespace, value);
          invalidate(s, namespace);
          if (!validNow()) throw new Error("policy_unavailable");
        },
        () => {
          if (!validNow()) throw new Error("policy_unavailable");
        },
      );
    },
    async health(namespace, code) {
      ReasonCodeSchema.parse(code);
      try {
        await k.mutate("health", (s) => {
          const key = `${namespace}:${code}`,
            old = s.health.get(key),
            at = k.now();
          s.health.set(key, {
            namespace,
            code,
            at,
            firstAt: old?.firstAt ?? old?.at ?? at,
            lastAt: at,
            count: Math.min(
              Number.MAX_SAFE_INTEGER,
              (old?.count ?? (old ? 1 : 0)) + 1,
            ),
          });
        });
      } catch (error) {
        for (const listener of k.healthListeners) {
          try {
            (listener as any)(namespace, code, error);
          } catch {}
        }
        throw error;
      }
    },
    listHealth: (namespace, limit = 1000) => {
      limitOf(limit, 1000);
      return k.read((s) =>
        [...s.health.values()]
          .filter((h) => h.namespace === namespace)
          .sort((a, b) =>
            `${a.namespace}:${a.code}`.localeCompare(
              `${b.namespace}:${b.code}`,
            ),
          )
          .slice(0, limit),
      );
    },
    onHealthFailure: (listener) => {
      k.healthListeners.add(listener);
      return () => {
        k.healthListeners.delete(listener);
      };
    },
    async resolveHealth(namespace, codes) {
      const unique = [...new Set(codes)].map((code) =>
        ReasonCodeSchema.parse(code),
      );
      for (const listener of k.healthResolvedListeners) {
        try {
          listener(namespace, unique);
        } catch {}
      }
      // Matches the IndexedDB ledger: nothing open means nothing is written.
      const open = await k.read((s) =>
        unique.flatMap((code) => {
          const row = s.health.get(`${namespace}:${code}`);
          return row && !healthSolved(row)
            ? [[code, row.lastAt ?? row.at] as const]
            : [];
        }),
      );
      if (!open.length) return [];
      return k.mutate("health", (s) => {
        const at = k.now(),
          closed: ReasonCode[] = [];
        for (const [code, seen] of open) {
          const row = s.health.get(`${namespace}:${code}`);
          // A failure written since the check came after this success, so it stays open.
          if (!row || healthSolved(row) || (row.lastAt ?? row.at) !== seen)
            continue;
          s.health.set(`${namespace}:${code}`, {
            ...row,
            resolvedAt: Math.max(at, seen),
          });
          closed.push(code);
        }
        return closed;
      });
    },
    onHealthResolved: (listener) => {
      k.healthResolvedListeners.add(listener);
      return () => {
        k.healthResolvedListeners.delete(listener);
      };
    },
    async recordModelLabel(namespace, site, label) {
      SiteSchema.parse(site);
      if (!MODEL_LABEL_PATTERN.test(label)) throw new Error("payload_rejected");
      await k.mutate("recordModelLabel", (s) => {
        const key = `${namespace}:${site}:${label}`,
          previous = s.modelLabels.get(key),
          at = k.now();
        if (!previous) {
          const rows = [...s.modelLabels.values()]
            .filter((row) => row.namespace === namespace)
            .sort((a, b) => a.lastAt - b.lastAt || a.key.localeCompare(b.key));
          for (const row of rows.slice(
            0,
            Math.max(0, rows.length - MODEL_LABEL_LIMIT + 1),
          ))
            s.modelLabels.delete(row.key);
        }
        s.modelLabels.set(key, {
          key,
          namespace,
          site,
          label,
          firstAt: previous?.firstAt ?? at,
          lastAt: at,
          count: Math.min(Number.MAX_SAFE_INTEGER, (previous?.count ?? 0) + 1),
        });
      });
    },
    listModelLabels: (namespace) =>
      k.read((s) =>
        [...s.modelLabels.values()]
          .filter((row) => row.namespace === namespace)
          .map(({ key: _, ...row }) => row)
          .sort(
            (a, b) => b.lastAt - a.lastAt || a.label.localeCompare(b.label),
          ),
      ),
  };
}
