import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { HistoryTextPage } from "@footprint/adapters";
import type { CountRequest, CountResponse } from "@footprint/tokenizers";
export function historyWorker() {
  const require = createRequire(import.meta.url);
  const worker = new Worker(
    `require(${JSON.stringify(require.resolve("tsx/cjs"))});const {parentPort}=require('node:worker_threads');global.self=globalThis;self.postMessage=v=>parentPort.postMessage(v);require(${JSON.stringify(fileURLToPath(new URL("../lib/count.worker.ts", import.meta.url)))});parentPort.on('message',data=>self.onmessage({data}));`,
    { eval: true },
  );
  const pending = new Map<
    string,
    { resolve: (value: CountResponse) => void; reject: (error: Error) => void }
  >();
  worker.on("message", (m) => {
    const item = pending.get(m.jobId);
    if (item) {
      pending.delete(m.jobId);
      item.resolve(m);
    }
  });
  worker.on("error", (error) => {
    for (const item of pending.values()) item.reject(error);
    pending.clear();
  });
  return {
    count: (job: CountRequest) =>
      new Promise<CountResponse>((resolve, reject) => {
        pending.set(job.jobId, { resolve, reject });
        worker.postMessage({ type: "count", request: job });
      }),
    close: () => worker.terminate(),
  };
}
export const historyConversation = "00000000-0000-4000-8000-000000000042";
export const historySender = {
  tab: { id: 7 },
  frameId: 0,
  documentId: "synthetic-history-document",
  url: `https://claude.ai/chat/${historyConversation}`,
};
export const historyBinding = () => ({
  documentNonce: crypto.randomUUID(),
  navigationNonce: crypto.randomUUID(),
  captureId: null,
});
export function historyPage(
  count = 2,
  observedAt = new Date().toISOString(),
): HistoryTextPage {
  const messages: HistoryTextPage["messages"] = [];
  for (let i = 0; i < count; i++) {
    const id =
        "00000000-0000-4000-8000-" + (i + 1).toString(16).padStart(12, "0"),
      role = i % 2 ? "response" : "prompt",
      parent = i
        ? "00000000-0000-4000-8000-" + i.toString(16).padStart(12, "0")
        : null;
    messages.push({ timing: null,
      sourceId: id,
      role,
      parentSourceId: parent,
      parentRole: i ? (i % 2 ? "prompt" : "response") : null,
      promptSourceId: i % 2 ? parent : id,
      requestId: null,
      liveAttemptId: null,
      occurredAt: "2020-01-01T10:00:00.000001Z",
      dateBasis: "message_created",
      modelId: null,
      text: "hello",
      complete: true,
      inlineFiles: null,
    });
  }
  return {
    site: "claude",
    conversationId: historyConversation,
    observedAt,
    messages,
    firstRequestVerified: true,
    rootSourceId: messages[0]?.sourceId ?? null,
    selectedLeafId: messages.at(-1)?.sourceId ?? null,
    branchSourceIds: messages.map((m) => m.sourceId),
    branchScope: "selected_branch",
    hasEarlier: false,
    hasLater: false,
    status: "partial",
  };
}
