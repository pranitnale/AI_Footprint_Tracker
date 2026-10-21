import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import {
  emptyGeneration,
  historyResponseParts,
  canonicalJson,
  payloadHash,
  HistoryMessageSchema,
  HistoryPageSchema,
  UNAVAILABLE_ADMISSION_METHOD_ID,
  historyNumericPayloadHash,
  type HistoryMessage,
} from "@footprint/contracts";
import type {
  ApplicationRepository,
  TrackingCheckpoint,
} from "../src/repository-contracts";
import type { Scope } from "../src/ledger-support";
import { historyAuthority } from "../src/ledger-support";
import { MODEL_LABEL_LIMIT } from "../src/session-contracts";
import { records, withOutputTotal } from "./factory";
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
const personal: Scope = {
  namespace: "personal:repository-contract",
  mode: "personal",
  era: null,
};
const company: Scope = {
  namespace: "company:repository-contract",
  mode: "company",
  era: "era-1",
};
export interface ContractHarness {
  repository: ApplicationRepository;
  failNextCapture(): void;
}
export type ContractFactory = (test: TestContext) => Promise<ContractHarness>;
async function initialize(repository: ApplicationRepository, scope: Scope) {
  const ownership = {
    scope,
    secret: "a".repeat(64),
    policyVersion: "1.0.0",
    start: 0,
    end: null,
  };
  await repository.applySessionChanges({
    settings: { paused: false, budget: null, timezone: "UTC" },
    personal: { namespace: personal.namespace, secret: "a".repeat(64) },
    installation: { routingSecret: "b".repeat(64) },
    ownershipHistory: { eras: [ownership] },
    ...(scope.mode === "company"
      ? {
          credentials: {
            origin: "https://company.example",
            namespace: scope.namespace,
            device_id: "test-device",
            company_id: "test-company",
            user_id: "test-user",
            access_token: "test-access",
            refresh_token: "test-refresh",
            access_expires_at: "2030-01-01T00:00:00.000Z",
            refresh_expires_at: "2030-01-01T00:00:00.000Z",
            installation_reconnect_secret: "test-reconnect",
            deletion_receipt_credential: "test-receipt",
            key_version: "1" as const,
            user_hmac_key: "b".repeat(64),
            policy: {
              policy_version: "1.0.0",
              disclosure_version: "1.0.0",
              pause_mode: "user_controlled" as const,
              usage_retention_months: null,
              timezone: "UTC",
              ip_retention_days: 0,
              deletion_epoch: 0,
            },
            enrollment_era: {
              id: scope.era!,
              start: "2026-01-01T00:00:00.000Z",
              end: null,
            },
            deletion_public_key: "test-key",
            enrollment_state: "active" as const,
          },
        }
      : {}),
  });
}
async function capture(
  repository: ApplicationRepository,
  scope: Scope,
  pair = records(),
) {
  const original = await executor.estimate({
    family: "live",
    request: pair[0],
    attempt: pair[1],
  });
  const checkpoint: TrackingCheckpoint = {
    key: payloadHash(pair[0].request_id),
    namespace: scope.namespace,
    scope,
    request: pair[0],
    attempt: pair[1],
    captureRevision: 1,
    parentKey: null,
    outputKey: null,
    branchId: "test-branch",
    imageParentKey: null,
    at: Date.parse(pair[0].dispatched_at),
  };
  const command = {
    scope,
    observations: pair,
    checkpoint,
    originals: [original],
    currentEstimate: { attemptId: pair[1].attempt_id, estimate: original },
  };
  await repository.commitCapture(command);
  return { pair, original, checkpoint, command };
}
export function repositoryContract(label: string, create: ContractFactory) {
  test(`${label}: uniform original proof remains conservative across admission, revisions, erasure and retained eras`, async (t) => {
    const { repository: r } = await create(t);
    await initialize(r, company);
    let state = await r.estimation.state(company);
    assert.equal(state.inputCount, 0);
    assert.equal(state.uniformOriginalMethodHash, null);
    const first = await capture(r, company);
    state = await r.estimation.state(company);
    assert.equal(state.inputCount, 1);
    assert.equal(state.uniformOriginalMethodHash, methods.original.method_hash);
    const unknown = records();
    await r.commitCapture({ scope: company, observations: unknown });
    state = await r.estimation.state(company);
    assert.equal(state.inputCount, 2);
    assert.equal(state.uniformOriginalMethodHash, null);
    const before = await r.estimation.localSelectionState(company);
    await r.capture(
      company,
      [],
      [
        await executor.estimate({
          family: "live",
          request: unknown[0],
          attempt: unknown[1],
        }),
      ],
    );
    assert.equal(
      (await r.estimation.state(company)).uniformOriginalMethodHash,
      methods.original.method_hash,
    );
    assert.equal(
      await r.estimation.localSelectionCurrent(company, before.token),
      false,
    );
    await r.commitCapture({
      scope: company,
      observations: [{ ...first.pair[1], revision: 2 }],
    });
    assert.equal(
      (await r.estimation.state(company)).uniformOriginalMethodHash,
      methods.original.method_hash,
    );
    const eco = records();
    eco[1].proposed_method_id = methods.ecologits.method_id;
    await r.capture(company, eco, [
      await executor.estimate(
        { family: "live", request: eco[0], attempt: eco[1] },
        { methodId: methods.ecologits.method_id },
      ),
    ]);
    state = await r.estimation.state(company);
    assert.equal(state.inputCount, 3);
    assert.equal(state.uniformOriginalMethodHash, null);
    await r.eraseFamily(company.namespace, eco[0].request_id);
    assert.equal(
      (await r.estimation.state(company)).uniformOriginalMethodHash,
      methods.original.method_hash,
    );
    const next = { ...company, era: "proof-retained-era" },
      credentials = (await r.readCredentials())!,
      ownership = (await r.readOwnershipHistory())!;
    await r.applySessionChanges({
      credentials: {
        ...credentials,
        enrollment_era: { ...credentials.enrollment_era, id: next.era },
      },
      ownershipHistory: {
        eras: [
          { ...ownership.eras[0], end: 1 },
          { ...ownership.eras[0], scope: next, start: 1, end: null },
        ],
      },
    });
    const retained = await r.estimation.localSelectionState(next);
    const previous = retained.members.find(
      (member) => member.scope.era === company.era,
    )!;
    assert.equal(previous.inputCount, 2);
    assert.equal(
      previous.uniformOriginalMethodHash,
      methods.original.method_hash,
    );
    assert.equal(
      retained.members.find((member) => member.scope.era === next.era)
        ?.inputCount,
      0,
    );
    await r.eraseFamily(company.namespace, first.pair[0].request_id);
    await r.eraseFamily(company.namespace, unknown[0].request_id);
    assert.equal((await r.estimation.state(company)).inputCount, 0);
    await r.applySessionChanges({
      credentials: {
        ...(await r.readCredentials())!,
        enrollment_state: "revoked",
      },
    });
    assert.equal((await r.estimation.state(company)).inputCount, undefined);
  });
  test(`${label}: archived original proof follows the current alias chain after rewiring`, async (t) => {
    const { repository: r } = await create(t);
    await initialize(r, company);
    const a = records(),
      b = records(),
      c = records();
    await r.capture(company, [...a, b[0], c[0]]);
    await r.reconcile(
      company.namespace,
      b[0],
      payloadHash(b[0]),
      a[0].request_id,
      1,
    );
    const input = await r.estimation.liveInput(company, a[1].attempt_id);
    assert.ok(input);
    const original = await executor.estimate({
      family: "live",
      request: input.request,
      attempt: input.attempt,
      history: input.family === "live" ? input.history : undefined,
      canonicalRequestBinding: input.source.canonical_request_binding,
    });
    await r.capture(company, [], [original]);
    const selector = {
      attemptId: a[1].attempt_id,
      attemptRevision: 1,
      attemptHash: payloadHash(a[1]),
    };
    assert.deepEqual(
      (await r.estimation.originalForLive(company, selector))?.result,
      original,
    );
    const updatedB = { ...b[0], revision: 2 };
    await r.capture(company, [updatedB]);
    assert.equal(
      (await r.estimation.originalForLive(company, selector))?.request.revision,
      1,
    );
    await r.reconcile(
      company.namespace,
      c[0],
      payloadHash(c[0]),
      b[0].request_id,
      2,
    );
    assert.equal(
      (await r.estimation.liveInput(company, a[1].attempt_id))?.request
        .request_id,
      c[0].request_id,
    );
    assert.deepEqual(
      (await r.estimation.originalForLive(company, selector))?.result,
      original,
    );
    await r.reconcile(
      company.namespace,
      c[0],
      payloadHash(c[0]),
      a[0].request_id,
      1,
    );
    assert.equal(
      (await r.estimation.liveInput(company, a[1].attempt_id))?.request
        .request_id,
      c[0].request_id,
    );
    assert.equal(await r.estimation.originalForLive(company, selector), null);
  });
  for (const scope of [personal, company])
    test(`${label}: selected monthly claims are atomic and stale guards never consume ${scope.mode} month`, async (t) => {
      const { repository: r } = await create(t);
      await initialize(r, scope);
      const saved = await capture(r, scope);
      const make = async (month = "2026-10", timezone = "UTC") => ({
        scope,
        month,
        timezone,
        selection: {
          authorityScope: scope,
          localSelectionToken: (await r.estimation.localSelectionState(scope))
            .token,
        },
        company:
          scope.mode === "company"
            ? { deviceId: "test-device", deletionEpoch: 0 }
            : null,
      });
      const initial = await make();
      if (scope.mode === "company")
        await r.applySessionChanges({
          credentials: {
            ...(await r.readCredentials())!,
            policy: {
              ...(await r.readCredentials())!.policy,
              timezone: "Europe/Berlin",
            },
          },
        });
      else
        await r.applySessionChanges({
          settings: { ...(await r.readSettings())!, timezone: "Europe/Berlin" },
        });
      assert.equal(await r.claimMonthlyView(initial), "stale");
      assert.equal(await r.readMonthlyClaim(scope.namespace), undefined);
      const correct = await make("2026-10", "Europe/Berlin");
      assert.equal(
        await r.claimMonthlyView({
          ...correct,
          company:
            scope.mode === "company"
              ? { deviceId: "wrong", deletionEpoch: 0 }
              : { deviceId: "test-device", deletionEpoch: 0 },
        }),
        "stale",
      );
      const results = await Promise.all([
        r.claimMonthlyView(correct),
        r.claimMonthlyView(correct),
      ]);
      assert.deepEqual(results.sort(), ["already_claimed", "claimed"]);
      assert.equal(
        (await r.readMonthlyClaim(scope.namespace))?.month,
        "2026-10",
      );
      const next = await make("2026-11", "Europe/Berlin"),
        version = await r.summaryVersion(scope.namespace);
      await r.estimation.start({
        scope,
        target: methods.ecologits,
        selectionRevision: 1,
      });
      assert.equal(
        (await r.summaryVersion(scope.namespace)).version,
        version.version,
      );
      assert.equal(await r.claimMonthlyView(next), "stale");
      assert.equal(
        (await r.readMonthlyClaim(scope.namespace))?.month,
        "2026-10",
      );
      const beforeErase = await make("2026-11", "Europe/Berlin");
      await r.eraseFamily(scope.namespace, saved.pair[0].request_id);
      assert.equal(await r.claimMonthlyView(beforeErase), "stale");
      assert.equal(
        (await r.readMonthlyClaim(scope.namespace))?.month,
        "2026-10",
      );
    });
  test(`${label}: a null current placeholder does not erase never-admitted lineage`, async (t) => {
    const { repository: r } = await create(t);
    await initialize(r, personal);
    const pair = records();
    pair[1].proposed_method_id = UNAVAILABLE_ADMISSION_METHOD_ID;
    await r.commitCapture({
      scope: personal,
      observations: pair,
      currentEstimate: { attemptId: pair[1].attempt_id, estimate: null },
    });
    const input = await r.estimation.liveInput(personal, pair[1].attempt_id);
    assert.equal(input?.originalMethodState, "not_admitted");
    const job = await r.estimation.start({
      scope: personal,
      target: methods.ecologits,
      selectionRevision: 1,
    });
    const result = await executor.estimate(
      { family: "live", request: pair[0], attempt: pair[1] },
      {
        view: "recalculated",
        methodId: methods.ecologits.method_id,
        originalMethodMissing: true,
      },
    );
    assert.equal(
      await r.estimation.commitResult({
        jobId: job.id,
        inputKey: input!.key,
        sequence: input!.sequence,
        result,
      }),
      "applied",
    );
    await r.estimation.promote(job.id);
    assert.equal(
      (await r.estimation.viewPage({ scope: personal, view: "selected" }))
        .rows[0].result?.original_method_hash,
      null,
    );
  });
  test(`${label}: namespace erasure removes scoped session and monthly state but retains unrelated Personal`, async (t) => {
    const { repository: r } = await create(t);
    await initialize(r, personal);
    const local = await capture(r, personal);
    const savedPersonal = await r.readPersonal();
    await initialize(r, company);
    await capture(r, company);
    assert.equal(
      await r.claimMonthly(company.namespace, "2026-10", "test-device", 0),
      true,
    );
    assert.equal(
      (await r.readMonthlyClaim(company.namespace))?.month,
      "2026-10",
    );
    await r.eraseNamespace(company.namespace);
    assert.equal(await r.readCredentials(), undefined);
    assert.equal(await r.readMonthlyClaim(company.namespace), undefined);
    assert.equal(await r.pendingCount(company.namespace), 0);
    assert.equal(await r.pendingErasure(company.namespace), false);
    assert.equal(
      (await r.publicationSnapshot(company.namespace)).erasing,
      true,
    );
    assert.deepEqual(await r.readPersonal(), savedPersonal);
    assert.ok(
      await r.getRecord(
        personal.namespace,
        "attempt",
        local.pair[1].attempt_id,
      ),
    );
  });
  test(`${label}: only a flagged organization namespace marker is released, and range markers stay`, async (t) => {
    const { repository: r } = await create(t);
    await initialize(r, company);
    const before = await capture(r, company);
    await r.applyRange(company, null, "2026-01-01T00:00:00.000Z", 1);
    await r.eraseNamespace(company.namespace);
    await initialize(r, personal);
    await r.eraseNamespace(personal.namespace);
    await initialize(r, company);
    // Unflagged, the marker stays and keeps refusing records.
    assert.equal(await r.releaseFlaggedMarker(company.namespace), false);
    await assert.rejects(capture(r, company), /record_erased/);
    // Only organization namespaces are flagged, never the erased personal one.
    assert.deepEqual(await r.flagOrganizationMarkers(), [company.namespace]);
    // A fresh erasure of the namespace drops the flag.
    await r.eraseNamespace(company.namespace);
    assert.equal(await r.releaseFlaggedMarker(company.namespace), false);
    assert.equal(await r.releaseFlaggedMarker(personal.namespace), false);
    assert.deepEqual(await r.flagOrganizationMarkers(), [company.namespace]);
    assert.equal(await r.releaseFlaggedMarker(company.namespace), true);
    assert.equal(await r.releaseFlaggedMarker(company.namespace), false);
    assert.equal(
      (await r.publicationSnapshot(company.namespace)).erasing,
      false,
    );
    await initialize(r, company);
    // Releasing restores nothing; new records are accepted again.
    const after = records();
    after[0].dispatched_at = "2026-06-01T00:00:00.000Z";
    after[1].started_at = "2026-06-01T00:00:00.000Z";
    await capture(r, company, after);
    assert.ok(
      await r.getRecord(company.namespace, "request", after[0].request_id),
    );
    assert.equal(
      await r.getRecord(company.namespace, "request", before.pair[0].request_id),
      undefined,
    );
    // The erased range still refuses a record dated inside it.
    const old = records();
    old[0].dispatched_at = "2025-06-01T00:00:00.000Z";
    old[1].started_at = "2025-06-01T00:00:00.000Z";
    await assert.rejects(capture(r, company, old), /record_erased/);
  });
  test(`${label}: unknown model labels stay bounded, scoped and erased with their namespace`, async (t) => {
    const { repository: r } = await create(t);
    await r.recordModelLabel(company.namespace, "chatgpt", "gpt-7-preview");
    await r.recordModelLabel(company.namespace, "chatgpt", "gpt-7-preview");
    await r.recordModelLabel(personal.namespace, "gemini", "4.0 Flash (New)");
    const [first] = await r.listModelLabels(company.namespace);
    assert.equal(first?.label, "gpt-7-preview");
    assert.equal(first?.site, "chatgpt");
    assert.equal(first?.count, 2);
    assert.ok(!Object.hasOwn(first!, "key"));
    for (const [site, value] of [
      ["chatgpt", "label\nwith a line break"],
      ["chatgpt", "a".repeat(81)],
      ["chatgpt", ""],
      ["unknown-site", "gpt-7-preview"],
    ] as const)
      await assert.rejects(
        r.recordModelLabel(company.namespace, site as "chatgpt", value),
      );
    // The bound keeps the most recently seen labels.
    for (let index = 0; index < MODEL_LABEL_LIMIT + 3; index++)
      await r.recordModelLabel(company.namespace, "perplexity", `id_${index}`);
    const kept = await r.listModelLabels(company.namespace);
    assert.equal(kept.length, MODEL_LABEL_LIMIT);
    assert.ok(kept.some((row) => row.label === `id_${MODEL_LABEL_LIMIT + 2}`));
    assert.ok(!kept.some((row) => row.label === "gpt-7-preview"));
    await r.eraseNamespace(company.namespace);
    assert.deepEqual(await r.listModelLabels(company.namespace), []);
    assert.equal((await r.listModelLabels(personal.namespace)).length, 1);
  });
  test(`${label}: capture metadata cannot escape its staged source or mutate after dispatch`, async (t) => {
    const { repository: r } = await create(t);
    await initialize(r, company);
    const saved = await capture(r, company);
    const unrelated = records(),
      staged = records();
    const checkpoint = {
      ...saved.checkpoint,
      key: payloadHash(unrelated[0].request_id),
      request: unrelated[0],
      attempt: unrelated[1],
    };
    await assert.rejects(
      r.commitCapture({ scope: company, observations: staged, checkpoint }),
      /stale_estimation_result/,
    );
    assert.equal(
      await r.getRecord(company.namespace, "request", staged[0].request_id),
      undefined,
    );
    assert.equal(await r.checkpoint(checkpoint.key), undefined);
    const original = await executor.estimate({
      family: "live",
      request: unrelated[0],
      attempt: unrelated[1],
    });
    await assert.rejects(
      r.commitCapture({
        scope: company,
        observations: unrelated,
        originals: [original],
        currentEstimate: {
          attemptId: saved.pair[1].attempt_id,
          estimate: original,
        },
      }),
      /stale_estimation_result/,
    );
    assert.equal(
      await r.getRecord(company.namespace, "request", unrelated[0].request_id),
      undefined,
    );
    const owner = { ...company },
      command = {
        scope: owner,
        observations: unrelated,
        checkpoint: { ...checkpoint, scope: owner },
        originals: [original],
        currentEstimate: {
          attemptId: unrelated[1].attempt_id,
          estimate: original,
        },
      };
    const write = r.commitCapture(command);
    owner.namespace = "company:mutated-command";
    await write;
    assert.ok(
      await r.getRecord(company.namespace, "attempt", unrelated[1].attempt_id),
    );
    assert.equal(
      await r.getRecord(owner.namespace, "attempt", unrelated[1].attempt_id),
      undefined,
    );
    const publication = await r.publicationSnapshot(company.namespace);
    assert.equal(Object.hasOwn(publication.credentials ?? {}, "key"), false);
    assert.equal(Object.hasOwn(publication.personal ?? {}, "key"), false);
    await r.eraseFamily(company.namespace, saved.pair[0].request_id, false);
    await assert.rejects(r.commitCapture(saved.command), /record_erased/);
  });
  test(`${label}: historical reimport and selected calculation preserve one source across granted eras`, async (t) => {
    const { repository: r } = await create(t);
    await initialize(r, company);
    const pair = records();
    pair[1].provider_attempt_key = "e".repeat(64);
    const saved = await capture(r, company, pair);
    const message = HistoryMessageSchema.parse({
      schema_version: "3.0.0",
      kind: "history_message",
      timing: null,
      message_key: "b".repeat(64),
      role: "response",
      conversation_key: pair[0].conversation_key,
      key_version: "1",
      site: pair[0].site,
      parent_key: null,
      prompt_key: null,
      provider_request_key: null,
      provider_attempt_key: pair[1].provider_attempt_key,
      occurred_at: pair[0].dispatched_at,
      date_basis: "message_created",
      observed_at: new Date().toISOString(),
      model_id: null,
      proposed_method_id: methods.original.method_id,
      company_dedup_key: null,
      proposed_method_hash: methods.original.method_hash,
      tokens: pair[1].tokens.answer_output,
      inline_file_text: null,
      parts: historyResponseParts(pair[1].tokens.answer_output),
      generation: emptyGeneration(),
      text_complete: true,
      coverage_reasons: ["history_only"],
    });
    const envelope = await executor.estimate({
      family: "history",
      record: message,
    });
    const importPage = async (scope: Scope) => {
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
      const publication = await r.publicationSnapshot(scope.namespace);
      await r.commitHistory(
        scope,
        page,
        {
          authority: historyAuthority(publication),
          erasureVersion: publication.erasureVersion,
          estimates: { [message.message_key]: estimateHistoricalText(message) },
          envelopes: { [message.message_key]: envelope },
        },
        () => true,
      );
    };
    await importPage(company);
    const first = await r.findHistoryMessage(company, message.message_key);
    const next = { ...company, era: "era-2" };
    const credentials = (await r.readCredentials())!;
    const ownership = (await r.readOwnershipHistory())!;
    await r.applySessionChanges(
      {
        credentials: {
          ...credentials,
          device_id: "new-device",
          enrollment_era: { ...credentials.enrollment_era, id: next.era },
        },
        ownershipHistory: {
          eras: [
            { ...ownership.eras[0], end: 1 },
            { ...ownership.eras[0], scope: next, start: 1, end: null },
          ],
        },
      },
      {
        deviceId: credentials.device_id,
        refreshToken: credentials.refresh_token,
      },
    );
    await importPage(next);
    const imported = await r.findHistoryMessage(next, message.message_key);
    assert.equal(imported?.era, company.era);
    assert.deepEqual(imported?.original, first?.original);
    assert.equal((await r.historyPage(next, undefined)).length, 1);
    const state = await r.estimation.localSelectionState(next);
    assert.equal(
      state.members.reduce((n, member) => n + member.inputCount, 0),
      2,
    );
    for (const member of state.members) {
      const job = await r.estimation.start({
        scope: member.scope,
        target: methods.ecologits,
        selectionRevision: 1,
      });
      for (let pageNumber = 0; pageNumber < 5; pageNumber++) {
        const page = await r.estimation.page(job.id, 1);
        for (const input of page.inputs) {
          const result = await executor.estimate(
            input.family === "live"
              ? {
                  family: "live",
                  request: input.request,
                  attempt: input.attempt,
                  history: input.family === "live" ? input.history : undefined,
                }
              : { family: "history", record: input.history },
            {
              view: "recalculated",
              methodId: methods.ecologits.method_id,
              originalMethodHash: input.originalMethodHash!,
            },
          );
          assert.equal(
            await r.estimation.commitResult({
              jobId: job.id,
              inputKey: input.key,
              sequence: input.sequence,
              result,
            }),
            "applied",
          );
        }
        if ((await r.estimation.page(job.id, 1)).done) break;
      }
      await r.estimation.promote(job.id);
    }
    const views = await Promise.all(
      state.members.map((member) =>
        r.estimation.viewPage({ scope: member.scope, view: "selected" }),
      ),
    );
    assert.equal(
      views.flatMap((view) => view.rows).filter((row) => row.contributes)
        .length,
      1,
    );
    assert.deepEqual(
      (
        await r.estimation.originalForLive(next, {
          attemptId: pair[1].attempt_id,
          attemptRevision: 1,
          attemptHash: payloadHash(pair[1]),
        })
      )?.result,
      saved.original,
    );
    await r.applySessionChanges({
      credentials: {
        ...(await r.readCredentials())!,
        enrollment_state: "revoked",
      },
    });
    assert.equal((await r.historyPage(next, undefined)).length, 1);
    assert.ok(await r.findHistoryMessage(next, message.message_key));
    assert.equal(
      (await r.estimation.localSelectionState(next)).status,
      "unavailable",
    );
  });
  test(`${label}: batched history reads match single reads, and unchanged reimports keep the summary version`, async (t) => {
    const { repository: r } = await create(t);
    await initialize(r, company);
    const pair = records();
    pair[1].provider_attempt_key = "e".repeat(64);
    await capture(r, company, pair);
    const message = (key: string, attempt: string | null) =>
      HistoryMessageSchema.parse({
        schema_version: "3.0.0",
        kind: "history_message",
        timing: null,
        message_key: key,
        role: "response",
        conversation_key: pair[0].conversation_key,
        key_version: "1",
        site: pair[0].site,
        parent_key: null,
        prompt_key: null,
        provider_request_key: null,
        provider_attempt_key: attempt,
        occurred_at: pair[0].dispatched_at,
        date_basis: "message_created",
        observed_at: new Date().toISOString(),
        model_id: null,
        proposed_method_id: methods.original.method_id,
        company_dedup_key: null,
        proposed_method_hash: methods.original.method_hash,
        tokens: pair[1].tokens.answer_output,
        inline_file_text: null,
        parts: historyResponseParts(pair[1].tokens.answer_output),
        generation: emptyGeneration(),
        text_complete: true,
        coverage_reasons: ["history_only"],
      });
    const linked = message("c".repeat(64), pair[1].provider_attempt_key);
    const separate = message("d".repeat(64), null);
    const commit = async (observedAt: string, hasLater: boolean | null = null) => {
      const messages = [linked, separate];
      const envelopes = Object.fromEntries(
        await Promise.all(
          messages.map(async (m) => [
            m.message_key,
            await executor.estimate({ family: "history", record: m }),
          ]),
        ),
      );
      const page = HistoryPageSchema.parse({
        schema_version: "3.0.0",
        site: linked.site,
        conversation_key: linked.conversation_key,
        observed_at: observedAt,
        deletion_epoch: 0,
        branch_scope: "loaded_messages",
        selected_leaf_key: null,
        branch_message_keys: null,
        root_message_key: null,
        first_request_verified: false,
        has_earlier: null,
        has_later: hasLater,
        messages,
      });
      const publication = await r.publicationSnapshot(company.namespace);
      await r.commitHistory(
        company,
        page,
        {
          authority: historyAuthority(publication),
          erasureVersion: publication.erasureVersion,
          estimates: Object.fromEntries(
            messages.map((m) => [m.message_key, estimateHistoricalText(m)]),
          ),
          envelopes,
        },
        () => true,
      );
    };
    await commit(linked.observed_at);
    const missing = "f".repeat(64);
    const keys = [linked.message_key, separate.message_key, missing];
    assert.deepEqual(
      await r.findHistoryMessages(company, keys),
      await Promise.all(keys.map((key) => r.findHistoryMessage(company, key))),
    );
    assert.deepEqual(await r.findHistoryMessages(company, []), []);
    await assert.rejects(
      async () => r.findHistoryMessages(company, Array(101).fill(missing)),
      /payload_rejected/,
    );
    await assert.rejects(
      async () => r.findHistoryMessages(company, ["not-a-key"]),
      /payload_rejected/,
    );
    const flags = await r.historyRowFlags(company, [linked, separate]);
    assert.deepEqual(
      flags,
      await Promise.all(
        [linked, separate].map(async (m) => ({
          erased: await r.historyErased(company, m),
          overlap: await r.historyLiveOverlap(company, m),
        })),
      ),
    );
    assert.deepEqual(
      flags.map((flag) => flag.overlap),
      [true, false],
    );
    await assert.rejects(
      async () => r.historyRowFlags(company, Array(101).fill(separate)),
      /payload_rejected/,
    );
    const sources = [linked, separate].map((m) => ({
      family: "history" as const,
      message_key: m.message_key,
      observation_hash: payloadHash(m),
    }));
    const stored = await Promise.all(
      [linked, separate].map((m) => r.findHistoryMessage(company, m.message_key)),
    );
    const exact = stored.map((row) => ({
      family: "history" as const,
      message_key: row!.record.message_key,
      observation_hash: row!.hash,
    }));
    for (const list of [sources, exact])
      assert.deepEqual(
        await r.estimation.resultsFor(
          company,
          list,
          methods.original.method_hash,
        ),
        await Promise.all(
          list.map((source) =>
            r.estimation.resultFor(company, source, methods.original.method_hash),
          ),
        ),
      );
    assert.ok(
      (
        await r.estimation.resultsFor(
          company,
          exact,
          methods.original.method_hash,
        )
      ).every(Boolean),
    );
    const before = (await r.summaryVersion(company.namespace)).version;
    await commit(new Date(Date.now() + 1000).toISOString());
    assert.equal(
      (await r.summaryVersion(company.namespace)).version,
      before,
      "an unchanged reimport observed later does not invalidate summaries",
    );
    await commit(new Date(Date.now() + 2000).toISOString(), false);
    assert.equal(
      (await r.summaryVersion(company.namespace)).version,
      before + 1,
      "a coverage change still invalidates summaries",
    );
  });
  test(`${label}: unchanged and deferred history commits leave coverage alone, and count bases stay local`, async (t) => {
    const { repository: r } = await create(t);
    await initialize(r, company);
    const pair = records();
    await capture(r, company, pair);
    const tokens = pair[1].tokens.answer_output;
    const message = (
      key: string,
      conversation = pair[0].conversation_key,
      value = tokens.value,
    ) =>
      HistoryMessageSchema.parse({
        schema_version: "3.0.0",
        kind: "history_message",
        timing: null,
        message_key: key,
        role: "response",
        conversation_key: conversation,
        key_version: "1",
        site: pair[0].site,
        parent_key: null,
        prompt_key: null,
        provider_request_key: null,
        provider_attempt_key: null,
        occurred_at: pair[0].dispatched_at,
        date_basis: "message_created",
        observed_at: new Date().toISOString(),
        model_id: null,
        proposed_method_id: methods.original.method_id,
        company_dedup_key: null,
        proposed_method_hash: methods.original.method_hash,
        tokens: { ...tokens, value },
        inline_file_text: null,
        parts: historyResponseParts({ ...tokens, value }),
        generation: emptyGeneration(),
        text_complete: true,
        coverage_reasons: ["history_only"],
      });
    const basis = (m: HistoryMessage, units: number) => ({
      units,
      fileUnits: null,
      partUnits: {},
      partTokens: {},
      componentUnits: [],
      componentTokens: [],
      implementationId: "synthetic-counter",
      profileId: "synthetic-profile",
      assetHash: "a".repeat(64),
      tokens: m.tokens,
      inlineFileComponents: null,
    });
    const first = message("c".repeat(64));
    const second = message("d".repeat(64));
    const commit = async (
      messages: HistoryMessage[],
      options: {
        hasLater?: boolean | null;
        deferCoverage?: boolean;
        countBases?: Record<string, unknown>;
      } = {},
    ) => {
      const page = HistoryPageSchema.parse({
        schema_version: "3.0.0",
        site: messages[0]!.site,
        conversation_key: messages[0]!.conversation_key,
        observed_at: new Date().toISOString(),
        deletion_epoch: 0,
        branch_scope: "loaded_messages",
        selected_leaf_key: null,
        branch_message_keys: null,
        root_message_key: null,
        first_request_verified: false,
        has_earlier: null,
        has_later: options.hasLater ?? null,
        messages: messages.map((m) => ({
          ...m,
          observed_at: new Date().toISOString(),
        })),
      });
      const publication = await r.publicationSnapshot(company.namespace);
      await r.commitHistory(
        company,
        page,
        {
          authority: historyAuthority(publication),
          erasureVersion: publication.erasureVersion,
          estimates: Object.fromEntries(
            messages.map((m) => [m.message_key, estimateHistoricalText(m)]),
          ),
          ...(options.deferCoverage ? { deferCoverage: true } : {}),
          ...(options.countBases
            ? { countBases: options.countBases as any }
            : {}),
        },
        () => true,
      );
    };
    const version = async () =>
      (await r.summaryVersion(company.namespace)).version;
    const coverage = () =>
      r.historyCoverage(company, first.conversation_key);
    await commit([first, second], {
      countBases: { [first.message_key]: basis(first, 120) },
    });
    const saved = await r.findHistoryMessage(company, first.message_key);
    assert.deepEqual(saved?.countBasis, basis(first, 120));
    assert.equal(
      "countBasis" in (await r.findHistoryMessage(company, second.message_key))!,
      false,
    );
    const covered = await coverage();
    const queued = (await r.pendingHistory(company)).length;
    const before = await version();

    await commit([first, second], {
      countBases: {
        [first.message_key]: basis(first, 120),
        [second.message_key]: basis(second, 80),
      },
    });
    assert.equal(await version(), before, "an unchanged reimport keeps the summary version");
    assert.deepEqual(
      await coverage(),
      covered,
      "unchanged coverage keeps its row, upload flag and observed time",
    );
    assert.deepEqual(
      (await r.findHistoryMessage(company, second.message_key))?.countBasis,
      basis(second, 80),
      "a saved row without a basis gains one from an unchanged reimport",
    );
    const pending = await r.pendingHistory(company);
    assert.equal(pending.length, queued, "a basis update queues nothing for upload");
    for (const row of pending) assert.equal("countBasis" in row.record, false);
    assert.equal("countBasis" in covered!.page, false);

    await commit([first, second], { hasLater: false, deferCoverage: true });
    assert.equal(await version(), before, "a deferred batch leaves coverage alone");
    assert.deepEqual(await coverage(), covered);
    await commit([first, second], { hasLater: false });
    assert.equal(await version(), before + 1, "the final batch applies the coverage change");
    assert.equal((await coverage())!.page.has_later, false);

    const other = message("e".repeat(64), "9".repeat(64));
    await commit([other], { deferCoverage: true });
    assert.ok(
      await r.historyCoverage(company, other.conversation_key),
      "a first import writes coverage even when deferred",
    );

    const changed = message(
      first.message_key,
      first.conversation_key,
      String(Number(tokens.value) + 5),
    );
    await commit([changed], {
      countBases: { [first.message_key]: basis(changed, 130) },
    });
    // A reply that grew is the newer state of the same reply, not a conflict.
    const grown = await r.findHistoryMessage(company, first.message_key);
    assert.equal(grown?.status, "current");
    assert.equal(grown?.record.tokens.value, changed.tokens.value);
    assert.deepEqual(
      grown?.countBasis,
      basis(changed, 130),
      "an improved record takes its own basis",
    );
    const moved = HistoryMessageSchema.parse({
      ...changed,
      occurred_at: "2026-09-10T09:00:00.000Z",
    });
    await commit([moved], {
      countBases: { [first.message_key]: basis(moved, 140) },
    });
    const conflicted = await r.findHistoryMessage(company, first.message_key);
    assert.equal(conflicted?.status, "conflict");
    assert.deepEqual(
      conflicted?.countBasis,
      basis(changed, 130),
      "a conflict keeps the basis of the saved record",
    );

    await assert.rejects(
      async () =>
        commit([first], { countBases: { ["f".repeat(64)]: basis(first, 1) } }),
      /payload_rejected/,
    );
    await assert.rejects(
      async () =>
        commit([first], {
          countBases: { [first.message_key]: { ...basis(first, 1), text: "x" } },
        }),
      /payload_rejected/,
    );
  });
  test(`${label}: atomic capture rollback, replay and defensive reads`, async (t) => {
    const { repository: r, failNextCapture } = await create(t);
    await initialize(r, company);
    const pair = records();
    failNextCapture();
    await assert.rejects(capture(r, company, pair), /contract_write_failed/);
    assert.equal(
      await r.getRecord(company.namespace, "request", pair[0].request_id),
      undefined,
    );
    assert.equal(await r.pendingCount(company.namespace), 0);
    assert.equal(
      await r.checkpoint(payloadHash(pair[0].request_id)),
      undefined,
    );
    const saved = await capture(r, company, pair);
    await r.commitCapture(saved.command);
    assert.equal(await r.pendingCount(company.namespace), 2);
    const snapshot = canonicalJson(await r.checkpoint(saved.checkpoint.key));
    const mutable = await r.checkpoint(saved.checkpoint.key);
    mutable!.captureRevision = 900;
    assert.equal(
      canonicalJson(await r.checkpoint(saved.checkpoint.key)),
      snapshot,
    );
    assert.deepEqual(
      await r.currentEstimate(company.namespace, pair[1].attempt_id),
      saved.original,
    );
    const observations: unknown[] = [];
    await r.scanRequests(company.namespace, (rows) => {
      observations.push(...rows);
    });
    await r.scanAttempts(company.namespace, (rows) => {
      observations.push(...rows);
    });
    assert.equal(observations.length, 2);
    await assert.rejects(
      r.commitCapture({
        ...saved.command,
        observations: [
          {
            ...pair[1],
            tokens: withOutputTotal({
              ...pair[1].tokens,
              answer_output: { ...pair[1].tokens.answer_output, value: "999" },
            }),
          },
        ],
      }),
      /revision_conflict/,
    );
    assert.equal(await r.pendingCount(company.namespace), 2);
  });
  test(`${label}: Personal isolation, exact partial acknowledgements and downward correction`, async (t) => {
    const { repository: r } = await create(t);
    await initialize(r, personal);
    await capture(r, personal);
    assert.equal(await r.pendingCount(personal.namespace), 0);
    await initialize(r, company);
    const saved = await capture(r, company),
      queued = await r.queue(company.namespace);
    const first = queued.find((row) => row.kind === "request")!,
      second = queued.find((row) => row.kind === "attempt")!;
    await r.acknowledge(
      company.namespace,
      "test-batch",
      [
        {
          kind: first.kind,
          id: first.id,
          revision: first.revision,
          payload_hash: "f".repeat(64),
          server_record_version: first.revision,
          status: "applied",
        },
      ],
      queued,
    );
    assert.equal(await r.pendingCount(company.namespace), 2);
    await r.acknowledge(
      company.namespace,
      "test-batch",
      [
        {
          kind: first.kind,
          id: first.id,
          revision: first.revision,
          payload_hash: first.hash,
          server_record_version: first.revision,
          status: "applied",
        },
      ],
      queued,
    );
    assert.equal(
      await r.pendingRevision(company.namespace, "request", first.id, 1),
      false,
    );
    assert.equal(
      await r.pendingRevision(company.namespace, "attempt", second.id, 1),
      true,
    );
    const revised = {
      ...saved.pair[1],
      revision: 2,
      tokens: withOutputTotal({
        ...saved.pair[1].tokens,
        answer_output: { ...saved.pair[1].tokens.answer_output, value: "50" },
      }),
    };
    await r.commitCapture({ scope: company, observations: [revised] });
    assert.equal((await r.queuedRecord(second)).revision, 1);
    assert.equal(
      (await r.getRecord(company.namespace, "attempt", second.id))?.record
        .revision,
      2,
    );
    await r.acknowledge(
      company.namespace,
      "old-ack",
      [
        {
          kind: second.kind,
          id: second.id,
          revision: 1,
          payload_hash: second.hash,
          server_record_version: 1,
          status: "applied",
        },
      ],
      [second],
    );
    assert.equal(
      await r.pendingRevision(company.namespace, "attempt", second.id, 2),
      true,
    );
    const remaining = await r.pending(company.namespace);
    await r.retry(remaining, 1000);
    assert.equal((await r.pending(company.namespace))[0].attempts, 1);
  });
  test(`${label}: calculation and final cache guards survive ownership changes and erasure`, async (t) => {
    const { repository: r } = await create(t);
    await initialize(r, personal);
    const saved = await capture(r, personal);
    const vector = await r.estimation.localSelectionState(personal),
      version = await r.summaryVersion(personal.namespace),
      key = "test-summary";
    await r.cacheSummary(
      personal.namespace,
      key,
      { requests: 1 },
      version.version,
      { authorityScope: personal, localSelectionToken: vector.token },
    );
    const job = await r.estimation.start({
      scope: personal,
      target: methods.ecologits,
      selectionRevision: 1,
    });
    assert.equal(
      (
        await r.publicationSnapshot(
          personal.namespace,
          undefined,
          undefined,
          undefined,
          { authorityScope: personal, localSelectionToken: vector.token },
        )
      ).calculationCurrent,
      false,
    );
    await assert.rejects(
      r.cacheSummary(
        personal.namespace,
        key,
        { requests: 900 },
        version.version,
        { authorityScope: personal, localSelectionToken: vector.token },
      ),
      /aggregate_inconsistent/,
    );
    assert.deepEqual((await r.readSummary(key))?.summary, { requests: 1 });
    const input = (await r.estimation.page(job.id)).inputs[0];
    assert.equal(input.family, "live");
    if (input.family !== "live") throw Error("test fixture");
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
    await r.eraseFamily(personal.namespace, saved.pair[0].request_id);
    assert.equal(
      await r.estimation.commitResult({
        jobId: job.id,
        inputKey: input.key,
        sequence: input.sequence,
        result,
      }),
      "stale",
    );
    await assert.rejects(r.commitCapture(saved.command), /record_erased/);
    assert.equal(
      await r.estimation.originalForLive(personal, {
        attemptId: saved.pair[1].attempt_id,
        attemptRevision: 1,
        attemptHash: payloadHash(saved.pair[1]),
      }),
      null,
    );
    const remaining: unknown[] = [];
    await r.scanRequests(personal.namespace, (rows) => {
      remaining.push(...rows);
    });
    assert.equal(remaining.length, 0);
  });
  test(`${label}: a completed attempt is found by its provider key in its own namespace only`, async (t) => {
    const { repository: r } = await create(t);
    await initialize(r, company);
    const key = "d".repeat(64);
    assert.equal(await r.completedAttempt(company.namespace, key), false);
    const generating = records();
    generating[1].provider_attempt_key = "e".repeat(64);
    await capture(r, company, generating);
    assert.equal(await r.completedAttempt(company.namespace, "e".repeat(64)), false, "still generating");
    const done = records();
    done[1].provider_attempt_key = key;
    done[1].state = "completed";
    done[1].ended_at = "2026-09-10T10:00:05.000Z";
    await capture(r, company, done);
    assert.equal(await r.completedAttempt(company.namespace, key), true);
    assert.equal(await r.completedAttempt("personal:other", key), false);
  });
  test(`${label}: coalescing partitions two pairs in separate enrollment eras`, async (t) => {
    const { repository: r } = await create(t);
    const sources: Array<ReturnType<typeof records>> = [];
    for (const era of ["era-1", "era-2"]) {
      const owner = { ...company, era };
      await initialize(r, owner);
      const first = records();
      first[1].provider_attempt_key = "c".repeat(64);
      first[1].started_at = "2026-09-10T10:00:00.000Z";
      await capture(r, owner, first);
      sources.push(first);
      const alias = structuredClone(first);
      alias[1].attempt_id = crypto.randomUUID();
      alias[1].started_at = "2026-09-10T10:00:01.000Z";
      await capture(r, owner, alias);
      sources.push(alias);
    }
    await r.coalesceProviderIdentity(
      company.namespace,
      "attempt",
      "c".repeat(64),
    );
    for (let index = 0; index < sources.length; index++) {
      const row = await r.getRecord(
        company.namespace,
        "attempt",
        sources[index][1].attempt_id,
      );
      assert.equal(
        row?.aliasOf,
        index % 2 === 1 ? sources[index - 1][1].attempt_id : undefined,
      );
    }
  });
  test(`${label}: granting a historical era invalidates an original proof based on unlinked evidence`, async (t) => {
    const { repository: r } = await create(t);
    await initialize(r, company);
    const live = records();
    live[1].provider_attempt_key = "c".repeat(64);
    await capture(r, company, live);
    const before = await r.estimation.liveInput(company, live[1].attempt_id);
    const next = { ...company, era: "era-2" };
    await initialize(r, next);
    const message = HistoryMessageSchema.parse({
      schema_version: "3.0.0",
      kind: "history_message",
      message_key: "b".repeat(64),
      role: "response",
      conversation_key: live[0].conversation_key,
      key_version: "1",
      site: live[0].site,
      parent_key: null,
      prompt_key: null,
      provider_request_key: null,
      provider_attempt_key: live[1].provider_attempt_key,
      occurred_at: live[0].dispatched_at,
      date_basis: "message_created",
      observed_at: new Date().toISOString(),
      proposed_method_id: methods.original.method_id,
      company_dedup_key: null,
      proposed_method_hash: methods.original.method_hash,
      model_id: null,
      tokens: live[1].tokens.answer_output,
      inline_file_text: null,
      parts: historyResponseParts(live[1].tokens.answer_output),
      generation: emptyGeneration(),
      text_complete: true,
      coverage_reasons: ["history_only"],
      timing: null,
    });
    const page = HistoryPageSchema.parse({
      schema_version: "3.0.0",
      site: message.site,
      conversation_key: message.conversation_key,
      observed_at: message.observed_at,
      deletion_epoch: 0,
      messages: [message],
      branch_scope: "loaded_messages",
      selected_leaf_key: null,
      branch_message_keys: null,
      root_message_key: null,
      first_request_verified: false,
      has_earlier: null,
      has_later: null,
    });
    const publication = await r.publicationSnapshot(next.namespace);
    const healthCodes = [
      "method_unsupported",
      "estimate_unavailable",
      "method_update_invalid",
      "historical_timing_conflict",
    ] as const;
    await r.commitHistory(
      next,
      page,
      {
        authority: historyAuthority(publication),
        erasureVersion: publication.erasureVersion,
        estimates: { [message.message_key]: estimateHistoricalText(message) },
        healthCodes: [...healthCodes],
        envelopes: {
          [message.message_key]: await executor.estimate({
            family: "history",
            record: message,
          }),
        },
      },
      () => true,
    );
    assert.deepEqual(
      (await r.listHealth(next.namespace)).map((row) => row.code).sort(),
      [...healthCodes].sort(),
    );
    const ownership = (await r.readOwnershipHistory())!;
    await r.applySessionChanges({
      ownershipHistory: {
        eras: [
          { ...ownership.eras[0], scope: company, start: 0, end: 1 },
          { ...ownership.eras[0], start: 1, end: null },
        ],
      },
    });
    const linked = await r.estimation.liveInput(next, live[1].attempt_id);
    assert.equal(linked?.history?.message_key, message.message_key);
    assert.ok(linked!.sequence > before!.sequence);
    const member = (await r.estimation.localSelectionState(next)).members.find(
      (member) => member.scope.era === company.era,
    );
    assert.equal(member?.originalEvidenceCurrent, false);
  });
  test(`${label}: Cowork checkpoints change only with their replies, refuse a stale base and leave with the namespace`, async (t) => {
    const { repository: r } = await create(t);
    await initialize(r, personal);
    const pair = records();
    const conversation = "e".repeat(64);
    const reply = (key: string) =>
      HistoryMessageSchema.parse({
        schema_version: "3.0.0",
        kind: "history_message",
        timing: null,
        message_key: key,
        role: "response",
        conversation_key: conversation,
        key_version: "1",
        site: "claude",
        parent_key: null,
        prompt_key: null,
        provider_request_key: null,
        provider_attempt_key: null,
        occurred_at: pair[0].dispatched_at,
        date_basis: "message_created",
        observed_at: new Date().toISOString(),
        model_id: null,
        proposed_method_id: methods.original.method_id,
        company_dedup_key: null,
        proposed_method_hash: methods.original.method_hash,
        tokens: pair[1].tokens.answer_output,
        inline_file_text: null,
        parts: historyResponseParts(pair[1].tokens.answer_output),
        generation: emptyGeneration(),
        text_complete: true,
        coverage_reasons: ["history_only"],
      });
    const checkpoint = (sequence: number, output: number) => ({
      sequence,
      models: [
        { model: "claude-sonnet-5-5", output, reasoning: 10 },
        { model: "claude-haiku-4-5-20251001", output: 10, reasoning: null },
      ],
      apiMs: sequence * 1000,
    });
    const commit = async (
      message: HistoryMessage,
      cowork: unknown,
      authority?: string,
    ) => {
      const publication = await r.publicationSnapshot(personal.namespace);
      await r.commitHistory(
        personal,
        HistoryPageSchema.parse({
          schema_version: "3.0.0",
          site: "claude",
          conversation_key: conversation,
          observed_at: new Date().toISOString(),
          deletion_epoch: 0,
          branch_scope: "loaded_messages",
          selected_leaf_key: null,
          branch_message_keys: null,
          root_message_key: null,
          first_request_verified: false,
          has_earlier: null,
          has_later: null,
          messages: [message],
        }),
        {
          authority: authority ?? historyAuthority(publication),
          erasureVersion: publication.erasureVersion,
          estimates: {
            [message.message_key]: estimateHistoricalText(message),
          },
          cowork: cowork as any,
        },
        () => true,
      );
    };
    const first = reply("1".repeat(64)),
      second = reply("2".repeat(64));
    assert.equal(await r.coworkCheckpoint(personal, conversation), null);
    await commit(first, { base: null, next: checkpoint(5, 100) });
    assert.deepEqual(
      await r.coworkCheckpoint(personal, conversation),
      checkpoint(5, 100),
    );
    assert.equal(await r.coworkCheckpoint(personal, "f".repeat(64)), null);
    // A page calculated from an older checkpoint saves nothing at all.
    await assert.rejects(
      commit(second, { base: null, next: checkpoint(9, 140) }),
      /cowork_checkpoint_stale/,
    );
    await assert.rejects(
      commit(second, { base: 4, next: checkpoint(9, 140) }),
      /cowork_checkpoint_stale/,
    );
    assert.equal(await r.findHistoryMessage(personal, second.message_key), undefined);
    // A failed guard leaves the checkpoint where it was.
    await assert.rejects(
      commit(second, { base: 5, next: checkpoint(9, 140) }, "wrong-authority"),
      /policy_unavailable/,
    );
    assert.equal(
      (await r.coworkCheckpoint(personal, conversation))?.sequence,
      5,
    );
    for (const invalid of [
      { base: 5, next: checkpoint(5, 140) },
      { base: 5, next: { ...checkpoint(9, 140), extra: 1 } },
      { base: 5, next: { ...checkpoint(9, 140), models: [{ model: "bad label", output: 1, reasoning: null }] } },
      { base: 5, next: { ...checkpoint(9, 140), models: [{ model: "m", output: 1, reasoning: 2 }] } },
      { base: 5, next: { ...checkpoint(9, 140), sequence: -1 } },
      { base: "5", next: checkpoint(9, 140) },
      { next: checkpoint(9, 140) },
    ])
      await assert.rejects(commit(second, invalid), /payload_rejected/);
    await commit(second, { base: 5, next: checkpoint(9, 140) });
    assert.ok(await r.findHistoryMessage(personal, second.message_key));
    assert.deepEqual(
      await r.coworkCheckpoint(personal, conversation),
      checkpoint(9, 140),
    );
    await assert.rejects(
      r.coworkCheckpoint(personal, "not-a-key"),
      /payload_rejected/,
    );
    await r.eraseNamespace(personal.namespace);
    await initialize(r, personal);
    assert.equal(await r.coworkCheckpoint(personal, conversation), null);
  });
  test(`${label}: saved replies are queued again once for a new enrolment, never twice and never when erased`, async (t) => {
    const { repository: r } = await create(t);
    await initialize(r, company);
    const pair = records();
    const conversation = "c".repeat(64);
    const reply = (key: string, occurredAt = pair[0].dispatched_at) =>
      HistoryMessageSchema.parse({
        schema_version: "3.0.0",
        kind: "history_message",
        timing: null,
        message_key: key,
        role: "response",
        conversation_key: conversation,
        key_version: "1",
        site: "claude",
        parent_key: null,
        prompt_key: null,
        provider_request_key: null,
        provider_attempt_key: null,
        occurred_at: occurredAt,
        date_basis: "message_created",
        observed_at: new Date().toISOString(),
        model_id: null,
        proposed_method_id: methods.original.method_id,
        company_dedup_key: null,
        proposed_method_hash: methods.original.method_hash,
        tokens: pair[1].tokens.answer_output,
        inline_file_text: null,
        parts: historyResponseParts(pair[1].tokens.answer_output),
        generation: emptyGeneration(),
        text_complete: true,
        coverage_reasons: ["history_only"],
      });
    const kept = reply("3".repeat(64)),
      erased = reply("4".repeat(64), "2020-01-01T12:00:00.000Z");
    const guard = async (scope: Scope) => {
      const publication = await r.publicationSnapshot(scope.namespace);
      return {
        authority: historyAuthority(publication),
        erasureVersion: publication.erasureVersion,
      };
    };
    const expected = await guard(company);
    await r.commitHistory(
      company,
      HistoryPageSchema.parse({
        schema_version: "3.0.0",
        site: "claude",
        conversation_key: conversation,
        observed_at: new Date().toISOString(),
        deletion_epoch: 0,
        branch_scope: "loaded_messages",
        selected_leaf_key: null,
        branch_message_keys: null,
        root_message_key: null,
        first_request_verified: false,
        has_earlier: null,
        has_later: null,
        messages: [kept, erased],
      }),
      {
        ...expected,
        estimates: {
          [kept.message_key]: estimateHistoricalText(kept),
          [erased.message_key]: estimateHistoricalText(erased),
        },
      },
      () => true,
    );
    const keys = [kept.message_key, erased.message_key, "5".repeat(64)];
    // Rows saved in the current enrolment are queued already.
    assert.equal(
      await r.requeueHistory(company, keys, expected, () => true),
      0,
    );
    // A reconnection gives a new enrolment and a new device; the old queue is not its own.
    const next = { ...company, era: "era-2" },
      credentials = (await r.readCredentials())!,
      ownership = (await r.readOwnershipHistory())!;
    await r.applySessionChanges({
      credentials: {
        ...credentials,
        device_id: "test-device-2",
        enrollment_era: { ...credentials.enrollment_era, id: next.era },
      },
      ownershipHistory: {
        eras: [
          { ...ownership.eras[0], end: 1 },
          { ...ownership.eras[0], scope: next, start: 1, end: null },
        ],
      },
    });
    assert.deepEqual(await r.pendingHistory(next), []);
    await r.applyRange(
      next,
      "2020-01-01T00:00:00.000Z",
      "2020-01-02T00:00:00.000Z",
      1,
    );
    const after = await guard(next);
    await assert.rejects(
      r.requeueHistory(next, keys, { ...after, authority: "wrong" }, () => true),
      /policy_unavailable/,
    );
    await assert.rejects(
      r.requeueHistory(next, keys, after, () => false),
      /policy_unavailable/,
    );
    assert.equal(await r.requeueHistory(next, keys, after, () => true), 1);
    assert.deepEqual(
      (await r.pendingHistory(next)).map((row) => row.record.message_key),
      [kept.message_key],
    );
    assert.equal(
      (await r.findHistoryMessage(next, kept.message_key))?.lastImportEra,
      next.era,
    );
    // Queued once per enrolment.
    assert.equal(await r.requeueHistory(next, keys, after, () => true), 0);
    for (const invalid of [["not-a-key"], Array(101).fill("6".repeat(64))])
      await assert.rejects(
        r.requeueHistory(next, invalid, after, () => true),
        /payload_rejected/,
      );
    // Personal history has nothing to queue.
    assert.equal(
      await r.requeueHistory(personal, [kept.message_key], after, () => true),
      0,
    );
  });
  test(`${label}: W11 company keys stay beside their records, carry to later revisions and never change`, async (t) => {
    const { repository: r } = await create(t);
    await initialize(r, company);
    const pair = records();
    const keys = { request: "1".repeat(64), attempt: "2".repeat(64) };
    const checkpoint: TrackingCheckpoint = {
      key: payloadHash(pair[0].request_id),
      namespace: company.namespace,
      scope: company,
      request: pair[0],
      attempt: pair[1],
      captureRevision: 1,
      parentKey: null,
      outputKey: null,
      branchId: "test-branch",
      imageParentKey: null,
      companyKeys: keys,
      at: Date.parse(pair[0].dispatched_at),
    };
    // Malformed keys are refused before anything is written.
    for (const companyKeys of [
      { request: "X".repeat(64) },
      { attempt: "2".repeat(63) },
      { other: "1".repeat(64) },
    ])
      await assert.rejects(
        r.commitCapture({
          scope: company,
          observations: pair,
          checkpoint: { ...checkpoint, companyKeys } as TrackingCheckpoint,
        }),
        /payload_rejected/,
      );
    assert.deepEqual(await r.queue(company.namespace), []);
    await r.commitCapture({ scope: company, observations: pair, checkpoint });
    const keyed = (rows: Awaited<ReturnType<typeof r.queue>>) =>
      rows
        .map((row) => [row.kind, row.revision, row.companyKey ?? null])
        .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
    assert.deepEqual(keyed(await r.queue(company.namespace)), [
      ["attempt", 1, keys.attempt],
      ["request", 1, keys.request],
    ]);
    // The record itself never carries the key.
    for (const row of await r.queue(company.namespace))
      assert.equal((await r.queuedRecord(row)).company_dedup_key, null);
    // A later revision with another key, or with none, keeps the first key.
    const second = { ...pair[1], revision: 2 };
    await r.commitCapture({
      scope: company,
      observations: [second],
      checkpoint: {
        ...checkpoint,
        attempt: second,
        captureRevision: 2,
        companyKeys: { attempt: "3".repeat(64) },
      },
    });
    await r.commitCapture({
      scope: company,
      observations: [{ ...pair[1], revision: 3 }],
    });
    assert.deepEqual(
      keyed(await r.queue(company.namespace)).filter(
        ([kind]) => kind === "attempt",
      ),
      [
        ["attempt", 1, keys.attempt],
        ["attempt", 2, keys.attempt],
        ["attempt", 3, keys.attempt],
      ],
    );
    // A server copy reconciled in place keeps the key for later revisions.
    const canonical = { ...pair[0], revision: 2 };
    await r.reconcile(company.namespace, canonical, payloadHash(canonical));
    await r.commitCapture({
      scope: company,
      observations: [{ ...pair[0], revision: 3 }],
    });
    assert.equal(
      (await r.queue(company.namespace)).find(
        (row) => row.kind === "request" && row.revision === 3,
      )?.companyKey,
      keys.request,
    );
    // A capture without keys queues its records without any.
    const plain = await capture(r, company);
    assert.ok(
      (await r.queue(company.namespace))
        .filter((row) =>
          [plain.pair[0].request_id, plain.pair[1].attempt_id].includes(row.id),
        )
        .every((row) => row.companyKey === undefined),
    );
  });
  test(`${label}: live replies kept by content are listed for their conversation with the saved replies linked to them, and leave with the namespace`, async (t) => {
    // NotebookLM (16 Oct 2026): a saved answer keeps no id its live stream named.
    const { repository: r } = await create(t);
    await initialize(r, company);
    const [request, attempt] = records();
    const live = { ...attempt, provider_attempt_key: "4".repeat(64) };
    const checkpoint: TrackingCheckpoint = {
      key: payloadHash(request.request_id),
      namespace: company.namespace,
      scope: company,
      request,
      attempt: live,
      captureRevision: 1,
      parentKey: null,
      outputKey: null,
      branchId: "test-branch",
      imageParentKey: null,
      companyKeys: { attempt: "5".repeat(64) },
      contentKey: "6".repeat(64),
      at: Date.parse(request.dispatched_at),
    };
    for (const contentKey of ["6".repeat(63), "G".repeat(64), 7])
      await assert.rejects(
        r.commitCapture({
          scope: company,
          observations: [request, live],
          checkpoint: { ...checkpoint, contentKey } as TrackingCheckpoint,
        }),
        /payload_rejected/,
      );
    await r.commitCapture({ scope: company, observations: [request, live], checkpoint });
    // Another capture of the conversation without a content key is not listed.
    await capture(r, company);
    const reply = {
      contentKey: "6".repeat(64),
      attemptKey: "4".repeat(64),
      companyAttemptKey: "5".repeat(64),
      startedAt: live.started_at,
    };
    assert.deepEqual(await r.liveReplyContents(company, request.conversation_key), [
      { ...reply, linkedMessageKeys: [] },
    ]);
    assert.deepEqual(await r.liveReplyContents(company, "b".repeat(64)), []);
    await assert.rejects(r.liveReplyContents(company, "not-a-key"), /payload_rejected/);
    const message = HistoryMessageSchema.parse({
      schema_version: "3.0.0",
      kind: "history_message",
      timing: null,
      message_key: "7".repeat(64),
      role: "response",
      conversation_key: request.conversation_key,
      key_version: "1",
      site: "notebooklm",
      parent_key: null,
      prompt_key: null,
      provider_request_key: null,
      provider_attempt_key: live.provider_attempt_key,
      occurred_at: request.dispatched_at,
      date_basis: "message_created",
      observed_at: new Date().toISOString(),
      model_id: null,
      proposed_method_id: methods.original.method_id,
      company_dedup_key: null,
      proposed_method_hash: methods.original.method_hash,
      tokens: attempt.tokens.answer_output,
      inline_file_text: null,
      parts: historyResponseParts(attempt.tokens.answer_output),
      generation: emptyGeneration(),
      text_complete: true,
      coverage_reasons: ["history_only"],
    });
    const publication = await r.publicationSnapshot(company.namespace);
    await r.commitHistory(
      company,
      HistoryPageSchema.parse({
        schema_version: "3.0.0",
        site: "notebooklm",
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
      }),
      {
        authority: historyAuthority(publication),
        erasureVersion: publication.erasureVersion,
        estimates: { [message.message_key]: estimateHistoricalText(message) },
      },
      () => true,
    );
    assert.deepEqual(await r.liveReplyContents(company, request.conversation_key), [
      { ...reply, linkedMessageKeys: [message.message_key] },
    ]);
    await r.eraseNamespace(company.namespace);
    assert.deepEqual(await r.liveReplyContents(company, request.conversation_key), []);
  });
  test(`${label}: W11 saved messages keep their company key, and a key for an unchanged message queues it once`, async (t) => {
    const { repository: r } = await create(t);
    await initialize(r, company);
    const pair = records();
    const message = HistoryMessageSchema.parse({
      schema_version: "3.0.0",
      kind: "history_message",
      timing: null,
      message_key: "7".repeat(64),
      role: "response",
      conversation_key: "e".repeat(64),
      key_version: "1",
      site: "claude",
      parent_key: null,
      prompt_key: null,
      provider_request_key: null,
      provider_attempt_key: null,
      occurred_at: pair[0].dispatched_at,
      date_basis: "message_created",
      observed_at: new Date().toISOString(),
      model_id: null,
      proposed_method_id: methods.original.method_id,
      company_dedup_key: null,
      proposed_method_hash: methods.original.method_hash,
      tokens: pair[1].tokens.answer_output,
      inline_file_text: null,
      parts: historyResponseParts(pair[1].tokens.answer_output),
      generation: emptyGeneration(),
      text_complete: true,
      coverage_reasons: ["history_only"],
    });
    const page = HistoryPageSchema.parse({
      schema_version: "3.0.0",
      site: "claude",
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
    const commit = async (companyKeys?: Record<string, string>) => {
      const publication = await r.publicationSnapshot(company.namespace);
      await r.commitHistory(
        company,
        page,
        {
          authority: historyAuthority(publication),
          erasureVersion: publication.erasureVersion,
          estimates: { [message.message_key]: estimateHistoricalText(message) },
          ...(companyKeys ? { companyKeys } : {}),
        },
        () => true,
      );
    };
    const acknowledge = async () => {
      const pending = await r.pendingHistory(company);
      await r.acknowledgeHistory(
        company,
        pending.map((row) => ({
          message_key: row.record.message_key,
          payload_hash: row.hash,
          status: "applied" as const,
        })),
      );
      return pending;
    };
    // A key may only name a message of the page.
    await assert.rejects(commit({ ["8".repeat(64)]: "1".repeat(64) }), /payload_rejected/);
    await assert.rejects(commit({ [message.message_key]: "not-a-key" }), /payload_rejected/);
    // Saved before company keys arrived: queued and uploaded without one.
    await commit();
    assert.deepEqual(
      (await acknowledge()).map((row) => row.companyKey ?? null),
      [null],
    );
    assert.deepEqual(await r.pendingHistory(company), []);
    // Reopened unchanged once the key is known: the row keeps it and is queued once more.
    await commit({ [message.message_key]: "1".repeat(64) });
    const requeued = await acknowledge();
    assert.deepEqual(
      requeued.map((row) => [row.record.message_key, row.companyKey]),
      [[message.message_key, "1".repeat(64)]],
    );
    assert.equal(requeued[0]!.hash, historyNumericPayloadHash(message));
    assert.equal(
      (await r.findHistoryMessage(company, message.message_key))?.companyKey,
      "1".repeat(64),
    );
    // Reopened again, or with another key: nothing is queued and the key stays.
    await commit({ [message.message_key]: "1".repeat(64) });
    await commit({ [message.message_key]: "2".repeat(64) });
    assert.deepEqual(await r.pendingHistory(company), []);
    assert.equal(
      (await r.findHistoryMessage(company, message.message_key))?.companyKey,
      "1".repeat(64),
    );
  });
  test(`${label}: a reread that could not count keeps the saved counts, a matching read clears only a conflict this browser found, and a server conflict clears when the server accepts the copy`, async (t) => {
    const { repository: r } = await create(t);
    await initialize(r, company);
    const pair = records();
    const known = pair[1].tokens.answer_output;
    const failed = {
      value: null,
      evidence: "unknown" as const,
      scope: "observed_text" as const,
      completeness: "unknown" as const,
      profile_id: null,
      reason: "tokenizer_unavailable" as const,
    };
    const message = (changes: Record<string, unknown> = {}) =>
      HistoryMessageSchema.parse({
        schema_version: "3.0.0",
        kind: "history_message",
        timing: null,
        message_key: "6".repeat(64),
        role: "response",
        conversation_key: "f".repeat(64),
        key_version: "1",
        site: "notebooklm",
        parent_key: null,
        prompt_key: null,
        provider_request_key: null,
        provider_attempt_key: null,
        occurred_at: pair[0].dispatched_at,
        date_basis: "entry_created",
        observed_at: new Date().toISOString(),
        model_id: null,
        proposed_method_id: methods.original.method_id,
        company_dedup_key: null,
        proposed_method_hash: methods.original.method_hash,
        tokens: known,
        inline_file_text: null,
        parts: historyResponseParts(known),
        generation: emptyGeneration(),
        text_complete: true,
        coverage_reasons: ["history_only", "no_live_request"],
        ...changes,
      });
    const saved = message();
    const commit = async (record: HistoryMessage) => {
      const page = HistoryPageSchema.parse({
        schema_version: "3.0.0",
        site: record.site,
        conversation_key: record.conversation_key,
        observed_at: record.observed_at,
        deletion_epoch: 0,
        branch_scope: "loaded_messages",
        selected_leaf_key: null,
        branch_message_keys: null,
        root_message_key: null,
        first_request_verified: false,
        has_earlier: null,
        has_later: null,
        messages: [record],
      });
      const publication = await r.publicationSnapshot(company.namespace);
      await r.commitHistory(
        company,
        page,
        {
          authority: historyAuthority(publication),
          erasureVersion: publication.erasureVersion,
          estimates: { [record.message_key]: estimateHistoricalText(saved) },
        },
        () => true,
      );
    };
    const acknowledge = async (status: "applied" | "conflict") => {
      const pending = await r.pendingHistory(company);
      await r.acknowledgeHistory(
        company,
        pending.map((row) => ({
          message_key: row.record.message_key,
          payload_hash: row.hash,
          status,
        })),
      );
    };
    const row = () => r.findHistoryMessage(company, saved.message_key);
    const version = async () =>
      (await r.summaryVersion(company.namespace)).version;
    await commit(saved);
    await acknowledge("applied");
    const before = await version();
    // The tokenizer failed on a reread: the saved counts stay and nothing changes.
    await commit(message({ tokens: failed, parts: historyResponseParts(failed) }));
    assert.equal((await row())?.status, "current");
    assert.deepEqual((await row())?.record.tokens, known);
    assert.equal(await version(), before);
    assert.deepEqual(await r.pendingHistory(company), []);
    // A reread that really disagrees is a conflict this browser found.
    await commit(message({ occurred_at: "2026-09-10T09:00:00.000Z" }));
    assert.equal((await row())?.status, "conflict");
    assert.equal((await row())?.serverConflict, undefined);
    await acknowledge("applied");
    // A later read that matches the saved record clears it and the totals change.
    const conflicted = await version();
    await commit(saved);
    assert.equal((await row())?.status, "current");
    assert.ok((await version()) > conflicted);
    // The company server reports a conflict: a matching read never clears that one.
    await acknowledge("conflict");
    assert.equal((await row())?.status, "conflict");
    assert.equal((await row())?.serverConflict, true);
    await commit(saved);
    assert.equal((await row())?.status, "conflict");
    assert.equal((await row())?.serverConflict, true);
    // A fuller read of that reply updates the saved record but keeps the server's mark.
    const grownTokens = { ...known, value: String(Number(known.value) + 5) };
    const grown = message({
      tokens: grownTokens,
      parts: historyResponseParts(grownTokens),
    });
    await commit(grown);
    assert.equal((await row())?.status, "conflict");
    assert.equal((await row())?.serverConflict, true);
    await commit(grown);
    assert.equal((await row())?.status, "conflict");
    // The server reports a conflict while its own copy stays one, so accepting this
    // browser's copy means it counts the message again (15 October 2026).
    const reported = await version();
    await acknowledge("applied");
    assert.equal((await row())?.status, "current");
    assert.equal((await row())?.serverConflict, undefined);
    assert.deepEqual((await row())?.record.tokens, grownTokens);
    assert.ok((await version()) > reported);
  });
  test(`${label}: a server receipt for a saved prompt never queues it for estimation`, async (t) => {
    // Seen 15 October 2026: a Perplexity prompt that the server reported as a conflict and
    // then accepted got an estimation input, which every recalculation counted as unavailable.
    const { repository: r } = await create(t);
    await initialize(r, company);
    const pair = records();
    const known = pair[1].tokens.answer_output;
    const base = {
      schema_version: "3.0.0",
      kind: "history_message",
      timing: null,
      conversation_key: "f".repeat(64),
      key_version: "1",
      site: "perplexity",
      parent_key: null,
      provider_request_key: "c".repeat(64),
      occurred_at: pair[0].dispatched_at,
      date_basis: "entry_created",
      observed_at: new Date().toISOString(),
      model_id: null,
      proposed_method_id: methods.original.method_id,
      company_dedup_key: null,
      proposed_method_hash: methods.original.method_hash,
      inline_file_text: null,
      text_complete: true,
      coverage_reasons: ["history_only"],
      generation: emptyGeneration(),
    };
    const prompt = HistoryMessageSchema.parse({
      ...base,
      message_key: "7".repeat(64),
      role: "prompt",
      prompt_key: null,
      provider_attempt_key: null,
      tokens: known,
      parts: null,
    });
    const reply = HistoryMessageSchema.parse({
      ...base,
      message_key: "8".repeat(64),
      role: "response",
      parent_key: prompt.message_key,
      prompt_key: prompt.message_key,
      provider_attempt_key: "d".repeat(64),
      tokens: known,
      parts: historyResponseParts(known),
    });
    const commit = async (messages: HistoryMessage[]) => {
      const publication = await r.publicationSnapshot(company.namespace);
      await r.commitHistory(
        company,
        HistoryPageSchema.parse({
          schema_version: "3.0.0",
          site: "perplexity",
          conversation_key: base.conversation_key,
          observed_at: base.observed_at,
          deletion_epoch: 0,
          branch_scope: "loaded_messages",
          selected_leaf_key: null,
          branch_message_keys: null,
          root_message_key: null,
          first_request_verified: false,
          has_earlier: null,
          has_later: null,
          messages,
        }),
        {
          authority: historyAuthority(publication),
          erasureVersion: publication.erasureVersion,
          estimates: Object.fromEntries(
            messages.map((m) => [m.message_key, estimateHistoricalText(m)]),
          ),
        },
        () => true,
      );
    };
    const acknowledge = async (status: "applied" | "conflict") => {
      const pending = await r.pendingHistory(company);
      assert.equal(pending.length, 2);
      await r.acknowledgeHistory(
        company,
        pending.map((row) => ({
          message_key: row.record.message_key,
          payload_hash: row.hash,
          status,
        })),
      );
    };
    const inputs = async () => (await r.estimation.state(company)).inputCount;
    await commit([prompt, reply]);
    assert.equal(await inputs(), 1);
    // The server reports both as a conflict, then accepts a fuller read of both.
    await acknowledge("conflict");
    assert.equal(
      (await r.findHistoryMessage(company, prompt.message_key))?.serverConflict,
      true,
    );
    assert.equal(await inputs(), 1);
    const grown = { ...known, value: String(Number(known.value) + 5) };
    await commit([
      { ...prompt, tokens: grown },
      { ...reply, tokens: grown, parts: historyResponseParts(grown) },
    ]);
    await acknowledge("applied");
    assert.equal(
      (await r.findHistoryMessage(company, prompt.message_key))?.status,
      "current",
    );
    assert.equal(await inputs(), 1);
  });
  test(`${label}: a Perplexity reply is part of a thread by its saved copy or its linked live capture`, async (t) => {
    const { repository: r } = await create(t);
    await initialize(r, personal);
    const thread = "a1".repeat(32),
      other = "a2".repeat(32);
    const savedReply = "b1".repeat(32),
      liveReply = "b2".repeat(32),
      request = "c1".repeat(32);
    const pair = records();
    const saved = HistoryMessageSchema.parse({
      schema_version: "3.0.0",
      kind: "history_message",
      timing: null,
      message_key: "6".repeat(64),
      role: "response",
      conversation_key: thread,
      key_version: "1",
      site: "perplexity",
      parent_key: null,
      prompt_key: null,
      provider_request_key: "c2".repeat(32),
      provider_attempt_key: savedReply,
      occurred_at: pair[0].dispatched_at,
      date_basis: "entry_created",
      observed_at: new Date().toISOString(),
      model_id: null,
      proposed_method_id: methods.original.method_id,
      company_dedup_key: null,
      proposed_method_hash: methods.original.method_hash,
      tokens: pair[1].tokens.answer_output,
      inline_file_text: null,
      parts: historyResponseParts(pair[1].tokens.answer_output),
      generation: emptyGeneration(),
      text_complete: true,
      coverage_reasons: ["history_only"],
    });
    const publication = await r.publicationSnapshot(personal.namespace);
    await r.commitHistory(
      personal,
      HistoryPageSchema.parse({
        schema_version: "3.0.0",
        site: "perplexity",
        conversation_key: thread,
        observed_at: saved.observed_at,
        deletion_epoch: 0,
        branch_scope: "loaded_messages",
        selected_leaf_key: null,
        branch_message_keys: null,
        root_message_key: null,
        first_request_verified: false,
        has_earlier: null,
        has_later: null,
        messages: [saved],
      }),
      {
        authority: historyAuthority(publication),
        erasureVersion: publication.erasureVersion,
        estimates: { [saved.message_key]: estimateHistoricalText(saved) },
      },
      () => true,
    );
    const answer = (threadKey: string, attemptKey: string) =>
      r.threadAnswer(personal.namespace, threadKey, attemptKey);
    // A saved reply belongs to the thread its saved history was read from.
    assert.equal(await answer(thread, savedReply), true);
    assert.equal(await answer(other, savedReply), false);
    // A live reply belongs to a thread once its request is linked to it.
    pair[0].site = "perplexity";
    pair[0].provider_request_key = request;
    pair[1].provider_attempt_key = liveReply;
    await capture(r, personal, pair);
    assert.equal(await answer(thread, liveReply), false);
    const linkVersion = (await r.publicationSnapshot(personal.namespace))
      .erasureVersion;
    assert.deepEqual(
      await r.linkRecordedThread(personal, thread, [request], linkVersion),
      [request],
    );
    assert.equal(await answer(thread, liveReply), true);
    assert.equal(await answer(other, liveReply), false);
    assert.equal(await answer(thread, "b3".repeat(32)), false);
    // Another namespace sees nothing.
    assert.equal(
      await r.threadAnswer(company.namespace, thread, liveReply),
      false,
    );
    await assert.rejects(answer("not-a-key", liveReply), /payload_rejected/);
  });
  test(`${label}: W10 a running reply is marked interrupted only after the live limit`, async (t) => {
    const { repository: r } = await create(t);
    await initialize(r, company);
    const sent = (minutes: number) => {
      const pair = records();
      pair[0].dispatched_at = new Date(
        Date.now() - minutes * 60_000,
      ).toISOString();
      pair[1].started_at = pair[0].dispatched_at;
      return pair;
    };
    // Twenty minutes is a long reply, which the page may still be capturing.
    await capture(r, company, sent(20));
    assert.equal(await r.recoverInterrupted(company), 0);
    // Past the hour limit and one sweep, its page can no longer end it.
    await capture(r, company, sent(66));
    assert.equal(await r.recoverInterrupted(company), 1);
  });
}
