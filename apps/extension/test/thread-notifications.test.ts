import { FileGrantBroker } from "../lib/file-grant-broker";
import * as ownReadPause from "../lib/own-read-pause";
import * as ownReadSettings from "../lib/own-read-settings";
import * as trackingConsent from "../lib/tracking-consent";
import { PACKAGED_COUNTING_RUNTIME } from "../lib/counting-config";
import * as fileRelayProtocol from "../lib/file-relay-protocol";
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { unavailableCount } from "./counting-fixture";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { Ledger, type Scope, type ApplicationRepository } from "@footprint/ledger";
import * as adapters from "@footprint/adapters";
import * as capture from "@footprint/capture-core";
import { canonicalJson } from "@footprint/contracts";
import { Coordinator } from "../lib/coordinator";
import { HistoryAdmission } from "../lib/history-admission";
import { RouteAuthorities } from "../lib/route-authority";
import * as bridge from "../lib/bridge";
import * as notifications from "../lib/scope-notifications";
import { transitionOwnership, type OwnershipHistory } from "../lib/ownership";
import { records } from "../../../packages/ledger/test/factory";
async function fixture() {
  const db = await Ledger.open("thread-notification-" + crypto.randomUUID());
  const signer = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);
  const b64 = (data: ArrayBuffer) => Buffer.from(data).toString("base64url");
  let credentials: any,
    relationCalls = 0;
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
          deletion_epoch: 0,
          current_deletion_epoch: 0,
          changes: [],
          has_more: false,
          issued_at: new Date().toISOString(),
          retention_cutoff: null,
        };
        return new Response(
          JSON.stringify({
            instruction,
            algorithm: "Ed25519",
            key_version: "1",
            signature: b64(
              await crypto.subtle.sign(
                "Ed25519",
                signer.privateKey,
                new TextEncoder().encode(canonicalJson(instruction)),
              ),
            ),
          }),
        );
      }
      if (path === "/v1/deletions/ack")
        return new Response(JSON.stringify({ acknowledged: true }));
      if (path === "/v1/config")
        return new Response(JSON.stringify({ policy: credentials.policy }));
      if (path === "/v1/health/reports")
        return new Response(JSON.stringify({ received: true }));
      assert.equal(path, "/v1/me/thread-relations");
      relationCalls++;
      return new Response(
        JSON.stringify({ error: { code: "thread_relation_conflict" } }),
        { status: 409 },
      );
    }) as typeof fetch,
  });
  await c.whenReady();
  async function connect() {
    const company = crypto.randomUUID(),
      user = crypto.randomUUID(),
      era = crypto.randomUUID();
    const scope: Scope = {
      namespace: `company:${company}:${user}`,
      mode: "company",
      era,
    };
    credentials = {
      key: "credentials",
      namespace: scope.namespace,
      company_id: company,
      user_id: user,
      device_id: crypto.randomUUID(),
      origin: "https://company.example",
      user_hmac_key: "a".repeat(64),
      access_token: "synthetic-access",
      refresh_token: "synthetic-refresh",
      access_expires_at: new Date(Date.now() + 600000).toISOString(),
      deletion_receipt_credential: "synthetic-receipt",
      deletion_public_key: b64(
        await crypto.subtle.exportKey("raw", signer.publicKey),
      ),
      enrollment_era: { id: era, start: new Date().toISOString(), end: null },
      policy: {
        policy_version: "1.0.0",
        deletion_epoch: 0,
        pause_mode: "user_controlled",
      },
    };
    const history = (await db.get<OwnershipHistory>(
      "policy",
      "ownership-history",
    ))!;
    await db.policyTransaction([
      credentials,
      transitionOwnership(history, {
        scope,
        secret: credentials.user_hmac_key,
        policyVersion: "1.0.0",
      }) as any,
    ]);
    return { scope, credentials };
  }
  const current = await connect(),
    pair = records();
  pair[0].site = "perplexity";
  pair[0].provider_request_key = "b".repeat(64);
  await db.commit(current.scope, pair);
  await db.linkRecordedThread(
    current.scope,
    "c".repeat(64),
    ["b".repeat(64)],
    0,
  );
  const acknowledge = async () => {
    const rows = await db.pending(current.scope.namespace);
    await db.acknowledge(
      current.scope.namespace,
      crypto.randomUUID(),
      rows.map((row) => ({
        kind: row.kind,
        id: row.id,
        revision: row.revision,
        payload_hash: row.hash,
        server_record_version: row.revision,
        status: "applied",
      })),
      rows,
    );
  };
  await acknowledge();
  return {
    db,
    c,
    ...current,
    pair,
    connect,
    acknowledge,
    calls: () => relationCalls,
  };
}

for (const transient of ["none", "query", "send"] as const)
  test(
    `actual sync alarm commits rejection and recovers ${transient} failure before its distinct notification`,
    { timeout: 10000 },
    async () => {
      const f = await fixture(),
        sent: any[] = [],
        watchers: { settled(): Promise<void>; stop(): void }[] = [];
      let failed = false;
      const health: string[] = [];
      let alarm: (value: { name: string }) => void = () => {},
        ready!: () => void,
        published!: () => void,
        maintenanceDone!: () => void;
      const initialized = new Promise<void>((resolve) => {
          ready = resolve;
        }),
        emitted = new Promise<void>((resolve) => {
          published = resolve;
        }),
        maintained = new Promise<void>((resolve) => {
          maintenanceDone = resolve;
        });
      const originalMaintenance = f.c.company.maintenance.bind(f.c.company);
      f.c.company.maintenance = async () => {
        try {
          await originalMaintenance();
        } finally {
          maintenanceDone();
        }
      };
      const browser: any = {
        runtime: {
          id: "extension",
          getURL: () => "chrome-extension://extension/",
          onMessage: { addListener() {} },
        },
        tabs: {
          onUpdated: { addListener() {} },
          onRemoved: { addListener() {} },
          query: async () => {
            if (transient === "query" && !failed) {
              failed = true;
              throw new Error("synthetic-private-query-marker");
            }
            return [{ id: 7 }];
          },
          sendMessage: async (_tab: number, message: any) => {
            if (transient === "send" && !failed) {
              failed = true;
              throw new Error("synthetic-private-send-marker");
            }
            sent.push(message);
            if (message.target === "footprint-recorded-thread-invalidated") {
              assert.equal(
                (await f.db.all<any>("thread_relations"))[0].rejected,
                true,
              );
              published();
            }
          },
        },
        permissions: {
          onRemoved: { addListener() {} },
          contains: async () => true,
        },
        alarms: {
          onAlarm: {
            addListener: (value: typeof alarm) => {
              alarm = value;
            },
          },
        },
      };
      const modules: Record<string, any> = {
        "wxt/utils/define-background": {
          defineBackground: (run: () => void) => run(),
        },
        "wxt/browser": { browser },
        "@footprint/ledger": { Ledger: { open: async () => f.db } },
        "../lib/counting-config": { PACKAGED_COUNTING_RUNTIME },
        "../lib/coordinator": {
          Coordinator: class {
            constructor() {
              return f.c;
            }
          },
        },
        "../lib/history-admission": { HistoryAdmission },
        "../lib/route-authority": { RouteAuthorities },
        "../lib/bridge": bridge,
        "../lib/file-grant-broker": { FileGrantBroker },
        "../lib/file-relay-protocol": fileRelayProtocol,
        "../lib/scope-notifications": {
          observeThreadInvalidations: async (
            ...args: Parameters<typeof notifications.observeThreadInvalidations>
          ) => {
            const watcher = await notifications.observeThreadInvalidations(
              ...args,
            );
            watchers.push(watcher);
            return watcher;
          },
          observeScopeChanges: async (
            ...args: Parameters<typeof notifications.observeScopeChanges>
          ) => {
            const watcher = await notifications.observeScopeChanges(...args);
            watchers.push(watcher);
            ready();
            return watcher;
          },
        },
        "@footprint/adapters": adapters,
        "@footprint/capture-core": capture,
        "../lib/server-summary": {},
        "../lib/platform": { scheduleSync: async () => {} },
        "@footprint/file-text/types": {},
        "../lib/company": {},
        "../lib/ownership": {},
        "../lib/own-read-pause": ownReadPause,
        "../lib/own-read-settings": ownReadSettings,
        "../lib/tracking-consent": trackingConsent,
        "../lib/health": {
          HealthReporter: class {
            report(code: string) {
              health.push(code);
            }
          },
        },
      };
      const source = readFileSync(
        new URL("../entrypoints/background.ts", import.meta.url),
        "utf8",
      ).replaceAll("import.meta.env.BROWSER", '"firefox"');
      const compiled = ts.transpileModule(source, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
        },
      }).outputText;
      new Function("require", "exports", compiled)((key: string) => {
        assert.ok(Object.hasOwn(modules, key), key);
        return modules[key];
      }, {});
      try {
        await initialized;
        await f.db.commit(f.scope, [
          { ...f.pair[0], revision: 2 },
          { ...f.pair[1], revision: 2 },
        ]);
        await f.acknowledge();
        await f.db.put("policy", {
          ...f.credentials,
          access_token: "synthetic-rotated-token",
        });
        for (const watcher of watchers) await watcher.settled();
        assert.equal(sent.length, 0);
        alarm({ name: "sync" });
        await maintained;
        // Keep this awaited retry alive even when the production backoff timer is unreferenced in Node.
        await new Promise<void>((resolve, reject) => {
          const deadline = setTimeout(
            () => reject(new Error("notification_delivery_timeout")),
            5000,
          );
          emitted.then(resolve, reject).finally(() => clearTimeout(deadline));
        });
        for (const watcher of watchers) await watcher.settled();
        assert.equal(f.calls(), 1);
        assert.equal(failed, transient !== "none");
        assert.equal(
          JSON.stringify(health).includes("synthetic-private"),
          false,
        );
        assert.deepEqual(sent, [
          { target: "footprint-recorded-thread-invalidated" },
        ]);
        assert.equal(
          (await f.db.publicationSnapshot(f.scope.namespace))
            .threadRejectionVersion,
          1,
        );
        assert.equal(
          await f.db.rejectThreadLinks(
            f.scope,
            "c".repeat(64),
            ["b".repeat(64)],
            { erasureVersion: 0, deviceId: f.credentials.device_id },
          ),
          false,
        );
        for (const watcher of watchers) await watcher.settled();
        assert.equal(sent.length, 1);
        await f.db.eraseFamily(f.scope.namespace, f.pair[0].request_id);
        for (const watcher of watchers) await watcher.settled();
        assert.equal(
          (await f.db.publicationSnapshot(f.scope.namespace))
            .threadRejectionVersion,
          0,
        );
        assert.equal(
          sent.filter(
            (message) =>
              message.target === "footprint-recorded-thread-invalidated",
          ).length,
          1,
        );
      } finally {
        for (const watcher of watchers) watcher.stop();
        f.db.close();
      }
    },
  );

for (const change of ["erase", "tenant"] as const)
  test(`a delayed rejection notification is discarded after ${change} changes its scope basis`, async () => {
    const f = await fixture();
    let entered!: () => void,
      release!: () => void,
      emitted = 0;
    const reached = new Promise<void>((resolve) => {
        entered = resolve;
      }),
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
    const observer = await notifications.observeThreadInvalidations(
      f.db,
      () => f.c.currentScope(),
      async (stillCurrent) => {
        entered();
        await gate;
        if (await stillCurrent()) emitted++;
      },
    );
    try {
      await f.db.rejectThreadLinks(f.scope, "c".repeat(64), ["b".repeat(64)], {
        erasureVersion: 0,
        deviceId: f.credentials.device_id,
      });
      await reached;
      if (change === "erase")
        await f.db.eraseFamily(f.scope.namespace, f.pair[0].request_id);
      else await f.connect();
      release();
      await observer.settled();
      assert.equal(emitted, 0);
    } finally {
      observer.stop();
      f.db.close();
    }
  });

for (const failure of ["read", "notify"] as const)
  for (const recovery of ["deliver", "stop", "erase", "tenant"] as const)
    test(`thread invalidation retries ${failure} safely through ${recovery} without another rejection`, async (t) => {
      const f = await fixture();
      t.mock.timers.enable({ apis: ["setTimeout"] });
      let failed = false,
        attempts = 0,
        deliveries = 0;
      const health: string[] = [];
      const observedRepository = {...f.db.application};
      const originalSnapshot = observedRepository.publicationSnapshot;
      const observer = await notifications.observeThreadInvalidations(
        observedRepository,
        () => f.c.currentScope(),
        async (stillCurrent) => {
          attempts++;
          if (failure === "notify" && !failed) {
            failed = true;
            throw new Error("synthetic-secret-notify-marker");
          }
          if (await stillCurrent()) deliveries++;
        },
        (code) => {
          health.push(code);
        },
      );
      if (failure === "read")
        observedRepository.publicationSnapshot = async <G>(...args: Parameters<ApplicationRepository["publicationSnapshot"]>) => {
          if (!failed) {
            failed = true;
            throw new Error("synthetic-secret-read-marker");
          }
          return originalSnapshot<G>(...args);
        };
      try {
        await f.db.rejectThreadLinks(
          f.scope,
          "c".repeat(64),
          ["b".repeat(64)],
          {
            erasureVersion: 0,
            deviceId: f.credentials.device_id,
          },
        );
        await observer.settled();
        assert.equal(failed, true);
        assert.equal(deliveries, 0);
        assert.deepEqual(health, ["sync_delayed"]);
        const initialAttempts = attempts;
        t.mock.timers.tick(249);
        await observer.settled();
        assert.equal(attempts, initialAttempts);
        if (recovery === "stop") observer.stop();
        else if (recovery === "erase")
          await f.db.eraseFamily(f.scope.namespace, f.pair[0].request_id);
        else if (recovery === "tenant") await f.connect();
        t.mock.timers.tick(1);
        await observer.settled();
        assert.equal(deliveries, recovery === "deliver" ? 1 : 0);
        t.mock.timers.tick(60000);
        await observer.settled();
        assert.equal(deliveries, recovery === "deliver" ? 1 : 0);
        assert.deepEqual(health, ["sync_delayed"]);
      } finally {
        observer.stop();
        f.db.close();
      }
    });
