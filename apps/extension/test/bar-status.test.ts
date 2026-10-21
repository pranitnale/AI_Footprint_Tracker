import { dom } from "./dom-env";
import assert from "node:assert/strict";
import test from "node:test";
import {
  BAR_NO_FIGURES,
  BAR_PROCESSING,
  BAR_SET_UP,
  BAR_TRACKING_OFF,
  BAR_WAITING,
  barStateText,
  barStatusParts,
  detailsStatusText,
  notebookGuideOnly,
  setBarStatus,
  trackingProblemAction,
  type PageHealthIssue,
} from "../lib/conversation-bar";
import { detailsStatusGroups, detailsStatuses, progressText } from "../lib/details-overview";

function bar() {
  const root = dom.window.document.createElement("div");
  root.innerHTML = '<span data-status></span>';
  return { root, label: root.querySelector<HTMLElement>("[data-status]")! };
}

function issue(overrides: Partial<PageHealthIssue> = {}): PageHealthIssue {
  return {
    code: "capture_hook_missing",
    context: "capture",
    active: true,
    firstAt: 1,
    lastAt: 1,
    count: 1,
    ...overrides,
  };
}

test("sync wording never reaches the bar and Details still receives it", () => {
  // Owner, 13 Oct 2026: sync state is a Details icon, never a bar status.
  const { root, label } = bar();
  setBarStatus("This browser only", root);
  assert.equal(label.textContent, "");
  assert.equal(detailsStatusText(label), "This browser only");

  setBarStatus("Processing · This browser only · Waiting to sync", root);
  assert.equal(label.textContent, "");
  assert.equal(
    detailsStatusText(label),
    "This browser only · Waiting to sync · Processing",
  );
});

test("a later status without the note clears it from Details", () => {
  const { root, label } = bar();
  setBarStatus("This browser only", root);
  setBarStatus("Reload required", root);
  assert.equal(label.textContent, "");
  assert.equal(detailsStatusText(label), "Reload required (reload page)");
});

// Owner, 14 Oct 2026: the bar shows only figures and the Details control. Every status is
// kept for Details: actions first, the rest under "not counted", progress at the bottom.
const REMOVED_FROM_BAR = [
  "Processing",
  "Recorded",
  "Updating",
  "Loading earlier messages",
  "Calculating earlier messages",
  "Loading conversation totals",
  "History not loaded",
  "Partially loaded",
  "Reload required",
  "Site access removed",
  "Tracking problem",
  "History update problem",
  "History calculation unavailable",
  "Conversation totals unavailable",
  "Saved totals refresh problem",
  "Matching incomplete",
  "Earlier activity unavailable",
  "History too large",
  "Synced matching unavailable",
  "History match unavailable",
  "Recorded match changed",
];

test("no status is shown on the bar, and every one but Recorded reaches Details", () => {
  const { root, label } = bar();
  for (const status of REMOVED_FROM_BAR) {
    setBarStatus(status, root, { site: "chatgpt", trackingAction: "reload page" });
    assert.equal(label.textContent, "", status);
    if (status === "Recorded")
      assert.equal(detailsStatusText(label), "", "the ordinary state is not a status");
    else assert.match(detailsStatusText(label), new RegExp(`^${status}`), status);
  }
});

test("statuses the person can act on open Details with the action in brackets", () => {
  assert.deepEqual(barStatusParts("History not loaded"), {
    actionable: "History not loaded (reload page)",
    details: "",
    progress: [],
  });
  assert.equal(
    barStatusParts("Site access removed").actionable,
    "Site access removed (allow access)",
  );
  assert.equal(
    barStatusParts("Conversation totals unavailable").actionable,
    "Conversation totals unavailable (retry)",
  );
  assert.deepEqual(barStatusParts("Processing · History update problem"), {
    actionable: "History update problem (reload page)",
    details: "",
    progress: ["Processing"],
  });
  // Neighbours with the same action name it once.
  assert.equal(
    barStatusParts("Tracking problem · Saved totals refresh problem", {
      trackingAction: "retry",
    }).actionable,
    "Tracking problem · Saved totals refresh problem (retry)",
  );
});

test("progress goes to the bottom line and the rest to the not-counted section", () => {
  const parts = barStatusParts(
    "Processing · Matching incomplete · Earlier activity unavailable · Updating · History too large · Synced matching unavailable · History match unavailable · Recorded match changed · Loading conversation totals · Recorded",
  );
  assert.equal(parts.actionable, "");
  assert.deepEqual(parts.progress, ["Processing", "Updating", "Loading conversation totals"]);
  assert.equal(
    parts.details,
    "Matching incomplete · Earlier activity unavailable · History too large · Synced matching unavailable · History match unavailable · Recorded match changed",
  );
  // A tracking problem with no fix the person can make has no action.
  assert.deepEqual(barStatusParts("Tracking problem"), {
    actionable: "",
    details: "Tracking problem",
    progress: [],
  });
  assert.equal(
    barStatusParts("Tracking problem", { trackingAction: "reload page" }).actionable,
    "Tracking problem (reload page)",
  );
});

test("every status removed from the bar has words in Details", () => {
  for (const status of REMOVED_FROM_BAR) {
    if (status === "Recorded") continue;
    const parts = barStatusParts(status, {
      site: "chatgpt",
      trackingAction: "reload page",
    });
    const shown = [
      ...detailsStatuses(parts.actionable),
      ...detailsStatuses(parts.details),
    ];
    assert.ok(
      shown.length || progressText(parts.progress),
      `${status} reaches Details`,
    );
  }
});

test("Partially loaded has no action on any site and is listed with what could not be counted", () => {
  // The tracker reads the missing pages itself, so scrolling is no longer the fix, and Details
  // has no scroll button or hint to offer.
  for (const site of ["chatgpt", "claude", "gemini", "perplexity", "notebooklm"]) {
    assert.deepEqual(barStatusParts("Partially loaded", { site }), {
      actionable: "",
      details: "Partially loaded",
      progress: [],
    });
    assert.deepEqual(
      detailsStatusGroups("", barStatusParts("Partially loaded", { site }).details).notCounted.map((s) => s.chip),
      ["Some earlier messages missing"],
    );
  }
});

test("a tracking problem offers the action its current causes allow", () => {
  assert.equal(trackingProblemAction([issue()]), "reload page");
  assert.equal(
    trackingProblemAction([issue({ code: "storage_write_failed" })]),
    "free browser storage",
  );
  assert.equal(
    trackingProblemAction([
      issue({ code: "site_access_removed", context: "permission" }),
      issue(),
    ]),
    "allow access",
  );
  assert.equal(
    trackingProblemAction(
      [issue({ code: "conversation_summary_unavailable", context: "saved_totals" })],
      true,
    ),
    "retry",
  );
  // Causes whose only advice is to check tracking health have no fix on the page.
  assert.equal(
    trackingProblemAction([
      issue({ code: "policy_unavailable", context: "status" }),
      issue({ code: "ledger_integrity_failed" }),
      issue({ code: "partial_capture" as any }),
    ]),
    null,
  );
  // Earlier problems that have cleared offer nothing.
  assert.equal(trackingProblemAction([issue({ active: false })]), null);
});

test("before figures the bar shows one short state, never the figure labels (owner, 14 Oct 2026, afternoon)", () => {
  assert.equal(BAR_WAITING, "Waiting for your request");
  assert.equal(BAR_PROCESSING, "Processing");
  assert.equal(BAR_NO_FIGURES, "No figures yet");
  assert.equal(barStateText({ working: false, started: false }), BAR_WAITING);
  // Work in progress wins, also in a chat that already has messages.
  assert.equal(barStateText({ working: true, started: false }), BAR_PROCESSING);
  assert.equal(barStateText({ working: true, started: true }), BAR_PROCESSING);
  // Messages that could not be counted, with nothing pending any more.
  assert.equal(barStateText({ working: false, started: true }), BAR_NO_FIGURES);
  for (const text of [BAR_WAITING, BAR_PROCESSING, BAR_NO_FIGURES])
    assert.doesNotMatch(text, /Req|\u2026|\u2014/);
});

test("before the person agrees the bar shows only Tracking is off with Set up (owner exception, 18 Oct 2026)", () => {
  assert.equal(BAR_TRACKING_OFF, "Tracking is off");
  assert.equal(BAR_SET_UP, "Set up");
  // It is not one of the states before figures: barStateText never gives it, so it cannot
  // appear once the person agreed.
  for (const working of [false, true])
    for (const started of [false, true])
      assert.notEqual(barStateText({ working, started }), BAR_TRACKING_OFF);
  assert.doesNotMatch(BAR_TRACKING_OFF, /Req|\u2026|\u2014|\(/);
});

test("a NotebookLM notebook whose only counted work is its guide shows the guide's figures (owner, 16 Oct 2026)", () => {
  // Local totals count requests and attempts as numbers, synced totals as text.
  assert.equal(notebookGuideOnly("notebooklm", { requests: 0, attempts: 2 }, "180"), true);
  assert.equal(
    notebookGuideOnly("notebooklm", { request_count: "0", attempt_count: "1" }, "180"),
    true,
  );
  // An unknown Out is still a counted guide; one that wrote nothing is not.
  assert.equal(notebookGuideOnly("notebooklm", { requests: 0, attempts: 1 }, null), true);
  assert.equal(notebookGuideOnly("notebooklm", { requests: 0, attempts: 1 }, "0"), false);
  // Nothing counted, or a request counted: the ordinary rules apply.
  assert.equal(notebookGuideOnly("notebooklm", { requests: 0, attempts: 0 }, null), false);
  assert.equal(notebookGuideOnly("notebooklm", { requests: 1, attempts: 2 }, "180"), false);
  assert.equal(notebookGuideOnly("notebooklm", {}, "180"), false);
  assert.equal(notebookGuideOnly("notebooklm", null, "180"), false);
  // Other sites keep figures for counted requests only (read aloud alone stays Waiting).
  for (const site of ["chatgpt", "claude", "gemini", "perplexity", null])
    assert.equal(notebookGuideOnly(site, { requests: 0, attempts: 1 }, "180"), false);
});
