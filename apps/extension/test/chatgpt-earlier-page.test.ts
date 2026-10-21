import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { Ledger } from "@footprint/ledger";
import type { HistoryMessage } from "@footprint/contracts";
import { parseHistoryText } from "@footprint/adapters";
import { ProviderHistoryStream } from "../lib/provider-history-stream";
import { createHistoryTextObserver } from "../lib/passive-history-text";
import {
  chatgptEarlierPage,
  historyReadKind,
  historyRequestConversation,
} from "../lib/history-route";
import { Coordinator } from "../lib/coordinator";
import { countByTextLength } from "./counting-fixture";

// ChatGPT loads a chat's newest turns first and earlier turns, before the first message it
// shows, when the user scrolls up (seen 5 Oct 2026):
// GET /backend-api/conversations/<id>/messages?before=<first shown message>&num_turns=10.
// That body holds only messages, page_info and link lists: no chat id, no selected message
// and no truncation field. The page starts at the hidden system message and has no
// earlier page.
const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const conversation = uid(77);
const observedAt = "2026-10-05T12:00:00.000Z";
const row = (n: number, role: string, options: any = {}) => ({
  id: uid(n),
  author: { role },
  create_time: 1767261600 + n,
  update_time: role === "assistant" ? 1767261600 + n + 0.5 : null,
  content: {
    content_type: "text",
    parts: [role === "system" ? "" : `Synthetic ${role} ${n}`],
  },
  status: "finished_successfully",
  end_turn: role === "assistant" ? true : null,
  weight: 1,
  metadata: {
    request_id: uid(9000 + Math.ceil(n / 2)),
    ...(role === "system"
      ? { is_visually_hidden_from_conversation: true }
      : {}),
    ...(role === "assistant"
      ? {
          is_complete: true,
          model_slug: "gpt-5-6",
          resolved_model_slug: "gpt-5-6",
        }
      : {}),
    ...options,
  },
  recipient: "all",
  channel: role === "assistant" ? "final" : null,
});
const earlierRows = () => [
  row(1, "system"),
  row(2, "user"),
  row(3, "assistant"),
];
const newestRows = () => [
  row(4, "user"),
  row(5, "assistant"),
  row(6, "user"),
  row(7, "assistant"),
];
const page = (rows: any[], previous: boolean, next: boolean) => ({
  start_cursor: rows[0].id,
  end_cursor: rows.at(-1).id,
  has_previous_page: previous,
  has_next_page: next,
});
const newest = () => {
  const messages = newestRows();
  return {
    conversation_id: conversation,
    conversation_origin: null,
    messages,
    current_node: messages.at(-1)!.id,
    page_info: page(messages, true, false),
    context_truncation_continuation: null,
  };
};
const earlier = () => {
  const messages = earlierRows();
  return {
    messages,
    safe_urls: [],
    blocked_urls: [],
    page_info: page(messages, false, true),
  };
};
const newestUrl = new URL(
  `https://chatgpt.com/backend-api/conversations/${conversation}?num_turns=10&include_has_versions=true`,
);
const earlierUrl = new URL(
  `https://chatgpt.com/backend-api/conversations/${conversation}/messages?before=${uid(4)}&num_turns=10&include_has_versions=true`,
);

test("an earlier ChatGPT page is a history read of its chat, one waiting read per page", () => {
  assert.equal(
    historyRequestConversation("chatgpt", earlierUrl, "GET"),
    conversation,
  );
  assert.equal(
    historyRequestConversation("chatgpt", newestUrl, "GET"),
    conversation,
  );
  assert.equal(chatgptEarlierPage(earlierUrl), true);
  assert.equal(chatgptEarlierPage(newestUrl), false);
  assert.equal(historyReadKind("chatgpt", earlierUrl), "before:" + uid(4));
  assert.equal(historyReadKind("chatgpt", newestUrl), "");
  for (const href of [
    `https://chatgpt.com/backend-api/conversations/${conversation}/messages`,
    `https://chatgpt.com/backend-api/conversations/${conversation}/messages?before=x`,
    `https://chatgpt.com/backend-api/conversations/${conversation}/messages?before=${uid(4)}&before=${uid(5)}`,
    `https://chatgpt.com/backend-api/conversations/${conversation}/other?before=${uid(4)}`,
    `https://chatgpt.com/backend-api/conversations/${conversation}/messages/extra?before=${uid(4)}`,
  ]) {
    assert.equal(
      historyRequestConversation("chatgpt", new URL(href), "GET"),
      null,
      href,
    );
    assert.equal(chatgptEarlierPage(new URL(href)), false, href);
  }
  assert.equal(historyRequestConversation("chatgpt", earlierUrl, "POST"), null);
});

async function stream(body: unknown, earlierPage: boolean) {
  const rows: any[] = [];
  const parser = new ProviderHistoryStream(
    "chatgpt",
    conversation,
    observedAt,
    async (batch) => {
      rows.push(...batch);
    },
    undefined,
    earlierPage,
  );
  await parser.write(new TextEncoder().encode(JSON.stringify(body)));
  const meta = await parser.finish();
  return { rows, meta };
}

test("both ChatGPT readers prove an earlier page's first request only at the chat's start", async () => {
  const both = async (body: any, expected: boolean) => {
    const { meta } = await stream(body, true);
    const adapter = parseHistoryText(
      "chatgpt",
      body,
      conversation,
      observedAt,
      undefined,
      [],
      true,
    );
    assert.equal(meta.firstRequestVerified, expected);
    assert.equal(adapter.firstRequestVerified, expected);
    return { meta, adapter };
  };
  const { meta, adapter } = await both(earlier(), true);
  assert.equal(meta.rootSourceId, uid(2));
  assert.equal(adapter.rootSourceId, uid(2));
  assert.equal(meta.hasEarlier, false);
  assert.equal(meta.hasLater, true);
  assert.equal(meta.selectedLeafId, null);
  assert.equal(meta.messageCount, 2);
  for (const mutate of [
    // Not the chat's start.
    (v: any) => (v.page_info.has_previous_page = true),
    // The cursor still names the system message the page no longer starts with.
    (v: any) => v.messages.shift(),
    (v: any) => (v.page_info.start_cursor = v.messages[1].id),
    (v: any) => (v.page_info.end_cursor = v.messages[1].id),
    // An earlier page always has a later one.
    (v: any) => (v.page_info.has_next_page = false),
    (v: any) => (v.context_truncation_continuation = null),
  ]) {
    const body = earlier();
    mutate(body);
    await both(body, false);
  }
  // A body that names a chat or a selected message is not an earlier page.
  for (const extra of [
    { conversation_id: conversation },
    { current_node: uid(3) },
  ]) {
    await assert.rejects(
      stream({ ...earlier(), ...extra }, true),
      /history_unsupported/,
    );
    assert.equal(
      parseHistoryText(
        "chatgpt",
        { ...earlier(), ...extra },
        conversation,
        observedAt,
        undefined,
        [],
        true,
      ).status,
      "unsupported",
    );
  }
  // Read as the chat's newest page, the earlier page names no chat and is refused.
  await assert.rejects(stream(earlier(), false), /history_unsupported/);
  // The newest page stays as it was: it starts later, so it proves nothing.
  const latest = await stream(newest(), false);
  assert.equal(latest.meta.firstRequestVerified, false);
  assert.equal(latest.meta.hasEarlier, true);
  await assert.rejects(stream(newest(), true), /history_unsupported/);
});

// Since October 2026 ChatGPT saves the hidden system message right after the first prompt
// instead of before it (seen live 12 Oct 2026 on a 12-turn test chat's newest and earliest
// pages). Pages in the middle of a chat start at a prompt with no system message after it.
test("both ChatGPT readers prove a chat's start when the hidden system message follows the first prompt", async () => {
  const both = async (body: any, earlierPage: boolean, expected: boolean) => {
    const { meta } = await stream(body, earlierPage);
    const adapter = parseHistoryText(
      "chatgpt",
      body,
      conversation,
      observedAt,
      undefined,
      [],
      earlierPage,
    );
    assert.equal(meta.firstRequestVerified, expected);
    assert.equal(adapter.firstRequestVerified, expected);
    return { meta, adapter };
  };
  const october = () => {
    const body: any = earlier();
    body.messages = [row(2, "user"), row(1, "system"), row(3, "assistant")];
    body.page_info = page(body.messages, false, true);
    return body;
  };
  const only = () => {
    const messages = [row(2, "user"), row(1, "system"), row(3, "assistant")];
    return {
      conversation_id: conversation,
      conversation_origin: null,
      messages,
      current_node: messages.at(-1)!.id,
      page_info: page(messages, false, false),
      context_truncation_continuation: null,
    };
  };
  for (const [make, earlierPage] of [
    [october, true],
    [only, false],
  ] as const) {
    const { meta, adapter } = await both(make(), earlierPage, true);
    assert.equal(meta.rootSourceId, uid(2));
    assert.equal(adapter.rootSourceId, uid(2));
    for (const mutate of [
      // A page in the middle of the chat.
      (v: any) => (v.page_info.has_previous_page = true),
      // A page in the middle that also lost its system message (18 Oct 2026 shape).
      (v: any) => {
        v.messages.splice(1, 1);
        v.page_info = page(v.messages, true, v.page_info.has_next_page);
      },
      (v: any) => (v.page_info.start_cursor = v.messages[1].id),
      (v: any) => (v.page_info.end_cursor = v.messages[1].id),
    ]) {
      const body = make();
      mutate(body);
      await both(body, earlierPage, false);
    }
  }
});

// Chats begun since 18 Oct 2026 (seen live on new GPT-6 Pro chats) are saved without any
// system message: the page holds the prompt, the assistant's thoughts, its reasoning recap
// and its answer, with nothing before the prompt and the answer as the selected message.
test("both ChatGPT readers prove the start of a chat saved without any system message (18 Oct 2026)", async () => {
  const both = async (body: any, earlierPage: boolean, expected: boolean) => {
    const { meta, rows } = await stream(body, earlierPage);
    const adapter = parseHistoryText(
      "chatgpt",
      body,
      conversation,
      observedAt,
      undefined,
      [],
      earlierPage,
    );
    assert.equal(meta.firstRequestVerified, expected);
    assert.equal(adapter.firstRequestVerified, expected);
    return { meta, adapter, rows };
  };
  const request = { request_id: uid(9500) };
  const model = { model_slug: "gpt-6-pro", resolved_model_slug: "gpt-6-pro" };
  const assistant = (n: number, content: any) => ({
    ...row(n, "assistant", { ...request, ...model }),
    content,
    end_turn: false,
    channel: null,
  });
  const turn = (first: number) => [
    row(first, "user", request),
    assistant(first + 1, {
      content_type: "thoughts",
      thoughts: [
        { summary: "Synthetic plan", content: "Synthetic steps", finished: true },
      ],
      source_analysis_msg_id: uid(first + 900),
    }),
    assistant(first + 2, {
      content_type: "reasoning_recap",
      content: "Thought for 4s",
    }),
    row(first + 3, "assistant", { ...request, ...model }),
  ];
  const only = () => {
    const messages = turn(1);
    return {
      conversation_id: conversation,
      conversation_origin: null,
      messages,
      current_node: messages.at(-1)!.id,
      page_info: page(messages, false, false),
      context_truncation_continuation: null,
    };
  };
  const earliest = () => {
    const messages = turn(1);
    return {
      messages,
      safe_urls: [],
      blocked_urls: [],
      page_info: page(messages, false, true),
    };
  };
  for (const [make, earlierPage] of [
    [only, false],
    [earliest, true],
  ] as const) {
    const { meta, adapter, rows } = await both(make(), earlierPage, true);
    assert.equal(meta.rootSourceId, uid(1));
    assert.equal(adapter.rootSourceId, uid(1));
    assert.equal(meta.hasEarlier, false);
    // One prompt and one reply, its thoughts counted with the answer.
    assert.deepEqual(
      rows.map((item) => item.message.role),
      ["prompt", "response"],
    );
    assert.equal(rows[1].message.sourceId, uid(4));
    for (const mutate of [
      // A page in the middle of the chat opens at a prompt too.
      (v: any) => (v.page_info.has_previous_page = true),
      (v: any) => delete v.page_info.has_previous_page,
      (v: any) => (v.page_info.start_cursor = v.messages[1].id),
      (v: any) => (v.page_info.end_cursor = v.messages[1].id),
      // A page opening at the reply to a prompt on another page.
      (v: any) => {
        v.messages.shift();
        v.page_info = page(v.messages, false, v.page_info.has_next_page);
      },
      ...(earlierPage
        ? []
        : [
            (v: any) => (v.current_node = v.messages[1].id),
            (v: any) => (v.context_truncation_continuation = "another-page"),
          ]),
    ]) {
      const body = make();
      mutate(body);
      await both(body, earlierPage, false);
    }
  }
  // Chats saved with the system message before (until October 2026) or after the first
  // prompt (12 Oct 2026) keep their proof and their root.
  for (const at of [0, 1]) {
    const usual = only();
    usual.messages.splice(at, 0, row(900, "system", request));
    usual.page_info = page(usual.messages, false, false);
    const kept = await both(usual, false, true);
    assert.equal(kept.meta.rootSourceId, uid(1));
    assert.equal(kept.adapter.rootSourceId, uid(1));
  }
});

test("scrolling up to a chat's earlier page counts its turns and confirms the first request (5 Oct 2026)", async () => {
  const db = await Ledger.open("chatgpt-earlier-" + crypto.randomUUID());
  const coordinator = new Coordinator(db, {
    count: countByTextLength,
    hasConsent: async () => true,
    hasSiteConsent: async () => true,
    sendDisplay: async () => {},
    transport: async () => {
      throw new Error("unexpected network");
    },
  });
  const binding = {
    documentNonce: crypto.randomUUID(),
    navigationNonce: crypto.randomUUID(),
    captureId: null,
  };
  const sender = {
    tab: { id: 802 },
    frameId: 0,
    documentId: "synthetic-chatgpt-earlier",
    url: `https://chatgpt.com/c/${conversation}`,
  };
  Object.assign(globalThis, {
    location: {
      origin: "https://chatgpt.com",
      hostname: "chatgpt.com",
      pathname: `/c/${conversation}`,
      href: `https://chatgpt.com/c/${conversation}`,
    },
  });
  let started: Promise<unknown> = Promise.resolve();
  const finishes: Array<(accepted: boolean) => void> = [];
  const observer = createHistoryTextObserver(
    (event) => {
      if (event.event === "start")
        started = coordinator.history.receive(event, binding, sender);
    },
    () => {},
    async (event) => {
      await started;
      const result = await coordinator.history.receiveStream(
        event,
        binding,
        sender,
      );
      if (event.event === "finish") finishes.shift()?.(result.accepted);
      return result.accepted;
    },
  );
  const read = async (url: URL, body: unknown) => {
    const finished = new Promise<boolean>((resolve) => finishes.push(resolve));
    observer.observe(
      url,
      "GET",
      Promise.resolve(new Response(JSON.stringify(body))),
      Date.now(),
    );
    assert.equal(
      await Promise.race([
        finished,
        new Promise<boolean>((_, reject) =>
          setTimeout(() => reject(new Error("stream timeout")), 15000),
        ),
      ]),
      true,
    );
  };
  const summary = async () =>
    ((await coordinator.routeSummary("chatgpt", conversation, binding)) as any)
      .history.local;
  try {
    await coordinator.whenReady();
    await read(newestUrl, newest());
    const partial = await summary();
    assert.equal(partial.prompt_count, "2");
    assert.equal(partial.first_request_verified, false);
    await read(earlierUrl, earlier());
    const records = (
      await db.all<{ record: HistoryMessage }>("history_records")
    ).map((entry) => entry.record);
    assert.equal(records.length, 6);
    const whole = await summary();
    assert.equal(whole.prompt_count, "3");
    assert.equal(whole.response_count, "3");
    assert.equal(whole.first_request_verified, true);
    // A later visit reads only the newest page again; the earlier turns stay counted.
    await read(newestUrl, newest());
    const again = await summary();
    assert.equal(again.prompt_count, "3");
    assert.equal(again.first_request_verified, true);
    assert.equal((await db.all("history_records")).length, 6);
  } finally {
    observer.cancel();
    coordinator.history.invalidate();
    coordinator.engines.dispose();
    db.close();
  }
});
