// The agreement before anything is tracked (owner decisions of 17 and 18 October 2026,
// lib/tracking-consent.ts): nothing new is captured, counted, recorded, read from a site or
// uploaded before the person agrees, and tracking works unchanged once they have.
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Ledger } from "@footprint/ledger";
import { initialSnapshot, parseDispatch, parseHistoryText } from "@footprint/adapters";
import { Coordinator } from "../lib/coordinator";
import { HISTORY_CAPTURE_CHANNEL } from "../lib/history-capture";
import { PROVIDER_STREAM_CHANNEL } from "../lib/provider-history-message";
import { countByTextLength } from "./counting-fixture";
import {
  ORGANIZATION_CONSENT_VERSION,
  TRACKING_CONSENT_VERSION,
  consentRequired,
  localDetailsText,
  organizationConsent,
  trackingConsent,
  trackingStateAnswer,
  welcomeDue,
} from "../lib/tracking-consent";
import { validatedDashboard } from "../lib/dashboard/summary-validators";
import { dashboard as dashboardFixture } from "./ui-fixtures";

const conversationId = "00000000-0000-4000-8000-000000000071";
const chatgptSender = {
  tab: { id: 7 },
  frameId: 0,
  documentId: "consent-document",
  url: `https://chatgpt.com/c/${conversationId}`,
};
// The saved Claude chat fixture's own id: a page parsed for another chat reads as unsupported.
const historyConversationId = "00000000-0000-4000-8000-000000000042";
const claudeSender = {
  tab: { id: 8 },
  frameId: 0,
  documentId: "consent-history-document",
  url: `https://claude.ai/chat/${historyConversationId}`,
};

function dispatch(): any {
  return {
    channel: "ai-footprint-observation-v1",
    version: 1,
    id: crypto.randomUUID(),
    revision: 1,
    event: "dispatch",
    site: "chatgpt",
    at: new Date().toISOString(),
    dispatch: parseDispatch(
      "chatgpt",
      new URL("https://chatgpt.com/backend-api/f/conversation"),
      JSON.stringify({
        action: "next",
        conversation_id: conversationId,
        messages: [
          {
            id: crypto.randomUUID(),
            author: { role: "user" },
            content: { parts: ["How much water does this use?"] },
          },
        ],
      }),
    ),
    snapshot: initialSnapshot(),
    failure: null,
    timing: null,
  };
}

/** A coordinator wired as the background wires it: it requires the agreement. */
async function setup(requireTrackingConsent = true) {
  const db = await Ledger.open("tracking-consent-" + crypto.randomUUID());
  const c = new Coordinator(db, {
    count: countByTextLength,
    hasConsent: async () => true,
    hasSiteConsent: async () => true,
    sendDisplay: async () => {},
    transport: (async () => {
      throw new Error("unexpected_network");
    }) as typeof fetch,
    requireTrackingConsent,
  });
  await c.whenReady();
  const scope = await c.currentScope();
  return {
    db,
    c,
    scope,
    rows: async () => (await db.rows(scope.namespace)).length,
    close() {
      c.history.invalidate();
      c.engines.dispose();
      db.close();
    },
  };
}

const agree = (c: Coordinator) =>
  c.setTrackingConsent({ agreed: true, version: TRACKING_CONSENT_VERSION });

function historyStart() {
  return {
    channel: HISTORY_CAPTURE_CHANNEL,
    event: "start",
    id: crypto.randomUUID(),
    site: "claude",
    conversationId: historyConversationId,
    observedAt: new Date().toISOString(),
    page: null,
  } as any;
}
const binding = () => ({
  documentNonce: crypto.randomUUID(),
  navigationNonce: crypto.randomUUID(),
  captureId: null,
});
const claudeHistory = JSON.parse(
  readFileSync(
    new URL(
      "../../../fixtures/history-observation-2026-09-14/claude-selected-history.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

test("consent: a saved agreement counts only with its text version and time; anything else is not agreed", () => {
  assert.deepEqual(trackingConsent(undefined), { agreed: false, version: null, at: null });
  assert.deepEqual(trackingConsent({ agreed: true }), { agreed: false, version: null, at: null });
  assert.deepEqual(trackingConsent({ agreed: true, version: "2026-10-18", at: 0 }).agreed, false);
  assert.deepEqual(trackingConsent({ agreed: "yes", version: "2026-10-18", at: 5 }).agreed, false);
  assert.deepEqual(trackingConsent({ agreed: true, version: "2026-10-18", at: 5 }), {
    agreed: true,
    version: "2026-10-18",
    at: 5,
  });
  assert.equal(organizationConsent({ version: "2026-10-18", at: 5, origin: "http://example.org" }), null);
  assert.deepEqual(organizationConsent({ version: "2026-10-18", at: 5, origin: "https://example.org" }), {
    version: "2026-10-18",
    at: 5,
    origin: "https://example.org",
  });
  // Extension pages ask for the agreement only when the background says it is missing.
  assert.equal(consentRequired({}), false);
  assert.equal(consentRequired({ consent: { agreed: false, version: null, at: null } }), true);
  assert.equal(consentRequired({ consent: { agreed: true, version: "2026-10-18", at: 5 } }), false);
});

test("consent: the welcome page opens on install and once after an update while not agreed", () => {
  assert.equal(welcomeDue("install", false, undefined), true);
  assert.equal(welcomeDue("install", true, undefined), false);
  assert.equal(welcomeDue("update", false, undefined), true);
  assert.equal(welcomeDue("update", false, TRACKING_CONSENT_VERSION), false, "not on every update");
  assert.equal(welcomeDue("update", true, undefined), false);
  assert.equal(welcomeDue("chrome_update", false, undefined), false);
});

test("consent: a tab accepts only the exact tracking state answer", () => {
  assert.deepEqual(trackingStateAnswer({ consent: "required", organization: null }), {
    consent: "required",
    organization: null,
    paused: false,
  });
  assert.deepEqual(trackingStateAnswer({ consent: "agreed", organization: "Example Consulting" }), {
    consent: "agreed",
    organization: "Example Consulting",
    paused: false,
  });
  // Pause is part of the answer since 21 Oct 2026, so the bar can leave out Processing.
  assert.deepEqual(trackingStateAnswer({ consent: "agreed", organization: null, paused: true }), {
    consent: "agreed",
    organization: null,
    paused: true,
  });
  for (const value of [
    null,
    { enabled: false },
    { consent: "maybe", organization: null },
    { consent: "agreed", organization: "", extra: 1 },
    { consent: "agreed", organization: null, paused: "yes" },
    { consent: "agreed", organization: null, paused: true, extra: 1 },
  ])
    assert.equal(trackingStateAnswer(value), null);
  assert.equal(localDetailsText(null).rest, "Nothing from this chat was sent to us.");
  assert.equal(localDetailsText("Example Consulting").rest, "Only numbers are shared with Example Consulting.");
});

test("consent: before the person agrees a live capture records nothing, not even a health receipt", async () => {
  const f = await setup();
  try {
    assert.equal((await f.c.settings()).consent.agreed, false, "a new installation has not agreed");
    assert.equal(await f.c.trackingConsented(), false);
    const message = dispatch();
    assert.equal(await f.c.capture(message, chatgptSender), "processed");
    await f.c.capture({ ...message, revision: 2, event: "health", dispatch: undefined, failure: "capture_hook_missing" }, chatgptSender).catch(() => {});
    assert.equal(await f.rows(), 0, "no record is kept");
    assert.deepEqual(await f.db.all("outbox" as any), [], "nothing waits to be uploaded");
    assert.deepEqual(await f.c.trackingState(), { consent: "required", organization: null, paused: false });
    assert.equal(await f.c.company.trackingAllowed?.(), false, "an organization sync uploads nothing");
  } finally {
    f.close();
  }
});

test("consent: after agreeing a live capture is recorded exactly as without the agreement step", async () => {
  const f = await setup();
  const before = await setup(false);
  try {
    await agree(f.c);
    assert.equal(await f.c.trackingConsented(), true);
    const message = dispatch();
    await f.c.capture(message, chatgptSender);
    await before.c.capture(structuredClone(message), chatgptSender);
    const recorded = (await f.db.rows(f.scope.namespace)).map((row) => row.record.kind).sort();
    const unchanged = (await before.db.rows(before.scope.namespace)).map((row) => row.record.kind).sort();
    assert.ok(recorded.length > 0);
    assert.deepEqual(recorded, unchanged);
    assert.deepEqual(await f.c.trackingState(), { consent: "agreed", organization: null, paused: false });
    assert.equal(await f.c.company.trackingAllowed?.(), true);
  } finally {
    f.close();
    before.close();
  }
});

test("consent: an installation saved before the agreement step stays off until the person agrees", async () => {
  const f = await setup();
  try {
    // A settings record from before 18 October 2026 has no agreement at all.
    const { key: _key, consent: _consent, organizationConsent: _org, ...older } = (await f.c.settings()) as any;
    await (f.c.ledger as any).applySessionChanges({ settings: older });
    assert.equal((await f.c.ledger.readSettings() as any).consent, undefined);
    assert.equal(await f.c.trackingConsented(), false);
    await f.c.capture(dispatch(), chatgptSender);
    assert.equal(await f.rows(), 0);
    await agree(f.c);
    await f.c.capture(dispatch(), chatgptSender);
    assert.ok((await f.rows()) > 0);
  } finally {
    f.close();
  }
});

test("consent: no history is imported before the agreement, and the same import runs once agreed", async () => {
  const f = await setup();
  try {
    // Saved history rows are kept apart from live records.
    const saved = async () => (await f.db.historyPage(f.scope, undefined)).length;
    await assert.rejects(f.c.history.receive(historyStart(), binding(), claudeSender), /policy_unavailable/);
    assert.equal(await f.rows(), 0);
    assert.equal(await saved(), 0);
    await agree(f.c);
    const start = historyStart();
    const pageBinding = binding();
    assert.deepEqual(await f.c.history.receive(start, pageBinding, claudeSender), { accepted: true });
    const page = parseHistoryText("claude", claudeHistory, historyConversationId, start.observedAt);
    const result: any = await f.c.history.receive({ ...start, event: "page", page }, pageBinding, claudeSender);
    assert.equal(result.accepted, true);
    assert.ok((await saved()) > 0, "the chat's saved replies are imported");
  } finally {
    f.close();
  }
});

test("consent: no own read, read progress or Perplexity thread link before the agreement", async () => {
  const f = await setup();
  const threadStart = () =>
    ({
      channel: "ai-footprint-thread-history-v1",
      event: "start",
      id: crypto.randomUUID(),
      site: "perplexity",
      threadId: conversationId,
      at: new Date().toISOString(),
      page: null,
    }) as any;
  const progress = { before: null, top: null, day: 20000, pages: 1 } as any;
  try {
    assert.deepEqual(await f.c.ownReadSetting("claude"), { on: false });
    assert.equal(await f.c.chatgptReadProgress(conversationId, progress), null);
    assert.deepEqual(await f.c.threads.receive(threadStart(), binding(), { tab: { id: 9 }, documentId: "thread-document" }), { observed: false });
    assert.equal((f.c.threads as any).pending.size, 0, "no thread read starts");
    await agree(f.c);
    assert.deepEqual(await f.c.ownReadSetting("claude"), { on: true });
    assert.deepEqual(await f.c.chatgptReadProgress(conversationId, progress), progress);
    await f.c.threads.receive(threadStart(), binding(), { tab: { id: 9 }, documentId: "thread-document" });
    assert.equal((f.c.threads as any).pending.size, 1, "the same read starts once agreed");
  } finally {
    f.close();
  }
});

test("consent: turning tracking off withdraws the agreement and records nothing more", async () => {
  const f = await setup();
  try {
    await agree(f.c);
    await f.c.capture(dispatch(), chatgptSender);
    const kept = await f.rows();
    assert.ok(kept > 0);
    const result = await f.c.setTrackingConsent({ agreed: false });
    assert.deepEqual(result, { changed: true, ownReadChanged: false });
    const consent = (await f.c.settings()).consent;
    assert.equal(consent.agreed, false);
    assert.equal(consent.version, TRACKING_CONSENT_VERSION, "the withdrawal names the text it withdraws from");
    assert.equal(typeof consent.at, "number");
    await f.c.capture(dispatch(), chatgptSender);
    assert.equal(await f.rows(), kept, "earlier records stay; nothing new is added");
    assert.equal((await f.c.settings()).paused, false, "Pause is separate");
  } finally {
    f.close();
  }
});

// Live QA of 19 Oct 2026: a reply still arriving when tracking was turned off stayed
// "generating" with its partial figures for good.
test("consent: turning tracking off ends a reply that was still arriving", async () => {
  const f = await setup();
  try {
    await agree(f.c);
    await f.c.capture(dispatch(), chatgptSender);
    const kept = await f.rows();
    await f.c.setTrackingConsent({ agreed: false });
    const records = (await f.db.rows(f.scope.namespace)).map((row) => row.record as any);
    const attempt = records.find((record) => record.kind === "attempt");
    const request = records.find((record) => record.kind === "request");
    assert.equal(attempt.state, "interrupted_unconfirmed");
    assert.notEqual(attempt.ended_at, null);
    assert.ok(attempt.coverage_reasons.includes("unknown_terminal_state"));
    assert.equal(request.state, "interrupted_unconfirmed");
    assert.equal(await f.rows(), kept, "the same records end; nothing is added");
  } finally {
    f.close();
  }
});

// Live QA of 19 Oct 2026: after agreeing again, the Tracking page still said the reply the
// withdrawal cut off could not be read and to reload the tab, beside "No open problems".
test("consent: a reply that turning tracking off ended is not reported as a reply the tracker missed", async () => {
  const f = await setup();
  try {
    await agree(f.c);
    await f.c.capture(dispatch(), chatgptSender);
    await f.c.setTrackingConsent({ agreed: false });
    const withdrawnAt = (await f.c.settings()).trackingWithdrawnAt;
    assert.equal(typeof withdrawnAt, "number");
    await agree(f.c);
    assert.equal((await f.c.settings()).trackingWithdrawnAt, withdrawnAt, "kept after agreeing again");
    const breakdown = await f.c.usageBreakdown({ bucket: "day", timezone: "UTC" });
    assert.ok(breakdown.siteLastAt.chatgpt, "the reply is in the breakdown");
    assert.deepEqual(breakdown.siteLastMissed, {});
  } finally {
    f.close();
  }
});

// Live QA of 19 Oct 2026: agreeing again while a cut-off reply was still being written, the open
// chat's totals read gave up because the calculation changed on every attempt, and it was
// reported as policy_unavailable ("Organization rules could not be checked") in personal mode.
test("consent: a totals read that gives up while replies are saved names the calculation, not organization rules", async () => {
  const f = await setup();
  try {
    await agree(f.c);
    await f.c.capture(dispatch(), chatgptSender);
    // Every read sees a new saved version, as while a streaming reply commits its frames.
    const ledger = (f.c as any).ledger;
    const snapshot = ledger.publicationSnapshot.bind(ledger);
    let version = 0;
    ledger.publicationSnapshot = async (...args: unknown[]) => ({
      ...(await snapshot(...args)),
      version: version++,
    });
    await assert.rejects(f.c.routeSummary("chatgpt", conversationId), /aggregate_inconsistent/);
    ledger.publicationSnapshot = snapshot;
    const display: any = await f.c.routeSummary("chatgpt", conversationId);
    assert.equal(display.target, "footprint-display", "a later read is consistent");
  } finally {
    f.close();
  }
});

test("consent: agreeing names the text that was shown and keeps the full history choice made beside it", async () => {
  const f = await setup();
  try {
    await assert.rejects(f.c.setTrackingConsent({ agreed: true }), /payload_rejected/);
    await assert.rejects(f.c.setTrackingConsent({ agreed: true, version: "2020-01-01" }), /payload_rejected/);
    await assert.rejects(f.c.setTrackingConsent({ agreed: "yes" }), /payload_rejected/);
    assert.equal(await f.c.trackingConsented(), false);
    const result = await f.c.setTrackingConsent({ agreed: true, version: TRACKING_CONSENT_VERSION, ownRead: false });
    assert.deepEqual(result, { changed: true, ownReadChanged: true });
    const settings = await f.c.settings();
    assert.equal(settings.ownRead, false);
    assert.equal(settings.consent.agreed, true);
    assert.equal(settings.consent.version, TRACKING_CONSENT_VERSION);
    assert.ok(Math.abs(settings.consent.at! - Date.now()) < 60_000);
    assert.deepEqual(await f.c.ownReadSetting("claude"), { on: false, cause: "main" }, "the switch the person chose");
  } finally {
    f.close();
  }
});

test("consent: a page's whole settings copy never changes an agreement made or withdrawn elsewhere", async () => {
  const f = await setup();
  try {
    const stale = await f.c.settings();
    await agree(f.c);
    // The dashboard saves its whole copy, which still says not agreed.
    await f.c.updateSettings({ ...stale, timezone: "Europe/Berlin" } as any);
    assert.equal((await f.c.settings()).consent.agreed, true);
    const agreedCopy = await f.c.settings();
    await f.c.setTrackingConsent({ agreed: false });
    await f.c.updateSettings({ ...agreedCopy, paused: false } as any);
    assert.equal((await f.c.settings()).consent.agreed, false);
    assert.equal(await f.c.trackingConsented(), false);
  } finally {
    f.close();
  }
});

test("consent: the organization agreement is kept with its text version, time and server", async () => {
  const f = await setup();
  try {
    await assert.rejects(f.c.recordOrganizationConsent("2020-01-01", "https://aifootprinttracker.com"), /payload_rejected/);
    await f.c.recordOrganizationConsent(ORGANIZATION_CONSENT_VERSION, "https://aifootprinttracker.com");
    const settings = await f.c.settings();
    assert.equal(settings.organizationConsent?.version, ORGANIZATION_CONSENT_VERSION);
    assert.equal(settings.organizationConsent?.origin, "https://aifootprinttracker.com");
    assert.equal(settings.consent.agreed, false, "it is separate from the agreement to tracking");
    // The dashboard validator accepts the settings exactly as the background sends them.
    assert.doesNotThrow(() => validatedDashboard({ ...dashboardFixture(), settings: { ...dashboardFixture().settings, consent: settings.consent, organizationConsent: settings.organizationConsent } }));
    assert.throws(() => validatedDashboard({ ...dashboardFixture(), settings: { ...dashboardFixture().settings, consent: { agreed: true } } }));
  } finally {
    f.close();
  }
});

test("consent: a coordinator that does not require the agreement tracks as before (tests from before the step)", async () => {
  const f = await setup(false);
  try {
    assert.equal(await f.c.trackingConsented(), true);
    await f.c.capture(dispatch(), chatgptSender);
    assert.ok((await f.rows()) > 0);
  } finally {
    f.close();
  }
});

// ---------------------------------------------------------------------------------------
// Knock-on paths of the agreement (review of 18 October 2026): erasing, withdrawing in the
// middle of a read, agreeing again and the organization policy.

/** Imports the saved Claude chat fixture as one history read: start, then its page. */
async function importClaudeChat(c: Coordinator) {
  const start = historyStart();
  const pageBinding = binding();
  assert.deepEqual(await c.history.receive(start, pageBinding, claudeSender), { accepted: true });
  const page = parseHistoryText("claude", claudeHistory, historyConversationId, start.observedAt);
  return c.history.receive({ ...start, event: "page", page }, pageBinding, claudeSender);
}

test("consent: Erase local records works while tracking is off and never turns tracking on", async () => {
  const f = await setup();
  try {
    await agree(f.c);
    await importClaudeChat(f.c);
    await f.c.capture(dispatch(), chatgptSender);
    assert.ok((await f.rows()) > 0);
    await f.c.setTrackingConsent({ agreed: false });
    const withdrawn = (await f.c.settings()).consent;
    // The person erases after turning tracking off: the erase needs no agreement.
    const { count } = await f.c.clearPersonal();
    assert.ok(count > 0, "the records are erased");
    const scope = await f.c.currentScope();
    assert.notEqual(scope.namespace, f.scope.namespace, "a clean slate");
    assert.equal((await f.db.rows(scope.namespace)).length, 0);
    assert.equal((await f.db.historyPage(scope, undefined)).length, 0);
    assert.deepEqual((await f.c.settings()).consent, withdrawn, "erasing keeps the withdrawal");
    assert.equal(await f.c.trackingConsented(), false, "tracking stays off");
    await f.c.capture(dispatch(), chatgptSender);
    assert.equal((await f.db.rows(scope.namespace)).length, 0);
  } finally {
    f.close();
  }
});

test("consent: Erase local records keeps the agreement, and the reopened chat imports again from scratch", async () => {
  const f = await setup();
  try {
    await agree(f.c);
    const agreed = (await f.c.settings()).consent;
    await importClaudeChat(f.c);
    const before = (await f.db.historyPage(f.scope, undefined)).length;
    assert.ok(before > 0);
    await f.c.clearPersonal();
    // Erasing is not a withdrawal: the person is not asked to agree again.
    assert.deepEqual((await f.c.settings()).consent, agreed);
    assert.equal(await f.c.trackingConsented(), true);
    const scope = await f.c.currentScope();
    assert.equal((await f.db.historyPage(scope, undefined)).length, 0);
    assert.equal(((await importClaudeChat(f.c)) as any).accepted, true);
    assert.equal((await f.db.historyPage(scope, undefined)).length, before, "imported again, once");
  } finally {
    f.close();
  }
});

test("consent: agreeing again after a withdrawal imports a chat read before it once, not twice", async () => {
  const f = await setup();
  try {
    await agree(f.c);
    await importClaudeChat(f.c);
    const saved = async () => (await f.db.historyPage(f.scope, undefined)).length;
    const once = await saved();
    assert.ok(once > 0);
    await f.c.setTrackingConsent({ agreed: false });
    await assert.rejects(importClaudeChat(f.c), /policy_unavailable/);
    await agree(f.c);
    // The tab reads the same chat again once the person agreed (restartTracking).
    assert.equal(((await importClaudeChat(f.c)) as any).accepted, true);
    assert.equal(await saved(), once, "the same saved messages, counted once");
  } finally {
    f.close();
  }
});

test("consent: a history read that started before the withdrawal saves nothing after it", async () => {
  const f = await setup();
  try {
    await agree(f.c);
    const start = historyStart();
    const pageBinding = binding();
    assert.deepEqual(await f.c.history.receive(start, pageBinding, claudeSender), { accepted: true });
    // Turn off tracking arrives while the page world is still reading the chat. Withdrawing
    // invalidates every read in flight (`invalidateRecordedCaptures`), as Pause does.
    await f.c.setTrackingConsent({ agreed: false });
    const page = parseHistoryText("claude", claudeHistory, historyConversationId, start.observedAt);
    await assert.rejects(
      async () => f.c.history.receive({ ...start, event: "page", page }, pageBinding, claudeSender),
      /history_unavailable/,
    );
    assert.equal((await f.db.historyPage(f.scope, undefined)).length, 0, "nothing is saved after Turn off tracking");
    assert.equal(await f.rows(), 0);
  } finally {
    f.close();
  }
});

test("consent: a streamed history read that started before the withdrawal is refused after it", async () => {
  const f = await setup();
  const sender = { ...chatgptSender, documentId: "consent-stream-document" };
  const start = {
    channel: HISTORY_CAPTURE_CHANNEL,
    event: "start",
    id: crypto.randomUUID(),
    site: "chatgpt",
    conversationId,
    observedAt: new Date().toISOString(),
    page: null,
  } as any;
  const progress = () =>
    ({
      channel: PROVIDER_STREAM_CHANNEL,
      event: "progress",
      id: start.id,
      site: "chatgpt",
      conversationId,
      observedAt: start.observedAt,
      rows: null,
      meta: null,
    }) as any;
  try {
    await agree(f.c);
    const streamBinding = binding();
    assert.deepEqual(await f.c.history.receive(start, streamBinding, sender), { accepted: true });
    assert.deepEqual(await f.c.history.receiveStream(progress(), streamBinding, sender), { accepted: true });
    await f.c.setTrackingConsent({ agreed: false });
    await assert.rejects(async () => f.c.history.receiveStream(progress(), streamBinding, sender), /history_unavailable/);
    assert.equal((f.c.history as any).pending.size, 0, "the read is dropped, so its end saves nothing");
  } finally {
    f.close();
  }
});

test("consent: an organization policy waiting to be acknowledged is left alone before the agreement", async () => {
  const f = await setup();
  try {
    const pendingPolicy = {
      device_id: crypto.randomUUID(),
      offered_at: Date.now(),
      policy: { policy_version: "2.0.0", pause_mode: "user_controlled" },
    };
    await (f.c.ledger as any).applySessionChanges({ pendingPolicy });
    await f.c.capture(dispatch(), chatgptSender);
    assert.ok(await f.c.ledger.readPendingPolicy(), "a frame before the agreement resolves nothing");
    await agree(f.c);
    await f.c.capture(dispatch(), chatgptSender);
    // Without credentials for that browser the stale offer is dropped, as before the step.
    assert.ok(!(await f.c.ledger.readPendingPolicy()));
  } finally {
    f.close();
  }
});

// Live, 21 Oct 2026: with tracking paused the bar showed Processing for a ChatGPT reply that was
// not recorded. The tab learns about Pause from the tracking state, as it learns about the agreement.
test("consent: the tracking state says whether tracking is paused, and Pause keeps the agreement", async () => {
  const f = await setup();
  try {
    await agree(f.c);
    await f.c.updateSettings({ paused: true });
    assert.deepEqual(await f.c.trackingState(), { consent: "agreed", organization: null, paused: true });
    await f.c.capture(dispatch(), chatgptSender);
    assert.equal(await f.rows(), 0, "nothing is recorded while paused");
    await f.c.updateSettings({ paused: false });
    assert.deepEqual(await f.c.trackingState(), { consent: "agreed", organization: null, paused: false });
    await f.c.capture(dispatch(), chatgptSender);
    assert.ok((await f.rows()) > 0, "resuming records the next reply");
  } finally {
    f.close();
  }
});
