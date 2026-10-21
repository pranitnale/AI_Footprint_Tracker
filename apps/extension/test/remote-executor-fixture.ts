import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { TestContext } from "node:test";
import {
  Ledger,
  createMemoryRepository,
  type Scope,
  type StoredCredentials,
} from "@footprint/ledger";
import {
  EstimationEnvelopeSchema,
  payloadHash,
  type EstimationEnvelope,
} from "@footprint/contracts";
import {
  createRemoteEstimateExecutor,
  LocalEstimateExecutor,
  type EstimateExecutor,
  type RemoteEstimateRequest,
  type RemoteExecutorConfiguration,
} from "@footprint/estimator";
import { archivedEstimation } from "./archived-engine-fixture";
const packagedMethods = archivedEstimation.methods;
import { composeRuntime } from "../lib/runtime-composition";
import { scanSummary } from "../lib/summary-scan";
import { countByTextLength } from "./counting-fixture";
import { records } from "../../../packages/ledger/test/factory";

export const methods = packagedMethods;
export const local = new LocalEstimateExecutor(methods);
const catalog = {
  identity: methods.ecoDefinition.core,
  json: readFileSync(
    new URL(
      "../../../packages/ecologits-core/data/catalog.json",
      import.meta.url,
    ),
    "utf8",
  ),
};
export type Backend = "indexeddb" | "memory";
type Mode = "personal" | "disconnected" | "company";
const timestamp = "2026-09-15T12:00:00.000Z";

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function credentials(scope: Scope): StoredCredentials {
  return {
    origin: "https://remote-boundary.example",
    namespace: scope.namespace,
    company_id: crypto.randomUUID(),
    user_id: crypto.randomUUID(),
    device_id: crypto.randomUUID(),
    access_token: "synthetic-access",
    refresh_token: "synthetic-refresh",
    access_expires_at: "2099-01-01T00:00:00.000Z",
    refresh_expires_at: "2099-01-01T00:00:00.000Z",
    installation_reconnect_secret: "synthetic-reconnect",
    deletion_receipt_credential: "synthetic-receipt",
    deletion_public_key: "synthetic-key",
    user_hmac_key: "b".repeat(64),
    key_version: "1",
    enrollment_state: "active",
    policy: {
      policy_version: "1.0.0",
      disclosure_version: "1.0.0",
      pause_mode: "user_controlled",
      timezone: "UTC",
      usage_retention_months: null,
      ip_retention_days: 0,
      deletion_epoch: 0,
    },
    enrollment_era: { id: scope.era!, start: timestamp, end: null },
  };
}

export async function boundaryFixture(
  t: TestContext,
  backend: Backend,
  mode: Mode = "company",
) {
  const name = `remote-boundary-${crypto.randomUUID()}`;
  let db = backend === "indexeddb" ? await Ledger.open(name) : null;
  let repository = db?.application ?? createMemoryRepository();
  const personal = {
    namespace: `personal:${crypto.randomUUID()}`,
    secret: "a".repeat(64),
  };
  const personalScope: Scope = {
    namespace: personal.namespace,
    mode: "personal",
    era: null,
  };
  const companyScope: Scope = {
    namespace: `company:${crypto.randomUUID()}`,
    mode: "company",
    era: crypto.randomUUID(),
  };
  const company = credentials(companyScope);
  const state = { scope: mode === "company" ? companyScope : personalScope };
  const ownership = {
    scope: state.scope,
    secret: "a".repeat(64),
    policyVersion: "1.0.0",
    start: 0,
    end: null,
  };
  await repository.applySessionChanges({
    personal,
    installation: { routingSecret: "c".repeat(64) },
    ownershipHistory: { eras: [ownership] },
    ...(mode === "company" ? { credentials: company } : {}),
    ...(mode === "disconnected"
      ? {
          reconnects: [
            {
              origin: company.origin,
              value: {
                ...company,
                disconnect_pending: true,
                disconnect_operation_id: crypto.randomUUID(),
              },
            },
          ],
        }
      : {}),
  });
  const runtimes: ReturnType<typeof composeRuntime>[] = [];
  let networkCalls = 0;
  function runtime(executor?: EstimateExecutor) {
    const result = composeRuntime(
      repository,
      {
        count: countByTextLength,
        hasConsent: async () => true,
        transport: async () => {
          networkCalls++;
          throw new Error("unexpected network request");
        },
        ...(executor ? { estimation: { methods, executor } } : {}),
      },
      {
        currentScope: async () => state.scope,
        selectedServerSummary: async () =>
          assert.fail("unexpected server summary"),
        estimateCanonical: async () =>
          assert.fail("unexpected canonical callback"),
        promoteRecordedCapture: async () =>
          assert.fail("unexpected recorded capture"),
        scanSelected: (scope) => scanSummary(repository, scope.namespace),
      },
    );
    runtimes.push(result);
    return result;
  }
  function dispose() {
    for (const current of runtimes) {
      current.engines.dispose();
      current.methods.invalidate();
      current.history.invalidate();
    }
  }
  t.after(() => {
    dispose();
    db?.close();
  });
  return {
    get repository() {
      return repository;
    },
    get networkCalls() {
      return networkCalls;
    },
    state,
    runtime,
    async reopen() {
      dispose();
      // Only IndexedDB models durable reopen; memory keeps its in-process domain state.
      if (db) {
        db.close();
        db = await Ledger.open(name);
        repository = db.application;
      }
    },
    async disconnect() {
      await repository.applySessionChanges({
        credentials: null,
        ownershipHistory: {
          eras: [
            { ...ownership, end: Date.parse(timestamp) },
            {
              ...ownership,
              scope: personalScope,
              start: Date.parse(timestamp),
            },
          ],
        },
      });
      state.scope = personalScope;
    },
  };
}

export async function seed(
  fixture: Awaited<ReturnType<typeof boundaryFixture>>,
) {
  const pair = records();
  pair[0].state = pair[1].state = "completed";
  pair[0].ended_at = pair[0].dispatched_at;
  pair[1].ended_at = pair[1].started_at;
  pair[1].proposed_method_id = methods.original.method_id;
  const input = { family: "live" as const, request: pair[0], attempt: pair[1] };
  const original = await local.estimate(input);
  await fixture.repository.commitCapture({
    scope: fixture.state.scope,
    observations: pair,
    originals: [original],
    currentEstimate: { attemptId: pair[1].attempt_id, estimate: original },
  });
  return { pair, input, original };
}

export async function selectEco(
  fixture: Awaited<ReturnType<typeof boundaryFixture>>,
) {
  assert.equal(
    await fixture.repository.estimation.compareAndSetPreference(null, {
      schema_version: "1.0.0",
      preference: "ecologits",
      selection_revision: 1,
      updated_at: timestamp,
    }),
    true,
  );
}

export async function fakeResponse(request: RemoteEstimateRequest) {
  const result = await local.estimate(request.observation, {
    methodId: request.accepted.requested_method.method_id,
    view: request.accepted.view,
    ...(request.accepted.view === "recalculated"
      ? request.accepted.original_method_hash === null
        ? { originalMethodMissing: true }
        : { originalMethodHash: request.accepted.original_method_hash }
      : {}),
  });
  const envelope = EstimationEnvelopeSchema.parse({
    ...result,
    execution_origin: "organization",
  });
  return {
    schema_version: "1.0.0",
    correlation: request.accepted.correlation,
    envelope,
    output_hash: payloadHash(envelope),
  };
}

/** Synthetic trusted composition only. A future caller must establish capability and authorization before construction. */
export function fakeRemote(
  transport: RemoteExecutorConfiguration["transport"],
  isCurrent: () => boolean = () => true,
) {
  return createRemoteEstimateExecutor({
    methods,
    catalog,
    context: {
      mode: "company",
      organization_key: "d".repeat(64),
      installation_key: "e".repeat(64),
    },
    operation: {
      operation_id: crypto.randomUUID(),
      generation: 1,
      revision: 1,
    },
    retry: { maxAttempts: 1 },
    isCurrent,
    transport,
  });
}

export function sourceGuard(result: EstimationEnvelope) {
  assert.equal(result.source.family, "live");
  if (result.source.family !== "live") throw new Error("expected live fixture");
  return {
    requestId: result.source.request_id,
    requestRevision: result.source.request_revision,
    requestHash: result.source.request_hash,
    attemptId: result.source.attempt_id,
    attemptRevision: result.source.attempt_revision,
    attemptHash: result.source.attempt_hash,
  };
}
