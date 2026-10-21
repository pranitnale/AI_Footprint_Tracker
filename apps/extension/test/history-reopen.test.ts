import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { Ledger } from "@footprint/ledger";
import type { CountRequest } from "@footprint/tokenizers";
import { Coordinator } from "../lib/coordinator";
import { createHistoryTextObserver } from "../lib/passive-history-text";
import { countByTextLength } from "./counting-fixture";

const id = "00000000-0000-4000-8000-000000000042";
const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../../../fixtures/history-observation-2026-09-14/${name}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const sites = {
  claude: {
    origin: "https://claude.ai",
    path: `/chat/${id}`,
    request: `https://claude.ai/api/organizations/00000000-0000-4000-8000-000000000011/chat_conversations/${id}?tree=True`,
    conversationId: id,
  },
  chatgpt: {
    origin: "https://chatgpt.com",
    path: `/c/${id}`,
    request: `https://chatgpt.com/backend-api/conversations/${id}`,
    conversationId: id,
  },
  perplexity: {
    origin: "https://www.perplexity.ai",
    path: `/search/${id}`,
    request: `https://www.perplexity.ai/rest/thread/${id}`,
    conversationId: id,
  },
  gemini: {
    origin: "https://gemini.google.com",
    path: "/app/0000000000000042",
    request: "https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=hNvQHb",
    conversationId: "c_0000000000000042",
  },
} as const;
type Site = keyof typeof sites;

async function setup(t: TestContext, site: Site = "claude") {
  const target = sites[site];
  Object.assign(globalThis, {
    location: {
      origin: target.origin,
      hostname: new URL(target.origin).hostname,
      pathname: target.path,
      href: target.origin + target.path,
    },
  });
  let calls = 0;
  const db = await Ledger.open(`history-reopen-${site}-${crypto.randomUUID()}`);
  const coordinator = new Coordinator(db, {
    count: async (job: CountRequest) => {
      calls++;
      return countByTextLength(job);
    },
    hasConsent: async () => true,
    hasSiteConsent: async () => true,
    sendDisplay: async () => {},
    transport: async () => {
      throw new Error("unexpected network");
    },
  });
  t.after(() => {
    coordinator.history.invalidate();
    coordinator.engines.dispose();
    db.close();
  });
  await coordinator.whenReady();
  const binding = {
    documentNonce: crypto.randomUUID(),
    navigationNonce: crypto.randomUUID(),
    captureId: null,
  };
  const sender = {
    tab: { id: 801 },
    frameId: 0,
    documentId: `synthetic-reopen-${site}`,
    url: target.origin + target.path,
  };
  const scope = await coordinator.currentScope();
  const reopen = async (body: string, beforeCommit?: () => Promise<void>) => {
    let started: Promise<unknown> = Promise.resolve();
    let finish!: (accepted: boolean) => void;
    const finished = new Promise<boolean>((resolve) => (finish = resolve));
    const history = coordinator.history as any;
    const commit = history.ledger.commitHistory.bind(history.ledger);
    history.ledger.commitHistory = async (...args: any[]) => {
      await commit(...args);
      await beforeCommit?.();
    };
    const observer = createHistoryTextObserver(
      (event) => {
        if (event.event === "start")
          started = coordinator.history.receive(event, binding, sender);
      },
      () => {},
      async (event) => {
        await started;
        const result = await coordinator.history.receiveStream(event, binding, sender);
        if (event.event === "finish") finish(result.accepted);
        return result.accepted;
      },
    );
    const before = calls;
    try {
      observer.observe(
        new URL(target.request),
        site === "gemini" ? "POST" : "GET",
        Promise.resolve(new Response(body)),
        Date.now(),
        site === "gemini"
          ? new URLSearchParams({
              "f.req": JSON.stringify([
                [
                  [
                    "hNvQHb",
                    JSON.stringify(fixture("gemini-selected-history").request_arguments),
                    null,
                    "generic",
                  ],
                ],
              ]),
            }).toString()
          : undefined,
      );
      assert.equal(await finished, true);
    } finally {
      observer.cancel();
      history.ledger.commitHistory = commit;
    }
    await coordinator.engines.maintainLocal();
    return calls - before;
  };
  const version = async () =>
    (await db.application.summaryVersion(scope.namespace)).version;
  const rows = async () =>
    (await db.all<any>("history_records")).sort((a, b) =>
      a.key < b.key ? -1 : 1,
    );
  const coverage = () => db.all<any>("history_coverage");
  return { coordinator, db, scope, binding, reopen, version, rows, coverage };
}

function claudeBody(count: number, change: (message: any, index: number) => void = () => {}) {
  const source = fixture("claude-selected-history");
  const template = source.chat_messages[0];
  source.chat_messages = Array.from({ length: count }, (_, index) => {
    const message = {
      ...template,
      uuid: uuid(index + 1),
      parent_message_uuid: index ? uuid(index) : "00000000-0000-4000-8000-000000000000",
      index,
      sender: index % 2 ? "assistant" : "human",
      stop_reason: "end_turn",
      truncated: false,
      content: [{ type: "text", text: `synthetic countable text ${index} `.repeat(4) }],
      attachments: [],
    };
    change(message, index);
    return message;
  });
  source.current_leaf_message_uuid = source.chat_messages.at(-1).uuid;
  return source;
}

test("an unchanged multi-batch reimport reuses every count and leaves coverage and the summary version alone", async (t) => {
  const f = await setup(t);
  const body = JSON.stringify(claudeBody(220));
  assert.equal(await f.reopen(body), 220);
  const saved = await f.rows();
  assert.equal(saved.length, 220);
  assert.ok(saved.every((row) => row.countBasis?.units > 0));
  assert.equal(
    JSON.stringify(saved).includes("synthetic countable text"),
    false,
    "the count basis holds lengths, never text",
  );
  const coverage = await f.coverage();
  const version = await f.version();
  assert.equal(await f.reopen(body), 0, "unchanged messages are not counted again");
  assert.equal(await f.version(), version);
  assert.deepEqual(await f.coverage(), coverage);
  assert.deepEqual(await f.rows(), saved, "nothing is rewritten");
  const view = await f.coordinator.routeSummary("claude", id, f.binding);
  assert.equal(view.history.local.prompt_count, "110");
  assert.equal(view.history.local.first_request_verified, true);
});

test("rows saved before count reuse gain a basis once, then stop being counted", async (t) => {
  const f = await setup(t);
  const body = JSON.stringify(claudeBody(6));
  // Model rows written by the earlier release, which had no count basis.
  const history = f.coordinator.history as any;
  const basis = history.countBasis.bind(history);
  history.countBasis = () => null;
  assert.equal(await f.reopen(body), 6);
  assert.ok((await f.rows()).every((row) => row.countBasis === undefined));
  history.countBasis = basis;
  const version = await f.version();
  assert.equal(await f.reopen(body), 6);
  assert.ok((await f.rows()).every((row) => row.countBasis?.units > 0));
  assert.equal(await f.version(), version, "adding a basis is not a usage change");
  assert.equal(await f.reopen(body), 0);
});

// A refused commit never finishes the read, so the time limit turns a hang into a failure.
test("a saved reply past the earlier 262,144-unit basis bound is committed with its basis and reused", { timeout: 60_000 }, async (t) => {
  const f = await setup(t);
  // Within the history limits since 14 Oct 2026 (2,097,152 units per field).
  const body = JSON.stringify(
    claudeBody(2, (message, index) => {
      if (index === 1)
        message.content = [
          { type: "thinking", thinking: "r".repeat(600_000) },
          { type: "text", text: "a".repeat(1_000_000) },
        ];
    }),
  );
  assert.equal(await f.reopen(body), 2);
  const reply = (await f.rows()).find((row) => row.record.role === "response");
  assert.equal(reply.countBasis.units, 1_000_000);
  assert.equal(reply.countBasis.partUnits.visible_thinking, 600_000);
  // The reply's total holds its answer and its reasoning.
  assert.equal(reply.record.tokens.value, "1600000");
  assert.equal(await f.reopen(body), 0, "the saved basis is reused");
});

test("changed length, unfinished text and a new counting runtime are counted again", async (t) => {
  const f = await setup(t);
  assert.equal(await f.reopen(JSON.stringify(claudeBody(8))), 8);
  const edited = claudeBody(8, (message, index) => {
    if (index === 3) message.content[0].text += " longer";
    if (index === 5) message.truncated = true;
  });
  assert.equal(await f.reopen(JSON.stringify(edited)), 2);
  const history = f.coordinator.history as any;
  const runtime = history.countRuntime.bind(history);
  history.countRuntime = () => ({ ...runtime(), assetHash: "0".repeat(64) });
  assert.equal(await f.reopen(JSON.stringify(edited)), 8);
});

test("an edited branch imported over several batches adds its requests without a partial total", async (t) => {
  const f = await setup(t);
  assert.equal(await f.reopen(JSON.stringify(claudeBody(220))), 220);
  const prompts = async () =>
    (await f.coordinator.routeSummary("claude", id, f.binding)).history.local.prompt_count;
  assert.equal(await prompts(), "110");
  // The user edited message 100, so a new 20-message branch replaces 101 to 220 on screen.
  const branched = claudeBody(220);
  for (let index = 0; index < 20; index++)
    branched.chat_messages.push({
      ...branched.chat_messages[100 + index],
      uuid: uuid(1000 + index),
      parent_message_uuid: index ? uuid(1000 + index - 1) : uuid(100),
      index: 100 + index,
      content: [{ type: "text", text: `edited branch text ${index}` }],
    });
  branched.current_leaf_message_uuid = uuid(1019);
  const seen: string[] = [];
  await f.reopen(JSON.stringify(branched), async () => {
    seen.push(await prompts());
  });
  // Every branch counts (owner rule): the 10 prompts of the edited branch are added to the
  // 110 of the replaced one. Readers see the old total until the import lands, never a part.
  assert.ok(seen.length > 1, "the import ran in several batches");
  assert.ok(seen.every((value) => value === "110" || value === "120"), `seen ${seen}`);
  assert.equal(seen.at(-1), "120");
  assert.equal(await prompts(), "120");
});

for (const site of ["chatgpt", "perplexity", "gemini"] as const)
  test(`${site}: an unchanged reimport counts only messages without a reusable count`, async (t) => {
    const f = await setup(t, site);
    const body =
      site === "chatgpt"
        ? JSON.stringify(fixture("chatgpt-flat-page"))
        : site === "perplexity"
          ? JSON.stringify(fixture("perplexity-workflow-page"))
          : readFileSync(
              new URL(
                "../../../fixtures/history-observation-2026-09-14/gemini-history-wire.txt",
                import.meta.url,
              ),
              "utf8",
            );
    const first = await f.reopen(body);
    assert.ok(first > 0);
    const saved = await f.rows();
    const withoutBasis = saved.filter((row) => !row.countBasis).length;
    assert.ok(withoutBasis < saved.length, "finished messages keep a basis");
    const version = await f.version();
    // A message without text is never counted, so it needs no basis either.
    assert.ok((await f.reopen(body)) <= withoutBasis);
    assert.equal(await f.version(), version);
    assert.deepEqual(await f.rows(), saved);
  });
