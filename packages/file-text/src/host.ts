import {
  FILE_LIMITS,
  FileFailure,
  unavailable,
  validateFileJob,
  validFileResult,
  withFileTokenizerSelection,
  type AccessibleFileJob,
  type FileCountResult,
} from "./types";
import {
  DEFAULT_COUNTING_RUNTIME,
  snapshotCountingRuntime,
  type CountingRuntime,
} from "@footprint/tokenizers/metadata";

export interface FileWorkerPort {
  onmessage: ((event: MessageEvent<FileCountResult>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(job: AccessibleFileJob, transfer: Transferable[]): void;
  terminate(): void;
}
/** One active file job, no queue. A separate worker prevents a file from blocking conversation counts. */
export class FileCountHost {
  private active: {
    job: AccessibleFileJob;
    worker: FileWorkerPort;
    done: (result: FileCountResult) => void;
  } | null = null;
  private disposed = false;
  private readonly counting: CountingRuntime;
  constructor(
    private createWorker: () => FileWorkerPort,
    counting: CountingRuntime = DEFAULT_COUNTING_RUNTIME,
  ) {
    this.counting = snapshotCountingRuntime(counting);
  }

  count(
    input: AccessibleFileJob,
    signal?: AbortSignal,
  ): Promise<FileCountResult> {
    validateFileJob(input);
    const job = withFileTokenizerSelection(input, this.counting);
    if (this.disposed)
      return Promise.resolve(unavailable(job, "worker_unavailable"));
    if (signal?.aborted) return Promise.resolve(unavailable(job, "cancelled"));
    if (this.active) return Promise.resolve(unavailable(job, "busy"));
    let worker: FileWorkerPort;
    try {
      worker = this.createWorker();
    } catch {
      return Promise.resolve(unavailable(job, "worker_unavailable"));
    }
    return new Promise((resolve) => {
      const finish = (result: FileCountResult) => {
        if (this.active?.worker !== worker) return;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        worker.onmessage = null;
        worker.onerror = null;
        try {
          worker.terminate();
        } catch {}
        this.active = null;
        resolve(result);
      };
      const abort = () => finish(unavailable(job, "cancelled"));
      const timer = setTimeout(
        () => finish(unavailable(job, "timeout")),
        FILE_LIMITS.timeoutMs,
      );
      this.active = { job, worker, done: finish };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      worker.onerror = () => finish(unavailable(job, "worker_unavailable"));
      worker.onmessage = (event) => {
        const result = event.data;
        if (!validFileResult(result, job, this.counting.manifest))
          finish(unavailable(job, "worker_unavailable"));
        else finish(result);
      };
      try {
        // Never detach an upload/request buffer owned by the host website or calling code.
        const bytes = job.bytes.slice(0);
        worker.postMessage({ ...job, bytes }, [bytes]);
      } catch (error) {
        finish(
          unavailable(
            job,
            error instanceof FileFailure ? error.code : "worker_unavailable",
          ),
        );
      }
    });
  }
  cancel(jobId: string) {
    if (this.active?.job.jobId === jobId)
      this.active.done(unavailable(this.active.job, "cancelled"));
  }
  dispose() {
    this.disposed = true;
    if (this.active)
      this.active.done(unavailable(this.active.job, "cancelled"));
  }
}
