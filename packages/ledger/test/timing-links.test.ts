import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import "fake-indexeddb/auto";
import {
  composeOutputTotal,
  emptyGeneration,
  historyResponseParts,
  HistoryMessageSchema,
  HistoryPageSchema,
  historyNumericPayloadHash,
  payloadHash,
  type HistoryMessage,
} from "@footprint/contracts";
import { Ledger, type Scope } from "../src/index";
import { createMemoryRepository } from "../src/memory-repository";
import type { ApplicationRepository } from "../src/repository-contracts";
import { historyAuthority } from "../src/ledger-support";
import { records } from "./factory";
import {
  createMethodRegistry,
  LocalEstimateExecutor,
  estimateHistoricalText,
} from "../../estimator/src/index";
import configuration from "../../../config/estimation.build.json";
import mappings from "../../../config/estimation.mappings.json";
import media from "../../../config/estimation.media.json";
const methods = createMethodRegistry(configuration, mappings, media),
  executor = new LocalEstimateExecutor(methods);
const scope: Scope = {
  namespace: "personal:timing-links",
  mode: "personal",
  era: null,
};
const liveTiming = {
  duration_seconds: "12.5",
  source: "browser_request",
  scope: "request",
  completeness: "complete_for_scope",
  profile_version: "timing-observation-1",
} as const;
const historyTiming = {
  ...liveTiming,
  duration_seconds: "10",
  source: "claude_history",
  scope: "content_blocks",
} as const;
async function setup(kind: string, t: TestContext) {
  const db =
    kind === "IndexedDB" ? await Ledger.open(crypto.randomUUID()) : null;
  if (db) t.after(() => db.close());
  const repository = db?.application ?? createMemoryRepository();
  await repository.applySessionChanges({
    settings: { paused: false, budget: null, timezone: "UTC" },
    personal: { namespace: scope.namespace, secret: "a".repeat(64) },
    installation: { routingSecret: "b".repeat(64) },
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
  return repository;
}
function pair() {
  const pair = records();
  pair[0].state = "completed";
  pair[0].ended_at = "2026-09-10T10:00:12.500Z";
  pair[1].provider_attempt_key = "d".repeat(64);
  pair[1].state = "completed";
  pair[1].ended_at = pair[0].ended_at;
  pair[1].timing = liveTiming;
  pair[1].tokens.answer_output = {
    ...pair[1].tokens.answer_output,
    value: "200",
    completeness: "partial",
  };
  pair[1].tokens.output_total = composeOutputTotal(pair[1].tokens);
  return pair;
}
function history(live = pair()): HistoryMessage {
  return HistoryMessageSchema.parse({
    schema_version: "3.0.0",
    kind: "history_message",
    message_key: "e".repeat(64),
    role: "response",
    conversation_key: live[0].conversation_key,
    key_version: "1",
    site: live[0].site,
    parent_key: null,
    prompt_key: "f".repeat(64),
    provider_request_key: live[0].provider_request_key,
    provider_attempt_key: live[1].provider_attempt_key,
    occurred_at: live[0].dispatched_at,
    date_basis: "message_created",
    observed_at: "2026-09-15T00:00:00.000Z",
    model_id: null,
    proposed_method_id: methods.original.method_id,
    company_dedup_key: null,
    proposed_method_hash: methods.original.method_hash,
    tokens: {
      ...live[1].tokens.answer_output,
      value: "500",
      completeness: "complete_for_scope",
    },
    inline_file_text: null,
    parts: historyResponseParts({
      ...live[1].tokens.answer_output,
      value: "500",
      completeness: "complete_for_scope",
    }),
    generation: emptyGeneration(),
    text_complete: true,
    coverage_reasons: ["history_only"],
    timing: live[0].site === "claude" ? historyTiming : null,
  });
}
async function capture(
  r: ApplicationRepository,
  live: ReturnType<typeof pair>,
) {
  const result = await executor.estimate({
    family: "live",
    request: live[0],
    attempt: live[1],
  });
  await r.commitCapture({
    scope,
    observations: live,
    originals: [result],
    currentEstimate: { attemptId: live[1].attempt_id, estimate: result },
  });
  return result;
}
async function importHistory(
  r: ApplicationRepository,
  message: HistoryMessage,
) {
  const page = HistoryPageSchema.parse({
    schema_version: "3.0.0",
    site: message.site,
    conversation_key: message.conversation_key,
    observed_at: message.observed_at,
    deletion_epoch: 0,
    branch_scope: "loaded_messages",
    selected_leaf_key: null,
    branch_message_keys: null,
    root_message_key: null,
    first_request_verified: false,
    has_earlier: null,
    has_later: null,
    messages: [message],
  });
  const state = await r.publicationSnapshot(scope.namespace);
  await r.commitHistory(
    scope,
    page,
    {
      authority: historyAuthority(state),
      erasureVersion: state.erasureVersion,
      estimates: { [message.message_key]: estimateHistoricalText(message) },
      envelopes: {
        [message.message_key]: await executor.estimate({
          family: "history",
          record: message,
        }),
      },
    },
    () => true,
  );
}
for (const kind of ["IndexedDB", "Memory"]) {
  for (const order of ["live-first", "history-first"])
    test(`${kind}: ${order} joins complete history once while retaining live timing and original`, async (t) => {
      const r = await setup(kind, t),
        live = pair(),
        message = history(live);
      if (order === "history-first") await importHistory(r, message);
      const original = await capture(r, live);
      if (order === "live-first") await importHistory(r, message);
      const input = await r.estimation.liveInput(scope, live[1].attempt_id);
      assert.equal(input?.history?.tokens.value, "500");
      assert.deepEqual(input?.attempt.timing, liveTiming);
      assert.equal(
        input?.source.history_binding?.observation_hash,
        historyNumericPayloadHash(message),
      );
      const immutable = await r.estimation.originalForLive(scope, {
        attemptId: live[1].attempt_id,
        attemptRevision: 1,
        attemptHash: payloadHash(live[1]),
      });
      assert.deepEqual(immutable?.result, original);
      await importHistory(r, message);
      assert.equal(
        (await r.estimation.liveInput(scope, live[1].attempt_id))?.sequence,
        input?.sequence,
      );
      assert.equal(await r.historyLiveOverlap(scope, message), true);
      const views = await r.estimation.viewPage({ scope, view: "original" });
      assert.equal(views.rows.filter((row) => row.contributes).length, 1);
    });
  test(`${kind}: history timing refinement invalidates a calculated live snapshot and preserves originals`, async (t) => {
    const r = await setup(kind, t),
      live = pair(),
      message = history(live);
    live[1].timing = null;
    message.timing = null;
    await capture(r, live);
    await importHistory(r, message);
    const originalHistory = (await r.findHistoryMessage(
      scope,
      message.message_key,
    ))!.original;
    const job = await r.estimation.start({
      scope,
      target: methods.ecologits,
      selectionRevision: 1,
    });
    const input = (await r.estimation.page(job.id)).inputs.find(
      (i) => i.family === "live",
    )!;
    assert.equal(input.family, "live");
    if (input.family !== "live") return;
    const result = await executor.estimate(
      {
        family: "live",
        request: input.request,
        attempt: input.attempt,
        history: input.history,
      },
      {
        view: "recalculated",
        methodId: methods.ecologits.method_id,
        originalMethodHash: input.originalMethodHash!,
      },
    );
    await importHistory(r, { ...message, timing: historyTiming });
    assert.equal(
      await r.estimation.commitResult({
        jobId: job.id,
        inputKey: input.key,
        sequence: input.sequence,
        result,
      }),
      "stale",
    );
    const next = await r.estimation.liveInput(scope, live[1].attempt_id);
    assert.notEqual(
      next?.source.history_binding?.observation_hash,
      input.source.history_binding?.observation_hash,
    );
    assert.deepEqual(
      (await r.findHistoryMessage(scope, message.message_key))?.original,
      originalHistory,
    );
  });
  test(`${kind}: four aliases match once, while distinct retries remain separate`, async (t) => {
    const r = await setup(kind, t),
      live = pair(),
      message = history(live);
    await capture(r, live);
    for (let index = 1; index <= 4; index++) {
      const alias = structuredClone(live);
      alias[1].attempt_id = crypto.randomUUID();
      alias[1].started_at = `2026-09-10T10:00:0${index}.000Z`;
      await capture(r, alias);
    }
    await r.coalesceProviderIdentity(
      scope.namespace,
      "attempt",
      live[1].provider_attempt_key!,
    );
    await importHistory(r, message);
    assert.equal(await r.historyLiveOverlap(scope, message), true);
    assert.equal(
      (await r.estimation.viewPage({ scope, view: "original" })).rows.filter(
        (row) => row.contributes,
      ).length,
      1,
    );
    const retry = pair();
    retry[0].action = "regenerate";
    retry[1].provider_attempt_key = "c".repeat(64);
    await capture(r, retry);
    assert.equal(
      (await r.estimation.viewPage({ scope, view: "original" })).rows.filter(
        (row) => row.contributes,
      ).length,
      2,
    );
  });
  test(`${kind}: a later alias with complete live timing becomes the canonical contribution`, async (t) => {
    const r = await setup(kind, t),
      incomplete = pair();
    incomplete[1].timing = null;
    await capture(r, incomplete);
    const complete = structuredClone(incomplete);
    complete[1].attempt_id = crypto.randomUUID();
    complete[1].started_at = "2026-09-10T10:00:01.000Z";
    complete[1].timing = liveTiming;
    const original = await capture(r, complete);
    await r.coalesceProviderIdentity(
      scope.namespace,
      "attempt",
      complete[1].provider_attempt_key!,
    );
    await importHistory(r, history(complete));
    assert.equal(
      await r.estimation.liveInput(scope, incomplete[1].attempt_id),
      null,
    );
    const current = await r.estimation.liveInput(scope, complete[1].attempt_id);
    assert.deepEqual(current?.attempt.timing, liveTiming);
    assert.equal(current?.history?.tokens.value, "500");
    assert.deepEqual(
      (
        await r.estimation.originalForLive(scope, {
          attemptId: complete[1].attempt_id,
          attemptRevision: complete[1].revision,
          attemptHash: payloadHash(complete[1]),
        })
      )?.result,
      original,
    );
    await r.coalesceProviderIdentity(
      scope.namespace,
      "attempt",
      complete[1].provider_attempt_key!,
    );
    assert.equal(
      (await r.estimation.viewPage({ scope, view: "original" })).rows.filter(
        (row) => row.contributes,
      ).length,
      1,
    );
  });
  for (const requestAlias of [false, true])
    for (const archive of [false, true])
      test(`${kind}: completing a previously aliased capture restores its pin (archive=${archive}, requestAlias=${requestAlias})`, async (t) => {
        const r = await setup(kind, t),
          first = pair();
        first[0].provider_request_key = "b".repeat(64);
        first[1].timing = null;
        first[1].state = "generating";
        first[1].ended_at = null;
        await capture(r, first);
        const alias = structuredClone(first);
        if (requestAlias) {
          alias[0].request_id = crypto.randomUUID();
          alias[0].dispatched_at = "2026-09-10T10:00:01.000Z";
          alias[1].request_id = alias[0].request_id;
        }
        alias[1].attempt_id = crypto.randomUUID();
        alias[1].started_at = "2026-09-10T10:00:01.000Z";
        await capture(r, alias);
        if (requestAlias)
          await r.coalesceProviderIdentity(
            scope.namespace,
            "request",
            alias[0].provider_request_key!,
          );
        await r.coalesceProviderIdentity(
          scope.namespace,
          "attempt",
          alias[1].provider_attempt_key!,
        );
        assert.equal(
          await r.estimation.liveInput(scope, alias[1].attempt_id),
          null,
        );
        alias[1].revision = 2;
        alias[1].state = "completed";
        alias[1].ended_at = "2026-09-10T10:00:12.500Z";
        alias[1].timing = liveTiming;
        const original = archive ? await capture(r, alias) : null;
        if (!archive)
          await r.commitCapture({
            scope,
            observations: [alias[1]],
            currentEstimate: { attemptId: alias[1].attempt_id, estimate: null },
          });
        await r.coalesceProviderIdentity(
          scope.namespace,
          "attempt",
          alias[1].provider_attempt_key!,
        );
        const promoted = await r.estimation.liveInput(
          scope,
          alias[1].attempt_id,
        );
        assert.equal(
          promoted?.originalMethodHash,
          methods.original.method_hash,
        );
        assert.equal(promoted?.originalMethodState, "recorded");
        if (requestAlias) {
          assert.equal(promoted?.request.request_id, first[0].request_id);
          assert.equal(promoted?.attempt.request_id, alias[0].request_id);
          assert.ok(promoted?.source.canonical_request_binding);
          await assert.rejects(
            executor.estimate({
              family: "live",
              request: promoted!.request,
              attempt: promoted!.attempt,
            }),
            /dependency_missing/,
          );
          if (original?.source.family === "live")
            assert.equal(original.source.request_id, alias[0].request_id);
        }
        assert.equal(
          (
            await r.estimation.viewPage({ scope, view: "original" })
          ).rows.filter((row) => row.contributes).length,
          1,
        );
        if (archive)
          assert.deepEqual(
            (
              await r.estimation.originalForLive(scope, {
                attemptId: alias[1].attempt_id,
                attemptRevision: 2,
                attemptHash: payloadHash(alias[1]),
              })
            )?.result,
            original,
          );
      });
  test(`${kind}: current original evidence proof tracks revisions, history links and erasure`, async (t) => {
    const r = await setup(kind, t),
      live = pair();
    await capture(r, live);
    assert.equal(
      (await r.estimation.state(scope)).originalEvidenceCurrent,
      true,
    );
    assert.equal(
      (await r.estimation.localSelectionState(scope)).members[0]
        ?.originalEvidenceCurrent,
      true,
    );
    live[0].revision++;
    await r.capture(scope, [live[0]]);
    assert.equal(
      (await r.estimation.state(scope)).originalEvidenceCurrent,
      false,
    );
    await capture(r, live);
    assert.equal(
      (await r.estimation.state(scope)).originalEvidenceCurrent,
      true,
    );
    const message = history(live);
    message.occurred_at = "2020-01-01T00:00:00.000Z";
    await importHistory(r, message);
    assert.equal(
      (await r.estimation.state(scope)).originalEvidenceCurrent,
      false,
    );
    await r.applyRange(
      scope,
      "2020-01-01T00:00:00.000Z",
      "2021-01-01T00:00:00.000Z",
      1,
    );
    assert.equal(
      (await r.estimation.state(scope)).originalEvidenceCurrent,
      true,
    );
  });
  test(`${kind}: coalescing selects a canonical capture independently in every identity group`, async (t) => {
    const r = await setup(kind, t);
    const all: ReturnType<typeof pair>[] = [];
    for (const conversation of ["a", "b"]) {
      const live = pair();
      live[0].conversation_key = conversation.repeat(64);
      live[1].timing = null;
      await capture(r, live);
      all.push(live);
      const alias = structuredClone(live);
      alias[1].attempt_id = crypto.randomUUID();
      alias[1].timing = liveTiming;
      await capture(r, alias);
      all.push(alias);
    }
    await r.coalesceProviderIdentity(
      scope.namespace,
      "attempt",
      all[0][1].provider_attempt_key!,
    );
    for (let index = 0; index < all.length; index++)
      assert.equal(
        !!(await r.estimation.liveInput(scope, all[index][1].attempt_id)),
        index % 2 === 1,
      );
    assert.equal(
      (await r.estimation.viewPage({ scope, view: "original" })).rows.filter(
        (row) => row.contributes,
      ).length,
      2,
    );
  });
  test(`${kind}: ambiguous requests, conversations and duplicate historical identities cannot establish a link`, async (t) => {
    const r = await setup(kind, t),
      live = pair(),
      message = history(live);
    live[0].coverage_reasons.push("request_identity_ambiguous");
    await capture(r, live);
    await importHistory(r, message);
    assert.equal(await r.historyLiveOverlap(scope, message), false);
    assert.equal(
      (await r.estimation.liveInput(scope, live[1].attempt_id))?.history,
      undefined,
    );
    live[0].revision++;
    live[0].coverage_reasons = [];
    await r.capture(scope, [live[0]]);
    assert.equal(
      await r.historyLiveOverlap(scope, {
        ...message,
        conversation_key: "b".repeat(64),
      }),
      false,
    );
    assert.equal(await r.historyLiveOverlap(scope, message), true);
    await importHistory(r, { ...message, message_key: "b".repeat(64) });
    assert.equal(await r.historyLiveOverlap(scope, message), false);
    assert.equal(
      (await r.estimation.liveInput(scope, live[1].attempt_id))?.history,
      undefined,
    );
  });
  test(`${kind}: a matched send proves its historical prompt while a regeneration alone does not`, async (t) => {
    const r = await setup(kind, t),
      live = pair(),
      response = history(live);
    await capture(r, live);
    await importHistory(r, response);
    const prompt = {
      ...response,
      message_key: response.prompt_key!,
      role: "prompt" as const,
      prompt_key: null,
      provider_attempt_key: null,
      timing: null,
    };
    assert.equal(await r.historyLiveOverlap(scope, prompt), true);
    live[0].revision++;
    live[0].action = "regenerate";
    await r.capture(scope, [live[0]]);
    assert.equal(await r.historyLiveOverlap(scope, prompt), false);
  });
  test(`${kind}: Perplexity provisional conversations require the same entry and answer identity`, async (t) => {
    const r = await setup(kind, t),
      live = pair();
    live[0].site = "perplexity";
    live[0].provider_request_key = "b".repeat(64);
    const message = history(live);
    message.conversation_key = "c".repeat(64);
    message.timing = null;
    await capture(r, live);
    await importHistory(r, message);
    assert.equal(await r.historyLiveOverlap(scope, message), true);
    assert.equal(
      await r.historyLiveOverlap(scope, {
        ...message,
        provider_request_key: "f".repeat(64),
      }),
      false,
    );
  });
  test(`${kind}: history-only erasure removes the binding and invalidates the surviving live input`, async (t) => {
    const r = await setup(kind, t),
      live = pair(),
      message = history(live);
    message.occurred_at = "2020-01-01T00:00:00.000Z";
    const original = await capture(r, live);
    await importHistory(r, message);
    const before = await r.estimation.liveInput(scope, live[1].attempt_id);
    await r.applyRange(
      scope,
      "2020-01-01T00:00:00.000Z",
      "2021-01-01T00:00:00.000Z",
      1,
    );
    const after = await r.estimation.liveInput(scope, live[1].attempt_id);
    assert.ok(after);
    assert.equal(after.history, undefined);
    assert.equal(after.source.history_binding, undefined);
    assert.ok(after.sequence > before!.sequence);
    assert.deepEqual(
      (
        await r.estimation.originalForLive(scope, {
          attemptId: live[1].attempt_id,
          attemptRevision: live[1].revision,
          attemptHash: payloadHash(live[1]),
        })
      )?.result,
      original,
    );
  });
  test(`${kind}: erasing a linked family removes evidence and prevents reimport`, async (t) => {
    const r = await setup(kind, t),
      live = pair(),
      message = history(live);
    await capture(r, live);
    await importHistory(r, message);
    await r.eraseFamily(scope.namespace, live[0].request_id);
    await importHistory(r, message);
    assert.equal(await r.estimation.liveInput(scope, live[1].attempt_id), null);
    assert.equal(
      (await r.estimation.viewPage({ scope, view: "original" })).rows.length,
      0,
    );
    assert.equal(await r.historyLiveOverlap(scope, message), false);
  });
}
test("IndexedDB: reopening preserves the linked input and counts its response once", async (t) => {
  const name = crypto.randomUUID();
  let db = await Ledger.open(name);
  const r = db.application,
    live = pair(),
    message = history(live);
  await r.applySessionChanges({
    settings: { paused: false, budget: null, timezone: "UTC" },
    personal: { namespace: scope.namespace, secret: "a".repeat(64) },
    installation: { routingSecret: "b".repeat(64) },
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
  await capture(r, live);
  await importHistory(r, message);
  const before = await r.estimation.liveInput(scope, live[1].attempt_id);
  db.close();
  db = await Ledger.open(name);
  t.after(() => db.close());
  assert.deepEqual(
    await db.estimation.liveInput(scope, live[1].attempt_id),
    before,
  );
  await importHistory(db.application, message);
  assert.equal(
    (await db.estimation.viewPage({ scope, view: "original" })).rows.filter(
      (row) => row.contributes,
    ).length,
    1,
  );
});

test("IndexedDB: version15 resets obsolete checkpoints and method caches but preserves authentication, settings and erasure barriers", async (t) => {
  const name = crypto.randomUUID(),
    opening = indexedDB.open(name, 14);
  opening.onupgradeneeded = () => {
    for (const name of [
      "policy",
      "deletion_markers",
      "engine_preferences",
      "requests",
    ])
      opening.result.createObjectStore(name, { keyPath: "key" });
  };
  const old = await new Promise<IDBDatabase>((resolve, reject) => {
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
  const tx = old.transaction(
    ["policy", "deletion_markers", "engine_preferences", "requests"],
    "readwrite",
  );
  const settings = { key: "settings", paused: true },
    credentials = {
      key: "credentials",
      access_token: "fixture-secret",
      namespace: "company:fixture",
    };
  tx.objectStore("policy").put(settings);
  tx.objectStore("policy").put(credentials);
  tx.objectStore("policy").put({
    key: "capture:obsolete",
    request: { schema_version: "1.1.0" },
  });
  tx.objectStore("policy").put({
    key: "engine-method:obsolete",
    method_hash: "a".repeat(64),
  });
  tx.objectStore("policy").put({
    key: "monthly:personal:fixture",
    month: "2026-08",
  });
  tx.objectStore("deletion_markers").put({
    key: "personal:erased",
    namespace: "personal:erased",
  });
  tx.objectStore("requests").put({ key: "obsolete", schema_version: "1.1.0" });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  old.close();
  const db = await Ledger.open(name);
  t.after(() => db.close());
  assert.deepEqual(await db.get("policy", "settings"), settings);
  assert.deepEqual(await db.get("policy", "credentials"), credentials);
  assert.equal(await db.get("policy", "capture:obsolete"), undefined);
  assert.equal(await db.get("policy", "engine-method:obsolete"), undefined);
  assert.equal(await db.get("policy", "monthly:personal:fixture"), undefined);
  assert.deepEqual(await db.all("requests"), []);
  assert.deepEqual(await db.get("deletion_markers", "personal:erased"), {
    key: "personal:erased",
    namespace: "personal:erased",
  });
  const obsolete = pair();
  (obsolete[0] as any).schema_version = "1.1.0";
  await assert.rejects(db.capture(scope, obsolete));
});
