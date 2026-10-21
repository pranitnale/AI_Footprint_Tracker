import assert from "node:assert/strict";
import test from "node:test";
import { LIMITS, safeJson } from "@footprint/capture-core";
import { generationRoute, parseDispatch } from "../src/index";

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
