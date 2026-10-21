import {
  resolveApplicationRepository,
  type ApplicationRepository,
  type RepositorySource,
  type Scope,
} from "@footprint/ledger";
import type { EngineMethodIdentity } from "@footprint/contracts";
import {
  isThreadId,
  validateThreadHistory,
  type ThreadHistoryMessage,
} from "@footprint/adapters";
import { isDisplayBinding, type DisplayBinding } from "@footprint/capture-core";
import { hmacIdentity, ownershipAt, type Ownership } from "./ownership";
import { isNetworkFailure, type CompanySession } from "./company";
import { scanSummary } from "./summary-scan";
import { validatedSummary } from "./server-summary";
import { HistoryAdmission, type HistoryLease } from "./history-admission";
import { HISTORY_LIMITS } from "./history-limits";
import type { RouteGuard } from "./route-authority";

export interface RecordedThreadCoverage {
  status: "matched_recorded_subset" | "unavailable";
  providerHistoryComplete: false;
  observedPageRequests: number | null;
  unmatchedPageRequests: number | null;
  hasNextPage: boolean | null;
  coverageAfterRestart: "saved_links_only" | "observed_page";
  serverUnavailableReason: "unresolved_identity" | null;
}
export interface RecordedThreadMatch {
  scope: Scope;
  threadKey: string;
  threadId: string;
  providerKeys: string[];
  erasureVersion: number;
  ownershipStart: number;
  binding: DisplayBinding;
  tabId: number;
  documentId?: string;
}
const same = (a: Scope, b: Scope) =>
  a.namespace === b.namespace && a.mode === b.mode && a.era === b.era;
export class RecordedThreads {
  private pending = new Map<
    string,
    {
      ownership: Ownership;
      epoch: number;
      at: string;
      threadId: string;
      binding: DisplayBinding;
      tabId: number;
      documentId?: string;
      expires: number;
    }
  >();
  private admission = new HistoryAdmission((lease) =>
    this.pending.delete(lease.key),
  );
  private pages = new Map<
    string,
    {
      observed: number;
      unmatched: number;
      hasNext: boolean;
      expires: number;
      epoch: number;
      version: number;
    }
  >();
  private ledger: ApplicationRepository;
  constructor(
    source: RepositorySource,
    private company: CompanySession,
    private currentScope: () => Promise<Scope>,
    private onMatched?: (
      match: RecordedThreadMatch,
      current: () => void,
    ) => Promise<void>,
    private scanSelected?: (
      scope: Scope,
      threadKey: string,
      pendingOnly: boolean,
    ) => ReturnType<typeof scanSummary>,
    private selectCalculation?: (scope: Scope) => Promise<{
      view: "original" | "recalculated";
      method: Readonly<EngineMethodIdentity> | null;
      guard?: { authorityScope: Scope; localSelectionToken: string };
      current(): Promise<void>;
    }>,
    /**
     * Whether the person agreed to tracking (lib/tracking-consent.ts). Before that no thread is
     * linked or kept; absent, every page may be.
     */
    private trackingAllowed?: () => Promise<boolean>,
  ) {
    this.ledger = resolveApplicationRepository(source);
  }
  invalidate(tabId: number, documentNonce?: string) {
    this.admission.invalidate(tabId, documentNonce);
    for (const [key, value] of this.pending)
      if (
        value.tabId === tabId &&
        (!documentNonce || value.binding.documentNonce === documentNonce)
      )
        this.pending.delete(key);
  }
  invalidateAll() {
    this.admission.invalidateAll();
    this.pending.clear();
  }
  async receive(
    message: ThreadHistoryMessage,
    binding: DisplayBinding,
    sender: { tab?: { id?: number }; documentId?: string },
    routeGuard?: RouteGuard,
  ) {
    if (
      !validateThreadHistory(message) ||
      !isDisplayBinding(binding, null) ||
      sender.tab?.id == null ||
      Math.abs(Date.now() - Date.parse(message.at)) > HISTORY_LIMITS.lifecycleMs
    )
      throw new Error("payload_rejected");
    const lease = this.admission.admit(
      message.event,
      message.id,
      binding,
      sender.tab.id,
      Date.parse(message.at),
    );
    if (!lease) return { observed: false };
    return this.admission
      .run(lease, message.event, () =>
        this.receiveAdmitted(
          message,
          binding,
          { tab: { id: sender.tab!.id! }, documentId: sender.documentId },
          lease,
          routeGuard,
        ),
      )
      .catch((error) => {
        this.pending.delete(lease.key);
        throw error;
      });
  }
  private async receiveAdmitted(
    message: ThreadHistoryMessage,
    binding: DisplayBinding,
    sender: { tab: { id: number }; documentId?: string },
    lease: HistoryLease,
    routeGuard?: RouteGuard,
  ) {
    const checked = async <T>(operation: Promise<T>): Promise<T> => {
      const value = await operation;
      this.admission.check(lease);
      if (routeGuard?.checkActivity) routeGuard.checkActivity();
      else routeGuard?.check();
      return value;
    };
    const current = () => {
      this.admission.check(lease);
      routeGuard?.check();
    };
    // A native loading hint can arrive during a transaction or display read.
    // Retry only after current-frame proof; the commit guard stays synchronous.
    const withCurrentRoute = async <T>(
      operation: () => Promise<T>,
    ): Promise<T> => {
      for (let attempt = 0; ; attempt++) {
        try {
          await routeGuard?.verify();
          current();
          return await checked(operation());
        } catch (error) {
          if (
            !(error instanceof Error) ||
            error.message !== "route_pending" ||
            attempt >= 2
          )
            throw error;
        }
      }
    };
    this.admission.check(lease);
    if (this.trackingAllowed && !(await checked(this.trackingAllowed())))
      return { observed: false };
    const id = `${sender.tab.id}:${binding.documentNonce}:${message.id}`;
    if (message.event === "start") {
      if (this.pending.has(id)) return { observed: false };
      const history = (await checked(this.ledger.readOwnershipHistory()))!;
      const ownership = ownershipAt(history, Date.parse(message.at));
      const snapshot = await checked(
        this.ledger.publicationSnapshot(ownership.scope.namespace),
      );
      if (snapshot.erasing) throw new Error("deletion_in_progress");
      await withCurrentRoute(async () =>
        this.pending.set(id, {
          ownership,
          epoch: snapshot.erasureVersion,
          at: message.at,
          threadId: message.threadId,
          binding: { ...binding },
          tabId: sender.tab.id,
          documentId: sender.documentId,
          expires: lease.expires,
        }),
      );
      return { observed: false };
    }
    const pending = this.pending.get(id);
    this.pending.delete(id);
    if (
      !pending ||
      pending.at !== message.at ||
      pending.threadId !== message.threadId ||
      pending.documentId !== sender.documentId ||
      pending.binding.navigationNonce !== binding.navigationNonce
    )
      throw new Error("payload_rejected");
    const { ownership, epoch } = pending,
      scope = ownership.scope;
    const threadKey = await checked(
      hmacIdentity(ownership.secret, "perplexity", "route", message.threadId),
    );
    const matched = new Set<string>();
    const localKeys: string[] = [];
    const before = await checked(
      this.ledger.publicationSnapshot(scope.namespace),
    );
    if (before.erasing || before.erasureVersion !== epoch)
      throw new Error("deletion_in_progress");
    const companyEligible =
      scope.mode === "company" &&
      same(scope, await checked(this.currentScope()));
    const credentials = companyEligible
      ? await checked(this.company.credentials())
      : null;
    for (let offset = 0; offset < message.page!.requestIds.length; offset += 100) {
      if (companyEligible && !same(scope, await checked(this.currentScope())))
        throw new Error("policy_unavailable");
      const ids = message.page!.requestIds.slice(offset, offset + 100);
      const keys = await checked(Promise.all(ids.map((key) =>
        hmacIdentity(ownership.secret, "perplexity", "request", key),
      )));
      const linked = await this.linkKeys(scope, threadKey, keys, epoch, credentials, {
        checked,
        withCurrentRoute,
        current,
        verify: async () => {
          await routeGuard?.verify();
          this.admission.check(lease);
        },
        admitted: () => this.admission.check(lease),
      });
      localKeys.push(...linked.local);
      for (const key of [...linked.confirmed, ...linked.local]) matched.add(key);
      this.admission.renew(lease);
    }
    if (companyEligible && !same(scope, await checked(this.currentScope())))
      throw new Error("policy_unavailable");
    const after = await checked(
      this.ledger.publicationSnapshot(scope.namespace),
    );
    if (after.erasing || after.erasureVersion !== epoch)
      throw new Error("deletion_in_progress");
    await withCurrentRoute(async () =>
      this.pages.set(`${scope.namespace}:${threadKey}`, {
        observed: message.page!.requestIds.length,
        unmatched: message.page!.requestIds.length - matched.size,
        hasNext: message.page!.hasNextPage,
        expires: Date.now() + 600000,
        epoch,
        version: after.version,
      }),
    );
    while (this.pages.size > 128)
      this.pages.delete(this.pages.keys().next().value!);
    if (localKeys.length && this.onMatched)
      await withCurrentRoute(() =>
        this.onMatched!(
          {
            scope,
            threadKey,
            threadId: message.threadId,
            providerKeys: localKeys,
            erasureVersion: epoch,
            ownershipStart: ownership.start,
            binding: pending.binding,
            tabId: pending.tabId,
            documentId: pending.documentId,
          },
          current,
        ),
      );
    return { observed: true };
  }
  /**
   * Links recorded requests to a thread. With the company connected, the server confirms
   * first; a conflict it reports removes the local links it contradicts.
   */
  private async linkKeys(
    scope: Scope,
    threadKey: string,
    keys: string[],
    epoch: number,
    credentials: Awaited<ReturnType<CompanySession["credentials"]>> | null,
    guard: {
      checked: <T>(operation: Promise<T>) => Promise<T>;
      withCurrentRoute: <T>(operation: () => Promise<T>) => Promise<T>;
      current: () => void;
      verify: () => Promise<void>;
      admitted: () => void;
    },
  ) {
    const confirmedKeys: string[] = [];
    const relationVersions = await guard.checked(
      this.ledger.threadRelationVersions(scope.namespace, keys),
    );
    let confirmed:
      | { provider_request_key: string; status: "linked" | "not_recorded" }[]
      | undefined;
    if (
      credentials?.namespace === scope.namespace &&
      credentials.enrollment_era.id === scope.era
    ) {
      try {
        await guard.verify();
        const result = await guard.checked(this.company.linkThread(
            scope,
            threadKey,
            keys,
            credentials.policy.deletion_epoch,
        ));
        confirmed = result;
        for (const row of result)
          if (row.status === "linked") confirmedKeys.push(row.provider_request_key);
      } catch (error) {
        if ((error as any).code === "thread_relation_conflict") {
          // A completed authoritative rejection can still remove invalid local evidence after navigation.
          // It cannot add usage or associations, and the ledger independently checks scope and erasure.
          const changed = await this.ledger.rejectThreadLinks(
            scope,
            threadKey,
            keys,
            {
              erasureVersion: epoch,
              deviceId: credentials.device_id,
            },
          );
          if (changed) this.pages.delete(`${scope.namespace}:${threadKey}`);
        }
        guard.admitted();
        if (
          (error as any).code === "thread_relation_conflict" ||
          (error as any).code === "deletion_epoch_changed"
        )
          throw new Error((error as any).code);
        // Only locally recorded links remain queued; unmatched history IDs are never saved for retry.
      }
    }
    const local = await guard.withCurrentRoute(() => this.ledger.linkRecordedThread(
      scope,
      threadKey,
      keys,
      epoch,
      {
        keys:
          confirmed
            ?.filter((row) => row.status === "linked")
            .map((row) => row.provider_request_key) ?? [],
        versions: relationVersions,
      },
      guard.current,
    ));
    if (confirmed)
      await guard.checked(this.ledger.acknowledgeThreadLinks(
        scope.namespace,
        threadKey,
        confirmed,
        epoch,
      ));
    return { local, confirmed: confirmedKeys };
  }
  /**
   * Links a reply sent in this tab to the Perplexity thread the tab shows, so the bar
   * counts it live, as on other sites, instead of after the page next reads the thread
   * (owner, 5 Oct 2026). A reply joins only with proof that it belongs to the thread:
   * - A follow-up names the reply it continues (`parentId`), which must be the thread's
   *   first answer, whose id is the thread's id, or a reply saved in or linked to the
   *   thread (threadAnswer).
   * - A new thread opens at its first answer's id, so a reply sent from outside a thread
   *   joins when its own id (`attemptKey`) is the id of the thread the tab then opened.
   *   A reply already saved in or linked to the thread joins it again by the same key, as
   *   after a worker restart forgot the link of a capture still running.
   */
  async linkLiveReply(
    input: {
      scope: Scope;
      threadId: string;
      requestKey: string;
      dispatchedAt: string;
      binding: DisplayBinding;
      tabId: number;
      documentId?: string;
    } & ({ parentId: string } | { attemptKey: string }),
  ): Promise<boolean> {
    if (!isThreadId(input.threadId)) return false;
    if ("parentId" in input && !isThreadId(input.parentId)) return false;
    const history = await this.ledger.readOwnershipHistory();
    if (!history) return false;
    const ownership = ownershipAt(history, Date.parse(input.dispatchedAt));
    const scope = ownership.scope;
    if (!same(scope, input.scope)) return false;
    const before = await this.ledger.publicationSnapshot(scope.namespace);
    if (before.erasing) return false;
    const epoch = before.erasureVersion;
    const [threadKey, answerKey] = await Promise.all([
      hmacIdentity(ownership.secret, "perplexity", "route", input.threadId),
      hmacIdentity(
        ownership.secret,
        "perplexity",
        "attempt",
        "parentId" in input ? input.parentId : input.threadId,
      ),
    ]);
    if (
      "parentId" in input
        ? input.parentId !== input.threadId &&
          !(await this.ledger.threadAnswer(scope.namespace, threadKey, answerKey))
        : input.attemptKey !== answerKey &&
          !(await this.ledger.threadAnswer(
            scope.namespace,
            threadKey,
            input.attemptKey,
          ))
    )
      return false;
    const credentials =
      scope.mode === "company" && same(scope, await this.currentScope())
        ? await this.company.credentials()
        : null;
    const current = () => {};
    const { local } = await this.linkKeys(
      scope,
      threadKey,
      [input.requestKey],
      epoch,
      credentials,
      {
        checked: (operation) => operation,
        withCurrentRoute: (operation) => operation(),
        current,
        verify: async () => {},
        admitted: current,
      },
    );
    const after = await this.ledger.publicationSnapshot(scope.namespace);
    if (!local.length || after.erasing || after.erasureVersion !== epoch)
      return false;
    await this.onMatched?.(
      {
        scope,
        threadKey,
        threadId: input.threadId,
        providerKeys: local,
        erasureVersion: epoch,
        ownershipStart: ownership.start,
        binding: input.binding,
        tabId: input.tabId,
        documentId: input.documentId,
      },
      current,
    );
    return true;
  }
  async view(scope: Scope, threadKey: string, includeServer = true) {
    const calculation = await this.selectCalculation?.(scope);
    const before = await this.ledger.publicationSnapshot(scope.namespace);
    const scan = (pendingOnly: boolean) =>
      this.scanSelected
        ? this.scanSelected(scope, threadKey, pendingOnly)
        : scanSummary(
            this.ledger,
            scope.namespace,
            {},
            undefined,
            pendingOnly,
            threadKey,
          );
    const summary = await scan(false);
    const pending = scope.mode === "company" ? await scan(true) : null;
    let server: Record<string, unknown> | null = null,
      offline = false;
    let serverUnavailableReason: "unresolved_identity" | null = null;
    if (scope.mode === "company" && includeServer) {
      try {
        const result = await this.company.threadRequest(
          scope,
          `/v1/me/recorded-threads/${threadKey}/summary?period=all${calculation ? (calculation.method ? `&calculation_view=recalculated&method_id=${encodeURIComponent(calculation.method.method_id)}` : "&calculation_view=original") : ""}`,
        );
        const credentials = await this.company.credentials();
        if (
          Object.keys(result ?? {})
            .sort()
            .join(",") !==
            "coverage,deletion_epoch,key_version,site,status,summary,thread_key" ||
          result.site !== "perplexity" ||
          result.key_version !== "1" ||
          result.thread_key !== threadKey ||
          result.deletion_epoch !== credentials?.policy.deletion_epoch ||
          credentials?.namespace !== scope.namespace ||
          !["matched_recorded_subset", "unavailable"].includes(result.status) ||
          result.coverage?.scope !== "matched_recorded_requests" ||
          Object.keys(result.coverage).sort().join(",") !==
            "matched_request_count,provider_history_complete,scope" ||
          result.coverage.provider_history_complete !== false ||
          typeof result.coverage.matched_request_count !== "string" ||
          !/^(0|[1-9]\d{0,18})$/.test(result.coverage.matched_request_count)
        )
          throw new Error("payload_rejected");
        if (result.status === "matched_recorded_subset") {
          if (
            result.summary?.aggregate_status !== "current" ||
            result.coverage.matched_request_count === "0" ||
            typeof result.summary.request_count !== "string" ||
            !/^(0|[1-9]\d{0,18})$/.test(result.summary.request_count) ||
            result.summary.request_count !==
              result.coverage.matched_request_count
          )
            throw new Error("aggregate_inconsistent");
          const candidate = validatedSummary(result.summary);
          if (
            calculation?.method
              ? candidate.calculation_view !== "recalculated" ||
                candidate.method_id !== calculation.method.method_id ||
                candidate.method_hash !== calculation.method.method_hash
              : calculation &&
                candidate.calculation_view !== undefined &&
                candidate.calculation_view !== "original"
          )
            throw new Error("method_update_invalid");
          server = candidate;
        } else if (
          result.summary !== null ||
          result.coverage.matched_request_count !== "0"
        )
          throw new Error("payload_rejected");
      } catch (error) {
        server = null;
        if ((error as any).code === "thread_identity_unresolved")
          serverUnavailableReason = "unresolved_identity";
        // Offline means unreachable. A refusal such as recalculation_pending (normal for a while
        // after a server update) leaves the local figures shown and sync waiting (14 Oct 2026).
        else offline = isNetworkFailure(error);
      }
    }
    await calculation?.current();
    const current = await this.currentScope();
    const snapshot = await this.ledger.publicationSnapshot(
        scope.namespace,
        undefined,
        undefined,
        undefined,
        calculation?.guard,
      ),
      pageKey = `${scope.namespace}:${threadKey}`;
    if (snapshot.erasing) throw new Error("deletion_in_progress");
    if (
      !same(current, scope) ||
      !snapshot.calculationCurrent ||
      before.version !== snapshot.version ||
      before.erasureVersion !== snapshot.erasureVersion
    )
      throw new Error("aggregate_inconsistent");
    let page = this.pages.get(pageKey);
    if (
      page &&
      (page.expires < Date.now() ||
        page.epoch !== snapshot.erasureVersion ||
        page.version !== snapshot.version)
    ) {
      this.pages.delete(pageKey);
      page = undefined;
    }
    const recordedThread: RecordedThreadCoverage = {
      status:
        server || summary.requests ? "matched_recorded_subset" : "unavailable",
      providerHistoryComplete: false,
      observedPageRequests: page?.observed ?? null,
      unmatchedPageRequests: page?.unmatched ?? null,
      hasNextPage: page?.hasNext ?? null,
      coverageAfterRestart: page ? "observed_page" : "saved_links_only",
      serverUnavailableReason,
    };
    return {
      summary,
      calculationToken: calculation?.guard?.localSelectionToken ?? null,
      conversation: {
        source: server ? "server" : "local",
        server,
        pending,
        pendingObservationCount: pending?.pendingObservationCount ?? 0,
        cachedAt: null,
        offline,
      },
      recordedThread,
    };
  }
}
