import {
  compareHistoricalInstants,
  HistoryPageSchema,
  HistorySummarySchema,
  HistoryResourcesSchema,
  EngineMethodIdentitySchema,
  EstimationEnvelopeSchema,
  HistoryMessageSchema,
  historyNumericPayloadHash,
  mergeHistoryEvidence,
  HISTORY_SCHEMA_VERSION,
  composeOutputTotal,
  emptyGeneration,
  historyPromptParts,
  payloadHash,
  providerMeasurement,
  regeneratedHistoryReplies,
  type HistoryMessage,
  type HistoryPage,
  type HistoryReceipt,
  type HistoryView,
  type HistorySummary,
  type EngineMethodIdentity,
  type EstimationEnvelope,
  type HistoryCountBasis,
  type ReasonCode,
  canonicalJson,
} from "@footprint/contracts";
import {
  historyAuthority,
  resolveApplicationRepository,
  type ApplicationRepository,
  type CoworkAdvance,
  type RepositorySource,
  type Scope,
  type HistoryRow,
  type LiveReplyContent,
} from "@footprint/ledger";
import {
  HistoryAccumulator,
  emptyHistorySummary,
  estimateHistoricalText,
  BASELINE_METHOD_ID,
  BASELINE_METHOD_HASH,
  historicalResources,
  type EstimateExecutor,
  type NumericObservationInput,
} from "@footprint/estimator";
import {
  keepUnknownModelLabels,
  resolveModelLabel,
  unknownModelLabel,
} from "./models";
import { historyGeneration, historyReplyParts } from "./reply-output";
import { uploadTotal, uploadedImages } from "./input-images";
import {
  isCoworkSessionId,
  isDisplayBinding,
  parseConversationRoute,
  siteForHost,
  type DisplayBinding,
} from "@footprint/capture-core";
import {
  coworkCheckpointAfter,
  coworkCounted,
  coworkTurns,
} from "./cowork-turns";
import {
  HISTORY_REPLY_PARTS,
  validateHistoryCapture,
  notebooklmRows,
  validStudioPairs,
  countHistoryPage,
  computerFilesOverLimit,
  sharedCountLimit,
  type HistoryCaptureMessage,
  type CountedHistoryMessage,
  type CountedHistoryPage,
  type ReusedHistoryCount,
  type SavedComputerFile,
} from "./history-capture";
import {
  validateClaudeStreamCapture,
  type ClaudeStreamCapture,
} from "./claude-history-message";
import {
  validateProviderStreamCapture,
  type ProviderStreamCapture,
} from "./provider-history-message";
import {
  CLAUDE_HISTORY_ROOT,
  claudePromptOf,
  type ClaudeHistoryRow,
  type HistoryTextPage,
} from "@footprint/adapters";
import { HistoryAdmission } from "./history-admission";
import { solveHealth, type HealthSuccess } from "./health";
import { createIdentityKeyer, ownershipAt, type Ownership } from "./ownership";
import {
  companyKeySecret,
  companyKeyer,
  savedCompanyId,
} from "./company-identity";
import { isNetworkFailure, type CompanySession } from "./company";
import type { Filters } from "./summary";
import type { RouteGuard } from "./route-authority";
import {
  profileFor,
  snapshotCountingRuntime,
  type CountingRuntime,
} from "@footprint/tokenizers/metadata";
import { PACKAGED_COUNTING_RUNTIME } from "./counting-config";
import { PACKAGED_CLAUDE_TOKEN_FACTOR } from "./claude-token-factor";

/**
 * Part of every saved count basis. Change it when countHistoryPage measures text
 * differently, so saved counts are recounted once instead of reused.
 */
const COUNT_BASIS_RULES = "history-count-2";
type Sender = {
  tab?: { id?: number };
  frameId?: number;
  documentId?: string;
  url?: string;
};
type PendingHistory = {
  ownership: Ownership;
  identity: ReturnType<typeof createIdentityKeyer>;
  authority: string;
  erasureVersion: number;
  origin: string;
  conversation: string;
  observedAt: string;
  method: EngineMethodIdentity | null;
  documentId?: string;
  streamRows: Map<
    string,
    {
      row: ClaudeHistoryRow;
      counted: CountedHistoryMessage;
      basis: HistoryCountBasis | null;
    }
  >;
  providerRows: Map<
    string,
    {
      counted: CountedHistoryMessage;
      requestRef: string | null;
      parentRef: string | null;
      basis: HistoryCountBasis | null;
    }
  >;
};
const knownMeasurement = (tokens: {
  value: string | null;
  completeness: string;
}) => tokens.value !== null && tokens.completeness === "complete_for_scope";
/** Only known counts of every counted text are worth reusing. */
const knownCountBasis = (
  basis: Pick<HistoryCountBasis, "tokens" | "inlineFileComponents"> & {
    partTokens: HistoryCountBasis["partTokens"];
    componentTokens: ReadonlyArray<HistoryCountBasis["tokens"] | null>;
  },
) =>
  knownMeasurement(basis.tokens) &&
  Object.values(basis.partTokens).every(
    (tokens) => tokens !== undefined && knownMeasurement(tokens),
  ) &&
  basis.componentTokens.every(
    (tokens) => tokens === null || knownMeasurement(tokens),
  ) &&
  (basis.inlineFileComponents ?? []).every((file) =>
    knownMeasurement(file.tokens),
  );
/** Lengths of a reply's other text parts, keyed like the basis. */
function partUnits(source: HistoryTextPage["messages"][number]) {
  const units: HistoryCountBasis["partUnits"] = {};
  for (const [key, , part] of HISTORY_REPLY_PARTS) {
    const text = source[key];
    if (typeof text === "string") units[part] = text.length;
  }
  return units;
}
/** A batch's Computer files: keyed hashes by raw id, and each message's saved counts. */
type SavedComputerFiles = {
  keys: Map<string, string>;
  saved: Array<Map<string, SavedComputerFile> | undefined>;
};
/**
 * Whether a reply's saved count holds exactly its Computer text files, each counted before
 * as the read says (none downloaded or left unread now), so the whole count is reused.
 */
function sameComputerFiles(
  source: HistoryTextPage["messages"][number],
  basis: HistoryCountBasis,
  keys: ReadonlyMap<string, string> | undefined,
): boolean {
  const files = (source.computerFiles ?? []).filter(
    (file) => file.kind === "text",
  );
  const saved = basis.computerFiles ?? {};
  if (files.length !== Object.keys(saved).length) return false;
  // A file whose stated size is now past the limit is counted again, so it leaves the count.
  const over = computerFilesOverLimit(source.computerFiles);
  return files.every((file) => {
    if (over.has(file.id)) return false;
    const key = keys?.get(file.id);
    return (
      file.text === undefined &&
      (file.state === "content" || file.state === "size") &&
      !!key &&
      saved[key]?.basis === file.state
    );
  });
}
/** Lengths of other-model text; null where the provider reports the count. */
const componentUnits = (source: HistoryTextPage["messages"][number]) =>
  (source.components ?? []).map((component) =>
    component.text === null ? null : component.text.length,
  );
export interface HistoryEstimationHooks {
  admission(): Promise<Readonly<EngineMethodIdentity>>;
  estimate: EstimateExecutor["estimate"];
  maintainLocal(): Promise<void>;
  view?(scope: Scope): Promise<{
    view: "original" | "recalculated";
    method: Readonly<EngineMethodIdentity> | null;
    pending: boolean;
    revision: number | null;
    token: string;
    guard: { authorityScope: Scope; localSelectionToken: string };
    current(): Promise<void>;
  }>;
  original?(
    input: NumericObservationInput,
    pinnedHash?: string,
  ): Promise<{
    result: Readonly<EstimationEnvelope> | null;
    reason: ReasonCode | null;
  }>;
}
type HistoryCalculationView = {
  original: boolean;
  ready: boolean;
  methodId: string | null;
  methodHash: string | null;
  token: string;
  guard?: { authorityScope: Scope; localSelectionToken: string };
  current?: () => Promise<void>;
};
/**
 * Receives every saved-history row the local summary adds, with the same record and options, so a
 * breakdown by day, tool, model or chat uses the history accumulator exactly as the totals do.
 * `fail` marks the breakdown unavailable whenever the totals return unavailable.
 */
export type HistoryRouter = {
  reset(): void;
  fail(): void;
  add(
    source: HistoryMessage,
    record: HistoryMessage,
    options: Parameters<HistoryAccumulator["add"]>[1],
  ): void;
};
export class HistoryService {
  private pending = new Map<string, PendingHistory>();
  /** Cowork imports per session, one at a time: each result's counts depend on the last. */
  private coworkQueues = new Map<string, Promise<void>>();
  private admission = new HistoryAdmission((lease) =>
    this.pending.delete(lease.key),
  );
  private generation = 0;
  private syncFlight: Promise<void> | null = null;
  private syncDirty = false;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private ledger: ApplicationRepository;
  private readonly counting: CountingRuntime;
  constructor(
    source: RepositorySource,
    private company: CompanySession,
    private currentScope: () => Promise<Scope>,
    private count: Parameters<typeof countHistoryPage>[1],
    private consent: (origin: string) => Promise<boolean>,
    // Production supplies the common engine. Omission preserves the original standalone compatibility API.
    private estimation?: HistoryEstimationHooks,
    counting: CountingRuntime = PACKAGED_COUNTING_RUNTIME,
    /**
     * The saved rows of a conversation were committed, so a reply the tab shows can have
     * gained output it did not stream (images, research reports) and is shown again.
     */
    private committed?: (scope: Scope, conversationKey: string) => void,
    /**
     * Whether the person agreed to tracking (lib/tracking-consent.ts). Before that no import
     * starts, as while tracking is paused; absent, every import may start.
     */
    private trackingAllowed?: () => Promise<boolean>,
  ) {
    this.ledger = resolveApplicationRepository(source);
    this.count = sharedCountLimit(count);
    this.counting = snapshotCountingRuntime(counting);
    this.ledger.onRoutingChange(() => this.invalidate());
  }
  invalidate(tabId?: number, documentNonce?: string) {
    if (tabId === undefined) {
      if (this.syncTimer) clearTimeout(this.syncTimer);
      this.syncTimer = null;
      this.syncDirty = false;
      this.generation++;
      this.admission.invalidateAll();
      this.pending.clear();
    } else this.admission.invalidate(tabId, documentNonce);
  }
  receive(
    message: HistoryCaptureMessage,
    binding: DisplayBinding,
    sender: Sender,
    routeGuard?: RouteGuard,
  ) {
    const url = new URL(sender.url ?? "invalid:");
    if (
      sender.frameId !== 0 ||
      sender.tab?.id === undefined ||
      !isDisplayBinding(binding, null) ||
      !validateHistoryCapture(message, url.hostname) ||
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      siteForHost(url.hostname) !== message.site ||
      parseConversationRoute(message.site, url.pathname)?.conversationId !==
        message.conversationId
    )
      return Promise.reject(new Error("payload_rejected"));
    message = structuredClone(message);
    binding = { ...binding };
    sender = {
      tab: { id: sender.tab.id },
      frameId: sender.frameId,
      documentId: sender.documentId,
      url: sender.url,
    };
    const lease = this.admission.admit(
      message.event,
      message.id,
      binding,
      sender.tab!.id!,
      Date.parse(message.observedAt),
    );
    if (!lease) return Promise.resolve({ accepted: false });
    const generation = this.generation;
    const current = () => {
      if (routeGuard?.checkActivity) routeGuard.checkActivity();
      else routeGuard?.check();
      this.admission.check(lease);
      if (generation !== this.generation) throw new Error("policy_unavailable");
      return true;
    };
    const commitCurrent = () => {
      routeGuard?.check();
      return current();
    };
    return this.admission.run(lease, message.event, async () => {
      if (!(await this.consent(url.origin)))
        throw new Error("capture_hook_missing");
      current();
      if (message.event === "start") {
        if (this.trackingAllowed && !(await this.trackingAllowed()))
          throw new Error("policy_unavailable");
        const eras = await this.ledger.readOwnershipHistory();
        const ownership = ownershipAt(eras!, Date.parse(message.observedAt));
        const scope = await this.currentScope();
        const snapshot = await this.ledger.publicationSnapshot(scope.namespace);
        if (
          snapshot.erasing ||
          snapshot.trackingPaused ||
          scope.namespace !== ownership.scope.namespace ||
          scope.era !== ownership.scope.era
        )
          throw new Error("policy_unavailable");
        current();
        const method = this.estimation
          ? EngineMethodIdentitySchema.parse(await this.estimation.admission())
          : null;
        current();
        await routeGuard?.verify();
        current();
        this.pending.set(lease.key, {
          ownership,
          identity: createIdentityKeyer(ownership.secret),
          authority: historyAuthority(snapshot),
          erasureVersion: snapshot.erasureVersion,
          origin: url.origin,
          conversation: message.conversationId,
          observedAt: message.observedAt,
          method,
          documentId: sender.documentId,
          streamRows: new Map(),
          providerRows: new Map(),
        });
        return { accepted: true };
      }
      if (message.page?.status === "unsupported")
        throw new Error("protocol_unsupported");
      const start = this.pending.get(lease.key);
      this.pending.delete(lease.key);
      if (
        !start ||
        start.observedAt !== message.observedAt ||
        start.conversation !== message.conversationId ||
        start.documentId !== sender.documentId ||
        start.origin !== url.origin
      )
        throw new Error("payload_rejected");
      if (
        message.site === "claude" &&
        isCoworkSessionId(message.conversationId)
      ) {
        await this.receiveCowork(
          message,
          start,
          url,
          routeGuard,
          current,
          commitCurrent,
        );
        if (this.estimation) await this.estimation.maintainLocal();
        if (start.ownership.scope.mode === "company") this.scheduleSync();
        return { accepted: true };
      }
      for (
        let offset = 0;
        offset < Math.max(1, message.page!.messages.length);
        offset += 100
      ) {
        const counted = await countHistoryPage(message.page!, this.count, {
          counting: this.counting,
          validNow: current,
          offset,
          limit: 100,
        });
        current();
        await this.commitCountedBatch(
          message,
          counted,
          message.page!.messages.length,
          offset,
          message.page!.messages.filter(
            (m) => m.sourceId === counted.selectedLeafId,
          ).length === 1
            ? message.page!.messages.find(
                (m) => m.sourceId === counted.selectedLeafId,
              )!.role
            : null,
          start,
          url,
          routeGuard,
          current,
          commitCurrent,
          { deferCoverage: offset + 100 < message.page!.messages.length },
        );
      }
      if (this.estimation) await this.estimation.maintainLocal();
      if (start.ownership.scope.mode === "company") this.scheduleSync();
      return { accepted: true };
    });
  }
  receiveStream(
    message: ClaudeStreamCapture | ProviderStreamCapture,
    binding: DisplayBinding,
    sender: Sender,
    routeGuard?: RouteGuard,
  ) {
    const url = new URL(sender.url ?? "invalid:");
    if (
      sender.frameId !== 0 ||
      sender.tab?.id === undefined ||
      !isDisplayBinding(binding, null) ||
      !(message.site === "claude"
        ? validateClaudeStreamCapture(message)
        : validateProviderStreamCapture(message)) ||
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      siteForHost(url.hostname) !== message.site ||
      parseConversationRoute(message.site, url.pathname)?.conversationId !==
        message.conversationId
    )
      return Promise.reject(new Error("payload_rejected"));
    message = structuredClone(message);
    binding = { ...binding };
    sender = {
      tab: { id: sender.tab.id },
      frameId: sender.frameId,
      documentId: sender.documentId,
      url: sender.url,
    };
    // A question about Computer files is admitted and paced like a progress report.
    const stage = message.event === "files" ? "progress" : message.event;
    const lease = this.admission.admit(
      stage,
      message.id,
      binding,
      sender.tab!.id!,
      Date.parse(message.observedAt),
    );
    if (!lease) return Promise.resolve({ accepted: false });
    const generation = this.generation;
    const current = () => {
      if (routeGuard?.checkActivity) routeGuard.checkActivity();
      else routeGuard?.check();
      this.admission.check(lease);
      if (generation !== this.generation) throw new Error("policy_unavailable");
      return true;
    };
    const commitCurrent = () => {
      routeGuard?.check();
      return current();
    };
    return this.admission.run(lease, stage, async () => {
      if (!(await this.consent(url.origin)))
        throw new Error("capture_hook_missing");
      current();
      const start = this.pending.get(lease.key);
      if (
        !start ||
        start.observedAt !== message.observedAt ||
        start.conversation !== message.conversationId ||
        start.documentId !== sender.documentId ||
        start.origin !== url.origin
      )
        throw new Error("payload_rejected");
      if (message.event === "progress") return { accepted: true };
      if (message.site !== "claude" && message.event === "files")
        return {
          accepted: true,
          known: await this.countedComputerFiles(start, message, current),
        };
      if (message.site !== "claude") {
        if (message.event === "batch") {
          const page: HistoryTextPage = {
            site: message.site,
            conversationId: message.conversationId,
            observedAt: message.observedAt,
            messages: message.rows.map((row) => row.message),
            firstRequestVerified: false,
            rootSourceId: null,
            selectedLeafId: null,
            branchSourceIds: null,
            branchScope: "unknown",
            hasEarlier: null,
            hasLater: null,
            status: "partial",
          };
          const files = await this.savedComputerFiles(start, page, current);
          const reused = await this.savedCounts(start, page, current, files);
          const counted = await countHistoryPage(page, this.count, {
            counting: this.counting,
            validNow: current,
            limit: message.rows.length,
            reused,
            computerFiles: files?.saved,
          });
          current();
          for (let index = 0; index < message.rows.length; index++) {
            const row = message.rows[index]!;
            const key = row.message.role + ":" + row.message.sourceId;
            if (start.providerRows.has(key))
              throw new Error("conflicting_duplicate_identity");
            start.providerRows.set(key, {
              counted: counted.messages[index]!,
              requestRef: row.requestRef,
              parentRef: row.parentRef,
              basis: this.countBasis(
                row.message,
                counted.messages[index]!,
                files?.keys,
              ),
            });
          }
          return { accepted: true };
        }
        this.pending.delete(lease.key);
        const meta = message.meta;
        if (start.providerRows.size !== meta.messageCount)
          throw new Error("history_unsupported");
        const entries = [...start.providerRows.values()];
        if (
          message.site === "chatgpt" &&
          new Set(entries.map(({ counted }) => counted.sourceId)).size !==
            entries.length
        )
          throw new Error("conflicting_duplicate_identity");
        const roles = new Map(
          entries.map(({ counted }) => [counted.sourceId, counted.role]),
        );
        const requestPrompts = new Map<string, string | null>();
        if (message.site === "chatgpt")
          for (const { counted, requestRef } of entries)
            if (counted.role === "prompt" && requestRef)
              requestPrompts.set(
                requestRef,
                requestPrompts.has(requestRef) ? null : counted.sourceId,
              );
        const messages = entries.map(({ counted, requestRef, parentRef }) => {
          if (message.site !== "chatgpt") return counted;
          const parentRole = parentRef ? (roles.get(parentRef) ?? null) : null;
          return {
            ...counted,
            promptSourceId:
              counted.role === "prompt"
                ? counted.sourceId
                : requestRef
                  ? (requestPrompts.get(requestRef) ?? null)
                  : null,
            parentSourceId: parentRole ? parentRef : null,
            parentRole,
          };
        });
        if (message.site === "perplexity")
          for (let index = 0; index < messages.length; index += 2) {
            const prompt = messages[index],
              response = messages[index + 1];
            if (
              !prompt ||
              !response ||
              prompt.role !== "prompt" ||
              response.role !== "response" ||
              prompt.sourceId !== response.sourceId ||
              response.promptSourceId !== prompt.sourceId
            )
              throw new Error("history_unsupported");
          }
        if (message.site === "gemini")
          for (let index = 0; index < messages.length; index += 2) {
            const prompt = messages[index],
              response = messages[index + 1];
            const prior = index ? messages[index - 1] : null;
            if (
              !prompt ||
              !response ||
              prompt.role !== "prompt" ||
              response.role !== "response" ||
              response.parentSourceId !== prompt.sourceId ||
              response.parentRole !== "prompt" ||
              response.promptSourceId !== prompt.sourceId ||
              (prior &&
                (prompt.parentSourceId !== prior.sourceId ||
                  prompt.parentRole !== "response"))
            )
              throw new Error("history_unsupported");
          }
        // A NotebookLM read is Studio rows, which never prove a first message, or chat turns.
        if (message.site === "notebooklm") {
          const kind = notebooklmRows(messages);
          if (
            kind === null ||
            (kind === "studio" &&
              (meta.firstRequestVerified || !validStudioPairs(messages)))
          )
            throw new Error("history_unsupported");
        }
        if (
          meta.firstRequestVerified &&
          (!messages.length ||
            messages[0]!.role !== "prompt" ||
            messages[0]!.sourceId !== meta.rootSourceId)
        )
          throw new Error("history_unsupported");
        if (
          message.site === "gemini" &&
          (messages.at(-1)?.sourceId !== meta.selectedLeafId ||
            messages.at(-1)?.role !== "response")
        )
          throw new Error("history_unsupported");
        const selected =
          meta.branchScope === "selected_branch"
            ? messages.map((row) => row.sourceId)
            : null;
        const leafRole = meta.selectedLeafId
          ? (roles.get(meta.selectedLeafId) ?? null)
          : null;
        const bases = new Map(
          entries.map(({ counted, basis }) => [
            counted.role + ":" + counted.sourceId,
            basis,
          ]),
        );
        const common = {
          site: message.site,
          conversationId: message.conversationId,
          observedAt: message.observedAt,
        };
        for (let offset = 0; offset < messages.length; offset += 100) {
          const batch: CountedHistoryPage = {
            ...common,
            messages: messages.slice(offset, offset + 100),
            firstRequestVerified: meta.firstRequestVerified,
            rootSourceId: meta.rootSourceId,
            selectedLeafId: meta.selectedLeafId,
            branchSourceIds: selected,
            branchScope: meta.branchScope,
            hasEarlier: meta.hasEarlier,
            hasLater: meta.hasLater,
            status: "partial",
          };
          current();
          await this.commitCountedBatch(
            common,
            batch,
            messages.length,
            offset,
            offset + 100 >= messages.length ? leafRole : null,
            start,
            url,
            routeGuard,
            current,
            commitCurrent,
            { deferCoverage: offset + 100 < messages.length, bases },
          );
          this.admission.renew(lease);
        }
        if (this.estimation) await this.estimation.maintainLocal();
        if (start.ownership.scope.mode === "company") this.scheduleSync();
        return { accepted: true };
      }
      if (message.event === "batch") {
        const page: HistoryTextPage = {
          site: "claude",
          conversationId: message.conversationId,
          observedAt: message.observedAt,
          messages: message.rows.map((row) => row.message),
          firstRequestVerified: false,
          rootSourceId: null,
          selectedLeafId: null,
          branchSourceIds: null,
          branchScope: "unknown",
          hasEarlier: null,
          hasLater: null,
          status: "partial",
        };
        const reused = await this.savedCounts(start, page, current);
        const counted = await countHistoryPage(page, this.count, {
          counting: this.counting,
          validNow: current,
          limit: message.rows.length,
          reused,
        });
        current();
        for (let index = 0; index < message.rows.length; index++) {
          const row = message.rows[index]!;
          if (start.streamRows.has(row.message.sourceId))
            throw new Error("conflicting_duplicate_identity");
          start.streamRows.set(row.message.sourceId, {
            row: {
              ...row,
              message: { ...row.message, text: null, inlineFiles: null },
            },
            counted: counted.messages[index]!,
            basis: this.countBasis(row.message, counted.messages[index]!),
          });
        }
        return { accepted: true };
      }
      this.pending.delete(lease.key);
      if (start.streamRows.size !== message.rowCount)
        throw new Error("history_unsupported");
      const chain: Array<{
        row: ClaudeHistoryRow;
        counted: CountedHistoryMessage;
        basis: HistoryCountBasis | null;
      }> = [];
      const seen = new Set<string>();
      let id = message.leafId;
      while (id !== CLAUDE_HISTORY_ROOT && start.streamRows.has(id)) {
        if (seen.has(id)) throw new Error("history_unsupported");
        seen.add(id);
        const item = start.streamRows.get(id)!;
        chain.push(item);
        id = item.row.parentId;
      }
      if (!chain.length) throw new Error("history_unsupported");
      chain.reverse();
      // As in claudeHistory: reaching the root from a prompt proves the selected branch's
      // start. An edited first prompt has index 2, not 0 (seen live, 13 October 2026).
      const firstVerified =
        id === CLAUDE_HISTORY_ROOT &&
        chain[0]!.counted.role === "prompt" &&
        chain.every((item) => item.row.untruncated);
      const rootSourceId = firstVerified ? chain[0]!.counted.sourceId : null;
      const selected = chain.map((item) => item.counted.sourceId);
      // Every branch is imported, as in claudeHistory (owner rule of 26 Sep 2026: Req counts
      // the requests on branches an edit or a regeneration replaced). Each row once, in the
      // order the chat lists them, linked to its own parent; the selected branch above only
      // decides the selected leaf and the first-request proof.
      const rowOf = (id: string) => {
        const item = start.streamRows.get(id);
        return item && {
          sender: item.counted.role === "prompt" ? "human" : "assistant",
          parentId: item.row.parentId,
        };
      };
      const messages = [...start.streamRows.values()].map((item) => {
        const parent = start.streamRows.get(item.row.parentId)?.counted ?? null;
        // Rows read before the chat's model arrived get it now (B5); research queries are
        // text the chat's model wrote (owner, 3 Oct).
        const model = item.counted.modelId ?? message.model;
        return {
          ...item.counted,
          modelId: model,
          components: item.counted.components.map((component) =>
            component.role === "research" && component.model === null
              ? { ...component, model }
              : component,
          ),
          parentSourceId: parent?.sourceId ?? null,
          parentRole: parent?.role ?? null,
          promptSourceId:
            item.counted.role === "prompt"
              ? item.counted.sourceId
              : claudePromptOf(item.row.parentId, rowOf),
        };
      });
      const common: Pick<
        HistoryCaptureMessage,
        "site" | "conversationId" | "observedAt"
      > = {
        site: "claude",
        conversationId: message.conversationId,
        observedAt: message.observedAt,
      };
      const bases = new Map(
        [...start.streamRows.values()].map((item) => [
          item.counted.role + ":" + item.counted.sourceId,
          item.basis,
        ]),
      );
      const leafRole = start.streamRows.get(message.leafId)!.counted.role;
      for (let offset = 0; offset < messages.length; offset += 100) {
        const batch: CountedHistoryPage = {
          ...common,
          messages: messages.slice(offset, offset + 100),
          firstRequestVerified: firstVerified,
          rootSourceId,
          selectedLeafId: message.leafId,
          branchSourceIds: selected,
          branchScope: "loaded_messages",
          hasEarlier: firstVerified ? false : null,
          hasLater: null,
          status: "partial",
        };
        current();
        await this.commitCountedBatch(
          common,
          batch,
          messages.length,
          offset,
          offset + 100 >= messages.length ? leafRole : null,
          start,
          url,
          routeGuard,
          current,
          commitCurrent,
          { deferCoverage: offset + 100 < messages.length, bases },
        );
        this.admission.renew(lease);
      }
      if (this.estimation) await this.estimation.maintainLocal();
      if (start.ownership.scope.mode === "company") this.scheduleSync();
      return { accepted: true };
    });
  }
  /**
   * A Cowork page (W5). Each result's own counts are the difference to the session's saved
   * checkpoint, so one session imports one page at a time and every batch saves its
   * checkpoint together with its replies. A checkpoint that moved meanwhile means the
   * counts are recalculated, never saved twice.
   */
  private async receiveCowork(
    message: HistoryCaptureMessage,
    start: PendingHistory,
    url: URL,
    routeGuard: RouteGuard | undefined,
    current: () => boolean,
    commitCurrent: () => boolean,
  ) {
    const { scope } = start.ownership;
    const conversation = await start.identity(
      "claude",
      "conversation",
      message.conversationId,
    );
    current();
    await this.coworkTurn(`${scope.namespace}:${conversation}`, async () => {
      for (let attempt = 0; ; attempt++) {
        const saved = await this.ledger.coworkCheckpoint(scope, conversation);
        current();
        const page = coworkTurns(message.page!, saved);
        // Counted results are never imported again, so after a reconnection their saved
        // replies are queued for the new enrolment here, as a reimport of other history
        // queues its messages.
        const counted = coworkCounted(message.page!, saved);
        if (scope.mode === "company" && counted.length) {
          const keys = await Promise.all(
            counted.map((id) =>
              start.identity(
                "claude",
                "history-message",
                JSON.stringify([message.conversationId, "response", id]),
              ),
            ),
          );
          for (let offset = 0; offset < keys.length; offset += 100) {
            current();
            await this.ledger.requeueHistory(
              scope,
              keys.slice(offset, offset + 100),
              {
                authority: start.authority,
                erasureVersion: start.erasureVersion,
              },
              commitCurrent,
            );
          }
        }
        let base = saved?.sequence ?? null;
        try {
          for (let offset = 0; offset < page.messages.length; offset += 100) {
            const counted = await countHistoryPage(page, this.count, {
              counting: this.counting,
              validNow: current,
              offset,
              limit: 100,
            });
            current();
            const next = coworkCheckpointAfter(counted.messages);
            await this.commitCountedBatch(
              message,
              counted,
              page.messages.length,
              offset,
              null,
              start,
              url,
              routeGuard,
              current,
              commitCurrent,
              {
                deferCoverage: offset + 100 < page.messages.length,
                ...(next ? { cowork: { base, next } } : {}),
              },
            );
            if (next) base = next.sequence;
          }
          return;
        } catch (error) {
          if (
            !(error instanceof Error) ||
            error.message !== "cowork_checkpoint_stale" ||
            attempt >= 2
          )
            throw error;
          current();
        }
      }
    });
  }
  private async coworkTurn(key: string, run: () => Promise<void>) {
    const previous = this.coworkQueues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => (release = resolve));
    const tail = previous.then(() => mine);
    this.coworkQueues.set(key, tail);
    await previous;
    try {
      await run();
    } finally {
      release();
      if (this.coworkQueues.get(key) === tail) this.coworkQueues.delete(key);
    }
  }
  private async commitCountedBatch(
    message: Pick<
      HistoryCaptureMessage,
      "site" | "conversationId" | "observedAt"
    >,
    counted: CountedHistoryPage,
    totalMessages: number,
    offset: number,
    leafRole: "prompt" | "response" | null,
    start: PendingHistory,
    url: URL,
    routeGuard: RouteGuard | undefined,
    current: () => boolean,
    commitCurrent: () => boolean,
    options: {
      deferCoverage?: boolean;
      bases?: ReadonlyMap<string, HistoryCountBasis | null>;
      cowork?: CoworkAdvance;
    } = {},
  ) {
    const { scope } = start.ownership;
    const countBases: Record<string, HistoryCountBasis> = {};
    const key = (kind: string, id: string) =>
      start.identity(message.site, kind, id);
    const messageKey = (role: string, id: string) =>
      key(
        "history-message",
        JSON.stringify([message.conversationId, role, id]),
      );
    const conversation = await key(
      message.site === "perplexity" ? "route" : "conversation",
      message.conversationId,
    );
    // A batch repeats the chat's labels, so each unknown label is kept once per batch.
    const unknownLabels = new Set<string>();
    // Company keys (W11) name saved copies like the live capture of the same prompt or
    // reply, so the company counts each once.
    const companySecret = companyKeySecret(
      await this.company.credentials(),
      scope,
    );
    const companySign = companySecret ? companyKeyer(companySecret) : null;
    const cowork =
      message.site === "claude" && isCoworkSessionId(message.conversationId);
    const companyKeys: Record<string, string> = {};
    const replyLinks =
      message.site === "notebooklm"
        ? await this.notebookReplyLinks(
            scope,
            conversation,
            counted.messages,
            key,
            messageKey,
          )
        : null;
    // One batch holds at most 100 messages, so its keys can be signed together.
    const messages: HistoryMessage[] = await Promise.all(
      counted.messages.map(async (m) => {
        const link = replyLinks?.get(m.sourceId);
        const [messageKeyValue, parent, prompt, requestKey, attemptKey] =
          await Promise.all([
            messageKey(m.role, m.sourceId),
            m.parentSourceId && m.parentRole
              ? messageKey(m.parentRole, m.parentSourceId)
              : null,
            m.promptSourceId ? messageKey("prompt", m.promptSourceId) : null,
            m.requestId ? key("request", m.requestId) : null,
            link
              ? link.attemptKey
              : m.liveAttemptId
                ? key("attempt", m.liveAttemptId)
                : null,
          ]);
        const basis = options.bases?.get(m.role + ":" + m.sourceId);
        if (basis) countBases[messageKeyValue] = basis;
        const named = companySign
          ? savedCompanyId(message.site, cowork, m)
          : null;
        // A reply linked by content takes its live capture's company key (W11).
        if (named)
          companyKeys[messageKeyValue] =
            link?.companyAttemptKey ??
            (await companySign!(message.site, named.kind, named.id));
        const model = resolveModelLabel(message.site, m.modelId);
        const unknown = unknownModelLabel(model, m.modelId);
        if (unknown) unknownLabels.add(unknown);
        // A reply's total is its parts' sum, or the provider's own count when reported.
        // A prompt keeps its text count; uploaded images are a part of their own (A7),
        // priced for the model the page names on the prompt, or the site's benchmark.
        const parts =
          m.role === "response"
            ? historyReplyParts(m.tokens, m.partTokens, m.usage)
            : m.inputImages
              ? historyPromptParts(
                  uploadTotal(
                    uploadedImages(
                      message.site,
                      model?.id ?? null,
                      m.inputImages,
                    ),
                  ),
                )
              : null;
        const tokens =
          m.role !== "response"
            ? m.tokens
            : m.usage
              ? providerMeasurement(m.usage.output)
              : composeOutputTotal(parts!);
        const generation =
          m.role === "response"
            ? historyGeneration(
                message.site,
                m.components,
                m.media ?? [],
                unknownLabels,
              )
            : emptyGeneration();
        return HistoryMessageSchema.parse({
          schema_version: HISTORY_SCHEMA_VERSION,
          kind: "history_message",
          site: message.site,
          key_version: "1",
          message_key: messageKeyValue,
          role: m.role,
          conversation_key: conversation,
          parent_key: parent,
          prompt_key: prompt,
          provider_request_key: requestKey,
          provider_attempt_key: attemptKey,
          occurred_at: m.occurredAt,
          date_basis: m.dateBasis,
          observed_at: message.observedAt,
          proposed_method_id: start.method?.method_id ?? BASELINE_METHOD_ID,
          proposed_method_hash:
            start.method?.method_hash ?? BASELINE_METHOD_HASH,
          model_id: model?.id ?? null,
          tokens,
          inline_file_text: m.inlineFileComponents,
          parts,
          generation,
          company_dedup_key: null,
          text_complete: m.complete,
          timing: m.timing,
          coverage_reasons: [
            "history_only",
            ...(!m.complete ? ["partial_capture"] : []),
            ...(m.coverageReasons ?? []),
          ],
        });
      }),
    );
    const page: HistoryPage = {
      schema_version: HISTORY_SCHEMA_VERSION,
      site: message.site,
      conversation_key: conversation,
      observed_at: message.observedAt,
      deletion_epoch:
        (await this.company.credentials())?.policy.deletion_epoch ?? 0,
      messages,
      branch_scope: counted.branchScope,
      selected_leaf_key:
        counted.selectedLeafId && leafRole
          ? await messageKey(leafRole, counted.selectedLeafId)
          : null,
      branch_message_keys: null,
      root_message_key: counted.rootSourceId
        ? await messageKey("prompt", counted.rootSourceId)
        : null,
      first_request_verified:
        counted.firstRequestVerified && offset + 100 >= totalMessages,
      has_earlier: counted.hasEarlier,
      has_later: counted.hasLater,
    };
    if (!(await this.consent(url.origin)))
      throw new Error("capture_hook_missing");
    if ((await this.currentScope()).namespace !== scope.namespace)
      throw new Error("policy_unavailable");
    current();
    await routeGuard?.verify();
    current();
    for (let attempt = 0, routeRetries = 0; ;) {
      const prepared = await this.prepareEstimates(scope, messages, current);
      if (!(await this.consent(url.origin)))
        throw new Error("capture_hook_missing");
      current();
      await routeGuard?.verify();
      current();
      try {
        await this.ledger.commitHistory(
          scope,
          { ...page, messages: prepared.messages },
          {
            authority: start.authority,
            erasureVersion: start.erasureVersion,
            estimates: prepared.estimates,
            ...(prepared.healthCodes.length
              ? { healthCodes: prepared.healthCodes }
              : {}),
            ...(this.estimation ? { envelopes: prepared.envelopes } : {}),
            ...(options.deferCoverage ? { deferCoverage: true } : {}),
            ...(Object.keys(countBases).length ? { countBases } : {}),
            ...(Object.keys(companyKeys).length ? { companyKeys } : {}),
            ...(options.cowork ? { cowork: options.cowork } : {}),
          },
          commitCurrent,
        );
        // Kept after the batch is saved, so an erasure in between leaves nothing behind.
        await keepUnknownModelLabels(
          this.ledger,
          scope.namespace,
          message.site,
          unknownLabels,
        );
        // Only a read's last batch; the earlier ones of a long chat would show it again
        // for nothing.
        if (!options.deferCoverage) this.committed?.(scope, conversation);
        // A saved page closes earlier storage problems, and estimates made afresh close
        // estimation problems (owner decision of 16 Oct 2026). Codes this page reported
        // itself stay open.
        const solved: HealthSuccess[] = ["record_saved"];
        if (prepared.estimated) solved.push("estimate_made");
        await solveHealth(
          this.ledger,
          scope.namespace,
          solved,
          prepared.healthCodes,
        );
        break;
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "route_pending" &&
          routeGuard &&
          routeRetries < 2
        ) {
          routeRetries++;
          await routeGuard.verify();
          current();
          continue;
        }
        if (
          !(error instanceof Error) ||
          error.message !== "method_admission_conflict" ||
          attempt >= 2
        )
          throw error;
        attempt++;
        current();
      }
    }
  }
  /**
   * The live replies saved NotebookLM answers link to, by source id (16 Oct 2026). A saved
   * answer keeps no id its live stream named, so it is found by its content id, a keyed
   * digest of its chat session and answer text that the live capture kept as well.
   * - Answers with the same content link in the order the replies were sent, each live
   *   reply to one saved answer: two saved answers named by one live reply would both stay
   *   unlinked (`matchingLiveInput`), and a live reply already linked keeps its answer.
   * - An answer already saved keeps its stored reply key, linked or not, because a reread
   *   that changed the key would make the saved row a conflict (`refineHistory`). Answers
   *   saved before this rule therefore stay unlinked until the records are erased.
   * Answers without a match keep their own turn id, so they count from history.
   */
  private async notebookReplyLinks(
    scope: Scope,
    conversation: string,
    messages: readonly CountedHistoryMessage[],
    key: (kind: string, id: string) => Promise<string>,
    messageKey: (role: string, id: string) => Promise<string>,
  ): Promise<Map<string, Pick<LiveReplyContent, "attemptKey" | "companyAttemptKey">>> {
    const links = new Map<
      string,
      Pick<LiveReplyContent, "attemptKey" | "companyAttemptKey">
    >();
    const answers = messages.filter(
      (m) => m.role === "response" && m.contentId !== undefined,
    );
    if (!answers.length) return links;
    const live = await this.ledger.liveReplyContents(scope, conversation);
    const keys = await Promise.all(
      answers.map((m) =>
        Promise.all([
          messageKey("response", m.sourceId),
          key("reply-content", m.contentId!),
        ]),
      ),
    );
    const stored = await this.ledger.findHistoryMessages(
      scope,
      keys.map(([saved]) => saved),
    );
    // The saved answer each live reply already names; null when it names more than one.
    const owner = new Map<string, string | null>();
    for (const reply of live)
      if (reply.linkedMessageKeys.length)
        owner.set(
          reply.attemptKey,
          reply.linkedMessageKeys.length === 1
            ? reply.linkedMessageKeys[0]!
            : null,
        );
    for (const [index, m] of answers.entries()) {
      const [saved, content] = keys[index]!;
      const kept = stored[index]?.record.provider_attempt_key;
      if (kept) {
        links.set(m.sourceId, {
          attemptKey: kept,
          companyAttemptKey:
            live.find((item) => item.attemptKey === kept)?.companyAttemptKey ??
            null,
        });
        continue;
      }
      const reply = live.find(
        (item) => item.contentKey === content && !owner.has(item.attemptKey),
      );
      if (!reply) continue;
      owner.set(reply.attemptKey, saved);
      links.set(m.sourceId, {
        attemptKey: reply.attemptKey,
        companyAttemptKey: reply.companyAttemptKey,
      });
    }
    return links;
  }
  /** The counting runtime a saved count must match before it is reused. */
  private countRuntime() {
    const { implementationId, profileId } = this.counting.selection;
    return {
      implementationId: `${implementationId}/${COUNT_BASIS_RULES}`,
      profileId,
      assetHash: profileFor(this.counting.manifest, profileId)!.assetHash,
    };
  }
  /**
   * The local basis stored with a count. Only a known count of finished text is
   * worth reusing; a partial or failed count is simply counted again next time.
   */
  private countBasis(
    source: HistoryTextPage["messages"][number],
    counted: CountedHistoryMessage,
    fileKeys?: ReadonlyMap<string, string>,
  ): HistoryCountBasis | null {
    const componentTokens = counted.components.map((component, index) =>
      source.components?.[index]?.text === null ? null : component.tokens,
    );
    if (
      !source.complete ||
      source.text === null ||
      !knownCountBasis({ ...counted, componentTokens })
    )
      return null;
    // Every text file the reply lists was counted (countHistoryPage leaves the list out
    // otherwise), so a later read reuses these counts instead of downloading the files.
    const computerFiles = counted.computerFileTokens?.length
      ? Object.fromEntries(
          counted.computerFileTokens.map((file) => [
            fileKeys?.get(file.id) ?? "",
            { tokens: file.tokens, basis: file.basis },
          ]),
        )
      : undefined;
    if (computerFiles && Object.hasOwn(computerFiles, "")) return null;
    return {
      ...(computerFiles ? { computerFiles } : {}),
      units: source.text.length,
      fileUnits: source.inlineFiles?.map((file) => file.text.length) ?? null,
      partUnits: partUnits(source),
      partTokens: counted.partTokens,
      componentUnits: componentUnits(source),
      componentTokens,
      ...this.countRuntime(),
      tokens: counted.tokens,
      inlineFileComponents: counted.inlineFileComponents,
    };
  }
  /**
   * Saved counts for unchanged messages in one stream batch. A message is unchanged
   * when its saved row was counted from finished text of the same lengths under the
   * same counting runtime. Anything else is counted again.
   */
  private async savedCounts(
    start: PendingHistory,
    page: HistoryTextPage,
    current: () => boolean,
    files?: SavedComputerFiles | null,
  ): Promise<Array<ReusedHistoryCount | undefined>> {
    const { scope } = start.ownership;
    const keys = await Promise.all(
      page.messages.map((m) =>
        start.identity(
          page.site,
          "history-message",
          JSON.stringify([page.conversationId, m.role, m.sourceId]),
        ),
      ),
    );
    current();
    const rows = await this.ledger.findHistoryMessages(scope, keys);
    current();
    const runtime = this.countRuntime();
    return page.messages.map((source, index) => {
      const row = rows[index];
      const basis = row?.countBasis;
      const fileUnits =
        source.inlineFiles?.map((file) => file.text.length) ?? null;
      if (
        !row ||
        !basis ||
        row.status !== "current" ||
        row.namespace !== scope.namespace ||
        (row.lastImportEra ?? row.era) !== scope.era ||
        row.record.role !== source.role ||
        !row.record.text_complete ||
        !source.complete ||
        source.text === null ||
        basis.units !== source.text.length ||
        canonicalJson(basis.fileUnits) !== canonicalJson(fileUnits) ||
        canonicalJson(basis.partUnits) !== canonicalJson(partUnits(source)) ||
        canonicalJson(basis.componentUnits) !==
          canonicalJson(componentUnits(source)) ||
        (basis.inlineFileComponents?.length ?? null) !==
          (fileUnits?.length ?? null) ||
        basis.implementationId !== runtime.implementationId ||
        basis.profileId !== runtime.profileId ||
        basis.assetHash !== runtime.assetHash ||
        !knownCountBasis(basis) ||
        !sameComputerFiles(source, basis, files?.keys)
      )
        return undefined;
      return {
        tokens: basis.tokens,
        partTokens: basis.partTokens,
        componentTokens: basis.componentTokens,
        inlineFileComponents: basis.inlineFileComponents,
      };
    });
  }
  /** A saved reply's count basis that this scope may reuse under the counting runtime. */
  private usableBasis(
    scope: Scope,
    row: HistoryRow | undefined,
  ): HistoryCountBasis | null {
    const basis = row?.countBasis;
    const runtime = this.countRuntime();
    return row &&
      basis &&
      row.status === "current" &&
      row.namespace === scope.namespace &&
      (row.lastImportEra ?? row.era) === scope.era &&
      row.record.role === "response" &&
      basis.implementationId === runtime.implementationId &&
      basis.profileId === runtime.profileId &&
      basis.assetHash === runtime.assetHash
      ? basis
      : null;
  }
  /**
   * Keyed hashes of Computer file ids. A file is stored only under its hash, within its
   * conversation, like every other provider id.
   */
  private async computerFileKeys(
    start: PendingHistory,
    conversationId: string,
    ids: Iterable<string>,
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    const hashes = await Promise.all(
      unique.map((id) =>
        start.identity(
          "perplexity",
          "computer-file",
          JSON.stringify([conversationId, id]),
        ),
      ),
    );
    return new Map(unique.map((id, index) => [id, hashes[index]!]));
  }
  /** The saved bases of the replies these source ids name, in order. */
  private async savedReplyBases(
    start: PendingHistory,
    conversationId: string,
    replies: readonly string[],
    current: () => boolean,
  ): Promise<Array<HistoryCountBasis | null>> {
    const keys = await Promise.all(
      replies.map((reply) =>
        start.identity(
          "perplexity",
          "history-message",
          JSON.stringify([conversationId, "response", reply]),
        ),
      ),
    );
    current();
    const rows = await this.ledger.findHistoryMessages(
      start.ownership.scope,
      keys,
    );
    current();
    return replies.map((_, index) =>
      this.usableBasis(start.ownership.scope, rows[index]),
    );
  }
  /**
   * Which of the Computer files a read lists were counted before for their reply, so the
   * page world downloads only the others (owner decision of 14 Oct 2026: once per file).
   */
  private async countedComputerFiles(
    start: PendingHistory,
    message: Extract<ProviderStreamCapture, { event: "files" }>,
    current: () => boolean,
  ): Promise<Array<{ id: string; counted: SavedComputerFile["basis"] }>> {
    const replies = [...new Set(message.files.map((file) => file.reply))];
    const bases = await this.savedReplyBases(
      start,
      message.conversationId,
      replies,
      current,
    );
    const keys = await this.computerFileKeys(
      start,
      message.conversationId,
      message.files.map((file) => file.id),
    );
    current();
    const known = new Map<string, SavedComputerFile["basis"]>();
    for (const file of message.files) {
      const saved =
        bases[replies.indexOf(file.reply)]?.computerFiles?.[keys.get(file.id)!];
      if (saved && !known.has(file.id)) known.set(file.id, saved.basis);
    }
    return [...known].map(([id, counted]) => ({ id, counted }));
  }
  /** The saved counts of the Computer files in one stream batch, by reply. */
  private async savedComputerFiles(
    start: PendingHistory,
    page: HistoryTextPage,
    current: () => boolean,
  ): Promise<SavedComputerFiles | null> {
    const replies = page.messages.filter(
      (message) => message.role === "response" && message.computerFiles?.length,
    );
    if (page.site !== "perplexity" || !replies.length) return null;
    const keys = await this.computerFileKeys(
      start,
      page.conversationId,
      replies.flatMap((message) =>
        message.computerFiles!.map((file) => file.id),
      ),
    );
    current();
    const bases = await this.savedReplyBases(
      start,
      page.conversationId,
      replies.map((message) => message.sourceId),
      current,
    );
    const saved = page.messages.map((message) => {
      const basis = bases[replies.indexOf(message)]?.computerFiles;
      if (!basis) return undefined;
      const files = new Map<string, SavedComputerFile>();
      for (const file of message.computerFiles ?? []) {
        const entry = basis[keys.get(file.id)!];
        if (entry) files.set(file.id, entry);
      }
      return files.size ? files : undefined;
    });
    return { keys, saved };
  }
  private async prepareEstimates(
    scope: Scope,
    candidates: HistoryMessage[],
    current: () => boolean,
  ) {
    const messages: HistoryMessage[] = [];
    const estimates: Record<string, HistorySummary["resources"]> = {};
    const envelopes: Record<string, EstimationEnvelope> = {};
    const healthCodes = new Set<ReasonCode>();
    // Whether the estimator ran successfully for at least one message, not only reused results.
    let estimated = false;
    const saved: Array<HistoryRow | undefined> = [];
    for (let offset = 0; offset < candidates.length; offset += 100)
      saved.push(
        ...(await this.ledger.findHistoryMessages(
          scope,
          candidates
            .slice(offset, offset + 100)
            .map((candidate) => candidate.message_key),
        )),
      );
    for (const [index, candidate] of candidates.entries()) {
      current();
      const old = saved[index];
      if (
        old &&
        (old.record.message_key !== candidate.message_key ||
          old.namespace !== scope.namespace ||
          old.record.proposed_method_id !== old.original.proposed_method_id ||
          old.record.proposed_method_hash !== old.original.proposed_method_hash)
      )
        throw new Error("ledger_integrity_failed");
      const incoming = HistoryMessageSchema.parse(
        old
          ? {
              ...candidate,
              proposed_method_id: old.original.proposed_method_id,
              proposed_method_hash: old.original.proposed_method_hash,
            }
          : candidate,
      );
      const record = old
        ? mergeHistoryEvidence(old.record, incoming)
        : incoming;
      current();
      if (record.coverage_reasons.includes("historical_timing_conflict"))
        healthCodes.add("historical_timing_conflict");
      if (old && historyNumericPayloadHash(record) === old.hash) {
        estimates[record.message_key] = old.estimate;
        messages.push(record);
        continue;
      }
      if (this.estimation) {
        const input = { family: "history" as const, record };
        const original = this.estimation.original
          ? await this.estimation.original(input, record.proposed_method_hash)
          : {
              result: await this.estimation.estimate(input, {
                methodId: record.proposed_method_id,
                view: "original",
              }),
              reason: null,
            };
        current();
        if (original.result === null) {
          if (
            !original.reason ||
            ![
              "method_unsupported",
              "estimate_unavailable",
              "method_update_invalid",
            ].includes(original.reason)
          )
            throw new Error(original.reason ?? "estimate_unavailable");
          estimates[record.message_key] = this.pendingEstimate(
            record,
            original.reason,
          );
          healthCodes.add(original.reason);
          messages.push(record);
          continue;
        }
        const result = EstimationEnvelopeSchema.parse(original.result);
        if (
          result.requested_method.method_id !== record.proposed_method_id ||
          result.requested_method.method_hash !== record.proposed_method_hash ||
          result.view !== "original" ||
          result.original_method_hash !== null
        )
          throw new Error("method_update_invalid");
        estimates[record.message_key] = historicalResources(result, record);
        if (record.role === "response") envelopes[record.message_key] = result;
        estimated = true;
      } else {
        estimates[record.message_key] = estimateHistoricalText(record);
        estimated = true;
      }
      messages.push(record);
    }
    return {
      messages,
      estimates,
      envelopes,
      healthCodes: [...healthCodes],
      estimated,
    };
  }
  private pendingEstimate(
    record: HistoryMessage,
    reason: ReasonCode,
  ): HistorySummary["resources"] {
    if (record.role !== "response") return [];
    return HistoryResourcesSchema.parse(
      ["energy", "carbon", "water_direct", "water_upstream", "water_total"].map(
        (quantity) => ({
          quantity,
          value: null,
          unit:
            quantity === "energy"
              ? "kWh"
              : quantity === "carbon"
                ? "gCO2e"
                : "L",
          scope: "historical_visible_response",
          method_id: record.proposed_method_id,
          method_hash: record.proposed_method_hash,
          status: "unavailable",
          validation_state: "unvalidated_reference",
          profile_selection: "unavailable",
          selected_profile_id: null,
          reasons: ["history_only", reason],
          missing_components: ["provider_execution_unobserved"],
          known_message_count: "0",
          unknown_message_count: "1",
        }),
      ),
    );
  }
  private scheduleSync() {
    this.syncDirty = true;
    if (this.syncFlight || this.syncTimer) return;
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      void this.sync().catch(() => {});
    }, 0);
  }
  async sync() {
    this.syncDirty = true;
    if (this.syncFlight) return this.syncFlight;
    const generation = this.generation;
    let failed = false;
    const work = (async () => {
      for (
        let pass = 0;
        pass < 3 && this.syncDirty && generation === this.generation;
        pass++
      ) {
        this.syncDirty = false;
        const progressed = await this.syncOnce();
        if (!progressed) break;
        const scope = await this.currentScope();
        this.syncDirty ||=
          scope.mode === "company" &&
          ((await this.ledger.pendingHistory(scope)).length > 0 ||
            (await this.ledger.pendingHistoryCoverage(scope)).length > 0);
      }
    })()
      .catch((error) => {
        failed = true;
        throw error;
      })
      .finally(() => {
        if (this.syncFlight === work) this.syncFlight = null;
        if (!failed && generation === this.generation && this.syncDirty)
          this.scheduleSync();
      });
    this.syncFlight = work;
    return work;
  }
  private async syncOnce() {
    const scope = await this.currentScope();
    if (scope.mode !== "company") return 0;
    const generation = this.generation;
    const rows = await this.ledger.pendingHistory(scope);
    const groups = new Map<string, HistoryRow[]>();
    for (const row of rows) {
      const group = groups.get(row.record.conversation_key) ?? [];
      group.push(row);
      groups.set(row.record.conversation_key, group);
    }
    for (const coverage of await this.ledger.pendingHistoryCoverage(scope))
      if (!groups.has(coverage.page.conversation_key))
        groups.set(coverage.page.conversation_key, []);
    let progressed = 0;
    for (const [conversation, entries] of [...groups].slice(0, 4)) {
      const coverage = await this.ledger.historyCoverage(scope, conversation);
      if (!coverage) continue;
      const credentials = await this.company.credentials();
      if (coverage.deviceId !== credentials?.device_id) continue;
      // Company keys travel beside the messages, and only to a server that handed out
      // the company key (W11).
      const build = () => {
        const keys = credentials?.company_dedup_key
          ? entries
              .filter((e) => e.companyKey)
              .map((e) => ({
                message_key: e.record.message_key,
                company_dedup_key: e.companyKey!,
              }))
          : [];
        return HistoryPageSchema.parse({
          ...coverage.page,
          messages: entries.map((e) => e.record),
          deletion_epoch: credentials?.policy.deletion_epoch,
          ...(keys.length ? { company_dedup_keys: keys } : {}),
        });
      };
      let page = build();
      // A page over the server's limit leaves its last messages for the next upload.
      while (
        entries.length > 1 &&
        new TextEncoder().encode(canonicalJson(page)).length > 262144
      ) {
        entries.pop();
        page = build();
      }
      const before = await this.ledger.publicationSnapshot(scope.namespace);
      const result = await this.company.threadRequest(
        scope,
        "/v1/me/history",
        page,
      );
      if (
        generation !== this.generation ||
        (await this.currentScope()).namespace !== scope.namespace
      )
        throw new Error("policy_unavailable");
      if (
        !result ||
        result.schema_version !== HISTORY_SCHEMA_VERSION ||
        result.deletion_epoch !== page.deletion_epoch ||
        !Array.isArray(result.results) ||
        result.results.length !== entries.length
      )
        throw new Error("payload_rejected");
      const receipts: HistoryReceipt[] = result.results;
      for (let i = 0; i < receipts.length; i++) {
        const r = receipts[i];
        if (
          Object.keys(r).sort().join(",") !==
            "message_key,payload_hash,status" ||
          r.message_key !== entries[i].record.message_key ||
          r.payload_hash !== historyNumericPayloadHash(entries[i].record) ||
          !["applied", "duplicate", "conflict", "erased"].includes(r.status)
        )
          throw new Error("payload_rejected");
      }
      await this.ledger.acknowledgeHistory(
        scope,
        receipts,
        {
          authority: historyAuthority(before),
          erasureVersion: before.erasureVersion,
          coverageKey: coverage.key,
          coverageHash: payloadHash(coverage.page),
        },
        () => generation === this.generation,
      );
      progressed += Math.max(entries.length, 1);
    }
    return progressed;
  }
  async local(
    scope: Scope,
    conversation?: string,
    filters: Filters = {},
    pending = false,
    router?: HistoryRouter,
    /** Receives the models of the counted replies, for Details only; never changes a figure. */
    models?: string[],
    /**
     * Receives how many files Perplexity Computer created in the saved replies were counted
     * from their content or by their size, from each reply's count basis; Details only.
     */
    computerFiles?: { content: number; size: number },
  ): Promise<HistorySummary> {
    const accumulator = new HistoryAccumulator(PACKAGED_CLAUDE_TOKEN_FACTOR);
    router?.reset();
    let after: string | null = null,
      total = 0;
    const selected: HistoryRow[] = [];
    const pendingKeys = new Set<string>();
    for (;;) {
      const rows: HistoryRow[] = await this.ledger.historyPage(
        scope,
        conversation,
        after,
      );
      if (!rows.length) break;
      const queued = pending
        ? await this.ledger.historyQueued(
            scope,
            rows.map((r) => r.key),
          )
        : null;
      if (queued) for (const key of queued) pendingKeys.add(key);
      for (const row of rows) {
        if (conversation && row.record.conversation_key !== conversation)
          continue;

        selected.push(row);
        if (++total > 10000) {
          router?.fail();
          return { ...emptyHistorySummary(), status: "unavailable" };
        }
      }
      if (rows.length < 100) break;
      after = rows.at(-1)!.key;
    }
    const coverage = conversation
      ? await this.ledger.historyCoverage(scope, conversation)
      : undefined;
    let active = selected;
    if (
      coverage?.page.branch_scope === "selected_branch" &&
      coverage.page.selected_leaf_key
    ) {
      const byKey = new Map(
        selected.map((row) => [row.record.message_key, row]),
      );
      const keys = new Set<string>();
      let cursor: string | null = coverage.page.selected_leaf_key;
      while (cursor && byKey.has(cursor) && !keys.has(cursor)) {
        keys.add(cursor);
        cursor = byKey.get(cursor)!.record.parent_key;
      }
      active = selected.filter((row) => keys.has(row.record.message_key));
      accumulator.summary.first_request_verified =
        coverage.page.first_request_verified &&
        cursor === null &&
        keys.has(coverage.page.root_message_key!);
      accumulator.summary.branch_scope = "selected_branch";
    } else if (coverage) {
      accumulator.summary.branch_scope = coverage.page.branch_scope;
      accumulator.summary.first_request_verified =
        coverage.page.first_request_verified &&
        selected.some(
          (r) =>
            r.record.message_key === coverage.page.root_message_key &&
            r.record.role === "prompt" &&
            r.status === "current",
        );
    }
    active = active.filter(
      (row) =>
        (!pending || pendingKeys.has(row.key)) &&
        (!filters.site || row.record.site === filters.site) &&
        (!filters.model ||
          (filters.model === "unknown"
            ? row.record.model_id === null
            : row.record.model_id === filters.model)) &&
        (!filters.start ||
          (row.record.occurred_at !== null &&
            compareHistoricalInstants(row.record.occurred_at, filters.start) >=
              0)) &&
        (!filters.end ||
          (row.record.occurred_at !== null &&
            compareHistoricalInstants(row.record.occurred_at, filters.end) <
              0)),
    );
    if (!active.length) return accumulator.summary;
    // Found among every saved row, before the filters, so a regeneration stays one even when
    // a date, model or branch filter leaves out the reply it replaced.
    const regenerated = regeneratedHistoryReplies(
      selected.map((row) => row.record),
    );
    const view = await this.calculationView(scope, filters);
    let pendingResources = !view.ready;
    // Each page of at most 100 rows costs two reads instead of up to three per row.
    for (let offset = 0; offset < active.length; offset += 100) {
      const rows = active.slice(offset, offset + 100);
      const flags = await this.ledger.historyRowFlags(
        scope,
        rows.map((row) => row.record),
      );
      const selected =
        !pendingResources && !view.original
          ? rows.filter(
              (row, index) =>
                !flags[index]!.erased &&
                !flags[index]!.overlap &&
                row.status !== "conflict" &&
                row.record.role === "response",
            )
          : [];
      const results = new Map(
        selected.length
          ? (
              await this.ledger.estimation.resultsFor(
                scope,
                selected.map((row) => ({
                  family: "history" as const,
                  message_key: row.record.message_key,
                  observation_hash: historyNumericPayloadHash(row.record),
                })),
                view.methodHash!,
              )
            ).map((result, index) => [selected[index]!, result] as const)
          : [],
      );
      for (const [index, row] of rows.entries()) {
        const { erased, overlap } = flags[index]!;
        if (erased) continue;
        const model = row.record.model_id;
        if (
          models &&
          model !== null &&
          row.record.role === "response" &&
          row.status !== "conflict" &&
          !models.includes(model) &&
          models.length < 16
        )
          models.push(model);
        if (
          computerFiles &&
          row.record.role === "response" &&
          row.status !== "conflict"
        )
          for (const file of Object.values(row.countBasis?.computerFiles ?? {}))
            computerFiles[file.basis]++;
        let estimate = pendingResources
          ? []
          : view.original
            ? row.originalEstimate
            : row.estimate;
        if (!pendingResources && results.has(row)) {
          const result = results.get(row);
          if (
            !result ||
            result.requested_method.method_id !== view.methodId ||
            result.requested_method.method_hash !== view.methodHash
          ) {
            pendingResources = true;
            estimate = [];
          } else estimate = historicalResources(result, row.record);
        }
        const options = {
          conflict: row.status === "conflict",
          overlap,
          estimate,
          regenerated: regenerated.has(row.record.message_key),
        };
        router?.add(
          row.record,
          view.original ? row.original : row.record,
          options,
        );
        accumulator.add(view.original ? row.original : row.record, options);
      }
    }
    try {
      await view.current?.();
    } catch (error) {
      if (
        !(error instanceof Error) ||
        ![
          "selection_conflict",
          "aggregate_inconsistent",
          "invalid_preference",
          "engine_unavailable",
        ].includes(error.message)
      )
        throw error;
      pendingResources = true;
    }
    if (
      pendingResources ||
      (await this.calculationView(scope, filters)).token !== view.token
    ) {
      router?.fail();
      return { ...accumulator.summary, status: "unavailable", resources: [] };
    }
    return accumulator.summary;
  }
  private async calculationView(
    scope: Scope,
    filters: Filters,
  ): Promise<HistoryCalculationView> {
    if (
      filters.calculationView === "original" ||
      (!this.estimation && filters.calculationView !== "recalculated")
    )
      return {
        original: true,
        ready: true,
        methodId: null,
        methodHash: null,
        token: "original",
      };
    if (this.estimation?.view) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const engineView = await this.estimation.view(scope);
          // The initial Original default uses saved results without a recalculation job.
          const original =
            filters.calculationView === undefined &&
            filters.methodId === undefined &&
            engineView.view === "original" &&
            !engineView.pending;
          let method = engineView.method
            ? EngineMethodIdentitySchema.parse(engineView.method)
            : null;
          if (!method && !original) {
            try {
              method = EngineMethodIdentitySchema.parse(
                await this.estimation.admission(),
              );
            } catch (error) {
              if (
                !(error instanceof Error) ||
                !["invalid_preference", "engine_unavailable"].includes(
                  error.message,
                )
              )
                throw error;
            }
          }
          const methodId = original
            ? null
            : (filters.methodId ?? method?.method_id ?? null);
          const methodHash =
            method?.method_id === methodId ? method.method_hash : null;
          const ready =
            original ||
            (engineView.view === "recalculated" &&
              !engineView.pending &&
              methodId !== null &&
              engineView.method?.method_id === methodId);
          await engineView.current();
          return {
            original,
            ready,
            methodId,
            methodHash,
            token: payloadHash({
              original,
              ready,
              methodId,
              methodHash,
              revision: engineView.revision,
              selection: engineView.token,
            }),
            guard: engineView.guard,
            current: engineView.current,
          };
        } catch (error) {
          if (
            !(error instanceof Error) ||
            ![
              "selection_conflict",
              "aggregate_inconsistent",
              "invalid_preference",
              "engine_unavailable",
            ].includes(error.message)
          )
            throw error;
          // A setting or publication can change while the shared view checks its authority.
        }
      }
      // Repeated changes cannot be replaced by one era's apparently complete job.
      return {
        original: false,
        ready: false,
        methodId: null,
        methodHash: null,
        token: "unstable-selection",
      };
    }
    let method: EngineMethodIdentity | null = null;
    if (this.estimation) {
      try {
        method = EngineMethodIdentitySchema.parse(
          await this.estimation.admission(),
        );
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !["invalid_preference", "engine_unavailable"].includes(error.message)
        )
          throw error;
        return {
          original: false,
          ready: false,
          methodId: null,
          methodHash: null,
          token: payloadHash({
            unavailable: error.message,
            preference: await this.ledger.estimation.readPreferenceState(),
          }),
        };
      }
    }
    const state = await this.ledger.estimation.state(scope);
    const selected = state.selected;
    const methodId = filters.methodId ?? method?.method_id ?? null;
    const methodHash =
      method?.method_id === methodId
        ? method.method_hash
        : selected?.target.method_id === methodId
          ? selected.target.method_hash
          : null;
    const ready =
      !!selected &&
      !state.active &&
      state.pending === 0 &&
      methodId !== null &&
      selected.target.method_id === methodId &&
      (filters.methodId !== undefined ||
        selected.target.method_hash === method?.method_hash);
    return {
      original: false,
      ready,
      methodId,
      methodHash,
      token: payloadHash({
        methodId,
        methodHash,
        selected: selected?.id ?? null,
        revision: selected?.selectionRevision ?? null,
        generation: selected?.generation ?? null,
        active: state.active?.id ?? null,
        pending: state.pending,
        ready,
      }),
    };
  }
  async view(
    scope: Scope,
    conversation?: string,
    filters: Filters = {},
    server?: HistorySummary,
  ): Promise<HistoryView> {
    return this.buildView(scope, conversation, filters, server, false);
  }
  /** Capture publication reads saved evidence without waiting for the organization server. */
  async localView(
    scope: Scope,
    conversation?: string,
    filters: Filters = {},
  ): Promise<HistoryView> {
    return this.buildView(scope, conversation, filters, undefined, true);
  }
  private async buildView(
    scope: Scope,
    conversation: string | undefined,
    filters: Filters,
    server: HistorySummary | undefined,
    localOnly: boolean,
  ): Promise<HistoryView> {
    const generation = this.generation;
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await this.ledger.publicationSnapshot(scope.namespace);
      const calculation = await this.calculationView(scope, filters);
      const models: string[] = [];
      const computerFiles = { content: 0, size: 0 };
      const local = await this.local(
          scope,
          conversation,
          filters,
          false,
          undefined,
          models,
          computerFiles,
        ),
        pending =
          scope.mode === "company"
            ? await this.local(scope, conversation, filters, true)
            : null;
      let synced = server ? HistorySummarySchema.parse(server) : null;
      let status: HistoryView["server_status"] =
        scope.mode === "personal"
          ? "personal"
          : synced && synced.status !== "unavailable"
            ? "current"
            : "unavailable";
      if (
        synced &&
        !calculation.original &&
        synced.resources.some(
          (resource) =>
            resource.method_id !== calculation.methodId ||
            resource.method_hash !== calculation.methodHash,
        )
      ) {
        synced = { ...synced, status: "unavailable", resources: [] };
        status = "unavailable";
      }
      if (!localOnly && scope.mode === "company" && conversation && !server) {
        try {
          const selected = await this.calculationView(scope, filters);
          const calculationQuery =
            this.estimation || filters.calculationView
              ? selected.original
                ? "&calculation_view=original"
                : selected.methodId
                  ? `&calculation_view=recalculated&method_id=${encodeURIComponent(selected.methodId)}`
                  : null
              : "";
          if (calculationQuery === null)
            throw new Error("recalculation_pending");
          let reply: any;
          let pendingOnly = false;
          try {
            reply = await this.company.threadRequest(
              scope,
              `/v1/me/history/${conversation}/summary?period=all${calculationQuery}`,
            );
          } catch (error) {
            if (
              selected.original ||
              !(error instanceof Error) ||
              ![
                "recalculation_pending",
                "method_unsupported",
                "engine_unavailable",
              ].includes(error.message)
            )
              throw error;
            reply = await this.company.threadRequest(
              scope,
              `/v1/me/history/${conversation}/summary?period=all&calculation_view=original`,
            );
            pendingOnly = true;
          }
          if (
            Object.keys(reply ?? {})
              .sort()
              .join(",") !== "deletion_epoch,history" ||
            reply.deletion_epoch !== before.credentials?.policy.deletion_epoch
          )
            throw new Error("payload_rejected");
          synced = HistorySummarySchema.parse(reply.history);
          if (pendingOnly)
            synced = { ...synced, status: "unavailable", resources: [] };
          status =
            pendingOnly || synced.status === "unavailable"
              ? "unavailable"
              : "current";
          if (
            !selected.original &&
            synced.resources.some(
              (resource) =>
                resource.method_id !== selected.methodId ||
                resource.method_hash !== selected.methodHash,
            )
          ) {
            synced = { ...synced, status: "unavailable", resources: [] };
            status = "unavailable";
          }
        } catch (error) {
          status = isNetworkFailure(error) ? "offline" : "unavailable";
        }
      }
      const after = await this.ledger.publicationSnapshot(
        scope.namespace,
        undefined,
        undefined,
        undefined,
        calculation.guard,
      );
      if (
        before.erasing ||
        after.erasing ||
        before.erasureVersion !== after.erasureVersion ||
        historyAuthority(before) !== historyAuthority(after) ||
        (await this.currentScope()).namespace !== scope.namespace ||
        generation !== this.generation
      )
        throw new Error("policy_unavailable");
      if (
        !after.calculationCurrent ||
        (await this.calculationView(scope, filters)).token !== calculation.token
      )
        continue;
      if (before.version !== after.version) continue;
      return {
        local,
        pending,
        server: synced,
        server_status: status,
        coverage: "partial_loaded_history",
        models,
        ...(computerFiles.content || computerFiles.size
          ? { computer_files: computerFiles }
          : {}),
      };
    }
    throw new Error("aggregate_inconsistent");
  }
}
