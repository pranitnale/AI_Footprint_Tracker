import { z } from "zod";
import {
  EcoLogitsCoreIdentitySchema,
  EcoLogitsMethodDefinitionSchema,
  EngineMethodIdentitySchema,
  EstimateObservationSourceSchema,
  EstimationEnvelopeSchema,
  OpaqueKeySchema,
  SelectionRevisionSchema,
  calculationInputHash,
  canonicalJson,
  payloadHash,
  type EstimationEnvelope,
  type UpstreamProfileReference,
} from "@footprint/contracts";
import { deepFreeze } from "../bundle";
import { RETIRED_IMAGE_REFERENCE_HASH } from "../original";
import { admitsMissingOriginalMethod } from "../lineage";
import { resolveModelProfile, validateProfilePolicy } from "../selection";
import {
  createMethodRegistry,
  DIRECTLY_IDENTIFIED_PROVIDERS,
  type MethodRegistry,
} from "./methods";
import { prepareObservation, type NumericObservationInput } from "./inputs";
import type { EstimateExecutor, EstimationOptions } from "./service";

const CorrelationSchema = z.strictObject({
  organization_key: OpaqueKeySchema,
  installation_key: OpaqueKeySchema,
  operation_id: z.uuid(),
  generation: SelectionRevisionSchema,
  revision: SelectionRevisionSchema,
});
const ContextSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("personal") }),
  z.strictObject({
    mode: z.literal("company"),
    organization_key: OpaqueKeySchema,
    installation_key: OpaqueKeySchema,
  }),
]);
const AcceptedSchema = z.strictObject({
  correlation: CorrelationSchema,
  source: EstimateObservationSourceSchema,
  input_hash: OpaqueKeySchema,
  requested_method: EngineMethodIdentitySchema,
  effective_method: EngineMethodIdentitySchema,
  selection: EstimationEnvelopeSchema.shape.selection,
  auxiliary_method_hashes:
    EstimationEnvelopeSchema.shape.auxiliary_method_hashes,
  view: EstimationEnvelopeSchema.shape.view,
  original_method_hash: OpaqueKeySchema.nullable(),
  original_method_missing: z.boolean(),
});
const ResponseSchema = z.strictObject({
  schema_version: z.literal("1.0.0"),
  correlation: CorrelationSchema,
  envelope: EstimationEnvelopeSchema,
  output_hash: OpaqueKeySchema,
});
export type RemoteCorrelation = z.infer<typeof CorrelationSchema>;
export type AcceptedRemoteBinding = Readonly<z.infer<typeof AcceptedSchema>>;
export interface RemoteEstimateRequest {
  readonly schema_version: "1.0.0";
  readonly accepted: AcceptedRemoteBinding;
  readonly observation: NumericObservationInput;
}
export interface RemoteExecutorConfiguration {
  methods: MethodRegistry;
  catalog: { identity: unknown; json: string };
  context: z.infer<typeof ContextSchema>;
  operation: Pick<
    RemoteCorrelation,
    "operation_id" | "generation" | "revision"
  >;
  isCurrent(correlation: Readonly<RemoteCorrelation>): boolean;
  retry?: Partial<RemoteRetryPolicy>;
  clock?: RemoteRetryClock;
  localFallback?: {
    method: z.infer<typeof EngineMethodIdentitySchema>;
    executor: EstimateExecutor;
  };
  transport(
    request: Readonly<RemoteEstimateRequest>,
    options: { signal?: AbortSignal },
  ): Promise<unknown>;
}
const RetryPolicySchema = z
  .strictObject({
    maxAttempts: z.number().int().min(1).max(4).default(3),
    attemptTimeoutMs: z.number().int().min(1).max(60_000).default(10_000),
    baseDelayMs: z.number().int().min(1).max(30_000).default(250),
    maxDelayMs: z.number().int().min(1).max(60_000).default(5_000),
  })
  .refine((value) => value.baseDelayMs <= value.maxDelayMs);
export type RemoteRetryPolicy = z.infer<typeof RetryPolicySchema>;
export interface RemoteRetryClock {
  sleep(milliseconds: number, signal: AbortSignal): Promise<void>;
}
const TransportIssueSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("offline") }),
  z.strictObject({ kind: z.literal("timeout") }),
  z.strictObject({
    kind: z.literal("http"),
    status: z.number().int().min(400).max(599),
    retryAfterMs: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
  }),
]);
/** Session adapters report only typed state and status; response bodies and credentials stay outside diagnostics. */
export class RemoteTransportFailure extends Error {
  readonly issue: Readonly<z.infer<typeof TransportIssueSchema>>;
  constructor(issue: z.infer<typeof TransportIssueSchema>) {
    super("remote_transport_failure");
    this.name = "RemoteTransportFailure";
    this.issue = deepFreeze(TransportIssueSchema.parse(issue));
  }
}
export class RemoteEstimationFailure extends Error {
  constructor(
    readonly code:
      | "personal_disallowed"
      | "method_unsupported"
      | "method_update_invalid"
      | "dependency_missing"
      | "estimate_unavailable"
      | "numeric_domain_unsupported"
      | "response_invalid"
      | "response_mismatch"
      | "cancelled"
      | "stale"
      | "transport_failed"
      | "offline"
      | "timeout"
      | "session_expired"
      | "forbidden"
      | "conflict"
      | "payload_too_large"
      | "invalid_input"
      | "rate_limited"
      | "server_unavailable"
      | "local_method_unavailable"
      | "busy",
    readonly status: number | null = null,
    readonly retryAfterMs: number | null = null,
  ) {
    super(code);
    this.name = "RemoteEstimationFailure";
  }
}
const reject = (code: RemoteEstimationFailure["code"]): never => {
  throw new RemoteEstimationFailure(code);
};
class ResponseAdmissionFailure extends Error {
  constructor(readonly code: "response_invalid" | "response_mismatch") {
    super(code);
  }
}
const rejectResponse = (code: ResponseAdmissionFailure["code"]): never => {
  throw new ResponseAdmissionFailure(code);
};

/** The accepted binding must come from trusted local policy resolution, not response-supplied metadata. */
export function admitRemoteEstimationResponse(
  response: unknown,
  acceptedInput: AcceptedRemoteBinding,
): Readonly<EstimationEnvelope> {
  return admitExecutionResponse(response, acceptedInput, "organization");
}
function admitExecutionResponse(
  response: unknown,
  acceptedInput: AcceptedRemoteBinding,
  origin: "local" | "organization",
): Readonly<EstimationEnvelope> {
  try {
    const accepted = AcceptedSchema.parse(acceptedInput);
    const serialized =
      typeof response === "string" ? response : JSON.stringify(response);
    if (
      typeof serialized !== "string" ||
      new TextEncoder().encode(serialized).byteLength > 2 * 1024 * 1024
    )
      rejectResponse("response_invalid");
    const parsed = ResponseSchema.parse(
      typeof response === "string" ? JSON.parse(response) : response,
    );
    const envelope = parsed.envelope;
    if (
      envelope.execution_origin !== origin ||
      parsed.output_hash !== payloadHash(envelope) ||
      canonicalJson(parsed.correlation) !== canonicalJson(accepted.correlation)
    )
      rejectResponse("response_mismatch");
    for (const key of [
      "source",
      "input_hash",
      "requested_method",
      "effective_method",
      "selection",
      "auxiliary_method_hashes",
      "view",
      "original_method_hash",
    ] as const) {
      if (canonicalJson(envelope[key]) !== canonicalJson(accepted[key]))
        rejectResponse("response_mismatch");
    }
    if (accepted.input_hash !== calculationInputHash(accepted))
      rejectResponse("response_mismatch");
    if (
      envelope.reasons.includes("original_method_missing") !==
      accepted.original_method_missing
    )
      rejectResponse("response_mismatch");
    if (
      envelope.raw?.engine_id === "original" &&
      !Array.isArray(envelope.raw.result)
    ) {
      const raw = envelope.raw.result;
      if (
        raw.view !== accepted.view ||
        raw.original_method_hash !== accepted.original_method_hash ||
        raw.reasons.includes("original_method_missing") !==
          accepted.original_method_missing
      )
        rejectResponse("response_mismatch");
    }
    return deepFreeze(envelope);
  } catch (error) {
    if (error instanceof ResponseAdmissionFailure) return reject(error.code);
    return reject("response_invalid");
  }
}
function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, rejectPromise) => {
    const abort = () => rejectPromise(new RemoteEstimationFailure("cancelled"));
    if (signal.aborted) {
      promise.catch(() => undefined);
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, rejectPromise)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
function admitLocalResponse(
  envelope: Readonly<EstimationEnvelope>,
  accepted: AcceptedRemoteBinding,
) {
  let hash: string;
  try {
    hash = payloadHash(envelope);
  } catch {
    return reject("response_invalid");
  }
  return admitExecutionResponse(
    {
      schema_version: "1.0.0",
      correlation: accepted.correlation,
      envelope,
      output_hash: hash,
    },
    accepted,
    "local",
  );
}
const retryClock: RemoteRetryClock = {
  sleep(milliseconds, signal) {
    return new Promise<void>((resolve, rejectPromise) => {
      const abort = () => {
        clearTimeout(timer);
        rejectPromise(new RemoteEstimationFailure("cancelled"));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, milliseconds);
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    });
  },
};
function transportFailure(error: unknown): RemoteEstimationFailure {
  if (error instanceof RemoteEstimationFailure) return error;
  if (!(error instanceof RemoteTransportFailure))
    return new RemoteEstimationFailure("transport_failed");
  const issue = error.issue;
  if (issue.kind !== "http") return new RemoteEstimationFailure(issue.kind);
  const codes = {
    401: "session_expired",
    403: "forbidden",
    409: "conflict",
    413: "payload_too_large",
    422: "invalid_input",
    429: "rate_limited",
  } as const;
  const code =
    codes[issue.status as keyof typeof codes] ??
    (issue.status >= 500 ? "server_unavailable" : "transport_failed");
  return new RemoteEstimationFailure(
    code,
    issue.status,
    issue.retryAfterMs ?? null,
  );
}
async function deadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  clock: RemoteRetryClock,
  milliseconds: number,
  outer?: AbortSignal,
): Promise<T> {
  const attempt = new AbortController(),
    timer = new AbortController();
  const abort = () => attempt.abort();
  if (outer?.aborted) attempt.abort();
  else outer?.addEventListener("abort", abort, { once: true });
  try {
    return await Promise.race([
      abortable(
        Promise.resolve().then(() => {
          if (attempt.signal.aborted) return reject("cancelled");
          return work(attempt.signal);
        }),
        attempt.signal,
      ),
      clock.sleep(milliseconds, timer.signal).then(() => {
        throw new RemoteTransportFailure({ kind: "timeout" });
      }),
    ]);
  } finally {
    attempt.abort();
    timer.abort();
    outer?.removeEventListener("abort", abort);
  }
}

/** Future injected transport only. No endpoint, authentication or production caller is activated here. */
export function createRemoteEstimateExecutor(
  configuration: RemoteExecutorConfiguration,
): EstimateExecutor & { readonly executionOrigin: "organization" } {
  const context = deepFreeze(ContextSchema.parse(configuration.context));
  const operation = deepFreeze(
    z
      .strictObject({
        operation_id: z.uuid(),
        generation: SelectionRevisionSchema,
        revision: SelectionRevisionSchema,
      })
      .parse(configuration.operation),
  );
  const definition = deepFreeze(
    EcoLogitsMethodDefinitionSchema.parse(configuration.methods.ecoDefinition),
  );
  const original = deepFreeze(
    EngineMethodIdentitySchema.parse(configuration.methods.original),
  );
  const ecologits = deepFreeze(
    EngineMethodIdentitySchema.parse(configuration.methods.ecologits),
  );
  const expectedMethods = createMethodRegistry(
    configuration.methods.build,
    configuration.methods.mappings,
    configuration.methods.media,
  );
  if (
    canonicalJson(original) !== canonicalJson(expectedMethods.original) ||
    canonicalJson(ecologits) !== canonicalJson(expectedMethods.ecologits) ||
    canonicalJson(definition) !== canonicalJson(expectedMethods.ecoDefinition)
  )
    reject("method_update_invalid");
  const catalogIdentity = deepFreeze(
    EcoLogitsCoreIdentitySchema.parse(configuration.catalog.identity),
  );
  const catalogJson = configuration.catalog.json;
  const transport = configuration.transport,
    isCurrent = configuration.isCurrent;
  const policy = deepFreeze(RetryPolicySchema.parse(configuration.retry ?? {}));
  const clock = configuration.clock ?? retryClock;
  const fallback = configuration.localFallback
    ? {
        method: deepFreeze(
          EngineMethodIdentitySchema.parse(configuration.localFallback.method),
        ),
        origin: configuration.localFallback.executor.executionOrigin,
        estimate: configuration.localFallback.executor.estimate.bind(
          configuration.localFallback.executor,
        ),
      }
    : null;
  const pendingExecutions = new Set<Promise<unknown>>();
  function bounded<T>(work: () => Promise<T>): Promise<T> {
    // Cancellation cannot free a physical slot while an injected executor still has unsettled work.
    if (pendingExecutions.size >= 2)
      return Promise.reject(new RemoteEstimationFailure("busy"));
    const promise = Promise.resolve().then(work);
    pendingExecutions.add(promise);
    promise.then(
      () => pendingExecutions.delete(promise),
      () => pendingExecutions.delete(promise),
    );
    return promise;
  }
  let catalogPromise: Promise<
    Awaited<ReturnType<typeof verifiedCatalog>>
  > | null = null;
  async function verifiedCatalog() {
    if (
      canonicalJson(catalogIdentity) !== canonicalJson(definition.core) ||
      new TextEncoder().encode(catalogJson).byteLength > 2 * 1024 * 1024
    )
      reject("method_update_invalid");
    const bytes = new TextEncoder().encode(catalogJson);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hash = [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    if (hash !== definition.core.catalog_sha256)
      reject("method_update_invalid");
    const core = await import("@footprint/ecologits-core");
    if (
      canonicalJson(core.ECOLOGITS_IDENTITY) !== canonicalJson(definition.core)
    )
      reject("method_update_invalid");
    const parsed = JSON.parse(catalogJson);
    if (
      parsed.schema_version !== definition.core.catalog_schema ||
      parsed.upstream_version !== definition.core.upstream_version ||
      parsed.upstream_commit !== definition.core.requested_git_commit
    )
      reject("method_update_invalid");
    const runtime = core.createCatalogRuntime(parsed);
    const catalog = {
      has: (profile: UpstreamProfileReference) =>
        profile.workload === "text"
          ? runtime.findModel(profile.provider, profile.model_name) !== null
          : runtime.findVideoModel(profile.model_name)?.provider ===
            profile.provider,
    };
    validateProfilePolicy(
      definition.fallback,
      catalog,
      DIRECTLY_IDENTIFIED_PROVIDERS,
    );
    if (
      Object.values(definition.mappings.bindings).some(
        (profile) => !catalog.has(profile),
      )
    )
      reject("method_update_invalid");
    return {
      catalog,
      runtime,
      admitTokenCount: core.admitTokenCount,
      validateLlmInput: core.validateLlmInput,
    };
  }
  return Object.freeze({
    // Trusted composition uses this destination when routing grants; it does not authorize uploads.
    executionOrigin: "organization" as const,
    async estimate(
      observation: NumericObservationInput,
      options: EstimationOptions = {},
    ): Promise<Readonly<EstimationEnvelope>> {
      if (context.mode !== "company") return reject("personal_disallowed");
      options = {
        methodId: options.methodId,
        view: options.view,
        originalMethodHash: options.originalMethodHash,
        originalMethodMissing: options.originalMethodMissing,
        signal: options.signal,
      };
      const correlation = deepFreeze(
        CorrelationSchema.parse({
          organization_key: context.organization_key,
          installation_key: context.installation_key,
          ...operation,
        }),
      );
      const current = () => {
        if (options.signal?.aborted) reject("cancelled");
        if (!isCurrent(correlation)) reject("stale");
      };
      current();
      let input;
      try {
        const allowed =
          observation.family === "live"
            ? [
                "family",
                "request",
                "attempt",
                "canonicalRequestBinding",
                "history",
              ]
            : ["family", "record"];
        if (Object.keys(observation).some((key) => !allowed.includes(key)))
          reject("dependency_missing");
        input = prepareObservation(observation);
      } catch {
        return reject("dependency_missing");
      }
      // A reply that generated only media has no text count but is still estimated.
      if (
        input.executionReason !== null ||
        (input.ineligibleReason !== null &&
          input.textComponents.length === 0 &&
          input.media.length === 0)
      )
        return reject("estimate_unavailable");
      const proposed =
        input.original.family === "live"
          ? input.original.attempt.proposed_method_id
          : input.original.record.proposed_method_id;
      const methodId = options.methodId ?? proposed ?? original.method_id;
      const requested =
        methodId === original.method_id
          ? original
          : methodId === ecologits.method_id
            ? ecologits
            : null;
      if (!requested) return reject("method_unsupported");
      let originalMethodMissing: boolean;
      try {
        originalMethodMissing = admitsMissingOriginalMethod(
          input.original.family,
          proposed,
          options,
        );
      } catch {
        return reject("method_update_invalid");
      }
      let effective = requested;
      let selection: EstimationEnvelope["selection"] = {
        kind: "legacy_reference",
        observed_model_id: input.modelId,
        profile: null,
        reason: null,
        basis: null,
      };
      if (requested.engine_id === "ecologits") {
        let verified;
        try {
          catalogPromise ??= verifiedCatalog();
          verified = await abortable(catalogPromise, options.signal);
        } catch (error) {
          current();
          if (error instanceof RemoteEstimationFailure) throw error;
          return reject("method_update_invalid");
        }
        current();
        const resolution = resolveModelProfile(
          {
            modelId: input.modelId,
            provider: input.provider,
            workload: "text",
          },
          definition.mappings.bindings,
          definition.fallback,
          verified.catalog,
        );
        if (resolution.kind === "original") {
          effective = original;
          selection = {
            kind: "original_fallback",
            observed_model_id: input.modelId,
            profile: null,
            reason: resolution.reason,
            basis: null,
          };
        } else if (resolution.kind === "upstream") {
          selection = {
            kind: resolution.selection,
            observed_model_id: input.modelId,
            profile: resolution.profile,
            reason:
              resolution.selection === "direct_mapping" ? null : "model_proxy",
            basis: resolution.basis,
          };
          if (input.ineligibleReason === null) {
            const count = verified.admitTokenCount(input.output.value);
            if (!count.ok) return reject("numeric_domain_unsupported");
            const resolved = verified.runtime.resolveLlmInput({
              provider: resolution.profile.provider,
              model_name: resolution.profile.model_name,
              output_token_count: count.value,
              request_latency:
                input.timing === null
                  ? null
                  : Number(input.timing.duration_seconds),
            });
            if (
              !("input" in resolved) ||
              !verified.validateLlmInput(resolved.input).ok
            )
              return reject("numeric_domain_unsupported");
          }
        } else return reject("method_unsupported");
      }
      const bindingFields = {
        correlation,
        source: input.source,
        requested_method: requested,
        effective_method: effective,
        selection,
        auxiliary_method_hashes: {
          image_reference: RETIRED_IMAGE_REFERENCE_HASH,
        },
        view: options.view ?? "original",
        original_method_hash: options.originalMethodHash ?? null,
        original_method_missing: originalMethodMissing,
      };
      if (
        bindingFields.view === "recalculated" &&
        bindingFields.original_method_hash === null &&
        !originalMethodMissing
      )
        return reject("method_update_invalid");
      const accepted = deepFreeze(
        AcceptedSchema.parse({
          ...bindingFields,
          input_hash: calculationInputHash(bindingFields),
        }),
      );
      const request = deepFreeze<RemoteEstimateRequest>({
        schema_version: "1.0.0",
        accepted,
        observation: input.original,
      });
      current();
      for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
        let response: unknown;
        try {
          response = await deadline(
            (signal) => {
              current();
              return bounded(() => {
                current();
                return transport(request, { signal });
              });
            },
            clock,
            policy.attemptTimeoutMs,
            options.signal,
          );
        } catch (error) {
          current();
          const failure = transportFailure(error);
          if (failure.code === "offline") {
            if (
              !fallback ||
              fallback.origin !== "local" ||
              canonicalJson(fallback.method) !==
                canonicalJson(accepted.requested_method)
            )
              return reject("local_method_unavailable");
            try {
              const envelope = await deadline(
                (signal) => {
                  current();
                  return bounded(() => {
                    current();
                    return fallback.estimate(input.original, {
                      ...options,
                      methodId: requested.method_id,
                      signal,
                    });
                  });
                },
                clock,
                policy.attemptTimeoutMs,
                options.signal,
              );
              current();
              const admitted = admitLocalResponse(envelope, accepted);
              current();
              return admitted;
            } catch (localError) {
              current();
              if (localError instanceof RemoteEstimationFailure)
                throw localError;
              return reject("local_method_unavailable");
            }
          }
          if (
            !(
              ["timeout", "rate_limited", "server_unavailable"] as string[]
            ).includes(failure.code) ||
            attempt + 1 === policy.maxAttempts
          )
            throw failure;
          // A server's longer delay ends this bounded operation instead of retrying too early.
          if (
            failure.retryAfterMs !== null &&
            failure.retryAfterMs > policy.maxDelayMs
          )
            throw failure;
          const waitMs = Math.max(
            Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt),
            failure.retryAfterMs ?? 0,
          );
          current();
          try {
            await abortable(
              clock.sleep(
                waitMs,
                options.signal ?? new AbortController().signal,
              ),
              options.signal,
            );
          } catch (waitError) {
            current();
            throw transportFailure(waitError);
          }
          current();
          continue;
        }
        // Once a response arrives, admission failures cannot trigger transport recovery.
        current();
        const admitted = admitRemoteEstimationResponse(response, accepted);
        current();
        return admitted;
      }
      return reject("transport_failed");
    },
  });
}
