import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  Ledger,
  createMemoryRepository,
  type Scope,
  type StoredCredentials,
} from "@footprint/ledger";
import {
  canonicalJson,
  UNAVAILABLE_ADMISSION_METHOD_ID,
  type EngineId,
  type EstimationEnvelope,
} from "@footprint/contracts";
import {
  createMethodRegistry,
  LocalEstimateExecutor,
  type NumericObservationInput,
} from "@footprint/estimator";
import { archivedConfiguration as config } from "./archived-engine-fixture";
import mappings from "../../../config/estimation.mappings.json";
import media from "../../../config/estimation.media.json";
import { records } from "../../../packages/ledger/test/factory";
import { EngineService } from "../lib/estimation/service";

const timestamp = "2026-09-15T12:00:00.000Z";
const registries = {
  original: createMethodRegistry(
    { ...config, default_engine: "original" },
    mappings,
    media,
  ),
  ecologits: createMethodRegistry(
    { ...config, default_engine: "ecologits" },
    mappings,
    media,
  ),
};
const captureExecutor = new LocalEstimateExecutor(registries.original);
type Backend = "indexeddb" | "memory";
type Seed = {
  scope: Scope;
  pair: ReturnType<typeof records>;
  original: Readonly<EstimationEnvelope> | null;
};

function credentials(namespace: string, era: string): StoredCredentials {
  return {
    origin: "https://build-transition.example",
    namespace,
    company_id: crypto.randomUUID(),
    user_id: crypto.randomUUID(),
    device_id: crypto.randomUUID(),
    access_token: "synthetic-access",
    refresh_token: "synthetic-refresh",
    access_expires_at: "2099-01-01T00:00:00.000Z",
    refresh_expires_at: "2099-01-01T00:00:00.000Z",
    installation_reconnect_secret: "synthetic-reconnect",
    deletion_receipt_credential: "synthetic-receipt",
    deletion_public_key: "synthetic-deletion-key",
    user_hmac_key: "b".repeat(64),
    key_version: "1",
    policy: {
      policy_version: "1.0.0",
      disclosure_version: "1.0.0",
      pause_mode: "user_controlled",
      timezone: "UTC",
      usage_retention_months: null,
      ip_retention_days: 0,
      deletion_epoch: 0,
    },
    enrollment_era: { id: era, start: timestamp, end: null },
  };
}

async function fixture(
  t: test.TestContext,
  backend: Backend,
  mode: "personal" | "company" = "personal",
) {
  const name = `build-default-transition-${crypto.randomUUID()}`;
  let db = backend === "indexeddb" ? await Ledger.open(name) : null;
  let repository = db?.application ?? createMemoryRepository();
  const personal = {
    namespace: `personal:${crypto.randomUUID()}`,
    secret: "a".repeat(64),
  };
  const scope: Scope =
    mode === "personal"
      ? { namespace: personal.namespace, mode, era: null }
      : {
          namespace: `company:${crypto.randomUUID()}`,
          mode,
          era: crypto.randomUUID(),
        };
  const state = { scope, token: 1 };
  await repository.applySessionChanges({
    personal,
    installation: { routingSecret: "c".repeat(64) },
    ...(mode === "company"
      ? { credentials: credentials(scope.namespace, scope.era!) }
      : {}),
    ownershipHistory: {
      eras: [
        {
          scope,
          secret: "a".repeat(64),
          policyVersion: "1.0.0",
          start: 0,
          end: null,
        },
      ],
    },
  });
  const services: EngineService[] = [];
  const seeds: Seed[] = [];
  function openService(engine: EngineId) {
    const methods = registries[engine];
    const executor = new LocalEstimateExecutor(methods);
    const calls: Array<{
      input: NumericObservationInput;
      methodId: string | undefined;
    }> = [];
    const service = new EngineService(
      repository.estimation,
      methods,
      {
        executionOrigin: "local",
        estimate: (input, options) => {
          calls.push({ input, methodId: options?.methodId });
          return executor.estimate(input, options);
        },
      },
      async () => {
        const token = state.token;
        return {
          scope: { ...state.scope },
          token: String(token),
          current: async () => {
            if (state.token !== token) throw new Error("policy_unavailable");
          },
        };
      },
      undefined,
      () => Date.parse(timestamp),
    );
    services.push(service);
    return { service, calls, methods };
  }
  async function seed(engine: EngineId | "not_admitted") {
    const pair = records();
    pair[0].state = "completed";
    pair[0].ended_at = pair[0].dispatched_at;
    pair[1].state = "completed";
    pair[1].ended_at = pair[1].started_at;
    pair[1].proposed_method_id =
      engine === "not_admitted"
        ? UNAVAILABLE_ADMISSION_METHOD_ID
        : registries.original[engine].method_id;
    const original =
      engine === "not_admitted"
        ? null
        : await captureExecutor.estimate({
            family: "live",
            request: pair[0],
            attempt: pair[1],
          });
    const sourceScope = { ...state.scope };
    await repository.commitCapture({
      scope: sourceScope,
      observations: pair,
      ...(original
        ? {
            originals: [original],
            currentEstimate: {
              attemptId: pair[1].attempt_id,
              estimate: original,
            },
          }
        : {}),
    });
    const saved = { scope: sourceScope, pair, original };
    seeds.push(saved);
    return saved;
  }
  async function reopen(engine: EngineId) {
    for (const service of services) service.dispose();
    if (db) {
      db.close();
      db = await Ledger.open(name);
      repository = db.application;
    }
    return openService(engine);
  }
  async function advanceEra() {
    const before = (await repository.readOwnershipHistory())!;
    const c = (await repository.readCredentials())!;
    const next = { ...state.scope, era: crypto.randomUUID() };
    await repository.applySessionChanges(
      {
        credentials: {
          ...c,
          device_id: crypto.randomUUID(),
          enrollment_era: { ...c.enrollment_era, id: next.era },
        },
        ownershipHistory: {
          eras: [
            ...before.eras.slice(0, -1),
            { ...before.eras.at(-1)!, end: 1 },
            { ...before.eras.at(-1)!, scope: next, start: 1, end: null },
          ],
        },
      },
      { deviceId: c.device_id, refreshToken: c.refresh_token },
    );
    state.scope = next;
    state.token++;
  }
  async function preserved() {
    for (const saved of seeds) {
      for (const record of saved.pair) {
        const id =
          record.kind === "request" ? record.request_id : record.attempt_id;
        assert.equal(
          canonicalJson(
            (await repository.getRecord(saved.scope.namespace, record.kind, id))
              ?.record,
          ),
          canonicalJson(record),
        );
      }
      const rows = (
        await repository.estimation.viewPage({
          scope: saved.scope,
          view: "original",
        })
      ).rows;
      const row = rows.find(
        (entry) =>
          entry.input?.family === "live" &&
          entry.input.attempt.attempt_id === saved.pair[1].attempt_id,
      );
      assert.ok(row);
      assert.equal(canonicalJson(row.result), canonicalJson(saved.original));
    }
  }
  async function finish(service: EngineService) {
    for (let pass = 0; pass < 4; pass++) {
      await service.maintainLocal();
      if (!(await service.view(state.scope)).pending) return;
    }
    assert.fail(
      "The authorized calculation did not complete within four bounded maintenance passes",
    );
  }
  t.after(() => {
    for (const service of services) service.dispose();
    db?.close();
  });
  return {
    get repository() {
      return repository;
    },
    state,
    openService,
    seed,
    reopen,
    advanceEra,
    preserved,
    finish,
  };
}

for (const backend of ["indexeddb", "memory"] as const) {
  for (const [from, to] of [
    ["ecologits", "original"],
    ["original", "ecologits"],
  ] as const) {
    test(`${backend}: build_default ${from} to ${to} recalculates originals saved before maintenance`, async (t) => {
      const f = await fixture(t, backend);
      const first = f.openService(from);
      assert.equal((await first.service.admission()).engine_id, from);
      const saved = await f.seed(from);
      const untouched = await f.repository.estimation.state(f.state.scope);
      assert.equal(untouched.active, null);
      assert.equal(untouched.selected, null);
      assert.equal(
        untouched.uniformOriginalMethodHash,
        first.methods[from].method_hash,
      );
      const next = await f.reopen(to);
      const pending = await next.service.status();
      assert.equal(pending.preference, "build_default");
      assert.equal(pending.selectionRevision, 1);
      assert.equal(pending.effectiveEngine, to);
      assert.equal(pending.local.status, "pending");
      assert.equal((await next.service.view(f.state.scope)).pending, true);
      assert.equal(next.calls.length, 0);
      await f.finish(next.service);
      const view = await next.service.view(f.state.scope);
      assert.equal(view.pending, false);
      assert.equal(view.view, "recalculated");
      assert.equal(view.method?.method_hash, next.methods[to].method_hash);
      const result = await view.estimate({
        family: "live",
        request: saved.pair[0],
        attempt: saved.pair[1],
      });
      assert.equal(result?.requested_method.engine_id, to);
      assert.equal(
        result?.original_method_hash,
        saved.original!.requested_method.method_hash,
      );
      assert.equal(next.calls.length, 1);
      await next.service.maintainLocal();
      assert.equal(next.calls.length, 1);
      assert.equal((await next.service.status()).local.status, "complete");
      await f.preserved();
    });
  }

  for (const count of [0, 2]) {
    test(`${backend}: unchanged Original default with ${count} matching inputs requires no executor calls`, async (t) => {
      const f = await fixture(t, backend);
      const first = f.openService("original");
      await first.service.admission();
      for (let i = 0; i < count; i++) await f.seed("original");
      const next = await f.reopen("original");
      const status = await next.service.status();
      assert.equal(status.local.status, "complete");
      const view = await next.service.view(f.state.scope);
      assert.equal(view.view, "original");
      assert.equal(view.pending, false);
      assert.equal(view.method, null);
      for (let i = 0; i < 3; i++) await next.service.maintainLocal();
      assert.equal(next.calls.length, 0);
      const state = await f.repository.estimation.state(f.state.scope);
      assert.equal(state.active, null);
      assert.equal(state.selected, null);
      assert.equal(state.inputCount, count);
      if (count)
        assert.equal(
          state.uniformOriginalMethodHash,
          next.methods.original.method_hash,
        );
      await f.preserved();
    });
  }

  test(`${backend}: an explicit Eco preference wins over a changed Original build default`, async (t) => {
    const f = await fixture(t, backend);
    const first = f.openService("ecologits");
    await first.service.admission();
    await f.seed("ecologits");
    assert.equal(
      await f.repository.estimation.compareAndSetPreference(1, {
        schema_version: "1.0.0",
        preference: "ecologits",
        selection_revision: 2,
        updated_at: timestamp,
      }),
      true,
    );
    const next = await f.reopen("original");
    const before = await next.service.status();
    assert.equal(before.buildDefault, "original");
    assert.equal(before.preference, "ecologits");
    assert.equal(before.selectionRevision, 2);
    assert.equal(before.effectiveEngine, "ecologits");
    await f.finish(next.service);
    assert.equal(
      (await next.service.view(f.state.scope)).method?.method_hash,
      next.methods.ecologits.method_hash,
    );
    assert.equal(next.calls.length, 1);
    await f.preserved();
  });

  test(`${backend}: mixed Original and Eco inputs cannot use the Original shortcut`, async (t) => {
    const f = await fixture(t, backend);
    await f.openService("ecologits").service.admission();
    await f.seed("ecologits");
    await f.seed("original");
    const next = await f.reopen("original");
    const proof = await f.repository.estimation.state(f.state.scope);
    assert.equal(proof.inputCount, 2);
    assert.equal(proof.uniformOriginalMethodHash, null);
    assert.equal((await next.service.status()).local.status, "pending");
    await f.finish(next.service);
    assert.equal(
      (await next.service.view(f.state.scope)).method?.engine_id,
      "original",
    );
    const rows = (
      await f.repository.estimation.viewPage({
        scope: f.state.scope,
        view: "selected",
      })
    ).rows;
    assert.equal(rows.length, 2);
    assert.ok(
      rows.every(
        (row) =>
          row.result?.requested_method.method_hash ===
          next.methods.original.method_hash,
      ),
    );
    assert.equal(next.calls.length, 2);
    await f.preserved();
  });

  test(`${backend}: retained Eco and current Original eras publish one complete authorized view`, async (t) => {
    const f = await fixture(t, backend, "company");
    await f.openService("ecologits").service.admission();
    const retained = await f.seed("ecologits");
    await f.advanceEra();
    const current = await f.seed("original");
    const next = await f.reopen("original");
    const vector = await f.repository.estimation.localSelectionState(
      f.state.scope,
    );
    assert.equal(vector.members.length, 2);
    assert.equal(
      vector.members.reduce((n, member) => n + member.inputCount, 0),
      2,
    );
    assert.equal((await next.service.view(f.state.scope)).pending, true);
    await f.finish(next.service);
    const view = await next.service.view(f.state.scope);
    assert.equal(view.pending, false);
    assert.equal(view.method?.method_hash, next.methods.original.method_hash);
    for (const saved of [retained, current]) {
      const result = await view.estimate({
        family: "live",
        request: saved.pair[0],
        attempt: saved.pair[1],
      });
      assert.equal(
        result?.requested_method.method_hash,
        next.methods.original.method_hash,
      );
      assert.equal(
        result?.original_method_hash,
        saved.original!.requested_method.method_hash,
      );
    }
    assert.ok(next.calls.length >= 1 && next.calls.length <= 2);
    const used = next.calls.length;
    await next.service.maintainLocal();
    assert.equal(next.calls.length, used);
    await f.preserved();
  });

  for (const target of ["original", "ecologits"] as const) {
    test(`${backend}: numeric-only unadmitted input is pending after the build changes to ${target}`, async (t) => {
      const f = await fixture(t, backend);
      await f
        .openService(target === "original" ? "ecologits" : "original")
        .service.admission();
      const saved = await f.seed("not_admitted");
      const next = await f.reopen(target);
      const proof = await f.repository.estimation.state(f.state.scope);
      assert.equal(proof.inputCount, 1);
      assert.equal(proof.uniformOriginalMethodHash, null);
      assert.equal((await next.service.view(f.state.scope)).pending, true);
      await f.finish(next.service);
      const view = await next.service.view(f.state.scope);
      const result = await view.estimate({
        family: "live",
        request: saved.pair[0],
        attempt: saved.pair[1],
      });
      assert.ok(result);
      assert.equal(result.requested_method.engine_id, target);
      assert.equal(result.original_method_hash, null);
      assert.ok(result.reasons.includes("original_method_missing"));
      assert.equal(next.calls.length, 1);
      await f.preserved();
    });
  }
}
