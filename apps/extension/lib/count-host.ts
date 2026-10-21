import workerUrl from "./count.worker?worker&url";
import fileWorkerUrl from "./file.worker?worker&url";
import { FileCountHost, type FileWorkerPort } from "@footprint/file-text/host";
import type { AccessibleFileJob } from "@footprint/file-text";
import {
  COUNT_LIMITS,
  DEFAULT_TOKENIZER_IMPLEMENTATION_ID,
  DEFAULT_TOKENIZER_PROFILE_ID,
  unavailableCountResponse,
  validateCountCommand,
  validateCountRequest,
  validCountResponse,
  createCountingRuntime,
  snapshotCountingRuntime,
  snapshotTokenizerManifest,
  type CountCommand,
  type CountRequest,
  type CountResponse,
  type TokenizerImplementation,
  type TokenizerManifest,
  type CountingRuntime,
} from "@footprint/tokenizers/metadata";
import { PACKAGED_COUNTING_RUNTIME } from "./counting-config";

export {
  COUNT_LIMITS,
  DEFAULT_TOKENIZER_IMPLEMENTATION_ID,
  DEFAULT_TOKENIZER_PROFILE_ID,
  unavailableCountResponse,
  validateCountCommand,
  validateCountRequest,
  validCountResponse,
};
export type { CountRequest, CountResponse };

export interface CountWorkerPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(command: CountCommand): void;
  terminate(): void;
}

export interface CountHostOptions {
  createCountWorker?: () => CountWorkerPort;
  createFileWorker?: () => FileWorkerPort;
  implementation?: TokenizerImplementation;
  counting?: CountingRuntime;
  timeoutMs?: number;
}

export class CountHost {
  private files: FileCountHost;
  private worker: CountWorkerPort | null = null;
  private disposed = false;
  private seen: string[] = [];
  private pending = new Map<
    string,
    {
      request: CountRequest;
      resolve: (value: CountResponse) => void;
      timer: ReturnType<typeof setTimeout>;
      abort?: () => void;
      signal?: AbortSignal;
    }
  >();
  private readonly createCountWorker: () => CountWorkerPort;
  private readonly implementation: TokenizerManifest;
  readonly counting: CountingRuntime;
  private readonly timeoutMs: number;

  constructor(options: CountHostOptions = {}) {
    this.createCountWorker =
      options.createCountWorker ??
      (() => new Worker(workerUrl, { type: "module" }));
    this.counting = snapshotCountingRuntime(
      options.counting ??
        (options.implementation
          ? createCountingRuntime(
              options.implementation,
              options.implementation.profiles[0]?.profileId,
            )
          : PACKAGED_COUNTING_RUNTIME),
    );
    if (
      options.implementation &&
      JSON.stringify(snapshotTokenizerManifest(options.implementation)) !==
        JSON.stringify(this.counting.manifest)
    )
      throw new Error("tokenizer_manifest_invalid");
    this.implementation = this.counting.manifest;
    this.timeoutMs = options.timeoutMs ?? COUNT_LIMITS.timeoutMs;
    this.files = new FileCountHost(
      options.createFileWorker ??
        (() => new Worker(fileWorkerUrl, { type: "module" })),
      this.counting,
    );
  }

  countFile(job: AccessibleFileJob, signal?: AbortSignal) {
    return this.files.count(job, signal);
  }
  cancelFile(jobId: string) {
    this.files.cancel(jobId);
  }

  count(input: CountRequest, signal?: AbortSignal): Promise<CountResponse> {
    try {
      validateCountRequest(input);
    } catch {
      return Promise.reject(new Error("payload_rejected"));
    }
    const request: CountRequest = { ...input, fields: { ...input.fields } };
    const selection = {
      implementationId: request.implementationId,
      profileId: request.profileId,
    };
    if (this.disposed)
      return Promise.resolve(
        unavailableCountResponse(request, "worker_unavailable", selection),
      );
    if (signal?.aborted)
      return Promise.resolve(
        unavailableCountResponse(request, "cancelled", selection),
      );
    if (this.pending.has(request.jobId) || this.seen.includes(request.jobId))
      return Promise.resolve(
        unavailableCountResponse(request, "duplicate_job", selection),
      );
    if (this.pending.size >= COUNT_LIMITS.pendingJobs)
      return Promise.resolve(
        unavailableCountResponse(request, "busy", selection),
      );
    if (!this.worker) {
      try {
        this.worker = this.createCountWorker();
      } catch {
        return Promise.resolve(
          unavailableCountResponse(request, "worker_unavailable", selection),
        );
      }
      this.worker.onmessage = (event) => this.receive(event.data);
      this.worker.onerror = () => this.reset("worker_unavailable");
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.postCancel(request);
        this.finish(
          request.jobId,
          unavailableCountResponse(request, "tokenizer_timeout", selection),
        );
      }, this.timeoutMs);
      const abort = signal
        ? () => {
            this.postCancel(request);
            this.finish(
              request.jobId,
              unavailableCountResponse(request, "cancelled", selection),
            );
          }
        : undefined;
      this.pending.set(request.jobId, {
        request,
        resolve,
        timer,
        abort,
        signal,
      });
      signal?.addEventListener("abort", abort!, { once: true });
      if (signal?.aborted) {
        abort!();
        return;
      }
      try {
        this.worker!.postMessage({ type: "count", request });
      } catch {
        this.reset("worker_unavailable");
      }
    });
  }

  cancel(jobId: string, revision?: number) {
    const item = this.pending.get(jobId);
    if (!item || (revision !== undefined && item.request.revision !== revision))
      return false;
    this.postCancel(item.request);
    this.finish(
      jobId,
      unavailableCountResponse(item.request, "cancelled", {
        implementationId: item.request.implementationId,
        profileId: item.request.profileId,
      }),
    );
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.files.dispose();
    this.reset("cancelled");
  }

  private receive(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const jobId = (value as { jobId?: unknown }).jobId;
    if (typeof jobId !== "string") return;
    const item = this.pending.get(jobId);
    if (!item) return;
    const response = validCountResponse(
      value,
      item.request,
      this.implementation,
    )
      ? value
      : unavailableCountResponse(item.request, "stale_tokenizer_response", {
          implementationId: item.request.implementationId,
          profileId: item.request.profileId,
        });
    this.finish(jobId, response);
  }

  private finish(jobId: string, response: CountResponse) {
    const item = this.pending.get(jobId);
    if (!item) return;
    clearTimeout(item.timer);
    if (item.abort) item.signal?.removeEventListener("abort", item.abort);
    this.pending.delete(jobId);
    this.seen.push(jobId);
    if (this.seen.length > COUNT_LIMITS.pendingJobs * 8) this.seen.shift();
    item.resolve(response);
  }

  private postCancel(request: Pick<CountRequest, "jobId" | "revision">) {
    try {
      this.worker?.postMessage({
        type: "cancel",
        jobId: request.jobId,
        revision: request.revision,
      });
    } catch {}
  }

  private reset(reason: "worker_unavailable" | "cancelled") {
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      try {
        worker.terminate();
      } catch {}
    }
    for (const item of [...this.pending.values()])
      this.finish(
        item.request.jobId,
        unavailableCountResponse(item.request, reason, {
          implementationId: item.request.implementationId,
          profileId: item.request.profileId,
        }),
      );
  }
}
