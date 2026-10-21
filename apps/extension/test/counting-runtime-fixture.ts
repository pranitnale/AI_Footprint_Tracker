import { readFile } from "node:fs/promises";
import ts from "typescript";
import * as tokenizers from "@footprint/tokenizers";
import * as fileText from "@footprint/file-text";
import { FileCountHost } from "@footprint/file-text/host";
import * as countingConfig from "../lib/counting-config";
import * as countingWorkerConfig from "../lib/counting-worker-config";
import type { CountHost, CountWorkerPort } from "../lib/count-host";
import type { FileWorkerPort } from "@footprint/file-text/host";

export function distinctTokenizer(
  assetHash = "a".repeat(64),
): tokenizers.TokenizerImplementation {
  return {
    id: "review-fake-1",
    profiles: [
      { profileId: "observed-text-v1", encoding: "review_fake", assetHash },
    ],
    async count(job) {
      return {
        jobId: job.jobId,
        revision: job.revision,
        measurement: {
          value: job.text ? "1" : "0",
          evidence: "heuristic_estimate",
          scope: "observed_text",
          completeness: "complete_for_scope",
          profile_id: "observed-text-v1",
          reason: "tokenizer_mapping_unverified",
        },
        assetHash,
        profileId: "observed-text-v1",
        encoding: "review_fake",
        modelExactness: "unverified",
        status: "counted",
      };
    },
  };
}

export async function loadCountingModule(
  file: string,
  extra: Record<string, unknown> = {},
  family = "chrome",
  globals: Record<string, unknown> = {},
) {
  const source = (
    await readFile(new URL(`../lib/${file}.ts`, import.meta.url), "utf8")
  ).replaceAll("import.meta.env.BROWSER", JSON.stringify(family));
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const result: Record<string, any> = {};
  const imports: Record<string, unknown> = {
    "@footprint/tokenizers": tokenizers,
    "@footprint/tokenizers/metadata": tokenizers,
    "@footprint/tokenizers/worker": tokenizers,
    "@footprint/file-text": fileText,
    "@footprint/file-text/types": fileText,
    "@footprint/file-text/host": { FileCountHost },
    "./counting-config": countingConfig,
    "./counting-worker-config": countingWorkerConfig,
    ...extra,
  };
  new Function(
    "require",
    "exports",
    "self",
    "globalThis",
    "navigator",
    compiled,
  )(
    (name: string) => {
      if (name.endsWith("?worker&url"))
        return { default: "synthetic-worker-url" };
      if (!(name in imports))
        throw new Error(`Unexpected counting dependency: ${name}`);
      return imports[name];
    },
    result,
    { postMessage() {}, onmessage: null },
    globals,
    globals.navigator,
  );
  return result;
}

/** Runs the actual worker runtimes behind transport doubles, not a prebuilt successful response. */
export async function countingHarness(
  counting: tokenizers.CountingRuntime,
  family: "chrome" | "firefox" = "chrome",
) {
  const countWorker = await loadCountingModule("count.worker");
  const fileWorker = await loadCountingModule("file.worker");
  const hostModule = await loadCountingModule("count-host");
  const CountHostConstructor = hostModule.CountHost as new (
    options: any,
  ) => CountHost;
  const commands: tokenizers.CountRequest[] = [];
  const ports: CountWorkerPort[] = [];
  let asset = counting.manifest.profiles[0].assetHash;
  let corruptFiles = false;
  const host = new CountHostConstructor({
    counting,
    createCountWorker: () => {
      let stopped = false;
      const port: CountWorkerPort = {
        onmessage: null,
        onerror: null,
        postMessage(command) {
          if (command.type === "count")
            commands.push(structuredClone(command.request));
          queueMicrotask(() => {
            if (!stopped) runtime.receive(structuredClone(command));
          });
        },
        terminate() {
          stopped = true;
        },
      };
      const runtime = new countWorker.CountWorkerRuntime(
        (result: tokenizers.CountResponse) => {
          if (!stopped)
            port.onmessage?.({ data: structuredClone(result) } as MessageEvent);
        },
        distinctTokenizer(asset),
      );
      ports.push(port);
      return port;
    },
    createFileWorker: () => {
      const port: FileWorkerPort = {
        onmessage: null,
        onerror: null,
        postMessage(job, transfer) {
          const copied = structuredClone(job, { transfer });
          void runtime.receive(copied);
        },
        terminate() {
          runtime.dispose();
        },
      };
      const runtime = new fileWorker.FileWorkerRuntime(
        (value: fileText.FileCountResult) => {
          const result = structuredClone(value);
          if (corruptFiles && result.status === "counted")
            result.tokenizerAssetHash = "f".repeat(64);
          port.onmessage?.({ data: result } as MessageEvent);
        },
        distinctTokenizer(asset),
      );
      return port;
    },
  });
  const root = `${family === "firefox" ? "moz" : "chrome"}-extension://counting-fixture/`;
  const browser = {
    runtime: {
      getURL: (path: string) => root + path.replace(/^\//, ""),
      getContexts: async () => [{}],
      sendMessage: async (value: any) =>
        value.command.type === "cancel"
          ? {
              cancelled: host.cancel(
                value.command.jobId,
                value.command.revision,
              ),
            }
          : host.count(value.command.request),
    },
    offscreen: { createDocument: async () => {} },
  };
  const globals = {
    clients: {
      matchAll: async () => [
        {
          url: root + "offscreen.html",
          postMessage(value: any, transfer: Transferable[]) {
            const copied = structuredClone(
              { value, port: transfer[0] as MessagePort },
              { transfer },
            );
            const abort = new AbortController();
            copied.port.onmessage = () => abort.abort();
            void host
              .countFile(copied.value.job, abort.signal)
              .then((result) => copied.port.postMessage(result))
              .finally(() => copied.port.close());
          },
        },
      ],
    },
  };
  const platformModule = await loadCountingModule(
    "platform",
    {
      "wxt/browser": { browser },
      "./count-host": { ...tokenizers, CountHost: CountHostConstructor },
    },
    family,
    globals,
  );
  const platform = platformModule.createCountingPlatform(counting, {
    createHost: () => host,
  });
  return {
    host,
    platform,
    commands,
    ports,
    setWorkerAsset(value: string) {
      asset = value;
    },
    corruptFileReplies() {
      corruptFiles = true;
    },
    dispose() {
      platform.dispose();
      host.dispose();
    },
  };
}
