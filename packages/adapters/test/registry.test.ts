import assert from "node:assert/strict";
import test from "node:test";
import {
  PACKAGED_PROVIDER_ADAPTERS,
  createProviderAdapterRegistry,
  type ProviderAdapter,
} from "../src/index";
import type { Site } from "@footprint/capture-core";

const cases: Array<{
  site: Site;
  url: string;
  body: string;
  format: string;
  value: unknown;
}> = [
  {
    site: "claude",
    url: "https://claude.ai/api/organizations/o/chat_conversations/c/completion",
    body: JSON.stringify({ prompt: "input", attachments: [], files: [] }),
    format: "sse",
    value: {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "answer" },
    },
  },
  {
    site: "chatgpt",
    url: "https://chatgpt.com/backend-api/f/conversation",
    body: JSON.stringify({
      messages: [
        {
          id: "request",
          author: { role: "user" },
          content: { parts: ["input"] },
        },
      ],
    }),
    format: "sse",
    value: {
      message: {
        id: "answer",
        author: { role: "assistant" },
        channel: "final",
        recipient: "all",
        content: { content_type: "text", parts: ["answer"] },
        status: "finished_successfully",
        end_turn: true,
      },
    },
  },
  {
    site: "gemini",
    url: "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate",
    body: new URLSearchParams({
      "f.req": JSON.stringify([
        null,
        JSON.stringify([
          ["input"],
          null,
          ["c_0000000000000001", "r_0000000000000001", "rc_0000000000000001"],
        ]),
      ]),
    }).toString(),
    format: "gemini",
    value: [
      [
        "wrb.fr",
        null,
        JSON.stringify([
          null,
          ["c_0000000000000001", "r_0000000000000002"],
          null,
          null,
          [["rc_0000000000000002", ["answer"]]],
        ]),
      ],
    ],
  },
  {
    site: "perplexity",
    url: "https://www.perplexity.ai/rest/sse/perplexity_ask",
    body: JSON.stringify({ query_str: "input", params: { attachments: [] } }),
    format: "sse",
    value: {
      blocks: [
        {
          intended_usage: "workflow_root",
          workflow_block: {
            steps: [
              {
                items: [
                  {
                    id: "answer",
                    type: "WORKFLOW_ITEM_TEXT",
                    variant: "answer",
                    payload: {
                      text_payload: {
                        text: "answer",
                        chunks: [],
                        is_streaming: false,
                      },
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
    },
  },
];

for (const fixture of cases)
  test(`packaged ${fixture.site} entry preserves dispatch, route and session fixtures`, () => {
    const adapter = PACKAGED_PROVIDER_ADAPTERS.get(fixture.site)!;
    const url = new URL(fixture.url);
    assert.equal(adapter.responseFormat, fixture.format);
    assert.equal(adapter.generationRoute(url, "POST"), true);
    assert.equal(adapter.generationRoute(url, "GET"), false);
    assert.equal(
      adapter.generationRoute(new URL("/unrelated", url), "POST"),
      false,
    );
    assert.equal(adapter.parseDispatch(url, fixture.body).input, "input");
    assert.equal(adapter.parseDispatch(url, fixture.body).site, fixture.site);
    const session = adapter.createSession();
    if (fixture.format === "gemini") session.gemini!(fixture.value);
    else
      session.frame!({
        event: "message",
        data: JSON.stringify(fixture.value),
        value: fixture.value,
      });
    assert.equal(session.snapshot().text, "answer");
    session.stopped();
    assert.equal(session.snapshot().state, "cancelled");
    assert.equal(adapter.createSession().snapshot().text, null);
  });

test("registry snapshots entries and rejects duplicate or unsupported provider definitions", () => {
  const entry = { ...PACKAGED_PROVIDER_ADAPTERS.get("claude")! };
  const registry = createProviderAdapterRegistry([entry]);
  assert.ok(Object.isFrozen(registry));
  assert.ok(Object.isFrozen(registry.get("claude")));
  entry.createSession = () => {
    throw new Error("changed after registration");
  };
  assert.equal(registry.get("claude")!.createSession().snapshot().text, null);
  assert.equal(registry.get("gemini"), undefined);
  assert.throws(
    () => createProviderAdapterRegistry([entry, entry]),
    /invalid_provider_adapter/,
  );
  assert.throws(
    () =>
      createProviderAdapterRegistry([
        { ...entry, site: "unreviewed" } as unknown as ProviderAdapter,
      ]),
    /invalid_provider_adapter/,
  );
});
