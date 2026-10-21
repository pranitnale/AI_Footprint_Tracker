import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import {
  BUNDLED_TOKENIZER,
  COUNT_LIMITS,
  DEFAULT_TOKENIZER_IMPLEMENTATION_ID,
  DEFAULT_TOKENIZER_PROFILE_ID,
  countFields,
  unavailableCountResponse,
  validateCountRequest,
  validCountResponse,
  type CountCommand,
  type CountRequest,
  type CountResponse,
  type TokenizerImplementation,
} from "@footprint/tokenizers";
import * as tokenizers from "@footprint/tokenizers";
import * as countingConfig from "../lib/counting-config";
import {
  countAccessibleFile,
  validFileResult,
  type AccessibleFileJob,
} from "@footprint/file-text";

function request(fields: CountRequest["fields"]): CountRequest {
  return {
    jobId: crypto.randomUUID(),
    revision: 3,
    modelId: "unverified-consumer-model",
    implementationId: DEFAULT_TOKENIZER_IMPLEMENTATION_ID,
    profileId: DEFAULT_TOKENIZER_PROFILE_ID,
    fields,
  };
}

const fakeProfile = {
  profileId: "observed-text-v1",
  encoding: "deterministic_fake",
  assetHash: "a".repeat(64),
};
const fakeTokenizer: TokenizerImplementation = {
  id: "deterministic-fake-1",
  profiles: [fakeProfile],
  async count(job) {
    return {
      jobId: job.jobId,
      revision: job.revision,
      measurement: {
        value: job.text.length === 0 ? "0" : "1",
        evidence: "heuristic_estimate",
        scope: "observed_text",
        completeness: "complete_for_scope",
        profile_id: "observed-text-v1",
        reason: "tokenizer_mapping_unverified",
      },
      assetHash: fakeProfile.assetHash,
      profileId: fakeProfile.profileId,
      encoding: fakeProfile.encoding,
      modelExactness: "unverified",
      status: "counted",
    };
  },
};

test("AR03 AR07 injected tokenizer selection crosses text and private-file boundaries", async () => {
  const selected: CountRequest = {
    ...request({ answer: "future implementation" }),
    implementationId: fakeTokenizer.id,
    profileId: fakeProfile.profileId,
  };
  const textResult = await countFields(selected, fakeTokenizer);
  assert.equal(textResult.status, "counted");
  assert.equal(textResult.implementationId, fakeTokenizer.id);
  assert.equal(textResult.counts.answer?.profileId, fakeProfile.profileId);
  assert.ok(validCountResponse(textResult, selected, fakeTokenizer));

  const fileJob: AccessibleFileJob = {
    jobId: crypto.randomUUID(),
    revision: 4,
    kind: "text",
    bytes: new TextEncoder().encode("private future profile text").buffer,
    tokenizerImplementationId: fakeTokenizer.id,
    tokenizerProfileId: fakeProfile.profileId,
  };
  const fileResult = await countAccessibleFile(fileJob, {
    tokenizer: fakeTokenizer,
  });
  assert.equal(fileResult.status, "counted");
  assert.equal(fileResult.tokens, "1");
  assert.equal(fileResult.tokenizerProfile, fakeProfile.profileId);
  assert.ok(validFileResult(fileResult, fileJob, fakeTokenizer));
  assert.equal(
    JSON.stringify(fileResult).includes("private future profile text"),
    false,
  );
});

test("BC05 BC06 one over-limit field is unavailable without erasing an independent count", async () => {
  const input = request({
    input: "x".repeat(COUNT_LIMITS.fieldTextUnits + 1),
    answer: "kept answer",
  });
  const result = await countFields(input);
  assert.equal(result.status, "partial");
  assert.equal(result.reason, "capture_limit_exceeded");
  assert.equal(result.counts.input?.status, "unavailable");
  assert.equal(result.counts.input?.measurement.value, null);
  assert.equal(result.counts.answer?.status, "counted");
  assert.ok(validCountResponse(result, input));
});

test("wrong job, revision, profile, assets, raw fields and huge result counts fail validation", async () => {
  const input = request({ answer: "validated reply" });
  const valid = await countFields(input);
  assert.ok(validCountResponse(valid, input));
  for (const malformed of [
    { ...valid, jobId: crypto.randomUUID() },
    { ...valid, revision: input.revision + 1 },
    { ...valid, profileId: "cl100k-base-4.0.0-reference" },
    { ...valid, rawText: "must not cross" },
    {
      ...valid,
      counts: {
        ...valid.counts,
        answer: { ...valid.counts.answer, assetHash: "b".repeat(64) },
      },
    },
    {
      ...valid,
      counts: {
        ...valid.counts,
        answer: {
          ...valid.counts.answer,
          measurement: {
            ...valid.counts.answer!.measurement,
            value: "999999999999999999",
          },
        },
      },
    },
  ])
    assert.equal(validCountResponse(malformed, input), false);
});

interface FakeWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  commands: CountCommand[];
  terminated: number;
  postMessage(command: CountCommand): void;
  terminate(): void;
}

async function loadCountHost() {
  const source = await readFile(
    new URL("../lib/count-host.ts", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const exported: Record<string, unknown> = {};
  class FileHost {
    count() {}
    cancel() {}
    dispose() {}
  }
  new Function("require", "exports", compiled)((name: string) => {
    if (name.endsWith("?worker&url")) return { default: name };
    if (name === "@footprint/file-text/host")
      return { FileCountHost: FileHost };
    if (name === "@footprint/tokenizers/metadata")
      return awaitableTokenizerExports;
    if (name === "./counting-config") return countingConfig;
    if (name === "@footprint/file-text") return {};
    throw new Error(`unexpected dependency: ${name}`);
  }, exported);
  return exported.CountHost as new (options: object) => {
    count(request: CountRequest, signal?: AbortSignal): Promise<CountResponse>;
    dispose(): void;
  };
}

const awaitableTokenizerExports = {
  ...tokenizers,
  BUNDLED_TOKENIZER,
  COUNT_LIMITS,
  DEFAULT_TOKENIZER_IMPLEMENTATION_ID,
  DEFAULT_TOKENIZER_PROFILE_ID,
  unavailableCountResponse,
  validateCountCommand: () => {},
  validateCountRequest,
  validCountResponse,
};

function fakeWorker(
  handle: (worker: FakeWorker, command: CountCommand) => void,
): FakeWorker {
  return {
    onmessage: null,
    onerror: null,
    commands: [],
    terminated: 0,
    postMessage(command) {
      this.commands.push(command);
      handle(this, command);
    },
    terminate() {
      this.terminated++;
    },
  };
}

test("BC07 BC13 host rejects duplicate and malformed replies while reusing one worker", async () => {
  const CountHost = await loadCountHost();
  let created = 0;
  const worker = fakeWorker((port, command) => {
    if (command.type !== "count") return;
    void countFields(command.request).then((response) =>
      port.onmessage?.({ data: response } as MessageEvent),
    );
  });
  const host = new CountHost({
    createCountWorker: () => {
      created++;
      return worker;
    },
  });
  const input = request({ answer: "one worker" });
  assert.equal((await host.count(input)).status, "counted");
  assert.equal((await host.count(input)).reason, "duplicate_job");
  const next = request({ answer: "second job" });
  assert.equal((await host.count(next)).status, "counted");
  assert.equal(created, 1);
  assert.equal(worker.terminated, 0);
  host.dispose();
  assert.equal(worker.terminated, 1);

  const rawWorker = fakeWorker((port, command) => {
    if (command.type === "count")
      queueMicrotask(() =>
        port.onmessage?.({
          data: {
            jobId: command.request.jobId,
            revision: command.request.revision,
            rawText: "must not escape",
          },
        } as MessageEvent),
      );
  });
  const rawHost = new CountHost({ createCountWorker: () => rawWorker });
  assert.equal(
    (await rawHost.count(request({ input: "private" }))).reason,
    "stale_tokenizer_response",
  );
  rawHost.dispose();
});

test("BC07 BC09 cancellation, timeout, bounded queue and crash settle every caller", async () => {
  const CountHost = await loadCountHost();
  const hanging = fakeWorker(() => {});
  const timeoutHost = new CountHost({
    createCountWorker: () => hanging,
    timeoutMs: 5,
  });
  const timed = request({ answer: "timeout" });
  assert.equal((await timeoutHost.count(timed)).reason, "tokenizer_timeout");
  assert.equal(
    hanging.terminated,
    0,
    "one timeout does not reset unrelated jobs",
  );
  assert.ok(
    hanging.commands.some(
      (command) => command.type === "cancel" && command.jobId === timed.jobId,
    ),
  );

  const abort = new AbortController();
  const cancelled = request({ answer: "cancel" });
  const cancellation = timeoutHost.count(cancelled, abort.signal);
  abort.abort();
  assert.equal((await cancellation).status, "cancelled");

  const queued = Array.from({ length: COUNT_LIMITS.pendingJobs }, (_, index) =>
    timeoutHost.count(request({ answer: `queued-${index}` })),
  );
  const overflow = await timeoutHost.count(request({ answer: "overflow" }));
  assert.equal(overflow.reason, "busy");
  timeoutHost.dispose();
  assert.ok(
    (await Promise.all(queued)).every(
      (result) => result.status === "cancelled",
    ),
  );

  const crashing = fakeWorker(() => {});
  const crashHost = new CountHost({ createCountWorker: () => crashing });
  const first = crashHost.count(request({ input: "a" }));
  const second = crashHost.count(request({ answer: "b" }));
  crashing.onerror?.({} as ErrorEvent);
  assert.ok(
    (await Promise.all([first, second])).every(
      (result) => result.reason === "worker_unavailable",
    ),
  );
  assert.equal(crashing.terminated, 1);
  assert.equal(crashing.onmessage, null);
  assert.equal(crashing.onerror, null);
});
