import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { Ledger, type Scope } from "@footprint/ledger";
import {
  canonicalJson,
  type OrganizationSelectionRequest,
  type OrganizationSelectionResponse,
} from "@footprint/contracts";
import {
  createMethodRegistry,
  LocalEstimateExecutor,
  type EstimateExecutor,
} from "@footprint/estimator";
import config from "../../../config/estimation.build.json";
import mappings from "../../../config/estimation.mappings.json";
import media from "../../../config/estimation.media.json";
import { records } from "../../../packages/ledger/test/factory";
import { EngineService } from "../lib/estimation/service";
import { scanSummary } from "../lib/summary-scan";
import { BreakdownObserver } from "../lib/usage-breakdown";
import { sumFixed } from "@footprint/ui/totals";

// Historical dual-engine configurations still exercise saved-record compatibility.
const methods = createMethodRegistry(
  {
    ...config,
    default_engine: "original",
    available_engines: ["original", "ecologits"],
  },
  mappings,
  media,
);
const local = new LocalEstimateExecutor(methods);
const scope: Scope = {
  namespace: "personal:engine-service",
  mode: "personal",
  era: null,
};

test("current builds admit EcoLogits on first use and reject the archived engine", async (t) => {
  const current = createMethodRegistry(config, mappings, media);
  const { service, db } = await setup(
    t,
    new LocalEstimateExecutor(current),
    undefined,
    current,
  );
  assert.equal((await service.admission()).engine_id, "ecologits");
  const before = await db.estimation.readPreferenceState();
  await assert.rejects(
    service.select({ preference: "original", expectedRevision: 1 }),
    /engine_unavailable/,
  );
  assert.deepEqual(await db.estimation.readPreferenceState(), before);
});

test("retired Original preference migrates once and preserves recorded data through recalculation", async (t) => {
  const current = createMethodRegistry(config, mappings, media);
  const { service, db } = await setup(
    t,
    new LocalEstimateExecutor(current),
    undefined,
    current,
  );
  const { original } = await seed(db);
  const observations = canonicalJson(await db.all("measurements"));
  await db.estimation.compareAndSetPreference(null, {
    schema_version: "1.0.0",
    preference: "original",
    selection_revision: 1,
    updated_at: "2026-09-15T00:00:00.000Z",
  });
  assert.equal((await service.admission()).engine_id, "ecologits");
  const status = await service.status();
  assert.equal(status.preference, "build_default");
  assert.equal(status.selectionRevision, 2);
  await service.maintainLocal();
  assert.equal((await service.status()).local.status, "complete");
  assert.equal((await service.status()).selectionRevision, 2);
  assert.equal(canonicalJson(await db.all("measurements")), observations);
  const originals = await db.estimation.viewPage({ scope, view: "original" });
  assert.equal(
    canonicalJson(originals.rows[0].result),
    canonicalJson(original),
  );
});
async function setup(
  t: test.TestContext,
  executor: EstimateExecutor = local,
  company?: (
    scope: Scope,
    request?: OrganizationSelectionRequest,
  ) => Promise<OrganizationSelectionResponse>,
  registry = methods,
) {
  const db = await Ledger.open("engine-service-" + crypto.randomUUID());
  await db.policyTransaction([
    { key: "personal", namespace: scope.namespace, secret: "a".repeat(64) },
    {
      key: "ownership-history",
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
  ]);
  const state = { scope: { ...scope }, token: "first" };
  const service = new EngineService(
    db.estimation,
    registry,
    {
      executionOrigin: executor.executionOrigin ?? "local",
      estimate: (...args) => executor.estimate(...args),
    },
    async () => {
      const token = state.token;
      return {
        scope: { ...state.scope },
        token,
        current: async () => {
          if (token !== state.token) throw new Error("policy_unavailable");
        },
      };
    },
    company,
  );
  t.after(() => {
    service.dispose();
    db.close();
  });
  return { db, service, state };
}
async function companyScope(
  db: Ledger,
  state: { scope: Scope; token: string },
) {
  const next: Scope = {
    namespace: "company:engine-service",
    mode: "company",
    era: "one",
  };
  state.scope = next;
  state.token = "company";
  await db.policyTransaction([
    {
      key: "credentials",
      namespace: next.namespace,
      device_id: "00000000-0000-4000-8000-000000000020",
      enrollment_era: { id: next.era },
      enrollment_state: "active",
    },
    {
      key: "ownership-history",
      eras: [
        {
          scope,
          secret: "a".repeat(64),
          policyVersion: "1.0.0",
          start: 0,
          end: 1,
        },
        {
          scope: next,
          secret: "b".repeat(64),
          policyVersion: "1.0.0",
          start: 1,
          end: null,
        },
      ],
    },
  ]);
}
async function seed(db: Ledger) {
  const pair = records();
  const original = await local.estimate({
    family: "live",
    request: pair[0],
    attempt: pair[1],
  });
  await db.commit(scope, pair, [
    {
      store: "local_estimates",
      value: {
        key: `current:${scope.namespace}:${pair[1].attempt_id}`,
        namespace: scope.namespace,
        selection: "current",
        estimate: original,
      },
    },
  ]);
  return { pair, original };
}

test("engine selection recalculates a complete view and retains original observation/result bytes", async (t) => {
  const { db, service } = await setup(t);
  const { original } = await seed(db);
  const observations = canonicalJson(await db.all("measurements"));
  const before = await service.status();
  await service.select({
    preference: "ecologits",
    expectedRevision: before.selectionRevision,
  });
  await service.maintainLocal();
  const status = await service.status();
  assert.equal(status.effectiveEngine, "ecologits");
  assert.equal(status.local.status, "complete");
  assert.equal(status.local.processed, 1);
  assert.equal(canonicalJson(await db.all("measurements")), observations);
  const originals = await db.estimation.viewPage({ scope, view: "original" });
  assert.equal(
    canonicalJson(originals.rows[0].result),
    canonicalJson(original),
  );
  const selected = await db.estimation.viewPage({ scope, view: "selected" });
  assert.equal(
    selected.rows[0].result?.requested_method.engine_id,
    "ecologits",
  );
  assert.equal(
    selected.rows[0].result?.original_method_hash,
    original.requested_method.method_hash,
  );
});

test("a published recalculation notifies listeners once, and idle maintenance stays silent", async (t) => {
  const { db, service } = await setup(t);
  await seed(db);
  let published = 0;
  const stop = service.onPublished(() => {
    published++;
  });
  service.onPublished(() => {
    throw new Error("a failing listener must not stop publication");
  });
  const before = await service.status();
  await service.select({
    preference: "ecologits",
    expectedRevision: before.selectionRevision,
  });
  await service.maintainLocal();
  assert.equal((await service.status()).local.status, "complete");
  assert.equal(published, 1);
  await service.maintainLocal();
  assert.equal(published, 1, "nothing new was published");
  stop();
});

test("settleLocal waits for a running pass, then covers work committed after it started", async (t) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let blocked = true;
  const { db, service } = await setup(t, {
    estimate: async (...args) => {
      if (blocked) await gate;
      return local.estimate(...args);
    },
  });
  await seed(db);
  const before = await service.status();
  await service.select({
    preference: "ecologits",
    expectedRevision: before.selectionRevision,
  });
  const running = service.maintainLocal();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await seed(db);
  const settled = service.settleLocal(10000);
  blocked = false;
  release();
  await Promise.all([running, settled]);
  assert.equal((await service.status()).local.status, "complete");
  const selected = await db.estimation.viewPage({ scope, view: "selected" });
  assert.equal(selected.rows.length, 2);
  assert.ok(
    selected.rows.every(
      (row) => row.result?.requested_method.engine_id === "ecologits",
    ),
    "the observation committed during the first pass is calculated too",
  );
});

test("settleLocal stops waiting at its time limit", async (t) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const { db, service } = await setup(t, {
    estimate: async (...args) => {
      await gate;
      return local.estimate(...args);
    },
  });
  await seed(db);
  const before = await service.status();
  await service.select({
    preference: "ecologits",
    expectedRevision: before.selectionRevision,
  });
  const started = Date.now();
  await service.settleLocal(30);
  assert.ok(Date.now() - started < 1000);
  release();
  await service.maintainLocal();
});

test("repeated maintenance reuses completed selection and CAS rejects a late preference", async (t) => {
  let calls = 0;
  const { db, service } = await setup(t, {
    estimate: (...args) => {
      calls++;
      return local.estimate(...args);
    },
  });
  await seed(db);
  await service.select({
    preference: "original",
    expectedRevision: (await service.status()).selectionRevision,
  });
  const before = await service.status();
  await service.maintainLocal();
  const completed = await service.status();
  await service.maintainLocal();
  assert.equal(calls, 1);
  assert.equal((await service.status()).local.jobId, completed.local.jobId);
  await service.select({
    preference: "ecologits",
    expectedRevision: before.selectionRevision,
  });
  const stale = await service.select({
    preference: "original",
    expectedRevision: before.selectionRevision,
  });
  assert.equal(stale.reason, "selection_conflict");
  assert.equal(stale.preference, "ecologits");
});

test("a selection change while the executor yields cannot publish the previous result", async (t) => {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  const { db, service } = await setup(t, {
    estimate: async (...args) => {
      if (first) {
        first = false;
        entered();
        await held;
      }
      return local.estimate(...args);
    },
  });
  await seed(db);
  await service.select({
    preference: "original",
    expectedRevision: (await service.status()).selectionRevision,
  });
  const work = service.maintainLocal();
  await started;
  const status = await service.status();
  await service.select({
    preference: "ecologits",
    expectedRevision: status.selectionRevision,
  });
  release();
  await work;
  await service.maintainLocal();
  const selected = await db.estimation.viewPage({ scope, view: "selected" });
  assert.equal(
    selected.rows[0].result?.requested_method.engine_id,
    "ecologits",
  );
});

test("a transient executor failure leaves its cursor retryable instead of persisting missing data", async (t) => {
  let fails = true;
  const { db, service } = await setup(t, {
    estimate: (...args) => {
      if (fails) return Promise.reject(new Error("worker unavailable"));
      return local.estimate(...args);
    },
  });
  await seed(db);
  // select() also wakes a pass 16 ms later. On a loaded machine that pass could start
  // after the failed one below and clear its failure before status() read it, so the
  // wake is held and only the passes this test starts run.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await service.select({
    preference: "original",
    expectedRevision: (await service.status()).selectionRevision,
  });
  await service.maintainLocal();
  assert.equal((await service.status()).local.status, "failed");
  assert.equal((await db.estimation.resume(scope))?.processed, 0);
  fails = false;
  assert.equal((await service.resume()).local.status, "complete");
});
test("unavailable original code preserves valid numerical input and rejects malformed observations", async (t) => {
  const { service } = await setup(t, {
    estimate: async () => {
      throw new Error("old implementation missing");
    },
  });
  const pair = records();
  const input = { family: "live" as const, request: pair[0], attempt: pair[1] };
  const bytes = canonicalJson(input);
  assert.deepEqual(await service.original(input), {
    result: null,
    reason: "estimate_unavailable",
  });
  assert.equal(canonicalJson(input), bytes);
  await assert.rejects(
    service.original({
      ...input,
      attempt: { ...input.attempt, request_id: crypto.randomUUID() },
    }),
    /dependency_missing/,
  );
});
test("default view guards include calculation publication while original records remain inspectable", async (t) => {
  const { db, service } = await setup(t);
  await seed(db);
  const original = await service.view(scope);
  const revision = (await service.status()).selectionRevision!;
  const job = await db.estimation.start({
    scope,
    target: methods.original,
    selectionRevision: revision,
  });
  await service.maintainLocal();
  await assert.rejects(original.current(), /aggregate_inconsistent/);
  const selected = await service.view(scope);
  assert.equal(selected.view, "recalculated");
  const next = await db.estimation.start({
    scope,
    target: methods.original,
    selectionRevision: revision,
  });
  assert.notEqual(next.id, job.id);
  assert.equal(next.snapshotTotal, 0);
  await db.estimation.promote(next.id);
  await assert.rejects(selected.current(), /aggregate_inconsistent/);
});
test("selected summaries resolve canonical request aliases for both global and conversation views", async (t) => {
  const { db, service } = await setup(t);
  const first = await seed(db),
    second = await seed(db);
  await db.markAlias(
    scope.namespace,
    "request",
    first.pair[0].request_id,
    second.pair[0].request_id,
  );
  await service.select({
    preference: "ecologits",
    expectedRevision: (await service.status()).selectionRevision,
  });
  await service.maintainLocal();
  const view = await service.view(scope);
  for (const conversation of [undefined, first.pair[0].conversation_key]) {
    const summary = await scanSummary(
      db,
      scope.namespace,
      { calculationView: "recalculated" },
      conversation,
      false,
      undefined,
      (attempt, _original, request) =>
        view.estimate({ family: "live", request, attempt }),
    );
    assert.equal(summary.requests, 1);
    assert.equal(summary.attempts, 2);
    assert.equal(summary.metrics.energy.known, 2);
    assert.equal(summary.metrics.energy.unknown, 0);
  }
});

function response(
  request: OrganizationSelectionRequest,
): OrganizationSelectionResponse {
  return {
    selection: {
      ...request,
      selection_generation: 1,
      job_id: "a".repeat(64),
      updated_at: "2026-09-15T00:00:00.000Z",
    },
    compatibility: { status: "supported", reason: null },
    recalculation: {
      job_id: "a".repeat(64),
      method_id: request.method_id,
      calculation_view: "recalculated",
      status: "completed",
      processed_estimates: 0,
      created_at: "2026-09-15T00:00:00.000Z",
      completed_at: "2026-09-15T00:00:00.000Z",
      error_code: null,
      requires_advance: false,
      selection_revision: request.selection_revision,
      selection_generation: 1,
    },
  };
}
test("organization retries use one deterministic operation and never submit a personal selection", async (t) => {
  const requests: OrganizationSelectionRequest[] = [];
  const { db, service, state } = await setup(t, local, async (_, request) => {
    if (!request)
      return { selection: null, compatibility: null, recalculation: null };
    requests.push(request);
    if (requests.length === 1) throw new Error("response lost");
    return response(request);
  });
  await service.maintainOrganization();
  assert.equal(requests.length, 0);
  await companyScope(db, state);
  await service.maintainOrganization();
  assert.equal((await service.status()).organization.status, "pending");
  await service.maintainOrganization();
  assert.equal((await service.status()).organization.status, "current");
  assert.equal(requests[0].operation_id, requests[1].operation_id);
  assert.deepEqual(Object.keys(requests[0]).sort(), [
    "method_hash",
    "method_id",
    "operation_id",
    "preference",
    "selection_revision",
  ]);
});

test("organization deletion invalidation keeps preference and advances its operation revision", async (t) => {
  let saved: OrganizationSelectionRequest | null = null;
  const { db, service, state } = await setup(t, local, async (_, request) => {
    if (request) {
      saved = request;
      return response(request);
    }
    const status = await service.status();
    const original: OrganizationSelectionRequest = {
      preference: status.preference!,
      selection_revision: status.selectionRevision!,
      method_id: status.method!.method_id,
      method_hash: status.method!.method_hash,
      operation_id: crypto.randomUUID(),
    };
    return {
      ...response(original),
      recalculation: {
        job_id: "a".repeat(64),
        status: "invalidated",
        completed_at: null,
        error_code: "deletion_changed",
      },
    };
  });
  await companyScope(db, state);
  const before = await service.status();
  await service.maintainOrganization();
  const after = await service.status();
  assert.equal(after.preference, before.preference);
  assert.equal(after.selectionRevision, before.selectionRevision! + 1);
  assert.equal(
    (saved as OrganizationSelectionRequest | null)?.selection_revision,
    after.selectionRevision,
  );
});
test("selection queued during an older organization read is synchronized before the shared flight finishes", async (t) => {
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let reads = 0;
  const writes: OrganizationSelectionRequest[] = [];
  const { db, service, state } = await setup(
    t,
    local,
    async (_scope, request) => {
      if (request) {
        writes.push(request);
        return response(request);
      }
      if (++reads === 1) {
        entered();
        await gate;
      }
      return { selection: null, compatibility: null, recalculation: null };
    },
  );
  await companyScope(db, state);
  const old = await service.status();
  const flight = service.maintainOrganization();
  await started;
  await service.select({
    preference: "ecologits",
    expectedRevision: old.selectionRevision,
  });
  release();
  await flight;
  assert.equal(writes.length, 1);
  assert.equal(writes[0].preference, "ecologits");
  assert.equal((await service.status()).organization.status, "current");
});
test("an invalid saved preference exposes an unavailable status and can be explicitly repaired without erasing observations", async (t) => {
  const { db, service } = await setup(t);
  await seed(db);
  await service.status();
  const before = canonicalJson(await db.all("measurements"));
  const raw = (db as unknown as { db: IDBDatabase }).db;
  const tx = raw.transaction("engine_preferences", "readwrite");
  tx.objectStore("engine_preferences").put({
    key: "installation",
    record: {
      schema_version: "1.0.0",
      preference: "removed_engine",
      selection_revision: 7,
      updated_at: "2026-09-15T00:00:00.000Z",
    },
  });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  const broken = await service.status();
  assert.equal(broken.reason, "invalid_preference");
  assert.equal(broken.preference, null);
  assert.equal(broken.method, null);
  assert.equal(broken.effectiveEngine, null);
  assert.equal((await service.view(scope)).view, "original");
  await assert.rejects(service.admission(), /invalid_preference/);
  const repaired = await service.select({
    preference: "build_default",
    expectedRevision: broken.selectionRevision,
  });
  assert.equal(repaired.reason, null);
  assert.equal(repaired.preference, "build_default");
  assert.equal(repaired.selectionRevision, 8);
  assert.equal(canonicalJson(await db.all("measurements")), before);
});

test("usage breakdown buckets, tools and chats add up to the totals of the same scan", async (t) => {
  const { db, service } = await setup(t);
  const place = async (site: "claude" | "chatgpt", at: string, conversation: string) => {
    const pair = records();
    pair[0].site = site;
    pair[0].dispatched_at = at;
    pair[1].started_at = at;
    pair[0].conversation_key = conversation.repeat(64);
    const original = await local.estimate({ family: "live", request: pair[0], attempt: pair[1] });
    await db.commit(scope, pair, [
      {
        store: "local_estimates",
        value: {
          key: `current:${scope.namespace}:${pair[1].attempt_id}`,
          namespace: scope.namespace,
          selection: "current",
          estimate: original,
        },
      },
    ]);
  };
  await place("claude", "2026-09-10T10:00:00.000Z", "a");
  // 23:30 UTC is already the next day in Berlin, so it must land in the 11 September bucket.
  await place("chatgpt", "2026-09-10T23:30:00.000Z", "b");
  await place("claude", "2026-09-11T08:00:00.000Z", "c");
  await place("claude", "2026-09-11T09:00:00.000Z", "c");
  const view = await service.view(scope);
  const filters = { calculationView: view.view } as const;
  for (const bucket of ["day", "hour"] as const) {
    const observer = new BreakdownObserver(filters, { bucket, timezone: "Europe/Berlin" });
    const total = await scanSummary(
      db,
      scope.namespace,
      filters,
      undefined,
      false,
      undefined,
      view.method ? (attempt, _original, request) => view.estimate({ family: "live", request, attempt }) : undefined,
      observer,
    );
    const parts = observer.result();
    assert.equal(total.requests, 4);
    assert.ok(total.metrics.energy.known > 0, "the fixture must carry estimates, or the sums prove nothing");
    const energy = (summary: { metrics: { energy: { groups?: { value: string }[] } } }) =>
      sumFixed((summary.metrics.energy.groups ?? []).map((g) => g.value));
    for (const split of [parts.buckets, parts.sites, parts.models]) {
      const values = Object.values(split);
      if (!values.length) continue;
      assert.equal(values.reduce((n, s) => n + s.requests, 0), total.requests);
      assert.equal(values.reduce((n, s) => n + s.metrics.energy.known, 0), total.metrics.energy.known);
      assert.equal(sumFixed(values.map(energy)), energy(total));
    }
    assert.equal(parts.chats.reduce((n, c) => n + c.requests, 0), total.requests);
    assert.equal(parts.chats.length, 3);
    assert.deepEqual(
      Object.fromEntries(Object.entries(parts.sites).map(([k, v]) => [k, v.requests])),
      { claude: 3, chatgpt: 1 },
    );
    assert.deepEqual(parts.siteLastAt, { claude: "2026-09-11T09:00:00.000Z", chatgpt: "2026-09-10T23:30:00.000Z" });
    assert.deepEqual(parts.siteLastMissed, {}, "every seeded live reply was read to its end");
    for (const [model, site] of Object.entries(parts.modelSites)) assert.ok(parts.models[model] && ["claude", "chatgpt"].includes(site));
    if (bucket === "day")
      assert.deepEqual(
        Object.fromEntries(Object.entries(parts.buckets).map(([k, v]) => [k, v.requests])),
        { "2026-09-10": 1, "2026-09-11": 3 },
      );
    else assert.deepEqual(Object.keys(parts.buckets).sort(), ["01", "10", "11", "12"]);
  }
});

// Live QA of 19 Oct 2026: the Tracking page said ChatGPT was Working while every live reply
// there was missed, because replies counted from saved chats set its last reply time.
test("usage breakdown names a tool whose latest live reply was not read to its end", () => {
  const observer = new BreakdownObserver({}, { bucket: "day", timezone: "UTC" });
  const [request, attempt] = records();
  observer.request(request);
  observer.attempt({ ...attempt, state: "interrupted_unconfirmed" }, request, undefined);
  assert.deepEqual(observer.result().siteLastMissed, { claude: attempt.started_at });
  // A later reply read to its end clears it; an older missed one does not bring it back.
  const [next, read] = records();
  const at = "2026-09-10T11:00:00.000Z";
  const later = { ...next, dispatched_at: at };
  observer.request(later);
  observer.attempt({ ...read, started_at: at, state: "completed", ended_at: at }, later, undefined);
  observer.attempt({ ...attempt, state: "interrupted_unconfirmed" }, request, undefined);
  assert.deepEqual(observer.result().siteLastMissed, {});
});

// Live QA of 19 Oct 2026: a reply cut off by Turn off tracking was shown on the Tracking page as
// a reply that could not be read, beside "No open problems", also after the saved chat counted it.
test("usage breakdown does not name a reply that turning tracking off ended", () => {
  const [request, attempt] = records();
  const withdrawnAt = Date.parse(attempt.started_at) + 2_000;
  const cut = {
    ...attempt,
    state: "interrupted_unconfirmed" as const,
    ended_at: new Date(withdrawnAt + 5).toISOString(),
  };
  const options = { bucket: "day" as const, timezone: "UTC", withdrawnAt };
  const observer = new BreakdownObserver({}, options);
  observer.request(request);
  observer.attempt(cut, request, undefined);
  assert.deepEqual(observer.result().siteLastMissed, {});
  // A reply that ended unread before the withdrawal is still a reply the tracker missed.
  const missed = new BreakdownObserver({}, options);
  missed.request(request);
  missed.attempt({ ...cut, ended_at: new Date(withdrawnAt - 1_000).toISOString() }, request, undefined);
  assert.deepEqual(missed.result().siteLastMissed, { claude: attempt.started_at });
});
test("usage breakdown skips rows outside the window instead of creating empty buckets", async (t) => {
  const { db, service } = await setup(t);
  await seed(db);
  const view = await service.view(scope);
  const filters = { calculationView: view.view, start: "2026-10-01T00:00:00.000Z" } as const;
  const observer = new BreakdownObserver(filters, { bucket: "day", timezone: "UTC" });
  const total = await scanSummary(db, scope.namespace, filters, undefined, false, undefined, undefined, observer);
  assert.equal(total.requests, 0);
  assert.deepEqual(observer.result(), { buckets: {}, sites: {}, models: {}, chats: [], modelSites: {}, siteLastAt: {}, siteLastMissed: {} });
});
