import { parentPort, workerData } from "node:worker_threads";
import { WorkerMessageHandler } from "pdfjs-dist/legacy/build/pdf.worker.mjs";
const listeners = new Map();
globalThis.fetch = () => {
  parentPort.postMessage({ event: "network_attempt" });
  throw new Error("network_disabled_in_fixture");
};
const port = {
  postMessage: (message, transfer) => parentPort.postMessage(message, transfer),
  addEventListener(type, handler, options) {
    const listener = (data) => handler({ data });
    listeners.set(handler, listener);
    parentPort.on(type, listener);
    options?.signal?.addEventListener(
      "abort",
      () => parentPort.off(type, listener),
      { once: true },
    );
  },
  removeEventListener(type, handler) {
    parentPort.off(type, listeners.get(handler));
    listeners.delete(handler);
  },
};
if (workerData?.heartbeat) {
  const heartbeat = new Int32Array(workerData.heartbeat);
  const timer = setInterval(() => Atomics.add(heartbeat, 0, 1), 5);
  setTimeout(() => {
    clearInterval(timer);
    parentPort.close();
  }, 1500);
}
WorkerMessageHandler.initializeFromPort(port);
