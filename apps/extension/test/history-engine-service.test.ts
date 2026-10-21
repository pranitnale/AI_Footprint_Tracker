import { archivedEstimation } from "./archived-engine-fixture";
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  historyNumericPayloadHash,
  type EnginePreference,
  type HistoryMessage,
} from "@footprint/contracts";
import { Ledger, type Scope } from "@footprint/ledger";
import { estimateHistoricalText } from "@footprint/estimator";
import { Coordinator } from "../lib/coordinator";
import {
  HistoryService,
  type HistoryEstimationHooks,
} from "../lib/history-service";
import {
  HISTORY_CAPTURE_CHANNEL,
  type HistoryCaptureMessage,
} from "../lib/history-capture";
import { countByTextLength } from "./counting-fixture";
import { historyPage, historyBinding, historySender } from "./history-fixture";
import { transitionOwnership, type OwnershipHistory } from "../lib/ownership";

async function fixture(
  t: TestContext,
  options: {
    company?: boolean;
    maintenance?: boolean;
    estimate?: HistoryEstimationHooks["estimate"];
    original?: HistoryEstimationHooks["original"];
    view?: HistoryEstimationHooks["view"];
  } = {},
) {
  const db = await Ledger.open(`history-engine-${crypto.randomUUID()}`);
  const coordinator = new Coordinator(db, {
    estimation: archivedEstimation,
    count: countByTextLength,
    hasConsent: async () => true,
    hasSiteConsent: async () => true,
    sendDisplay: async () => {},
    transport: async () => {
      throw new TypeError("synthetic offline");
    },
  });
  await coordinator.whenReady();
  if (options.company) {
    const scope: Scope = {
      namespace: `company:${crypto.randomUUID()}:${crypto.randomUUID()}`,
      mode: "company",
      era: crypto.randomUUID(),
    };
    const history = (await db.get<OwnershipHistory>(
      "policy",
      "ownership-history",
    ))!;
    await db.policyTransaction([
      {
        key: "credentials",
        namespace: scope.namespace,
        origin: "https://company.example",
        company_id: scope.namespace.split(":")[1],
        user_id: scope.namespace.split(":")[2],
        device_id: crypto.randomUUID(),
        access_token: "synthetic-access",
        refresh_token: "synthetic-refresh",
        user_hmac_key: "b".repeat(64),
        access_expires_at: new Date(Date.now() + 600000).toISOString(),
        enrollment_era: {
          id: scope.era,
          start: new Date().toISOString(),
          end: null,
        },
        policy: {
          policy_version: "1.0.0",
          pause_mode: "user_controlled",
          deletion_epoch: 0,
          timezone: "UTC",
        },
      },
      transitionOwnership(history, {
        scope,
        secret: "b".repeat(64),
        policyVersion: "1.0.0",
      }) as any,
    ]);
  }
  const engines = coordinator.engines;
  const calls: Array<{ record: HistoryMessage; methodId: string | undefined }> =
    [];
  const history = new HistoryService(
    db,
    coordinator.company,
    () => coordinator.currentScope(),
    countByTextLength,
    async () => true,
    {
      admission: () => engines.admission(),
      view: (scope) =>
        options.view ? options.view(scope) : engines.view(scope),
      estimate: async (input, configuration) => {
        assert.equal(input.family, "history");
        if (input.family !== "history") throw new Error("wrong_input_family");
        calls.push({
          record: structuredClone(input.record),
          methodId: configuration?.methodId,
        });
        return options.estimate
          ? options.estimate(input, configuration)
          : engines.executor.estimate(input, configuration);
      },
      maintainLocal: () =>
        options.maintenance === false
          ? Promise.resolve()
          : engines.maintainLocal(),
      ...(options.original ? { original: options.original } : {}),
    },
  );
  t.after(() => {
    history.invalidate();
    coordinator.history.invalidate();
    engines.dispose();
    db.close();
  });
  const choose = async (preference: EnginePreference) => {
    await engines.admission();
    const old = await db.estimation.readPreference();
    const selected = await engines.select({
      preference,
      expectedRevision: old?.selection_revision ?? null,
    });
    assert.notEqual(selected.reason, "selection_conflict");
    await engines.maintainLocal();
    assert.equal(
      (await engines.admission()).engine_id,
      preference === "build_default"
        ? engines.methods.build.default_engine
        : preference,
    );
  };
  const start = async (page = historyPage()) => {
    const binding = historyBinding();
    const common = {
      channel: HISTORY_CAPTURE_CHANNEL as typeof HISTORY_CAPTURE_CHANNEL,
      id: crypto.randomUUID(),
      site: page.site,
      conversationId: page.conversationId,
      observedAt: page.observedAt,
    };
    const initial: HistoryCaptureMessage = {
      ...common,
      event: "start",
      page: null,
    };
    assert.deepEqual(await history.receive(initial, binding, historySender), {
      accepted: true,
    });
    return () =>
      history.receive(
        { ...common, event: "page", page },
        binding,
        historySender,
      );
  };
  return {
    db,
    coordinator,
    engines,
    history,
    choose,
    start,
    calls,
    scope: await coordinator.currentScope(),
  };
}

function source(record: HistoryMessage) {
  return {
    family: "history" as const,
    message_key: record.message_key,
    observation_hash: historyNumericPayloadHash(record),
  };
}

async function reconnectCompany(f: Awaited<ReturnType<typeof fixture>>) {
  const credentials = await f.coordinator.company.credentials();
  assert.ok(credentials);
  const era = crypto.randomUUID();
  const scope: Scope = { ...f.scope, era };
  const ownership = (await f.db.application.readOwnershipHistory())!;
  await f.db.application.applySessionChanges({
    credentials: {
      ...credentials,
      enrollment_era: {
        id: era,
        start: new Date().toISOString(),
        end: null,
      },
    },
    ownershipHistory: transitionOwnership(ownership, {
      scope,
      secret: credentials.user_hmac_key,
      policyVersion: "1.0.0",
    }),
  });
  return scope;
}

async function completeEcoHistory(
  f: Awaited<ReturnType<typeof fixture>>,
  scope: Scope,
  revision: number,
) {
  const job = await f.db.estimation.start({
    scope,
    target: f.engines.methods.ecologits,
    fallbackMethod: f.engines.methods.original,
    selectionRevision: revision,
  });
  const page = await f.db.estimation.page(job.id);
  for (const input of page.inputs) {
    assert.equal(input.family, "history");
    if (input.family !== "history") throw new Error("wrong_input_family");
    assert.ok(input.originalMethodHash);
    const result = await f.engines.executor.estimate(
      { family: "history", record: input.history },
      {
        methodId: f.engines.methods.ecologits.method_id,
        view: "recalculated",
        originalMethodHash: input.originalMethodHash,
      },
    );
    await f.db.estimation.commitResult({
      jobId: job.id,
      inputKey: input.key,
      sequence: input.sequence,
      result,
    });
  }
  await f.db.estimation.promote(job.id);
}

test("selected history remains available across authorized eras when the current era has no inputs", async (t) => {
  const f = await fixture(t, { company: true });
  await (
    await f.start()
  )();
  f.history.invalidate();
  const originals = structuredClone(await f.db.historyPage(f.scope, undefined));
  const scope = await reconnectCompany(f);
  const preference = (await f.db.estimation.readPreference())!;
  const revision = preference.selection_revision + 1;
  assert.equal(
    await f.db.estimation.compareAndSetPreference(
      preference.selection_revision,
      {
        ...preference,
        preference: "ecologits",
        selection_revision: revision,
      },
    ),
    true,
  );
  await completeEcoHistory(f, f.scope, revision);
  assert.equal((await f.db.estimation.state(scope)).selected, null);
  const engineView = await f.engines.view(scope);
  assert.equal(engineView.pending, false);
  assert.equal(engineView.method?.engine_id, "ecologits");
  const selected = await f.history.view(scope);
  assert.equal(selected.local.status, "available");
  assert.equal(selected.local.observed_response_count, "1");
  assert.ok(selected.local.resources.length > 0);
  assert.ok(
    selected.local.resources.every(
      (row) => row.method_hash === f.engines.methods.ecologits.method_hash,
    ),
  );
  assert.deepEqual(await f.db.historyPage(scope, undefined), originals);
  const original = await f.history.local(scope, undefined, {
    calculationView: "original",
  });
  assert.ok(
    original.resources.every(
      (row) => row.method_hash === f.engines.methods.original.method_hash,
    ),
  );
});

test("a complete current-era job cannot hide pending history in another authorized era", async (t) => {
  const f = await fixture(t, { company: true, maintenance: false });
  await (
    await f.start()
  )();
  f.history.invalidate();
  const scope = await reconnectCompany(f);
  const page = historyPage(4);
  for (const message of page.messages.slice(2))
    message.occurredAt = "2022-01-01T00:00:00.000Z";
  await (
    await f.start(page)
  )();
  f.history.invalidate();
  const preference = (await f.db.estimation.readPreference())!;
  const revision = preference.selection_revision + 1;
  assert.equal(
    await f.db.estimation.compareAndSetPreference(
      preference.selection_revision,
      {
        ...preference,
        preference: "ecologits",
        selection_revision: revision,
      },
    ),
    true,
  );
  await completeEcoHistory(f, scope, revision);
  assert.equal((await f.db.estimation.state(scope)).pending, 0);
  assert.equal(
    (await f.db.estimation.state(scope)).selected?.target.engine_id,
    "ecologits",
  );
  assert.equal((await f.engines.view(scope)).pending, true);
  const filters = { start: "2021-01-01T00:00:00.000Z" };
  const pending = await f.history.local(scope, undefined, filters);
  assert.equal(pending.observed_response_count, "1");
  assert.equal(pending.status, "unavailable");
  assert.deepEqual(pending.resources, []);
  const original = await f.history.local(scope, undefined, {
    ...filters,
    calculationView: "original",
  });
  assert.equal(original.observed_response_count, "1");
  assert.ok(original.resources.some((row) => row.value !== null));
  await completeEcoHistory(f, f.scope, revision);
  const ready = await f.history.local(scope, undefined, filters);
  assert.equal(ready.status, "available");
  assert.ok(
    ready.resources.every(
      (row) => row.method_hash === f.engines.methods.ecologits.method_hash,
    ),
  );
  let changed = false;
  const lookup = f.db.estimation.resultsFor.bind(f.db.estimation);
  t.mock.method(
    f.db.estimation,
    "resultsFor",
    async (...args: Parameters<typeof lookup>) => {
      const result = await lookup(...args);
      if (!changed) {
        changed = true;
        await f.db.estimation.start({
          scope: f.scope,
          target: f.engines.methods.ecologits,
          fallbackMethod: f.engines.methods.original,
          selectionRevision: revision,
        });
      }
      return result;
    },
  );
  const invalidated = await f.history.view(scope, undefined, filters);
  assert.equal(invalidated.local.observed_response_count, "1");
  assert.equal(invalidated.local.status, "unavailable");
  assert.deepEqual(invalidated.local.resources, []);
});

test("a preference becoming invalid during a guarded history read preserves numerical counts", async (t) => {
  const f = await fixture(t);
  await (
    await f.start()
  )();
  await f.choose("ecologits");
  const lookup = f.db.estimation.resultsFor.bind(f.db.estimation);
  let corrupted = false;
  t.mock.method(
    f.db.estimation,
    "resultsFor",
    async (...args: Parameters<typeof lookup>) => {
      const result = await lookup(...args);
      if (!corrupted) {
        corrupted = true;
        const raw = (f.db as unknown as { db: IDBDatabase }).db;
        const tx = raw.transaction("engine_preferences", "readwrite");
        tx.objectStore("engine_preferences").put({
          key: "installation",
          record: {
            schema_version: "1.0.0",
            preference: "removed_engine",
            selection_revision: 99,
            updated_at: new Date().toISOString(),
          },
        });
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
        });
      }
      return result;
    },
  );
  const view = await f.history.view(f.scope);
  assert.equal(view.local.observed_response_count, "1");
  assert.equal(view.local.status, "unavailable");
  assert.deepEqual(view.local.resources, []);
  const original = await f.history.local(f.scope, undefined, {
    calculationView: "original",
  });
  assert.equal(original.observed_response_count, "1");
  assert.ok(original.resources.some((row) => row.value !== null));
});

test("unchanged Original evidence displays saved resources without redundant recalculation", async (t) => {
  const f = await fixture(t);
  await (
    await f.start()
  )();
  const state = await f.db.estimation.state(f.scope);
  assert.equal(state.selected, null);
  assert.equal(state.active, null);
  const original = await f.history.local(f.scope, undefined, {
    calculationView: "original",
  });
  const selected = await f.history.local(f.scope);
  assert.deepEqual(selected, original);
  assert.equal(selected.status, "available");
  assert.ok(selected.resources.some((resource) => resource.value !== null));
  const explicit = await f.history.local(f.scope, undefined, {
    calculationView: "recalculated",
  });
  assert.equal(explicit.response_count, "1");
  assert.equal(explicit.status, "unavailable");
  assert.deepEqual(explicit.resources, []);
});

for (const reader of ["local", "view"] as const) {
  test(`a selection change during the initial Original guard stabilizes the ${reader} history view`, async (t) => {
    let release!: () => void, entered!: () => void;
    const began = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let getView!: NonNullable<HistoryEstimationHooks["view"]>;
    let held = false;
    const f = await fixture(t, {
      view: async (scope) => {
        const snapshot = await getView(scope);
        if (held) return snapshot;
        held = true;
        assert.equal(snapshot.view, "original");
        assert.equal(snapshot.pending, false);
        return {
          ...snapshot,
          current: async () => {
            entered();
            await gate;
            await snapshot.current();
          },
        };
      },
    });
    getView = (scope) => f.engines.view(scope);
    await (
      await f.start()
    )();
    const reading =
      reader === "local"
        ? f.history.local(f.scope)
        : f.history.view(f.scope).then((view) => view.local);
    await began;
    try {
      await f.choose("ecologits");
    } finally {
      release();
    }
    const result = await reading;
    assert.equal(result.observed_response_count, "1");
    assert.equal(result.status, "available");
    assert.ok(result.resources.length > 0);
    assert.ok(
      result.resources.every(
        (row) => row.method_hash === f.engines.methods.ecologits.method_hash,
      ),
    );
  });
}

test("unstable shared views keep numerical history after bounded retries but still reject policy changes", async (t) => {
  let failure = "selection_conflict",
    calls = 0;
  const f = await fixture(t, {
    view: async () => {
      calls++;
      throw new Error(failure);
    },
  });
  await (
    await f.start()
  )();
  for (const code of ["selection_conflict", "aggregate_inconsistent"]) {
    failure = code;
    calls = 0;
    const result = await f.history.local(f.scope);
    assert.equal(calls, 3);
    assert.equal(result.observed_response_count, "1");
    assert.equal(result.status, "unavailable");
    assert.deepEqual(result.resources, []);
  }
  failure = "policy_unavailable";
  await assert.rejects(f.history.local(f.scope), /policy_unavailable/);
  await assert.rejects(f.history.view(f.scope), /policy_unavailable/);
});

test("history pins the common engine before counting and atomically retains original envelopes", async (t) => {
  const f = await fixture(t);
  await f.choose("original");
  const finish = await f.start();
  await f.choose("ecologits");
  assert.deepEqual(await finish(), { accepted: true });
  const rows = await f.db.historyPage(f.scope, undefined);
  const response = rows.find((row) => row.record.role === "response")!;
  assert.equal(
    response.record.proposed_method_id,
    f.engines.methods.original.method_id,
  );
  assert.equal(
    response.record.proposed_method_hash,
    f.engines.methods.original.method_hash,
  );
  assert.deepEqual(response.estimate, estimateHistoricalText(response.record));
  assert.equal(f.calls.length, 2);
  assert.ok(
    f.calls.every(
      (call) => call.methodId === f.engines.methods.original.method_id,
    ),
  );
  assert.ok(f.calls.every((call) => !("text" in call.record)));
  const saved = await f.db.estimation.resultFor(
    f.scope,
    source(response.record),
    response.record.proposed_method_hash,
  );
  assert.equal(saved?.view, "original");
  assert.equal(saved?.raw?.engine_id, "original");
  assert.deepEqual(saved?.raw?.result, response.estimate);
  const selected = await f.history.local(f.scope);
  assert.equal(selected.status, "available");
  assert.equal(selected.schema_version, "3.0.0");
  assert.ok(
    selected.resources.every(
      (row) => row.method_hash === f.engines.methods.ecologits.method_hash,
    ),
  );
  const energy = selected.resources.find((row) => row.quantity === "energy")!;
  assert.ok("value_kind" in energy && energy.value_kind === "midpoint_sum");
  assert.ok(
    "scenario_low" in energy &&
      energy.scenario_low !== null &&
      energy.scenario_high !== null &&
      Number(energy.scenario_low) <= Number(energy.value) &&
      Number(energy.value) <= Number(energy.scenario_high),
  );
  const original = await f.history.local(f.scope, undefined, {
    calculationView: "original",
  });
  assert.equal(original.schema_version, "3.0.0");
  assert.ok(
    original.resources.every(
      (row) => row.method_hash === f.engines.methods.original.method_hash,
    ),
  );
});

test("refinements keep first method and raw original while the selected view can change", async (t) => {
  const f = await fixture(t);
  await f.choose("ecologits");
  const undated = historyPage();
  undated.messages[1].occurredAt = null;
  undated.messages[1].dateBasis = "unknown";
  await (
    await f.start(undated)
  )();
  const before = (await f.db.historyPage(f.scope, undefined)).find(
    (row) => row.record.role === "response",
  )!;
  const frozen = structuredClone(before);
  await f.choose("original");
  const refined = historyPage();
  await (
    await f.start(refined)
  )();
  const after = (await f.db.historyPage(f.scope, undefined)).find(
    (row) => row.record.role === "response",
  )!;
  assert.equal(
    after.record.proposed_method_hash,
    f.engines.methods.ecologits.method_hash,
  );
  assert.equal(after.record.occurred_at, refined.messages[1].occurredAt);
  assert.deepEqual(after.original, frozen.original);
  assert.deepEqual(after.originalEstimate, frozen.originalEstimate);
  assert.equal(f.calls.at(-1)?.methodId, f.engines.methods.ecologits.method_id);
  const selected = await f.history.local(f.scope);
  assert.equal(selected.status, "available");
  assert.ok(
    selected.resources.every(
      (row) => row.method_id === f.engines.methods.original.method_id,
    ),
  );
  const original = await f.history.local(f.scope, undefined, {
    calculationView: "original",
  });
  assert.ok(
    original.resources.every(
      (row) => row.method_id === f.engines.methods.ecologits.method_id,
    ),
  );
});

test("selected history with missing or pending overlays never substitutes stored originals", async (t) => {
  const f = await fixture(t, { maintenance: false });
  await f.choose("ecologits");
  await (
    await f.start(historyPage(4))
  )();
  assert.equal((await f.history.local(f.scope)).status, "unavailable");
  assert.equal(
    (await f.history.local(f.scope, undefined, { calculationView: "original" }))
      .status,
    "available",
  );
  await f.engines.maintainLocal();
  assert.equal((await f.history.local(f.scope)).status, "available");
  const read = f.db.estimation.resultsFor.bind(f.db.estimation);
  t.mock.method(
    f.db.estimation,
    "resultsFor",
    // The second selected response has no current overlay.
    async (...args: Parameters<typeof read>) =>
      (await read(...args)).map((result, index) =>
        index === 1 ? null : result,
      ),
  );
  const unavailable = await f.history.local(f.scope);
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.observed_response_count, "2");
  assert.equal(unavailable.observed_prompt_count, "2");
  // Two Claude replies of 5 tokens each: 5 x 1.56 = 7.8, rounded to 8 per reply.
  assert.equal(
    unavailable.tokens.find((row) => row.role === "response")?.value,
    "16",
  );
  assert.deepEqual(unavailable.resources, []);
});

test("route invalidation during engine execution drops the entire late page", async (t) => {
  let entered!: () => void, release!: () => void;
  const began = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let execute!: HistoryEstimationHooks["estimate"];
  const f = await fixture(t, {
    estimate: async (input, options) => {
      entered();
      await gate;
      return execute(input, options);
    },
  });
  execute = f.engines.executor.estimate.bind(f.engines.executor);
  const finish = await f.start();
  const pending = finish();
  await began;
  f.history.invalidate();
  release();
  await assert.rejects(pending, /policy_unavailable|history_unavailable/);
  assert.equal((await f.db.all("history_records")).length, 0);
  assert.equal((await f.db.all("estimation_originals")).length, 0);
  assert.equal((await f.db.all("history_outbox")).length, 0);
});

test("an unclassified injected failure is not silently relabeled as a calculation failure", async (t) => {
  const f = await fixture(t, {
    estimate: async () => {
      throw new Error("synthetic_engine_unavailable");
    },
  });
  await f.choose("ecologits");
  await assert.rejects((await f.start())(), /synthetic_engine_unavailable/);
  assert.equal((await f.db.all("history_records")).length, 0);
});

test("an unavailable pinned original preserves numerical history and atomic health metadata", async (t) => {
  const f = await fixture(t, {
    original: async () => ({ result: null, reason: "method_unsupported" }),
  });
  await f.choose("ecologits");
  assert.deepEqual(await (await f.start())(), { accepted: true });
  const rows = await f.db.historyPage(f.scope, undefined);
  assert.equal(rows.length, 2);
  const response = rows.find((row) => row.record.role === "response")!;
  assert.equal(response.record.tokens.value, "5");
  assert.equal(
    response.record.proposed_method_hash,
    f.engines.methods.ecologits.method_hash,
  );
  assert.equal(response.estimate.length, 5);
  assert.ok(
    response.estimate.every(
      (metric) =>
        metric.value === null && metric.reasons.includes("method_unsupported"),
    ),
  );
  assert.equal((await f.db.all("estimation_originals")).length, 0);
  const health = await f.db.all<{ namespace: string; code: string }>("health");
  assert.ok(
    health.some(
      (row) =>
        row.namespace === f.scope.namespace &&
        row.code === "method_unsupported",
    ),
  );
  assert.equal(
    (await f.history.local(f.scope, undefined, { calculationView: "original" }))
      .observed_response_count,
    "1",
  );
});

// Owner decision of 16 October 2026: saved work closes the problems of that work.
const solvedCodes = async (f: Awaited<ReturnType<typeof fixture>>) =>
  Object.fromEntries(
    (await f.db.list<any>("health", f.scope.namespace)).map((row) => [
      row.code,
      typeof row.resolvedAt === "number" && row.resolvedAt >= row.lastAt,
    ]),
  );

test("a saved history page closes earlier storage and estimation problems", async (t) => {
  const f = await fixture(t);
  for (const code of [
    "storage_write_failed",
    "estimate_unavailable",
    "method_unsupported",
    "sync_delayed",
  ] as const)
    await f.db.health(f.scope.namespace, code);
  assert.deepEqual(await (await f.start())(), { accepted: true });
  assert.deepEqual(await solvedCodes(f), {
    storage_write_failed: true,
    estimate_unavailable: true,
    method_unsupported: true,
    sync_delayed: false,
  });
});

test("a history page that could not be estimated keeps estimation problems open", async (t) => {
  const f = await fixture(t, {
    original: async () => ({ result: null, reason: "method_unsupported" }),
  });
  await f.choose("ecologits");
  await f.db.health(f.scope.namespace, "storage_write_failed");
  await f.db.health(f.scope.namespace, "estimate_unavailable");
  assert.deepEqual(await (await f.start())(), { accepted: true });
  assert.deepEqual(await solvedCodes(f), {
    storage_write_failed: true,
    // Nothing was estimated afresh, and this page reported method_unsupported itself.
    estimate_unavailable: false,
    method_unsupported: false,
  });
});

test("a bad envelope aborts the shared record, original-result and queue transaction", async (t) => {
  const f = await fixture(t);
  await f.choose("ecologits");
  const commit = f.db.application.commitHistory.bind(f.db.application);
  let corruptions = 0;
  t.mock.method(
    f.db.application,
    "commitHistory",
    async (...args: Parameters<typeof commit>) => {
      const [scope, page, expected, current] = args;
      corruptions++;
      const changed = structuredClone(expected);
      const result = Object.values(changed.envelopes!)[0];
      result.input_hash = "f".repeat(64);
      return commit(scope, page, changed, current);
    },
  );
  await assert.rejects((await f.start())());
  assert.equal(corruptions, 1);
  assert.equal((await f.db.all("history_records")).length, 0);
  assert.equal((await f.db.all("estimation_originals")).length, 0);
  assert.equal((await f.db.all("history_outbox")).length, 0);
});

test("missing old code retains a refined numeric row and never blocks unrelated new history", async (t) => {
  let unavailable = false;
  let original!: NonNullable<HistoryEstimationHooks["original"]>;
  const f = await fixture(t, {
    original: async (input, hash) =>
      unavailable &&
      input.family === "history" &&
      input.record.proposed_method_id === f.engines.methods.ecologits.method_id
        ? { result: null, reason: "method_unsupported" }
        : original(input, hash),
  });
  original = f.engines.original.bind(f.engines);
  await f.choose("ecologits");
  const first = historyPage();
  first.messages[1].occurredAt = null;
  first.messages[1].dateBasis = "unknown";
  await (
    await f.start(first)
  )();
  const before = (await f.db.historyPage(f.scope, undefined)).find(
    (row) => row.record.role === "response",
  )!;
  const retained = structuredClone(before.originalEstimate);
  unavailable = true;
  await f.choose("original");
  await (
    await f.start(historyPage(4))
  )();
  const rows = await f.db.historyPage(f.scope, undefined);
  assert.equal(rows.length, 4);
  const refined = rows.find((row) => row.key === before.key)!;
  assert.deepEqual(refined.originalEstimate, retained);
  assert.equal(
    refined.record.proposed_method_hash,
    before.record.proposed_method_hash,
  );
  assert.notEqual(refined.record.occurred_at, null);
  assert.ok(
    refined.estimate.every(
      (row) => row.value === null && row.reasons.includes("method_unsupported"),
    ),
  );
  assert.equal((await f.history.local(f.scope)).observed_response_count, "2");
});

test("foreign server method IDs and hashes cannot become selected historical totals", async (t) => {
  const f = await fixture(t, { company: true });
  await f.choose("original");
  await (
    await f.start()
  )();
  f.history.invalidate();
  const original = await f.history.local(f.scope, undefined, {
    calculationView: "original",
  });
  const conversation = (await f.db.historyPage(f.scope, undefined))[0].record
    .conversation_key;
  await f.choose("ecologits");
  t.mock.method(
    f.coordinator.company,
    "threadRequest",
    async (_scope: Scope, path: string, body?: unknown) => {
      if (body) throw new TypeError("synthetic offline");
      assert.ok(path.includes("calculation_view=recalculated"));
      return { deletion_epoch: 0, history: original };
    },
  );
  const fetched = await f.history.view(f.scope, conversation);
  assert.equal(fetched.server_status, "unavailable");
  assert.equal(fetched.server?.observed_response_count, "1");
  assert.deepEqual(fetched.server?.resources, []);
  const wrongHash = structuredClone(original);
  for (const row of wrongHash.resources) {
    row.method_id = f.engines.methods.ecologits.method_id;
    row.method_hash = "f".repeat(64);
  }
  const supplied = await f.history.view(f.scope, conversation, {}, wrongHash);
  assert.equal(supplied.server_status, "unavailable");
  assert.equal(supplied.server?.observed_response_count, "1");
  assert.deepEqual(supplied.server?.resources, []);
});

test("a pending server recalculation preserves observed counts and reports unavailable resources", async (t) => {
  const f = await fixture(t, { company: true });
  await (
    await f.start()
  )();
  f.history.invalidate();
  const original = await f.history.local(f.scope, undefined, {
    calculationView: "original",
  });
  const conversation = (await f.db.historyPage(f.scope, undefined))[0].record
    .conversation_key;
  await f.choose("ecologits");
  const requests: string[] = [];
  t.mock.method(
    f.coordinator.company,
    "threadRequest",
    async (_scope: Scope, path: string) => {
      requests.push(path);
      if (path.includes("calculation_view=recalculated"))
        throw new Error("recalculation_pending");
      assert.ok(path.endsWith("&calculation_view=original"));
      return { deletion_epoch: 0, history: original };
    },
  );
  const view = await f.history.view(f.scope, conversation);
  assert.equal(requests.length, 2);
  assert.equal(view.server_status, "unavailable");
  assert.equal(view.server?.status, "unavailable");
  assert.equal(view.server?.observed_response_count, "1");
  assert.deepEqual(view.server?.resources, []);
});

test("concurrent first admission retries with the committed method pin", async (t) => {
  let release!: () => void, entered!: () => void;
  const began = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  let execute!: HistoryEstimationHooks["estimate"];
  const f = await fixture(t, {
    estimate: async (input, options) => {
      if (first) {
        first = false;
        entered();
        await gate;
      }
      return execute(input, options);
    },
  });
  execute = f.engines.executor.estimate.bind(f.engines.executor);
  await f.choose("original");
  const page = historyPage();
  const original = (await f.start(page))();
  await began;
  await f.choose("ecologits");
  assert.deepEqual(await (await f.start(page))(), { accepted: true });
  release();
  assert.deepEqual(await original, { accepted: true });
  const rows = await f.db.historyPage(f.scope, undefined);
  assert.equal(rows.length, 2);
  assert.ok(
    rows.every(
      (row) =>
        row.record.proposed_method_hash ===
        f.engines.methods.ecologits.method_hash,
    ),
  );
  assert.ok(rows.every((row) => row.status === "current"));
  assert.equal((await f.db.all("estimation_originals")).length, 1);
});

test("selection changes during summary reads cannot publish a stale method", async (t) => {
  const f = await fixture(t);
  await f.choose("original");
  await (
    await f.start()
  )();
  await f.choose("ecologits");
  let release!: () => void, entered!: () => void;
  const began = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const read = f.db.estimation.resultsFor.bind(f.db.estimation);
  let first = true;
  t.mock.method(
    f.db.estimation,
    "resultsFor",
    async (...args: Parameters<typeof read>) => {
      const result = await read(...args);
      if (first) {
        first = false;
        entered();
        await gate;
      }
      return result;
    },
  );
  const pending = f.history.view(f.scope);
  await began;
  await f.choose("original");
  release();
  const result = await pending;
  assert.equal(result.local.observed_response_count, "1");
  assert.ok(result.local.resources.length > 0);
  assert.ok(
    result.local.resources.every(
      (row) => row.method_hash === f.engines.methods.original.method_hash,
    ),
  );
});
