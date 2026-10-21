import {
  ENVELOPE_SCHEMA_VERSION,
  EstimationEnvelopeSchema,
  payloadHash,
  type EstimationEnvelope,
  type EstimateReason,
  type EngineMethodIdentity,
  type ComponentResult,
} from "@footprint/contracts";
import { deepFreeze } from "../bundle";
import { admitsMissingOriginalMethod } from "../lineage";
import { RETIRED_IMAGE_REFERENCE_HASH } from "../original";
import {
  resolveModelProfile,
  validateProfilePolicy,
  type ProfileCatalog,
} from "../selection";
import { DIRECTLY_IDENTIFIED_PROVIDERS, type MethodRegistry } from "./methods";
import {
  estimationInputHash,
  prepareObservation,
  type NumericObservationInput,
} from "./inputs";
import { calculateOriginal } from "./original";
import { textComponent } from "./components";
import {
  calculateEcoLogits,
  emptyEcoComputation,
  type EcoLogitsRuntime,
} from "./ecologits";

export interface EstimationOptions {
  methodId?: string;
  view?: "original" | "recalculated";
  originalMethodHash?: string;
  originalMethodMissing?: boolean;
  signal?: AbortSignal;
}
export interface EstimateExecutor {
  readonly executionOrigin?: "local" | "organization";
  estimate(
    input: NumericObservationInput,
    options?: EstimationOptions,
  ): Promise<Readonly<EstimationEnvelope>>;
  /** Only a local executor can recalculate one component with another record (LocalEstimateExecutor). */
  alternativeText?(
    component: Pick<ComponentResult, "component_id" | "role" | "inputs" | "metrics">,
    profile: { provider: string; model_name: string },
  ): Promise<ComponentResult>;
}
export class EstimationFailure extends Error {
  constructor(
    readonly code:
      | "method_unsupported"
      | "method_update_invalid"
      | "cancelled"
      | "dependency_missing",
  ) {
    super(code);
    this.name = "EstimationFailure";
  }
}

/** No browser, storage, authentication or raw text enters the local execution boundary. */
export class LocalEstimateExecutor implements EstimateExecutor {
  readonly executionOrigin = "local" as const;
  private runtime: Promise<EcoLogitsRuntime> | null = null;
  constructor(
    readonly methods: MethodRegistry,
    private readonly loadCore: () => Promise<EcoLogitsRuntime> = () =>
      import("@footprint/ecologits-core"),
  ) {}
  private async core(): Promise<EcoLogitsRuntime> {
    this.runtime ??= this.loadCore()
      .then((core) => {
        if (
          payloadHash(core.ECOLOGITS_IDENTITY) !==
            payloadHash(this.methods.ecoDefinition.core) ||
          this.methods.ecoDefinition.water_total_policy !== "upstream-wcf-1"
        ) {
          throw new EstimationFailure("method_update_invalid");
        }
        const catalog: ProfileCatalog = {
          has: (profile) =>
            profile.workload === "text"
              ? core.findModel(profile.provider, profile.model_name) !== null
              : core.findVideoModel(profile.model_name)?.provider ===
                profile.provider,
        };
        // Media coefficients only bind to records the catalog really has.
        if (
          !catalog.has(this.methods.media.speech.profile) ||
          Object.keys(this.methods.media.video.model_defaults).some(
            (name) => core.findVideoModel(name) === null,
          )
        ) {
          throw new EstimationFailure("method_update_invalid");
        }
        validateProfilePolicy(
          this.methods.ecoDefinition.fallback,
          catalog,
          DIRECTLY_IDENTIFIED_PROVIDERS,
        );
        if (
          Object.values(this.methods.mappings.bindings).some(
            (profile) => !catalog.has(profile),
          )
        ) {
          throw new EstimationFailure("method_update_invalid");
        }
        return core;
      })
      .catch((error: unknown) => {
        this.runtime = null;
        throw error;
      });
    return this.runtime;
  }

  async estimate(
    observation: NumericObservationInput,
    options: EstimationOptions = {},
  ): Promise<Readonly<EstimationEnvelope>> {
    const current = () => {
      if (options.signal?.aborted) throw new EstimationFailure("cancelled");
    };
    current();
    const input = prepareObservation(observation);
    const proposed =
      input.original.family === "live"
        ? input.original.attempt.proposed_method_id
        : input.original.record.proposed_method_id;
    const requested = this.methods.get(
      options.methodId ?? proposed ?? this.methods.original.method_id,
    );
    if (!requested) throw new EstimationFailure("method_unsupported");
    const view = options.view ?? "original";
    const originalMethodHash = options.originalMethodHash ?? null;
    let originalMethodMissing: boolean;
    try {
      originalMethodMissing = admitsMissingOriginalMethod(
        input.original.family,
        proposed,
        {
          view,
          originalMethodHash: options.originalMethodHash,
          originalMethodMissing: options.originalMethodMissing,
        },
      );
    } catch {
      throw new EstimationFailure("method_update_invalid");
    }
    if (
      view === "recalculated" &&
      originalMethodHash === null &&
      !originalMethodMissing
    )
      throw new EstimationFailure("method_update_invalid");
    let effective: Readonly<EngineMethodIdentity> = requested;
    let selection: EstimationEnvelope["selection"] = {
      kind: "legacy_reference",
      observed_model_id: input.modelId,
      profile: null,
      reason: null,
      basis: null,
    };
    let core: EcoLogitsRuntime | null = null;
    let resolutionFailure: EstimateReason | null = null;
    if (requested.engine_id === "ecologits") {
      try {
        core = await this.core();
        current();
        const resolution = resolveModelProfile(
          {
            modelId: input.modelId,
            provider: input.provider,
            workload: "text",
          },
          this.methods.mappings.bindings,
          this.methods.ecoDefinition.fallback,
          {
            has: (profile) =>
              profile.workload === "text" &&
              core!.findModel(profile.provider, profile.model_name) !== null,
          },
        );
        if (resolution.kind === "original") {
          effective = this.methods.original;
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
        } else {
          // The reply's text cannot be estimated, but its other components still can.
          selection = {
            kind: "unavailable",
            observed_model_id: input.modelId,
            profile: null,
            reason: resolution.reason,
            basis: null,
          };
        }
      } catch (error) {
        current();
        resolutionFailure =
          error instanceof EstimationFailure
            ? error.code
            : "method_update_invalid";
        selection = {
          kind: "unavailable",
          observed_model_id: input.modelId,
          profile: null,
          reason: resolutionFailure,
          basis: null,
        };
      }
    }
    current();
    const contextualReasons: EstimateReason[] = [
      ...new Set<EstimateReason>([
        ...input.coverageReasons,
        "unvalidated_reference",
        "input_length_not_modelled",
        "hidden_reasoning_unobserved",
        ...(requested.engine_id === "ecologits"
          ? ["provider_environment_assumed" as const]
          : []),
        ...(input.original.family === "history"
          ? ["history_only" as const]
          : []),
        ...(selection.kind === "original_fallback"
          ? ["original_engine_fallback" as const]
          : []),
        ...(originalMethodMissing ? ["original_method_missing" as const] : []),
      ]),
    ];
    let computed = emptyEcoComputation(input, contextualReasons);
    if (resolutionFailure !== null) {
      computed = emptyEcoComputation(input, [
        ...contextualReasons,
        resolutionFailure,
      ]);
    } else if (effective.engine_id === "original") {
      computed = calculateOriginal(input, {
        view,
        originalMethodHash,
        originalMethodMissing,
      });
      computed.reasons = [
        ...new Set([...computed.reasons, ...contextualReasons]),
      ];
    } else if (core !== null) {
      try {
        computed = calculateEcoLogits(
          input,
          selection,
          this.methods,
          core,
          contextualReasons,
        );
      } catch {
        computed = emptyEcoComputation(input, [
          ...contextualReasons,
          "source_error",
        ]);
      }
    }
    current();
    return deepFreeze(
      EstimationEnvelopeSchema.parse({
        schema_version: ENVELOPE_SCHEMA_VERSION,
        source: input.source,
        input_hash: estimationInputHash(input, requested, effective, selection),
        auxiliary_method_hashes: {
          image_reference: RETIRED_IMAGE_REFERENCE_HASH,
        },
        requested_method: requested,
        effective_method: effective,
        execution_origin: "local",
        view,
        original_method_hash: originalMethodHash,
        selection,
        ...computed,
        image_references: [],
        status: Object.values(computed.metrics).some(
          (metric) => metric.value !== null,
        )
          ? "estimated"
          : "unavailable",
        validation_state: "unvalidated_reference",
      }),
    );
  }

  /**
   * One reply's main text again with another EcoLogits text record, the same output tokens and the
   * record's own modelled latency. Read-only, for the Details comparison with a smaller model: the
   * result is never stored, and both sides of such a comparison should come from this method so
   * they share every assumption except the record.
   */
  async alternativeText(
    component: Pick<ComponentResult, "component_id" | "role" | "inputs" | "metrics">,
    profile: { provider: string; model_name: string },
  ): Promise<ComponentResult> {
    const core = await this.core();
    return textComponent(core, this.methods, {
      componentId: component.component_id,
      role: component.role,
      selection: {
        kind: "model_override",
        observed_model_id: null,
        profile: { ...profile, workload: "text" },
        reason: "model_proxy",
        basis: "nearest_record",
      },
      output: {
        value: component.inputs.output_tokens,
        evidence: "heuristic_estimate",
        scope: "observed_text",
        completeness: "complete_for_scope",
        profile_id: null,
        reason: null,
      },
      timing: null,
      scope: component.metrics.energy.scope,
      reasons: [],
    });
  }
}
