import type { DisplayBinding } from "@footprint/capture-core";
import { HISTORY_LIMITS } from "./history-limits";

export interface HistoryLease {
  key: string;
  tabId: number;
  binding: DisplayBinding;
  valid: boolean;
  inFlight: boolean;
  stage: "start" | "ready" | "batch" | "page";
  expires: number;
  timeout: ReturnType<typeof setTimeout>;
  expired: Promise<never>;
  rejectExpiry: () => void;
}
type Budget = { starts: number[]; seen: Map<string, number> };
/** Admission is reserved synchronously; expired physical work retains its slot until it settles. */
export class HistoryAdmission {
  private leases = new Map<string, HistoryLease>();
  private budgets = new Map<number, Budget>();
  constructor(private onCancel?: (lease: HistoryLease) => void) {}
  admit(
    event: "start" | "batch" | "progress" | "page" | "finish",
    id: string,
    binding: DisplayBinding,
    tabId: number,
    startedAt = Date.now(),
  ): HistoryLease | null {
    const now = Date.now(),
      key = `${tabId}:${binding.documentNonce}:${id}`;
    const existing = this.leases.get(key);
    if (event !== "start") {
      if (
        !existing ||
        existing.stage !== "ready" ||
        existing.binding.navigationNonce !== binding.navigationNonce
      )
        throw new Error("history_unavailable");
      this.check(existing);
      existing.stage =
        event === "batch" || event === "progress" ? "batch" : "page";
      existing.inFlight = true;
      return existing;
    }
    if (
      !Number.isFinite(startedAt) ||
      Math.abs(now - startedAt) >= HISTORY_LIMITS.lifecycleMs
    )
      throw new Error("history_unavailable");
    for (const [tab, budget] of this.budgets) {
      budget.starts = budget.starts.filter(
        (at) => now - at < HISTORY_LIMITS.windowMs,
      );
      for (const [seen, expires] of budget.seen)
        if (expires <= now) budget.seen.delete(seen);
      if (!budget.starts.length && !budget.seen.size) this.budgets.delete(tab);
    }
    const budget = this.budgets.get(tabId) ?? {
      starts: [],
      seen: new Map<string, number>(),
    };
    if (existing || budget.seen.has(key)) return null;
    let active = 0;
    for (const lease of this.leases.values())
      if (lease.tabId === tabId) active++;
    if (
      active >= HISTORY_LIMITS.maxActive ||
      budget.starts.length >= HISTORY_LIMITS.startsPerWindow ||
      (!this.budgets.has(tabId) &&
        this.budgets.size >= HISTORY_LIMITS.maxTabs) ||
      this.leases.size >= HISTORY_LIMITS.maxTabs * HISTORY_LIMITS.maxActive
    )
      throw new Error("history_rate_limited");
    budget.starts.push(now);
    budget.seen.set(key, now + HISTORY_LIMITS.lifecycleMs);
    this.budgets.set(tabId, budget);
    let rejectExpiry!: () => void;
    const expired = new Promise<never>((_, reject) => {
      rejectExpiry = () => reject(new Error("history_unavailable"));
    });
    const lease: HistoryLease = {
      key,
      tabId,
      binding: { ...binding },
      valid: true,
      inFlight: true,
      stage: "start",
      expires: Math.min(
        now + HISTORY_LIMITS.lifecycleMs,
        startedAt + HISTORY_LIMITS.lifecycleMs,
      ),
      timeout: undefined as unknown as ReturnType<typeof setTimeout>,
      expired,
      rejectExpiry,
    };
    lease.timeout = setTimeout(() => this.cancel(lease), lease.expires - now);
    (lease.timeout as unknown as { unref?: () => void }).unref?.();
    this.leases.set(key, lease);
    return lease;
  }
  check(lease: HistoryLease) {
    if (
      !lease.valid ||
      this.leases.get(lease.key) !== lease ||
      Date.now() >= lease.expires
    ) {
      this.cancel(lease);
      throw new Error("history_unavailable");
    }
  }
  renew(lease: HistoryLease) {
    this.check(lease);
    lease.expires = Date.now() + HISTORY_LIMITS.lifecycleMs;
    clearTimeout(lease.timeout);
    lease.timeout = setTimeout(
      () => this.cancel(lease),
      HISTORY_LIMITS.lifecycleMs,
    );
    (lease.timeout as unknown as { unref?: () => void }).unref?.();
  }
  private cancel(lease: HistoryLease) {
    if (lease.valid) {
      lease.valid = false;
      clearTimeout(lease.timeout);
      this.onCancel?.(lease);
      lease.rejectExpiry();
    }
    if (!lease.inFlight) this.leases.delete(lease.key);
  }
  private settle(
    lease: HistoryLease,
    event: "start" | "batch" | "progress" | "page" | "finish",
    succeeded: boolean,
  ) {
    lease.inFlight = false;
    if (
      (event === "start" || event === "batch" || event === "progress") &&
      succeeded &&
      lease.valid
    ) {
      lease.stage = "ready";
      if (event === "batch" || event === "progress") {
        try {
          this.renew(lease);
        } catch {
          this.cancel(lease);
        }
      }
      return;
    }
    lease.valid = false;
    clearTimeout(lease.timeout);
    if (this.leases.get(lease.key) === lease) this.leases.delete(lease.key);
  }
  run<T>(
    lease: HistoryLease,
    event: "start" | "batch" | "progress" | "page" | "finish",
    work: () => Promise<T>,
  ): Promise<T> {
    const operation = Promise.resolve().then(() => {
      this.check(lease);
      return work();
    });
    void operation.then(
      () => this.settle(lease, event, true),
      () => this.settle(lease, event, false),
    );
    return Promise.race([operation, lease.expired]);
  }
  invalidate(tabId: number, documentNonce?: string) {
    for (const lease of this.leases.values())
      if (
        lease.tabId === tabId &&
        (!documentNonce || lease.binding.documentNonce === documentNonce)
      )
        this.cancel(lease);
    if (!documentNonce) this.budgets.delete(tabId);
  }
  invalidateAll() {
    for (const lease of this.leases.values()) this.cancel(lease);
  }
}
