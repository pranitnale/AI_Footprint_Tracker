import { browser } from "wxt/browser";
import {
  FILE_LIMITS,
  FileFailure,
  unavailable,
  validFileResult,
  type AccessibleFileJob,
  type FileCountResult,
  type FileKind,
} from "@footprint/file-text/types";
import {
  snapshotCountingRuntime,
  type CountingRuntime,
} from "@footprint/tokenizers/metadata";
import { PACKAGED_COUNTING_RUNTIME } from "./counting-config";

let activeRead = false;
/** Extension-owned pages may pass a Blob already supplied by the user. No name or URL crosses this API. */
export async function countAccessibleBlob(
  blob: Blob,
  kind: FileKind,
  signal?: AbortSignal,
  counting: CountingRuntime = PACKAGED_COUNTING_RUNTIME,
): Promise<FileCountResult> {
  if (!(blob instanceof Blob) || blob.size > FILE_LIMITS.inputBytes)
    throw new FileFailure("input_limit");
  if (activeRead)
    return {
      ...unavailable({ jobId: crypto.randomUUID(), revision: 1, kind }, "busy"),
      inputBytes: blob.size,
    };
  activeRead = true;
  try {
    return await countPrivateBlob(
      blob,
      kind,
      signal,
      snapshotCountingRuntime(counting),
    );
  } finally {
    activeRead = false;
  }
}
async function countPrivateBlob(
  blob: Blob,
  kind: FileKind,
  signal?: AbortSignal,
  counting: CountingRuntime = PACKAGED_COUNTING_RUNTIME,
): Promise<FileCountResult> {
  if (!(blob instanceof Blob) || blob.size > FILE_LIMITS.inputBytes)
    throw new FileFailure("input_limit");
  if (!["text", "pdf", "docx", "xlsx", "pptx"].includes(kind))
    throw new FileFailure("unsupported_file");
  const job: AccessibleFileJob = {
    jobId: crypto.randomUUID(),
    revision: 1,
    kind,
    bytes: await blob.arrayBuffer(),
    tokenizerImplementationId: counting.selection.implementationId,
    tokenizerProfileId: counting.selection.profileId,
  };
  if (signal?.aborted) return unavailable(job, "cancelled");
  if (import.meta.env.BROWSER === "firefox") {
    let cancelResult!: (result: FileCountResult) => void;
    const cancellation = new Promise<FileCountResult>((resolve) => {
      cancelResult = resolve;
    });
    const stop = (reason: "cancelled" | "timeout") => {
      void browser.runtime
        .sendMessage({
          target: "cancel-accessible-file-count",
          jobId: job.jobId,
        })
        .catch(() => {});
      cancelResult(unavailable(job, reason));
    };
    const cancel = () => stop("cancelled");
    const timer = setTimeout(
      () => stop("timeout"),
      FILE_LIMITS.timeoutMs + 2000,
    );
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const pending = browser.runtime.sendMessage({
        target: "accessible-file-count",
        job,
      });
      if (signal?.aborted) cancel();
      const result = await Promise.race([pending, cancellation]);
      return validFileResult(result, job, counting.manifest)
        ? result
        : unavailable(job, "worker_unavailable");
    } catch {
      return unavailable(job, "worker_unavailable");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  }
  let registration: ServiceWorkerRegistration | undefined;
  try {
    registration = await navigator.serviceWorker?.getRegistration(
      browser.runtime.getURL("/"),
    );
  } catch {
    return unavailable(job, "worker_unavailable");
  }
  if (!registration?.active) return unavailable(job, "worker_unavailable");
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let done = false;
    const finish = (result: FileCountResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      channel.port1.close();
      resolve({ ...result, inputBytes: blob.size });
    };
    const abort = () => {
      channel.port1.postMessage({ cancel: job.jobId });
      finish(unavailable(job, "cancelled"));
    };
    const timer = setTimeout(() => {
      channel.port1.postMessage({ cancel: job.jobId });
      finish(unavailable(job, "timeout"));
    }, FILE_LIMITS.timeoutMs + 2000);
    signal?.addEventListener("abort", abort, { once: true });
    channel.port1.onmessage = (event) =>
      finish(
        validFileResult(event.data, job, counting.manifest)
          ? event.data
          : unavailable(job, "worker_unavailable"),
      );
    try {
      // Blob.arrayBuffer created a private copy; the user's original File remains untouched.
      registration.active!.postMessage(
        { target: "accessible-file-count", job },
        [channel.port2, job.bytes],
      );
      if (signal?.aborted) abort();
    } catch {
      finish(unavailable(job, "worker_unavailable"));
    }
  });
}
