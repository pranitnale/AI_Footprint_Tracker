import test from "node:test";
import assert from "node:assert/strict";
import { GeminiDecoder } from "@footprint/capture-core";
import {
  base64Bytes,
  GEMINI_STREAM_GUARD,
  GEMINI_STREAM_UNREAD,
  geminiChannelReplies,
  geminiChannelRequestBody,
  geminiChannelSend,
  geminiStreamFrame,
  GeminiSession,
  parseDispatch,
  protoFields,
} from "../src";
import { channelMessage, pb, type Proto } from "./gemini-channel-fixture";

// Gemini's session channel as seen live on 19 Oct 2026: structure and field numbers only;
// ids, text and tokens are synthetic.
const CHAT = "c_00000000000000a1";
const TURN = "r_00000000000000b1";
const REPLY = "rc_00000000000000c1";
const TOKEN = "AwAAAAAAAAAQANsyntheticTokn";

const ids = (turn = TURN): Proto => [[2, [[1, CHAT], [2, turn]]]];
/** A content frame as seen: ids, the candidate, page state, a score table and the label. */
const answerFrame = (text: string, candidate: Proto = []): Proto => [
  ...ids(),
  [
    5,
    [
      [1, REPLY],
      [2, [[1, text]]],
      [9, [[1, 1]]],
      [10, "en"],
      [13, [[8, ""]]],
      [29, ""],
      [38, ""],
      ...candidate,
    ],
  ],
  [9, "XX"],
  [15, 0],
  [25, [[5, [[1, [[1, "A category"], [2, { f32: 0.25 }]]]]]]],
  [40, "0000000000000000"],
  [43, "3.8 Thinking"],
  [47, 2],
];

/** Reads frames as the capture does: in StreamGenerate's layout through the Gemini reader. */
function read(messages: Uint8Array[]) {
  const session = new GeminiSession();
  const decoder = new GeminiDecoder((value) => session.gemini(value));
  const encoder = new TextEncoder();
  decoder.push(encoder.encode(GEMINI_STREAM_GUARD));
  let final = false;
  const tokens: string[] = [];
  for (const message of messages) {
    const replies = geminiChannelReplies(message);
    assert.ok(replies);
    for (const reply of replies) {
      if (reply.inner) decoder.push(encoder.encode(geminiStreamFrame(reply.inner)));
      if (reply.turnToken) tokens.push(reply.turnToken);
      final ||= reply.final;
    }
  }
  decoder.finish();
  if (final) session.responseEnded();
  return { session, snapshot: session.snapshot(), final, tokens };
}
const unknown = (limitations: readonly string[]) =>
  limitations.includes("unknown_event_observed");

test("GC1 a channel reply reads as the same StreamGenerate reply: ids, answer, label, last frame and turn token", () => {
  const { snapshot, final, tokens, session } = read([
    // The first frame names the new chat with an empty turn.
    channelMessage(1, [[2, [[1, CHAT], [2, ""]]]]),
    channelMessage(2, [...ids(), [18, TURN], [21, "synthetic"]]),
    channelMessage(3, answerFrame("Soft")),
    channelMessage(4, answerFrame("Soft rain falls.")),
    channelMessage(5, answerFrame("Soft rain falls."), true),
    // After the last frame: the chat title and the turn's token.
    channelMessage(6, [...ids(), [11, [[1, "A title"]]]]),
    channelMessage(7, [...ids(), [26, TOKEN]]),
  ]);
  assert.equal(final, true);
  assert.deepEqual(tokens, [TOKEN]);
  assert.equal(snapshot.state, "completed");
  assert.equal(session.completionVerified(), true);
  assert.equal(snapshot.text, "Soft rain falls.");
  assert.equal(snapshot.thinking, "");
  assert.equal(snapshot.model, "3.8 Thinking");
  assert.equal(snapshot.outputId, REPLY);
  assert.equal(snapshot.conversationId, CHAT);
  assert.equal(snapshot.providerRequestId, TURN);
  assert.equal(snapshot.toolInput, "");
  assert.equal(snapshot.intermediate, "");
  assert.ok(!unknown(snapshot.limitations));
  // The same reply sent by StreamGenerate gives the same snapshot.
  const json: unknown[] = [];
  json[1] = [CHAT, TURN];
  const candidate: unknown[] = [REPLY, ["Soft rain falls."]];
  json[4] = [candidate];
  json[42] = "3.8 Thinking";
  const old = new GeminiSession();
  old.gemini([["wrb.fr", null, JSON.stringify(json)]]);
  old.responseEnded();
  assert.deepEqual(old.snapshot(), snapshot);
});

test("GC2 thoughts read as shown text in either layout; thoughts without their text stay unknown, as before", () => {
  for (const thoughts of [
    [[1, [[1, "Thinking about it."]]]],
    [[1, "Thinking about it."]],
  ] as Proto[]) {
    const { snapshot } = read([
      channelMessage(1, answerFrame("An answer.", [[38, thoughts]]), true),
    ]);
    assert.equal(snapshot.thinking, "Thinking about it.", JSON.stringify(thoughts));
    assert.ok(!unknown(snapshot.limitations));
  }
  // Only tool steps (seen on 19 Oct when the model ran code): a JSON frame `[null, steps]`
  // left the reply partial too.
  const steps = read([
    channelMessage(
      1,
      answerFrame("An answer.", [[38, [[2, [[1, ""], [2, "Analysed"]]]]]]),
      true,
    ),
  ]).snapshot;
  assert.equal(steps.text, "An answer.");
  assert.equal(steps.thinking, null);
  assert.ok(unknown(steps.limitations));
});

test("GC3 tool data and documents with text stay unread and partial; flags and empty fields are not content", () => {
  for (const [extra, partial] of [
    [[[13, [[8, ""], [33, [[2, [[5, 4]]]]]]]], false],
    [[[13, [[8, [[1, [[1, "an image record"]]]]]]]], true],
    [[[31, [[1, "a document id"], [5, "Document text."]]]], true],
  ] as Array<[Proto, boolean]>) {
    const { snapshot } = read([channelMessage(1, answerFrame("An answer.", extra), true)]);
    assert.equal(snapshot.text, "An answer.");
    assert.equal(unknown(snapshot.limitations), partial, JSON.stringify(extra));
  }
  // A reply without the last frame is not complete.
  const open = read([channelMessage(1, answerFrame("Half"))]);
  assert.equal(open.final, false);
  assert.equal(open.snapshot.state, "generating");
});

test("GC4 unreadable channel data is refused, and an unknown row leaves a reply partial", () => {
  assert.equal(geminiChannelReplies(new Uint8Array([0x0a, 0x05, 0x01])), null);
  assert.equal(base64Bytes("not base64!"), null);
  assert.deepEqual(base64Bytes("CgA="), new Uint8Array([0x0a, 0x00]));
  // An acknowledgement (`.1 ""`) carries no reply.
  assert.deepEqual(geminiChannelReplies(pb([[1, ""]])), []);
  assert.equal(protoFields(new Uint8Array([0x08])), null);
  const session = new GeminiSession();
  const decoder = new GeminiDecoder((value) => session.gemini(value));
  const encoder = new TextEncoder();
  decoder.push(encoder.encode(GEMINI_STREAM_GUARD));
  const [reply] = geminiChannelReplies(channelMessage(1, answerFrame("Kept"), true))!;
  decoder.push(encoder.encode(geminiStreamFrame(reply!.inner!)));
  decoder.push(encoder.encode(GEMINI_STREAM_UNREAD));
  assert.equal(session.snapshot().text, "Kept");
  assert.ok(unknown(session.snapshot().limitations));
});

test("GC5 the page's posts: setup names the chat and previous turn token, then the prompt, then the close", () => {
  const setup = (chat?: Proto) => {
    const request: Proto = [
      [1, [[1, ""], [2, 0]]],
      [4, "synthetic"],
    ];
    if (chat) request.push([72, chat]);
    return pb([
      [
        1,
        [
          [1, [[1, 1], [2, "0000000000000000"]]],
          [2, 0],
          [8, [[5, [[1, request], [4, 1]]]]],
        ],
      ],
    ]);
  };
  assert.deepEqual(geminiChannelSend(setup()), {
    kind: "setup",
    conversationId: null,
    turnToken: null,
  });
  assert.deepEqual(geminiChannelSend(setup([[1, CHAT], [8, TOKEN]])), {
    kind: "setup",
    conversationId: CHAT,
    turnToken: TOKEN,
  });
  assert.deepEqual(
    geminiChannelSend(pb([[2, [[1, 1], [9, [[1, "Test prompt"]]]]]])),
    { kind: "prompt", text: "Test prompt" },
  );
  assert.deepEqual(geminiChannelSend(pb([[4, [[1, 1]]]])), { kind: "close" });
  assert.deepEqual(geminiChannelSend(pb([[3, 1]])), { kind: "other" });
  // The send reads as a StreamGenerate send: a new chat, a follow-up whose previous reply
  // is known, and one whose previous reply is not (its context stays unknown).
  const url = new URL(
    "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate",
  );
  const first = parseDispatch("gemini", url, geminiChannelRequestBody("Hello", null, null));
  assert.equal(first.input, "Hello");
  assert.equal(first.conversationId, null);
  assert.equal(first.parentId, null);
  const known = parseDispatch("gemini", url, geminiChannelRequestBody("Next", CHAT, REPLY));
  assert.equal(known.conversationId, CHAT);
  assert.equal(known.parentId, REPLY);
  const unresolved = parseDispatch("gemini", url, geminiChannelRequestBody("Next", CHAT, TOKEN));
  assert.equal(unresolved.conversationId, CHAT);
  assert.equal(unresolved.parentId, TOKEN);
});
