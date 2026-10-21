import { defineBackground } from "wxt/utils/define-background";
import { browser } from "wxt/browser";
import { Ledger } from "@footprint/ledger";
import { Coordinator } from "../lib/coordinator";
import { PACKAGED_COUNTING_RUNTIME } from "../lib/counting-config";
import {
  observeScopeChanges,
  observeThreadInvalidations,
} from "../lib/scope-notifications";
import { HistoryAdmission } from "../lib/history-admission";
import { RouteAuthorities } from "../lib/route-authority";
import { sideCapture, validateCapture } from "../lib/bridge";
import { FileGrantBroker } from "../lib/file-grant-broker";
import { FILE_RELAY_PATH, fileKeys } from "../lib/file-relay-protocol";
import { validateThreadHistory } from "@footprint/adapters";
import {
  browserFamily,
  scheduleSync,
  openDashboard,
  getRuntimeCapabilities,
  hasCompanyConsent,
  countLocally,
  countFileLocally,
  cancelFileLocally,
} from "../lib/platform";
import {
  validateFileJob,
  unavailable,
  type AccessibleFileJob,
  type FileCountResult,
} from "@footprint/file-text/types";
import { companyOrigin, connectFailureReply } from "../lib/company";
import {
  HealthReporter,
  failureCode as safeCode,
  failureMessage as safeMessage,
  technicalDetail,
} from "../lib/health";
import { transitionOwnership, ownershipAt } from "../lib/ownership";
import { createOwnReadPauses } from "../lib/own-read-pause";
import {
  OPEN_SETTINGS_TARGET,
  OWN_READ_SETTING_CHANGED,
  OWN_READ_SETTING_TARGET,
  ownReadSettingKeys,
} from "../lib/own-read-settings";
import {
  OPEN_WELCOME_TARGET,
  ORGANIZATION_CONSENT_VERSION,
  TRACKING_CONSENT_VERSION,
  TRACKING_STATE_CHANGED,
  TRACKING_STATE_TARGET,
  WELCOME_FOCUS_TARGET,
  WELCOME_PAGE,
  WELCOME_SHOWN_KEY,
  welcomeDue,
} from "../lib/tracking-consent";
import {
  siteForHost,
  isDisplayBinding,
  isConversationIdentity,
} from "@footprint/capture-core";

/**
 * Runs one step of connecting to an organization. A wrong email, code or address, or an answer
 * such as "no organization uses this domain", is not a tracking problem, so it is answered here
 * instead of being reported to tracking health with the general message.
 */
async function connectStep(step: () => Promise<unknown>) {
  try {
    await step();
    return { ok: true };
  } catch (error) {
    const reply = connectFailureReply(error);
    if (!reply) throw error;
    return reply;
  }
}

export default defineBackground(() => {
  const historyAdmission = new HistoryAdmission();
  const routes = new RouteAuthorities({
    extensionId: browser.runtime.id,
    getTab: (tabId) => browser.tabs.get(tabId),
    hasPermission: (origin) =>
      browser.permissions.contains({ origins: [origin + "/*"] }),
    confirm: (tabId, message, documentId) =>
      browser.tabs.sendMessage(
        tabId,
        message,
        import.meta.env.BROWSER !== "firefox" && documentId
          ? { frameId: 0, documentId }
          : { frameId: 0 },
      ),
    confirmCapture: (tabId, message) =>
      browser.tabs.sendMessage(tabId, message, { frameId: 0 }),
  });
  // The own-read pause each site's tabs share, in session storage that content scripts cannot
  // open themselves (lib/own-read-pause.ts).
  const ownReadPauses = createOwnReadPauses({
    storage: () => browser.storage.session,
    runtimeId: browser.runtime.id,
  });
  let physicalFile: Promise<FileCountResult> | null = null;
  let fileRoutingVersion = 0;
  const countExclusive = (job: AccessibleFileJob, signal?: AbortSignal) => {
    if (physicalFile) return Promise.resolve(unavailable(job, "busy"));
    const pending = countFileLocally(job, signal, true).finally(() => {
      if (physicalFile === pending) physicalFile = null;
    });
    physicalFile = pending;
    return pending;
  };
  const privateFilePage = (url?: string) =>
    (["/dashboard.html", "/popup.html"] as const).some(
      (path) => url === browser.runtime.getURL(path),
    );
  const fileBroker: FileGrantBroker = new FileGrantBroker({
    counting: PACKAGED_COUNTING_RUNTIME,
    extensionId: browser.runtime.id!,
    relayUrl: browser.runtime.getURL(FILE_RELAY_PATH),
    workAvailable: () => physicalFile === null,
    routingVersion: () => fileRoutingVersion,
    count: countExclusive,
    snapshot: async (observedAt) => {
      const c = await ready;
      const history = await c.ledger.readOwnershipHistory();
      const settings = await c.settings();
      const scope = await c.currentScope(),
        state = await c.ledger.publicationSnapshot(scope.namespace);
      if (
        !history ||
        JSON.stringify(ownershipAt(history, observedAt).scope) !==
          JSON.stringify(scope)
      )
        throw new Error("file_unavailable");
      if (
        state.erasing ||
        state.ownership?.scope.namespace !== scope.namespace ||
        state.ownership?.scope.era !== scope.era
      )
        throw new Error("file_unavailable");
      if (
        settings.paused &&
        !(
          scope.mode === "company" &&
          state.credentials?.namespace === scope.namespace &&
          state.credentials?.policy.pause_mode === "disabled_by_company"
        )
      )
        throw new Error("file_unavailable");
      // No file is counted for a page before the person agreed to tracking.
      if (!(await c.trackingConsented())) throw new Error("file_unavailable");
      return JSON.stringify({
        scope,
        ownershipStart: state.ownership.start,
        ownershipEnd: state.ownership.end,
        erasureVersion: state.erasureVersion,
        deviceId: state.credentials?.device_id ?? null,
        enrollmentState: state.credentials?.enrollment_state ?? null,
      });
    },
    parentCurrent: async (parent) => {
      if (
        !(await browser.permissions.contains({
          origins: [parent.origin + "/*"],
        }))
      )
        return false;
      const response = await browser.tabs.sendMessage(
        parent.tabId,
        {
          target: "file-grant-check",
          binding: parent.binding,
          fileHandle: parent.fileHandle,
          captureId: parent.captureId,
        },
        import.meta.env.BROWSER !== "firefox" && parent.documentId
          ? { documentId: parent.documentId }
          : { frameId: 0 },
      );
      return fileKeys(response, ["current"]) && response.current === true;
    },
  });
  const historyFailure = (error: unknown) => {
    const code = error instanceof Error ? error.message : "history_unavailable";
    if (code === "thread_relation_conflict")
      return {
        error: "Recorded thread links conflict with company records.",
        code,
      };
    if (code === "history_rate_limited")
      return {
        error: "Recorded thread history is busy. Try again shortly.",
        code,
      };
    return {
      error: "Recorded thread links are unavailable.",
      code: "history_unavailable",
    };
  };
  if (import.meta.env.BROWSER !== "firefox")
    globalThis.addEventListener("message", (rawEvent) => {
      const event = rawEvent as MessageEvent;
      const source = event.source as unknown as { url?: string } | null;
      if (event.data?.target === "file-relay-cancel") {
        if (source) fileBroker.cancelClient(event.data, source);
        return;
      }
      if (
        ["file-relay-register", "file-relay-count"].includes(event.data?.target)
      ) {
        if (!source || event.ports.length !== 1) return;
        const port = event.ports[0];
        const work =
          event.data.target === "file-relay-register"
            ? fileBroker.register(event.data, source)
            : fileBroker.submit(event.data, source);
        const lifetime = work
          .then((result) => port.postMessage(result))
          .catch(() => {
            try {
              port.postMessage({ status: "unavailable" });
            } catch {}
          })
          .finally(() => port.close());
        // Keep only the bounded logical response alive; cancelled physical work retains its admission separately.
        (
          event as MessageEvent & {
            waitUntil?: (promise: Promise<void>) => void;
          }
        ).waitUntil?.(lifetime);
        return;
      }
      if (
        !privateFilePage(source?.url) ||
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
      const port = event.ports[0],
        job = event.data.job,
        abort = new AbortController();
      port.onmessage = (message) => {
        if (message.data?.cancel === job.jobId) abort.abort();
      };
      if (fileBroker.isBusy()) {
        port.postMessage(unavailable(job, "busy"));
        port.close();
        return;
      }
      void countExclusive(job, abort.signal)
        .then((result) => port.postMessage(result))
        .finally(() => port.close());
    });
  const captureTabs = new Map<number, string>();
  const health = new HealthReporter(async () => {
    const action = (browser as any).action ?? (browser as any).browserAction;
    if (action)
      await Promise.all([
        action.setBadgeText({ text: "!" }),
        action.setBadgeBackgroundColor({ color: "#9A3412" }),
      ]);
  });
  const failure = (error: unknown) => health.report(error);
  const notifyProviderTabs = async (target: string) => {
    const tabs = await browser.tabs.query({
      url: [
        "https://chatgpt.com/*",
        "https://chat.openai.com/*",
        "https://claude.ai/*",
        "https://gemini.google.com/*",
        "https://www.perplexity.ai/*",
        "https://perplexity.ai/*",
        "https://notebook.google.com/*",
      ],
    });
    const ids = [
      ...new Set(tabs.flatMap((tab) => (tab.id == null ? [] : [tab.id]))),
    ];
    for (let offset = 0; offset < ids.length; offset += 8)
      await Promise.all(
        ids
          .slice(offset, offset + 8)
          .map((tabId) =>
            browser.tabs
              .sendMessage(tabId, { target }, { frameId: 0 })
              .catch(() => {}),
          ),
      );
  };
  // A published recalculation changes what an open chat's saved totals read
  // returns. Coalesce bursts so a long import sends one short notice.
  let calculationNotice: ReturnType<typeof setTimeout> | null = null;
  const calculationPublished = () => {
    if (calculationNotice) return;
    calculationNotice = setTimeout(() => {
      calculationNotice = null;
      void notifyProviderTabs("footprint-calculation-updated").catch(() => {});
    }, 250);
  };
  // Each tab's newest address, kept as the browser reports it and without waiting for
  // startup, so an update queued behind startup applies the newest address rather than
  // the one it carried. `seen` orders it against the startup read below.
  const tabAddresses = new Map<number, { url: string; seen: number }>();
  let addressUpdates = 0;
  const ready: Promise<Coordinator> = Ledger.open().then(async (ledger) => {
    ledger.onHealthFailure((namespace, code, error) => {
      health.report(code, namespace);
      if (code !== "storage_write_failed")
        health.report("storage_write_failed", namespace);
      health.markReported(error);
    });
    // Problems kept in memory close with the same successes as saved ones. Test stand-ins
    // of the ledger may not offer the listener.
    ledger.onHealthResolved?.((namespace, codes) =>
      health.resolve(namespace, codes),
    );
    ledger.onRoutingChange(() => {
      fileRoutingVersion++;
    });
    const coordinator = new Coordinator(ledger.application, {
      counting: PACKAGED_COUNTING_RUNTIME,
      count: countLocally,
      hasConsent: hasCompanyConsent,
      hasSiteConsent: (origin) =>
        browser.permissions.contains({ origins: [origin + "/*"] }),
      sendDisplay: (tabId, message) => {
        const display = message as any;
        if (
          !isDisplayBinding(
            display?.displayBinding,
            display?.displayBinding?.captureId,
          ) ||
          (display.conversationIdentity !== null &&
            !isConversationIdentity(display.conversationIdentity))
        )
          return Promise.resolve();
        return browser.tabs.sendMessage(tabId, message);
      },
      extensionId: browser.runtime.id,
      fileReceipts: fileBroker,
      fileFailure: failure,
      health,
      calculationPublished,
      // Kept in memory where the storage API is absent (test harnesses).
      progressStorage: browser.storage?.local,
      // Nothing is tracked before the person agreed (lib/tracking-consent.ts).
      requireTrackingConsent: true,
    });
    // A restarted worker gets no address update for a Perplexity page that moved inside
    // itself before the restart, and a running reply's sender still names the page's
    // first address, so the open tabs' current addresses are read before any message.
    try {
      const before = addressUpdates;
      for (const tab of await browser.tabs.query({
        url: ["https://www.perplexity.ai/*", "https://perplexity.ai/*"],
      })) {
        if (tab.id == null || !tab.url) continue;
        // An update reported while the read ran may be newer than the read.
        if ((tabAddresses.get(tab.id)?.seen ?? 0) <= before)
          tabAddresses.set(tab.id, { url: tab.url, seen: before });
        coordinator.noteTabAddress(tab.id, tabAddresses.get(tab.id)!.url);
      }
    } catch {}
    await coordinator.whenReady();
    let threadDelivery: { id: string; delivered: Set<number> } | null = null;
    await observeThreadInvalidations(
      ledger,
      () => coordinator.currentScope(),
      async (stillCurrent, deliveryId) => {
        if (threadDelivery?.id !== deliveryId)
          threadDelivery = { id: deliveryId, delivered: new Set() };
        const delivery = threadDelivery;
        const tabs = await browser.tabs.query({
          url: ["https://www.perplexity.ai/*", "https://perplexity.ai/*"],
        });
        const ids = [
          ...new Set(
            tabs.flatMap((tab) =>
              tab.id == null || delivery.delivered.has(tab.id) ? [] : [tab.id],
            ),
          ),
        ];
        for (let offset = 0; offset < ids.length; offset += 8) {
          if (!(await stillCurrent())) {
            threadDelivery = null;
            return;
          }
          const outcomes = await Promise.allSettled(
            ids.slice(offset, offset + 8).map((tabId) =>
              browser.tabs
                .sendMessage(
                  tabId,
                  { target: "footprint-recorded-thread-invalidated" },
                  { frameId: 0 },
                )
                .then(() => {
                  delivery.delivered.add(tabId);
                }),
            ),
          );
          if (outcomes.some((result) => result.status === "rejected"))
            throw new Error("sync_delayed");
        }
      },
      (code) => {
        failure(code);
      },
    );
    await observeScopeChanges(
      ledger,
      () => coordinator.currentScope(),
      async () => {
        routes.invalidateAll();
        fileBroker.invalidate();
        coordinator.invalidateUploadedFiles();
        historyAdmission.invalidateAll();
        coordinator.threads.invalidateAll();
        await notifyProviderTabs("footprint-scope-changed");
      },
    );

    return coordinator;
  });
  ready.catch((error) => failure(error));
  // The welcome page asks for the agreement on install, and once after an update while the
  // person has not agreed (owner decision of 18 October 2026). Test harnesses have no event.
  browser.runtime.onInstalled?.addListener((details) => {
    void ready
      .then(async (c) => {
        const shown = (await browser.storage.local.get(WELCOME_SHOWN_KEY))[
          WELCOME_SHOWN_KEY
        ];
        if (!welcomeDue(details.reason, await c.trackingConsented(), shown)) return;
        await browser.storage.local.set({
          [WELCOME_SHOWN_KEY]: TRACKING_CONSENT_VERSION,
        });
        await browser.tabs.create({
          url: browser.runtime.getURL(`/${WELCOME_PAGE}` as "/welcome.html"),
        });
      })
      .catch(() => {});
  });
  void scheduleSync().catch(() => failure("sync_delayed"));
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "sync")
      void ready
        .then(async (c) => {
          await c.ledger.resumePendingCleanup();
          await c.engines.maintainLocal();
          await c.company.maintenance();
        })
        .catch((error) => failure(error));
  });
  browser.permissions.onRemoved.addListener(() => {
    routes.invalidateAll();
    fileBroker.invalidate();
    historyAdmission.invalidateAll();
    void ready
      .then(async (c) => {
        c.invalidateUploadedFiles();
        c.threads.invalidateAll();
        for (const [tabId, origin] of captureTabs)
          if (
            !(await browser.permissions.contains({ origins: [origin + "/*"] }))
          ) {
            health.notify();
            await browser.tabs
              .sendMessage(tabId, { target: "capture-permission-lost" })
              .catch(() => {});
            await c.ledger.health(
              (await c.currentScope()).namespace,
              "capture_hook_missing",
            );
          }
        const credentials = await c.company.credentials();
        if (credentials && !(await hasCompanyConsent(credentials.origin))) {
          health.notify();
          await c.permissionRemoved();
          await c.ledger.health(credentials.namespace, "policy_unavailable");
        }
      })
      .catch((error) => failure(error));
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    tabAddresses.delete(tabId);
    routes.invalidate(tabId);
    fileBroker.invalidate(tabId);
    historyAdmission.invalidate(tabId);
    captureTabs.delete(tabId);
    void ready.then((c) => c.invalidateDisplay(tabId)).catch(() => {});
  });
  browser.tabs.onUpdated.addListener((tabId, change) => {
    if (change.url !== undefined) {
      tabAddresses.set(tabId, { url: change.url, seen: ++addressUpdates });
      void ready
        .then((c) => {
          const latest = tabAddresses.get(tabId);
          if (latest) c.noteTabAddress(tabId, latest.url);
        })
        .catch(() => {});
    }
    if (change.url === undefined && change.status !== "loading") return;
    return routes.updated(tabId, change, (documentNonce, preserveCapture) => {
      historyAdmission.invalidate(tabId, documentNonce);
      void ready
        .then((c) => {
          if (preserveCapture) {
            c.history.invalidate(tabId, documentNonce);
            c.threads.invalidate(tabId, documentNonce);
          } else c.invalidateDisplay(tabId, documentNonce);
        })
        .catch(() => {});
    });
  });
  browser.runtime.onMessage.addListener((message, sender) => {
    if (message?.target === "file-grant")
      return fileBroker.issue(message, sender);
    if (message?.target === "file-relay-redeem")
      return fileBroker.redeem(message, sender);
    if (message?.target === "file-receipt-bind")
      return fileBroker.bind(message, sender);
    if (message?.target === "file-capture-association")
      return ready
        .then((c) => c.associateUploadedFiles(message, sender))
        .catch(() => ({ accepted: false }));
    if (message?.target === "file-relay-count")
      return import.meta.env.BROWSER === "firefox"
        ? fileBroker.submit(message, sender, true)
        : Promise.resolve({ status: "unavailable" });
    if (
      message?.target === "file-grant-cancel" ||
      message?.target === "file-relay-cancel"
    ) {
      fileBroker.cancel(message, sender);
      return Promise.resolve({ cancelled: true });
    }
    if (message?.target === "thread-history-invalidate") {
      let url: URL;
      try {
        url = new URL(sender.url ?? "");
      } catch {
        return;
      }
      if (
        sender.id !== browser.runtime.id ||
        sender.tab?.id == null ||
        sender.frameId !== 0 ||
        url.protocol !== "https:" ||
        siteForHost(url.hostname) !== "perplexity" ||
        Object.keys(message).sort().join(",") !== "binding,target" ||
        !isDisplayBinding(message.binding, null)
      )
        return;
      historyAdmission.invalidate(sender.tab.id, message.binding.documentNonce);
      return ready
        .then((c) =>
          c.threads.invalidate(sender.tab!.id!, message.binding.documentNonce),
        )
        .catch(() => {});
    }
    if (message?.target === "thread-history") {
      let url: URL;
      try {
        url = new URL(sender.url ?? "");
      } catch {
        return;
      }
      if (
        sender.id !== browser.runtime.id ||
        sender.tab?.id == null ||
        sender.frameId !== 0 ||
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        (url.port && url.port !== "443") ||
        siteForHost(url.hostname) !== "perplexity" ||
        Object.keys(message).sort().join(",") !== "binding,payload,target" ||
        !validateThreadHistory(message.payload) ||
        !isDisplayBinding(message.binding, null)
      )
        return;
      try {
        const lease = historyAdmission.admit(
          message.payload.event,
          message.payload.id,
          message.binding,
          sender.tab.id,
          Date.parse(message.payload.at),
        );
        if (!lease) return Promise.resolve({ observed: false });
        return historyAdmission
          .run(lease, message.payload.event, async () => {
            const c = await ready;
            historyAdmission.check(lease);
            return routes.run(
              sender,
              message.binding,
              "perplexity",
              message.payload.threadId,
              async (guard, currentSender) => {
                historyAdmission.check(lease);
                return c.threads.receive(
                  message.payload,
                  message.binding,
                  currentSender,
                  guard,
                );
              },
            );
          })
          .catch(historyFailure);
      } catch (error) {
        return Promise.resolve(historyFailure(error));
      }
    }
    if (message?.target === "tokenizer") return;
    const internal =
      sender.id === browser.runtime.id &&
      sender.url?.startsWith(browser.runtime.getURL("/"));
    if (
      internal &&
      privateFilePage(sender.url) &&
      import.meta.env.BROWSER === "firefox" &&
      message?.target === "accessible-file-count"
    ) {
      try {
        validateFileJob(message.job);
      } catch {
        return Promise.resolve({ error: "invalid_job" });
      }
      return fileBroker.isBusy()
        ? Promise.resolve(unavailable(message.job, "busy"))
        : countExclusive(message.job);
    }
    if (
      internal &&
      privateFilePage(sender.url) &&
      import.meta.env.BROWSER === "firefox" &&
      message?.target === "cancel-accessible-file-count"
    ) {
      cancelFileLocally(message.jobId);
      return Promise.resolve({ cancelled: true });
    }
    if (
      message?.target === "display-invalidate" &&
      sender.id === browser.runtime.id &&
      sender.tab?.id != null &&
      sender.frameId === 0 &&
      isDisplayBinding(message.binding, null)
    ) {
      return ready.then((c) =>
        c.invalidateDisplay(sender.tab!.id!, message.binding.documentNonce),
      );
    }
    if (
      message?.target === "history-observation" ||
      message?.target === "history-observation-invalidate"
    ) {
      if (
        sender.id !== browser.runtime.id ||
        sender.frameId !== 0 ||
        sender.tab?.id == null ||
        !isDisplayBinding(message.binding, null) ||
        Object.keys(message).sort().join(",") !==
          (message.target === "history-observation"
            ? "binding,message,target"
            : "binding,target")
      )
        return Promise.resolve({ accepted: false, error: "payload_rejected" });
      return ready
        .then(async (c) => {
          if (message.target === "history-observation-invalidate") {
            c.history.invalidate(
              sender.tab!.id!,
              message.binding.documentNonce,
            );
            return { accepted: true };
          }
          return routes.run(
            sender,
            message.binding,
            message.message?.site,
            message.message?.conversationId,
            (guard, currentSender) =>
              message.message?.event === "batch" ||
              message.message?.event === "progress" ||
              message.message?.event === "finish" ||
              message.message?.event === "files"
                ? c.history.receiveStream(
                    message.message,
                    message.binding,
                    currentSender,
                    guard,
                  )
                : c.history.receive(
                    message.message,
                    message.binding,
                    currentSender,
                    guard,
                  ),
          );
        })
        .catch((error) => ({
          accepted: false,
          error:
            error instanceof Error &&
            ["history_unavailable", "route_pending"].includes(error.message)
              ? "partial_capture"
              : safeCode(error),
        }));
    }
    if (message?.target === "capture") {
      if (
        Object.keys(message).sort().join(",") !== "binding,payload,target" ||
        sender.id !== browser.runtime.id ||
        !isDisplayBinding(message.binding, message.payload?.id)
      )
        return Promise.resolve({ ok: false, code: "payload_rejected" });
      try {
        if (
          sender.tab?.id != null &&
          siteForHost(new URL(sender.url ?? "").hostname)
        ) {
          captureTabs.set(sender.tab.id, new URL(sender.url!).origin);
          // Read aloud and notebook guides never replace the reply a tab shows, so the
          // tab keeps that capture.
          if (
            validateCapture(message.payload, new URL(sender.url!).hostname) &&
            message.payload.event !== "health" &&
            !sideCapture(message.payload.dispatch?.action)
          )
            routes.rememberCapture(
              sender,
              message.binding,
              message.payload.site,
              message.payload.snapshot?.conversationId ??
                message.payload.dispatch?.conversationId ??
                null,
              message.payload.event,
            );
          if (captureTabs.size > 128)
            captureTabs.delete(captureTabs.keys().next().value!);
        }
      } catch {}
      return ready
        .then((c) => c.capture(message.payload, sender, message.binding))
        .then((outcome) =>
          outcome === "superseded" ? { ok: true, superseded: true } : { ok: true },
        )
        .catch((error) => {
          const code = safeCode(error);
          failure(error);
          if (code === "capture_hook_missing" && sender.tab?.id != null)
            void browser.tabs
              .sendMessage(sender.tab.id, { target: "capture-permission-lost" })
              .catch(() => {});
          return { ok: false, code, error: safeMessage(code) };
        });
    }
    if (
      message?.target === "conversation-summary" &&
      sender.tab?.id != null &&
      sender.frameId === 0
    ) {
      let site;
      let origin;
      try {
        const url = new URL(sender.url ?? "");
        site = siteForHost(url.hostname);
        if (
          sender.id !== browser.runtime.id ||
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.port ||
          !site
        )
          return;
        origin = url.origin;
      } catch {
        return;
      }
      if (
        Object.keys(message).sort().join(",") ===
          "binding,conversationId,target" &&
        isDisplayBinding(message.binding, null)
      )
        return ready
          .then(async (c) => {
            return routes.run(
              sender,
              message.binding,
              site!,
              message.conversationId,
              async (guard) => {
                captureTabs.set(sender.tab!.id!, origin!);
                if (captureTabs.size > 128)
                  captureTabs.delete(captureTabs.keys().next().value!);
                if (guard.checkActivity) guard.checkActivity();
                else guard.check();
                // Never delays the totals read; a link that fails is tried again when
                // the reply ends.
                if (site === "perplexity")
                  void c.noteThreadRoute(
                    sender.tab!.id!,
                    sender.documentId,
                    message.conversationId,
                  );
                return c.routeSummary(
                  site!,
                  message.conversationId,
                  message.binding,
                );
              },
            );
          })
          .then((display) => {
            // A totals read that checked the calculation answered (calculation churn is over).
            if (display?.target === "footprint-display") health.resolveCalculation();
            return display;
          })
          .catch((error) => {
            const code = safeCode(error);
            if (code !== "partial_capture") failure(error);
            return { code, error: safeMessage(code) };
          });
      return;
    }
    // A 429 or 5xx pause of the own read, shared by the tabs of one site: a time per site,
    // never a chat id. The sender and the message are checked in lib/own-read-pause.ts.
    if (message?.target === "own-read-pause")
      return ownReadPauses.answer(message, sender);
    // Whether "Load full chat history" is on for the switch a tab's own read needs (17 Oct 2026),
    // and the button in Details that opens Settings. Only the top frame of an HTTPS provider
    // page may ask, and only for its own site's switches (claude.ai: Claude and Cowork).
    if (
      (message?.target === OWN_READ_SETTING_TARGET ||
        message?.target === OPEN_SETTINGS_TARGET ||
        message?.target === OPEN_WELCOME_TARGET ||
        message?.target === TRACKING_STATE_TARGET) &&
      sender.tab?.id != null &&
      sender.frameId === 0
    ) {
      try {
        const url = new URL(sender.url ?? "");
        const keys = Object.keys(message).sort().join(",");
        if (
          sender.id !== browser.runtime.id ||
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.port
        )
          return;
        if (message.target === OPEN_SETTINGS_TARGET) {
          if (keys !== "target" || !siteForHost(url.hostname)) return;
          return browser.tabs
            .create({ url: browser.runtime.getURL("/dashboard.html#settings") })
            .then(
              () => ({ ok: true }),
              () => ({ ok: false }),
            );
        }
        // The bar's Set up control while tracking is off (owner decision of 18 Oct 2026). An
        // open welcome page comes to the front instead of a second one (live QA, 19 Oct 2026).
        if (message.target === OPEN_WELCOME_TARGET) {
          if (keys !== "target" || !siteForHost(url.hostname)) return;
          return browser.runtime
            .sendMessage({ target: WELCOME_FOCUS_TARGET })
            .catch(() => undefined)
            .then((answer) =>
              (answer as { focused?: unknown } | undefined)?.focused === true
                ? undefined
                : browser.tabs.create({
                    url: browser.runtime.getURL(`/${WELCOME_PAGE}` as "/welcome.html"),
                  }),
            )
            .then(
              () => ({ ok: true }),
              () => ({ ok: false }),
            );
        }
        // Whether the person agreed, for the bar's Tracking is off, and the organization's
        // name for the line in Details. An unreadable answer changes nothing on the page.
        if (message.target === TRACKING_STATE_TARGET) {
          if (keys !== "target" || !siteForHost(url.hostname)) return;
          return ready.then((c) => c.trackingState()).catch(() => null);
        }
        if (
          keys !== "key,target" ||
          !ownReadSettingKeys(siteForHost(url.hostname)).includes(message.key)
        )
          return;
      } catch {
        return;
      }
      // An unreadable setting answers nothing usable, so the tab sends no read.
      return ready
        .then((c) => c.ownReadSetting(message.key))
        .catch(() => null);
    }
    // How far the tracker's own read of a long ChatGPT chat got (14 Oct 2026): the top frame
    // of a ChatGPT page reads it before the read and keeps it after each page. Ids and
    // numbers only; checked again by the coordinator.
    if (
      message?.target === "chatgpt-read-progress" &&
      sender.tab?.id != null &&
      sender.frameId === 0
    ) {
      try {
        const url = new URL(sender.url ?? "");
        const keys = Object.keys(message).sort().join(",");
        if (
          sender.id !== browser.runtime.id ||
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.port ||
          siteForHost(url.hostname) !== "chatgpt" ||
          !(
            keys === "conversationId,target" ||
            keys === "conversationId,progress,target"
          ) ||
          typeof message.conversationId !== "string"
        )
          return;
      } catch {
        return;
      }
      return ready
        .then((c) => c.chatgptReadProgress(message.conversationId, message.progress))
        .catch(() => null);
    }
    // Whether the person closed or snoozed the long-chat tip of the open chat (16 Oct 2026).
    // The site comes from the sender's address, never from the message; ids are checked again
    // by the coordinator.
    if (
      message?.target === "long-chat-tip" &&
      sender.tab?.id != null &&
      sender.frameId === 0
    ) {
      let site: ReturnType<typeof siteForHost> = null;
      try {
        const url = new URL(sender.url ?? "");
        const keys = Object.keys(message).sort().join(",");
        site = siteForHost(url.hostname);
        if (
          sender.id !== browser.runtime.id ||
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.port ||
          !site ||
          !(keys === "conversationId,target" || keys === "action,conversationId,target") ||
          typeof message.conversationId !== "string"
        )
          return;
      } catch {
        return;
      }
      return ready
        .then((c) => c.longChatTip(site!, message.conversationId, message.action))
        .catch(() => null);
    }
    // Details compares the open chat with the person's other chats. Only the top frame of a
    // supported HTTPS provider page may ask, and the reply holds figures only, never chat keys.
    if (
      message?.target === "chat-comparison" &&
      sender.tab?.id != null &&
      sender.frameId === 0
    ) {
      let site;
      try {
        const url = new URL(sender.url ?? "");
        site = siteForHost(url.hostname);
        if (
          sender.id !== browser.runtime.id ||
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.port ||
          !site ||
          Object.keys(message).sort().join(",") !== "conversationId,target" ||
          typeof message.conversationId !== "string"
        )
          return;
      } catch {
        return;
      }
      return ready
        .then((c) => c.chatComparison(site!, message.conversationId))
        .catch((error) => {
          const code = safeCode(error);
          return { code, error: safeMessage(code) };
        });
    }
    if (
      (message?.target === "capture-status" ||
        message?.target === "capture-diagnostic") &&
      sender.tab?.id != null &&
      sender.frameId === 0
    ) {
      return ready
        .then(async (c) => {
          const origin = new URL(sender.url ?? "").origin;
          if (
            !siteForHost(new URL(origin).hostname) ||
            !(await browser.permissions.contains({ origins: [origin + "/*"] }))
          )
            return { enabled: false };
          captureTabs.set(sender.tab!.id!, origin);
          const settings = await c.settings(),
            credentials = await c.company.credentials();
          const enabled =
            (await c.trackingConsented()) &&
            (!settings.paused ||
              ((await c.currentScope()).mode === "company" &&
                credentials?.policy.pause_mode === "disabled_by_company"));
          if (
            message.target === "capture-diagnostic" &&
            enabled &&
            ["capture_hook_missing", "protocol_unsupported"].includes(
              message.code,
            )
          ) {
            health.notify();
            await c.ledger.health(
              (await c.currentScope()).namespace,
              message.code,
            );
          }
          return { enabled };
        })
        .catch((error) => {
          failure(error);
          return { enabled: false };
        });
    }
    if (message?.target === "placement-health" && sender.tab?.id != null)
      return ready
        .then(async (c) => {
          // Before the person agreed nothing is recorded, not even a health receipt
          // (lib/tracking-consent.ts); the popup asks for the agreement anyway.
          if (!(await c.trackingConsented())) return;
          await c.ledger.health(
            (await c.currentScope()).namespace,
            "composer_anchor_missing",
          );
        })
        .catch((error) => failure(error));
    if (
      message?.target === "dismiss-advice" &&
      sender.tab?.id != null &&
      typeof message.key === "string"
    )
      return ready
        .then((c) => c.dismiss(message.key))
        .catch((error) => failure(error));
    if (
      message?.target === "snooze-advice" &&
      sender.tab?.id != null &&
      typeof message.key === "string"
    )
      return ready
        .then((c) => c.snooze(message.key))
        .catch((error) => failure(error));
    if (!internal || message?.target !== "ui") return;
    if (message.action === "tracking-health")
      return ready
        .then((c) => c.trackingHealth())
        .catch((error) => {
          const code = safeCode(error);
          failure(error);
          return { status: "unavailable", health: health.list() };
        });
    return ready
      .then(async (c) => {
        switch (message.action) {
          case "engine-status":
            return c.engineStatus();
          case "select-engine":
            return c.selectEngine({
              preference: message.preference,
              expectedRevision: message.expectedRevision,
            });
          case "resume-engine":
            return c.resumeEngine();
          case "method-status":
            return c.methodStatus();
          case "refresh-methods":
            return c.refreshMethods();
          case "start-recalculation":
            return c.recalculation(message.methodId, message.operationId);
          case "recalculation-status":
            return c.recalculation(null, message.jobId);
          case "dashboard": {
            const dashboard = await c.dashboard(message.filters ?? {});
            // Built while the calculation stood still (not "rebuilding"): churn is over.
            if (dashboard?.aggregate_status !== "rebuilding") health.resolveCalculation();
            return dashboard;
          }
          case "view-token":
            return c.viewToken();
          case "capabilities":
            return getRuntimeCapabilities();
          case "consent": {
            // Agree and start, or Turn off tracking (lib/tracking-consent.ts). Open provider
            // tabs ask again at once, so the bar and the reads follow without a reload.
            const saved = await c.setTrackingConsent({
              agreed: message.agreed,
              version: message.version,
              ownRead: message.ownRead,
            });
            if (saved.changed) {
              void notifyProviderTabs(TRACKING_STATE_CHANGED).catch(() => {});
              // Open welcome pages follow too, so none still offers Agree and start.
              void Promise.resolve()
                .then(() => browser.runtime.sendMessage({ target: TRACKING_STATE_CHANGED }))
                .catch(() => {});
            }
            if (saved.ownReadChanged)
              void notifyProviderTabs(OWN_READ_SETTING_CHANGED).catch(() => {});
            if (message.agreed === false) {
              fileRoutingVersion++;
              fileBroker.invalidate();
              c.invalidateUploadedFiles();
            }
            return { ok: true };
          }
          case "settings": {
            const wasPaused = (await c.trackingState()).paused;
            const saved = await c.updateSettings(message.changes ?? {});
            // Open provider tabs ask for "Load full chat history" again, so a running read stops
            // and a held one starts without reloading anything (17 Oct 2026).
            if (saved.ownReadChanged)
              void notifyProviderTabs(OWN_READ_SETTING_CHANGED).catch(() => {});
            // Pause or resume: open provider tabs ask for the tracking state again, so the bar
            // stops or resumes showing Processing at once (live, 21 Oct 2026). Pages save their
            // whole copy of the settings, so only a change of Pause sends the notice.
            if ((await c.trackingState()).paused !== wasPaused)
              void notifyProviderTabs(TRACKING_STATE_CHANGED).catch(() => {});
            if (message.changes?.paused) {
              fileRoutingVersion++;
              fileBroker.invalidate();
              c.invalidateUploadedFiles();
            }
            return { ok: true };
          }
          case "expand":
            await openDashboard();
            return { ok: true };
          case "connect": {
            // Step 1: email the code. The origin is the hosted service or the organization's own server.
            const origin = companyOrigin(message.origin);
            if (!(await hasCompanyConsent(origin)))
              throw new Error(
                "Company origin or data-sharing permission was not granted.",
              );
            const capabilities = await getRuntimeCapabilities();
            if (!capabilities.ed25519 || !capabilities.tokenizerHostAvailable)
              throw new Error(
                "This browser lacks a required local counting or deletion-verification capability. Update your browser.",
              );
            return connectStep(() =>
              c.company.requestCode(origin, String(message.email ?? "")),
            );
          }
          case "verify-code":
            return connectStep(() =>
              c.company.verifyCode(String(message.code ?? ""), browserFamily()),
            );
          case "confirm-connection": {
            // Connecting needs its own agreement, given with the checkbox in the Connect dialog
            // (owner decision of 17 October 2026). The server calls stay as they were.
            if (
              message.agreed !== true ||
              message.version !== ORGANIZATION_CONSENT_VERSION
            )
              throw new Error("payload_rejected");
            // confirm() keeps the agreement with the exchange and stores it once the connection
            // is made, also when background maintenance finishes an exchange this request
            // could not (Coordinator.recordOrganizationConsent through connectionAgreed).
            const reply = await connectStep(() => c.company.confirm(message.version));
            const credentials = reply.ok ? await c.company.credentials() : null;
            if (!credentials) return reply;
            // The dialog showed the text for both operator switches off, since the server tells
            // a browser its switches only once it is connected. When one is on, the dialog asks
            // again with the updated text and nothing is shared before that agreement.
            return { ...reply, review: await c.organizationReviewAfterConnect() };
          }
          case "organization-consent": {
            if (message.agreed !== true) throw new Error("payload_rejected");
            await c.agreeOrganization(message.version);
            // What waited for the agreement is shared now rather than at the next alarm.
            void c.company.sync().catch(() => {});
            return { ok: true };
          }
          case "cancel-connection":
            await c.company.cancel();
            return { ok: true };
          case "disconnect":
            await c.company.disconnect();
            return { ok: true };
          case "sync":
            await c.company.sync();
            return { ok: true };
          case "company-summary":
            return c.selectedServerSummary("company", message.query ?? "");
          case "my-summary":
            return c.selectedServerSummary("my", message.query ?? "");
          case "monthly-summary":
            return c.monthly.read();
          case "usage-breakdown": {
            const breakdown = await c.usageBreakdown({
              start: message.start,
              end: message.end,
              bucket: message.bucket,
              timezone: message.timezone,
            });
            health.resolveCalculation();
            return breakdown;
          }
          case "erase-local":
            return c.clearPersonal();
          default:
            throw new Error("Unknown extension action.");
        }
      })
      .catch((error) => {
        if (
          error instanceof Error &&
          ["recalculation_pending", "method_unsupported"].includes(
            error.message,
          )
        )
          return {
            code: error.message,
            error:
              error.message === "recalculation_pending"
                ? "The selected recalculation is not ready. No current recalculated totals are available."
                : "The selected method is not installed for this connection.",
            health: health.list(),
          };
        const code = safeCode(error);
        failure(error);
        return { code, error: safeMessage(code), detail: technicalDetail(error), health: health.list() };
      });
  });
});
