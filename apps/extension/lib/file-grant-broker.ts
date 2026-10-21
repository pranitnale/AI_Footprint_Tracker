import {
  validFileResult,
  validateFileJob,
  withFileTokenizerSelection,
  type AccessibleFileJob,
  type FileCountResult,
} from "@footprint/file-text/types";
import {
  snapshotCountingRuntime,
  type CountingRuntime,
} from "@footprint/tokenizers/metadata";
import { PACKAGED_COUNTING_RUNTIME } from "./counting-config";
import {
  validFileReceiptResult,
  utf8ExtractedByteLength,
} from "./file-receipt-result";
import {
  FILE_PROVIDER_ORIGINS,
  FILE_RELAY_LIMITS,
  fileKeys,
  fileUuid,
  validFileGrantRequest,
  validFileBinding,
  validFileReceiptBind,
  type FileBinding,
  type FileSpec,
  type FileGrantReply,
} from "./file-relay-protocol";
export type FileSender = {
  id?: string;
  url?: string;
  tab?: { id?: number };
  frameId?: number;
  documentId?: string;
};
export type FileParent = {
  tabId: number;
  documentId: string | null;
  url: string;
  origin: string;
  binding: FileBinding;
  fileHandle: string;
  captureId: string | null;
};
export type FileReceiptBasis = {
  scope: {
    namespace: string;
    mode: "personal" | "company";
    era: string | null;
  };
  erasureVersion: number;
  ownershipStart: number;
  ownershipEnd: number | null;
  deviceId: string | null;
  enrollmentState: string | null;
};
export type FileReceiptRead = {
  status: "pending" | "unavailable" | "expired" | "complete";
  result: FileCountResult | null;
  basis: FileReceiptBasis | null;
  observedAt: number | null;
  spec:
    | (FileSpec & {
        jobId: string;
        revision: 1;
        textBytes: number | null;
        tokenizerImplementationId?: string;
        tokenizerProfileId?: string;
      })
    | null;
  validNow: () => boolean;
};
type Relay = {
  frameId: number;
  documentId: string | null;
  nonce: string;
  token: string;
  clientId?: string;
};
type Entry = {
  grant: string;
  spec: FileSpec;
  jobId: string;
  parent: FileParent;
  basis: string | null;
  observedAt: number;
  fence: number;
  textBytes?: number;
  receiptExpires: number;
  expires: number;
  phase:
    "issuing" | "granted" | "redeemed" | "registered" | "counting" | "complete";
  relay?: Relay;
  invalid: boolean;
  physical: number;
  abort: AbortController;
  cancelled: Promise<void>;
  cancel: () => void;
  timer: ReturnType<typeof setTimeout>;
};
type Stored = { entry: Entry; result: FileCountResult; expires: number };
export type FileBrokerDependencies = {
  extensionId: string;
  relayUrl: string;
  snapshot: (observedAt: number) => Promise<string>;
  parentCurrent: (parent: FileParent) => Promise<boolean>;
  count: (
    job: AccessibleFileJob,
    signal: AbortSignal,
  ) => Promise<FileCountResult>;
  clock?: () => number;
  workAvailable?: () => boolean;
  routingVersion?: () => number;
  counting?: CountingRuntime;
};
const fail = (): never => {
  throw new Error("file_unavailable");
};
/** One global admission, including asynchronous authorization and cancelled but unresolved physical work. */
export class FileGrantBroker {
  private active: Entry | null = null;
  private results = new Map<string, Stored>();
  private entries = new Map<string, Entry>();
  private listeners = new Set<(fileHandle: string) => void>();
  private generation = 0;
  private readonly counting: CountingRuntime;
  constructor(private dependencies: FileBrokerDependencies) {
    this.counting = snapshotCountingRuntime(
      dependencies.counting ?? PACKAGED_COUNTING_RUNTIME,
    );
  }
  isBusy(): boolean {
    this.sweep();
    return this.active !== null;
  }
  onReceipt(listener: (fileHandle: string) => void): () => void {
    if (this.listeners.size >= 4) fail();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private changed(entry: Entry) {
    for (const listener of this.listeners) {
      try {
        listener(entry.spec.fileHandle);
      } catch {}
    }
  }
  private now() {
    return this.dependencies.clock?.() ?? Date.now();
  }
  private assert(entry: Entry) {
    if (entry.invalid || this.active !== entry || this.now() >= entry.expires)
      fail();
  }
  private cancelEntry(entry: Entry) {
    if (entry.invalid) return;
    entry.invalid = true;
    entry.abort.abort();
    entry.cancel();
    clearTimeout(entry.timer);
    this.changed(entry);
    if (!entry.physical && this.active === entry) this.active = null;
  }
  invalidate(tabId?: number) {
    this.generation++;
    if (
      this.active &&
      (tabId === undefined || this.active.parent.tabId === tabId)
    )
      this.cancelEntry(this.active);
    for (const [handle, result] of this.results)
      if (tabId === undefined || result.entry.parent.tabId === tabId)
        this.results.delete(handle);
    for (const [handle, entry] of this.entries)
      if (tabId === undefined || entry.parent.tabId === tabId)
        this.entries.delete(handle);
  }
  private async run<T>(entry: Entry, operation: () => Promise<T>): Promise<T> {
    this.assert(entry);
    entry.physical++;
    const physical = Promise.resolve()
      .then(operation)
      .finally(() => {
        entry.physical--;
        if (entry.invalid && !entry.physical && this.active === entry)
          this.active = null;
      });
    return Promise.race([physical, entry.cancelled.then(() => fail())]);
  }
  private parent(
    sender: FileSender,
    binding: FileBinding,
    fileHandle: string,
  ): FileParent {
    if (
      sender.id !== this.dependencies.extensionId ||
      sender.tab?.id === undefined ||
      sender.frameId !== 0
    )
      fail();
    let url: URL;
    try {
      url = new URL(sender.url!);
    } catch {
      return fail();
    }
    if (
      !FILE_PROVIDER_ORIGINS.includes(url.origin as any) ||
      url.username ||
      url.password
    )
      fail();
    return {
      tabId: sender.tab!.id!,
      documentId: sender.documentId ?? null,
      url: url.href,
      origin: url.origin,
      binding: structuredClone(binding),
      fileHandle,
      captureId: null,
    };
  }
  private sameParent(
    entry: Entry,
    sender: FileSender,
    binding: unknown,
    fileHandle: unknown,
  ) {
    return (
      sender.id === this.dependencies.extensionId &&
      sender.tab?.id === entry.parent.tabId &&
      sender.frameId === 0 &&
      typeof sender.url === "string" &&
      sender.url.startsWith(entry.parent.origin + "/") &&
      (sender.documentId ?? null) === entry.parent.documentId &&
      validFileBinding(binding) &&
      JSON.stringify(binding) === JSON.stringify(entry.parent.binding) &&
      fileHandle === entry.spec.fileHandle
    );
  }
  private async current(entry: Entry) {
    for (let retry = 0; retry < 3; retry++) {
      const fence = this.dependencies.routingVersion?.() ?? 0;
      this.assert(entry);
      const before = await this.dependencies.snapshot(entry.observedAt);
      this.assert(entry);
      if (entry.basis !== null && before !== entry.basis) fail();
      if (!(await this.dependencies.parentCurrent(entry.parent))) fail();
      this.assert(entry);
      const after = await this.dependencies.snapshot(entry.observedAt);
      this.assert(entry);
      if (before !== after) fail();
      if (entry.basis === null) entry.basis = after;
      if (fence !== (this.dependencies.routingVersion?.() ?? 0)) continue;
      entry.fence = fence;
      return;
    }
    fail();
  }
  async issue(value: unknown, sender: FileSender): Promise<FileGrantReply> {
    if (!validFileGrantRequest(value))
      return { status: "unavailable", code: "file_unavailable" };
    if (
      value.observedAt > this.now() ||
      this.now() - value.observedAt >= FILE_RELAY_LIMITS.timeoutMs
    )
      return { status: "unavailable", code: "file_unavailable" };
    let parent: FileParent;
    try {
      parent = this.parent(sender, value.binding, value.fileHandle);
    } catch {
      return { status: "unavailable", code: "file_unavailable" };
    }
    this.sweep();
    if (this.active || this.dependencies.workAvailable?.() === false)
      return { status: "unavailable", code: "file_busy" };
    if (
      this.entries.has(value.fileHandle) ||
      this.entries.size >= FILE_RELAY_LIMITS.results
    )
      return { status: "unavailable", code: "file_unavailable" };
    let cancel!: () => void;
    const cancelled = new Promise<void>((resolve) => {
      cancel = resolve;
    });
    const entry: Entry = {
      grant: crypto.randomUUID(),
      spec: {
        fileHandle: value.fileHandle,
        kind: value.kind,
        size: value.size,
      },
      jobId: crypto.randomUUID(),
      parent,
      basis: null,
      observedAt: value.observedAt,
      fence: this.dependencies.routingVersion?.() ?? 0,
      receiptExpires:
        value.observedAt +
        FILE_RELAY_LIMITS.timeoutMs +
        FILE_RELAY_LIMITS.resultTtlMs,
      expires: value.observedAt + FILE_RELAY_LIMITS.timeoutMs,
      phase: "issuing",
      invalid: false,
      physical: 0,
      abort: new AbortController(),
      cancelled,
      cancel,
      timer: null as any,
    };
    entry.timer = setTimeout(
      () => this.cancelEntry(entry),
      entry.expires - this.now(),
    );
    this.active = entry;
    try {
      return await this.run(entry, async () => {
        await this.current(entry);
        entry.phase = "granted";
        this.entries.set(entry.spec.fileHandle, entry);
        return {
          status: "granted",
          grant: entry.grant,
          expiresAt: entry.expires,
        } as const;
      });
    } catch {
      this.cancelEntry(entry);
      return { status: "unavailable", code: "file_unavailable" };
    }
  }
  private relay(
    entry: Entry,
    sender: FileSender,
    nonce: string,
    token?: string,
  ) {
    return (
      sender.id === this.dependencies.extensionId &&
      sender.url === this.dependencies.relayUrl &&
      sender.tab?.id === entry.parent.tabId &&
      Number.isInteger(sender.frameId) &&
      sender.frameId! > 0 &&
      fileUuid(nonce) &&
      (!entry.relay ||
        (entry.relay.frameId === sender.frameId &&
          entry.relay.documentId === (sender.documentId ?? null) &&
          entry.relay.nonce === nonce &&
          entry.relay.token === token))
    );
  }
  async redeem(value: unknown, sender: FileSender): Promise<any> {
    const entry = this.active;
    if (
      !entry ||
      !fileKeys(value, ["target", "grant", "parentOrigin", "relayNonce"]) ||
      value.target !== "file-relay-redeem" ||
      value.grant !== entry.grant ||
      value.parentOrigin !== entry.parent.origin ||
      entry.phase !== "granted" ||
      !this.relay(entry, sender, value.relayNonce)
    )
      return { status: "unavailable" };
    entry.phase = "redeemed";
    entry.relay = {
      frameId: sender.frameId!,
      documentId: sender.documentId ?? null,
      nonce: value.relayNonce,
      token: crypto.randomUUID(),
    };
    try {
      return await this.run(entry, async () => {
        await this.current(entry);
        return {
          status: "redeemed",
          token: entry.relay!.token,
          spec: { ...entry.spec, jobId: entry.jobId },
          expiresAt: entry.expires,
        };
      });
    } catch {
      this.cancelEntry(entry);
      return { status: "unavailable" };
    }
  }
  async register(
    value: unknown,
    source: { url?: string; id?: string },
  ): Promise<any> {
    const entry = this.active;
    if (
      !entry ||
      !fileKeys(value, ["target", "token", "relayNonce"]) ||
      value.target !== "file-relay-register" ||
      entry.phase !== "redeemed" ||
      source.url !== this.dependencies.relayUrl ||
      !source.id ||
      source.id.length > 256 ||
      !entry.relay ||
      entry.relay.token !== value.token ||
      entry.relay.nonce !== value.relayNonce
    )
      return { status: "unavailable" };
    entry.phase = "registered";
    entry.relay.clientId = source.id;
    try {
      return await this.run(entry, async () => {
        await this.current(entry);
        return { status: "ready" };
      });
    } catch {
      this.cancelEntry(entry);
      return { status: "unavailable" };
    }
  }
  async submit(
    value: unknown,
    source: { url?: string; id?: string } | FileSender,
    firefox = false,
  ): Promise<{ status: "complete" | "unavailable" }> {
    const entry = this.active;
    if (
      !entry ||
      !fileKeys(value, ["target", "token", "relayNonce", "job"]) ||
      value.target !== "file-relay-count" ||
      !entry.relay ||
      entry.relay.token !== value.token ||
      entry.relay.nonce !== value.relayNonce
    )
      return { status: "unavailable" };
    if (
      firefox
        ? entry.phase !== "redeemed" ||
          !this.relay(
            entry,
            source as FileSender,
            value.relayNonce,
            value.token,
          )
        : entry.phase !== "registered" ||
          source.url !== this.dependencies.relayUrl ||
          source.id !== entry.relay.clientId
    )
      return { status: "unavailable" };
    try {
      validateFileJob(value.job);
      if (
        value.job.jobId !== entry.jobId ||
        value.job.revision !== 1 ||
        value.job.kind !== entry.spec.kind ||
        value.job.bytes.byteLength !== entry.spec.size ||
        (value.job.tokenizerImplementationId !== undefined &&
          value.job.tokenizerImplementationId !==
            this.counting.selection.implementationId) ||
        (value.job.tokenizerProfileId !== undefined &&
          value.job.tokenizerProfileId !== this.counting.selection.profileId)
      )
        fail();
    } catch {
      this.cancelEntry(entry);
      return { status: "unavailable" };
    }
    entry.phase = "counting";
    const job = withFileTokenizerSelection(value.job, this.counting);
    if (value.job.kind === "text")
      entry.textBytes = utf8ExtractedByteLength(value.job.bytes);
    try {
      return await this.run(entry, async () => {
        await this.current(entry);
        const result = await this.dependencies.count(job, entry.abort.signal);
        this.assert(entry);
        if (
          !validFileReceiptResult(
            result,
            job,
            entry.spec.size,
            undefined,
            this.counting.manifest,
          )
        )
          fail();
        await this.current(entry);
        this.sweep();
        this.assert(entry);
        if (entry.fence !== (this.dependencies.routingVersion?.() ?? 0)) fail();
        if (this.results.size >= FILE_RELAY_LIMITS.results) fail();
        this.results.set(entry.spec.fileHandle, {
          entry,
          result: structuredClone(result),
          expires: this.now() + FILE_RELAY_LIMITS.resultTtlMs,
        });
        entry.phase = "complete";
        clearTimeout(entry.timer);
        entry.invalid = true;
        this.changed(entry);
        return { status: "complete" } as const;
      });
    } catch {
      this.cancelEntry(entry);
      return { status: "unavailable" };
    }
  }
  cancel(value: unknown, sender: FileSender): void {
    if (
      fileKeys(value, ["target", "binding", "fileHandle"]) &&
      value.target === "file-grant-cancel"
    ) {
      const stored = this.results.get(value.fileHandle);
      if (
        stored &&
        this.sameParent(stored.entry, sender, value.binding, value.fileHandle)
      )
        this.results.delete(value.fileHandle);
    }
    const entry = this.active;
    if (!entry) return;
    if (
      fileKeys(value, ["target", "binding", "fileHandle"]) &&
      value.target === "file-grant-cancel" &&
      this.sameParent(entry, sender, value.binding, value.fileHandle)
    )
      this.cancelEntry(entry);
    else if (
      fileKeys(value, ["target", "token", "relayNonce"]) &&
      value.target === "file-relay-cancel" &&
      entry.relay &&
      this.relay(entry, sender, value.relayNonce, value.token)
    )
      this.cancelEntry(entry);
  }
  cancelClient(value: unknown, source: { url?: string; id?: string }): void {
    const entry = this.active;
    if (
      entry?.relay &&
      fileKeys(value, ["target", "token", "relayNonce"]) &&
      value.target === "file-relay-cancel" &&
      value.token === entry.relay.token &&
      value.relayNonce === entry.relay.nonce &&
      source.url === this.dependencies.relayUrl &&
      source.id === entry.relay.clientId
    )
      this.cancelEntry(entry);
  }
  sweep() {
    for (const [handle, value] of this.results)
      if (value.expires <= this.now()) this.results.delete(handle);
    for (const [handle, entry] of this.entries)
      if (entry.receiptExpires <= this.now()) this.entries.delete(handle);
    if (
      this.active &&
      !this.active.invalid &&
      this.active.expires <= this.now()
    )
      this.cancelEntry(this.active);
  }
  /** Trusted association code may inspect this result later; the result remains explicitly unassociated. */
  async bind(value: unknown, sender: FileSender): Promise<{ bound: boolean }> {
    if (!validFileReceiptBind(value)) return { bound: false };
    this.sweep();
    const entry =
      this.active?.spec.fileHandle === value.fileHandle
        ? this.active
        : this.entries.get(value.fileHandle);
    if (
      !entry ||
      !this.sameParent(entry, sender, value.binding, value.fileHandle) ||
      (entry.parent.captureId !== null &&
        entry.parent.captureId !== value.captureId)
    )
      return { bound: false };
    const parent = { ...entry.parent, captureId: value.captureId },
      generation = this.generation,
      fence = this.dependencies.routingVersion?.() ?? 0;
    try {
      if (
        (await this.dependencies.snapshot(entry.observedAt)) !== entry.basis ||
        !(await this.dependencies.parentCurrent(parent)) ||
        (await this.dependencies.snapshot(entry.observedAt)) !== entry.basis ||
        generation !== this.generation ||
        fence !== (this.dependencies.routingVersion?.() ?? 0) ||
        (entry.parent.captureId !== null &&
          entry.parent.captureId !== value.captureId) ||
        entry.receiptExpires <= this.now() ||
        (this.active !== entry && this.entries.get(value.fileHandle) !== entry)
      )
        return { bound: false };
      entry.parent = parent;
      return { bound: true };
    } catch {
      return { bound: false };
    }
  }
  private async getUnassociated(
    fileHandle: string,
  ): Promise<FileCountResult | null> {
    this.sweep();
    const stored = this.results.get(fileHandle),
      generation = this.generation,
      fence = this.dependencies.routingVersion?.() ?? 0;
    if (!stored) return null;
    try {
      if (
        (await this.dependencies.snapshot(stored.entry.observedAt)) !==
          stored.entry.basis ||
        !(await this.dependencies.parentCurrent(stored.entry.parent)) ||
        (await this.dependencies.snapshot(stored.entry.observedAt)) !==
          stored.entry.basis ||
        generation !== this.generation ||
        fence !== (this.dependencies.routingVersion?.() ?? 0) ||
        stored.expires <= this.now() ||
        this.results.get(fileHandle) !== stored
      )
        return null;
      return structuredClone(stored.result);
    } catch {
      return null;
    }
  }
  /** Only trusted capture association code receives numbers; a handle alone never authorizes an attachment. */
  async readReceipt(
    value: { binding: FileBinding; fileHandle: string; captureId: string },
    sender: FileSender,
  ): Promise<FileReceiptRead> {
    const denied: FileReceiptRead = {
      status: "unavailable",
      result: null,
      basis: null,
      observedAt: null,
      spec: null,
      validNow: () => false,
    };
    if (
      !fileKeys(value, ["binding", "fileHandle", "captureId"]) ||
      !fileUuid(value.captureId) ||
      !fileUuid(value.fileHandle)
    )
      return denied;
    this.sweep();
    const entry = this.entries.get(value.fileHandle),
      generation = this.generation,
      fence = this.dependencies.routingVersion?.() ?? 0;
    if (
      !entry ||
      entry.parent.captureId !== value.captureId ||
      !this.sameParent(entry, sender, value.binding, value.fileHandle)
    )
      return denied;
    try {
      if (
        (await this.dependencies.snapshot(entry.observedAt)) !== entry.basis ||
        !(await this.dependencies.parentCurrent(entry.parent)) ||
        (await this.dependencies.snapshot(entry.observedAt)) !== entry.basis ||
        this.entries.get(value.fileHandle) !== entry ||
        generation !== this.generation ||
        fence !== (this.dependencies.routingVersion?.() ?? 0) ||
        entry.receiptExpires <= this.now()
      )
        return denied;
      const basis = JSON.parse(entry.basis!) as FileReceiptBasis;
      if (!basis.scope || !Number.isSafeInteger(basis.erasureVersion))
        return denied;
      const stored = this.results.get(value.fileHandle);
      const status =
        stored && stored.expires > this.now()
          ? stored.result.status === "counted"
            ? "complete"
            : "unavailable"
          : this.now() >= entry.expires
            ? "expired"
            : entry.invalid
              ? "unavailable"
              : "pending";
      return {
        status,
        result:
          stored && stored.expires > this.now()
            ? structuredClone(stored.result)
            : null,
        basis: structuredClone(basis),
        observedAt: entry.observedAt,
        spec: {
          ...entry.spec,
          jobId: entry.jobId,
          revision: 1,
          textBytes: entry.textBytes ?? null,
          tokenizerImplementationId: this.counting.selection.implementationId,
          tokenizerProfileId: this.counting.selection.profileId,
        },
        validNow: () =>
          generation === this.generation &&
          fence === (this.dependencies.routingVersion?.() ?? 0) &&
          this.entries.get(value.fileHandle) === entry &&
          entry.parent.captureId === value.captureId &&
          entry.receiptExpires > this.now() &&
          (stored
            ? this.results.get(value.fileHandle) === stored &&
              stored.expires > this.now()
            : !entry.invalid && entry.expires > this.now()),
      };
    } catch {
      return denied;
    }
  }
}
