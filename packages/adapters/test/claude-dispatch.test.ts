import assert from "node:assert/strict";
import test from "node:test";
import { LIMITS, safeJson } from "@footprint/capture-core";
import {
  claudeSendAction,
  generationRoute,
  parseDispatch,
} from "../src/index";

const endpoint = new URL(
  "https://claude.ai/api/organizations/synthetic/chat_conversations/00000000-0000-4000-8000-000000000001/completion",
);
const input = { prompt: "Synthetic prompt", attachments: [], files: [] };
const nested = (depth: number): unknown =>
  depth ? { properties: nested(depth - 1) } : { type: "string" };

test("Claude ignores deep tool definitions when projecting live dispatch evidence", () => {
  const body = JSON.stringify({ ...input, tools: [nested(LIMITS.depth + 4)] });
  assert.throws(() => safeJson(body), /buffer_overflow/);
  const result = parseDispatch("claude", endpoint, body);
  assert.equal(result.input, input.prompt);
  assert.equal(result.conversationId, endpoint.pathname.split("/")[5]);
  assert.deepEqual(result.inlineFiles, []);
  assert.equal(result.attachments, 0);
  assert.equal(Object.hasOwn(result, "tools"), false);
});

test("Claude still rejects malformed, oversized and unsafe consumed request fields", () => {
  for (const body of ["{", " ".repeat(LIMITS.frame + 1)])
    assert.throws(() => parseDispatch("claude", endpoint, body));
  for (const root of [null, [], "text", 7])
    assert.throws(
      () => parseDispatch("claude", endpoint, JSON.stringify(root)),
      /unsupported_schema/,
    );
  assert.throws(
    () =>
      parseDispatch(
        "claude",
        endpoint,
        JSON.stringify({ ...input, attachments: [nested(LIMITS.depth + 4)] }),
      ),
    /buffer_overflow/,
  );
  assert.throws(
    () =>
      parseDispatch(
        "claude",
        endpoint,
        '{"prompt":"test","files":[],"attachments":[{"__proto__":{}}]}',
      ),
    /malformed_frame/,
  );
  assert.throws(
    () =>
      parseDispatch(
        "claude",
        endpoint,
        JSON.stringify({ ...input, prompt: { text: "invalid" } }),
      ),
    /unsupported_schema/,
  );
});

test("Claude completion2 routes are generation routes and retry_completion2 regenerates", () => {
  const base = endpoint.href.replace(/\/completion$/, "");
  for (const [route, action] of [
    ["completion", "send"],
    ["completion2", "send"],
    ["retry_completion", "regenerate"],
    ["retry_completion2", "regenerate"],
  ] as const) {
    const url = new URL(`${base}/${route}`);
    assert.equal(generationRoute("claude", url, "POST"), true, route);
    assert.equal(
      parseDispatch("claude", url, JSON.stringify(input)).action,
      action,
      route,
    );
  }
  for (const route of ["completion3", "completion2x", "stop_response"])
    assert.equal(
      generationRoute("claude", new URL(`${base}/${route}`), "POST"),
      false,
      route,
    );
});

// claude.ai's merged app (18 Nov 2026) sends, stops and opens chats through one call with a
// protobuf body. Synthetic bodies in the shape probed on 22 Nov 2026 (structure only).
test("a PerformAction send is recognised from its body, an open or a stop is not", () => {
  const action = new URL(
    "https://claude.ai/claudeai-rpc/anthropic.bard.api.v1alpha.ConversationService/PerformAction",
  );
  const varint = (value: number) => {
    const out: number[] = [];
    do {
      const low = value % 128;
      value = Math.floor(value / 128);
      out.push(value ? low + 128 : low);
    } while (value);
    return out;
  };
  const text = (value: string) => [...new TextEncoder().encode(value)];
  const bytes = (field: number, payload: number[]) => [
    ...varint(field * 8 + 2),
    ...varint(payload.length),
    ...payload,
  ];
  const number = (field: number, value: number) => [...varint(field * 8), ...varint(value)];
  // Field 1 is the context: 1.2 the chat's id, 1.3 always 3.
  const context = bytes(1, [
    ...bytes(2, text("00000000-0000-4000-8000-000000000001")),
    ...number(3, 3),
  ]);
  const body = (...fields: number[][]) => Uint8Array.from([...context, ...fields.flat()]);
  const message = (prompt: string) =>
    bytes(2, [
      ...bytes(1, text("00000000-0000-4000-8000-000000000002")),
      ...bytes(2, text("00000000-0000-4000-8000-000000000003")),
      ...bytes(3, text(prompt)),
      ...number(59, 1),
    ]);
  const send = body(message("synthetic prompt"));
  const isSend = (value: unknown, url = action, method = "POST") =>
    claudeSendAction(url, method, value);
  assert.equal(isSend(send), true);
  // A retry and an edit are sends too; a long prompt has a two-byte length.
  assert.equal(isSend(body(message("p".repeat(300)))), true);
  // The body as a buffer, and as a view into a larger buffer.
  assert.equal(isSend(send.buffer), true);
  const padded = new Uint8Array(send.length + 8);
  padded.set(send, 4);
  assert.equal(isSend(padded.subarray(4, 4 + send.length)), true);
  // Fields of other kinds before the message are passed over.
  assert.equal(
    isSend(
      Uint8Array.from([
        ...context,
        ...varint(4 * 8),
        ...Array(9).fill(0xff),
        0x01,
        ...varint(6 * 8 + 1),
        ...Array(8).fill(0),
        ...varint(7 * 8 + 5),
        ...Array(4).fill(0),
        ...message("synthetic prompt"),
      ]),
    ),
    true,
  );
  // Opening a chat and the warm-up before a send carry field 15, a stop field 3. The
  // context's own field 2 is not at the top level.
  assert.equal(isSend(body(bytes(15, []))), false);
  assert.equal(isSend(body(bytes(15, bytes(1, number(12, 1))))), false);
  assert.equal(isSend(body(bytes(3, number(2, 1)))), false);
  assert.equal(isSend(Uint8Array.from(context)), false);
  // A top-level field 2 that is not a message, a body cut short, and bodies of other kinds.
  assert.equal(isSend(body(number(2, 1))), false);
  assert.equal(isSend(send.subarray(0, send.length - 3)), false);
  assert.equal(isSend(new Uint8Array(0)), false);
  assert.equal(isSend("synthetic"), false);
  assert.equal(isSend(null), false);
  assert.equal(isSend(Uint8Array.from([...send, 0x07])), false);
  // Only the send call, by POST.
  assert.equal(isSend(send, action, "GET"), false);
  assert.equal(
    isSend(
      send,
      new URL(
        "https://claude.ai/claudeai-rpc/anthropic.bard.api.v1alpha.ConversationService/StreamTimeline",
      ),
    ),
    false,
  );
});
