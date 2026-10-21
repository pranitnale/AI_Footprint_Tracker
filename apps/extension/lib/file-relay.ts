import { browser } from "wxt/browser";
import {
  FILE_RELAY_LIMITS,
  FILE_PROVIDER_ORIGINS,
  FILE_RELAY_PATH,
  fileKeys,
  fileUuid,
  validFileSpec,
  validFileRelayBind,
  validFileRelayBytes,
} from "./file-relay-protocol";

/** An inert extension frame accepts one parent port only after privileged grant redemption. */
export function startFileRelay() {
  let busy = false,
    closed = false;
  let token: string | null = null;
  let nonce: string | null = null;
  let bytePort: MessagePort | null = null;
  const abort = new AbortController();
  const cancel = () => {
    closed = true;
    abort.abort();
    bytePort?.close();
    if (token && nonce)
      void browser.runtime
        .sendMessage({ target: "file-relay-cancel", token, relayNonce: nonce })
        .catch(() => {});
  };
  const timer = setTimeout(cancel, FILE_RELAY_LIMITS.timeoutMs);
  const lifecycle = () => {
    clearTimeout(timer);
    cancel();
    window.removeEventListener("message", receive);
  };
  window.addEventListener("pagehide", lifecycle, { once: true });
  async function sw(message: unknown, bytes?: ArrayBuffer): Promise<any> {
    const registration = await navigator.serviceWorker?.getRegistration(
      browser.runtime.getURL("/"),
    );
    if (!registration?.active || closed) throw new Error("file_unavailable");
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const finish = (value: any) => {
        clearTimeout(deadline);
        channel.port1.close();
        abort.signal.removeEventListener("abort", stop);
        resolve(value);
      };
      const stop = () => finish({ status: "unavailable" });
      const deadline = setTimeout(stop, FILE_RELAY_LIMITS.timeoutMs);
      abort.signal.addEventListener("abort", stop, { once: true });
      channel.port1.onmessage = (event) => finish(event.data);
      try {
        registration.active!.postMessage(
          message,
          bytes ? [channel.port2, bytes] : [channel.port2],
        );
        if (abort.signal.aborted) stop();
      } catch {
        clearTimeout(deadline);
        channel.port1.close();
        reject(new Error("file_unavailable"));
      }
    });
  }
  async function receive(event: MessageEvent) {
    if (
      closed ||
      busy ||
      event.source !== parent ||
      parent === window ||
      !FILE_PROVIDER_ORIGINS.includes(event.origin as any) ||
      !validFileRelayBind(event.data) ||
      event.ports.length !== 1
    ) {
      for (const port of event.ports) port.close();
      return;
    }
    busy = true;
    const port = event.ports[0]!;
    bytePort = port;
    nonce = crypto.randomUUID();
    try {
      const redeemed = await browser.runtime.sendMessage({
        target: "file-relay-redeem",
        grant: event.data.grant,
        parentOrigin: event.origin,
        relayNonce: nonce,
      });
      if (
        closed ||
        !fileKeys(redeemed, ["status", "token", "spec", "expiresAt"]) ||
        redeemed.status !== "redeemed" ||
        !fileUuid(redeemed.token) ||
        !fileKeys(redeemed.spec, ["fileHandle", "kind", "size", "jobId"]) ||
        !validFileSpec(redeemed.spec) ||
        !fileUuid(redeemed.spec.jobId) ||
        !Number.isSafeInteger(redeemed.expiresAt) ||
        Date.now() >= redeemed.expiresAt
      )
        throw new Error("file_unavailable");
      token = redeemed.token;
      if (import.meta.env.BROWSER !== "firefox") {
        const registered = await sw({
          target: "file-relay-register",
          token,
          relayNonce: nonce,
        });
        if (
          !fileKeys(registered, ["status"]) ||
          registered.status !== "ready" ||
          closed
        )
          throw new Error("file_unavailable");
      }
      let accepted = false;
      port.onmessage = async (message) => {
        if (closed || accepted) return;
        accepted = true;
        if (!validFileRelayBytes(message.data, redeemed.spec.size)) {
          port.postMessage({
            target: "file-relay-status",
            status: "unavailable",
          });
          lifecycle();
          return;
        }
        const job = {
          jobId: redeemed.spec.jobId,
          revision: 1,
          kind: redeemed.spec.kind,
          bytes: message.data.bytes,
        };
        let result: any;
        try {
          result =
            import.meta.env.BROWSER === "firefox"
              ? await browser.runtime.sendMessage({
                  target: "file-relay-count",
                  token,
                  relayNonce: nonce,
                  job,
                })
              : await sw(
                  { target: "file-relay-count", token, relayNonce: nonce, job },
                  job.bytes,
                );
        } catch {
          result = { status: "unavailable" };
        }
        if (!closed)
          port.postMessage({
            target: "file-relay-status",
            status:
              fileKeys(result, ["status"]) && result.status === "complete"
                ? "complete"
                : "unavailable",
          });
        lifecycle();
      };
      port.start();
      port.postMessage({ target: "file-relay-status", status: "ready" });
    } catch {
      if (!closed)
        port.postMessage({
          target: "file-relay-status",
          status: "unavailable",
        });
      lifecycle();
    }
  }
  if (location.href === browser.runtime.getURL(FILE_RELAY_PATH))
    window.addEventListener("message", receive);
  else lifecycle();
  return lifecycle;
}
