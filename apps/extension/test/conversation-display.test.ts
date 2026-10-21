import assert from "node:assert/strict";
import test from "node:test";
import {
  hasPendingConversation,
  localConversationPresentation,
  preferSyncedFigures,
} from "../lib/conversation-display";

test("zero pending summaries do not claim that local updates are waiting", () => {
  assert.equal(hasPendingConversation({ requests: 0, attempts: 0 }), false);
  assert.equal(hasPendingConversation({ requests: 0, attempts: 0 }, 1), true);
  assert.equal(hasPendingConversation({ requests: 1, attempts: 1 }, 0), false);
  assert.equal(hasPendingConversation({ requests: "0", attempts: "0" }), false);
  assert.equal(hasPendingConversation({ requests: 0, attempts: 1 }), true);
});

test("offline organization mode shows local figures with no sync wording, and Details says what they cover", () => {
  // Owner, 13 Oct 2026: organization mode is local-first; sync state is not on the bar.
  const value = localConversationPresentation(
    "company",
    { offline: true },
    "Requests 0",
    "Recorded",
  );
  assert.equal(value.text, "Requests 0");
  assert.equal(value.status, "Recorded");
  assert.match(value.explanation, /this browser profile only/);
  assert.match(
    localConversationPresentation("company", null, "Req 1", "").explanation,
    /updated in the background/,
  );
});

const figures = (
  changes: Partial<Parameters<typeof preferSyncedFigures>[0]> = {},
) =>
  preferSyncedFigures({
    localRequests: "2",
    localHistoryRequests: "3",
    syncedRequests: "2",
    syncedHistoryRequests: "3",
    localHistory: true,
    syncedHistory: true,
    pending: false,
    current: true,
    ...changes,
  });

test("organization mode keeps local figures unless the synced copy adds requests and holds every local one", () => {
  // The same records: local wins, so the bar never flips for nothing.
  assert.equal(figures(), false);
  // Another browser of the member added requests: the current synced copy is larger.
  assert.equal(figures({ syncedRequests: "4" }), true);
  assert.equal(figures({ syncedHistoryRequests: "5" }), true);
  // Local updates still waiting to upload are missing from the synced copy.
  assert.equal(figures({ syncedRequests: "4", pending: true }), false);
  // An emptier or smaller copy never replaces local figures.
  assert.equal(figures({ syncedRequests: "0", syncedHistoryRequests: "0" }), false);
  // A cached or offline copy is older, so it replaces nothing this browser has.
  assert.equal(figures({ syncedRequests: "4", current: false }), false);
  // ...unless this browser has no request at all for the chat: the bar never shows zero
  // instead of the member's synced requests.
  assert.equal(
    figures({
      localRequests: "0",
      localHistory: false,
      syncedRequests: "4",
      current: false,
      pending: true,
    }),
    true,
  );
  assert.equal(
    figures({ localRequests: "0", localHistory: false, syncedRequests: "0", syncedHistory: false }),
    false,
  );
  assert.equal(figures({ localRequests: null }), false);
});

test("an imported chat the server has no history for keeps its local figures after connecting", () => {
  // Live, 13 Oct 2026: the bar showed Req 0 and Unknown from the server's empty snapshot.
  assert.equal(
    figures({
      localRequests: "0",
      localHistoryRequests: "6",
      syncedRequests: "1",
      syncedHistory: false,
      syncedHistoryRequests: "0",
    }),
    false,
  );
});
