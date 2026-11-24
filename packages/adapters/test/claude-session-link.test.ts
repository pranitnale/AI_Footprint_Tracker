import test from "node:test";
import assert from "node:assert/strict";
import {
  claudeChatListLinks,
  claudeLinkRequest,
  claudeReadSessionLink,
  claudeReadSessionRequest,
  claudeSessionObject,
} from "../src/history";

// Synthetic answers in the shapes seen on 18 and 22 Nov 2026 (structure only).
const ORG = "7b7d8ded-0000-4000-8000-000000000001";
const SESSION = "cse_0123456789ABCDEFghijklmn";
const OTHER = "cse_ZYXWVUTSRQPONMLKjihgfedc";
const chat = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const url = (path: string) => new URL(path, "https://claude.ai");
const session = (extra: object = {}) => ({
  id: SESSION,
  environment_kind: "ccs",
  tags: [
    "bard-person-conversation",
    `bard-conversation:${chat(1)}`,
    "cowork-remote",
  ],
  external_metadata: {
    usage: {
      input_tokens: 12,
      output_tokens: 581,
      cache_read_tokens: 150000,
      cache_write_tokens: 3000,
      cost_usd: 0.1,
    },
  },
  ...extra,
});

test("link requests: the chat list and a session object, read requests only", () => {
  assert.deepEqual(
    claudeLinkRequest(
      url(
        `/api/organizations/${ORG}/chat_conversations_v2?limit=30&offset=0&archived=false`,
      ),
      "GET",
    ),
    { kind: "list" },
  );
  assert.deepEqual(
    claudeLinkRequest(
      url(`/v1/code/sessions/${SESSION}?omit_bound_device=true`),
      "GET",
    ),
    { kind: "session", session: SESSION },
  );
  for (const [path, method] of [
    [`/v1/code/sessions/${SESSION}`, "POST"],
    [`/v1/code/sessions/${SESSION}/events`, "GET"],
    ["/v1/code/sessions", "GET"],
    [`/api/organizations/${ORG}/chat_conversations/${chat(1)}`, "GET"],
    [`/api/organizations/${ORG}/chat_conversations_v2`, "POST"],
    [`/api/organizations/${ORG}/chat_conversations_v2/more`, "GET"],
  ] as const)
    assert.equal(claudeLinkRequest(url(path), method), null, `${method} ${path}`);
});

test("a list row with a session id links its chat", () => {
  const rows = [
    { uuid: chat(1), workspace_upgraded: true, workspace_session_id: SESSION },
    { uuid: chat(2), workspace_upgraded: false },
    { uuid: chat(3), workspace_upgraded: true, workspace_session_id: OTHER },
  ];
  const expected = [
    { chat: chat(1), session: SESSION },
    { chat: chat(3), session: OTHER },
  ];
  assert.deepEqual(claudeChatListLinks(rows), expected);
  // The same rows inside an object, as paged lists often arrive.
  assert.deepEqual(claudeChatListLinks({ data: rows }), expected);
});

test("list rows that cannot prove a link give none", () => {
  for (const rows of [
    null,
    "rows",
    { rows: [] },
    [{ uuid: chat(1) }],
    [{ uuid: chat(1), workspace_session_id: "cse_short" }],
    [{ uuid: "not-a-chat", workspace_session_id: SESSION }],
    // A row that says it was not upgraded contradicts its own session id.
    [{ uuid: chat(1), workspace_upgraded: false, workspace_session_id: SESSION }],
    [null, 7, "x"],
  ])
    assert.deepEqual(claudeChatListLinks(rows), [], JSON.stringify(rows));
});

test("a chat or a session named twice with different partners links nothing", () => {
  assert.deepEqual(
    claudeChatListLinks([
      { uuid: chat(1), workspace_session_id: SESSION },
      { uuid: chat(1), workspace_session_id: OTHER },
      { uuid: chat(2), workspace_session_id: OTHER },
    ]),
    [],
  );
  // The same pair listed twice is one link.
  assert.deepEqual(
    claudeChatListLinks([
      { uuid: chat(1), workspace_session_id: SESSION },
      { uuid: chat(1), workspace_session_id: SESSION },
    ]),
    [{ chat: chat(1), session: SESSION }],
  );
});

test("a session object names its chat by tag, wrapped and plain", () => {
  const expected = {
    chat: chat(1),
    totals: { output: 581, input: 12, cacheRead: 150000, cacheWrite: 3000 },
  };
  assert.deepEqual(claudeSessionObject(session(), SESSION), expected);
  assert.deepEqual(
    claudeSessionObject({ response_shape: session() }, SESSION),
    expected,
  );
});

test("a session without the chat's tag links nothing but keeps its totals", () => {
  // An old Cowork session: no chat tag (seen 18 Nov 2026).
  assert.deepEqual(
    claudeSessionObject(
      session({ tags: ["cowork-remote"], environment_kind: "anthropic_cloud" }),
      SESSION,
    ),
    {
      chat: null,
      totals: { output: 581, input: 12, cacheRead: 150000, cacheWrite: 3000 },
    },
  );
  // Two different chats in the tags prove neither.
  assert.equal(
    claudeSessionObject(
      session({
        tags: [`bard-conversation:${chat(1)}`, `bard-conversation:${chat(2)}`],
      }),
      SESSION,
    )?.chat,
    null,
  );
  assert.equal(
    claudeSessionObject(session({ tags: ["bard-conversation:not-a-chat"] }), SESSION)
      ?.chat,
    null,
  );
});

test("a session object of another session, or of an unknown shape, is not read", () => {
  assert.equal(claudeSessionObject(session({ id: OTHER }), SESSION), null);
  for (const value of [null, [], "x", 5])
    assert.equal(claudeSessionObject(value, SESSION), null);
  assert.equal(claudeSessionObject(session(), "not-a-session"), null);
});

test("session totals need a readable output count; other counts may be missing", () => {
  assert.deepEqual(
    claudeSessionObject(
      session({ external_metadata: { usage: { output_tokens: 63 } } }),
      SESSION,
    )?.totals,
    { output: 63, input: null, cacheRead: null, cacheWrite: null },
  );
  for (const usage of [undefined, null, {}, { output_tokens: -1 }, { output_tokens: "63" }])
    assert.equal(
      claudeSessionObject(session({ external_metadata: { usage } }), SESSION)
        ?.totals,
      null,
      JSON.stringify(usage),
    );
  assert.equal(
    claudeSessionObject(session({ external_metadata: undefined }), SESSION)
      ?.totals,
    null,
  );
});

// A Cowork session from before the merge: no list row and no tag name its chat address. The
// page's own ReadCoworkSession call does (probe of 22 Nov 2026): request {1: session id, 3: 1,
// 4: 1}, answer {3: {2: 1}, 4: <two characters and the address uuid>, 5: 1}.
test("a ReadCoworkSession call links the session it asks for to the address in its answer", () => {
  const ascii = (text: string) => [...text].map((letter) => letter.charCodeAt(0));
  const address = "8ee80eda-0000-8000-8000-0000000000c8";
  const request = (id: string) =>
    new Uint8Array([0x0a, id.length, ...ascii(id), 0x18, 1, 0x20, 1]);
  const answer = (text: string) =>
    new Uint8Array([0x1a, 2, 0x10, 1, 0x22, text.length, ...ascii(text), 0x28, 1]);
  const path =
    "/claudeai-rpc/anthropic.bard.api.v1alpha.ConversationService/ReadCoworkSession";
  assert.equal(claudeReadSessionRequest(url(path), "POST"), true);
  assert.equal(claudeReadSessionRequest(url(path), "GET"), false);
  assert.equal(
    claudeReadSessionRequest(url(path.replace("ReadCoworkSession", "PerformAction")), "POST"),
    false,
  );
  assert.deepEqual(claudeReadSessionLink(request(SESSION), answer(`c_${address}`)), {
    chat: address,
    session: SESSION,
  });
  // Nothing is linked unless each body holds exactly one id of its kind.
  for (const [asked, answered] of [
    [request(SESSION), answer("c_no-address-here")],
    [request(SESSION), answer(`${address} ${chat(2)}`)],
    [new Uint8Array([...request(SESSION), ...request(OTHER)]), answer(`c_${address}`)],
    [new Uint8Array([0x18, 1, 0x20, 1]), answer(`c_${address}`)],
    [new Uint8Array(5000), answer(`c_${address}`)],
    [request(SESSION), new Uint8Array(70000)],
  ] as const)
    assert.equal(claudeReadSessionLink(asked, answered), null);
});
