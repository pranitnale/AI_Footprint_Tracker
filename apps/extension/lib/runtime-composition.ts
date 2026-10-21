import type { ApplicationRepository, Scope } from "@footprint/ledger";
import {
  EstimationFailure,
  type EstimateExecutor,
  type MethodRegistry,
} from "@footprint/estimator";
import type { CompanySession } from "./company";
import { CompanyClient } from "./company";
import type { OrganizationFeatures } from "./organization-terms";
import { MethodService } from "./method-service";
import { EngineService } from "./estimation/service";
import { createLocalExecutor, packagedMethods } from "./estimation/config";
import { HistoryService } from "./history-service";
import { RecordedThreads, type RecordedThreadMatch } from "./recorded-threads";
import type {
  CountRequest,
  CountResponse,
  CountingRuntime,
} from "@footprint/tokenizers/metadata";
import type { scanSummary } from "./summary-scan";
import { MonthlySummaryService } from "./monthly-summary";

export interface RuntimeDependencies {
  counting?: CountingRuntime;
  count(job: CountRequest, signal?: AbortSignal): Promise<CountResponse>;
  hasConsent(origin: string): Promise<boolean>;
  hasSiteConsent?(origin: string): Promise<boolean>;
  transport?: typeof fetch;
  organization?: CompanySession;
  estimation?: { methods: MethodRegistry; executor: EstimateExecutor };
}

export interface RuntimeCallbacks {
  selectedServerSummary(query: string): Promise<Record<string, unknown>>;
  currentScope(): Promise<Scope>;
  estimateCanonical(scope: Scope, attemptId: string): Promise<void>;
  promoteRecordedCapture(
    match: RecordedThreadMatch,
    current: () => void,
  ): Promise<void>;
  scanSelected(
    scope: Scope,
    threadKey: string,
    pendingOnly: boolean,
  ): ReturnType<typeof scanSummary>;
  /** Saved rows of a conversation were committed. */
  historyCommitted?(scope: Scope, conversationKey: string): void;
  /**
   * Whether the person agreed to tracking (lib/tracking-consent.ts). History imports and
   * recorded threads take nothing before it; absent, they take everything as before.
   */
  trackingAllowed?(): Promise<boolean>;
  /**
   * Whether the organization agreement covers the server's operator switches
   * (lib/organization-terms.ts); the organization client holds sharing while it does not.
   */
  organizationAgreed?(
    origin: string,
    features: OrganizationFeatures,
  ): Promise<boolean>;
  /** Keeps the Connect dialog's organization agreement once its connection is made. */
  connectionAgreed?(version: string, origin: string): Promise<void>;
}

function localApplicationExecutor(
  executor: EstimateExecutor,
): EstimateExecutor {
  // Every current caller has local authority only, including direct dashboard and
  // history estimates. Dependency injection does not grant remote capability.
  return Object.freeze({
    get executionOrigin() {
      return executor.executionOrigin;
    },
    async estimate(input, options) {
      if (executor.executionOrigin !== "local")
        throw new EstimationFailure("method_update_invalid");
      const result = await executor.estimate(input, options);
      if (result.execution_origin !== "local")
        throw new EstimationFailure("method_update_invalid");
      return result;
    },
    // Read-only and local: the Details comparison with a smaller model.
    ...(executor.alternativeText
      ? {
          async alternativeText(
            component: Parameters<NonNullable<EstimateExecutor["alternativeText"]>>[0],
            profile: Parameters<NonNullable<EstimateExecutor["alternativeText"]>>[1],
          ) {
            if (executor.executionOrigin !== "local")
              throw new EstimationFailure("method_update_invalid");
            return executor.alternativeText!(component, profile);
          },
        }
      : {}),
  } satisfies EstimateExecutor);
}

/** The only place that chooses concrete application services. Callbacks run after construction. */
export function composeRuntime(
  ledger: ApplicationRepository,
  dependencies: RuntimeDependencies,
  callbacks: RuntimeCallbacks,
) {
  const company =
    dependencies.organization ??
    new CompanyClient(
      ledger,
      dependencies.transport ?? fetch,
      dependencies.hasConsent,
    );
  const methods = new MethodService(ledger, company, callbacks.currentScope);
  const engines = new EngineService(
    ledger.estimation,
    dependencies.estimation?.methods ?? packagedMethods,
    localApplicationExecutor(
      dependencies.estimation?.executor ?? createLocalExecutor(),
    ),
    () => methods.authority(),
    (scope, request) => company.estimationSelection(scope, request),
  );
  company.canonicalEstimation = (scope, attempt) =>
    callbacks.estimateCanonical(scope, attempt.attempt_id);
  company.methodMaintenance = () => methods.refresh().then(() => {});
  const history = new HistoryService(
    ledger,
    company,
    callbacks.currentScope,
    dependencies.count,
    dependencies.hasSiteConsent ?? (async () => true),
    {
      admission: () => engines.admission(),
      estimate: (input, options) => engines.executor.estimate(input, options),
      original: (input, hash) => engines.original(input, hash),
      view: (scope) => engines.view(scope),
      maintainLocal: () => engines.maintainLocal(),
    },
    dependencies.counting,
    (scope, conversationKey) =>
      callbacks.historyCommitted?.(scope, conversationKey),
    callbacks.trackingAllowed,
  );
  company.historyMaintenance = () => history.sync();
  company.trackingAllowed = callbacks.trackingAllowed;
  company.organizationAgreed = callbacks.organizationAgreed;
  company.connectionAgreed = callbacks.connectionAgreed;
  company.estimationMaintenance = async () => {
    await engines.maintainLocal();
    await engines.maintainOrganization();
  };
  const threads = new RecordedThreads(
    ledger,
    company,
    callbacks.currentScope,
    callbacks.promoteRecordedCapture,
    callbacks.scanSelected,
    (scope) => engines.view(scope),
    callbacks.trackingAllowed,
  );
  const monthly = new MonthlySummaryService(
    ledger,
    company,
    engines,
    () => methods.authority(),
    callbacks.selectedServerSummary,
  );
  return { company, methods, engines, history, threads, monthly };
}
