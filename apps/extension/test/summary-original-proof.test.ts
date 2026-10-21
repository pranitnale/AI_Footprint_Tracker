import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalJson,
  type EstimationEnvelope,
  type RequestObservation,
} from "@footprint/contracts";
import {
  createMethodRegistry,
  LocalEstimateExecutor,
} from "@footprint/estimator";
import { Ledger, type Scope } from "@footprint/ledger";
import config from "../../../config/estimation.build.json";
import mappings from "../../../config/estimation.mappings.json";
import media from "../../../config/estimation.media.json";
import { records } from "../../../packages/ledger/test/factory";
import { scanSummary } from "../lib/summary-scan";

const methods = createMethodRegistry(config, mappings, media);
const executor = new LocalEstimateExecutor(methods);
const personal: Scope = {
  namespace: "personal:summary-original-proof",
  mode: "personal",
  era: null,
};

async function seed(t: test.TestContext, scope = personal) {
  const db = await Ledger.open(`summary-original-${crypto.randomUUID()}`);
  t.after(() => db.close());
  const [request, attempt] = records();
  request.model_id = attempt.model_id = "claude-opus-4-8";
  request.model_evidence = attempt.model_evidence = "response_field";
  const original = await executor.estimate(
    { family: "live", request, attempt },
    { methodId: methods.ecologits.method_id },
  );
  await db.commit(
    scope,
    [request, attempt],
    [
      {
        store: "local_estimates",
        value: {
          key: `current:${scope.namespace}:${attempt.attempt_id}`,
          namespace: scope.namespace,
          selection: "current",
          estimate: original,
        },
      },
    ],
  );
  return { db, request, attempt, original };
}

async function removeRow(db: Ledger, store: string, key: string) {
  const native = (db as unknown as { db: IDBDatabase }).db;
  const tx = native.transaction(store, "readwrite");
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
  tx.objectStore(store).delete(key);
  await done;
}

test("original summaries retain archived sources after request-only metadata changes", async (t) => {
  const { db, request, attempt, original } = await seed(t);
  const before = canonicalJson(await db.all("estimation_originals"));
  const latest: RequestObservation = {
    ...request,
    revision: 2,
    features: ["text", "search", "image_generation"],
  };
  await db.write(personal, latest);
  for (const conversation of [undefined, request.conversation_key]) {
    const result = await scanSummary(
      db,
      personal.namespace,
      {},
      conversation,
      false,
      undefined,
      async (currentAttempt, receivedOriginal, parent) => {
        assert.deepEqual(currentAttempt, attempt);
        assert.deepEqual(parent, latest);
        assert.deepEqual(receivedOriginal, original);
        return receivedOriginal;
      },
    );
    assert.equal(result.requests, 1);
    assert.equal(result.attempts, 1);
    assert.equal(result.images.unknown, 1, "current features drive counting");
    assert.equal(result.metrics.energy.known, 1);
    assert.equal(result.metrics.energy.unknown, 0);
    assert.deepEqual(result.estimate, original);
    assert.deepEqual(result.estimate?.raw, original.raw);
  }
  assert.deepEqual(
    (await scanSummary(db, personal.namespace)).estimate,
    original,
  );
  assert.equal(canonicalJson(await db.all("estimation_originals")), before);
});

test("original summaries count and filter alias children using the current canonical request", async (t) => {
  const { db, request, original } = await seed(t);
  const canonical: RequestObservation = {
    ...request,
    request_id: crypto.randomUUID(),
    site: "chatgpt",
    features: ["text", "image_generation"],
  };
  await db.write(personal, canonical);
  await db.markAlias(
    personal.namespace,
    "request",
    request.request_id,
    canonical.request_id,
  );
  for (const conversation of [undefined, request.conversation_key]) {
    const included = await scanSummary(
      db,
      personal.namespace,
      { site: "chatgpt" },
      conversation,
      false,
      undefined,
      (_attempt, archived, parent) => {
        assert.deepEqual(parent, canonical);
        return archived;
      },
    );
    assert.equal(included.requests, 1);
    assert.equal(included.attempts, 1);
    assert.equal(included.tools.chatgpt, 1);
    assert.equal(included.tools.claude, 0);
    assert.equal(included.images.unknown, 1);
    assert.equal(included.metrics.energy.known, 1);
    assert.deepEqual(included.estimate, original);
    const excluded = await scanSummary(
      db,
      personal.namespace,
      { site: "claude" },
      conversation,
    );
    assert.equal(excluded.requests, 0);
    assert.equal(excluded.attempts, 0);
    assert.equal(excluded.metrics.energy.known, 0);
    assert.equal(excluded.estimate, null);
  }
});

test("archived original proof cannot admit a stale recalculation or altered original", async (t) => {
  const { db, request, attempt, original } = await seed(t);
  const stale = await executor.estimate(
    { family: "live", request, attempt },
    {
      methodId: methods.ecologits.method_id,
      view: "recalculated",
      originalMethodHash: original.requested_method.method_hash,
    },
  );
  const latest = { ...request, revision: 2 };
  await db.write(personal, latest);
  const fresh = await executor.estimate(
    { family: "live", request: latest, attempt },
    {
      methodId: methods.ecologits.method_id,
      view: "recalculated",
      originalMethodHash: original.requested_method.method_hash,
    },
  );
  for (const [estimate, known] of [
    [stale, 0],
    [fresh, 1],
  ] as const) {
    const result = await scanSummary(
      db,
      personal.namespace,
      { calculationView: "recalculated" },
      undefined,
      false,
      undefined,
      (_attempt, archived, parent) => {
        assert.deepEqual(archived, original);
        assert.deepEqual(parent, latest);
        return estimate;
      },
    );
    assert.equal(result.metrics.energy.known, known);
    assert.equal(result.metrics.energy.unknown, 1 - known);
  }
  const altered = await scanSummary(
    db,
    personal.namespace,
    {},
    undefined,
    false,
    undefined,
    (_attempt, archived) => {
      assert.equal(archived?.schema_version, "3.0.0");
      (archived as EstimationEnvelope).metrics.energy.value = "999";
      return archived;
    },
  );
  assert.equal(altered.metrics.energy.known, 0);
  assert.equal(altered.estimate, null);
});

test("a current compatibility pointer cannot replace a missing original archive", async (t) => {
  const { db, request, original } = await seed(t);
  for (const entry of await db.all<{ key: string }>("estimation_originals"))
    await removeRow(db, "estimation_originals", entry.key);
  for (const revised of [false, true]) {
    if (revised) await db.write(personal, { ...request, revision: 2 });
    const result = await scanSummary(db, personal.namespace);
    assert.equal(result.metrics.energy.known, 0);
    assert.equal(result.metrics.energy.unknown, 1);
    assert.equal(result.estimate, null);
  }
  assert.ok(original.raw, "the omitted compatibility result had real values");
});

test("missing archived input fails visibly instead of trusting the current pointer", async (t) => {
  const { db, request } = await seed(t);
  await db.write(personal, { ...request, revision: 2 });
  await removeRow(
    db,
    "measurements",
    `${personal.namespace}:request:${request.request_id}:${request.revision}`,
  );
  await assert.rejects(
    scanSummary(db, personal.namespace),
    /ledger_integrity_failed/,
  );
});

test("an original for a superseded attempt does not contribute", async (t) => {
  const { db, attempt } = await seed(t);
  await db.write(personal, { ...attempt, revision: 2 });
  const result = await scanSummary(db, personal.namespace);
  assert.equal(result.attempts, 1);
  assert.equal(result.metrics.energy.known, 0);
  assert.equal(result.metrics.energy.unknown, 1);
});

test("incomplete policy records never activate the policy-free legacy fallback", async (t) => {
  const { db, request } = await seed(t);
  await db.write(personal, { ...request, revision: 2 });
  await db.put("policy", { key: "ownership-history", eras: [] });
  const result = await scanSummary(db, personal.namespace);
  assert.equal(result.metrics.energy.known, 0);
  assert.equal(result.estimate, null);
});

test("original summaries use current enrollment authority for a retained prior era and reject revocation", async (t) => {
  const previous: Scope = {
    namespace: "company:summary-original-proof",
    mode: "company",
    era: "one",
  };
  const { db, request, original } = await seed(t, previous);
  await db.write(previous, { ...request, revision: 2 });
  const current: Scope = { ...previous, era: "two" };
  const credentials = {
    key: "credentials",
    namespace: current.namespace,
    device_id: "device-1",
    enrollment_era: { id: current.era },
    enrollment_state: "active",
  };
  await db.policyTransaction([
    credentials,
    {
      key: "ownership-history",
      eras: [
        { scope: previous, start: 0, end: 1 },
        { scope: current, start: 1, end: null },
      ],
    },
  ]);
  assert.deepEqual(
    (await scanSummary(db, current.namespace)).estimate,
    original,
  );
  await db.put("policy", { ...credentials, enrollment_state: "revoked" });
  const revoked = await scanSummary(db, current.namespace);
  assert.equal(revoked.metrics.energy.known, 0);
  assert.equal(revoked.estimate, null);
});

test("summary retries when a prior-era grant changes during an async selector", async (t) => {
  const previous: Scope = {
    namespace: "company:summary-original-race",
    mode: "company",
    era: "one",
  };
  const { db, request, original } = await seed(t, previous);
  await db.write(previous, { ...request, revision: 2 });
  const current: Scope = { ...previous, era: "two" };
  const last = { scope: current, start: 1, end: null };
  await db.policyTransaction([
    {
      key: "credentials",
      namespace: current.namespace,
      device_id: "device-1",
      enrollment_era: { id: current.era },
      enrollment_state: "active",
    },
    {
      key: "ownership-history",
      eras: [{ scope: previous, start: 0, end: 1 }, last],
    },
  ]);
  let calls = 0;
  const result = await scanSummary(
    db,
    current.namespace,
    {},
    undefined,
    false,
    undefined,
    async (_attempt, archived) => {
      calls++;
      if (calls === 1) {
        assert.deepEqual(archived, original);
        await db.put("policy", {
          key: "ownership-history",
          eras: [last],
        });
      } else assert.equal(archived, undefined);
      return archived;
    },
  );
  assert.equal(calls, 2);
  assert.equal(result.metrics.energy.known, 0);
  assert.equal(result.estimate, null);
});

test("saved Personal original remains inspectable on company fallback only with its recorded read grant", async (t) => {
  const { db, request, original } = await seed(t);
  await db.write(personal, { ...request, revision: 2 });
  const company: Scope = {
    namespace: "company:summary-personal-fallback",
    mode: "company",
    era: "company-one",
  };
  const last = { scope: company, start: 1, end: null };
  await db.policyTransaction([
    { key: "personal", namespace: personal.namespace },
    {
      key: "credentials",
      namespace: company.namespace,
      device_id: "device-1",
      enrollment_era: { id: company.era },
      enrollment_state: "revoked",
    },
    {
      key: "ownership-history",
      eras: [{ scope: personal, start: 0, end: 1 }, last],
    },
  ]);
  assert.deepEqual(
    (await scanSummary(db, personal.namespace)).estimate,
    original,
  );
  await db.put("policy", { key: "ownership-history", eras: [last] });
  const noGrant = await scanSummary(db, personal.namespace);
  assert.equal(noGrant.metrics.energy.known, 0);
  assert.equal(noGrant.estimate, null);
});
