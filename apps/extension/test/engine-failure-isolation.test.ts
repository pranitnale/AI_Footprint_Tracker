import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson } from "@footprint/contracts";
import {
  BASELINE_BUNDLE,
  BASELINE_METHOD_HASH,
  createMethodRegistry,
  estimateAttempt,
  LocalEstimateExecutor,
} from "@footprint/estimator";
import { Ledger, type Scope } from "@footprint/ledger";
import { archivedConfiguration as configuration } from "./archived-engine-fixture";
import mappings from "../../../config/estimation.mappings.json";
import media from "../../../config/estimation.media.json";
import { records } from "../../../packages/ledger/test/factory";
import { EngineService } from "../lib/estimation/service";
import { scanSummary } from "../lib/summary-scan";

for (const failure of ["load", "calculation"] as const)
  test(`LG10 actual EcoLogits ${failure} failure leaves selected Original capture and recalculation intact`, async (context) => {
    const methods = createMethodRegistry(
      { ...configuration, default_engine: "original" },
      mappings,
      media,
    );
    let loads = 0;
    let calculations = 0;
    const executor = new LocalEstimateExecutor(methods, async () => {
      loads++;
      if (failure === "load")
        throw new Error("synthetic EcoLogits load failure");
      const core = await import("../../../packages/ecologits-core/src/index");
      return {
        ...core,
        llmImpacts() {
          calculations++;
          throw new Error("synthetic EcoLogits arithmetic failure");
        },
      };
    });
    const db = await Ledger.open(`failed-eco-original-${crypto.randomUUID()}`);
    const scope: Scope = {
      namespace: "personal:failed-eco",
      mode: "personal",
      era: null,
    };
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
    const service = new EngineService(
      db.estimation,
      methods,
      executor,
      async () => ({ scope, token: "same-profile", current: async () => {} }),
    );
    context.after(() => {
      service.dispose();
      db.close();
    });
    const baseline = canonicalJson(BASELINE_BUNDLE);
    const configurationBefore = canonicalJson(methods.build);
    const [request, attempt] = records();
    request.model_id = attempt.model_id = "claude-opus-4-8";
    request.model_evidence = attempt.model_evidence = "response_field";
    const input = { family: "live" as const, request, attempt };
    const initial = await service.status();
    assert.equal(initial.effectiveEngine, "original");
    const failed = await executor.estimate(input, {
      methodId: methods.ecologits.method_id,
    });
    assert.equal(loads, 1, "the EcoLogits failure was actually exercised");
    assert.equal(calculations, failure === "calculation" ? 1 : 0);
    assert.equal(failed.status, "unavailable");
    assert.equal(failed.metrics.energy.value, null);
    assert.ok(
      failed.reasons.includes(
        failure === "load" ? "method_update_invalid" : "source_error",
      ),
    );
    assert.equal((await service.status()).effectiveEngine, "original");
    attempt.proposed_method_id = (await service.admission()).method_id;
    const captured = await service.original(input, BASELINE_METHOD_HASH);
    assert.equal(captured.reason, null);
    assert.equal(captured.result?.status, "estimated");
    assert.equal(captured.result?.requested_method.engine_id, "original");
    assert.equal(
      canonicalJson(captured.result?.raw?.result),
      canonicalJson(estimateAttempt(attempt)),
    );
    await db.capture(scope, [request, attempt], [captured.result!]);
    const originals = canonicalJson(await db.all("estimation_originals"));
    const observations = canonicalJson(await db.all("measurements"));
    await service.select({
      preference: "original",
      expectedRevision: initial.selectionRevision,
    });
    await service.maintainLocal();
    const view = await service.view(scope);
    assert.equal(view.pending, false);
    assert.equal(view.view, "recalculated");
    assert.equal(view.method?.method_hash, BASELINE_METHOD_HASH);
    const result = await view.estimate(input);
    assert.equal(result?.status, "estimated");
    assert.equal(result?.effective_method.engine_id, "original");
    assert.deepEqual(result?.metrics, captured.result?.metrics);
    assert.equal(result?.original_method_hash, BASELINE_METHOD_HASH);
    const summary = await scanSummary(
      db,
      scope.namespace,
      { calculationView: view.view },
      undefined,
      false,
      undefined,
      (currentAttempt, _original, parent) =>
        view.estimate({
          family: "live",
          request: parent!,
          attempt: currentAttempt,
        }),
    );
    assert.equal(summary.metrics.energy.known, 1);
    assert.ok(summary.estimate && "requested_method" in summary.estimate);
    assert.equal(
      summary.estimate.requested_method.method_hash,
      BASELINE_METHOD_HASH,
    );
    assert.equal(
      loads,
      1,
      "Original never retries the failing EcoLogits dependency",
    );
    assert.equal(calculations, failure === "calculation" ? 1 : 0);
    assert.equal(canonicalJson(BASELINE_BUNDLE), baseline);
    assert.equal(canonicalJson(methods.build), configurationBefore);
    assert.equal(
      canonicalJson(await db.all("estimation_originals")),
      originals,
    );
    assert.equal(canonicalJson(await db.all("measurements")), observations);
  });
