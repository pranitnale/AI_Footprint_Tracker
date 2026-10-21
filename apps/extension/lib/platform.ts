import { browser } from "wxt/browser";
import {
  CountHost,
  COUNT_LIMITS,
  unavailableCountResponse,
  validateCountRequest,
  validCountResponse,
  type CountRequest,
  type CountResponse,
} from "./count-host";
import {
  FILE_LIMITS,
  unavailable,
  validateFileJob,
  validFileResult,
  withFileTokenizerSelection,
  type AccessibleFileJob,
  type FileCountResult,
} from "@footprint/file-text/types";
import {
  snapshotCountingRuntime,
  type CountingRuntime,
} from "@footprint/tokenizers/metadata";
import { PACKAGED_COUNTING_RUNTIME } from "./counting-config";
const firefox = import.meta.env.BROWSER === "firefox";
// Must equal the Firefox manifest's optional data_collection_permissions list
// (wxt.config.ts). hasCompanyConsent needs every one granted, so a connection
// agreed before a category was added asks again instead of sending. See
// docs/release/FIREFOX-DATA-COLLECTION.md for why each category is declared.
export const COMPANY_DATA_CATEGORIES = [
  "websiteActivity",
  "authenticationInfo",
  "personallyIdentifyingInfo",
  "technicalAndInteraction",
  "browsingActivity",
];
export const browserFamily = (): "chrome" | "edge" | "firefox" =>
  import.meta.env.BROWSER === "firefox"
    ? "firefox"
    : import.meta.env.BROWSER === "edge"
      ? "edge"
      : "chrome";
export function createCountingPlatform(
  counting: CountingRuntime = PACKAGED_COUNTING_RUNTIME,
  options: { createHost?: () => CountHost } = {},
) {
  const runtime = snapshotCountingRuntime(counting);
  let host: CountHost | null = null;
  let offscreenFlight: Promise<void> | null = null;
  // Checking for the offscreen document costs a browser round trip per count.
  // Remember success until a send fails, then check again.
  let offscreenReady = false;
  async function ensureTokenizerHost(): Promise<void> {
    if (firefox) {
      host ??= options.createHost?.() ?? new CountHost({ counting: runtime });
      return;
    }
    if (offscreenReady) return;
    if (offscreenFlight) return offscreenFlight;
    offscreenFlight = (async () => {
      const api = (browser as any).offscreen;
      if (!api) throw new Error("tokenizer_unavailable");
      const contexts = await (browser.runtime as any).getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [browser.runtime.getURL("/offscreen.html")],
      });
      if (!contexts.length)
        await api.createDocument({
          url: browser.runtime.getURL("/offscreen.html"),
          reasons: ["WORKERS"],
          justification:
            "Count observed text locally in a bundled worker without storing chat content.",
        });
      offscreenReady = true;
    })().finally(() => {
      offscreenFlight = null;
    });
    return offscreenFlight;
  }
  async function countLocally(
    input: CountRequest,
    signal?: AbortSignal,
  ): Promise<CountResponse> {
    validateCountRequest(input);
    const request: CountRequest = { ...input, fields: { ...input.fields } };
    const selection = {
      implementationId: request.implementationId,
      profileId: request.profileId,
    };
    if (signal?.aborted)
      return unavailableCountResponse(request, "cancelled", selection);
    try {
      await ensureTokenizerHost();
    } catch {
      return unavailableCountResponse(request, "worker_unavailable", selection);
    }
    if (signal?.aborted)
      return unavailableCountResponse(request, "cancelled", selection);
    if (firefox) {
      const response = await host!.count(request, signal);
      return validCountResponse(response, request, runtime.manifest)
        ? response
        : unavailableCountResponse(
            request,
            "stale_tokenizer_response",
            selection,
          );
    }
    return new Promise((resolve) => {
      let finished = false;
      const finish = (response: CountResponse) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        resolve(response);
      };
      const cancel = () =>
        browser.runtime
          .sendMessage({
            target: "tokenizer",
            command: {
              type: "cancel",
              jobId: request.jobId,
              revision: request.revision,
            },
          })
          .catch(() => {});
      const abort = () => {
        void cancel();
        finish(unavailableCountResponse(request, "cancelled", selection));
      };
      const timer = setTimeout(() => {
        void cancel();
        finish(
          unavailableCountResponse(request, "tokenizer_timeout", selection),
        );
      }, COUNT_LIMITS.timeoutMs + 1_000);
      signal?.addEventListener("abort", abort, { once: true });
      const send = (retry: boolean): void => {
        browser.runtime
          .sendMessage({
            target: "tokenizer",
            command: { type: "count", request },
          })
          .then((response) =>
            finish(
              validCountResponse(response, request, runtime.manifest)
                ? response
                : unavailableCountResponse(
                    request,
                    "stale_tokenizer_response",
                    selection,
                  ),
            ),
          )
          .catch(async () => {
            // A rejected send usually means the offscreen document is gone. Recreate it
            // once and resend the same job so a remembered readiness cannot lose a count.
            offscreenReady = false;
            if (retry && !finished) {
              try {
                await ensureTokenizerHost();
                if (!finished) return send(false);
              } catch {}
            }
            finish(
              unavailableCountResponse(
                request,
                "worker_unavailable",
                selection,
              ),
            );
          });
      };
      send(true);
      if (signal?.aborted) abort();
    });
  }
  function cancelCountLocally(jobId: string, revision: number) {
    if (firefox) return Promise.resolve(host?.cancel(jobId, revision) ?? false);
    return browser.runtime
      .sendMessage({
        target: "tokenizer",
        command: { type: "cancel", jobId, revision },
      })
      .then((response) => response?.cancelled === true)
      .catch(() => false);
  }
  /** Receives an already accessible byte snapshot, never a private URL or an attachment-count guess. */
  async function countFileLocally(
    input: AccessibleFileJob,
    signal?: AbortSignal,
    waitForTermination = false,
  ): Promise<FileCountResult> {
    validateFileJob(input);
    const job = withFileTokenizerSelection(input, runtime);
    if (signal?.aborted) return unavailable(job, "cancelled");
    try {
      await ensureTokenizerHost();
    } catch {
      return unavailable(job, "worker_unavailable");
    }
    if (signal?.aborted) return unavailable(job, "cancelled");
    if (firefox) {
      const response = await host!.countFile(job, signal);
      return validFileResult(response, job, runtime.manifest)
        ? response
        : unavailable(job, "worker_unavailable");
    }
    const clients = (
      globalThis as unknown as {
        clients?: {
          matchAll(options: object): Promise<
            Array<{
              url: string;
              postMessage(value: unknown, transfer: Transferable[]): void;
            }>
          >;
        };
      }
    ).clients;
    if (!clients) return unavailable(job, "worker_unavailable");
    const findDocument = async () =>
      (
        await clients.matchAll({ type: "window", includeUncontrolled: true })
      ).find(
        (client) => client.url === browser.runtime.getURL("/offscreen.html"),
      );
    let document = await findDocument();
    if (!document) {
      // Remembered readiness can outlive a closed offscreen document.
      offscreenReady = false;
      try {
        await ensureTokenizerHost();
      } catch {
        return unavailable(job, "worker_unavailable");
      }
      document = await findDocument();
    }
    if (signal?.aborted) return unavailable(job, "cancelled");
    if (!document) return unavailable(job, "worker_unavailable");
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      let finished = false;
      const finish = (result: FileCountResult) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        channel.port1.close();
        resolve(result);
      };
      const abort = () => {
        channel.port1.postMessage({
          cancel: job.jobId,
          revision: job.revision,
        });
        if (!waitForTermination) finish(unavailable(job, "cancelled"));
      };
      const timer = setTimeout(() => {
        channel.port1.postMessage({
          cancel: job.jobId,
          revision: job.revision,
        });
        if (!waitForTermination) finish(unavailable(job, "timeout"));
      }, FILE_LIMITS.timeoutMs + 1000);
      signal?.addEventListener("abort", abort, { once: true });
      channel.port1.onmessage = (event) =>
        finish(
          validFileResult(event.data, job, runtime.manifest)
            ? event.data
            : unavailable(job, "worker_unavailable"),
        );
      try {
        // Structured-clone transport avoids Chrome runtime JSON conversion of ArrayBuffers.
        const bytes = job.bytes.slice(0);
        document.postMessage(
          { target: "accessible-file-count", job: { ...job, bytes } },
          [channel.port2, bytes],
        );
        if (signal?.aborted) abort();
      } catch {
        finish(unavailable(job, "worker_unavailable"));
      }
    });
  }
  function cancelFileLocally(jobId: string) {
    host?.cancelFile(jobId);
  }
  return Object.freeze({
    counting: runtime,
    ensureTokenizerHost,
    countLocally,
    cancelCountLocally,
    countFileLocally,
    cancelFileLocally,
    dispose() {
      host?.dispose();
      host = null;
    },
  });
}
const countingPlatform = createCountingPlatform();
export const ensureTokenizerHost = countingPlatform.ensureTokenizerHost;
export const countLocally = countingPlatform.countLocally;
export const cancelCountLocally = countingPlatform.cancelCountLocally;
export const countFileLocally = countingPlatform.countFileLocally;
export const cancelFileLocally = countingPlatform.cancelFileLocally;
export async function scheduleSync() {
  await browser.alarms.create("sync", { periodInMinutes: 1 });
}
export async function requestServerOrigin(origin: string) {
  return browser.permissions.request({
    origins: [origin + "/*"],
    ...(firefox ? { data_collection: COMPANY_DATA_CATEGORIES } : {}),
  } as any);
}
export async function hasCompanyConsent(origin: string) {
  if (!(await browser.permissions.contains({ origins: [origin + "/*"] })))
    return false;
  if (!firefox) return true;
  const permissions = (await browser.permissions.getAll()) as any;
  return (
    Array.isArray(permissions.data_collection) &&
    COMPANY_DATA_CATEGORIES.every((category) =>
      permissions.data_collection.includes(category),
    )
  );
}
export async function openDashboard() {
  await browser.tabs.create({ url: browser.runtime.getURL("/dashboard.html") });
}
export async function getRuntimeCapabilities() {
  let ed25519 = false;
  try {
    const pair = (await crypto.subtle.generateKey("Ed25519", false, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const probe = new Uint8Array([0]);
    const signature = await crypto.subtle.sign(
      "Ed25519",
      pair.privateKey,
      probe,
    );
    ed25519 = await crypto.subtle.verify(
      "Ed25519",
      pair.publicKey,
      signature,
      probe,
    );
  } catch {}
  const permissions = (await browser.permissions.getAll()) as any;
  return {
    browser: browserFamily(),
    tokenizerHost: firefox ? "background-worker" : "offscreen-worker",
    tokenizerHostAvailable: firefox
      ? typeof Worker !== "undefined"
      : typeof (browser as any).offscreen?.createDocument === "function" &&
        typeof (browser.runtime as any).getContexts === "function",
    ed25519,
    builtinDataConsent: firefox
      ? Array.isArray(permissions.data_collection)
      : null,
    minimumBrowser: firefox ? "140" : "137",
    liveReleaseVerification: "unverified",
  };
}
