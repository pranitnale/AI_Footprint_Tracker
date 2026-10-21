import {
  FILE_RELAY_LIMITS,
  fileKeys,
  fileUuid,
  type FileOffer,
  type FileOfferComplete,
} from "./file-relay-protocol";
import type { AccessibleUpload } from "./upload-body";

/** A page can spoof a ready reply, but cannot thereby create a trusted extension grant or numerical result. */
export class UploadFileOffers {
  private epoch = 0;
  private physical: symbol | null = null;
  private pending: {
    offer: FileOffer;
    file: AccessibleUpload | null;
    epoch: number;
    timer: ReturnType<typeof setTimeout>;
    port?: MessagePort;
  } | null = null;
  constructor(
    private emit: (offer: FileOffer | FileOfferComplete) => void,
    private read: (file: AccessibleUpload) => Promise<ArrayBuffer>,
  ) {}
  offer(
    fileHandle: string,
    file: AccessibleUpload,
    observedAt: number,
  ): boolean {
    if (
      this.pending ||
      this.physical ||
      !fileUuid(fileHandle) ||
      file.size > FILE_RELAY_LIMITS.inputBytes
    )
      return false;
    const offer: FileOffer = {
      channel: "ai-footprint-file-offer-v1",
      offerId: crypto.randomUUID(),
      fileHandle,
      kind: file.kind,
      size: file.size,
      observedAt,
    };
    const pending = {
      offer,
      file,
      epoch: this.epoch,
      timer: setTimeout(() => this.clear(), FILE_RELAY_LIMITS.timeoutMs),
    };
    this.pending = pending;
    try {
      this.emit(offer);
      return true;
    } catch {
      this.clear();
      return false;
    }
  }
  receive(value: unknown, ports: readonly MessagePort[]): void {
    const pending = this.pending;
    if (
      !pending ||
      !fileKeys(value, ["channel", "offerId", "fileHandle", "status"]) ||
      value.channel !== "ai-footprint-file-port-v1" ||
      value.offerId !== pending.offer.offerId ||
      value.fileHandle !== pending.offer.fileHandle
    )
      return;
    if (value.status === "unavailable" && ports.length === 0) {
      this.clear();
      return;
    }
    if (
      value.status !== "ready" ||
      ports.length !== 1 ||
      pending.port ||
      !pending.file ||
      this.physical
    )
      return;
    const port = ports[0]!;
    pending.port = port;
    port.onmessage = (event) => {
      if (
        fileKeys(event.data, ["target", "status"]) &&
        event.data.target === "file-relay-status" &&
        ["complete", "unavailable"].includes(event.data.status) &&
        this.pending === pending
      )
        this.clear(event.data.status);
    };
    const token = Symbol(),
      file = pending.file;
    pending.file = null;
    this.physical = token;
    void Promise.resolve()
      .then(() =>
        this.pending === pending && pending.epoch === this.epoch
          ? this.read(file)
          : undefined,
      )
      .then((bytes) => {
        if (!bytes) return;
        if (
          this.pending !== pending ||
          pending.epoch !== this.epoch ||
          bytes.byteLength !== pending.offer.size
        ) {
          new Uint8Array(bytes).fill(0);
          if (this.pending === pending) this.clear();
          return;
        }
        port.postMessage({ target: "file-relay-bytes", bytes }, [bytes]);
      })
      .catch(() => {
        if (this.pending === pending) this.clear();
      })
      .finally(() => {
        if (this.physical === token) this.physical = null;
      });
  }
  reset(): void {
    this.epoch++;
    this.clear();
  }
  private clear(status: "complete" | "unavailable" = "unavailable"): void {
    if (!this.pending) return;
    const offer = this.pending.offer;
    clearTimeout(this.pending.timer);
    this.pending.file = null;
    this.pending.port?.close();
    this.pending = null;
    try {
      this.emit({
        channel: "ai-footprint-file-complete-v1",
        offerId: offer.offerId,
        fileHandle: offer.fileHandle,
        status,
      });
    } catch {}
  }
}
