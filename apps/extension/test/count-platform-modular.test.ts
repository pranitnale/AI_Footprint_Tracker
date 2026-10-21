import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import * as tokenizers from "@footprint/tokenizers";
import * as countingConfig from "../lib/counting-config";
import * as fileTypes from "@footprint/file-text/types";
import type { CountRequest } from "@footprint/tokenizers";

function request(): CountRequest {
  return {
    jobId: crypto.randomUUID(),
    revision: 2,
    modelId: null,
    implementationId: tokenizers.DEFAULT_TOKENIZER_IMPLEMENTATION_ID,
    profileId: "cl100k-base-4.0.0-reference",
    fields: { input: "platform input", answer: "platform answer" },
  };
}

async function evaluatePlatform(
  family: "chrome" | "firefox",
  sendMessage: (message: any) => Promise<any>,
  Host: new () => {
    count(input: CountRequest, signal?: AbortSignal): Promise<any>;
    cancel(jobId: string, revision: number): boolean;
  },
  onGetContexts: () => void = () => {},
) {
  const root = `${family === "firefox" ? "moz" : "chrome"}-extension://count/`;
  const browser: any = {
    runtime: {
      getURL: (path: string) => root + path.replace(/^\//, ""),
      getContexts: async () => {
        onGetContexts();
        return [{ documentUrl: root + "offscreen.html" }];
      },
      sendMessage,
    },
    offscreen: { createDocument: async () => {} },
    permissions: { getAll: async () => ({}) },
  };
  const source = (
    await readFile(new URL("../lib/platform.ts", import.meta.url), "utf8")
  ).replaceAll("import.meta.env.BROWSER", JSON.stringify(family));
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exported: Record<string, any> = {};
  new Function("require", "exports", "globalThis", compiled)(
    (name: string) => {
      if (name === "wxt/browser") return { browser };
      if (name === "@footprint/tokenizers/metadata") return tokenizers;
      if (name === "./counting-config") return countingConfig;
      if (name === "@footprint/file-text/types") return fileTypes;
      if (name === "./count-host")
        return {
          CountHost: Host,
          COUNT_LIMITS: tokenizers.COUNT_LIMITS,
          DEFAULT_TOKENIZER_IMPLEMENTATION_ID:
            tokenizers.DEFAULT_TOKENIZER_IMPLEMENTATION_ID,
          DEFAULT_TOKENIZER_PROFILE_ID: tokenizers.DEFAULT_TOKENIZER_PROFILE_ID,
          unavailableCountResponse: tokenizers.unavailableCountResponse,
          validateCountRequest: tokenizers.validateCountRequest,
          validCountResponse: tokenizers.validCountResponse,
        };
      throw new Error(`unexpected dependency: ${name}`);
    },
    exported,
    {},
  );
  return exported;
}

test("Chrome platform preserves the typed envelope and rejects a raw extra field", async () => {
  let malformed = false;
  const platform = await evaluatePlatform(
    "chrome",
    async (message) => {
      if (message.command.type === "cancel") return { cancelled: true };
      const result = await tokenizers.countFields(message.command.request);
      return malformed ? { ...result, rawText: "private" } : result;
    },
    class {
      async count() {
        throw new Error("not used");
      }
      cancel() {
        return false;
      }
    },
  );
  const input = request();
  const result = await platform.countLocally(input);
  assert.equal(result.status, "counted");
  assert.equal(result.profileId, input.profileId);
  malformed = true;
  const rejected = await platform.countLocally(request());
  assert.equal(rejected.reason, "stale_tokenizer_response");
});

test("Chrome platform cancellation sends the exact job and revision without waiting for a reply", async () => {
  const commands: any[] = [];
  const platform = await evaluatePlatform(
    "chrome",
    (message) => {
      commands.push(message.command);
      return message.command.type === "cancel"
        ? Promise.resolve({ cancelled: true })
        : new Promise(() => {});
    },
    class {
      async count() {
        throw new Error("not used");
      }
      cancel() {
        return false;
      }
    },
  );
  const input = request(),
    abort = new AbortController(),
    pending = platform.countLocally(input, abort.signal);
  await new Promise(setImmediate);
  abort.abort();
  assert.equal((await pending).status, "cancelled");
  assert.ok(
    commands.some(
      (command) =>
        command.type === "cancel" &&
        command.jobId === input.jobId &&
        command.revision === input.revision,
    ),
  );
});

test("Chrome platform checks the offscreen document once and retries a lost document with the same job", async () => {
  let lookups = 0,
    failNext = false;
  const sent: string[] = [];
  const platform = await evaluatePlatform(
    "chrome",
    async (message) => {
      sent.push(message.command.request.jobId);
      if (failNext) {
        failNext = false;
        throw new Error("Could not establish connection. Receiving end does not exist.");
      }
      return tokenizers.countFields(message.command.request);
    },
    class {
      async count() {
        throw new Error("not used");
      }
      cancel() {
        return false;
      }
    },
    () => lookups++,
  );
  for (let i = 0; i < 3; i++)
    assert.equal((await platform.countLocally(request())).status, "counted");
  assert.equal(lookups, 1, "readiness is remembered between counts");
  failNext = true;
  const input = request();
  const result = await platform.countLocally(input);
  assert.equal(result.status, "counted");
  assert.equal(lookups, 2, "a failed send checks the document again");
  assert.deepEqual(sent.slice(-2), [input.jobId, input.jobId]);
});

test("Firefox platform uses one injected background host and forwards AbortSignal", async () => {
  let hosts = 0,
    signalSeen = false;
  const platform = await evaluatePlatform(
    "firefox",
    async () => {
      throw new Error("runtime transport not used");
    },
    class {
      constructor() {
        hosts++;
      }
      count(input: CountRequest, signal?: AbortSignal) {
        signalSeen = signal instanceof AbortSignal;
        return tokenizers.countFields(
          input,
          tokenizers.BUNDLED_TOKENIZER,
          signal,
        );
      }
      cancel() {
        return false;
      }
    },
  );
  const result = await platform.countLocally(
    request(),
    new AbortController().signal,
  );
  assert.equal(result.status, "counted");
  assert.equal(hosts, 1);
  assert.equal(signalSeen, true);
  await platform.countLocally(request());
  assert.equal(hosts, 1);
});

test("offscreen entry validates commands and routes exact cancellation identity", async () => {
  let listener!: (message: any, sender: any) => Promise<any> | undefined,
    cancelled: [string, number] | null = null;
  class Host {
    count(input: CountRequest) {
      return tokenizers.countFields(input);
    }
    cancel(jobId: string, revision: number) {
      cancelled = [jobId, revision];
      return true;
    }
    countFile() {
      throw new Error("not used");
    }
  }
  const browser: any = {
    runtime: {
      id: "count-extension",
      getManifest: () => ({ background: {} }),
      getURL: (path: string) => `chrome-extension://count${path}`,
      onMessage: {
        addListener(value: typeof listener) {
          listener = value;
        },
      },
    },
  };
  const source = await readFile(
    new URL("../lib/offscreen-entry.ts", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  new Function("require", "exports", "navigator", compiled)(
    (name: string) => {
      if (name === "wxt/browser") return { browser };
      if (name === "./counting-config") return countingConfig;
      if (name === "./count-host")
        return {
          CountHost: Host,
          validateCountCommand: tokenizers.validateCountCommand,
        };
      if (name === "@footprint/file-text/types") return fileTypes;
      throw new Error(`unexpected dependency: ${name}`);
    },
    {},
    {},
  );
  const input = request();
  const response = await listener(
    { target: "tokenizer", command: { type: "count", request: input } },
    { id: browser.runtime.id },
  );
  assert.equal(response.status, "counted");
  assert.ok(tokenizers.validCountResponse(response, input));
  assert.equal(
    listener(
      {
        target: "tokenizer",
        command: { type: "count", request: input },
        rawText: "blocked",
      },
      { id: browser.runtime.id },
    ),
    undefined,
  );
  assert.deepEqual(
    await listener(
      {
        target: "tokenizer",
        command: {
          type: "cancel",
          jobId: input.jobId,
          revision: input.revision,
        },
      },
      { id: browser.runtime.id },
    ),
    { cancelled: true },
  );
  assert.deepEqual(cancelled, [input.jobId, input.revision]);
});
