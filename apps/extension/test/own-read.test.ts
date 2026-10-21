import { after, test as base } from "node:test";
import assert from "node:assert/strict";
import {
  OWN_READ_CHANNEL,
  OWN_READ_COOLDOWN_MS,
  OWN_READ_IMPORT_START_MS,
  OWN_READ_PAUSE_MAX_MS,
  OWN_READ_REPLY_MS,
  OWN_READ_RETRY_MS,
  ownReadConversation,
  type OwnReadOutcome,
} from "../lib/own-read";
import {
  OWN_READ_TIMEOUT_MS,
  OWN_READ_REQUESTS_PER_WINDOW,
  OWN_READ_WINDOW_MS,
  createOwnReadPage,
  ownReadByteLimit,
  sameRequest,
  type OwnReadProvider,
} from "../lib/own-read-page";
import { installOwnRead } from "../lib/own-read-runtime";
import { HISTORY_LIMITS } from "@footprint/adapters";
import { ProviderHistoryStream } from "../lib/provider-history-stream";
import {
  claudeOwnRead,
  claudeOwnReadUrl,
  lastActiveOrganization,
} from "../lib/claude-own-read";
import { installCapture } from "../lib/capture-runtime";
import { HISTORY_CAPTURE_CHANNEL } from "../lib/history-capture";
import { CLAUDE_STREAM_CHANNEL } from "../lib/claude-history-message";
import {
  askOverLink,
  channel as portPair,
  closePorts,
  connectPage,
  json,
  pageWorld,
  scheduler,
  tick,
} from "./own-read-fixture";

after(closePorts);

// A read that never answers would otherwise hold the test run open.
const test = (name: string, fn: () => unknown) =>
  base(name, { timeout: 10_000 }, fn as () => Promise<void>);

const ORG = "00000000-0000-4000-8000-0000000000aa";
const OTHER_ORG = "00000000-0000-4000-8000-0000000000bb";
const CHAT = "00000000-0000-4000-8000-000000000601";
const OTHER_CHAT = "00000000-0000-4000-8000-000000000602";
const PROMPT = "00000000-0000-4000-8000-000000000603";
const REPLY = "00000000-0000-4000-8000-000000000604";
const ROOT = "00000000-0000-4000-8000-000000000000";
const EXACT_URL = `https://claude.ai/api/organizations/${ORG}/chat_conversations/${CHAT}?tree=True&rendering_mode=messages&render_all_tools=true&include_inline_comparison=true&consistency=strong`;

async function until(predicate: () => boolean) {
  for (let i = 0; i < 200 && !predicate(); i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(predicate());
}

function chatBody(conversationId = CHAT) {
  return JSON.stringify({
    uuid: conversationId,
    model: null,
    current_leaf_message_uuid: REPLY,
    chat_messages: [
      {
        uuid: PROMPT,
        parent_message_uuid: ROOT,
        index: 0,
        sender: "human",
        truncated: false,
        content: [{ type: "text", text: "synthetic prompt" }],
      },
      {
        uuid: REPLY,
        parent_message_uuid: PROMPT,
        index: 1,
        sender: "assistant",
        truncated: false,
        stop_reason: "end_turn",
        content: [{ type: "text", text: "synthetic reply" }],
      },
    ],
  });
}

const claudeScheduler = (options: Parameters<typeof scheduler>[2] = {}) =>
  scheduler("claude", (id) => `/chat/${id}`, options);

function claudeWorld(
  options: Parameters<typeof pageWorld>[3] & { cookie?: string } = {},
) {
  return pageWorld(
    claudeOwnRead({ origin: "https://claude.ai", cookie: () => options.cookie ?? "" }),
    CHAT,
    `/chat/${CHAT}`,
    options,
  );
}

// ---------------------------------------------------------------------------------------
// Shared protocol

test("own read: only chats of the providers qualify, Claude's at /chat/ and /cowork/", () => {
  assert.equal(ownReadConversation("claude", `/chat/${CHAT}`), CHAT);
  assert.equal(
    ownReadConversation("claude", "/cowork/cse_0123456789abcdefABCDEF01"),
    "cse_0123456789abcdefABCDEF01",
  );
  for (const path of [
    "/new",
    "/recents",
    `/project/${CHAT}`,
    "/cowork/not-a-session",
    `/chat/${CHAT}/extra`,
    "/chat/not-a-uuid",
  ])
    assert.equal(ownReadConversation("claude", path), null, path);
  assert.equal(ownReadConversation("chatgpt", `/c/${CHAT}`), CHAT);
  assert.equal(ownReadConversation("chatgpt", "/"), null);
  // A signed-out chat at /uc/<id> is never saved, so there is nothing to read (20 Oct 2026).
  assert.equal(ownReadConversation("chatgpt", `/uc/${CHAT}`), null);
  assert.equal(ownReadConversation("gemini", "/u/2/app/0123456789abcdef"), "c_0123456789abcdef");
  assert.equal(ownReadConversation("perplexity", `/search/${CHAT}`), CHAT);
  assert.equal(ownReadConversation("perplexity", "/search/some-slug-abc"), null);
});

// ---------------------------------------------------------------------------------------
// Content script scheduling (provider neutral)

// Owner decision of 17 Oct 2026: no random wait. The grace period before the read is asked
// for is the only wait; the read then goes out at once, whatever Math.random returns.
test("own read: one request per navigation, at once after the grace period, never at random", async () => {
  for (const random of [0, 0.5, 0.9999]) {
    const s = claudeScheduler({ random });
    try {
      assert.equal(s.request("nav-1", CHAT), true, "the bar keeps loading");
      assert.equal(s.posted.length, 0, "sent from a timer, after this render");
      s.advance(0);
      await tick();
      assert.equal(s.posted.length, 1);
      assert.deepEqual(s.posted[0]!.message, {
        channel: OWN_READ_CHANNEL,
        site: "claude",
        conversationId: CHAT,
      });
      assert.equal(s.request("nav-1", CHAT), true, "still waiting for the answer");
      s.advance(10_000);
      assert.equal(s.posted.length, 1);
    } finally {
      s.close();
    }
  }
});

test("own read: a hidden tab sends nothing until it is visible, then at once", async () => {
  const s = claudeScheduler({ visible: false, random: 0 });
  try {
    assert.equal(s.request("nav-1", CHAT), true);
    s.advance(60_000);
    assert.equal(s.posted.length, 0);
    assert.equal(s.listeners.size, 1);
    s.show();
    assert.equal(s.listeners.size, 0);
    s.advance(0);
    await tick();
    assert.equal(s.posted.length, 1);
  } finally {
    s.close();
  }
});

test("own read: a page read that began during the delay cancels the request", () => {
  const s = claudeScheduler({ random: 0 });
  try {
    assert.equal(s.request("nav-1", CHAT), true);
    s.setNeeded(false);
    s.advance(5000);
    assert.equal(s.posted.length, 0);
    // Details says why, without listing it as something not counted.
    assert.deepEqual(s.read.note("nav-1"), {
      text: "Claude started loading this chat itself, so the tracker did not read it.",
      failed: false,
    });
    // Asked again in the same navigation (ChatGPT once the page's import ended), the read
    // is scheduled again, since none was sent, and still only when it is needed.
    assert.equal(s.request("nav-1", CHAT), true);
    s.advance(5000);
    assert.equal(s.posted.length, 0);
    s.setNeeded(true);
    assert.equal(s.request("nav-1", CHAT), true);
    s.advance(5000);
    assert.equal(s.posted.length, 1);
    assert.equal(s.request("nav-1", CHAT), true, "the read that was sent is pending");
    s.advance(5000);
    assert.equal(s.posted.length, 1, "one read sent per navigation");
  } finally {
    s.close();
  }
});

test("own read: a successful read keeps loading for the import, then never repeats within the cooldown", async () => {
  const s = claudeScheduler({ random: 0 });
  try {
    s.request("nav-1", CHAT);
    s.advance(1000);
    await s.reply({ kind: "read" });
    assert.equal(s.changes, 1);
    assert.equal(s.request("nav-1", CHAT), true, "the import is about to start");
    assert.match(s.read.note("nav-1")!.text, /read the chat from Claude once/);
    s.advance(OWN_READ_IMPORT_START_MS);
    assert.equal(s.changes, 2, "the bar renders again when no import started");
    assert.equal(s.request("nav-1", CHAT), false);
    // Navigating away and back within the cooldown: the chat is saved already.
    assert.equal(s.request("nav-2", OTHER_CHAT), true);
    assert.equal(s.request("nav-3", CHAT), false);
    s.advance(OWN_READ_COOLDOWN_MS);
    assert.equal(s.request("nav-4", CHAT), true);
    s.advance(3000);
    assert.equal(s.posted.at(-1)!.message.conversationId, CHAT);
  } finally {
    s.close();
  }
});

test("own read: progress from a long read keeps the content script waiting", async () => {
  const s = claudeScheduler({ random: 0 });
  try {
    s.request("nav-1", CHAT);
    s.advance(1000);
    s.advance(OWN_READ_REPLY_MS - 1);
    const before = s.latestTimer();
    await s.progress(() => s.latestTimer() > before);
    s.advance(OWN_READ_REPLY_MS - 1);
    assert.equal(s.request("nav-1", CHAT), true, "still reading");
    s.advance(1);
    assert.equal(s.request("nav-1", CHAT), false, "no answer and no progress");
  } finally {
    s.close();
  }
});

for (const [label, outcome, note, nextNavigation] of [
  ["404", { kind: "http", status: 404, shouldRetry: false }, /did not find the chat \(status 404\)/, "blocked"],
  ["not found", { kind: "not_found" }, /did not find the chat\./, "blocked"],
  ["x-should-retry false", { kind: "http", status: 410, shouldRetry: false }, /status 410/, "blocked"],
  ["401", { kind: "http", status: 401, shouldRetry: true }, /refused the read \(status 401\)/, "paused"],
  ["403", { kind: "http", status: 403, shouldRetry: true }, /refused the read \(status 403\)/, "paused"],
  ["invalid JSON", { kind: "invalid" }, /answer could not be read/, "retry"],
  ["no session", { kind: "no_session" }, /account details the request needs/, "retry"],
] as const)
  test(`own read: a failed read (${label}) is not retried in the navigation`, async () => {
    const s = claudeScheduler({ random: 0 });
    try {
      s.request("nav-1", CHAT);
      s.advance(1000);
      await s.reply(outcome as OwnReadOutcome);
      assert.equal(s.changes, 1);
      assert.equal(s.request("nav-1", CHAT), false, "History not loaded");
      assert.match(s.read.note("nav-1")!.text, note);
      assert.doesNotMatch(s.read.note("nav-1")!.text, /tries once more/);
      for (let i = 0; i < 14; i++) s.advance(20_000);
      assert.equal(s.posted.length, 1, "no retry");
      s.advance(OWN_READ_COOLDOWN_MS - 1000 - 14 * 20_000);
      // A fresh navigation may try once after an ordinary failure.
      const again = s.request("nav-2", CHAT);
      if (nextNavigation === "retry") {
        assert.equal(again, true);
        s.advance(1000);
        assert.equal(s.posted.length, 2);
      } else {
        assert.equal(again, false);
        assert.equal(s.posted.length, 1);
        if (nextNavigation === "paused") {
          assert.match(s.read.note("nav-2")!.text, /refused or limited an earlier read/);
          assert.equal(s.request("nav-3", OTHER_CHAT), false, "every chat waits");
        } else assert.equal(s.request("nav-3", OTHER_CHAT), true);
      }
    } finally {
      s.close();
    }
  });

test("own read: a page world that never answers counts as a failed read", () => {
  const s = claudeScheduler({ random: 0 });
  try {
    s.request("nav-1", CHAT);
    s.advance(1000);
    s.advance(OWN_READ_REPLY_MS);
    assert.equal(s.request("nav-1", CHAT), false);
    assert.match(s.read.note("nav-1")!.text, /the page could not make the request/);
  } finally {
    s.close();
  }
});

// The page world's reads wait while the tab is hidden (ChatGPT's long reads), so the time
// the content script waits for an answer runs only while the tab is shown (14 Oct 2026).
test("own read: the wait for an answer pauses while the tab is hidden", () => {
  const s = claudeScheduler({ random: 0 });
  try {
    s.request("nav-1", CHAT);
    s.advance(1000);
    s.hide();
    s.advance(OWN_READ_REPLY_MS * 3);
    assert.equal(s.request("nav-1", CHAT), true, "still reading while hidden");
    assert.equal(s.read.note("nav-1"), null);
    s.show();
    s.advance(OWN_READ_REPLY_MS - 1);
    assert.equal(s.request("nav-1", CHAT), true, "a full wait once shown again");
    s.advance(1);
    assert.equal(s.request("nav-1", CHAT), false);
    assert.match(s.read.note("nav-1")!.text, /the page could not make the request/);
  } finally {
    s.close();
  }
});

test("own read: a resume value goes to the page world, and its reports come back while it reads", async () => {
  const s = scheduler("chatgpt", (id) => `/c/${id}`, { random: 0 });
  const reports: unknown[] = [];
  let asked = 0;
  try {
    s.request("nav-1", CHAT, {
      resume: () => {
        asked++;
        return { before: null, top: null, budget: 5 };
      },
      resumed: (value) => reports.push(value),
    });
    s.advance(1000);
    assert.equal(asked, 1, "read just before the request");
    assert.deepEqual(s.posted.at(-1)!.message, {
      channel: OWN_READ_CHANNEL,
      site: "chatgpt",
      conversationId: CHAT,
      resume: { before: null, top: null, budget: 5 },
    });
    s.advance(OWN_READ_REPLY_MS - 1);
    const before = s.latestTimer();
    s.posted.at(-1)!.port.postMessage({ resume: { pages: 1 } });
    await until(() => reports.length === 1);
    assert.deepEqual(reports, [{ pages: 1 }]);
    assert.ok(s.latestTimer() > before, "a report counts as progress");
    assert.equal(s.request("nav-1", CHAT), true);
    await s.reply({ kind: "read" });
    assert.match(s.read.note("nav-1")!.text, /had not loaded all of this chat/);
  } finally {
    s.close();
  }
  // A request without a resume value names none.
  const plain = scheduler("chatgpt", (id) => `/c/${id}`, { random: 0 });
  try {
    plain.request("nav-1", CHAT, { resume: () => null });
    plain.advance(1000);
    assert.equal("resume" in plain.posted.at(-1)!.message, false);
  } finally {
    plain.close();
  }
});

test("own read: only chat routes are read, and a stopped tracker reads nothing", () => {
  const s = claudeScheduler({ random: 0 });
  try {
    for (const pathname of ["/new", "/recents", `/project/${CHAT}`])
      assert.equal(
        s.read.request({
          navigation: pathname,
          pathname,
          stillNeeded: () => true,
          changed: () => {},
        }),
        false,
      );
    s.read.stop();
    assert.equal(s.request("nav-1", CHAT), false);
    s.advance(10_000);
    assert.equal(s.posted.length, 0);
  } finally {
    s.close();
  }
});

// A network error, time-out, 429 or 5xx is tried once more, at least a minute later and after
// the pause a refusal started, only while the tab is shown (owner decision of 14 Oct 2026).
for (const [label, outcome, wait] of [
  ["network error", { kind: "network" }, OWN_READ_RETRY_MS],
  ["timeout", { kind: "timeout" }, OWN_READ_RETRY_MS],
  ["429", { kind: "http", status: 429, shouldRetry: true }, OWN_READ_COOLDOWN_MS],
  ["503", { kind: "http", status: 503, shouldRetry: true }, OWN_READ_COOLDOWN_MS],
] as const)
  test(`own read: a failed read (${label}) is tried once more after ${wait / 1000} s, never twice`, async () => {
    const s = claudeScheduler({ random: 0 });
    try {
      s.request("nav-1", CHAT);
      s.advance(1000);
      await s.reply(outcome as OwnReadOutcome);
      assert.equal(s.request("nav-1", CHAT), false, "History not loaded until the retry");
      assert.match(s.read.note("nav-1")!.text, /tries once more in a minute or more/);
      assert.equal(s.read.note("nav-1")!.failed, true);
      s.advance(wait - 1);
      s.advance(0);
      assert.equal(s.posted.length, 1, "not before the wait");
      assert.equal(s.request("nav-1", CHAT), false);
      s.advance(1);
      assert.equal(s.request("nav-1", CHAT), true, "the retry is due");
      s.advance(0);
      assert.equal(s.posted.length, 2, "sent at once, with no further wait");
      assert.equal(s.read.progress("nav-1"), "Sending request");
      await s.reply(outcome as OwnReadOutcome);
      assert.doesNotMatch(s.read.note("nav-1")!.text, /tries once more/);
      for (let i = 0; i < 4; i++) s.advance(OWN_READ_COOLDOWN_MS);
      assert.equal(s.posted.length, 2, "never a third time");
      assert.equal(s.request("nav-1", CHAT), false);
    } finally {
      s.close();
    }
  });

test("own read: a retry that falls due while the tab is hidden waits until it is shown", async () => {
  const s = claudeScheduler({ random: 0 });
  try {
    s.request("nav-1", CHAT);
    s.advance(1000);
    await s.reply({ kind: "network" });
    s.hide();
    s.advance(OWN_READ_RETRY_MS);
    s.advance(10_000);
    assert.equal(s.posted.length, 1);
    s.show();
    s.advance(1000);
    assert.equal(s.posted.length, 2);
  } finally {
    s.close();
  }
});

test("own read: a retry is dropped when the chat no longer needs it, and with the navigation", async () => {
  const s = claudeScheduler({ random: 0 });
  try {
    s.request("nav-1", CHAT);
    s.advance(1000);
    await s.reply({ kind: "network" });
    s.setNeeded(false);
    s.advance(OWN_READ_RETRY_MS);
    s.advance(10_000);
    assert.equal(s.posted.length, 1, "the page read the chat meanwhile");
    s.setNeeded(true);
    s.request("nav-2", OTHER_CHAT);
    s.advance(1000);
    await s.reply({ kind: "network" });
    // Navigating away drops the waiting retry.
    s.request("nav-3", CHAT);
    s.advance(1000);
    assert.equal(s.posted.length, 3);
    s.advance(OWN_READ_RETRY_MS);
    s.advance(10_000);
    assert.equal(s.posted.at(-1)!.message.conversationId, CHAT);
    assert.equal(s.posted.length, 3);
  } finally {
    s.close();
  }
});

test("own read: a read asked for after a refused page read says so to the page world", () => {
  const s = claudeScheduler({ random: 0 });
  try {
    s.read.request({
      navigation: "nav-1",
      pathname: `/chat/${CHAT}`,
      rejected: true,
      stillNeeded: () => true,
      changed: () => {},
    });
    s.advance(1000);
    assert.deepEqual(s.posted[0]!.message, {
      channel: OWN_READ_CHANNEL,
      site: "claude",
      conversationId: CHAT,
      rejected: true,
    });
  } finally {
    s.close();
  }
});

test("own read: a page read that was skipped for and then not counted may be read once more", async () => {
  // NotebookLM reads a notebook's saved chat once per document (14 Oct 2026): the read the
  // page world skipped because the page had just read the chat is the navigation's one
  // read only while the page's read was counted.
  const s = claudeScheduler({ random: 0 });
  const rejected = () =>
    s.read.request({
      navigation: "nav-1",
      pathname: `/chat/${CHAT}`,
      rejected: true,
      stillNeeded: () => true,
      changed: () => {},
    });
  try {
    s.request("nav-1", CHAT);
    s.advance(1000);
    await s.reply({ kind: "page_read" });
    assert.equal(s.posted.length, 1);
    assert.equal(s.request("nav-1", CHAT), false, "a skipped read is not asked again");
    s.advance(5000);
    assert.equal(s.posted.length, 1);
    assert.equal(rejected(), true);
    s.advance(1000);
    assert.equal(s.posted.length, 2);
    assert.equal(s.posted[1]!.message.rejected, true);
    s.posted[1]!.port.postMessage({ outcome: { kind: "page_read" } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    // The read after the refused one is the last of this navigation, whatever it answered.
    assert.equal(rejected(), false);
    s.advance(5000);
    assert.equal(s.posted.length, 2);
  } finally {
    s.close();
  }
  // A read that was sent is not repeated because the page's read was refused later.
  const sent = claudeScheduler({ random: 0 });
  try {
    sent.request("nav-1", CHAT);
    sent.advance(1000);
    await sent.reply({ kind: "invalid" });
    sent.read.request({
      navigation: "nav-1",
      pathname: `/chat/${CHAT}`,
      rejected: true,
      stillNeeded: () => true,
      changed: () => {},
    });
    sent.advance(5000);
    assert.equal(sent.posted.length, 1);
  } finally {
    sent.close();
  }
});

// The content script gives up after its reply time; the page world must then stop as well,
// or a stalled read would keep requesting and importing after Details said it failed.
test("own read: a read the content script gave up on is cancelled in the page world", async () => {
  const s = claudeScheduler({ random: 0 });
  try {
    s.request("nav-1", CHAT);
    s.advance(1000);
    assert.equal(s.posted.length, 1);
    const received: unknown[] = [];
    s.posted[0]!.port.onmessage = (event) => received.push(event.data);
    s.advance(OWN_READ_REPLY_MS);
    assert.match(s.read.note("nav-1")!.text, /could not make the request/);
    await until(() => received.length > 0);
    assert.deepEqual(received, [{ cancel: true }]);
  } finally {
    s.close();
  }
  // An answered read is not cancelled.
  const answered = claudeScheduler({ random: 0 });
  try {
    answered.request("nav-1", CHAT);
    answered.advance(1000);
    const received: unknown[] = [];
    answered.posted[0]!.port.onmessage = (event) => received.push(event.data);
    answered.posted[0]!.port.postMessage({ outcome: { kind: "read" } });
    await until(() => answered.changes > 0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(received, []);
  } finally {
    answered.close();
  }
});

test("own read: requests go only over the private port handed over once", () => {
  const s = claudeScheduler({ random: 0 });
  try {
    assert.equal(s.connects.length, 1, "the port is handed over when the scheduler starts");
    s.request("nav-1", CHAT);
    s.advance(1000);
    s.request("nav-2", OTHER_CHAT);
    s.advance(1000);
    assert.equal(s.posted.length, 2);
    assert.equal(s.connects.length, 1, "no request goes over the window");
  } finally {
    s.close();
  }
});

for (const [label, outcome, note, failed] of [
  ["read", { kind: "read" }, /read this chat from Claude in the last few minutes, so it does not read it again/, false],
  ["not found", { kind: "not_found" }, /Claude did not find this chat when the tracker tried to read it in the last few minutes/, true],
  ["404", { kind: "http", status: 404, shouldRetry: true }, /Claude did not find this chat/, true],
  ["refused", { kind: "http", status: 410, shouldRetry: false }, /Claude refused the tracker's read of this chat in the last few minutes/, true],
  ["too large", { kind: "too_large" }, /larger than the tracker reads itself when it tried in the last few minutes/, true],
] as const)
  test(`own read: a chat within its cooldown (${label}) says why it was not read`, async () => {
    const s = claudeScheduler({ random: 0 });
    try {
      s.request("nav-1", CHAT);
      s.advance(1000);
      await s.reply(outcome as OwnReadOutcome);
      s.advance(OWN_READ_IMPORT_START_MS);
      assert.equal(s.request("nav-2", CHAT), false);
      const text = s.read.note("nav-2");
      assert.ok(text, "a note for the blocked chat");
      assert.match(text.text, note);
      assert.equal(text.failed, failed);
    } finally {
      s.close();
    }
  });

test("own read: page reads, navigations and too large answers name their reason", async () => {
  for (const [outcome, note, failed] of [
    [{ kind: "page_read" }, /^Claude loaded this chat itself, so the tracker did not read it\.$/, false],
    [{ kind: "navigated" }, /moved to another address before the read finished/, true],
    [{ kind: "too_large" }, /larger than the tracker reads itself, so it was not read/, true],
  ] as const) {
    const s = claudeScheduler({ random: 0 });
    try {
      s.request("nav-1", CHAT);
      s.advance(1000);
      await s.reply(outcome as OwnReadOutcome);
      const text = s.read.note("nav-1")!;
      assert.match(text.text, note);
      assert.equal(text.failed, failed);
    } finally {
      s.close();
    }
  }
});

test("own read: a read a pause held is made once when the pause has passed", async () => {
  const s = claudeScheduler({ random: 0 });
  try {
    s.request("nav-1", CHAT);
    s.advance(1000);
    await s.reply({ kind: "http", status: 401, shouldRetry: true });
    // Another chat in the pause: nothing is sent, and Details says why.
    assert.equal(s.request("nav-2", OTHER_CHAT), false);
    assert.match(s.read.note("nav-2")!.text, /refused or limited an earlier read/);
    const before = s.changes;
    s.advance(OWN_READ_COOLDOWN_MS - 1);
    assert.equal(s.request("nav-2", OTHER_CHAT), false, "still paused");
    s.advance(1);
    assert.ok(s.changes > before, "the bar renders again when the pause ends");
    assert.equal(s.request("nav-2", OTHER_CHAT), true);
    s.advance(1000);
    assert.equal(s.posted.length, 2);
    assert.equal(s.posted[1]!.message.conversationId, OTHER_CHAT);
    await s.reply({ kind: "invalid" });
    assert.equal(s.request("nav-2", OTHER_CHAT), false, "only once");
    s.advance(10_000);
    assert.equal(s.posted.length, 2);
  } finally {
    s.close();
  }
});

test("own read: a pause another tab of the site started holds this tab's read", async () => {
  const stored: number[] = [];
  let shared: number | null = null;
  const sharedPause = {
    get: () => Promise.resolve(shared),
    set: (until: number) => {
      stored.push(until);
    },
  };
  const first = claudeScheduler({ random: 0, sharedPause });
  try {
    first.request("nav-1", CHAT);
    first.advance(1000);
    await first.reply({ kind: "http", status: 429, shouldRetry: true });
    assert.equal(stored.length, 1, "only the pause time is shared");
  } finally {
    first.close();
  }
  shared = stored[0]!;
  const second = claudeScheduler({ random: 0, sharedPause });
  try {
    await tick();
    assert.equal(second.request("nav-1", OTHER_CHAT), false);
    assert.match(second.read.note("nav-1")!.text, /refused or limited an earlier read/);
    assert.equal(second.posted.length, 0);
  } finally {
    second.close();
  }
  // A stored time far ahead holds reads for the longest pause a provider can ask for at most
  // (a Retry-After can ask for more than one five-minute pause, 17 Oct 2026).
  shared = 1_000_000 + 100 * OWN_READ_PAUSE_MAX_MS;
  const third = claudeScheduler({ random: 0, sharedPause });
  try {
    await tick();
    assert.equal(third.request("nav-1", CHAT), false);
    third.advance(OWN_READ_PAUSE_MAX_MS);
    shared = null;
    assert.equal(third.request("nav-1", CHAT), true);
  } finally {
    third.close();
  }
});

// ---------------------------------------------------------------------------------------
// Page world runner, with Claude's read

test("own read page: Claude's request is the page's own conversation read", () => {
  assert.equal(claudeOwnReadUrl("https://claude.ai", ORG, CHAT)!.href, EXACT_URL);
  assert.equal(claudeOwnReadUrl("https://claude.ai", "not-an-id", CHAT), null);
  assert.equal(lastActiveOrganization(`a=1; lastActiveOrg=${ORG}; b=2`), ORG);
  assert.equal(lastActiveOrganization("lastActiveOrg=bad"), null);
  assert.equal(lastActiveOrganization(""), null);
});

test("own read page: one GET of the exact address with the login cookies and no page headers", async () => {
  const world = claudeWorld({
    cookie: `lastActiveOrg=${OTHER_ORG}`,
    responses: [json(chatBody())],
  });
  // The organization the page itself uses wins over the cookie.
  world.page.pageRequest(new URL(`https://claude.ai/api/organizations/${ORG}/projects`), "GET");
  assert.deepEqual(await world.ask(), { kind: "read" });
  assert.equal(world.fetches.length, 1);
  const { input, init } = world.fetches[0]!;
  assert.equal(input, EXACT_URL);
  assert.equal(init.method, "GET");
  assert.equal(init.credentials, "include");
  assert.equal(init.headers, undefined);
  assert.deepEqual(Object.keys(init).sort(), ["credentials", "method", "signal"]);
  assert.equal(world.observed.length, 1);
  assert.equal(world.observed[0]!.url.href, EXACT_URL);
  assert.equal(world.observed[0]!.method, "GET");
  assert.equal(await (await world.observed[0]!.response).text(), chatBody());
});

test("own read page: the cookie names the organization when the page sent nothing yet; neither means no read", async () => {
  const cookie = claudeWorld({ cookie: `lastActiveOrg=${ORG}`, responses: [json(chatBody())] });
  assert.deepEqual(await cookie.ask(), { kind: "read" });
  assert.equal(cookie.fetches[0]!.input, EXACT_URL);
  const none = claudeWorld();
  assert.deepEqual(await none.ask(), { kind: "no_session" });
  assert.equal(none.fetches.length, 0);
});

for (const [label, response, outcome] of [
  ["404", json('{"type":"error","error":{"type":"not_found_error"}}', 404, { "x-should-retry": "false" }), { kind: "http", status: 404, shouldRetry: false }],
  ["401", json("{}", 401), { kind: "http", status: 401, shouldRetry: true }],
  ["403", json("{}", 403), { kind: "http", status: 403, shouldRetry: true }],
  ["429", json("{}", 429), { kind: "http", status: 429, shouldRetry: true }],
  ["503", json("{}", 503), { kind: "http", status: 503, shouldRetry: true }],
  ["network error", new TypeError("Failed to fetch"), { kind: "network" }],
  ["invalid JSON", json("{not json"), { kind: "invalid" }],
  ["another chat", json(chatBody(OTHER_CHAT)), { kind: "invalid" }],
  ["an HTML page", new Response("<html></html>", { headers: { "content-type": "text/html" } }), { kind: "invalid" }],
] as const)
  test(`own read page: ${label} is reported once and never reaches the history reader`, async () => {
    const world = claudeWorld({ cookie: `lastActiveOrg=${ORG}`, responses: [response as Response | Error] });
    assert.deepEqual(await world.ask(), outcome);
    assert.equal(world.fetches.length, 1, "no retry");
    assert.equal(world.observed.length, 0);
  });

test("own read page: a page read of the same chat while the request runs stops it, so only one read is imported", async () => {
  let release!: (response: Response) => void;
  const world = claudeWorld({
    cookie: `lastActiveOrg=${ORG}`,
    responses: [new Promise<Response>((resolve) => (release = resolve))],
  });
  const answer = world.ask();
  await tick();
  const signal = world.fetches[0]!.init.signal!;
  // The page's own read reaches the history reader; the tracker's is stopped.
  world.page.pageRead(
    new URL(`https://claude.ai/api/organizations/${ORG}/chat_conversations/${CHAT}?tree=True`),
    "GET",
  );
  assert.equal(signal.aborted, true);
  release(json(chatBody()));
  assert.deepEqual(await answer, { kind: "page_read" });
  assert.equal(world.observed.length, 0);
  // A chat the page read recently is not requested at all.
  assert.deepEqual(await world.ask(), { kind: "page_read" });
  assert.equal(world.fetches.length, 1);
});

test("own read page: hidden tabs, other chats, a running read, a stopped tracker and the rate limit are declined", async () => {
  const hidden = claudeWorld({ cookie: `lastActiveOrg=${ORG}`, visible: false });
  assert.deepEqual(await hidden.ask(), { kind: "declined" });
  const elsewhere = claudeWorld({ cookie: `lastActiveOrg=${ORG}` });
  assert.deepEqual(await elsewhere.ask(OTHER_CHAT), { kind: "declined" });
  const stopped = claudeWorld({ cookie: `lastActiveOrg=${ORG}` });
  stopped.state.enabled = false;
  assert.deepEqual(await stopped.ask(), { kind: "declined" });
  for (const world of [hidden, elsewhere, stopped]) assert.equal(world.fetches.length, 0);
  let release!: (response: Response) => void;
  const busy = claudeWorld({
    cookie: `lastActiveOrg=${ORG}`,
    responses: [new Promise<Response>((resolve) => (release = resolve))],
  });
  const first = busy.ask();
  assert.deepEqual(await busy.ask(), { kind: "declined" });
  release(json(chatBody()));
  assert.deepEqual(await first, { kind: "read" });
  // The limit counts provider requests, not reads: one Claude read is one request.
  const limited = claudeWorld({ cookie: `lastActiveOrg=${ORG}`, responses: () => json(chatBody()) });
  for (let i = 0; i < OWN_READ_REQUESTS_PER_WINDOW; i++)
    assert.deepEqual(await limited.ask(), { kind: "read" });
  assert.deepEqual(await limited.ask(), { kind: "declined" });
  assert.equal(limited.fetches.length, OWN_READ_REQUESTS_PER_WINDOW);
});

test("own read page: a navigation before the answer drops it", async () => {
  let release!: (response: Response) => void;
  const world = claudeWorld({
    cookie: `lastActiveOrg=${ORG}`,
    responses: [new Promise<Response>((resolve) => (release = resolve))],
  });
  const answer = world.ask();
  await tick();
  world.state.pathname = `/chat/${OTHER_CHAT}`;
  world.page.routeChanged();
  release(json(chatBody()));
  assert.deepEqual(await answer, { kind: "navigated" });
  assert.equal(world.observed.length, 0);
});

test("own read page: the request is abandoned after its time limit", async () => {
  const realSetTimeout = globalThis.setTimeout;
  const limits: number[] = [];
  // Fire only the read's own time limit at once.
  globalThis.setTimeout = ((run: () => void, ms?: number) => {
    if (ms === OWN_READ_TIMEOUT_MS) {
      limits.push(ms);
      return realSetTimeout(run, 0);
    }
    return realSetTimeout(run, ms);
  }) as typeof setTimeout;
  try {
    const world = claudeWorld({
      cookie: `lastActiveOrg=${ORG}`,
      // Never answers; only the abort ends it.
      responses: (_input, init) =>
        new Promise<Response>((_resolve, reject) =>
          init.signal!.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
    });
    const answer = world.ask();
    assert.deepEqual(await answer, { kind: "timeout" });
    assert.deepEqual(limits, [OWN_READ_TIMEOUT_MS]);
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});

test("own read page: malformed requests are ignored without a fetch", () => {
  const world = claudeWorld({ cookie: `lastActiveOrg=${ORG}` });
  assert.equal(world.page.receive({ channel: "other" }, []), false);
  assert.equal(
    world.page.receive({ channel: OWN_READ_CHANNEL, site: "claude", conversationId: CHAT }, []),
    true,
  );
  for (const message of [
    { channel: OWN_READ_CHANNEL, site: "claude", conversationId: CHAT, url: "https://claude.ai/other" },
    { channel: OWN_READ_CHANNEL, site: "chatgpt", conversationId: CHAT },
    { channel: OWN_READ_CHANNEL, site: "claude", conversationId: CHAT, rejected: false },
    { channel: OWN_READ_CHANNEL, site: "claude", conversationId: CHAT, rejected: "yes" },
    { channel: OWN_READ_CHANNEL, site: "claude", conversationId: CHAT, uncounted: false },
  ]) {
    const channel = portPair();
    assert.equal(world.page.receive(message, [channel.port2]), true);
    channel.port1.close();
  }
  assert.equal(world.fetches.length, 0);
});

// After the history reader refused the page's read, the page world reads although the page
// just did, unless its request is the same as the page's (owner decision of 14 Oct 2026).
test("own read page: a refused page read is read again with a different request, never the same one", async () => {
  const pageUrl = new URL(`https://claude.ai/api/organizations/${ORG}/chat_conversations/${CHAT}?tree=True`);
  const differs = claudeWorld({ cookie: `lastActiveOrg=${ORG}`, responses: [json(chatBody())] });
  differs.page.pageRead(pageUrl, "GET");
  assert.deepEqual(await differs.ask(), { kind: "page_read" }, "an ordinary request defers to the page");
  assert.deepEqual(await differs.ask(CHAT, { rejected: true }), { kind: "read" });
  assert.equal(differs.fetches.length, 1);
  assert.equal(differs.fetches[0]!.input, EXACT_URL);
  const same = claudeWorld({ cookie: `lastActiveOrg=${ORG}`, responses: [json(chatBody())] });
  same.page.pageRead(new URL(EXACT_URL), "GET");
  assert.deepEqual(await same.ask(CHAT, { rejected: true }), { kind: "page_read" });
  assert.equal(same.fetches.length, 0, "the same request would be refused again");
});

// Live QA of 19 Oct 2026: claude.ai reads the saved chat about 0.1 s after every reply ends.
// With tracking off the content script refused that read, but the page world still took it
// as a page read, so the read after agreeing again was skipped as page_read and the reply
// cut off by the withdrawal stayed undercounted until a reload.
test("own read page: a read marked uncounted is made although the page just read the chat, with the same request", async () => {
  const world = claudeWorld({ cookie: `lastActiveOrg=${ORG}`, responses: [json(chatBody())] });
  world.page.pageRead(new URL(EXACT_URL), "GET");
  assert.deepEqual(await world.ask(), { kind: "page_read" }, "an ordinary request defers to the page");
  assert.deepEqual(await world.ask(CHAT, { uncounted: true }), { kind: "read" });
  assert.equal(world.fetches.length, 1);
  assert.equal(world.fetches[0]!.input, EXACT_URL);
});

test("own read: a read whose page reads were not counted says so to the page world", () => {
  const s = claudeScheduler({ random: 0 });
  try {
    s.read.request({
      navigation: "nav-1",
      pathname: `/chat/${CHAT}`,
      mode: "lost_reply",
      uncounted: true,
      stillNeeded: () => true,
      changed: () => {},
    });
    s.advance(1000);
    assert.deepEqual(s.posted[0]!.message, {
      channel: OWN_READ_CHANNEL,
      site: "claude",
      conversationId: CHAT,
      uncounted: true,
    });
  } finally {
    s.close();
  }
});

test("own read page: requests are the same apart from per-request values and tokens", () => {
  const form = (args: string, token: string) =>
    `f.req=${encodeURIComponent(`[[["hNvQHb","${args}",null,"generic"]]]`)}&at=${token}&`;
  const gemini = (reqid: string, sid: string) =>
    new URL(`https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=hNvQHb&source-path=%2Fapp%2F1&bl=a&f.sid=${sid}&hl=de&_reqid=${reqid}&rt=c`);
  assert.equal(
    sameRequest(
      { url: gemini("1", "1"), body: form("[1]", "x") },
      { url: gemini("2", "2"), body: form("[1]", "y") },
    ),
    true,
  );
  assert.equal(
    sameRequest(
      { url: gemini("1", "1"), body: form("[1]", "x") },
      { url: gemini("1", "1"), body: form("[2]", "x") },
    ),
    false,
  );
  assert.equal(
    sameRequest({ url: new URL(EXACT_URL) }, { url: new URL(EXACT_URL.replace("tree=True", "tree=False")) }),
    false,
  );
  assert.equal(
    sameRequest(
      { url: new URL("https://claude.ai/a?x=1&y=2") },
      { url: new URL("https://claude.ai/a?y=2&x=1") },
    ),
    true,
  );
  assert.equal(
    sameRequest({ url: new URL("https://claude.ai/a") }, { url: new URL("https://claude.ai/b") }),
    false,
  );
});

// ---------------------------------------------------------------------------------------
// The installed page capture (Claude)

class PageWindow extends EventTarget {
  messages: any[] = [];
  fetch: typeof fetch;
  WebSocket: any = class extends EventTarget {};
  constructor(fetcher: typeof fetch) {
    super();
    this.fetch = fetcher;
  }
  postMessage(value: any, _origin?: string, transfer?: MessagePort[]) {
    this.messages.push(value);
    // The content script accepts each stream batch of the saved chat.
    if (value?.channel === CLAUDE_STREAM_CHANNEL && transfer?.[0]) {
      transfer[0].postMessage({ accepted: true });
      transfer[0].close();
    }
  }
}

function installPage(fetcher: typeof fetch) {
  const win = new PageWindow(fetcher);
  Object.assign(globalThis, {
    window: win,
    location: {
      origin: "https://claude.ai",
      hostname: "claude.ai",
      pathname: `/chat/${CHAT}`,
      href: `https://claude.ai/chat/${CHAT}`,
    },
  });
  installCapture();
  const link = connectPage(win, "https://claude.ai");
  const ask = () => askOverLink(link, { site: "claude", conversationId: CHAT });
  return { win, ask };
}

test("own read capture: the page's organization is used and the answer takes the page read's history path", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const native = ((input: string, init?: RequestInit) => {
    calls.push({ input: String(input), init });
    return Promise.resolve(
      String(input).includes("/chat_conversations/") ? json(chatBody()) : json("{}"),
    );
  }) as typeof fetch;
  const { win, ask } = installPage(native);
  try {
    // The page's own traffic names the organization.
    await win.fetch(`https://claude.ai/api/organizations/${ORG}/chat_conversations?limit=30`);
    assert.deepEqual(await ask(), { kind: "read" });
    const reads = calls.filter((call) => call.input.includes(`/chat_conversations/${CHAT}`));
    assert.equal(reads.length, 1);
    assert.equal(reads[0]!.input, EXACT_URL);
    assert.equal(reads[0]!.init?.method, "GET");
    assert.equal(reads[0]!.init?.credentials, "include");
    await until(() =>
      win.messages.some((m) => m?.channel === CLAUDE_STREAM_CHANNEL && m.event === "finish"),
    );
    const start = win.messages.filter(
      (m) => m?.channel === HISTORY_CAPTURE_CHANNEL && m.event === "start",
    );
    assert.equal(start.length, 1);
    assert.equal(start[0].conversationId, CHAT);
    const batch = win.messages.find((m) => m?.channel === CLAUDE_STREAM_CHANNEL && m.event === "batch");
    assert.deepEqual(
      batch.rows.map((row: any) => row.message.sourceId),
      [PROMPT, REPLY],
    );
    const finish = win.messages.find((m) => m?.channel === CLAUDE_STREAM_CHANNEL && m.event === "finish");
    assert.equal(finish.leafId, REPLY);
    assert.equal(calls.length, 2, "one page request and one own read");
  } finally {
    win.dispatchEvent(new Event("pagehide"));
  }
});

test("own read capture: a page read that arrives while the own read runs is imported alone", async () => {
  let release!: (response: Response) => void;
  let reads = 0;
  const native = ((input: string, init?: RequestInit) => {
    if (!String(input).includes(`/chat_conversations/${CHAT}`)) return Promise.resolve(json("{}"));
    reads++;
    // The tracker's read (no page wrapper, so it carries the signal) waits; the page's answers.
    if (init?.signal) {
      return new Promise<Response>((resolve, reject) => {
        release = resolve;
        init.signal!.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }
    return Promise.resolve(json(chatBody()));
  }) as typeof fetch;
  const { win, ask } = installPage(native);
  try {
    await win.fetch(`https://claude.ai/api/organizations/${ORG}/chat_conversations?limit=30`);
    const answer = ask();
    await tick();
    const page = await win.fetch(
      `https://claude.ai/api/organizations/${ORG}/chat_conversations/${CHAT}?tree=True`,
    );
    void page.text();
    release?.(json(chatBody()));
    assert.deepEqual(await answer, { kind: "page_read" });
    await until(() =>
      win.messages.some((m) => m?.channel === CLAUDE_STREAM_CHANNEL && m.event === "finish"),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(reads, 2);
    assert.equal(
      win.messages.filter((m) => m?.channel === HISTORY_CAPTURE_CHANNEL && m.event === "start").length,
      1,
      "only the page's read reaches the history reader",
    );
  } finally {
    win.dispatchEvent(new Event("pagehide"));
  }
});

test("own read capture: requests over the window are ignored and the private port stays private", async () => {
  let calls = 0;
  const { win } = installPage((() => {
    calls++;
    return Promise.resolve(json(chatBody()));
  }) as typeof fetch);
  try {
    // A page script that listens to window messages after the capture was installed.
    const seen: unknown[] = [];
    win.addEventListener("message", (event) => seen.push((event as MessageEvent).data));
    const link = connectPage(win, "https://claude.ai");
    assert.deepEqual(seen, [], "the page never sees the private port");
    // A request posted on the window, as before, is not answered and sends nothing.
    const forged = portPair();
    let answered = false;
    forged.port1.onmessage = () => (answered = true);
    const event = new Event("message");
    Object.assign(event, {
      source: win,
      origin: "https://claude.ai",
      data: { channel: OWN_READ_CHANNEL, site: "claude", conversationId: CHAT },
      ports: [forged.port2],
    });
    win.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(answered, false);
    assert.equal(calls, 0);
    // The private port works.
    await win.fetch(`https://claude.ai/api/organizations/${ORG}/chat_conversations?limit=30`);
    assert.deepEqual(await askOverLink(link, { site: "claude", conversationId: CHAT }), { kind: "read" });
  } finally {
    win.dispatchEvent(new Event("pagehide"));
  }
});

test("own read capture: a stopped tracker declines the read", async () => {
  let calls = 0;
  const { win, ask } = installPage((() => {
    calls++;
    return Promise.resolve(json(chatBody()));
  }) as typeof fetch);
  const stop = new Event("message");
  Object.assign(stop, {
    source: win,
    origin: "https://claude.ai",
    data: { channel: "ai-footprint-control-v1", action: "stop" },
  });
  win.dispatchEvent(stop);
  assert.deepEqual(await ask(), { kind: "declined" });
  assert.equal(calls, 0);
  win.dispatchEvent(new Event("pagehide"));
});

// ---------------------------------------------------------------------------------------
// Review items of 14 October 2026: cancel, bounded bodies, unread page reads, request limit

/** A provider that reads the same address `count` times, `between` ms apart. */
function repeatedReads(count: number, between = 0): OwnReadProvider {
  return {
    site: "claude",
    async run(context) {
      for (let i = 0; i < count; i++) {
        if (i > 0) {
          context.progress();
          if (between && !(await context.pause(between))) return { kind: "navigated" };
        }
        const result = await context.read(
          new URL(`https://claude.ai/api/synthetic/${i}`),
          { method: "GET" },
          () => ({ ok: true, info: null }),
        );
        if (!result.ok) return result.outcome;
      }
      return { kind: "read" };
    },
  };
}

/** Asks a page world directly, keeping the content script's end of the answer port. */
function askWith(world: ReturnType<typeof pageWorld>) {
  const ports = portPair();
  const pending: unknown[] = [];
  const answer = new Promise<OwnReadOutcome>((resolve) => {
    ports.port1.onmessage = (event) => {
      if (event.data?.pending || event.data?.stage) {
        pending.push(event.data);
        return;
      }
      resolve(event.data.outcome);
    };
  });
  world.page.receive({ channel: OWN_READ_CHANNEL, site: "claude", conversationId: CHAT }, [
    ports.port2,
  ]);
  return { answer, port: ports.port1, pending };
}

test("own read page: a cancel from the content script stops the read; nothing more is requested or imported", async () => {
  let held: AbortSignal | null = null;
  const world = pageWorld(repeatedReads(3), CHAT, `/chat/${CHAT}`, {
    responses: (input, init) => {
      if (input.endsWith("/1") && !held)
        return new Promise<Response>((_resolve, reject) => {
          held = init.signal!;
          init.signal!.addEventListener("abort", () => reject(new Error("aborted")));
        });
      return json("{}");
    },
  });
  const { answer, port } = askWith(world);
  await until(() => world.fetches.length === 2);
  port.postMessage({ cancel: true });
  assert.deepEqual(await answer, { kind: "declined" });
  assert.equal(held!.aborted, true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(world.fetches.length, 2, "no request after the cancel");
  assert.equal(world.observed.length, 1, "only the answer before the cancel was imported");
  // The page is free for the next read.
  assert.deepEqual(await world.ask(), { kind: "read" });
  assert.equal(world.fetches.length, 5);
  port.close();
});

test("own read page: a body that never ends is cut off by the time limit and frees the page", async () => {
  const realSetTimeout = globalThis.setTimeout;
  // Fire only the read's own time limit at once.
  globalThis.setTimeout = ((run: () => void, ms?: number) =>
    realSetTimeout(run, ms === OWN_READ_TIMEOUT_MS ? 0 : ms)) as typeof setTimeout;
  const stalled = () =>
    new Response(new ReadableStream({ start() {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  try {
    for (const kind of ["private", "read"] as const) {
      let calls = 0;
      const provider: OwnReadProvider = {
        site: "claude",
        async run(context) {
          calls++;
          const url = new URL("https://claude.ai/api/synthetic");
          if (kind === "private") {
            const answer = await context.fetchPrivate(url, { method: "GET" });
            return "kind" in answer ? answer : { kind: "read" };
          }
          const result = await context.read(url, { method: "GET" }, () => ({ ok: true, info: null }));
          return result.ok ? { kind: "read" } : result.outcome;
        },
      };
      let first = true;
      const world = pageWorld(provider, CHAT, `/chat/${CHAT}`, {
        responses: () => {
          if (!first) return json("{}");
          first = false;
          return stalled();
        },
      });
      assert.deepEqual(await world.ask(), { kind: "timeout" }, kind);
      // The stalled body still hangs, but the page takes the next read.
      assert.deepEqual(await world.ask(), { kind: "read" }, kind);
      assert.equal(calls, 2);
      assert.equal(world.observed.length, kind === "read" ? 1 : 0);
    }
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});

test("own read page: a body past the site's limit is refused as too large without being held", async () => {
  assert.equal(ownReadByteLimit("gemini"), HISTORY_LIMITS.wholeResponseBytes);
  assert.equal(ownReadByteLimit("notebooklm"), HISTORY_LIMITS.wholeResponseBytes);
  assert.ok(ownReadByteLimit("claude") >= HISTORY_LIMITS.wholeResponseBytes);
  let pulled = 0;
  let cancelled = false;
  const body = () =>
    new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(600));
        if (pulled >= 100) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
  const world = claudeWorld({
    cookie: `lastActiveOrg=${ORG}`,
    responses: () => new Response(body(), { headers: { "content-type": "application/json" } }),
    byteLimit: 1000,
  });
  assert.deepEqual(await world.ask(), { kind: "too_large" });
  assert.equal(cancelled, true);
  assert.ok(pulled < 10, "the rest of the body is never read");
  assert.equal(world.observed.length, 0);
  // Within the limit the history reader gets the same bytes the check read.
  const fits = claudeWorld({ cookie: `lastActiveOrg=${ORG}`, responses: [json(chatBody())] });
  assert.deepEqual(await fits.ask(), { kind: "read" });
  assert.equal(await (await fits.observed[0]!.response).text(), chatBody());
});

test("own read history: a Google batch body past the same limit is refused as too large", async () => {
  const stream = new ProviderHistoryStream(
    "gemini",
    "c_0000000000000042",
    "2026-10-14T10:00:00.000Z",
    async () => {},
  );
  const chunk = new Uint8Array(1048576);
  for (let i = 0; i < HISTORY_LIMITS.wholeResponseBytes / chunk.length; i++)
    await stream.write(chunk);
  await assert.rejects(stream.write(new Uint8Array(1)), /history_response_limit/);
});

test("own read page: a page read the history reader turned away unread neither stops nor skips the read", async () => {
  let release!: (response: Response) => void;
  const world = claudeWorld({
    cookie: `lastActiveOrg=${ORG}`,
    responses: [new Promise<Response>((resolve) => (release = resolve)), json(chatBody())],
  });
  const answer = world.ask();
  await tick();
  const signal = world.fetches[0]!.init.signal!;
  world.page.pageRead(new URL(EXACT_URL), "GET", undefined, true);
  assert.equal(signal.aborted, false);
  release(json(chatBody()));
  assert.deepEqual(await answer, { kind: "read" });
  // Asked for after the refusal, the same request is sent: the page's copy was never read.
  world.page.pageRead(new URL(EXACT_URL), "GET", undefined, true);
  assert.deepEqual(await world.ask(CHAT, { rejected: true }), { kind: "read" });
  assert.equal(world.fetches.length, 2);
});

test("own read runtime: an admission rejection of a page read does not stop the running read", async () => {
  let release!: (response: Response) => void;
  const fetches: AbortSignal[] = [];
  const observed: Array<string | undefined> = [];
  const historyText = {
    observe: (_url: URL, _method: string, _promise: unknown, _at: number, _body?: unknown, rejected?: string) => {
      observed.push(rejected);
      return undefined;
    },
  };
  Object.assign(globalThis, {
    window: globalThis,
    location: {
      origin: "https://claude.ai",
      hostname: "claude.ai",
      pathname: `/chat/${CHAT}`,
      href: `https://claude.ai/chat/${CHAT}`,
    },
  });
  const page = installOwnRead({
    site: "claude",
    historyText,
    fetch: ((_input: string, init: RequestInit) => {
      fetches.push(init.signal!);
      return new Promise<Response>((resolve) => (release = resolve));
    }) as typeof fetch,
    enabled: () => true,
  })!;
  const ports = portPair();
  const answer = new Promise<OwnReadOutcome>((resolve) => {
    ports.port1.onmessage = (event) => {
      if (event.data?.outcome) resolve(event.data.outcome);
    };
  });
  // The page's organization, from its own request.
  page.pageRequest(new URL(`https://claude.ai/api/organizations/${ORG}/chat_conversations?limit=30`), "GET");
  page.receive({ channel: OWN_READ_CHANNEL, site: "claude", conversationId: CHAT }, [ports.port2]);
  await until(() => fetches.length === 1);
  const pageUrl = new URL(`https://claude.ai/api/organizations/${ORG}/chat_conversations/${CHAT}?tree=True`);
  historyText.observe(pageUrl, "GET", null, Date.now(), undefined, "admission");
  assert.equal(fetches[0]!.aborted, false, "the turned-away read did not stop it");
  // A page read the reader took does stop it.
  historyText.observe(pageUrl, "GET", Promise.resolve(json(chatBody())), Date.now());
  assert.equal(fetches[0]!.aborted, true);
  assert.deepEqual(await answer, { kind: "page_read" });
  assert.deepEqual(observed, ["admission", undefined]);
  release(json(chatBody()));
  ports.port1.close();
});

test("own read page: provider requests are limited per window and a long read is paced, not stopped", async () => {
  const realSetTimeout = globalThis.setTimeout;
  let clock = 5_000_000;
  // Waits pass at once on a fake clock; the request time limit stays real (and is cleared).
  globalThis.setTimeout = ((run: () => void, ms?: number) => {
    if (ms === OWN_READ_TIMEOUT_MS) return realSetTimeout(run, ms);
    clock += ms ?? 0;
    return realSetTimeout(run, 0);
  }) as typeof setTimeout;
  try {
    const times: number[] = [];
    const total = 2 * OWN_READ_REQUESTS_PER_WINDOW;
    const world = pageWorld(repeatedReads(total), CHAT, `/chat/${CHAT}`, {
      responses: () => {
        times.push(clock);
        return json("{}");
      },
      now: () => clock,
    });
    const { answer, pending } = askWith(world);
    assert.deepEqual(await answer, { kind: "read" });
    assert.equal(times.length, total, "every request was sent");
    for (let i = 0; i + OWN_READ_REQUESTS_PER_WINDOW < times.length; i++)
      assert.ok(
        times[i + OWN_READ_REQUESTS_PER_WINDOW]! - times[i]! >= OWN_READ_WINDOW_MS,
        `request ${i + OWN_READ_REQUESTS_PER_WINDOW} waited for the window`,
      );
    assert.equal(times[OWN_READ_REQUESTS_PER_WINDOW - 1], times[0], "no wait below the limit");
    assert.ok(pending.length >= total, "the content script heard that the read goes on");
    // A new read while the window is still full is declined.
    assert.deepEqual(await world.ask(), { kind: "declined" });
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});

void createOwnReadPage;
