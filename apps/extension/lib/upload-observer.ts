import { UploadCorrelations } from "./upload-correlation";
import { uploadBodyReader } from "./upload-body";
import type { AccessibleUpload } from "./upload-body";
import { UploadFileOffers } from "./upload-file-offers";
import {
  validUploadAssociation,
  type FileOffer,
  type FileOfferComplete,
  type UploadAssociationMessage,
} from "./file-relay-protocol";

export const UPLOAD_OBSERVER_LIMITS = Object.freeze({
  readers: 2,
  responseBytes: 1048576,
  responseMs: 10000,
  reservations: 64,
  captures: 16,
  ttlMs: 300000,
});
type Provider = "chatgpt" | "perplexity";
type Reservation = {
  provider: Provider;
  handle: string;
  identity: string;
  uploadUrl: string;
  objectUrl?: string;
  formKey?: string;
  expires: number;
  uploaded?: boolean;
  started?: boolean;
  claim?: { status: number; events: Array<{ event: string; fileId: string }> };
};
type Pending = {
  valid: boolean;
  context: string;
  url: string | null;
  consume: ((status: number, body: string) => void) | null;
  timer: ReturnType<typeof setTimeout>;
  reader?: ReadableStreamDefaultReader<Uint8Array>;
  chunks: Uint8Array[];
  reservation: boolean;
  readBody: boolean;
};
type NativeUpload = {
  url: string;
  key?: string;
  file: AccessibleUpload | null;
  observedAt: number;
  context: string;
  record?: Reservation;
  outcome?: { status: number; aborted: boolean };
  active: boolean;
  timer: ReturnType<typeof setTimeout>;
};

/** Only callbacks from already-issued host requests enter this observer. It has no fetch or storage capability. */
export class ProviderUploadObserver {
  private correlator = new UploadCorrelations();
  private body = uploadBodyReader();
  private offers: UploadFileOffers;
  private reservations = new Map<string, Reservation>();
  private captures = new Map<string, { value: any; expires: number }>();
  private readers = new Set<Pending>();
  private candidates = new Set<NativeUpload>();
  private pendingClaim: {
    identity: string;
    claim: NonNullable<Reservation["claim"]>;
    expires: number;
  } | null = null;
  private enabled = true;
  private invalidated = false;
  private restoreXHR: (() => void) | null = null;
  private xhrCleanup = new Set<() => void>();
  private responseClone = Response.prototype.clone;
  private responseStatus = Object.getOwnPropertyDescriptor(
    Response.prototype,
    "status",
  )!.get!;
  private responseURL = Object.getOwnPropertyDescriptor(
    Response.prototype,
    "url",
  )!.get!;
  private responseBody = Object.getOwnPropertyDescriptor(
    Response.prototype,
    "body",
  )!.get!;
  constructor(
    private site: Provider,
    private origin: string,
    private emit: (
      message: FileOffer | FileOfferComplete | UploadAssociationMessage,
    ) => void,
  ) {
    this.offers = new UploadFileOffers(
      (offer) => this.emit(offer),
      (file) => this.body.read(file),
    );
  }
  private current(context: string): boolean {
    return (
      this.enabled && !this.invalidated && context === this.correlator.context()
    );
  }
  context(): string {
    return this.correlator.context();
  }
  maintain(): void {
    if (this.enabled) this.sweep();
  }
  private sweep() {
    const now = Date.now();
    if (this.pendingClaim && this.pendingClaim.expires <= now)
      this.pendingClaim = null;
    for (const [key, value] of this.reservations)
      if (value.expires <= now) this.reservations.delete(key);
    for (const [key, value] of this.captures)
      if (value.expires <= now) this.captures.delete(key);
    this.correlator.sweep(this.correlator.context());
  }
  prepare(request: { url: URL; method: string; body: unknown } | null) {
    if (!this.enabled || this.invalidated || !request) return null;
    const multipart =
      this.site === "perplexity" &&
      request.method === "POST" &&
      ([...this.reservations.values()].some(
        (value) => value.uploadUrl === request.url.href,
      ) ||
        (this.waitingReservation() &&
          request.url.href === "https://ppl-ai-file-upload.s3.amazonaws.com/"))
        ? this.body.multipart(request.body)
        : null;
    return { request, multipart };
  }
  /** Called after native fetch returns, in the same JS turn. Never returns or replaces the host promise. */
  fetch(
    prepared: ReturnType<ProviderUploadObserver["prepare"]>,
    promise: Promise<Response>,
    observedAt: number,
    expectedContext: string,
  ): void {
    if (
      !this.current(expectedContext) ||
      this.readers.size >= UPLOAD_OBSERVER_LIMITS.reservations
    )
      return;
    this.sweep();
    if (!prepared) return;
    const { request } = prepared;
    const { url, method } = request,
      context = this.correlator.context();
    if (method !== "POST") return;
    if (
      this.site === "chatgpt" &&
      url.origin === this.origin &&
      url.pathname === "/backend-api/files/upload_reservations"
    ) {
      this.watch(promise, url, context, (status, body) => {
        if (status !== 200) return;
        const value = JSON.parse(body);
        if (
          value.eligible !== true ||
          typeof value.reservation_id !== "string" ||
          typeof value.upload_url !== "string" ||
          this.reservations.size >= UPLOAD_OBSERVER_LIMITS.reservations
        )
          return;
        const handle = crypto.randomUUID();
        this.correlator.reserveChatGPT(context, {
          method,
          path: url.pathname,
          transport: "Fetch",
          status,
          eligible: true,
          reservationId: value.reservation_id,
          uploadUrl: value.upload_url,
          fileHandle: handle,
        });
        this.reservations.set(handle, {
          provider: "chatgpt",
          handle,
          identity: value.reservation_id,
          uploadUrl: value.upload_url,
          expires: Date.now() + UPLOAD_OBSERVER_LIMITS.ttlMs,
        });
        if (
          this.pendingClaim &&
          this.pendingClaim.identity === value.reservation_id
        ) {
          this.reservations.get(handle)!.claim = this.pendingClaim.claim;
          this.pendingClaim = null;
        }
        this.adopt();
      });
    } else if (
      this.site === "chatgpt" &&
      url.origin === this.origin &&
      /^\/backend-api\/files\/upload_reservations\/file_[0-9a-f]{32}\/claim_and_finish$/.test(
        url.pathname,
      )
    ) {
      const identity = url.pathname.split("/")[4];
      const record = [...this.reservations.values()].find(
        (value) => value.identity === identity,
      );
      if (!record && (!this.waitingReservation() || this.pendingClaim)) return;
      this.watch(promise, url, context, (status, body) => {
        const lines = body.split(/\r?\n/).filter((line) => line.trim());
        let events: Array<{ event: string; fileId: string }> = [];
        try {
          if (lines.length === 4)
            events = lines.map((line) => {
              const value = JSON.parse(line);
              // message, progress and extra are deliberately not accessed or retained.
              if (
                typeof value.event !== "string" ||
                value.event.length > 80 ||
                typeof value.file_id !== "string" ||
                value.file_id.length > 80
              )
                throw new Error("invalid_claim");
              return { event: value.event, fileId: value.file_id };
            });
        } catch {
          events = [];
        }
        const currentRecord = [...this.reservations.values()].find(
          (value) => value.identity === identity,
        );
        if (currentRecord) {
          currentRecord.claim = { status, events };
          if (currentRecord.uploaded) this.claim(currentRecord, context);
        } else if (this.waitingReservation() && !this.pendingClaim)
          this.pendingClaim = {
            identity,
            claim: { status, events },
            expires: Date.now() + UPLOAD_OBSERVER_LIMITS.responseMs,
          };
      });
    } else if (
      this.site === "perplexity" &&
      url.origin === this.origin &&
      url.pathname === "/rest/uploads/batch_create_upload_urls"
    ) {
      if (
        typeof request.body !== "string" ||
        request.body.length > UPLOAD_OBSERVER_LIMITS.responseBytes
      )
        return;
      const sent = JSON.parse(request.body);
      if (
        !sent?.files ||
        typeof sent.files !== "object" ||
        Array.isArray(sent.files)
      )
        return;
      const clients = Object.keys(sent.files);
      if (!clients.length || clients.length > 16) return;
      this.watch(promise, url, context, (status, body) => {
        if (status !== 200) return;
        const value = JSON.parse(body);
        for (const client of clients) {
          // Proposed strict container path; the native integration has not established its literal wire name.
          const result = value.results?.[client];
          if (
            !result ||
            this.reservations.size >= UPLOAD_OBSERVER_LIMITS.reservations
          )
            continue;
          const handle = crypto.randomUUID(),
            formKey = result.fields?.key;
          try {
            this.correlator.reservePerplexity(context, {
              method,
              path: url.pathname,
              transport: "Fetch",
              status,
              clientId: client,
              resultClientId: client,
              fileId: result.file_uuid,
              bucketUrl: result.s3_bucket_url,
              objectUrl: result.s3_object_url,
              formKey,
              rateLimited: result.rate_limited,
              error: result.error,
              fileHandle: handle,
            });
            this.reservations.set(handle, {
              provider: "perplexity",
              handle,
              identity: result.file_uuid,
              uploadUrl: result.s3_bucket_url,
              objectUrl: result.s3_object_url,
              formKey,
              expires: Date.now() + UPLOAD_OBSERVER_LIMITS.ttlMs,
            });
            this.adopt();
          } catch {}
        }
      });
    } else if (this.site === "perplexity") {
      const multipart = prepared.multipart;
      if (!multipart) return;
      const candidate = this.nativeUpload(
        multipart.file,
        url.href,
        multipart.key,
        observedAt,
        context,
      );
      if (!candidate) return;
      this.watch(
        promise,
        url,
        context,
        (status) => {
          candidate.outcome = { status, aborted: false };
          this.adopt();
        },
        false,
      );
    }
  }
  private waitingReservation(): boolean {
    return [...this.readers].some(
      (item) => item.valid && item.reservation && this.current(item.context),
    );
  }
  private nativeUpload(
    file: AccessibleUpload,
    url: string,
    key: string | undefined,
    observedAt: number,
    context: string,
  ): NativeUpload | null {
    const record = [...this.reservations.values()].find(
      (value) =>
        value.uploadUrl === url &&
        (this.site === "chatgpt" || value.formKey === key),
    );
    if (
      [...this.candidates].some(
        (value) => value.url === url && value.key === key,
      ) ||
      record?.started
    ) {
      this.reset();
      // A second native upload to the same locator is ambiguous. Only a real lifecycle reset may reopen admission.
      this.invalidated = true;
      return null;
    }
    if (
      this.candidates.size >= UPLOAD_OBSERVER_LIMITS.reservations ||
      (!record &&
        (!this.waitingReservation() ||
          [...this.candidates].some((value) => value.file !== null)))
    )
      return null;
    const candidate: NativeUpload = {
      url,
      key,
      file,
      observedAt,
      context,
      active: true,
      timer: setTimeout(() => this.clearCandidate(candidate), 30000),
    };
    this.candidates.add(candidate);
    this.adopt();
    return candidate;
  }
  private clearCandidate(candidate: NativeUpload): void {
    candidate.active = false;
    candidate.file = null;
    candidate.record = undefined;
    clearTimeout(candidate.timer);
    this.candidates.delete(candidate);
  }
  private adopt(): void {
    for (const candidate of this.candidates) {
      if (!candidate.active || !this.current(candidate.context)) {
        this.clearCandidate(candidate);
        continue;
      }
      const record =
        candidate.record ??
        [...this.reservations.values()].find(
          (value) =>
            value.uploadUrl === candidate.url &&
            (this.site === "chatgpt" || value.formKey === candidate.key),
        );
      if (!record) continue;
      if (!candidate.record) {
        if (record.started) {
          this.clearCandidate(candidate);
          continue;
        }
        candidate.record = record;
        record.started = true;
        if (candidate.file)
          this.offers.offer(
            record.handle,
            candidate.file,
            candidate.observedAt,
          );
        candidate.file = null;
      }
      if (!candidate.outcome) continue;
      const { status, aborted } = candidate.outcome;
      try {
        if (this.site === "chatgpt") {
          record.uploaded = this.correlator.uploadChatGPT(candidate.context, {
            fileHandle: record.handle,
            method: "PUT",
            transport: "XHR",
            url: candidate.url,
            status,
            outcome: aborted
              ? "aborted"
              : status >= 200 && status < 300
                ? "success"
                : "failure",
          });
          if (record.uploaded && record.claim)
            this.claim(record, candidate.context);
          if (!record.uploaded) this.reservations.delete(record.handle);
        } else {
          this.correlator.uploadPerplexity(candidate.context, {
            fileHandle: record.handle,
            method: "POST",
            transport: "Fetch",
            url: candidate.url,
            formKey: candidate.key,
            multipart: true,
            status,
            outcome: status === 204 ? "success" : "failure",
          });
          this.reservations.delete(record.handle);
        }
      } catch {
      } finally {
        this.clearCandidate(candidate);
      }
    }
  }
  private claim(record: Reservation, context: string): void {
    if (!record.claim) return;
    const { status, events } = record.claim;
    try {
      this.correlator.claimChatGPT(context, {
        method: "POST",
        path: `/backend-api/files/upload_reservations/${record.identity}/claim_and_finish`,
        transport: "Fetch",
        status,
        outcome: status === 200 ? "success" : "failure",
        reservationId: record.identity,
        events,
      });
    } finally {
      this.reservations.delete(record.handle);
    }
  }
  private watch(
    promise: Promise<Response>,
    url: URL,
    context: string,
    consume: (status: number, body: string) => void,
    readBody = true,
  ) {
    if (
      this.readers.size >= UPLOAD_OBSERVER_LIMITS.reservations ||
      (readBody &&
        [...this.readers].filter((item) => item.readBody).length >=
          UPLOAD_OBSERVER_LIMITS.readers)
    )
      return;
    const pending: Pending = {
      valid: true,
      context,
      url: url.href,
      consume,
      chunks: [],
      readBody,
      reservation:
        url.pathname === "/backend-api/files/upload_reservations" ||
        url.pathname === "/rest/uploads/batch_create_upload_urls",
      timer: setTimeout(
        () => this.cancel(pending),
        UPLOAD_OBSERVER_LIMITS.responseMs,
      ),
    };
    this.readers.add(pending);
    void promise
      .then(async (response) => {
        if (!pending.valid || !this.current(context)) return;
        const status = Reflect.apply(this.responseStatus, response, []),
          responseURL = Reflect.apply(this.responseURL, response, []);
        if (responseURL && responseURL !== pending.url) return;
        let text = "";
        if (readBody && status === 200) {
          const clone = Reflect.apply(this.responseClone, response, []),
            stream = Reflect.apply(this.responseBody, clone, []);
          if (!stream) return;
          const reader = (stream as ReadableStream<Uint8Array>).getReader();
          pending.reader = reader;
          let size = 0;
          for (;;) {
            const part = await reader.read();
            if (!pending.valid || !this.current(context)) return;
            if (part.done) break;
            if (
              !(part.value instanceof Uint8Array) ||
              (size += part.value.byteLength) >
                UPLOAD_OBSERVER_LIMITS.responseBytes
            )
              return;
            pending.chunks.push(part.value);
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of pending.chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
          }
          text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          pending.chunks.length = 0;
        }
        if (pending.valid && this.current(context)) {
          pending.consume?.(status, text);
          this.refresh();
        }
      })
      .catch(() => {})
      .finally(() => {
        this.cancel(pending);
        this.readers.delete(pending);
      });
  }
  private cancel(pending: Pending) {
    pending.valid = false;
    pending.consume = null;
    pending.url = null;
    pending.chunks.length = 0;
    clearTimeout(pending.timer);
    void pending.reader?.cancel().catch(() => {});
  }
  /** The capture runtime calls this only after it posts the validated original dispatch message. */
  dispatch(
    captureId: string,
    url: URL,
    body: string,
    expectedContext: string,
  ): void {
    if (!this.current(expectedContext)) return;
    this.sweep();
    if (
      this.captures.size >= UPLOAD_OBSERVER_LIMITS.captures &&
      !this.captures.has(captureId)
    )
      return;
    try {
      const value = JSON.parse(body);
      let projection: any;
      if (this.site === "chatgpt") {
        if (
          !Array.isArray(value.messages) ||
          value.messages.length !== 1 ||
          !Array.isArray(value.messages[0]?.metadata?.attachments)
        )
          return;
        projection = {
          method: "POST",
          path: url.pathname,
          transport: "Fetch",
          captureId,
          messageCount: 1,
          attachments: value.messages[0].metadata.attachments,
        };
      } else {
        if (!Array.isArray(value.params?.attachments)) return;
        projection = {
          method: "POST",
          path: url.pathname,
          transport: "Fetch",
          captureId,
          attachments: value.params.attachments,
        };
      }
      const result = this.consume(projection);
      if (!result) return;
      if (projection.attachments.length)
        this.captures.set(captureId, {
          value: projection,
          expires:
            this.captures.get(captureId)?.expires ??
            Date.now() + UPLOAD_OBSERVER_LIMITS.ttlMs,
        });
      this.emit(result);
    } catch {}
  }
  private consume(value: any): UploadAssociationMessage | null {
    const context = this.correlator.context();
    const association =
      this.site === "chatgpt"
        ? this.correlator.consumeChatGPT(context, value)
        : this.correlator.consumePerplexity(context, value);
    const result = {
      channel: "ai-footprint-upload-association-v1" as const,
      ...association,
    };
    return validUploadAssociation(result) ? result : null;
  }
  private refresh() {
    this.sweep();
    for (const value of this.captures.values())
      try {
        const result = this.consume(value.value);
        if (result) this.emit(result);
      } catch {}
  }
  receive(value: unknown, ports: readonly MessagePort[]): void {
    if (this.enabled) this.offers.receive(value, ports);
  }
  reset(): void {
    this.invalidated = false;
    this.offers.reset();
    this.correlator.reset();
    this.reservations.clear();
    this.captures.clear();
    this.pendingClaim = null;
    for (const candidate of this.candidates) this.clearCandidate(candidate);
    for (const pending of this.readers) this.cancel(pending);
    for (const cleanup of this.xhrCleanup) cleanup();
    this.xhrCleanup.clear();
  }
  stop(): void {
    this.enabled = false;
    this.reset();
    this.restoreXHR?.();
    this.restoreXHR = null;
  }
  start(): void {
    this.enabled = true;
  }
  installXHR(ctor: typeof XMLHttpRequest | undefined): void {
    if (this.site !== "chatgpt" || !ctor || this.restoreXHR) return;
    const prototype = ctor.prototype,
      open = prototype.open,
      send = prototype.send;
    const eventAdd = EventTarget.prototype.addEventListener,
      eventRemove = EventTarget.prototype.removeEventListener;
    const status = Object.getOwnPropertyDescriptor(prototype, "status")?.get;
    if (!status) return;
    const requests = new WeakMap<
        XMLHttpRequest,
        { url: string; method: string; async: boolean }
      >(),
      observer = this;
    const wrappedOpen = function (this: XMLHttpRequest, ...args: any[]) {
      let result;
      try {
        result = Reflect.apply(open, this, args);
      } catch (error) {
        requests.delete(this);
        throw error;
      }
      requests.delete(this);
      if (typeof args[0] === "string" && typeof args[1] === "string")
        try {
          requests.set(this, {
            method: args[0].toUpperCase(),
            url: new URL(args[1], observer.origin).href,
            async: args[2] === undefined || args[2] === true,
          });
        } catch {}
      return result;
    };
    const wrappedSend = function (this: XMLHttpRequest, ...args: any[]) {
      const observedAt = Date.now(),
        context = observer.context(),
        result = Reflect.apply(send, this, args);
      try {
        if (!observer.current(context)) return result;
        observer.sweep();
        const target = requests.get(this);
        if (!target?.async || target.method !== "PUT") return result;
        const file = observer.body.blob(args[0]);
        if (
          !file ||
          observer.xhrCleanup.size >= UPLOAD_OBSERVER_LIMITS.reservations
        )
          return result;
        const candidate = observer.nativeUpload(
          file,
          target.url,
          undefined,
          observedAt,
          context,
        );
        if (!candidate) return result;
        const xhr = this;
        let aborted = false;
        const abort = () => {
          aborted = true;
        };
        const finish = () => {
          try {
            if (observer.current(context)) {
              const code = Reflect.apply(status, xhr, []);
              candidate.outcome = { status: code, aborted };
              observer.adopt();
              observer.refresh();
            }
          } catch {
          } finally {
            cleanup();
          }
        };
        const cleanup = () => {
          clearTimeout(timer);
          Reflect.apply(eventRemove, xhr, ["abort", abort]);
          Reflect.apply(eventRemove, xhr, ["loadend", finish]);
          observer.xhrCleanup.delete(cleanup);
        };
        const timer = setTimeout(cleanup, UPLOAD_OBSERVER_LIMITS.responseMs);
        observer.xhrCleanup.add(cleanup);
        Reflect.apply(eventAdd, xhr, ["abort", abort]);
        Reflect.apply(eventAdd, xhr, ["loadend", finish]);
      } catch {}
      return result;
    };
    prototype.open = wrappedOpen as typeof open;
    prototype.send = wrappedSend as typeof send;
    this.restoreXHR = () => {
      if (prototype.open === wrappedOpen) prototype.open = open;
      if (prototype.send === wrappedSend) prototype.send = send;
    };
  }
}
