import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Ledger } from "@footprint/ledger";
import { Coordinator } from "../lib/coordinator";
import { initialSnapshot } from "@footprint/adapters";
import { countByTextLength } from "./counting-fixture";
test("S05 revoked AI-site permission blocks new text processing and preserves prior numeric records", async () => {
  const ledger = await Ledger.open("site-revocation-" + crypto.randomUUID());
  let allowed = true,
    countCalls = 0;
  const coordinator = new Coordinator(ledger, {
    hasConsent: async () => true,
    hasSiteConsent: async () => allowed,
    sendDisplay: async () => {},
    count: async (job) => {
      countCalls++;
      return countByTextLength(job);
    },
  });
  const scope = await coordinator.currentScope();
  const sender = {
    tab: { id: 8 },
    frameId: 0,
    documentId: "original",
    url: "https://claude.ai/chat/00000000-0000-4000-8000-000000000001",
  };
  const message: any = { timing: null,
    channel: "ai-footprint-observation-v1",
    version: 1,
    id: crypto.randomUUID(),
    revision: 1,
    event: "dispatch",
    site: "claude",
    at: new Date().toISOString(),
    dispatch: {
      site: "claude",
      action: "send",
      input: "before",
      conversationId: "c",
      parentId: null,
      requestId: "r",
      model: null,
      attachments: 0,
      imageEditParentId: null,
    },
    snapshot: initialSnapshot(),
    failure: null,
  };
  await coordinator.capture(message, sender);
  const rowsBefore = await ledger.rows(scope.namespace);
  allowed = false;
  await assert.rejects(
    coordinator.capture(
      {
        ...message,
        event: "end",
        revision: 2,
        dispatch: null,
        snapshot: {
          ...initialSnapshot(),
          text: "PRIVATE_AFTER_REVOKE",
          started: true,
          state: "completed",
        },
      },
      sender,
    ),
    /capture_hook_missing/,
  );
  assert.equal(countCalls, 1);
  assert.deepEqual(await ledger.rows(scope.namespace), rowsBefore);
  assert.ok(
    (await ledger.list<any>("health", scope.namespace)).some(
      (h) => h.code === "capture_hook_missing",
    ),
  );
  allowed = true;
  await coordinator.capture(
    {
      ...message,
      id: crypto.randomUUID(),
      dispatch: { ...message.dispatch, requestId: "new-granted-request" },
    },
    { ...sender, documentId: "reloaded-after-grant" },
  );
  assert.equal(countCalls, 2);
  ledger.close();
});
