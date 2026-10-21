import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalJson,
  EstimationEnvelopeSchema,
  type EstimationEnvelope,
} from "@footprint/contracts";
import { scanSummary } from "../lib/summary-scan";
import {
  boundaryFixture,
  deferred,
  fakeRemote,
  fakeResponse,
  local,
  methods,
  seed,
  selectEco,
  sourceGuard,
} from "./remote-executor-fixture";

// The current application grants local execution only. These tests do not model
// authenticated remote success or invent a production capability/permission gate.
for (const backend of ["indexeddb", "memory"] as const) {
  for (const mode of ["personal", "disconnected", "company"] as const) {
    test(`${backend}: RE02 ${mode} composition without remote authorization stays local`, async (t) => {
      const fixture = await boundaryFixture(t, backend, mode);
      const runtime = fixture.runtime();
      const saved = await seed(fixture);
      await selectEco(fixture);
      assert.equal(runtime.engines.executor.executionOrigin, "local");
      await runtime.engines.maintainLocal();
      const state = await fixture.repository.estimation.state(
        fixture.state.scope,
      );
      assert.equal(state.selected?.status, "complete");
      const selected = await fixture.repository.estimation.viewPage({
        scope: fixture.state.scope,
        view: "selected",
      });
      assert.equal(selected.rows.length, 1);
      assert.equal(selected.rows[0].result?.execution_origin, "local");
      assert.equal(fixture.networkCalls, 0);
      assert.equal(
        canonicalJson(selected.rows[0].original),
        canonicalJson(saved.original),
      );
    });
  }

  test(`${backend}: RE02 an injected organization executor cannot consume local recalculation grants`, async (t) => {
    const fixture = await boundaryFixture(t, backend);
    const saved = await seed(fixture);
    await selectEco(fixture);
    let remoteCalls = 0;
    const executor = fakeRemote(async (request) => {
      remoteCalls++;
      return fakeResponse(request);
    });
    const runtime = fixture.runtime(executor);
    await runtime.engines.maintainLocal();
    assert.equal(remoteCalls, 0);
    assert.equal(fixture.networkCalls, 0);
    const state = await fixture.repository.estimation.state(
      fixture.state.scope,
    );
    assert.equal(state.active, null);
    assert.equal(state.selected, null);
    assert.equal(state.pending, 1);
    const original = await fixture.repository.estimation.viewPage({
      scope: fixture.state.scope,
      view: "original",
    });
    assert.equal(
      canonicalJson(original.rows[0].result),
      canonicalJson(saved.original),
    );
  });

  test(`${backend}: RE02 a locally labeled executor cannot publish an organization-origin reply`, async (t) => {
    const fixture = await boundaryFixture(t, backend);
    await seed(fixture);
    await selectEco(fixture);
    let remoteCalls = 0;
    const remote = fakeRemote(async (request) => {
      remoteCalls++;
      return fakeResponse(request);
    });
    const runtime = fixture.runtime({
      executionOrigin: "local",
      estimate: (input, options) => remote.estimate(input, options),
    });
    await runtime.engines.maintainLocal();
    assert.equal(remoteCalls, 1);
    const state = await fixture.repository.estimation.state(
      fixture.state.scope,
    );
    assert.equal(state.selected, null);
    assert.equal(state.active?.processed, 0);
    assert.equal(
      (await runtime.engines.view(fixture.state.scope)).view,
      "original",
    );
    assert.equal(fixture.networkCalls, 0);
  });

  for (const order of [
    "local-first",
    "organization-first",
    "concurrent",
  ] as const) {
    test(`${backend}: RE08 ${order} exact alternatives retain one stored local contribution`, async (t) => {
      const fixture = await boundaryFixture(t, backend);
      const { input, original } = await seed(fixture);
      await selectEco(fixture);
      const scope = fixture.state.scope;
      const repository = fixture.repository.estimation;
      const job = await repository.start({
        scope,
        target: methods.ecologits,
        fallbackMethod: methods.original,
        selectionRevision: 1,
      });
      const page = await repository.page(job.id);
      assert.equal(page.inputs.length, 1);
      const item = page.inputs[0];
      const options = {
        methodId: methods.ecologits.method_id,
        view: "recalculated" as const,
        originalMethodHash: original.requested_method.method_hash,
      };
      const localResult = await local.estimate(input, options);
      let remoteCalls = 0;
      const remote = fakeRemote(async (request) => {
        remoteCalls++;
        return fakeResponse(request);
      });
      const organizationResult = await remote.estimate(input, options);
      assert.equal(remoteCalls, 1);
      assert.equal(organizationResult.execution_origin, "organization");
      assert.deepEqual(
        { ...organizationResult, execution_origin: "local" },
        localResult,
      );
      const commit = (result: EstimationEnvelope) =>
        repository.commitResult({
          jobId: job.id,
          inputKey: item.key,
          sequence: item.sequence,
          result,
        });
      const rejectedRemote = () =>
        assert.rejects(commit(organizationResult), /method_update_invalid/);
      if (order === "organization-first") {
        await rejectedRemote();
        assert.equal(await commit(localResult), "applied");
      } else if (order === "local-first") {
        assert.equal(await commit(localResult), "applied");
        await rejectedRemote();
      } else {
        const [accepted] = await Promise.all([
          commit(localResult),
          rejectedRemote(),
        ]);
        assert.equal(accepted, "applied");
      }
      assert.equal(await commit(localResult), "duplicate");
      assert.equal((await repository.promote(job.id)).processed, 1);

      await fixture.reopen();
      const durable = await fixture.repository.estimation.viewPage({
        scope,
        view: "selected",
      });
      assert.equal(durable.rows.filter((row) => row.contributes).length, 1);
      assert.equal(
        canonicalJson(durable.rows[0].result),
        canonicalJson(localResult),
      );
      assert.equal(
        canonicalJson(durable.rows[0].original),
        canonicalJson(original),
      );
      const view = await fixture.runtime().engines.view(scope);
      assert.equal(view.view, "recalculated");
      const summary = await scanSummary(
        fixture.repository,
        scope.namespace,
        { calculationView: view.view },
        undefined,
        false,
        undefined,
        (attempt, _original, request) =>
          view.estimate({ family: "live", request, attempt }),
      );
      assert.equal(summary.requests, 1);
      assert.equal(summary.attempts, 1);
      assert.equal(summary.metrics.energy.known, 1);
      assert.equal(
        EstimationEnvelopeSchema.parse(summary.estimate).execution_origin,
        "local",
      );
      assert.equal(fixture.networkCalls, 0);
    });
  }

  for (const change of ["selection", "revision", "scope", "erasure"] as const) {
    test(`${backend}: RE09 late ${change} alternatives cannot commit or publish`, async (t) => {
      const fixture = await boundaryFixture(t, backend);
      const { pair, input, original } = await seed(fixture);
      await selectEco(fixture);
      const scope = fixture.state.scope;
      const repository = fixture.repository.estimation;
      const job = await repository.start({
        scope,
        target: methods.ecologits,
        fallbackMethod: methods.original,
        selectionRevision: 1,
      });
      const item = (await repository.page(job.id)).inputs[0];
      const view = await fixture.runtime().engines.view(scope);
      const version = await fixture.repository.summaryVersion(scope.namespace);
      const source = sourceGuard(original);
      const initialPublication = await fixture.repository.publicationSnapshot(
        scope.namespace,
        source,
        undefined,
        undefined,
        view.guard,
      );
      assert.equal(initialPublication.sourceCurrent, true);
      assert.equal(initialPublication.calculationCurrent, true);
      const entered = deferred<void>();
      const release = deferred<void>();
      const options = {
        methodId: methods.ecologits.method_id,
        view: "recalculated" as const,
        originalMethodHash: original.requested_method.method_hash,
      };
      const localResult = await local.estimate(input, options);
      let calls = 0;
      // Keep the helper guard true so actual storage/publication checks decide
      // whether the otherwise valid late response may affect application state.
      const remote = fakeRemote(async (request) => {
        calls++;
        entered.resolve();
        await release.promise;
        return fakeResponse(request);
      });
      const pending = remote.estimate(input, options);
      t.after(async () => {
        release.resolve();
        await pending.catch(() => {});
      });
      await Promise.race([
        entered.promise,
        pending.then(() =>
          assert.fail("remote fixture completed before entering transport"),
        ),
      ]);
      if (change === "selection") {
        assert.equal(
          await repository.compareAndSetPreference(1, {
            schema_version: "1.0.0",
            preference: "original",
            selection_revision: 2,
            updated_at: "2026-09-15T12:01:00.000Z",
          }),
          true,
        );
      } else if (change === "revision") {
        await fixture.repository.commitCapture({
          scope,
          observations: [
            { ...pair[0], revision: 2 },
            { ...pair[1], revision: 2 },
          ],
        });
      } else if (change === "scope") {
        await fixture.disconnect();
      } else {
        await fixture.repository.eraseFamily(
          scope.namespace,
          pair[0].request_id,
        );
      }
      release.resolve();
      const organizationResult = await pending;
      assert.equal(calls, 1);
      for (const result of [organizationResult, localResult]) {
        const commit = repository.commitResult({
          jobId: job.id,
          inputKey: item.key,
          sequence: item.sequence,
          result,
        });
        if (
          change === "revision" &&
          result.execution_origin === "organization"
        ) {
          // A live job rejects its foreign origin before checking source revision.
          await assert.rejects(commit, /method_update_invalid/);
        } else {
          assert.equal(await commit, "stale");
        }
      }
      await assert.rejects(
        view.current(),
        /policy_unavailable|selection_conflict|aggregate_inconsistent/,
      );
      const publication = await fixture.repository.publicationSnapshot(
        scope.namespace,
        source,
        undefined,
        undefined,
        view.guard,
      );
      assert.equal(publication.calculationCurrent, false);
      if (change === "revision" || change === "erasure") {
        assert.equal(publication.sourceCurrent, false);
      }
      const cacheId = `late-remote:${scope.namespace}`;
      await assert.rejects(
        fixture.repository.cacheSummary(
          scope.namespace,
          cacheId,
          organizationResult,
          version.version,
          view.guard,
        ),
        /aggregate_inconsistent/,
      );
      assert.equal(await fixture.repository.readSummary(cacheId), undefined);
      await fixture.reopen();
      const durable = await fixture.repository.estimation.state(scope);
      assert.equal(durable.selected, null);
      assert.equal(await fixture.repository.readSummary(cacheId), undefined);
      assert.equal(fixture.networkCalls, 0);
    });
  }
}
