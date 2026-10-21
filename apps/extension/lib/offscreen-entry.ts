import { browser } from "wxt/browser";
import { CountHost, validateCountCommand } from "./count-host";
import { validateFileJob } from "@footprint/file-text/types";
import { PACKAGED_COUNTING_RUNTIME } from "./counting-config";
const host = new CountHost({counting: PACKAGED_COUNTING_RUNTIME});
browser.runtime.onMessage.addListener((message, sender) => {
  if (message?.target !== "tokenizer" || sender.id !== browser.runtime.id)
    return;
  try {
    if (Object.keys(message).sort().join(",") !== "command,target") return;
    validateCountCommand(message.command);
  } catch {
    return;
  }
  if (message.command.type === "cancel") {
    return Promise.resolve({
      cancelled: host.cancel(message.command.jobId, message.command.revision),
    });
  }
  return host.count(message.command.request);
});

// Only our registered service worker can send file snapshots to this private document.
navigator.serviceWorker?.addEventListener("message", (event) => {
  const script = (
    browser.runtime.getManifest().background as { service_worker?: string }
  )?.service_worker;
  const source = event.source as ServiceWorker | null;
  if (
    !script ||
    source?.scriptURL !== new URL(script, browser.runtime.getURL("/")).href ||
    event.data?.target !== "accessible-file-count" ||
    event.ports.length !== 1
  )
    return;
  try {
    validateFileJob(event.data.job);
  } catch {
    event.ports[0].close();
    return;
  }
  const job = event.data.job,
    port = event.ports[0];
  const abort = new AbortController();
  port.onmessage = (message) => {
    if (
      message.data?.cancel === job.jobId &&
      (message.data.revision === undefined ||
        message.data.revision === job.revision)
    )
      abort.abort();
  };
  void host
    .countFile(job, abort.signal)
    .then((result) => port.postMessage(result))
    .finally(() => {
      port.onmessage = null;
      port.close();
    });
});
