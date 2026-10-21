import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import * as fileText from "@footprint/file-text";
import * as countingConfig from "../lib/counting-worker-config";

async function entrypoint() {
  const outputs: fileText.FileCountResult[] = [];
  const self: {
    onmessage?: (event: MessageEvent) => Promise<void>;
    postMessage: (value: fileText.FileCountResult) => void;
  } = {
    postMessage: (value) => outputs.push(value),
  };
  const source = await readFile(
    new URL("../lib/file.worker.ts", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  new Function("require", "exports", "self", compiled)(
    (name: string) => {
      if (name === "@footprint/file-text") return fileText;
      if (name === "./counting-worker-config") return countingConfig;
      if (name === "@footprint/file-text/pdf-worker?worker&url")
        return { default: undefined };
      throw new Error("unexpected_worker_dependency");
    },
    {},
    self,
  );
  return {
    outputs,
    send: (data: unknown) => self.onmessage!({ data } as MessageEvent),
  };
}
const job = (text = "idle first file") => ({
  jobId: crypto.randomUUID(),
  revision: 1,
  kind: "text",
  bytes: new TextEncoder().encode(text).buffer,
});

test("actual file.worker entrypoint processes its first ordinary job from idle", async () => {
  const worker = await entrypoint(),
    input = job();
  await worker.send(input);
  assert.equal(worker.outputs.length, 1);
  assert.equal(worker.outputs[0].jobId, input.jobId);
  assert.equal(worker.outputs[0].status, "counted");
  assert.equal(worker.outputs[0].scope, "extracted_file_text");
});

test("actual worker ignores stale/malformed cancellation and only cancels an active matching job", async () => {
  const worker = await entrypoint();
  for (const command of [
    { cancel: undefined },
    { cancel: crypto.randomUUID() },
    {},
  ])
    await worker.send(command);
  assert.equal(worker.outputs.length, 0);
  const first = job("large text ".repeat(5000));
  const pending = worker.send(first);
  await worker.send({ cancel: crypto.randomUUID() });
  await worker.send({ cancel: first.jobId, unexpected: true });
  await pending;
  assert.equal(worker.outputs[0].status, "counted");
  const second = job("large text ".repeat(5000));
  const cancelled = worker.send(second);
  await worker.send({ cancel: second.jobId });
  await cancelled;
  assert.equal(worker.outputs[1].status, "cancelled");
  await worker.send({ cancel: second.jobId });
  await worker.send(job());
  assert.equal(worker.outputs.length, 3);
  assert.equal(worker.outputs[2].status, "counted");
});
