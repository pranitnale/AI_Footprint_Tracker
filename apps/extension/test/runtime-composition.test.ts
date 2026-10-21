import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { Ledger, createMemoryRepository } from "@footprint/ledger";
import {
  EstimationFailure,
  LocalEstimateExecutor,
  type EstimateExecutor,
} from "@footprint/estimator";
import { initialSnapshot } from "@footprint/adapters";
import { Coordinator } from "../lib/coordinator";
import type { CompanySession } from "../lib/company";
import { archivedEstimation } from "./archived-engine-fixture";
const packagedMethods = archivedEstimation.methods;
import { countByTextLength } from "./counting-fixture";
import { records } from "../../../packages/ledger/test/factory";
import { HISTORY_CAPTURE_CHANNEL } from "../lib/history-capture";
import {
  historyPage,
  historyBinding,
  historySender,
  historyConversation,
} from "./history-fixture";

function personalSession(): CompanySession {
  const unexpected = async (): Promise<never> => {
    throw new Error("unexpected organization operation");
  };
  return {
    credentials: async () => undefined,
    pending: async () => undefined,
    requestCode: unexpected,
    verifyCode: unexpected,
    confirm: unexpected,
    cancel: unexpected,
    disconnect: unexpected,
    authorized: unexpected,
    threadRequest: unexpected,
    estimationSelection: unexpected,
    methodRequest: unexpected,
    linkThread: unexpected,
    resolvePendingPolicy: unexpected,
    sync: unexpected,
    maintenance: unexpected,
    applyDeletions: unexpected,
    sharingPaused: () => false,
    sharingHeld: () => false,
    checkPolicy: unexpected,
  };
}

for (const backend of ["indexeddb", "memory"] as const)
  test(`${backend}: injected executor and session serve capture, history, canonical reconciliation and recalculation`, async () => {
    const db =
      backend === "indexeddb"
        ? await Ledger.open("runtime-port-" + crypto.randomUUID())
        : null;
    const repository = db?.application ?? createMemoryRepository();
    const calls: Array<{ family: string; view: string | undefined }> = [];
    const executor: EstimateExecutor = {
      executionOrigin: "local",
      async estimate(input, options) {
        calls.push({ family: input.family, view: options?.view });
        throw new EstimationFailure("method_unsupported");
      },
    };
    const organization = personalSession();
    let network = 0;
    const coordinator = new Coordinator(repository, {
      count: countByTextLength,
      hasConsent: async () => true,
      sendDisplay: async () => {},
      organization,
      estimation: { methods: packagedMethods, executor },
      transport: async () => {
        network++;
        throw new Error("unexpected network");
      },
    });
    try {
      await coordinator.whenReady();
      assert.equal(coordinator.company, organization);
      assert.notEqual(coordinator.engines.executor, executor);
      assert.equal(coordinator.engines.executor.executionOrigin, "local");
      const scope = await coordinator.currentScope();
      const at = new Date().toISOString();
      await coordinator.capture(
        { timing: null,
          channel: "ai-footprint-observation-v1",
          version: 1,
          id: crypto.randomUUID(),
          revision: 1,
          event: "dispatch",
          site: "claude",
          at,
          dispatch: {
            site: "claude",
            action: "send",
            input: "synthetic",
            conversationId: historyConversation,
            parentId: null,
            requestId: "synthetic-port",
            model: null,
            attachments: 0,
            imageEditParentId: null,
          },
          snapshot: initialSnapshot(),
          failure: null,
        },
        historySender,
      );
      assert.ok(calls.some((call) => call.family === "live"));
      let observed = 0;
      await repository.scanRequests(scope.namespace, (rows) => {
        observed += rows.length;
      });
      await repository.scanAttempts(scope.namespace, (rows) => {
        observed += rows.length;
      });
      assert.equal(observed, 2);
      assert.equal(
        (await repository.estimation.viewPage({ scope, view: "original" }))
          .rows[0].result,
        null,
      );

      const page = historyPage(2),
        binding = historyBinding();
      const common = {
        channel: HISTORY_CAPTURE_CHANNEL as typeof HISTORY_CAPTURE_CHANNEL,
        id: crypto.randomUUID(),
        site: "claude" as const,
        conversationId: page.conversationId,
        observedAt: page.observedAt,
      };
      await coordinator.history.receive(
        { ...common, event: "start", page: null },
        binding,
        historySender,
      );
      await coordinator.history.receive(
        { ...common, event: "page", page },
        binding,
        historySender,
      );
      assert.ok(calls.some((call) => call.family === "history"));

      const pair = records();
      const original = await new LocalEstimateExecutor(
        packagedMethods,
      ).estimate({
        family: "live",
        request: pair[0],
        attempt: pair[1],
      });
      await repository.commitCapture({
        scope,
        observations: pair,
        originals: [original],
      });
      const beforeCanonical = calls.length;
      await organization.canonicalEstimation!(scope, pair[1]);
      assert.equal(calls.length, beforeCanonical + 1);
      assert.equal(calls.at(-1)?.family, "live");

      const status = await coordinator.engines.status();
      await coordinator.engines.select({
        preference: "original",
        expectedRevision: status.selectionRevision,
      });
      await coordinator.engines.maintainLocal();
      assert.ok(calls.some((call) => call.view === "recalculated"));
      const selected = await repository.estimation.resultFor(
        scope,
        original.source,
        packagedMethods.original.method_hash,
      );
      assert.equal(selected?.view, "original");
      assert.equal(selected?.input_hash, original.input_hash);
      assert.ok((await coordinator.engines.status()).local.unavailable > 0);
      assert.equal(network, 0);
    } finally {
      coordinator.engines.dispose();
      db?.close();
    }
  });
