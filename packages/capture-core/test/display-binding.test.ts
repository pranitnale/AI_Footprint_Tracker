import assert from "node:assert/strict";
import test from "node:test";
import {
  isDisplayBinding,
  isConversationIdentity,
  matchesDisplayContext,
  type DisplayBinding,
  type DisplayContext,
} from "../src/display-binding";

const documentNonce = "00000000-0000-4000-8000-000000000001";
const navigationNonce = "00000000-0000-4000-8000-000000000002";
const nextNavigation = "00000000-0000-4000-8000-000000000003";
const captureId = "00000000-0000-4000-8000-000000000004";
const identity = {
  site: "gemini",
  conversationId: "c_0123456789abcdef",
} as const;
const binding: DisplayBinding = { documentNonce, navigationNonce, captureId };
const context: DisplayContext = {
  documentNonce,
  navigationNonce,
  selectedCaptureId: captureId,
  route: identity,
};

test("display binding accepts only exact UUIDv4 local envelopes and verified route identities", () => {
  assert.equal(isDisplayBinding(binding, captureId), true);
  assert.equal(isDisplayBinding({ ...binding, captureId: null }, null), true);
  for (const invalid of [
    null,
    [],
    { ...binding, text: "private-marker" },
    { ...binding, documentNonce: "invalid" },
    { ...binding, navigationNonce: "00000000-0000-1000-8000-000000000002" },
    { ...binding, captureId: nextNavigation },
  ])
    assert.equal(isDisplayBinding(invalid, captureId), false);
  assert.equal(isConversationIdentity(identity), true);
  for (const invalid of [
    null,
    { ...identity, raw: "private-marker" },
    { ...identity, site: "perplexity" },
    { ...identity, conversationId: "0123456789abcdef" },
    { ...identity, conversationId: "c_0123456789ABCDEf" },
  ])
    assert.equal(isConversationIdentity(invalid), false);
});

test("active replies require the selected capture and document while verified promotion can cross navigation", () => {
  assert.equal(matchesDisplayContext(binding, identity, context), true);
  assert.equal(
    matchesDisplayContext(binding, identity, {
      ...context,
      navigationNonce: nextNavigation,
    }),
    true,
  );
  assert.equal(
    matchesDisplayContext(binding, identity, {
      ...context,
      documentNonce: nextNavigation,
    }),
    false,
  );
  assert.equal(
    matchesDisplayContext(binding, identity, {
      ...context,
      selectedCaptureId: nextNavigation,
    }),
    false,
  );
  assert.equal(matchesDisplayContext(binding, null, context), false);
  assert.equal(
    matchesDisplayContext(
      binding,
      { ...identity, conversationId: "c_fedcba9876543210" },
      context,
    ),
    false,
  );
  assert.equal(
    matchesDisplayContext(binding, null, { ...context, route: null }),
    true,
  );
  assert.equal(
    matchesDisplayContext(binding, null, {
      ...context,
      route: null,
      navigationNonce: nextNavigation,
    }),
    false,
  );
});

test("route replies require their original query navigation and exact known identity", () => {
  const query = { ...binding, captureId: null };
  assert.equal(matchesDisplayContext(query, identity, context), true);
  assert.equal(
    matchesDisplayContext(query, identity, {
      ...context,
      navigationNonce: nextNavigation,
    }),
    false,
  );
  assert.equal(
    matchesDisplayContext(query, identity, { ...context, route: null }),
    false,
  );
  assert.equal(matchesDisplayContext(query, null, context), false);
});
