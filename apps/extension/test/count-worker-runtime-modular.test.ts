import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import * as tokenizers from "@footprint/tokenizers";
import * as countingConfig from "../lib/counting-worker-config";
import type {
  CountRequest,
  CountResponse,
  TokenizerImplementation,
} from "@footprint/tokenizers";

function request(text: string): CountRequest {
  return {
    jobId: crypto.randomUUID(),
    revision: 7,
    modelId: null,
    implementationId: tokenizers.DEFAULT_TOKENIZER_IMPLEMENTATION_ID,
    profileId: tokenizers.DEFAULT_TOKENIZER_PROFILE_ID,
    fields: { answer: text },
  };
}

async function loadRuntime() {
  const scope: {
    onmessage: ((event: MessageEvent<unknown>) => void) | null;
    postMessage(value: CountResponse): void;
  } = {
    onmessage: null,
    postMessage() {},
  };
  const source = await readFile(
    new URL("../lib/count.worker.ts", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exported: Record<string, unknown> = {};
  new Function("require", "exports", "self", compiled)(
    (name: string) => {
      if (name === "./counting-worker-config") return countingConfig;
      assert.equal(name, "@footprint/tokenizers/worker");
      return tokenizers;
    },
    exported,
    scope,
  );
  return exported.CountWorkerRuntime as new (
    post: (response: CountResponse) => void,
    implementation?: TokenizerImplementation,
  ) => { receive(value: unknown): void };
}

test("BC07 worker rejects duplicate IDs and binds the selected profile", async () => {
  const Runtime = await loadRuntime();
  const outputs: CountResponse[] = [];
  const runtime = new Runtime((response) => outputs.push(response));
  const input = request("profile-bound worker count");
  runtime.receive({ type: "count", request: input });
  while (!outputs.length) await new Promise(setImmediate);
  assert.equal(outputs[0].status, "counted");
  assert.equal(outputs[0].profileId, input.profileId);
  assert.ok(tokenizers.validCountResponse(outputs[0], input));
  runtime.receive({ type: "count", request: input });
  assert.equal(outputs[1].reason, "duplicate_job");
  runtime.receive({
    type: "count",
    request: { ...request("bad profile"), profileId: "not-reviewed" },
  });
  while (outputs.length < 3) await new Promise(setImmediate);
  assert.equal(outputs[2].reason, "tokenizer_unavailable");
});

test("BC07 BC09 queued and active cancellation require matching job and revision", async () => {
  const Runtime = await loadRuntime();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const slow: TokenizerImplementation = {
    ...tokenizers.BUNDLED_TOKENIZER,
    async count(job) {
      await gate;
      return tokenizers.BUNDLED_TOKENIZER.count(job);
    },
  };
  const outputs: CountResponse[] = [];
  const runtime = new Runtime((response) => outputs.push(response), slow);
  const active = request("active"),
    queued = request("queued");
  runtime.receive({ type: "count", request: active });
  runtime.receive({ type: "count", request: queued });
  runtime.receive({
    type: "cancel",
    jobId: active.jobId,
    revision: active.revision + 1,
  });
  runtime.receive({
    type: "cancel",
    jobId: queued.jobId,
    revision: queued.revision,
  });
  assert.equal(outputs[0].jobId, queued.jobId);
  assert.equal(outputs[0].status, "cancelled");
  runtime.receive({
    type: "cancel",
    jobId: active.jobId,
    revision: active.revision,
  });
  release();
  while (outputs.length < 2) await new Promise(setImmediate);
  assert.equal(outputs[1].jobId, active.jobId);
  assert.equal(outputs[1].status, "cancelled");
});
