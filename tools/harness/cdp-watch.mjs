// Records every error the extension raises in any browser target: the service worker, the offscreen document,
// extension pages, workers and content scripts running inside provider pages. Playwright alone does not see
// service worker exceptions or isolated-world errors, so this attaches its own CDP client to the browser and
// auto-attaches to every target, pausing new targets until Runtime and Log are enabled so startup errors count.
// Test-only. It keeps message text and URLs, never page content.

export class CdpWatch {
  constructor(browserWsUrl, { extensionOrigin = null } = {}) {
    this.url = browserWsUrl;
    this.extensionOrigin = extensionOrigin;
    this.nextId = 1;
    this.pending = new Map();
    this.targets = new Map();
    this.events = [];
  }

  async start() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (event) => this.onMessage(JSON.parse(event.data)));
    await this.send("Target.setDiscoverTargets", { discover: true });
    await this.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    // Targets that already exist are not auto-attached, so attach to them explicitly.
    const { targetInfos } = await this.send("Target.getTargets");
    for (const info of targetInfos) await this.attach(info).catch(() => {});
  }

  setExtensionOrigin(origin) {
    this.extensionOrigin = origin;
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const message = { id, method, params, ...(sessionId ? { sessionId } : {}) };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify(message));
    });
  }

  async attach(info) {
    if (!["page", "service_worker", "worker", "shared_worker", "other", "iframe"].includes(info.type)) return;
    if ([...this.targets.values()].some((t) => t.targetId === info.targetId)) return;
    const { sessionId } = await this.send("Target.attachToTarget", { targetId: info.targetId, flatten: true });
    await this.prepare(sessionId, info);
  }

  async prepare(sessionId, info) {
    this.targets.set(sessionId, { targetId: info.targetId, type: info.type, url: info.url });
    await Promise.allSettled([
      this.send("Runtime.enable", {}, sessionId),
      this.send("Log.enable", {}, sessionId),
      this.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId),
    ]);
    await this.send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {});
  }

  onMessage(message) {
    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject, method } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(`${method}: ${message.error.message}`));
      else resolve(message.result);
      return;
    }
    const target = message.sessionId ? this.targets.get(message.sessionId) : null;
    switch (message.method) {
      case "Target.attachedToTarget":
        this.prepare(message.params.sessionId, message.params.targetInfo).catch(() => {});
        break;
      case "Target.targetInfoChanged": {
        for (const t of this.targets.values())
          if (t.targetId === message.params.targetInfo.targetId) t.url = message.params.targetInfo.url;
        break;
      }
      case "Runtime.exceptionThrown": {
        const d = message.params.exceptionDetails;
        this.record("exception", target, d.exception?.description ?? d.text, d.url ?? d.stackTrace?.callFrames?.[0]?.url, d.stackTrace);
        break;
      }
      case "Runtime.consoleAPICalled": {
        const { type, args, stackTrace } = message.params;
        if (type !== "error" && type !== "assert" && type !== "warning") break;
        const text = args.map((a) => a.value ?? a.description ?? a.type).join(" ");
        this.record(type === "warning" ? "warning" : "console-error", target, text, stackTrace?.callFrames?.[0]?.url, stackTrace);
        break;
      }
      case "Log.entryAdded": {
        const e = message.params.entry;
        if (e.level !== "error" && e.level !== "warning") break;
        this.record(e.level === "error" ? "log-error" : "warning", target, e.text, e.url, e.stackTrace);
        break;
      }
      default:
        break;
    }
  }

  record(kind, target, text, url, stackTrace) {
    const frames = (stackTrace?.callFrames ?? []).map((f) => f.url).filter(Boolean);
    const urls = [url, ...frames].filter(Boolean);
    const fromExtension =
      !!this.extensionOrigin &&
      (urls.some((u) => u.startsWith(this.extensionOrigin)) || (target?.url ?? "").startsWith(this.extensionOrigin));
    this.events.push({
      kind,
      fromExtension,
      targetType: target?.type ?? "browser",
      targetUrl: target?.url ?? "",
      text: String(text ?? "").slice(0, 600),
      url: url ?? "",
      at: new Date().toISOString(),
    });
  }

  /** Errors that belong to the extension. Warnings are reported separately and do not fail a run. */
  extensionErrors() {
    return this.events.filter((e) => e.fromExtension && e.kind !== "warning");
  }

  extensionWarnings() {
    return this.events.filter((e) => e.fromExtension && e.kind === "warning");
  }

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}
