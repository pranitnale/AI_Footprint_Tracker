import {
  methodTrustIdentity,
  resolveApplicationRepository,
  type ApplicationRepository,
  type RepositorySource,
  type Scope,
} from "@footprint/ledger";
import {
  canonicalJson,
  payloadHash,
  type AttemptObservation,
  type EstimationEnvelope,
} from "@footprint/contracts";
import {
  BASELINE_BUNDLE,
  BASELINE_METHOD_ID,
  BASELINE_METHOD_HASH,
  estimateAttempt,
  immutableMethodEnvelope,
  verifySignedMethodUpdate,
  type SignedMethodUpdate,
  type MethodBundle,
  type EstimateResult,
} from "@footprint/estimator";
import type { CompanySession } from "./company";
import { hmacIdentity } from "./ownership";
import { isEstimationEnvelope } from "./estimate-presentation";

export type MethodReason =
  | "trust_unconfigured"
  | "update_failed"
  | "expired_delivery"
  | "stored_method_invalid"
  | "scope_changed"
  | "catalog_full";
export interface MethodStatus {
  scopeToken: string;
  state: "baseline_only" | "loading" | "current" | "stale" | "failed";
  reason: MethodReason | null;
  checkedAt: string | null;
  lastValidAt: string | null;
  canRefresh: boolean;
  defaultMethodId: string;
  methods: Array<{
    id: string;
    hash: string;
    label: string;
    source: "packaged" | "enrollment";
    expiredForNewAdmission: boolean;
    provenance: {
      publisher: string;
      title: string;
      url: string;
      reviewDate: string;
    };
  }>;
}
type Accepted = {
  envelope: Readonly<SignedMethodUpdate>;
  acceptedAt: string;
  delivery?: Readonly<SignedMethodUpdate>;
  deliveryAcceptedAt?: string;
};
type Catalog = {
  namespace: string;
  version: 1;
  trust: string;
  records: Accepted[];
  checkedAt: string | null;
  lastValidAt: string | null;
  reason: MethodReason | null;
  seal: string;
};
const idPattern = /^[a-z0-9][a-z0-9.-]{0,127}$/;
const reasons: MethodReason[] = [
  "trust_unconfigured",
  "update_failed",
  "expired_delivery",
  "stored_method_invalid",
  "scope_changed",
  "catalog_full",
];
const same = (a: Scope, b: Scope) => canonicalJson(a) === canonicalJson(b);
const text = (value: string) =>
  value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 160);
const entry = (
  bundle: Readonly<MethodBundle>,
  source: "packaged" | "enrollment",
  expired = false,
) => ({
  id: bundle.method_id,
  hash: payloadHash(bundle),
  label: text(bundle.provenance.title + " (" + bundle.review_date + ")"),
  source,
  expiredForNewAdmission: expired,
  provenance: {
    publisher: text(bundle.provenance.publisher),
    title: text(bundle.provenance.title),
    url: bundle.provenance.url,
    reviewDate: text(bundle.review_date),
  },
});

/** A connection-scoped catalog. No update mutates the estimator's legacy process-global registry. */
export class MethodService {
  private work: Promise<void> | null = null;
  private refreshRequest: Promise<MethodStatus> | null = null;
  private loading = false;
  private lastAttempt = 0;
  private generation = 0;
  private controller: AbortController | null = null;
  private loadingTrust: string | null = null;
  private timeoutFailure: { trust: string; checkedAt: string } | null = null;
  private repository: ApplicationRepository;
  constructor(
    source: RepositorySource,
    private company: CompanySession,
    private currentScope: () => Promise<Scope>,
    private now = () => Date.now(),
  ) {
    this.repository = resolveApplicationRepository(source);
  }
  invalidate() {
    if (this.loading && this.loadingTrust)
      this.timeoutFailure = {
        trust: this.loadingTrust,
        checkedAt: new Date(this.now()).toISOString(),
      };
    this.generation++;
    this.controller?.abort();
  }
  private async context() {
    for (let retry = 0; retry < 3; retry++) {
      const scope = await this.currentScope(),
        before = await this.repository.publicationSnapshot(scope.namespace);
      const current = await this.currentScope();
      const snapshot = await this.repository.publicationSnapshot(
        scope.namespace,
      );
      if (
        !same(scope, current) ||
        methodTrustIdentity(before) !== methodTrustIdentity(snapshot) ||
        before.ownership?.start !== snapshot.ownership?.start ||
        before.erasureVersion !== snapshot.erasureVersion
      )
        continue;
      if (snapshot.erasing) throw new Error("deletion_in_progress");
      const c = snapshot.credentials;
      const trusted =
        scope.mode === "company" &&
        c?.namespace === scope.namespace &&
        c.enrollment_era?.id === scope.era &&
        (!c.enrollment_state || c.enrollment_state === "active")
          ? (c.method_public_key as string | null)
          : null;
      return { scope, snapshot, trust: methodTrustIdentity(snapshot), trusted };
    }
    throw new Error("policy_unavailable");
  }
  private async seal(value: Omit<Catalog, "seal">) {
    const installation = await this.repository.readInstallation();
    if (!installation?.routingSecret) throw new Error("method_update_invalid");
    return hmacIdentity(
      installation.routingSecret,
      "methods",
      "catalog",
      this.repository.methodCatalogDigest(value),
    );
  }
  private scopeToken(context: Awaited<ReturnType<MethodService["context"]>>) {
    return payloadHash({
      scope: context.scope,
      trust: context.trust,
      ownershipStart: context.snapshot.ownership?.start ?? null,
      erasureVersion: context.snapshot.erasureVersion,
    });
  }
  async authority() {
    const context = await this.context(),
      generation = this.generation;
    return {
      scope: context.scope,
      token: this.scopeToken(context),
      current: async () => {
        const next = await this.context();
        if (
          generation !== this.generation ||
          this.scopeToken(next) !== this.scopeToken(context)
        )
          throw new Error("policy_unavailable");
      },
    };
  }
  private async load(context: Awaited<ReturnType<MethodService["context"]>>) {
    const stored = (
      await this.repository.readMethodCatalog(context.scope.namespace)
    )?.catalog;
    if (!stored || stored.trust !== context.trust) {
      const after = await this.context();
      if (
        after.trust !== context.trust ||
        after.snapshot.ownership?.start !== context.snapshot.ownership?.start ||
        !same(after.scope, context.scope)
      )
        throw new Error("policy_unavailable");
      return {
        stored,
        records: [] as Accepted[],
        bundles: new Map<string, Readonly<MethodBundle>>(),
      };
    }
    if (
      Object.keys(stored).sort().join(",") !==
        "checkedAt,lastValidAt,namespace,reason,records,seal,trust,version" ||
      stored.version !== 1 ||
      stored.namespace !== context.scope.namespace ||
      !Array.isArray(stored.records) ||
      stored.records.length > 31 ||
      new TextEncoder().encode(canonicalJson(stored)).length >
        8 * 1024 * 1024 ||
      (stored.reason !== null && !reasons.includes(stored.reason))
    )
      throw new Error("method_update_invalid");
    const { seal, ...payload } = stored;
    if (typeof seal !== "string" || seal !== (await this.seal(payload)))
      throw new Error("method_update_invalid");
    const bundles = new Map<string, Readonly<MethodBundle>>();
    for (const record of stored.records) {
      const keys = Object.keys(record).sort().join(",");
      if (
        ![
          "acceptedAt,envelope",
          "acceptedAt,delivery,deliveryAcceptedAt,envelope",
        ].includes(keys) ||
        !context.trusted ||
        !Number.isFinite(Date.parse(record.acceptedAt)) ||
        Date.parse(record.acceptedAt) > this.now() + 300000
      )
        throw new Error("method_update_invalid");
      // Only sealed, atomically accepted internal records use their historical admission time.
      const b = await verifySignedMethodUpdate(
        record.envelope,
        context.trusted,
        Date.parse(record.acceptedAt),
      );
      if (b.method_id === BASELINE_METHOD_ID || bundles.has(b.method_id))
        throw new Error("method_update_invalid");
      if (record.delivery) {
        if (
          !record.deliveryAcceptedAt ||
          !Number.isFinite(Date.parse(record.deliveryAcceptedAt)) ||
          Date.parse(record.deliveryAcceptedAt) > this.now() + 300000
        )
          throw new Error("method_update_invalid");
        const renewed = await verifySignedMethodUpdate(
          record.delivery,
          context.trusted,
          Date.parse(record.deliveryAcceptedAt),
        );
        if (payloadHash(renewed) !== payloadHash(b))
          throw new Error("method_update_invalid");
      }
      bundles.set(b.method_id, b);
    }
    const after = await this.context();
    if (
      after.trust !== context.trust ||
      after.snapshot.ownership?.start !== context.snapshot.ownership?.start ||
      !same(after.scope, context.scope) ||
      after.snapshot.erasureVersion !== context.snapshot.erasureVersion
    )
      throw new Error("policy_unavailable");
    return { stored, records: stored.records, bundles };
  }
  async status(): Promise<MethodStatus> {
    const context = await this.context();
    const result: MethodStatus = {
      scopeToken: this.scopeToken(context),
      state: "baseline_only",
      reason:
        context.scope.mode === "company" && !context.trusted
          ? "trust_unconfigured"
          : null,
      checkedAt: null,
      lastValidAt: null,
      canRefresh: !!context.trusted,
      defaultMethodId: BASELINE_METHOD_ID,
      methods: [entry(BASELINE_BUNDLE, "packaged")],
    };
    if (!context.trusted) return result;
    try {
      const { stored, records, bundles } = await this.load(context);
      const applicable = stored?.trust === context.trust ? stored : undefined;
      let expired = false;
      for (const record of records) {
        const b = bundles.get(
          (record.envelope.bundle as MethodBundle).method_id,
        )!;
        const stale =
          Date.parse((record.delivery ?? record.envelope).expires_at) <=
          this.now();
        expired ||= stale;
        result.methods.push(entry(b, "enrollment", stale));
      }
      result.checkedAt = applicable?.checkedAt ?? null;
      result.lastValidAt = applicable?.lastValidAt ?? null;
      result.reason =
        applicable?.reason ?? (expired ? "expired_delivery" : null);
      result.state =
        this.loading && this.loadingTrust === context.trust
          ? "loading"
          : result.reason
            ? records.length
              ? "stale"
              : "failed"
            : applicable
              ? "current"
              : "baseline_only";
    } catch (error) {
      result.state = "failed";
      result.reason =
        error instanceof Error && error.message === "policy_unavailable"
          ? "scope_changed"
          : "stored_method_invalid";
    }
    if (this.timeoutFailure?.trust === context.trust) {
      result.state = result.methods.length > 1 ? "stale" : "failed";
      result.reason = "update_failed";
      result.checkedAt = this.timeoutFailure.checkedAt;
    }
    return result;
  }
  refresh(force = false): Promise<MethodStatus> {
    if (this.refreshRequest) return this.refreshRequest;
    const request = this.refreshOnce(force).finally(() => {
      if (this.refreshRequest === request) this.refreshRequest = null;
    });
    this.refreshRequest = request;
    return request;
  }
  private async refreshOnce(force = false): Promise<MethodStatus> {
    const context = await this.context();
    if (!context.trusted) return this.status();
    if (this.work && this.loadingTrust !== context.trust)
      return {
        ...(await this.status()),
        state: "failed",
        reason: "scope_changed",
      };
    if (this.work || this.now() - this.lastAttempt < (force ? 1000 : 300000))
      return this.status();
    this.lastAttempt = this.now();
    this.loading = true;
    this.loadingTrust = context.trust;
    this.timeoutFailure = null;
    const generation = this.generation,
      deadline = this.now() + 30000,
      controller = new AbortController();
    this.controller = controller;
    const valid = () =>
      generation === this.generation &&
      !controller.signal.aborted &&
      this.now() < deadline;
    const physical = this.download(context, controller.signal, valid).finally(
      () => {
        if (this.now() >= deadline)
          this.timeoutFailure = {
            trust: context.trust,
            checkedAt: new Date(this.now()).toISOString(),
          };
        this.loading = false;
        if (this.work === physical) this.work = null;
        if (this.controller === controller) this.controller = null;
      },
    );
    this.work = physical;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      physical.catch(() => {}),
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          this.loading = false;
          this.timeoutFailure = {
            trust: context.trust,
            checkedAt: new Date(this.now()).toISOString(),
          };
          resolve();
        }, 30000);
      }),
    ]);
    if (timer) clearTimeout(timer);
    return this.status();
  }
  private async download(
    context: Awaited<ReturnType<MethodService["context"]>>,
    signal: AbortSignal,
    valid: () => boolean,
  ) {
    const raw = await this.repository.readMethodCatalog(
      context.scope.namespace,
    );
    let records: Accepted[] = [];
    let stored: Catalog | undefined;
    try {
      const loaded = await this.load(context);
      records = [...loaded.records];
      stored =
        loaded.stored?.trust === context.trust ? loaded.stored : undefined;
    } catch {}
    const commit = async (
      reason: MethodReason | null,
      success: boolean,
      next = records,
      admissionDeadlines: readonly number[] = [],
    ) => {
      const payload: Omit<Catalog, "seal"> = {
        namespace: context.scope.namespace,
        version: 1,
        trust: context.trust,
        records: next,
        checkedAt: new Date(this.now()).toISOString(),
        lastValidAt: success
          ? new Date(this.now()).toISOString()
          : (stored?.lastValidAt ?? null),
        reason,
      };
      const value = { ...payload, seal: await this.seal(payload) };
      await this.repository.commitMethodCatalog(
        context.scope.namespace,
        value,
        {
          trust: context.trust,
          erasureVersion: context.snapshot.erasureVersion,
          previousHash: raw?.revision ?? null,
          ownershipStart: context.snapshot.ownership?.start ?? null,
        },
        () =>
          valid() && admissionDeadlines.every((expiry) => this.now() < expiry),
      );
    };
    try {
      const inventory = await this.company.methodRequest(
        context.scope,
        "/v1/me/method-updates",
        signal,
      );
      const keyBytes = Uint8Array.from(atob(context.trusted!), (c) =>
        c.charCodeAt(0),
      );
      const fingerprint = [
        ...new Uint8Array(await crypto.subtle.digest("SHA-256", keyBytes)),
      ]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
      if (
        !valid() ||
        Object.keys(inventory ?? {})
          .sort()
          .join(",") !== "delivery_status,methods,trust_fingerprint" ||
        inventory.trust_fingerprint !== fingerprint ||
        inventory.delivery_status !== "available" ||
        !Array.isArray(inventory.methods) ||
        inventory.methods.length > 31
      )
        throw new Error("method_update_invalid");
      const ids = new Set<string>();
      const staged = [...records];
      const admissionDeadlines: number[] = [];
      for (const row of inventory.methods) {
        if (
          Object.keys(row ?? {})
            .sort()
            .join(",") !== "expires_at,issued_at,method_hash,method_id" ||
          typeof row.method_id !== "string" ||
          !idPattern.test(row.method_id) ||
          row.method_id === BASELINE_METHOD_ID ||
          ids.has(row.method_id) ||
          !/^[a-f0-9]{64}$/.test(row.method_hash) ||
          !Number.isFinite(Date.parse(row.issued_at)) ||
          !Number.isFinite(Date.parse(row.expires_at))
        )
          throw new Error("method_update_invalid");
        ids.add(row.method_id);
        const old = staged.find(
          (record) =>
            (record.envelope.bundle as MethodBundle).method_id ===
            row.method_id,
        );
        if (old && old.envelope.bundle_hash !== row.method_hash)
          throw new Error("method_update_invalid");
        if (
          old &&
          Date.parse((old.delivery ?? old.envelope).issued_at) >=
            Date.parse(row.issued_at)
        )
          continue;
        if (!valid()) throw new Error("policy_unavailable");
        const envelope = immutableMethodEnvelope(
          await this.company.methodRequest(
            context.scope,
            "/v1/me/method-updates/" + row.method_id,
            signal,
          ),
        );
        const bundle = await verifySignedMethodUpdate(
          envelope,
          context.trusted!,
          this.now(),
        );
        const acceptedAt = this.now();
        const expiry = Date.parse(envelope.expires_at);
        if (
          !valid() ||
          acceptedAt >= expiry ||
          bundle.method_id !== row.method_id ||
          envelope.bundle_hash !== row.method_hash ||
          envelope.issued_at !== row.issued_at ||
          envelope.expires_at !== row.expires_at
        )
          throw new Error("method_update_invalid");
        admissionDeadlines.push(expiry);
        if (old)
          staged[staged.indexOf(old)] = {
            ...old,
            delivery: envelope,
            deliveryAcceptedAt: new Date(acceptedAt).toISOString(),
          };
        else
          staged.push({
            envelope,
            acceptedAt: new Date(acceptedAt).toISOString(),
          });
        if (
          staged.length > 31 ||
          new TextEncoder().encode(canonicalJson(staged)).length >
            7 * 1024 * 1024
        )
          throw new Error("method_update_invalid");
      }
      await commit(null, true, staged, admissionDeadlines);
    } catch {
      if (valid()) {
        this.timeoutFailure = {
          trust: context.trust,
          checkedAt: new Date(this.now()).toISOString(),
        };
        await commit("update_failed", false).catch(() => {});
      }
    }
  }
  async selection(scope: Scope, methodId: string) {
    if (typeof methodId !== "string" || !idPattern.test(methodId))
      throw new Error("method_unsupported");
    const context = await this.context();
    if (!same(context.scope, scope)) throw new Error("policy_unavailable");
    let bundle: Readonly<MethodBundle> | undefined =
      methodId === BASELINE_METHOD_ID ? BASELINE_BUNDLE : undefined;
    if (!bundle && context.trusted)
      bundle = (await this.load(context)).bundles.get(methodId);
    if (!bundle) throw new Error("method_unsupported");
    const pinned = bundle,
      generation = this.generation;
    return {
      methodId,
      methodHash: payloadHash(pinned),
      trust: context.trust,
      estimate: (
        a: AttemptObservation,
        original: EstimateResult | EstimationEnvelope | undefined,
      ) => {
        const source =
          original && isEstimationEnvelope(original) ? original.source : null;
        if (
          generation !== this.generation ||
          !original ||
          original.view !== "original" ||
          (source
            ? source.family !== "live" ||
              source.attempt_hash !== payloadHash(a) ||
              source.attempt_revision !== a.revision
            : (original as EstimateResult).observation_hash !==
                payloadHash(a) ||
              (original as EstimateResult).observation_revision !== a.revision)
        )
          throw new Error("method_update_invalid");
        return estimateAttempt(
          a,
          {
            methodId,
            view: "recalculated",
            originalMethodHash: isEstimationEnvelope(original)
              ? original.requested_method.method_hash
              : original.method_hash,
          },
          pinned,
        );
      },
      current: async () => {
        const after = await this.context();
        if (
          generation !== this.generation ||
          after.trust !== context.trust ||
          after.snapshot.ownership?.start !==
            context.snapshot.ownership?.start ||
          !same(after.scope, scope) ||
          after.snapshot.erasureVersion !== context.snapshot.erasureVersion
        )
          throw new Error("policy_unavailable");
      },
    };
  }
}
