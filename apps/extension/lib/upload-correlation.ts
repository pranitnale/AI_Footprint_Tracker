import { payloadHash } from "@footprint/contracts";

/** Ephemeral evidence joins only. This module neither observes bytes nor attests to a native body type. */
export const UPLOAD_CORRELATION_LIMITS = Object.freeze({
  active: 64,
  seen: 256,
  captures: 128,
  references: 256,
  locators: 256,
  attachments: 16,
  ttlMs: 300000,
});
type Provider = "chatgpt" | "perplexity";
type Upload = {
  provider: Provider;
  handle: string;
  identity: string;
  expires: number;
  state: "reserved" | "uploaded" | "ready" | "spent" | "failed";
  uploadUrl?: string;
  objectUrl?: string;
  formKey?: string;
  captureId?: string;
  referenceKey?: string;
};
export type NewUploadAssociation = {
  captureId: string;
  /** This describes the observed reference set only, never extraction completeness or provider processing. */
  status: "matched" | "partial" | "unavailable" | "observed_empty";
  unmatchedReferenceCount: number;
  files: Array<{ fileHandle: string; origin: "new_upload" }>;
};
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const providerUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fileId = /^file_[0-9a-f]{32}$/;
const rejected = (): never => {
  throw new Error("upload_correlation_rejected");
};
function object(value: unknown, keys: string[]): Record<string, any> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== keys.sort().join(",")
  )
    return rejected();
  return value as Record<string, any>;
}
function string(value: unknown, max = 8192): string {
  if (typeof value !== "string" || !value.length || value.length > max)
    return rejected();
  return value;
}
function https(value: unknown): string {
  const text = string(value);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return rejected();
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    return rejected();
  return text;
}
function id(value: unknown, pattern = uuid): string {
  const text = string(value, 80);
  if (!pattern.test(text)) return rejected();
  return text;
}
function boundedArray(value: unknown, limit: number): value is unknown[] {
  return (
    Array.isArray(value) &&
    value.length <= limit &&
    Object.keys(value).length === value.length
  );
}
function route(
  data: Record<string, any>,
  path: string,
  method = "POST",
  transport = "Fetch",
  status?: number,
) {
  if (
    data.path !== path ||
    data.method !== method ||
    data.transport !== transport ||
    (status !== undefined && data.status !== status)
  )
    rejected();
}
function outcome(data: Record<string, any>, expectedStatus?: number): boolean {
  if (
    !["success", "failure", "aborted"].includes(data.outcome) ||
    (data.status !== null &&
      (!Number.isInteger(data.status) || data.status < 0 || data.status > 599))
  )
    return rejected();
  return (
    data.outcome === "success" &&
    (expectedStatus === undefined
      ? data.status >= 200 && data.status < 300
      : data.status === expectedStatus)
  );
}

/** One instance belongs to one document and capture-ownership epoch. Reset before changing either. */
export class UploadCorrelations {
  private epoch = crypto.randomUUID();
  private uploads = new Map<string, Upload>();
  private seen = new Set<string>();
  private seenCaptures = new Set<string>();
  private seenLocators = new Set<string>();
  private referenceOwners = new Map<string, string>();
  private wireIds = new Set<string>();
  private localRoles = new Map<string, "context" | "handle" | "capture">([
    [this.epoch, "context"],
  ]);
  private captures = new Map<
    string,
    {
      provider: Provider;
      identities: string[];
      association: NewUploadAssociation;
      expires: number;
      matchedReferences: string[];
    }
  >();
  constructor(private clock: () => number = Date.now) {}
  context(): string {
    return this.epoch;
  }
  /** The later observer may sweep on its bounded maintenance tick; every callback also sweeps before use. */
  sweep(context: string): void {
    this.check(context);
  }
  reset(): void {
    this.epoch = crypto.randomUUID();
    this.uploads.clear();
    this.seen.clear();
    this.captures.clear();
    this.seenCaptures.clear();
    this.seenLocators.clear();
    this.referenceOwners.clear();
    this.wireIds.clear();
    this.localRoles.clear();
    this.localRoles.set(this.epoch, "context");
  }
  /** Salted metadata fingerprints prevent replay after raw locators expire. No file bytes are hashed. */
  private fingerprint(
    provider: Provider,
    kind: string,
    metadata: string,
  ): string {
    return payloadHash([this.epoch, provider, kind, metadata]);
  }
  private check(context: string) {
    if (context !== this.epoch) rejected();
    for (const [handle, upload] of this.uploads)
      if (upload.expires <= this.clock()) this.uploads.delete(handle);
    for (const [capture, value] of this.captures)
      if (value.expires <= this.clock()) this.captures.delete(capture);
  }
  private reserve(context: string, upload: Upload, unique: string[]) {
    this.check(context);
    const keys = [
      "handle:" + upload.handle,
      ...unique.map((value) => upload.provider + ":" + value),
    ];
    const locators =
      upload.provider === "chatgpt"
        ? [this.fingerprint(upload.provider, "upload-url", upload.uploadUrl!)]
        : [
            this.fingerprint(upload.provider, "object-url", upload.objectUrl!),
            this.fingerprint(upload.provider, "form-key", upload.formKey!),
          ];
    if (
      this.uploads.has(upload.handle) ||
      this.localRoles.has(upload.handle) ||
      this.wireIds.has(upload.handle) ||
      unique.includes(upload.handle) ||
      unique.some((value) => this.localRoles.has(value)) ||
      new Set(keys).size !== keys.length ||
      keys.some((key) => this.seen.has(key)) ||
      locators.some((key) => this.seenLocators.has(key))
    )
      rejected();
    if (
      this.uploads.size >= UPLOAD_CORRELATION_LIMITS.active ||
      this.seen.size + keys.length > UPLOAD_CORRELATION_LIMITS.seen ||
      this.seenLocators.size + locators.length >
        UPLOAD_CORRELATION_LIMITS.locators
    )
      throw new Error("upload_correlation_capacity");
    const reference =
      upload.provider === "chatgpt" ? upload.identity : upload.objectUrl;
    upload.referenceKey = this.fingerprint(
      upload.provider,
      "reference",
      reference!,
    );
    upload.captureId = this.referenceOwners.get(upload.referenceKey);
    keys.forEach((key) => this.seen.add(key));
    locators.forEach((key) => this.seenLocators.add(key));
    unique.forEach((value) => this.wireIds.add(value));
    this.localRoles.set(upload.handle, "handle");
    this.uploads.set(upload.handle, upload);
  }
  /** Projection of the successful reservation response. Expiry is local and bounded, never a server-validity claim. */
  reserveChatGPT(context: string, value: unknown): void {
    const d = object(value, [
      "method",
      "path",
      "transport",
      "status",
      "eligible",
      "reservationId",
      "uploadUrl",
      "fileHandle",
    ]);
    route(d, "/backend-api/files/upload_reservations", "POST", "Fetch", 200);
    if (d.eligible !== true) rejected();
    const handle = id(d.fileHandle),
      identity = id(d.reservationId, fileId),
      uploadUrl = https(d.uploadUrl);
    this.reserve(
      context,
      {
        provider: "chatgpt",
        handle,
        identity,
        uploadUrl,
        state: "reserved",
        expires: this.clock() + UPLOAD_CORRELATION_LIMITS.ttlMs,
      },
      [identity],
    );
  }
  /** The caller must independently identify which local handle was supplied to this native upload. */
  uploadChatGPT(context: string, value: unknown): boolean {
    const d = object(value, [
      "fileHandle",
      "method",
      "transport",
      "url",
      "status",
      "outcome",
    ]);
    this.check(context);
    const upload = this.uploads.get(id(d.fileHandle));
    if (
      !upload ||
      upload.provider !== "chatgpt" ||
      upload.state !== "reserved" ||
      d.method !== "PUT" ||
      d.transport !== "XHR" ||
      https(d.url) !== upload.uploadUrl
    )
      return rejected();
    const success = outcome(d);
    upload.state = success ? "uploaded" : "failed";
    delete upload.uploadUrl;
    return success;
  }
  /** Events are a safe parser projection of the complete observed NDJSON response, not guessed wire keys. */
  claimChatGPT(context: string, value: unknown): boolean {
    const d = object(value, [
      "method",
      "path",
      "transport",
      "status",
      "outcome",
      "reservationId",
      "events",
    ]);
    this.check(context);
    const identity = id(d.reservationId, fileId);
    route(
      d,
      `/backend-api/files/upload_reservations/${identity}/claim_and_finish`,
    );
    const upload = [...this.uploads.values()].find(
      (u) => u.provider === "chatgpt" && u.identity === identity,
    );
    if (!upload || upload.state !== "uploaded") return rejected();
    if (!outcome(d, 200)) {
      upload.state = "failed";
      return false;
    }
    const expected = [
      "file.processing.started",
      "file.processing.file_ready",
      "file.indexing.completed",
      "file.processing.completed",
    ];
    upload.state = "failed";
    if (
      !boundedArray(d.events, expected.length) ||
      d.events.length !== expected.length
    ) {
      return rejected();
    }
    for (let i = 0; i < expected.length; i++) {
      const event = object(d.events[i], ["event", "fileId"]);
      if (event.event !== expected[i] || event.fileId !== identity) {
        upload.state = "failed";
        return rejected();
      }
    }
    upload.state = "ready";
    return true;
  }
  /** A projection of one batch result keyed by the separately observed client UUID. No credentials are accepted. */
  reservePerplexity(context: string, value: unknown): void {
    const d = object(value, [
      "method",
      "path",
      "transport",
      "status",
      "clientId",
      "resultClientId",
      "fileId",
      "bucketUrl",
      "objectUrl",
      "formKey",
      "rateLimited",
      "error",
      "fileHandle",
    ]);
    route(d, "/rest/uploads/batch_create_upload_urls", "POST", "Fetch", 200);
    const client = id(d.clientId, providerUuid),
      identity = id(d.fileId, providerUuid),
      handle = id(d.fileHandle),
      uploadUrl = https(d.bucketUrl),
      objectUrl = https(d.objectUrl),
      formKey = string(d.formKey, 2048);
    if (
      d.resultClientId !== client ||
      identity === client ||
      d.rateLimited !== false ||
      d.error !== null ||
      ![
        "https://ppl-ai-file-upload.s3.amazonaws.com",
        "https://ppl-ai-file-upload.s3.amazonaws.com/",
      ].includes(uploadUrl) ||
      !new URL(objectUrl).pathname.includes(identity) ||
      objectUrl.includes(client)
    )
      rejected();
    this.reserve(
      context,
      {
        provider: "perplexity",
        handle,
        identity,
        uploadUrl,
        objectUrl,
        formKey,
        state: "reserved",
        expires: this.clock() + UPLOAD_CORRELATION_LIMITS.ttlMs,
      },
      [client, identity],
    );
  }
  /** Multipart is an independently verified caller observation, not inferred from reservation metadata. */
  uploadPerplexity(context: string, value: unknown): boolean {
    const d = object(value, [
      "fileHandle",
      "method",
      "transport",
      "url",
      "formKey",
      "multipart",
      "status",
      "outcome",
    ]);
    this.check(context);
    const upload = this.uploads.get(id(d.fileHandle));
    if (
      !upload ||
      upload.provider !== "perplexity" ||
      upload.state !== "reserved" ||
      d.method !== "POST" ||
      d.transport !== "Fetch" ||
      d.multipart !== true ||
      https(d.url) !== upload.uploadUrl ||
      d.formKey !== upload.formKey
    )
      return rejected();
    const success = outcome(d, 204);
    upload.state = success ? "ready" : "failed";
    delete upload.uploadUrl;
    delete upload.formKey;
    return success;
  }
  consumeChatGPT(context: string, value: unknown): NewUploadAssociation {
    const d = object(value, [
      "method",
      "path",
      "transport",
      "captureId",
      "messageCount",
      "attachments",
    ]);
    route(d, "/backend-api/f/conversation");
    if (
      d.messageCount !== 1 ||
      !boundedArray(d.attachments, UPLOAD_CORRELATION_LIMITS.attachments)
    )
      return rejected();
    const identities = d.attachments.map((value: unknown) => {
      const a = object(value, [
        "id",
        "size",
        "name",
        "mime_type",
        "source",
        "library_file_id",
        "is_big_paste",
      ]);
      if (
        !Number.isSafeInteger(a.size) ||
        a.size < 0 ||
        a.size > 25 * 1024 * 1024 ||
        string(a.name, 1024).length === 0 ||
        a.mime_type !== "text/plain" ||
        a.source !== "local" ||
        a.is_big_paste !== false
      )
        return rejected();
      string(a.library_file_id, 256);
      return id(a.id, fileId);
    });
    return this.consume(context, "chatgpt", id(d.captureId), identities);
  }
  consumePerplexity(context: string, value: unknown): NewUploadAssociation {
    const d = object(value, [
      "method",
      "path",
      "transport",
      "captureId",
      "attachments",
    ]);
    route(d, "/rest/sse/perplexity_ask");
    if (!boundedArray(d.attachments, UPLOAD_CORRELATION_LIMITS.attachments))
      return rejected();
    return this.consume(
      context,
      "perplexity",
      id(d.captureId),
      d.attachments.map(https),
    );
  }
  private consume(
    context: string,
    provider: Provider,
    captureId: string,
    identities: string[],
  ): NewUploadAssociation {
    this.check(context);
    if (
      this.wireIds.has(captureId) ||
      (this.localRoles.has(captureId) &&
        this.localRoles.get(captureId) !== "capture")
    )
      return rejected();
    if (new Set(identities).size !== identities.length) return rejected();
    identities = identities
      .map((identity) => this.fingerprint(provider, "reference", identity))
      .sort();
    const previous = this.captures.get(captureId);
    if (previous) {
      if (
        previous.provider !== provider ||
        previous.identities.length !== identities.length ||
        previous.identities.some((id, i) => id !== identities[i])
      )
        return rejected();
    }
    if (!previous && this.seenCaptures.has(captureId)) return rejected();
    if (
      !previous &&
      this.seenCaptures.size >= UPLOAD_CORRELATION_LIMITS.captures
    )
      throw new Error("upload_correlation_capacity");
    const newReferences = identities.filter(
      (reference) => !this.referenceOwners.has(reference),
    );
    if (
      this.referenceOwners.size + newReferences.length >
      UPLOAD_CORRELATION_LIMITS.references
    )
      throw new Error("upload_correlation_capacity");
    const matches = [...this.uploads.values()].filter(
      (upload) =>
        upload.provider === provider &&
        (upload.captureId ??
          this.referenceOwners.get(upload.referenceKey!) ??
          captureId) === captureId &&
        upload.state === "ready" &&
        identities.includes(upload.referenceKey!),
    );
    const files = [
      ...(previous?.association.files ?? []),
      ...matches.map((upload) => ({
        fileHandle: upload.handle,
        origin: "new_upload" as const,
      })),
    ];
    const matchedReferences = [
      ...(previous?.matchedReferences ?? []),
      ...matches.map((upload) => upload.referenceKey!),
    ];
    if (
      files.length > identities.length ||
      new Set(files.map((file) => file.fileHandle)).size !== files.length ||
      new Set(matchedReferences).size !== matchedReferences.length
    )
      return rejected();
    const association: NewUploadAssociation = {
      captureId,
      status:
        identities.length === 0
          ? "observed_empty"
          : files.length === identities.length
            ? "matched"
            : files.length
              ? "partial"
              : "unavailable",
      unmatchedReferenceCount: identities.length - files.length,
      files,
    };
    newReferences.forEach((reference) =>
      this.referenceOwners.set(reference, captureId),
    );
    for (const upload of this.uploads.values())
      if (!upload.captureId)
        upload.captureId = this.referenceOwners.get(upload.referenceKey!);
    for (const upload of matches) {
      upload.state = "spent";
      delete upload.objectUrl;
    }
    this.captures.set(captureId, {
      provider,
      identities: [...identities],
      association,
      expires:
        previous?.expires ?? this.clock() + UPLOAD_CORRELATION_LIMITS.ttlMs,
      matchedReferences,
    });
    this.seenCaptures.add(captureId);
    this.localRoles.set(captureId, "capture");
    return structuredClone(association);
  }
}
