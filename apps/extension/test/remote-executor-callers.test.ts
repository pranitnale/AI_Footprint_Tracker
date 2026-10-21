import assert from "node:assert/strict";
import test from "node:test";
import { initialSnapshot } from "@footprint/adapters";
import { canonicalJson, EstimationEnvelopeSchema } from "@footprint/contracts";
import type { EstimateExecutor } from "@footprint/estimator";
import { Coordinator } from "../lib/coordinator";
import { HISTORY_CAPTURE_CHANNEL } from "../lib/history-capture";
import { countByTextLength } from "./counting-fixture";
import {
  historyBinding,
  historyConversation,
  historyPage,
  historySender,
} from "./history-fixture";
import {
  boundaryFixture,
  fakeRemote,
  fakeResponse,
  local,
  methods,
  seed,
} from "./remote-executor-fixture";

// These are real application callers with an in-process transport, not a grant
// of remote capability. A local label is a trusted dependency contract, not a sandbox.
for (const backend of ["indexeddb", "memory"] as const) {
  for (const mode of ["personal", "disconnected", "company"] as const) {
    for (const candidate of [
      "organization",
      "missing",
      "unknown",
      "foreign-result",
      "missing-result",
      "local",
    ] as const) {
      test(`${backend}: RCB-01 ${mode} ${candidate} actual canonical/dashboard/live/history callers`, async (t) => {
        const fixture = await boundaryFixture(t, backend, mode);
        const saved = await seed(fixture);
        let calls = 0;
        const networkPaths: string[] = [];
        const families: string[] = [];
        const remote = fakeRemote(fakeResponse);
        const allowed = candidate === "local";
        const callable = allowed || candidate.endsWith("result");
        const executor: EstimateExecutor = {
          ...(candidate !== "missing"
            ? {
                executionOrigin: (candidate === "organization" ||
                candidate === "unknown"
                  ? candidate
                  : "local") as EstimateExecutor["executionOrigin"],
              }
            : {}),
          async estimate(input, options) {
            calls++;
            families.push(input.family);
            if (candidate === "missing-result") {
              const { execution_origin: _origin, ...result } =
                await local.estimate(input, options);
              return result as Awaited<
                ReturnType<EstimateExecutor["estimate"]>
              >;
            }
            return allowed
              ? local.estimate(input, options)
              : remote.estimate(input, options);
          },
        };
        const coordinator = new Coordinator(fixture.repository, {
          count: countByTextLength,
          hasConsent: async () => true,
          sendDisplay: async () => {},
          estimation: { methods, executor },
          transport: async (url) => {
            networkPaths.push(new URL(String(url)).pathname);
            throw new Error("unexpected actual transport");
          },
        });
        t.after(() => {
          coordinator.engines.dispose();
          coordinator.methods.invalidate();
          coordinator.history.invalidate();
        });
        await coordinator.whenReady();
        await coordinator.engines.maintainLocal();
        assert.equal(calls, 0);
        const scope = await coordinator.currentScope();
        assert.deepEqual(scope, fixture.state.scope);

        await coordinator.company.canonicalEstimation!(scope, saved.pair[1]);
        assert.equal(calls, callable ? 1 : 0);
        const originals = await fixture.repository.estimation.viewPage({
          scope,
          view: "original",
        });
        assert.equal(
          canonicalJson(originals.rows[0].result),
          canonicalJson(saved.original),
        );

        const dashboard = coordinator.dashboard({
          calculationView: "recalculated",
          methodId: methods.ecologits.method_id,
        });
        if (allowed) {
          const { summary } = await dashboard;
          assert.equal(summary.metrics.energy.known, 1);
          assert.equal(
            EstimationEnvelopeSchema.parse(summary.estimate).execution_origin,
            "local",
          );
        } else {
          await assert.rejects(dashboard, /method_update_invalid/);
        }
        assert.equal(calls, callable ? 2 : 0);

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
              input: "synthetic boundary prompt",
              conversationId: historyConversation,
              parentId: null,
              requestId: "synthetic-boundary",
              model: null,
              attachments: 0,
              imageEditParentId: null,
            },
            snapshot: initialSnapshot(),
            failure: null,
          },
          historySender,
        );
        let requests = 0,
          attempts = 0;
        await fixture.repository.scanRequests(scope.namespace, (rows) => {
          requests += rows.length;
        });
        await fixture.repository.scanAttempts(scope.namespace, (rows) => {
          attempts += rows.length;
        });
        assert.equal(requests, 2);
        assert.equal(attempts, 2);
        const live = await fixture.repository.estimation.viewPage({
          scope,
          view: "original",
        });
        const captured = live.rows.find(
          (row) => row.key !== originals.rows[0].key,
        );
        assert.ok(captured);
        assert.equal(captured.input?.family, "live");
        if (captured.input?.family === "live")
          assert.ok(
            Number(captured.input.attempt.tokens.new_input_text.value) > 0,
          );
        assert.equal(
          captured.result?.execution_origin ?? null,
          allowed ? "local" : null,
        );
        // A capture settles its recalculation before publishing. A result the
        // boundary rejects leaves the input pending, so it is tried once more.
        assert.equal(calls, callable ? (allowed ? 3 : 4) : 0);
        if (!allowed)
          assert.ok(
            (await fixture.repository.listHealth(scope.namespace)).some(
              (issue) => issue.code === "estimate_unavailable",
            ),
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
        const history = await fixture.repository.estimation.viewPage({
          scope,
          view: "original",
        });
        const imported = history.rows.filter(
          (row) => !live.rows.some((old) => old.key === row.key),
        );
        assert.equal(imported.length, 1);
        assert.equal(imported[0].input?.family, "history");
        if (imported[0].input?.family === "history")
          assert.ok(Number(imported[0].input.history.tokens.value) > 0);
        assert.ok(
          imported.every(
            (row) =>
              (row.result?.execution_origin ?? null) ===
              (allowed ? "local" : null),
          ),
        );
        if (callable) {
          assert.ok(calls > 3);
          assert.ok(families.includes("history"));
        } else {
          assert.equal(calls, 0);
        }
        // Capture/history may schedule existing company summary reads. These
        // fake reads are not remote estimation and never reach a network here.
        if (mode === "company")
          assert.ok(
            networkPaths.every(
              (path) =>
                path === "/v1/me/history" ||
                /^\/v1\/me\/conversations\/[a-f0-9]{64}\/summary$/.test(path),
            ),
          );
        else assert.deepEqual(networkPaths, []);
      });
    }
  }
}
