import {
  resolveApplicationRepository,
  type ApplicationRepository,
  type EstimationInput,
  type RepositorySource,
  type RecordRow,
  type Scope,
} from "@footprint/ledger";
import {
  countsAsRequest,
  generationCovers,
  linkedReplyModel,
  payloadHash,
  type RequestObservation,
  type AttemptObservation,
  type HistoryMessage,
  type EstimationEnvelope,
  historyNumericPayloadHash,
  projectAttemptEvidence,
} from "@footprint/contracts";
import { EstimateDetails } from "./estimate-details";
import { FileTextAccumulator } from "./file-text-summary";
import { sumFixed, type Filters } from "./summary";
import { TokenTotals } from "./token-summary";
import { countedReplyTokens } from "./claude-token-factor";
import {
  aggregateMetricLineage,
  aggregateMetricMetadata,
  estimateIsReferenceOnly,
  estimateMatchesSource,
  estimateMetric,
  estimateRequestedMethodId,
  estimateView,
  groupRange,
  estimateRelease,
  estimateSelection,
  isEstimationEnvelope,
  metricSignature,
  type PresentedEstimate,
  type PresentedMetric,
  type RecordHashes,
  type ReplySelection,
} from "./estimate-presentation";
const names = [
  "energy",
  "carbon",
  "water_direct",
  "water_upstream",
  "water_total",
] as const;
const sum = (a: string, b: string) => sumFixed([a, b]);
/** Distinct selections one summary keeps; a model's replies use one or two in practice. */
const SELECTION_LIMIT = 16;
export type OriginalSource = {
  resultHash: string;
  attemptHash: string;
  request: RequestObservation;
};
export type SavedLiveInput = Extract<EstimationInput, { family: "live" }>;
/**
 * What a scan gives its estimate selection for one attempt. The attempt's saved estimation
 * input is read at most once per scope and shared with the saved-history link the scan
 * needs anyway, and each record is hashed once before the selection. Both were repeated
 * per attempt, which made a long profile's popup take seconds (15 Oct 2026).
 */
export type ScanEstimateContext = {
  savedInput(scope: Scope): Promise<SavedLiveInput | null>;
  /** The saved input with its result for a method, `resultFor(scope, input.source, methodHash)`. */
  savedResult(
    scope: Scope,
    methodHash: string,
  ): Promise<{ input: SavedLiveInput; result: EstimationEnvelope | null } | null>;
  hash(value: object): string;
};
export type ScanOptions = {
  /**
   * The estimate selection never reads the original it is given, as the recalculated view's
   * scanEstimate. In the recalculated view the totals then never use an original either:
   * they keep only recalculated estimates, and the archived original's source only checks
   * original estimates. So the scan skips both original reads, which were a third of an
   * attempt's work. The original view, and any selection that reads the original (another
   * method's recalculation), still reads and checks the archive.
   */
  originalUnused?: boolean;
  /**
   * The method whose results the estimate selection reads (`savedResult`). The scan then
   * reads a page's saved inputs and results, and its parent requests, together, instead of
   * one read each per attempt.
   */
  resultMethodHash?: string;
};
type SavedResult = Awaited<ReturnType<ScanEstimateContext["savedResult"]>>;
export type SelectEstimate = (
  attempt: AttemptObservation,
  original: PresentedEstimate | undefined,
  parent: RequestObservation,
  context: ScanEstimateContext,
) => PresentedEstimate | undefined | Promise<PresentedEstimate | undefined>;
/**
 * Record hashes remembered by object, so a record added to several accumulators is hashed
 * once. A remembered hash is only right while nothing changes the object, so a scan uses one
 * memo up to the estimate selection and a new one after it: the selection is caller code that
 * could change what it receives, and the checks after it must see the objects as they are.
 */
export function scanHashes(): RecordHashes {
  const memo = <T extends object>(hash: (value: T) => string) => {
    const hashes = new WeakMap<T, string>();
    return (value: T) => {
      let result = hashes.get(value);
      if (result === undefined) {
        result = hash(value);
        hashes.set(value, result);
      }
      return result;
    };
  };
  return { payload: memo(payloadHash), history: memo(historyNumericPayloadHash) };
}
/**
 * Receives the same requests and attempts as the totals, after the totals have taken them, so a breakdown
 * (by day, tool, model or chat) is built by the same accumulator code as the totals it must add up to.
 * `reset` runs before every scan pass, because a scan repeats when the ledger changes underneath it.
 */
export type SummaryObserver = {
  reset(): void;
  request(request: RequestObservation): void;
  attempt(
    attempt: AttemptObservation,
    parent: RequestObservation,
    estimate: PresentedEstimate | undefined,
    originalSource?: OriginalSource,
    history?: HistoryMessage,
    hashes?: RecordHashes,
  ): void;
};
async function summaryAuthority(
  ledger: ApplicationRepository,
  namespace: string,
) {
  const routing = await ledger.routingSnapshot();
  const history = await ledger.readOwnershipHistory();
  const scope: Scope | undefined =
    routing.ownership?.scope?.namespace === namespace
      ? routing.ownership.scope
      : routing.personal?.namespace === namespace
        ? { namespace, mode: "personal", era: null }
        : undefined;
  return {
    scope,
    legacy: !history && !routing.credentials && !routing.personal,
    fingerprint: payloadHash(
      JSON.stringify({ routing, history: history ?? null }),
    ),
  };
}
async function canonicalParent(
  ledger: ApplicationRepository,
  namespace: string,
  first: RecordRow | undefined,
): Promise<RequestObservation> {
  let row = first;
  const seen = new Set<string>();
  for (let depth = 0; depth < 64; depth++) {
    if (
      !row ||
      row.namespace !== namespace ||
      row.era !== first?.era ||
      row.record.kind !== "request" ||
      seen.has(row.record.request_id)
    )
      throw new Error("ledger_integrity_failed");
    seen.add(row.record.request_id);
    if (!row.aliasOf) return row.record;
    row = await ledger.getRecord(namespace, "request", row.aliasOf);
  }
  throw new Error("ledger_integrity_failed");
}
type MetricGroup = {
  signature: string;
  value: string;
  known: number;
  scope: string;
  unit: string;
  [key: string]: unknown;
};
// Running endpoint sums of a group; scalars count as both endpoints.
type MetricRange = { ranged: boolean; low: string; high: string };
/**
 * The model a live reply's figures are made for. In the recalculated view a reply linked to
 * its saved copy is estimated for linkedReplyModel, so its token sums and its place in a
 * split by model follow that model: a reply recorded live without a model (a capture that
 * ended unread) counts for the model its saved copy names. Otherwise the live model.
 */
export function replyFiguresModel(
  filters: Filters,
  attempt: AttemptObservation,
  history?: HistoryMessage,
): AttemptObservation["model_id"] {
  return filters.calculationView === "recalculated" && history
    ? linkedReplyModel(attempt, history)
    : attempt.model_id;
}
export class SummaryAccumulator {
  private files = new FileTextAccumulator();
  private requestCount = 0;
  private attemptCount = 0;
  private allAttempts = 0;
  private tools: Record<string, number> = {
    chatgpt: 0,
    claude: 0,
    gemini: 0,
    perplexity: 0,
    notebooklm: 0,
  };
  private models = new Set<string>();
  private outcomes: Record<string, number> = {
    completed: 0,
    cancelled: 0,
    failed: 0,
    interrupted_unconfirmed: 0,
    generating: 0,
  };
  private tokens = new TokenTotals();
  private details = new EstimateDetails();
  private metrics = Object.fromEntries(
    names.map((n) => [n, new Map<string, MetricGroup>()]),
  ) as Record<(typeof names)[number], Map<string, MetricGroup>>;
  private ranges = new Map<MetricGroup, MetricRange>();
  private example: PresentedEstimate | null = null;
  private imageOperations = 0;
  private imageKnown = 0;
  private imageReturned = 0n;
  private imageCompleted = 0;
  private imageUnknown = 0;
  private replySelections = new Map<string, ReplySelection>();
  private stoppedWithoutAnswer = 0;
  constructor(private filters: Filters = {}) {}
  private inRange(at: string) {
    return (
      (!this.filters.start || at >= this.filters.start) &&
      (!this.filters.end || at < this.filters.end)
    );
  }
  request(r: RequestObservation) {
    if (
      !this.inRange(r.dispatched_at) ||
      (this.filters.site && r.site !== this.filters.site) ||
      (this.filters.model && r.model_id !== this.filters.model)
    )
      return;
    // Read aloud adds speech to a reply already counted, so it is not a request (G1).
    if (countsAsRequest(r)) {
      this.requestCount++;
      this.tools[r.site]++;
      // File text is counted per request, as in the server's totals (W9 review).
      this.files.request(r);
    }
    if (r.model_id) this.models.add(r.model_id);
  }
  attempt(
    a: AttemptObservation,
    parent: RequestObservation,
    estimate: PresentedEstimate | undefined,
    originalSource?: OriginalSource,
    history?: HistoryMessage,
    hashes?: RecordHashes,
  ) {
    if (
      !this.inRange(a.started_at) ||
      (this.filters.site && parent.site !== this.filters.site) ||
      (this.filters.model && a.model_id !== this.filters.model)
    )
      return;
    this.allAttempts++;
    if (
      a.execution_evidence !== "none" ||
      (this.filters.calculationView === "recalculated" &&
        history?.text_complete)
    )
      this.attemptCount++;
    if (Object.hasOwn(this.outcomes, a.state)) this.outcomes[a.state]++;
    const projected =
      this.filters.calculationView === "recalculated"
        ? projectAttemptEvidence(a, history)
        : a;
    // Other models' output follows the estimate: a saved reply can describe it more fully.
    const generation =
      this.filters.calculationView === "recalculated" &&
      history &&
      generationCovers(history.generation, a.generation)
        ? history.generation
        : a.generation;
    // Claude text counts carry the Claude token factor; the reply's model is the one its
    // estimate uses (linkedReplyModel), so a linked Perplexity reply counts like its estimate.
    const counted = countedReplyTokens(
      parent.site,
      replyFiguresModel(this.filters, a, history),
      projected.tokens,
      generation,
    );
    this.tokens.add(counted.tokens, counted.components);
    // A reply stopped before any answer was written has an output of 0, which no method can
    // estimate from (estimate_unavailable), so Details says why its figures are missing. A
    // stopped image job that started is still estimated, so only a reply without an
    // electricity figure is listed.
    const stoppedEmpty =
      a.state === "cancelled" && counted.tokens.output_total.value === "0";
    for (const operation of a.media.image_operations) {
      this.imageOperations++;
      if (operation.returned_count !== null) {
        this.imageReturned += BigInt(operation.returned_count);
        this.imageKnown++;
      } else this.imageUnknown++;
      if (operation.state === "completed") this.imageCompleted++;
    }
    if (
      !a.media.image_operations.length &&
      parent.features.some(
        (feature) => feature === "image_generation" || feature === "image_edit",
      )
    )
      this.imageUnknown++;
    if (
      !estimate ||
      estimateIsReferenceOnly(estimate) ||
      estimateView(estimate) !== (this.filters.calculationView ?? "original") ||
      (this.filters.methodId !== undefined &&
        estimateRequestedMethodId(estimate) !== this.filters.methodId) ||
      !(isEstimationEnvelope(estimate) && estimate.view === "original"
        ? originalSource &&
          (hashes?.payload ?? payloadHash)(estimate) ===
            originalSource.resultHash &&
          (hashes?.payload ?? payloadHash)(a) === originalSource.attemptHash &&
          estimateMatchesSource(
            estimate,
            a,
            originalSource.request,
            history,
            hashes,
          )
        : estimateMatchesSource(estimate, a, parent, history, hashes))
    ) {
      if (stoppedEmpty) this.stoppedWithoutAnswer++;
      return;
    }
    const energyKnown = estimateMetric(estimate, "energy").value !== null;
    if (stoppedEmpty && !energyKnown) this.stoppedWithoutAnswer++;
    this.example ??= estimate;
    this.details.add(estimate);
    // The model table names how a model's electricity was estimated. A reply without an
    // electricity figure (one stopped before any answer) adds none, so a model used only for
    // such replies read "Own record" beside Unknown (QA of 19 Oct 2026).
    if (energyKnown) this.addSelection(estimate);
    for (const name of names) {
      const m = estimateMetric(estimate, name);
      if (m.value === null) continue;
      const signature = metricSignature(estimate, name);
      const group = this.metrics[name].get(signature) ?? {
        signature,
        ...aggregateMetricLineage(estimate, name),
        value: "0",
        known: 0,
      };
      group.value = sum(group.value, m.value);
      group.known++;
      if ("value_kind" in group) {
        this.addRange(group, m);
        // A group may add releases of one method family (metricSignature); Details says so.
        const release = estimateRelease(estimate);
        const releases = (group.method_releases as string[] | undefined) ?? [];
        if (!releases.includes(release))
          group.method_releases = [...releases, release].sort();
      }
      this.metrics[name].set(signature, group);
    }
  }
  private addSelection(estimate: PresentedEstimate) {
    const selection = estimateSelection(estimate);
    const key = JSON.stringify([
      selection.kind,
      selection.basis,
      selection.record,
    ]);
    const known = this.replySelections.get(key);
    if (known) known.replies++;
    else if (this.replySelections.size < SELECTION_LIMIT)
      this.replySelections.set(key, { ...selection, replies: 1 });
  }
  /**
   * How the counted replies' models were matched to estimation records, one entry per kind,
   * reason and record. Kept out of result() so the totals' answers stay as they were; the usage
   * breakdown adds it to each model for the dashboard's model table.
   */
  selections(): ReplySelection[] {
    return [...this.replySelections.values()].map((entry) => ({ ...entry }));
  }
  /**
   * Replies stopped before any answer was written that have no electricity figure. Kept out of
   * result() so the dashboard's answers stay as they were; a chat's summary adds it for Details.
   */
  stoppedReplies(): number {
    return this.stoppedWithoutAnswer;
  }
  /** Envelope groups add ranged and scalar members endpoint by endpoint. */
  private addRange(group: MetricGroup, metric: PresentedMetric) {
    const range = this.ranges.get(group) ?? {
      ranged: false,
      low: "0",
      high: "0",
    };
    const added = groupRange([metric], sumFixed);
    range.ranged ||= added.value_kind === "midpoint_sum";
    range.low = sum(range.low, added.scenario_low ?? metric.value!);
    range.high = sum(range.high, added.scenario_high ?? metric.value!);
    this.ranges.set(group, range);
    Object.assign(
      group,
      range.ranged
        ? {
            value_kind: "midpoint_sum",
            scenario_low: range.low,
            scenario_high: range.high,
          }
        : { value_kind: "scalar", scenario_low: null, scenario_high: null },
    );
  }
  result() {
    const metric = (name: (typeof names)[number]) => {
      const groups = [...this.metrics[name].values()];
      const known = groups.reduce((s, g) => s + g.known, 0);
      return {
        value: groups.length === 1 ? groups[0]!.value : null,
        known,
        unknown: this.allAttempts - known,
        unit:
          groups.length === 1
            ? groups[0]!.unit
            : name === "energy"
              ? "kWh"
              : name === "carbon"
                ? "gCO2e"
                : "L",
        groups,
        reason: groups.length > 1 ? "incompatible_scopes" : null,
        ...aggregateMetricMetadata(groups.length === 1 ? groups[0] : undefined),
      };
    };
    return {
      ...this.files.result(),
      requests: this.requestCount,
      attempts: this.attemptCount,
      tokens: this.tokens.result(),
      metrics: {
        energy: metric("energy"),
        carbon: metric("carbon"),
        waterDirect: metric("water_direct"),
        waterUpstream: metric("water_upstream"),
        water: metric("water_total"),
      },
      images: {
        operations: this.imageOperations,
        returned: this.imageKnown ? this.imageReturned.toString() : null,
        unknown: this.imageUnknown,
        completed: this.imageCompleted,
      },
      tools: this.tools,
      models: [...this.models],
      outcomes: this.outcomes,
      estimate: this.example,
      estimation: this.details.result(),
    };
  }
}
export async function scanSummary(
  source: RepositorySource,
  namespace: string,
  filters: Filters = {},
  conversationKey?: string,
  pendingOnly = false,
  threadKey?: string,
  selectEstimate?: SelectEstimate,
  observer?: SummaryObserver,
  options: ScanOptions = {},
) {
  const ledger = resolveApplicationRepository(source);
  if (filters.calculationView === "recalculated" && !selectEstimate)
    throw new Error("method_unsupported");
  for (let retry = 0; retry < 3; retry++) {
    if (await ledger.pendingErasure(namespace))
      throw new Error("deletion_in_progress");
    const before = await ledger.summaryVersion(namespace);
    const authority = await summaryAuthority(ledger, namespace);
    const result = await scanSummaryOnce(
      ledger,
      namespace,
      authority,
      filters,
      conversationKey,
      pendingOnly,
      threadKey,
      selectEstimate,
      observer,
      options,
    );
    const after = await ledger.summaryVersion(namespace);
    const currentAuthority = await summaryAuthority(ledger, namespace);
    if (await ledger.pendingErasure(namespace))
      throw new Error("deletion_in_progress");
    if (
      (before?.version ?? 0) === (after?.version ?? 0) &&
      authority.fingerprint === currentAuthority.fingerprint
    )
      return result;
  }
  throw new Error("aggregate_inconsistent");
}
async function scanSummaryOnce(
  ledger: ApplicationRepository,
  namespace: string,
  authority: Awaited<ReturnType<typeof summaryAuthority>>,
  filters: Filters = {},
  conversationKey?: string,
  pendingOnly = false,
  threadKey?: string,
  selectEstimate?: SelectEstimate,
  observer?: SummaryObserver,
  options: ScanOptions = {},
) {
  const totals = new SummaryAccumulator(filters);
  const readOriginal = !(
    options.originalUnused &&
    selectEstimate &&
    filters.calculationView === "recalculated"
  );
  observer?.reset();
  const scopeKey = (scope: Scope) =>
    `${scope.namespace}\n${scope.mode}\n${scope.era ?? ""}`;
  const consumeAttempt = async (
    row: RecordRow & { record: AttemptObservation },
    parent: RequestObservation,
    /** The page's read of this attempt's saved input and result, for `resultMethodHash`. */
    prefetched?: Promise<SavedResult>,
  ) => {
    const a = row.record;
    // Hashes of the records as read, for the archive checks and the estimate selection.
    const before = scanHashes();
    const hash = before.payload;
    // One read of the attempt's saved input per scope, for the estimate and the history link.
    const saved = new Map<string, Promise<SavedLiveInput | null>>();
    const savedInput = (scope: Scope) => {
      const key = scopeKey(scope);
      let read = saved.get(key);
      if (!read) {
        read = ledger.estimation.liveInput(scope, a.attempt_id);
        saved.set(key, read);
      }
      return read;
    };
    const savedResult: ScanEstimateContext["savedResult"] = async (
      scope,
      methodHash,
    ) => {
      const key = scopeKey(scope);
      if (
        prefetched &&
        !saved.has(key) &&
        methodHash === options.resultMethodHash &&
        authority.scope &&
        key === scopeKey(authority.scope)
      ) {
        saved.set(
          key,
          prefetched.then((value) => value?.input ?? null),
        );
        return prefetched;
      }
      const combined = ledger.estimation.liveResult;
      if (saved.has(key) || !combined) {
        const input = await savedInput(scope);
        return input
          ? {
              input,
              result: await ledger.estimation.resultFor(
                scope,
                input.source,
                methodHash,
              ),
            }
          : null;
      }
      const read = combined.call(
        ledger.estimation,
        scope,
        a.attempt_id,
        methodHash,
      );
      saved.set(
        key,
        read.then((value) => value?.input ?? null),
      );
      return read;
    };
    const current = readOriginal
      ? await ledger.currentEstimate(namespace, a.attempt_id)
      : undefined;
    // Only policy-free legacy fixtures may derive a candidate scope from a row.
    // The ledger revalidates authority and all archived dependencies atomically.
    const scope =
      authority.scope ??
      (authority.legacy
        ? {
            namespace,
            mode: namespace.startsWith("personal:")
              ? ("personal" as const)
              : ("company" as const),
            era: row.era,
          }
        : undefined);
    const archived =
      scope && readOriginal
        ? await ledger.estimation.originalForLive(scope, {
            attemptId: a.attempt_id,
            attemptRevision: a.revision,
            attemptHash: hash(a),
          })
        : null;
    const originalSource = archived
      ? {
          resultHash: hash(archived.result),
          attemptHash: hash(archived.attempt),
          request: archived.request,
        }
      : undefined;
    const legacyOriginal =
      current &&
      !isEstimationEnvelope(current) &&
      estimateView(current) === "original" &&
      estimateMatchesSource(current, a, parent, undefined, before)
        ? current
        : undefined;
    const original = archived?.result ?? legacyOriginal;
    const estimate = selectEstimate
      ? await selectEstimate(a, original, parent, {
          savedInput,
          savedResult,
          hash,
        })
      : original;
    // Counting and filtering use the canonical parent; only the exact archived
    // original may use its immutable source request for metric validation.
    const needsHistory =
      filters.calculationView === "recalculated" ||
      (estimate &&
        isEstimationEnvelope(estimate) &&
        estimate.source.family === "live" &&
        !!estimate.source.history_binding);
    const linked =
      scope && a.provider_attempt_key !== null && needsHistory
        ? await savedInput(scope)
        : null;
    // Fresh hashes after the selection, so an original or record it changed fails the checks
    // (test/summary-original-proof.test.ts).
    const hashes = scanHashes();
    const history =
      linked &&
      hashes.payload(linked.attempt) === hashes.payload(a) &&
      hashes.payload(linked.request) === hashes.payload(parent)
        ? linked.history
        : undefined;
    totals.attempt(a, parent, estimate, originalSource, history, hashes);
    observer?.attempt(a, parent, estimate, originalSource, history, hashes);
  };
  let pendingObservationCount = 0;
  if (conversationKey || threadKey) {
    const consume = async (rows: RecordRow[]) => {
      for (const row of rows) {
        if (row.record.kind !== "request") continue;
        const parent = await canonicalParent(ledger, namespace, row);
        const requestPending =
          pendingOnly && !row.aliasOf
            ? await ledger.pendingRevision(
                namespace,
                "request",
                parent.request_id,
                parent.revision,
              )
            : false;
        if (!row.aliasOf && (!pendingOnly || requestPending))
          totals.request(parent);
        if (requestPending) pendingObservationCount += 1;
        await ledger.scanAttempts(
          namespace,
          async (attempts) => {
            for (const child of attempts) {
              if (child.record.kind !== "attempt" || child.aliasOf) continue;
              const a = child.record;
              const attemptPending = pendingOnly
                ? await ledger.pendingRevision(
                    namespace,
                    "attempt",
                    a.attempt_id,
                    a.revision,
                  )
                : false;
              if (pendingOnly && !attemptPending) continue;
              if (attemptPending) pendingObservationCount += 1;
              await consumeAttempt({ ...child, record: a }, parent);
            }
          },
          { requestId: row.record.request_id },
        );
      }
    };
    await ledger.scanRequests(
      namespace,
      consume,
      threadKey ? { threadKey } : { conversationKey },
    );
    // Only a chat's summary says which of its replies were stopped without an answer (Details).
    return {
      ...totals.result(),
      pendingObservationCount,
      stoppedWithoutAnswer: totals.stoppedReplies(),
    };
  }
  // A period's scan reads only that period's rows through the time indexes, in the same key
  // order; rows outside it would add nothing (the checks below and in the totals stay).
  const between =
    filters.start || filters.end
      ? {
          ...(filters.start ? { start: filters.start } : {}),
          ...(filters.end ? { end: filters.end } : {}),
        }
      : undefined;
  await ledger.scanRequests(
    namespace,
    (rows) => {
      for (const row of rows)
        if (
          !row.aliasOf &&
          row.record.kind === "request" &&
          (!conversationKey || row.record.conversation_key === conversationKey)
        ) {
          totals.request(row.record);
          observer?.request(row.record);
        }
    },
    between && { between },
  );
  await ledger.scanAttempts(
    namespace,
    async (rows) => {
      const counted = rows.filter(
        (row): row is RecordRow & { record: AttemptObservation } =>
          row.record.kind === "attempt" &&
          !row.aliasOf &&
          !(filters.start && row.record.started_at < filters.start) &&
          !(filters.end && row.record.started_at >= filters.end),
      );
      // One read for the page's parent requests and one for its saved inputs and results,
      // instead of one each per attempt. Each attempt still checks what it reads as before.
      const parentIds = [...new Set(counted.map((row) => row.record.request_id))];
      const parents = new Map(
        ledger.getRecords && parentIds.length
          ? (
              await ledger.getRecords(namespace, "request", parentIds)
            ).map((parent, index) => [parentIds[index]!, parent] as const)
          : [],
      );
      const results =
        selectEstimate &&
        options.resultMethodHash &&
        authority.scope &&
        ledger.estimation.liveResults &&
        counted.length
          ? ledger.estimation.liveResults(
              authority.scope,
              counted.map((row) => row.record.attempt_id),
              options.resultMethodHash,
            )
          : null;
      // A failed page read surfaces where the attempt reads it, as a single read did.
      results?.catch(() => {});
      for (const [index, row] of counted.entries()) {
        const a = row.record;
        const parent = await canonicalParent(
          ledger,
          namespace,
          parents.has(a.request_id)
            ? parents.get(a.request_id)
            : await ledger.getRecord(namespace, "request", a.request_id),
        );
        if (conversationKey && parent.conversation_key !== conversationKey)
          continue;
        const prefetched = results?.then((page) => page[index] ?? null);
        prefetched?.catch(() => {});
        await consumeAttempt(row, parent, prefetched);
      }
    },
    between && { between },
  );
  return { ...totals.result(), pendingObservationCount };
}
