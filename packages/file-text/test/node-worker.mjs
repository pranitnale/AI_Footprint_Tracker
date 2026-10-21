import { parentPort, threadId, Worker, workerData } from "node:worker_threads";
import { tsImport } from "tsx/esm/api";
const { countAccessibleFile } = await tsImport(
  "../src/index.ts",
  import.meta.url,
);
let networkCalls = 0;
const terminations = [];
let children = 0;
if (workerData?.nestedPDF)
  globalThis.Worker = class {
    constructor() {
      children++;
      this.worker = new Worker(new URL("./pdf-child.mjs", import.meta.url), {
        workerData: { heartbeat: workerData.heartbeat },
      });
      this.worker.on("message", (message) => {
        if (message?.event === "network_attempt") networkCalls++;
      });
      this.listeners = new Map();
    }
    postMessage(message, transfer) {
      this.worker.postMessage(message, transfer);
    }
    addEventListener(type, handler, options) {
      const listener = (data) => handler(type === "message" ? { data } : data);
      this.listeners.set(handler, listener);
      this.worker.on(type, listener);
      options?.signal?.addEventListener(
        "abort",
        () => this.worker.off(type, listener),
        { once: true },
      );
    }
    removeEventListener(type, handler) {
      this.worker.off(type, this.listeners.get(handler));
      this.listeners.delete(handler);
    }
    terminate() {
      terminations.push(this.worker.terminate());
    }
  };
globalThis.fetch = () => {
  networkCalls++;
  throw new Error("network_disabled_in_fixture");
};
parentPort.on("message", async (job) => {
  const result = await countAccessibleFile(
    job,
    workerData?.nestedPDF ? { pdfWorkerSrc: "packaged-fixture-worker" } : {},
  );
  await Promise.all(terminations);
  parentPort.postMessage({
    result,
    threadId,
    networkCalls,
    children,
    terminated: terminations.length,
  });
});
