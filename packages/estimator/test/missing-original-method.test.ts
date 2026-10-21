import assert from "node:assert/strict";
import test from "node:test";
import {
  composeOutputTotal,
  AttemptObservationSchema,
  RequestObservationSchema,
  HistoryMessageSchema,
  EstimationEnvelopeSchema,
  UNAVAILABLE_ADMISSION_METHOD_ID,
  canonicalJson,
  payloadHash,
  emptyRequestMedia,
  type Site,
} from "@footprint/contracts";
import configuration from "../../../config/estimation.build.json";
import mappings from "../../../config/estimation.mappings.json";
import media from "../../../config/estimation.media.json";
import {
  BASELINE_BUNDLE,
  BASELINE_METHOD_HASH,
  BASELINE_METHOD_ID,
  createMethodRegistry,
  LocalEstimateExecutor,
  estimateAttempt,
} from "../src/index";
import { registerMethodBundle } from "../src/original";
import { loadLegacyCorpus } from "./legacy-corpus";

const corpus = loadLegacyCorpus();
const frozen = corpus.live.find(
  (entry: { name: string }) => entry.name === "output-500",
);
const methods = createMethodRegistry(configuration, mappings, media);
const executor = new LocalEstimateExecutor(methods);
/** Test-only policy: the shipped policy never routes to the original engine. */
const legacyConfiguration = {
  ...configuration,
  ecologits_fallback: {
    ...configuration.ecologits_fallback,
    unknown_provider: { strategy: "original_engine" as const },
  },
};
const legacyMethods = createMethodRegistry(legacyConfiguration, mappings, media);
const legacyExecutor = new LocalEstimateExecutor(legacyMethods);
function live(
  proposed: string | null = UNAVAILABLE_ADMISSION_METHOD_ID,
  site: Site = "chatgpt",
  model = "chatgpt-gpt-5-5",
) {
  const attempt = AttemptObservationSchema.parse({
    ...structuredClone(frozen.observation),
    proposed_method_id: proposed,
    company_dedup_key: null,
    model_id: model,
    model_evidence: "response_field",
  });
  const request = RequestObservationSchema.parse({
    schema_version: "3.0.0",
    kind: "request",
    request_id: attempt.request_id,
    revision: 1,
    conversation_key: "a".repeat(64),
    key_version: "1",
    provider_request_key: null,
    site,
    adapter_version: "0.1.0",
    action: "send",
    dispatched_at: attempt.started_at,
    ended_at: attempt.ended_at,
    state: "completed",
    model_id: model,
    model_evidence: "response_field",
    features: ["text"],
    observed_search_operations: null,
    documents: {
      extracted_text: null,
      upload_count: null,
      types: [],
      processing: "unknown",
    },
    media: emptyRequestMedia(),
    coverage_reasons: [],
    policy_version: "0.1.0",
    company_dedup_key: null,
  });
  return { family: "live" as const, request, attempt };
}

test("Missing-original opt-in leaves frozen raw bytes and prior default rejection unchanged", () => {
  const observation = AttemptObservationSchema.parse(frozen.observation);
  assert.equal(
    canonicalJson(estimateAttempt(observation)),
    canonicalJson(frozen.expected),
  );
  assert.equal(
    canonicalJson(
      estimateAttempt(observation, { originalMethodMissing: false }),
    ),
    canonicalJson(frozen.expected),
  );
  assert.throws(
    () => estimateAttempt(observation, { view: "recalculated" }),
    /method_update_invalid/,
  );
  const known = estimateAttempt(observation, {
    view: "recalculated",
    originalMethodHash: BASELINE_METHOD_HASH,
  });
  assert.equal(
    canonicalJson(known),
    canonicalJson({
      ...frozen.expected,
      view: "recalculated",
      original_method_hash: BASELINE_METHOD_HASH,
    }),
  );
  const priorNull = AttemptObservationSchema.parse({
    ...observation,
    proposed_method_id: null,
    company_dedup_key: null,
  });
  assert.equal(estimateAttempt(priorNull).method_id, BASELINE_METHOD_ID);
});

test("Validated live admission marker permits honest recalculated/null lineage in both engines and original fallback", async () => {
  for (const [methodId, site, model, run] of [
    [methods.original.method_id, "chatgpt", "chatgpt-gpt-5-5", executor],
    [methods.ecologits.method_id, "chatgpt", "chatgpt-gpt-5-5", executor],
    [methods.ecologits.method_id, "perplexity", "perplexity-unlisted", executor],
    [
      legacyMethods.ecologits.method_id,
      "perplexity",
      "perplexity-unlisted",
      legacyExecutor,
    ],
  ] as const) {
    const input = live(UNAVAILABLE_ADMISSION_METHOD_ID, site, model),
      before = canonicalJson(input);
    const result = await run.estimate(input, {
      methodId,
      view: "recalculated",
      originalMethodMissing: true,
    });
    EstimationEnvelopeSchema.parse(result);
    assert.equal(result.view, "recalculated");
    assert.equal(result.original_method_hash, null);
    assert.equal(result.status, "estimated");
    assert.ok(result.reasons.includes("original_method_missing"));
    if (result.raw?.engine_id === "original") {
      assert.ok(!Array.isArray(result.raw.result));
      assert.equal(result.raw.result.view, "recalculated");
      assert.equal(result.raw.result.original_method_hash, null);
      assert.equal(
        result.raw.result.observation_hash,
        payloadHash(input.attempt),
      );
      assert.ok(result.raw.result.reasons.includes("original_method_missing"));
      assert.ok(
        result.raw.result.metrics.energy.reasons.includes(
          "original_method_missing",
        ),
      );
      const ordinary = estimateAttempt(
        { ...input.attempt, proposed_method_id: BASELINE_METHOD_ID },
        {
          methodId: BASELINE_METHOD_ID,
          view: "recalculated",
          originalMethodHash: BASELINE_METHOD_HASH,
        },
      );
      for (const metric of Object.keys(ordinary.metrics) as Array<
        keyof typeof ordinary.metrics
      >) {
        assert.deepEqual(
          { ...result.raw.result.metrics[metric], reasons: [] },
          { ...ordinary.metrics[metric], reasons: [] },
        );
      }
    }
    if (site === "perplexity")
      assert.equal(
        result.selection.kind,
        run === legacyExecutor ? "original_fallback" : "provider_flagship",
      );
    assert.equal(canonicalJson(input), before);
  }
});

test("The marker is never a formula and requires an explicit supported target", async () => {
  const input = live();
  await assert.rejects(
    executor.estimate(input, {
      view: "recalculated",
      originalMethodMissing: true,
    }),
    /method_unsupported/,
  );
  assert.throws(
    () =>
      estimateAttempt(input.attempt, {
        view: "recalculated",
        originalMethodMissing: true,
      }),
    /method_unsupported/,
  );
  assert.throws(
    () =>
      registerMethodBundle({
        ...BASELINE_BUNDLE,
        method_id: UNAVAILABLE_ADMISSION_METHOD_ID,
      }),
    /method_update_invalid/,
  );
  assert.throws(
    () =>
      estimateAttempt(
        input.attempt,
        { methodId: UNAVAILABLE_ADMISSION_METHOD_ID },
        { ...BASELINE_BUNDLE, method_id: UNAVAILABLE_ADMISSION_METHOD_ID },
      ),
    /method_unsupported/,
  );
  for (const methodId of [
    methods.original.method_id,
    methods.ecologits.method_id,
  ]) {
    await assert.rejects(
      executor.estimate(input, { methodId }),
      /method_update_invalid/,
    );
    await assert.rejects(
      executor.estimate(input, {
        methodId,
        view: "original",
        originalMethodMissing: false,
      }),
      /method_update_invalid/,
    );
  }
  assert.throws(
    () => estimateAttempt(input.attempt, { methodId: BASELINE_METHOD_ID }),
    /method_update_invalid/,
  );
});

test("Arbitrary null lineage, known-lineage downgrades and malformed flags are rejected", async () => {
  for (const proposed of [
    null,
    BASELINE_METHOD_ID,
    "unrecognized-archived-method",
  ]) {
    const input = live(proposed);
    const options = {
      methodId: BASELINE_METHOD_ID,
      view: "recalculated" as const,
      originalMethodMissing: true,
    };
    await assert.rejects(
      executor.estimate(input, options),
      /method_update_invalid/,
    );
    assert.throws(
      () => estimateAttempt(input.attempt, options),
      /method_update_invalid/,
    );
  }
  for (const flag of [null, "true", "false", 0, 1, {}, []]) {
    const options = {
      methodId: BASELINE_METHOD_ID,
      view: "recalculated",
      originalMethodMissing: flag,
    } as any;
    await assert.rejects(
      executor.estimate(live(), options),
      /method_update_invalid/,
    );
    assert.throws(
      () => estimateAttempt(live().attempt, options),
      /method_update_invalid/,
    );
  }
  for (const options of [
    { view: "recalculated", originalMethodMissing: false },
    { view: "recalculated" },
    { view: "original", originalMethodMissing: true },
    {
      view: "recalculated",
      originalMethodMissing: true,
      originalMethodHash: BASELINE_METHOD_HASH,
    },
  ]) {
    await assert.rejects(
      executor.estimate(live(), {
        ...options,
        methodId: BASELINE_METHOD_ID,
      } as any),
      /method_update_invalid/,
    );
  }
  const known = await executor.estimate(live(BASELINE_METHOD_ID), {
    methodId: BASELINE_METHOD_ID,
    view: "recalculated",
    originalMethodHash: BASELINE_METHOD_HASH,
  });
  assert.equal(known.original_method_hash, BASELINE_METHOD_HASH);
  assert.equal(known.reasons.includes("original_method_missing"), false);
});

test("History cannot use live missing-method opt-in and unavailable numbers retain truthful lineage", async () => {
  const record = HistoryMessageSchema.parse(
    corpus.history.find(
      (entry: { name: string }) => entry.name === "response-100",
    ).observation,
  );
  await assert.rejects(
    executor.estimate(
      {
        family: "history",
        record: {
          ...record,
          proposed_method_id: UNAVAILABLE_ADMISSION_METHOD_ID,
          company_dedup_key: null,
        },
      },
      {
        methodId: BASELINE_METHOD_ID,
        view: "recalculated",
        originalMethodMissing: true,
      },
    ),
    /method_update_invalid/,
  );
  const known = await executor.estimate(
    { family: "history", record },
    {
      methodId: BASELINE_METHOD_ID,
      view: "recalculated",
      originalMethodHash: record.proposed_method_hash,
    },
  );
  assert.equal(known.original_method_hash, record.proposed_method_hash);
  assert.equal(known.reasons.includes("original_method_missing"), false);
  const unsafe = live();
  unsafe.attempt.tokens.answer_output.value = "9007199254740992";
  unsafe.attempt.tokens.output_total = composeOutputTotal(unsafe.attempt.tokens);
  const result = await executor.estimate(unsafe, {
    methodId: methods.ecologits.method_id,
    view: "recalculated",
    originalMethodMissing: true,
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.original_method_hash, null);
  assert.ok(result.reasons.includes("original_method_missing"));
  assert.ok(result.reasons.includes("numeric_domain_unsupported"));
});

test("Missing-lineage admission is stable while the EcoLogits runtime loads", async () => {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const delayed = new LocalEstimateExecutor(methods, async () => {
    await wait;
    return import("@footprint/ecologits-core");
  });
  const options = {
    methodId: methods.ecologits.method_id,
    view: "recalculated" as const,
    originalMethodMissing: true,
    originalMethodHash: undefined as string | undefined,
  };
  const pending = delayed.estimate(live(), options);
  options.originalMethodMissing = false;
  options.originalMethodHash = BASELINE_METHOD_HASH;
  release();
  const result = await pending;
  assert.equal(result.original_method_hash, null);
  assert.ok(result.reasons.includes("original_method_missing"));
});
