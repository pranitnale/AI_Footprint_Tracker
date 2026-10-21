import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { Ledger, createMemoryRepository, type Scope } from "@footprint/ledger";
import {
  createMethodRegistry,
  LocalEstimateExecutor,
} from "@footprint/estimator";
import config from "../../../config/estimation.build.json";
import mappings from "../../../config/estimation.mappings.json";
import media from "../../../config/estimation.media.json";
import { records } from "../../../packages/ledger/test/factory";
import { HistoryService } from "../lib/history-service";
import { RecordedThreads } from "../lib/recorded-threads";
import { scanSummary } from "../lib/summary-scan";
import { HISTORY_CAPTURE_CHANNEL } from "../lib/history-capture";
import type { CompanySession } from "../lib/company";
import { countByTextLength } from "./counting-fixture";
import { historyPage, historyBinding, historySender } from "./history-fixture";

const company = {
  credentials: async () => undefined,
  threadRequest: async () =>
    assert.fail("Personal repository views must not use company transport"),
} as unknown as CompanySession;

async function setup(t: test.TestContext, backend: "indexeddb" | "memory") {
  const db =
    backend === "indexeddb"
      ? await Ledger.open(`repository-views-${crypto.randomUUID()}`)
      : null;
  if (db) t.after(() => db.close());
  const repository = db ? db.application : createMemoryRepository();
  assert.equal("get" in repository, false);
  assert.equal("scanIndex" in repository, false);
  assert.equal("application" in repository, false);
  const scope: Scope = {
    namespace: "personal:repository-views",
    mode: "personal",
    era: null,
  };
  const secret = "a".repeat(64);
  await repository.applySessionChanges({
    personal: { namespace: scope.namespace, secret },
    ownershipHistory: {
      eras: [{ scope, secret, policyVersion: "1.0.0", start: 0, end: null }],
    },
  });
  return { repository, scope };
}

for (const backend of ["indexeddb", "memory"] as const) {
  test(`${backend}: summary consumes the domain repository directly and preserves archived original proof`, async (t) => {
    const { repository, scope } = await setup(t, backend);
    const [request, attempt] = records();
    const executor = new LocalEstimateExecutor(
      createMethodRegistry(config, mappings, media),
    );
    const original = await executor.estimate({
      family: "live",
      request,
      attempt,
    });
    await repository.commitCapture({
      scope,
      observations: [request, attempt],
      originals: [original],
      currentEstimate: { attemptId: attempt.attempt_id, estimate: original },
    });
    await repository.commitCapture({
      scope,
      observations: [{ ...request, revision: 2 }],
    });
    const result = await scanSummary(repository, scope.namespace);
    assert.equal(result.requests, 1);
    assert.equal(result.attempts, 1);
    assert.equal(result.metrics.energy.known, 1);
    assert.deepEqual(result.estimate, original);
  });

  test(`${backend}: history admission, replay and selected-branch coverage use only domain methods`, async (t) => {
    const { repository, scope } = await setup(t, backend);
    const history = new HistoryService(
      repository,
      company,
      async () => scope,
      countByTextLength,
      async () => true,
    );
    t.after(() => history.invalidate());
    const page = historyPage();
    for (let replay = 0; replay < 2; replay++) {
      const binding = historyBinding();
      const common = {
        channel: HISTORY_CAPTURE_CHANNEL as typeof HISTORY_CAPTURE_CHANNEL,
        id: crypto.randomUUID(),
        site: page.site,
        conversationId: page.conversationId,
        observedAt: page.observedAt,
      };
      assert.deepEqual(
        await history.receive(
          { ...common, event: "start", page: null },
          binding,
          historySender,
        ),
        { accepted: true },
      );
      assert.deepEqual(
        await history.receive(
          { ...common, event: "page", page },
          binding,
          historySender,
        ),
        { accepted: true },
      );
    }
    const saved = await repository.historyPage(scope, undefined);
    assert.equal(saved.length, 2);
    const conversation = saved[0].record.conversation_key;
    assert.ok(await repository.historyCoverage(scope, conversation));
    const result = await history.local(scope, conversation);
    assert.equal(result.response_count, "1");
    assert.equal(result.first_request_verified, true);
    assert.equal(result.branch_scope, "selected_branch");
  });

  test(`${backend}: recorded-thread summaries accept a domain repository and honor erasure`, async (t) => {
    const { repository, scope } = await setup(t, backend);
    const pair = records();
    pair[0].site = "perplexity";
    pair[0].provider_request_key = "b".repeat(64);
    const threadKey = "c".repeat(64);
    await repository.commitCapture({ scope, observations: pair });
    const before = await repository.summaryVersion(scope.namespace);
    await repository.linkRecordedThread(
      scope,
      threadKey,
      [pair[0].provider_request_key],
      before.erasureVersion,
    );
    const threads = new RecordedThreads(repository, company, async () => scope);
    const result = await threads.view(scope, threadKey, false);
    assert.equal(result.summary.requests, 1);
    assert.equal(result.summary.attempts, 1);
    assert.equal(result.recordedThread.status, "matched_recorded_subset");
    assert.equal(
      result.recordedThread.coverageAfterRestart,
      "saved_links_only",
    );
    await repository.eraseFamily(scope.namespace, pair[0].request_id);
    const erased = await threads.view(scope, threadKey, false);
    assert.equal(erased.summary.requests, 0);
    assert.equal(erased.recordedThread.status, "unavailable");
  });
}
