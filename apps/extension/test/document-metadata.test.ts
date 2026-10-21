import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Ledger } from "@footprint/ledger";
import { countWithBundledTokenizer } from "./counting-fixture";
import { initialSnapshot, parseDispatch } from "@footprint/adapters";
import { Coordinator } from "../lib/coordinator";
import { scanSummary } from "../lib/summary-scan";
import { validateCapture } from "../lib/bridge";
const attachment = JSON.parse(
  readFileSync(
    new URL(
      "../../../fixtures/provider-uploads-2026-09-10.json",
      import.meta.url,
    ),
    "utf8",
  ),
).chatgpt.generation.attachment;
const sender = {
  tab: { id: 7 },
  frameId: 0,
  documentId: "synthetic-document",
  url: "https://chatgpt.com/",
};
function message(withFile = true, opaque = false): any {
  const dispatch = parseDispatch(
    "chatgpt",
    new URL("https://chatgpt.com/backend-api/f/conversation"),
    JSON.stringify({
      action: "next",
      messages: [
        {
          id: crypto.randomUUID(),
          author: { role: "user" },
          content: {
            parts: [
              "ordinary text",
              ...(opaque ? [{ unobserved_schema: true }] : []),
            ],
          },
          metadata: { attachments: withFile ? [attachment] : [] },
        },
      ],
    }),
  );
  return {
    channel: "ai-footprint-observation-v1",
    version: 1,
    id: crypto.randomUUID(),
    revision: 1,
    event: "dispatch",
    site: "chatgpt",
    at: new Date().toISOString(),
    dispatch,
    snapshot: initialSnapshot(),
    failure: null,

    timing: null,
  };
}
async function setup() {
  const name = "metadata-" + crypto.randomUUID(),
    db = await Ledger.open(name);
  const dependencies = {
    count: countWithBundledTokenizer,
    hasConsent: async () => true,
    sendDisplay: async () => {},
    transport: (async () => {
      throw new Error("unexpected_network");
    }) as typeof fetch,
  };
  const c = new Coordinator(db, dependencies);
  const scope = await c.currentScope();
  return { name, db, c, scope, dependencies };
}
const request = async (f: Awaited<ReturnType<typeof setup>>) =>
  (await f.db.rows(f.scope.namespace)).find(
    (row) => row.record.kind === "request",
  )!.record as any;

test("ChatGPT metadata presence survives unknown cardinality without claiming fresh uploads or changing token/resource totals", async () => {
  const baseline = await setup();
  try {
    await baseline.c.capture(message(false), sender);
    const original = await scanSummary(baseline.db, baseline.scope.namespace);
    for (const opaque of [false, true]) {
      const f = await setup();
      try {
        const input = message(true, opaque);
        await f.c.capture(input, sender);
        const r = await request(f);
        assert.equal(input.dispatch.attachments, opaque ? null : 1);
        assert.ok(r.features.includes("document"));
        assert.deepEqual(r.documents.types, ["unknown"]);
        assert.equal(r.documents.upload_count, null);
        assert.equal(r.documents.processing, "unknown");
        assert.equal(r.documents.extracted_text, null);
        const result = await scanSummary(f.db, f.scope.namespace);
        assert.deepEqual(result.tokens, original.tokens);
        assert.deepEqual(result.metrics, original.metrics);
        const stored = JSON.stringify(
          await Promise.all(
            ["requests", "attempts", "provider_key_map", "outbox"].map(
              (store) => f.db.all(store as any),
            ),
          ),
        );
        for (const raw of [
          attachment.id,
          attachment.name,
          attachment.library_file_id,
        ])
          assert.ok(!stored.includes(raw));
      } finally {
        f.db.close();
      }
    }
  } finally {
    baseline.db.close();
  }
});
test("new captures across providers keep fresh-upload and retained-processing state unknown for zero, positive and unknown references", async () => {
  const cases = [
    ["chatgpt", "https://chatgpt.com/"],
    ["claude", "https://claude.ai/new"],
    ["gemini", "https://gemini.google.com/app"],
    ["perplexity", "https://www.perplexity.ai/"],
  ] as const;
  for (const [site, url] of cases)
    for (const count of [null, 0, 2]) {
      const f = await setup();
      try {
        const input = message(false);
        input.site = site;
        input.dispatch.site = site;
        input.dispatch.attachments = count;
        await f.c.capture(input, { ...sender, url });
        const r = await request(f);
        assert.equal(r.documents.upload_count, null, `${site}/${count}`);
        assert.equal(r.documents.processing, "unknown");
        assert.equal(r.features.includes("document"), count === 2);
      } finally {
        f.db.close();
      }
    }
});
test("historical document metadata survives restart and later capture progress unchanged", async () => {
  const f = await setup();
  try {
    const input = message();
    await f.c.capture(input, sender);
    const old = await request(f),
      historical = {
        ...old,
        revision: old.revision + 1,
        documents: {
          ...old.documents,
          upload_count: "7",
          processing: "opaque",
        },
      };
    await f.db.write(f.scope, historical);
    const job = (await f.db.all<any>("provider_key_map"))[0];
    await f.db.put("provider_key_map", { ...job, request: historical });
    f.db.close();
    f.db = await Ledger.open(f.name);
    f.c = new Coordinator(f.db, f.dependencies);
    await f.c.whenReady();
    await f.c.capture(
      {
        ...input,
        revision: 2,
        event: "end",
        dispatch: null,
        snapshot: {
          ...initialSnapshot(),
          text: "reply",
          started: true,
          state: "completed",
        },
      },
      sender,
    );
    assert.deepEqual((await request(f)).documents, historical.documents);
  } finally {
    f.db.close();
  }
});
test("attachmentPresence is a strict ChatGPT-only positive signal and ordinary dispatch remains accepted", () => {
  const input = message();
  assert.equal(validateCapture(input, "chatgpt.com"), true);
  for (const value of [false, null, "true", 1])
    assert.equal(
      validateCapture(
        {
          ...input,
          dispatch: { ...input.dispatch, attachmentPresence: value },
        },
        "chatgpt.com",
      ),
      false,
    );
  assert.equal(
    validateCapture(
      {
        ...input,
        site: "claude",
        dispatch: { ...input.dispatch, site: "claude" },
      },
      "claude.ai",
    ),
    false,
  );
  delete input.dispatch.attachmentPresence;
  assert.equal(validateCapture(input, "chatgpt.com"), true);
});

test("contradictory positive presence with zero references is rejected before any observation or document category is written", async () => {
  const f = await setup();
  try {
    const input = message();
    input.dispatch.attachments = 0;
    assert.equal(validateCapture(input, "chatgpt.com"), false);
    await assert.rejects(f.c.capture(input, sender), /payload_rejected/);
    assert.equal((await f.db.rows(f.scope.namespace)).length, 0);
    assert.equal((await f.db.all("provider_key_map")).length, 0);
    assert.equal((await f.db.all("outbox")).length, 0);
  } finally {
    f.db.close();
  }
});
