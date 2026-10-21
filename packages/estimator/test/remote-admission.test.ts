import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  composeOutputTotal,
  AttemptObservationSchema,
  HistoryMessageSchema,
  RequestObservationSchema,
  emptyRequestMedia,
  EstimationEnvelopeSchema,
  calculationInputHash,
  payloadHash,
  UNAVAILABLE_ADMISSION_METHOD_ID,
  type EstimationEnvelope,
  type Site,
} from "@footprint/contracts";
import build from "../../../config/estimation.build.json";
import mappings from "../../../config/estimation.mappings.json";
import media from "../../../config/estimation.media.json";
import { ECOLOGITS_IDENTITY } from "@footprint/ecologits-core/identity";
import { createMethodRegistry, LocalEstimateExecutor } from "../src/index";
import {
  admitRemoteEstimationResponse,
  createRemoteEstimateExecutor,
  RemoteEstimationFailure,
  RemoteTransportFailure,
  type RemoteRetryClock,
  type RemoteEstimateRequest,
  type RemoteExecutorConfiguration,
} from "../src/engines/remote-admission";
import { loadLegacyCorpus } from "./legacy-corpus";

const methods = createMethodRegistry(build, mappings, media);
const local = new LocalEstimateExecutor(methods);
const catalog = {
  identity: ECOLOGITS_IDENTITY,
  json: readFileSync(
    new URL("../../ecologits-core/data/catalog.json", import.meta.url),
    "utf8",
  ),
};
const corpus = loadLegacyCorpus();
function input(
  site: Site = "chatgpt",
  model: string | null = "chatgpt-gpt-5-5",
) {
  const attempt = AttemptObservationSchema.parse(
    structuredClone(
      corpus.live.find((entry: { name: string }) => entry.name === "output-500")
        .observation,
    ),
  );
  attempt.model_id = model as typeof attempt.model_id;
  attempt.model_evidence = model === null ? "unknown" : "response_field";
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
    model_evidence: attempt.model_evidence,
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
async function response(request: RemoteEstimateRequest, executor = local) {
  const result = await executor.estimate(request.observation, {
    methodId: request.accepted.requested_method.method_id,
    view: request.accepted.view,
    ...(request.accepted.original_method_hash === null
      ? {}
      : { originalMethodHash: request.accepted.original_method_hash }),
    ...(request.accepted.original_method_missing
      ? { originalMethodMissing: true }
      : {}),
  });
  const envelope = EstimationEnvelopeSchema.parse({
    ...result,
    execution_origin: "organization",
  });
  return {
    schema_version: "1.0.0",
    correlation: request.accepted.correlation,
    envelope,
    output_hash: payloadHash(envelope),
  };
}
function config(
  transport: RemoteExecutorConfiguration["transport"],
): RemoteExecutorConfiguration {
  return {
    methods,
    catalog,
    context: {
      mode: "company",
      organization_key: "b".repeat(64),
      installation_key: "c".repeat(64),
    },
    operation: {
      operation_id: "00000000-0000-4000-8000-000000000005",
      generation: 1,
      revision: 1,
    },
    isCurrent: () => true,
    transport,
  };
}

test("linked live and historical evidence survives remote admission with its source hash", async () => {
  const live = input();
  live.attempt.provider_attempt_key = "d".repeat(64);
  live.attempt.timing = {
    duration_seconds: "1.5",
    source: "browser_request",
    scope: "request",
    completeness: "complete_for_scope",
    profile_version: "timing-observation-1",
  };
  const old = corpus.history.find(
    (item: any) => item.observation.role === "response",
  ).observation;
  const history = HistoryMessageSchema.parse({
    ...old,
    conversation_key: live.request.conversation_key,
    site: live.request.site,
    provider_attempt_key: live.attempt.provider_attempt_key,
    model_id: live.attempt.model_id,
    timing: null,
  });
  let called = false;
  const remote = createRemoteEstimateExecutor(
    config(async (request) => {
      called = true;
      assert.equal(request.observation.family, "live");
      assert.equal(request.accepted.source.family, "live");
      if (request.accepted.source.family !== "live")
        throw new Error("live binding expected");
      assert.equal(
        request.accepted.source.history_binding?.message_key,
        history.message_key,
      );
      return response(request);
    }),
  );
  const options = { methodId: methods.ecologits.method_id };
  const expected = await local.estimate({ ...live, history }, options);
  const actual = await remote.estimate({ ...live, history }, options);
  assert.equal(called, true);
  assert.equal(actual.input_hash, expected.input_hash);
  assert.deepEqual(actual.metrics, expected.metrics);
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class ManualClock implements RemoteRetryClock {
  readonly jobs = new Set<{ delay: number; finish(): void }>();
  sleep(delay: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const clear = () => {
        this.jobs.delete(job);
        signal.removeEventListener("abort", abort);
      };
      const abort = () => {
        clear();
        reject(new RemoteEstimationFailure("cancelled"));
      };
      const job = {
        delay,
        finish: () => {
          clear();
          resolve();
        },
      };
      this.jobs.add(job);
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    });
  }
  has(delay: number) {
    return [...this.jobs].some((job) => job.delay === delay);
  }
  finish(delay: number) {
    const job = [...this.jobs].find((entry) => entry.delay === delay);
    assert.ok(job, `No pending clock delay ${delay}`);
    job.finish();
  }
}
async function until(predicate: () => boolean) {
  for (let turn = 0; turn < 1000; turn++) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail("Expected deterministic asynchronous work did not become ready");
}
const retryPolicy = {
  maxAttempts: 3,
  attemptTimeoutMs: 50,
  baseDelayMs: 5,
  maxDelayMs: 20,
};
for (const code of ["offline", "rate_limited", "server_unavailable"] as const) {
  for (const access of ["toJSON", "getter"] as const) {
    test(`RE11 response ${access} throwing ${code} is invalid and never activates recovery`, async () => {
      let calls = 0,
        fallbacks = 0;
      const clock = new ManualClock();
      const malformed =
        access === "toJSON"
          ? {
              toJSON() {
                throw new RemoteEstimationFailure(code);
              },
            }
          : {
              get schema_version() {
                throw new RemoteEstimationFailure(code);
              },
            };
      const executor = createRemoteEstimateExecutor({
        ...config(async () => {
          calls++;
          return malformed;
        }),
        clock,
        retry: retryPolicy,
        localFallback: {
          method: methods.original,
          executor: {
            executionOrigin: "local",
            estimate: async (...args) => {
              fallbacks++;
              return local.estimate(...args);
            },
          },
        },
      });
      const failure = await capturedFailure(executor.estimate(input()));
      assert.equal(failure.code, "response_invalid");
      assert.equal(calls, 1);
      assert.equal(fallbacks, 0);
      assert.equal(clock.jobs.size, 0);
    });
  }
}
function capturedFailure(promise: Promise<unknown>) {
  return promise.then(
    () => assert.fail("Expected a typed remote failure"),
    (error: unknown) => {
      assert.ok(error instanceof RemoteEstimationFailure);
      return error;
    },
  );
}

test("RE05 timeout retries the same frozen operation after possible completion and ignores its late response", async () => {
  const clock = new ManualClock(),
    late = deferred<Awaited<ReturnType<typeof response>>>();
  const requests: RemoteEstimateRequest[] = [],
    signals: AbortSignal[] = [];
  let stored: Awaited<ReturnType<typeof response>> | undefined,
    completions = 0,
    publications = 0;
  const executor = createRemoteEstimateExecutor({
    ...config(async (request, options) => {
      requests.push(request);
      signals.push(options.signal!);
      if (!stored) {
        stored = await response(request);
        completions++;
        return late.promise;
      }
      return stored;
    }),
    clock,
    retry: retryPolicy,
  });
  const result = executor.estimate(input()).then((value) => {
    publications++;
    return value;
  });
  await until(() => stored !== undefined && clock.has(50));
  clock.finish(50);
  await until(() => clock.has(5));
  assert.equal(signals[0].aborted, true);
  clock.finish(5);
  const admitted = await result;
  assert.equal(admitted.execution_origin, "organization");
  assert.equal(requests.length, 2);
  assert.equal(requests[0], requests[1]);
  assert.ok(Object.isFrozen(requests[0].accepted));
  assert.equal(completions, 1);
  late.resolve(stored!);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(publications, 1);
  assert.equal(clock.jobs.size, 0);
});

for (const [status, code] of [
  [401, "session_expired"],
  [403, "forbidden"],
  [409, "conflict"],
  [413, "payload_too_large"],
  [422, "invalid_input"],
  [404, "transport_failed"],
] as const) {
  test(`RE10 HTTP ${status} is terminal and never invokes offline fallback`, async () => {
    let transports = 0,
      fallbacks = 0;
    const clock = new ManualClock();
    const executor = createRemoteEstimateExecutor({
      ...config(async () => {
        transports++;
        throw new RemoteTransportFailure({ kind: "http", status });
      }),
      clock,
      retry: retryPolicy,
      localFallback: {
        method: methods.original,
        executor: {
          executionOrigin: "local",
          estimate: async (...args) => {
            fallbacks++;
            return local.estimate(...args);
          },
        },
      },
    });
    const failure = await capturedFailure(executor.estimate(input()));
    assert.equal(failure.code, code);
    assert.equal(failure.status, status);
    assert.equal(transports, 1);
    assert.equal(fallbacks, 0);
    assert.equal(clock.jobs.size, 0);
  });
}

for (const status of [429, 500, 503]) {
  test(`RE10 HTTP ${status} retries only within the configured backoff budget`, async () => {
    const clock = new ManualClock(),
      requests: RemoteEstimateRequest[] = [];
    const executor = createRemoteEstimateExecutor({
      ...config(async (request) => {
        requests.push(request);
        throw new RemoteTransportFailure({ kind: "http", status });
      }),
      clock,
      retry: retryPolicy,
    });
    const result = capturedFailure(executor.estimate(input()));
    for (const delay of [5, 10]) {
      await until(() => clock.has(delay));
      clock.finish(delay);
    }
    const failure = await result;
    assert.equal(
      failure.code,
      status === 429 ? "rate_limited" : "server_unavailable",
    );
    assert.equal(failure.status, status);
    assert.equal(requests.length, 3);
    assert.ok(requests.every((request) => request === requests[0]));
    assert.equal(clock.jobs.size, 0);
  });
}

test("RE10 Retry-After delays are honored or end the bounded operation without an early retry", async () => {
  for (const retryAfterMs of [7, 21]) {
    const clock = new ManualClock();
    let calls = 0;
    const executor = createRemoteEstimateExecutor({
      ...config(async (request) => {
        if (++calls === 1)
          throw new RemoteTransportFailure({
            kind: "http",
            status: 429,
            retryAfterMs,
          });
        return response(request);
      }),
      clock,
      retry: retryPolicy,
    });
    if (retryAfterMs > retryPolicy.maxDelayMs) {
      const failure = await capturedFailure(executor.estimate(input()));
      assert.equal(failure.code, "rate_limited");
      assert.equal(failure.retryAfterMs, retryAfterMs);
      assert.equal(calls, 1);
    } else {
      const result = executor.estimate(input());
      await until(() => clock.has(retryAfterMs));
      assert.equal(calls, 1);
      clock.finish(retryAfterMs);
      assert.equal((await result).execution_origin, "organization");
      assert.equal(calls, 2);
    }
    assert.equal(clock.jobs.size, 0);
  }
});

for (const change of ["cancel", "scope"] as const) {
  test(`RE09 ${change} during backoff prevents another transport call`, async () => {
    const clock = new ManualClock(),
      controller = new AbortController();
    let calls = 0,
      current = true;
    const executor = createRemoteEstimateExecutor({
      ...config(async () => {
        calls++;
        throw new RemoteTransportFailure({ kind: "http", status: 503 });
      }),
      clock,
      retry: retryPolicy,
      isCurrent: () => current,
    });
    const result = capturedFailure(
      executor.estimate(input(), { signal: controller.signal }),
    );
    await until(() => clock.has(5));
    if (change === "cancel") controller.abort();
    else {
      current = false;
      clock.finish(5);
    }
    assert.equal(
      (await result).code,
      change === "cancel" ? "cancelled" : "stale",
    );
    assert.equal(calls, 1);
    assert.equal(clock.jobs.size, 0);
  });
}

for (const [engine, site] of [
  ["original", "chatgpt"],
  ["ecologits", "chatgpt"],
  ["ecologits", "perplexity"],
] as const) {
  test(`RE06 offline ${engine}/${site} uses the exact accepted method and marks execution local`, async () => {
    const method = methods[engine],
      clock = new ManualClock();
    let captured!: RemoteEstimateRequest,
      calls = 0;
    const executor = createRemoteEstimateExecutor({
      ...config(async (request) => {
        captured = request;
        throw new RemoteTransportFailure({ kind: "offline" });
      }),
      clock,
      retry: retryPolicy,
      localFallback: {
        method,
        executor: {
          executionOrigin: "local",
          estimate: async (...args) => {
            calls++;
            return local.estimate(...args);
          },
        },
      },
    });
    const result = await executor.estimate(input(site, null), {
      methodId: method.method_id,
    });
    assert.equal(executor.executionOrigin, "organization");
    assert.equal(result.execution_origin, "local");
    for (const key of [
      "source",
      "input_hash",
      "requested_method",
      "effective_method",
      "selection",
      "auxiliary_method_hashes",
      "view",
      "original_method_hash",
    ] as const)
      assert.deepEqual(result[key], captured.accepted[key]);
    assert.equal(calls, 1);
    assert.equal(clock.jobs.size, 0);
  });
}

test("RE07 offline fallback never substitutes an absent or non-equivalent local method", async () => {
  for (const method of [
    null,
    methods.original,
    { ...methods.ecologits, profile_policy_hash: "f".repeat(64) },
    { ...methods.ecologits, implementation_version: "other" },
  ]) {
    let fallbacks = 0;
    const executor = createRemoteEstimateExecutor({
      ...config(async () => {
        throw new RemoteTransportFailure({ kind: "offline" });
      }),
      ...(method
        ? {
            localFallback: {
              method,
              executor: {
                executionOrigin: "local" as const,
                estimate: async (
                  ...args: Parameters<typeof local.estimate>
                ) => {
                  fallbacks++;
                  return local.estimate(...args);
                },
              },
            },
          }
        : {}),
    });
    const failure = await capturedFailure(
      executor.estimate(input(), { methodId: methods.ecologits.method_id }),
    );
    assert.equal(failure.code, "local_method_unavailable");
    assert.equal(fallbacks, 0);
  }
});

test("RE06 exact fallback declaration cannot authorize a substituted result or organization executor", async () => {
  for (const origin of ["organization", "local"] as const) {
    let calls = 0;
    const executor = createRemoteEstimateExecutor({
      ...config(async () => {
        throw new RemoteTransportFailure({ kind: "offline" });
      }),
      localFallback: {
        method: methods.ecologits,
        executor: {
          executionOrigin: origin,
          estimate: async (value, options) => {
            calls++;
            return local.estimate(value, {
              ...options,
              methodId: methods.original.method_id,
            });
          },
        },
      },
    });
    const failure = await capturedFailure(
      executor.estimate(input(), { methodId: methods.ecologits.method_id }),
    );
    assert.equal(
      failure.code,
      origin === "organization"
        ? "local_method_unavailable"
        : "response_mismatch",
    );
    assert.equal(calls, origin === "organization" ? 0 : 1);
  }
});

test("RE08/09 late transport is discarded after cancellation and unsettled work keeps its bounded slot", async () => {
  const clock = new ManualClock(),
    controller = new AbortController();
  const gates = [deferred<unknown>(), deferred<unknown>()];
  let calls = 0;
  const executor = createRemoteEstimateExecutor({
    ...config(async () => gates[calls++].promise),
    clock,
    retry: retryPolicy,
  });
  const first = capturedFailure(
    executor.estimate(input(), { signal: controller.signal }),
  );
  await until(() => calls === 1);
  controller.abort();
  assert.equal((await first).code, "cancelled");
  const nextController = new AbortController();
  const second = capturedFailure(
    executor.estimate(input(), { signal: nextController.signal }),
  );
  await until(() => calls === 2);
  assert.equal(
    (await capturedFailure(executor.estimate(input()))).code,
    "busy",
  );
  assert.equal(calls, 2);
  nextController.abort();
  assert.equal((await second).code, "cancelled");
  gates.forEach((gate) => gate.resolve({ raw_text: "synthetic late payload" }));
  assert.equal(clock.jobs.size, 0);
});

for (const change of ["cancel", "scope"] as const) {
  test(`RE06/09 ${change} during exact local fallback discards the late result`, async () => {
    const clock = new ManualClock(),
      controller = new AbortController();
    const gate = deferred<Readonly<EstimationEnvelope>>();
    let candidate: Readonly<EstimationEnvelope> | undefined,
      current = true,
      calls = 0;
    const executor = createRemoteEstimateExecutor({
      ...config(async () => {
        throw new RemoteTransportFailure({ kind: "offline" });
      }),
      clock,
      retry: retryPolicy,
      isCurrent: () => current,
      localFallback: {
        method: methods.original,
        executor: {
          executionOrigin: "local",
          estimate: async (...args) => {
            calls++;
            candidate = await local.estimate(...args);
            return gate.promise;
          },
        },
      },
    });
    const result = capturedFailure(
      executor.estimate(input(), { signal: controller.signal }),
    );
    await until(() => candidate !== undefined);
    if (change === "cancel") controller.abort();
    else current = false;
    gate.resolve(candidate!);
    assert.equal(
      (await result).code,
      change === "cancel" ? "cancelled" : "stale",
    );
    assert.equal(calls, 1);
    assert.equal(clock.jobs.size, 0);
  });
}

test("RE06 exact offline fallback preserves admitted missing-original lineage", async () => {
  const value = input();
  value.attempt.proposed_method_id = UNAVAILABLE_ADMISSION_METHOD_ID;
  const executor = createRemoteEstimateExecutor({
    ...config(async () => {
      throw new RemoteTransportFailure({ kind: "offline" });
    }),
    localFallback: { method: methods.original, executor: local },
  });
  const result = await executor.estimate(value, {
    methodId: methods.original.method_id,
    view: "recalculated",
    originalMethodMissing: true,
  });
  assert.equal(result.execution_origin, "local");
  assert.equal(result.original_method_hash, null);
  assert.ok(result.reasons.includes("original_method_missing"));
  assert.ok(
    result.raw?.engine_id === "original" && !Array.isArray(result.raw.result),
  );
  assert.equal(result.raw.result.view, "recalculated");
  assert.equal(result.raw.result.original_method_hash, null);
});

test("RE10 retry settings are bounded before execution and snapshotted for in-flight work", async () => {
  let calls = 0;
  const base = config(async () => {
    calls++;
    throw new RemoteTransportFailure({ kind: "timeout" });
  });
  for (const retry of [
    { maxAttempts: 0 },
    { maxAttempts: 5 },
    { attemptTimeoutMs: Infinity },
    { baseDelayMs: -1 },
    { maxDelayMs: 60_001 },
    { baseDelayMs: 10, maxDelayMs: 5 },
  ])
    assert.throws(() => createRemoteEstimateExecutor({ ...base, retry }));
  assert.equal(calls, 0);
  const clock = new ManualClock(),
    retry = { ...retryPolicy };
  const executor = createRemoteEstimateExecutor({ ...base, retry, clock });
  retry.maxAttempts = 1;
  retry.baseDelayMs = 1;
  const result = capturedFailure(executor.estimate(input()));
  for (const delay of [5, 10]) {
    await until(() => clock.has(delay));
    clock.finish(delay);
  }
  assert.equal((await result).code, "timeout");
  assert.equal(calls, 3);
  assert.equal(clock.jobs.size, 0);
});

test("RE01 personal mode refuses before injected transport, and stale/aborted jobs cannot send", async () => {
  let calls = 0;
  const base = config(async (request) => {
    calls++;
    return response(request);
  });
  const personal = createRemoteEstimateExecutor({
    ...base,
    context: { mode: "personal" },
    catalog: { ...catalog, json: "invalid" },
  });
  await assert.rejects(personal.estimate(input()), /personal_disallowed/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    createRemoteEstimateExecutor(base).estimate(input(), {
      signal: controller.signal,
    }),
    /cancelled/,
  );
  await assert.rejects(
    createRemoteEstimateExecutor({ ...base, isCurrent: () => false }).estimate(
      input(),
    ),
    /stale/,
  );
  assert.equal(calls, 0);
});

test("RE03/04 correct company response preserves exact method/input/output identity and configured fallback", async () => {
  let calls = 0;
  const executor = createRemoteEstimateExecutor(
    config(async (request) => {
      calls++;
      return response(request);
    }),
  );
  assert.equal(executor.executionOrigin, "organization");
  assert.equal(Reflect.set(executor, "executionOrigin", "local"), false);
  const direct = await executor.estimate(input(), {
    methodId: methods.ecologits.method_id,
  });
  assert.equal(direct.execution_origin, "organization");
  assert.equal(
    direct.requested_method.method_hash,
    methods.ecologits.method_hash,
  );
  assert.equal(direct.selection.kind, "direct_mapping");
  const fallback = await executor.estimate(
    input("perplexity", "perplexity-unlisted"),
    { methodId: methods.ecologits.method_id },
  );
  assert.equal(fallback.selection.kind, "provider_flagship");
  assert.equal(fallback.selection.profile?.model_name, "gpt-6.1-sol");
  assert.equal(fallback.selection.basis, "model_not_in_library");
  assert.equal(
    fallback.effective_method.method_hash,
    methods.ecologits.method_hash,
  );
  assert.equal(calls, 2);
  assert.ok(Object.isFrozen(direct));
});

test("RE04/11 self-consistent altered source, method, selection or correlation cannot authorize a response", async () => {
  let request!: RemoteEstimateRequest;
  await createRemoteEstimateExecutor(
    config(async (value) => {
      request = value;
      return response(value);
    }),
  ).estimate(input(), { methodId: methods.ecologits.method_id });
  const good = await response(request);
  for (const mutate of [
    (value: typeof good) => {
      value.correlation = {
        ...value.correlation,
        organization_key: "d".repeat(64),
      };
    },
    (value: typeof good) => {
      value.correlation = {
        ...value.correlation,
        installation_key: "d".repeat(64),
      };
    },
    (value: typeof good) => {
      value.correlation = { ...value.correlation, generation: 2 };
    },
    (value: typeof good) => {
      value.correlation = { ...value.correlation, revision: 2 };
    },
    (value: typeof good) => {
      value.correlation = {
        ...value.correlation,
        operation_id: "00000000-0000-4000-8000-000000000006",
      };
    },
    (value: typeof good) => {
      value.envelope.requested_method.method_id = "forged-method-id";
      value.envelope.effective_method.method_id = "forged-method-id";
    },
    (value: typeof good) => {
      value.envelope.requested_method.catalog_hash = "d".repeat(64);
      value.envelope.effective_method.catalog_hash = "d".repeat(64);
    },
    (value: typeof good) => {
      if (value.envelope.source.family === "live")
        value.envelope.source.attempt_revision++;
    },
    (value: typeof good) => {
      value.envelope.execution_origin = "local";
    },
  ]) {
    const bad = structuredClone(good);
    mutate(bad);
    bad.envelope.input_hash = calculationInputHash(bad.envelope);
    bad.output_hash = payloadHash(bad.envelope);
    EstimationEnvelopeSchema.parse(bad.envelope);
    assert.throws(
      () => admitRemoteEstimationResponse(bad, request.accepted),
      /response_mismatch/,
    );
  }
  const wrongDigest = { ...good, output_hash: "0".repeat(64) };
  assert.throws(
    () => admitRemoteEstimationResponse(wrongDigest, request.accepted),
    /response_mismatch/,
  );
  assert.throws(
    () =>
      admitRemoteEstimationResponse(
        { ...good, raw_text: "forbidden" },
        request.accepted,
      ),
    /response_invalid/,
  );
  assert.throws(
    () =>
      admitRemoteEstimationResponse(
        " ".repeat(2 * 1024 * 1024 + 1),
        request.accepted,
      ),
    /response_invalid/,
  );
  const invalid = structuredClone(good) as any;
  invalid.envelope.metrics.energy.value = "NaN";
  assert.throws(
    () => admitRemoteEstimationResponse(invalid, request.accepted),
    /response_invalid/,
  );
});

test("RE04/06 configured flagship cannot be replaced by a self-signed original fallback", async () => {
  const otherBuild = {
    ...build,
    ecologits_fallback: {
      ...build.ecologits_fallback,
      provider_defaults: Object.fromEntries(
        Object.keys(build.ecologits_fallback.provider_defaults).map(
          (provider) => [provider, { strategy: "original_engine" }],
        ),
      ),
    },
  };
  const otherMethods = createMethodRegistry(otherBuild, mappings, media),
    other = new LocalEstimateExecutor(otherMethods);
  const executor = createRemoteEstimateExecutor(
    config(async (request) => {
      const computed = await other.estimate(request.observation, {
        methodId: otherMethods.ecologits.method_id,
      });
      const envelope: EstimationEnvelope = {
        ...structuredClone(computed),
        requested_method: request.accepted.requested_method,
        execution_origin: "organization",
      };
      envelope.input_hash = calculationInputHash(envelope);
      EstimationEnvelopeSchema.parse(envelope);
      return {
        schema_version: "1.0.0",
        correlation: request.accepted.correlation,
        envelope,
        output_hash: payloadHash(envelope),
      };
    }),
  );
  await assert.rejects(
    executor.estimate(input("chatgpt", "chatgpt-unlisted"), {
      methodId: methods.ecologits.method_id,
    }),
    /response_mismatch/,
  );
});

test("RE09/11 wrong catalog bytes/source identity and unexpected methods fail before transport", async () => {
  let calls = 0;
  const base = config(async (request) => {
    calls++;
    return response(request);
  });
  for (const badCatalog of [
    { ...catalog, json: catalog.json + " " },
    {
      ...catalog,
      identity: { ...ECOLOGITS_IDENTITY, requested_git_commit: "0".repeat(40) },
    },
  ]) {
    const executor = createRemoteEstimateExecutor({
      ...base,
      catalog: badCatalog,
    });
    await assert.rejects(
      executor.estimate(input(), { methodId: methods.ecologits.method_id }),
      /method_update_invalid/,
    );
  }
  await assert.rejects(
    createRemoteEstimateExecutor(base).estimate(input(), {
      methodId: "not-installed",
    }),
    /method_unsupported/,
  );
  const bad = input();
  bad.request.request_id = "00000000-0000-4000-8000-000000000007";
  await assert.rejects(
    createRemoteEstimateExecutor(base).estimate(bad),
    /dependency_missing/,
  );
  await assert.rejects(
    createRemoteEstimateExecutor(base).estimate({
      ...input(),
      raw_text: "forbidden",
    } as any),
    /dependency_missing/,
  );
  const unsafe = input();
  unsafe.attempt.tokens.answer_output.value = "9007199254740992";
  unsafe.attempt.tokens.output_total = composeOutputTotal(unsafe.attempt.tokens);
  await assert.rejects(
    createRemoteEstimateExecutor(base).estimate(unsafe, {
      methodId: methods.ecologits.method_id,
    }),
    /numeric_domain_unsupported/,
  );
  const zero = input();
  zero.attempt.tokens.answer_output.value = "0";
  zero.attempt.tokens.output_total = composeOutputTotal(zero.attempt.tokens);
  await assert.rejects(
    createRemoteEstimateExecutor(base).estimate(zero),
    /estimate_unavailable/,
  );
  assert.equal(calls, 0);
});

test("RE08/09 abort and superseding generation reject late responses without publication", async () => {
  for (const action of ["abort", "supersede"] as const) {
    const received = deferred<RemoteEstimateRequest>(),
      reply = deferred<unknown>();
    const controller = new AbortController();
    let generation = 1,
      published = 0;
    const executor = createRemoteEstimateExecutor({
      ...config((request) => {
        received.resolve(request);
        return reply.promise;
      }),
      isCurrent: (binding) => binding.generation === generation,
    });
    const pending = executor
      .estimate(input(), {
        methodId: methods.ecologits.method_id,
        signal: controller.signal,
      })
      .then((value) => {
        published++;
        return value;
      });
    const rejection = assert.rejects(
      pending,
      action === "abort" ? /cancelled/ : /stale/,
    );
    const request = await received.promise;
    if (action === "abort") {
      controller.abort();
      await rejection;
    } else generation++;
    reply.resolve(await response(request));
    await rejection;
    await Promise.resolve();
    assert.equal(published, 0);
  }
});

test("RE12 boundary has only an injected transport; transport failure is sanitized", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("No endpoint is allowed");
  }) as typeof fetch;
  try {
    const executor = createRemoteEstimateExecutor(
      config(async () => {
        throw new Error("private transport detail");
      }),
    );
    await assert.rejects(
      executor.estimate(input()),
      (error) => error instanceof Error && error.message === "transport_failed",
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Remote missing-original binding is derived from the live marker for original, EcoLogits and fallback", async () => {
  for (const [methodId, site, model] of [
    [methods.original.method_id, "chatgpt", "chatgpt-gpt-5-5"],
    [methods.ecologits.method_id, "chatgpt", "chatgpt-gpt-5-5"],
    [methods.ecologits.method_id, "perplexity", "perplexity-unlisted"],
  ] as const) {
    const observation = input(site, model);
    observation.attempt.proposed_method_id = UNAVAILABLE_ADMISSION_METHOD_ID;
    const executor = createRemoteEstimateExecutor(
      config(async (request) => {
        assert.equal(request.accepted.original_method_missing, true);
        assert.equal(request.accepted.original_method_hash, null);
        assert.equal(request.accepted.view, "recalculated");
        return response(request);
      }),
    );
    const result = await executor.estimate(observation, {
      methodId,
      view: "recalculated",
      originalMethodMissing: true,
    });
    assert.equal(result.view, "recalculated");
    assert.equal(result.original_method_hash, null);
    assert.ok(result.reasons.includes("original_method_missing"));
    if (result.raw?.engine_id === "original") {
      assert.ok(!Array.isArray(result.raw.result));
      assert.equal(result.raw.result.view, "recalculated");
      assert.equal(result.raw.result.original_method_hash, null);
    }
  }
});

test("Remote marker misuse, known-lineage downgrade, history and malformed flags fail before transport", async () => {
  let calls = 0;
  const executor = createRemoteEstimateExecutor(
    config(async (request) => {
      calls++;
      return response(request);
    }),
  );
  const marker = input();
  marker.attempt.proposed_method_id = UNAVAILABLE_ADMISSION_METHOD_ID;
  for (const methodId of [
    methods.original.method_id,
    methods.ecologits.method_id,
  ]) {
    await assert.rejects(
      executor.estimate(marker, { methodId }),
      /method_update_invalid/,
    );
    await assert.rejects(
      executor.estimate(marker, {
        methodId,
        view: "original",
        originalMethodMissing: false,
      }),
      /method_update_invalid/,
    );
    await assert.rejects(
      executor.estimate(input(), {
        methodId,
        view: "recalculated",
        originalMethodMissing: true,
      }),
      /method_update_invalid/,
    );
    await assert.rejects(
      executor.estimate(marker, {
        methodId,
        view: "recalculated",
        originalMethodMissing: true,
        originalMethodHash: methods.original.method_hash,
      }),
      /method_update_invalid/,
    );
  }
  for (const originalMethodMissing of [false, null, "true", 1, 0]) {
    await assert.rejects(
      executor.estimate(marker, {
        methodId: methods.original.method_id,
        view: "recalculated",
        originalMethodMissing,
      } as any),
      /method_update_invalid/,
    );
  }
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
        methodId: methods.original.method_id,
        view: "recalculated",
        originalMethodMissing: true,
      },
    ),
    /method_update_invalid/,
  );
  assert.equal(calls, 0);
  const legacyNull = input();
  legacyNull.attempt.proposed_method_id = null;
  const legacy = await executor.estimate(legacyNull);
  assert.equal(
    legacy.effective_method.method_hash,
    methods.original.method_hash,
  );
  assert.equal(legacy.reasons.includes("original_method_missing"), false);
  const known = await executor.estimate(input(), {
    view: "recalculated",
    originalMethodHash: methods.original.method_hash,
  });
  assert.equal(known.original_method_hash, methods.original.method_hash);
});

test("Remote responses cannot invent missing lineage or relabel the raw original as a saved original", async () => {
  const marker = input();
  marker.attempt.proposed_method_id = UNAVAILABLE_ADMISSION_METHOD_ID;
  let acceptedRequest!: RemoteEstimateRequest;
  await createRemoteEstimateExecutor(
    config(async (request) => {
      acceptedRequest = request;
      return response(request);
    }),
  ).estimate(marker, {
    methodId: methods.original.method_id,
    view: "recalculated",
    originalMethodMissing: true,
  });
  const good = await response(acceptedRequest);
  const rawRelabeled = structuredClone(good);
  assert.equal(rawRelabeled.envelope.raw?.engine_id, "original");
  if (
    rawRelabeled.envelope.raw?.engine_id !== "original" ||
    Array.isArray(rawRelabeled.envelope.raw.result)
  )
    throw new Error("Expected raw original");
  rawRelabeled.envelope.raw.result.view = "original";
  rawRelabeled.output_hash = payloadHash(rawRelabeled.envelope);
  assert.throws(
    () => admitRemoteEstimationResponse(rawRelabeled, acceptedRequest.accepted),
    /response_mismatch/,
  );
  const removedReason = structuredClone(good);
  removedReason.envelope.reasons = removedReason.envelope.reasons.filter(
    (reason) => reason !== "original_method_missing",
  );
  removedReason.output_hash = payloadHash(removedReason.envelope);
  assert.throws(
    () =>
      admitRemoteEstimationResponse(removedReason, acceptedRequest.accepted),
    /response_invalid/,
  );
});
