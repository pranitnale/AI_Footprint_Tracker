import {
  FILE_RELAY_LIMITS,
  type FileBinding,
  type FileOfferComplete,
  type FileGrantCancel,
  type FileGrantCheck,
  type FileGrantReply,
  type FileOffer,
  type FileOfferReply,
  type FileReceiptBind,
  type UploadAssociationMessage,
  validFileGrantCheck,
  validFileGrantReply,
  validFileOffer,
  validFileOfferComplete,
  validFileRelayStatus,
  validUploadAssociation,
} from "./file-relay-protocol";
import {
  validFileCaptureAssociation,
  type FileCaptureAssociation,
} from "./file-association-protocol";
import type { DisplayBinding } from "@footprint/capture-core";

const LOCAL_LIMITS = Object.freeze({
  loadMs: 5000,
  maxReplays: 32,
  startsPerWindow: 4,
  windowMs: 10000,
});

type RuntimeSender = { id?: string; tab?: unknown } | undefined;
type RuntimeSend = (message: unknown) => Promise<unknown>;

type Receipt = {
  binding: FileBinding;
  candidateCaptureId: string | null;
  captureId: string | null;
  currentNavigationNonce: string;
  expiresAt: number;
  fileHandle: string;
  bindStarted: boolean;
  bindPromise: Promise<boolean> | null;
};

type ActiveOffer = {
  association: {
    captureCommitted: Promise<boolean>;
    captureId: string;
    bindingReady: Promise<boolean>;
    resolveBinding(value: boolean): void;
  } | null;
  binding: FileBinding;
  iframe: HTMLIFrameElement | null;
  loadTimer: ReturnType<typeof setTimeout> | null;
  offer: FileOffer;
  port: MessagePort | null;
  terminal: boolean;
  timer: ReturnType<typeof setTimeout>;
};

type PendingAssociation = {
  association: UploadAssociationMessage;
  binding: DisplayBinding;
  forwarded: string | null;
  ready: boolean;
  signature: string;
};

export type FileOfferBridgeOptions = {
  binding(): FileBinding;
  captureBinding(captureId: string): DisplayBinding | null;
  captureCurrent(captureId: string, binding: FileBinding): boolean;
  document: Document;
  extensionId: string;
  extensionOrigin: string;
  pageOrigin: string;
  relayUrl: string;
  runtimeSend: RuntimeSend;
  siteAccess(): boolean;
  window: Window;
};

/** Keeps page-owned bytes on a private port after the extension has authorized one exact offer. */
export class FileOfferBridge {
  private active: ActiveOffer | null = null;
  private associationGeneration = 0;
  private associationInFlight: string | null = null;
  private readonly associations = new Map<string, PendingAssociation>();
  private destroyed = false;
  private physicalGrantPending = false;
  private readonly promotedCaptures = new Map<string, string>();
  private readonly sentPromotions = new Set<string>();
  private readonly receipts = new Map<string, Receipt>();
  private readonly seen = new Map<string, number>();
  private readonly starts: number[] = [];

  constructor(private readonly options: FileOfferBridgeOptions) {}

  handleWindowMessage(event: MessageEvent): boolean {
    if (
      this.destroyed ||
      event.source !== this.options.window ||
      event.origin !== this.options.pageOrigin ||
      event.ports.length !== 0
    )
      return false;
    if (validFileOfferComplete(event.data)) {
      this.completeOffer(event.data);
      return true;
    }
    if (!validFileOffer(event.data)) return false;
    this.acceptOffer(event.data);
    return true;
  }

  handleGrantCheck(
    message: unknown,
    sender: RuntimeSender,
  ): { current: boolean } | undefined {
    if (
      sender?.id !== this.options.extensionId ||
      sender.tab !== undefined ||
      !validFileGrantCheck(message)
    )
      return undefined;
    const receipt = this.receipts.get(message.fileHandle);
    const active = this.active;
    return {
      current:
        (!!receipt &&
          !this.destroyed &&
          this.options.siteAccess() &&
          this.sameBinding(receipt.binding, message.binding) &&
          receipt.captureId === message.captureId &&
          receipt.currentNavigationNonce ===
            this.options.binding().navigationNonce &&
          receipt.expiresAt > Date.now()) ||
        (message.captureId === null &&
          !!active &&
          active.offer.fileHandle === message.fileHandle &&
          this.sameBinding(active.binding, message.binding) &&
          this.offerCurrent(active)),
    };
  }

  bindAssociation(value: unknown, captureCommitted: Promise<boolean>): boolean {
    if (!validUploadAssociation(value)) return false;
    const captureBinding = this.options.captureBinding(value.captureId);
    if (!captureBinding) return true;
    const bindingPromises: Promise<boolean>[] = [];
    for (const file of value.files) {
      const receipt = this.receipts.get(file.fileHandle);
      const active =
        this.active?.offer.fileHandle === file.fileHandle ? this.active : null;
      const binding = receipt?.binding ?? active?.binding;
      if (!binding) continue;
      if (!this.options.captureCurrent(value.captureId, binding)) continue;
      if (receipt)
        bindingPromises.push(
          this.startReceiptBind(receipt, value.captureId, captureCommitted),
        );
      else if (active) {
        if (!active.association) {
          let resolveBinding!: (value: boolean) => void;
          const bindingReady = new Promise<boolean>((resolve) => {
            resolveBinding = resolve;
          });
          active.association = {
            bindingReady,
            captureCommitted,
            captureId: value.captureId,
            resolveBinding,
          };
        }
        if (active.association.captureId === value.captureId)
          bindingPromises.push(active.association.bindingReady);
        else bindingPromises.push(Promise.resolve(false));
      }
    }
    this.prepareAssociation(
      captureBinding,
      value,
      captureCommitted,
      bindingPromises,
    );
    return true;
  }

  promoteCapture(captureId: string): void {
    const navigationNonce = this.options.binding().navigationNonce;
    this.promotedCaptures.clear();
    this.promotedCaptures.set(captureId, navigationNonce);
    if (
      this.active?.association?.captureId === captureId &&
      this.options.captureCurrent(captureId, this.active.binding)
    )
      this.sendPromotion(captureId);
    for (const receipt of this.receipts.values())
      if (
        receipt.captureId === captureId ||
        receipt.candidateCaptureId === captureId
      ) {
        receipt.currentNavigationNonce = navigationNonce;
        this.sendPromotion(captureId);
      }
  }

  invalidate(notifyMain = true): void {
    this.associationGeneration++;
    this.associations.clear();
    this.abandonActive(false);
    for (const receipt of this.receipts.values())
      this.cancel(receipt.binding, receipt.fileHandle);
    this.receipts.clear();
    this.promotedCaptures.clear();
    this.sentPromotions.clear();
    if (notifyMain)
      this.options.window.postMessage(
        { channel: "ai-footprint-file-reset-v1" },
        this.options.pageOrigin,
      );
  }

  destroy(): void {
    if (this.destroyed) return;
    this.invalidate(true);
    this.destroyed = true;
    this.seen.clear();
    this.starts.length = 0;
  }

  private acceptOffer(offer: FileOffer): void {
    const now = Date.now();
    this.expireBookkeeping(now);
    if (this.seen.has(offer.offerId)) return;
    this.seen.set(offer.offerId, now);
    while (this.seen.size > LOCAL_LIMITS.maxReplays)
      this.seen.delete(this.seen.keys().next().value!);
    if (this.starts.length >= LOCAL_LIMITS.startsPerWindow) {
      this.replyUnavailable(offer);
      return;
    }
    this.starts.push(now);
    if (
      this.active ||
      this.physicalGrantPending ||
      !this.options.siteAccess()
    ) {
      this.replyUnavailable(offer);
      return;
    }
    const binding = this.options.binding();
    const active: ActiveOffer = {
      association: null,
      binding,
      iframe: null,
      loadTimer: null,
      offer,
      port: null,
      terminal: false,
      timer: setTimeout(
        () => this.finish(active, false, true),
        FILE_RELAY_LIMITS.timeoutMs,
      ),
    };
    this.active = active;
    this.physicalGrantPending = true;
    const grantRequest = {
      target: "file-grant",
      binding,
      fileHandle: offer.fileHandle,
      kind: offer.kind,
      observedAt: offer.observedAt,
      size: offer.size,
    } as const;
    let call: Promise<unknown>;
    try {
      call = Promise.resolve(this.options.runtimeSend(grantRequest));
    } catch {
      call = Promise.reject(new Error("file_unavailable"));
    }
    void call
      .then((reply) => this.acceptGrant(active, reply))
      .catch(() => {
        if (this.active === active) this.finish(active, true, true);
      })
      .finally(() => {
        this.physicalGrantPending = false;
      });
  }

  private completeOffer(message: FileOfferComplete): void {
    const active = this.active;
    if (
      !active ||
      active.offer.offerId !== message.offerId ||
      active.offer.fileHandle !== message.fileHandle
    )
      return;
    this.finish(active, false, message.status === "unavailable");
  }

  private acceptGrant(active: ActiveOffer, value: unknown): void {
    if (!validFileGrantReply(value)) {
      if (this.active === active) this.finish(active, true, true);
      return;
    }
    if (value.status === "unavailable") {
      if (this.active === active) this.finish(active, true, false);
      return;
    }
    if (!this.offerCurrent(active) || value.expiresAt <= Date.now()) {
      this.cancel(active.binding, active.offer.fileHandle);
      if (this.active === active) this.finish(active, false, false);
      return;
    }
    const receipt: Receipt = {
      binding: active.binding,
      bindStarted: false,
      bindPromise: null,
      candidateCaptureId: null,
      captureId: null,
      currentNavigationNonce: active.binding.navigationNonce,
      expiresAt: Date.now() + FILE_RELAY_LIMITS.resultTtlMs,
      fileHandle: active.offer.fileHandle,
    };
    this.receipts.set(active.offer.fileHandle, receipt);
    if (active.association)
      void this.startReceiptBind(
        receipt,
        active.association.captureId,
        active.association.captureCommitted,
      ).then(active.association.resolveBinding);
    this.prepareRelay(active, value);
  }

  private startReceiptBind(
    receipt: Receipt,
    captureId: string,
    captureCommitted: Promise<boolean>,
  ): Promise<boolean> {
    if (receipt.bindPromise)
      return receipt.candidateCaptureId === captureId
        ? receipt.bindPromise
        : Promise.resolve(false);
    receipt.bindStarted = true;
    receipt.candidateCaptureId = captureId;
    receipt.bindPromise = captureCommitted
      .then((committed) => {
        if (!committed) {
          if (this.receipts.get(receipt.fileHandle) === receipt) {
            this.receipts.delete(receipt.fileHandle);
            this.cancel(receipt.binding, receipt.fileHandle);
          }
          return false;
        }
        if (!this.receiptCanBind(receipt, captureId)) return false;
        receipt.captureId = captureId;
        const promotedNavigation = this.promotedCaptures.get(captureId);
        if (promotedNavigation) {
          receipt.currentNavigationNonce = promotedNavigation;
          this.sendPromotion(captureId);
        }
        const request: FileReceiptBind = {
          target: "file-receipt-bind",
          binding: receipt.binding,
          fileHandle: receipt.fileHandle,
          captureId,
        };
        return this.options
          .runtimeSend(request)
          .then((result: any) => {
            const bound = result?.bound === true;
            if (!bound && this.receipts.get(receipt.fileHandle) === receipt)
              this.receipts.delete(receipt.fileHandle);
            return bound;
          })
          .catch(() => {
            if (this.receipts.get(receipt.fileHandle) === receipt)
              this.receipts.delete(receipt.fileHandle);
            return false;
          });
      })
      .catch(() => false);
    return receipt.bindPromise;
  }

  private prepareAssociation(
    binding: DisplayBinding,
    association: UploadAssociationMessage,
    captureCommitted: Promise<boolean>,
    bindingPromises: Promise<boolean>[],
  ): void {
    const signature = this.associationSignature(association);
    let pending = this.associations.get(association.captureId);
    if (!pending) {
      if (this.associations.size >= FILE_RELAY_LIMITS.results) {
        const evict = [...this.associations.keys()].find(
          (captureId) => captureId !== this.associationInFlight,
        );
        if (!evict) return;
        this.associations.delete(evict);
      }
      pending = {
        association,
        binding,
        forwarded: null,
        ready: false,
        signature,
      };
      this.associations.set(association.captureId, pending);
    } else {
      pending.association = association;
      pending.binding = binding;
      pending.ready = false;
      pending.signature = signature;
    }
    const generation = this.associationGeneration;
    void Promise.all([captureCommitted, ...bindingPromises])
      .then(([committed, ...bound]) => {
        const current = this.associations.get(association.captureId);
        if (
          committed !== true ||
          bound.some((value) => value !== true) ||
          generation !== this.associationGeneration ||
          current !== pending ||
          current.signature !== signature ||
          !this.options.siteAccess() ||
          !this.sameDisplayBinding(
            this.options.captureBinding(association.captureId),
            binding,
          )
        )
          return;
        current.ready = true;
        this.pumpAssociations();
      })
      .catch(() => {});
  }

  private pumpAssociations(): void {
    if (this.destroyed || this.associationInFlight) return;
    const next = [...this.associations.entries()].find(
      ([, value]) => value.ready && value.signature !== value.forwarded,
    );
    if (!next) return;
    const [captureId, pending] = next;
    const signature = pending.signature;
    const request: FileCaptureAssociation = {
      target: "file-capture-association",
      binding: pending.binding,
      association: pending.association,
    };
    if (!validFileCaptureAssociation(request)) return;
    this.associationInFlight = captureId;
    void this.options
      .runtimeSend(request)
      .then((result: any) => {
        const current = this.associations.get(captureId);
        if (
          current === pending &&
          current.signature === signature &&
          result?.accepted === true
        )
          current.forwarded = signature;
        else if (current === pending && current.signature === signature)
          current.ready = false;
      })
      .catch(() => {
        const current = this.associations.get(captureId);
        if (current === pending && current.signature === signature)
          current.ready = false;
      })
      .finally(() => {
        if (this.associationInFlight === captureId)
          this.associationInFlight = null;
        this.pumpAssociations();
      });
  }

  private associationSignature(value: UploadAssociationMessage): string {
    return JSON.stringify([
      value.status,
      value.unmatchedReferenceCount,
      value.files.map((file) => [file.fileHandle, file.origin]),
    ]);
  }

  private sameDisplayBinding(
    left: DisplayBinding | null,
    right: DisplayBinding,
  ): boolean {
    return (
      !!left &&
      left.documentNonce === right.documentNonce &&
      left.navigationNonce === right.navigationNonce &&
      left.captureId === right.captureId
    );
  }

  private prepareRelay(
    active: ActiveOffer,
    grant: Extract<FileGrantReply, { status: "granted" }>,
  ): void {
    const iframe = this.options.document.createElement("iframe");
    active.iframe = iframe;
    iframe.hidden = true;
    iframe.tabIndex = -1;
    iframe.setAttribute("aria-hidden", "true");
    iframe.src = this.options.relayUrl;
    const fail = () => {
      if (this.active === active) this.finish(active, true, true);
    };
    iframe.addEventListener("error", fail, { once: true });
    iframe.addEventListener(
      "load",
      () => {
        if (!this.offerCurrent(active) || !iframe.contentWindow) {
          fail();
          return;
        }
        if (active.loadTimer) clearTimeout(active.loadTimer);
        active.loadTimer = null;
        const channel = new MessageChannel();
        active.port = channel.port1;
        channel.port1.onmessage = (event) => {
          if (
            !validFileRelayStatus(event.data) ||
            event.data.status !== "ready"
          ) {
            fail();
            return;
          }
          if (!this.offerCurrent(active)) {
            fail();
            return;
          }
          channel.port1.onmessage = null;
          const reply: FileOfferReply = {
            channel: "ai-footprint-file-port-v1",
            offerId: active.offer.offerId,
            fileHandle: active.offer.fileHandle,
            status: "ready",
          };
          try {
            this.options.window.postMessage(reply, this.options.pageOrigin, [
              channel.port1,
            ]);
            active.port = null;
          } catch {
            fail();
          }
        };
        channel.port1.start();
        try {
          iframe.contentWindow.postMessage(
            { target: "file-relay-bind", grant: grant.grant },
            this.options.extensionOrigin,
            [channel.port2],
          );
        } catch {
          channel.port1.close();
          channel.port2.close();
          fail();
        }
      },
      { once: true },
    );
    active.loadTimer = setTimeout(fail, LOCAL_LIMITS.loadMs);
    (
      this.options.document.body ?? this.options.document.documentElement
    ).append(iframe);
  }

  private receiptCanBind(receipt: Receipt, captureId: string): boolean {
    if (
      this.destroyed ||
      !this.options.siteAccess() ||
      receipt.expiresAt <= Date.now()
    )
      return false;
    const promotedNavigation = this.promotedCaptures.get(captureId);
    if (promotedNavigation) receipt.currentNavigationNonce = promotedNavigation;
    return (
      receipt.currentNavigationNonce ===
        this.options.binding().navigationNonce &&
      this.options.captureCurrent(captureId, receipt.binding)
    );
  }

  private offerCurrent(active: ActiveOffer): boolean {
    const current = this.options.binding();
    const receipt = this.receipts.get(active.offer.fileHandle);
    const candidateCaptureId =
      receipt?.candidateCaptureId ?? active.association?.captureId;
    const promotedNavigation = candidateCaptureId
      ? this.promotedCaptures.get(candidateCaptureId)
      : undefined;
    return (
      this.active === active &&
      !active.terminal &&
      !this.destroyed &&
      this.options.siteAccess() &&
      active.binding.documentNonce === current.documentNonce &&
      (active.binding.navigationNonce === current.navigationNonce ||
        promotedNavigation === current.navigationNonce)
    );
  }

  private finish(
    active: ActiveOffer,
    notifyMain: boolean,
    cancel: boolean,
  ): void {
    if (active.terminal) return;
    active.terminal = true;
    clearTimeout(active.timer);
    if (active.loadTimer) clearTimeout(active.loadTimer);
    active.port?.close();
    active.iframe?.remove();
    if (active.association && !this.receipts.has(active.offer.fileHandle))
      active.association.resolveBinding(true);
    if (cancel) {
      this.receipts.delete(active.offer.fileHandle);
      this.cancel(active.binding, active.offer.fileHandle);
    }
    if (notifyMain) this.replyUnavailable(active.offer);
    if (this.active === active) this.active = null;
  }

  private abandonActive(notifyMain: boolean): void {
    if (this.active) this.finish(this.active, notifyMain, true);
  }

  private cancel(binding: FileBinding, fileHandle: string): void {
    const request: FileGrantCancel = {
      target: "file-grant-cancel",
      binding,
      fileHandle,
    };
    void this.options.runtimeSend(request).catch(() => {});
  }

  private sendPromotion(captureId: string): void {
    if (this.sentPromotions.has(captureId)) return;
    this.sentPromotions.add(captureId);
    this.options.window.postMessage(
      { channel: "ai-footprint-file-promote-v1", captureId },
      this.options.pageOrigin,
    );
  }

  private replyUnavailable(offer: FileOffer): void {
    const reply: FileOfferReply = {
      channel: "ai-footprint-file-port-v1",
      offerId: offer.offerId,
      fileHandle: offer.fileHandle,
      status: "unavailable",
    };
    this.options.window.postMessage(reply, this.options.pageOrigin);
  }

  private expireBookkeeping(now: number): void {
    while (this.starts.length && now - this.starts[0]! >= LOCAL_LIMITS.windowMs)
      this.starts.shift();
    for (const [id, seenAt] of this.seen)
      if (now - seenAt >= FILE_RELAY_LIMITS.resultTtlMs) this.seen.delete(id);
    for (const [fileHandle, receipt] of this.receipts)
      if (receipt.expiresAt <= now) this.receipts.delete(fileHandle);
  }

  private sameBinding(left: FileBinding, right: FileBinding): boolean {
    return (
      left.documentNonce === right.documentNonce &&
      left.navigationNonce === right.navigationNonce &&
      left.captureId === null &&
      right.captureId === null
    );
  }
}
