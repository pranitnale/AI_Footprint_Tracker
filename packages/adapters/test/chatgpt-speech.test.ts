import test from "node:test";
import assert from "node:assert/strict";
import {
  AdtsCounter,
  ChatgptReadAloudSession,
  PACKAGED_PROVIDER_ADAPTERS,
  generationRoute,
  parseDispatch,
} from "../src/index";

// Synthetic AAC in ADTS frames, shaped like ChatGPT's read-aloud audio (3 Oct: 24 kHz mono).
function frame(
  payload = 20,
  options: { crc?: boolean; blocks?: number; rate?: number } = {},
) {
  const header = options.crc ? 9 : 7;
  const length = header + payload;
  const bytes = new Uint8Array(length);
  bytes[0] = 0xff;
  bytes[1] = 0xf0 | (options.crc ? 0 : 1);
  // AAC LC, sample rate index, one channel.
  bytes[2] = (1 << 6) | ((options.rate ?? 6) << 2);
  bytes[3] = (1 << 6) | ((length >> 11) & 0x03);
  bytes[4] = (length >> 3) & 0xff;
  bytes[5] = ((length & 0x07) << 5) | 0x1f;
  bytes[6] = 0xfc | ((options.blocks ?? 1) - 1);
  return bytes;
}
const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};
const split = (bytes: Uint8Array, sizes: number[]) => {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  for (let i = 0; offset < bytes.length; i++) {
    const size = sizes[i % sizes.length]!;
    chunks.push(bytes.subarray(offset, offset + size));
    offset += size;
  }
  return chunks;
};
const url = (
  query = "message_id=answer-1&conversation_id=conv-1&voice=ember&format=aac",
) => new URL(`https://chatgpt.com/backend-api/synthesize?${query}`);

test("G1 AAC frames give the speech length however the stream is split", () => {
  const audio = join(...Array.from({ length: 50 }, () => frame(37)));
  for (const sizes of [[audio.length], [1], [3, 7, 11], [6, 9, 400]]) {
    const counter = new AdtsCounter();
    for (const chunk of split(audio, sizes)) counter.push(chunk);
    assert.equal(counter.frames, 50, String(sizes));
    assert.equal(counter.failed, false);
    assert.ok(Math.abs(counter.seconds - (50 * 1024) / 24000) < 1e-9);
  }
  // A protected header, several raw blocks and another sample rate are read too.
  const mixed = new AdtsCounter();
  mixed.push(
    join(
      frame(10, { crc: true }),
      frame(10, { blocks: 2 }),
      frame(10, { rate: 3 }),
    ),
  );
  assert.equal(mixed.frames, 4);
  assert.ok(
    Math.abs(mixed.seconds - ((3 * 1024) / 24000 + 1024 / 48000)) < 1e-9,
  );
});

test("G1 an ID3 tag is skipped, a closing tag ends the audio, and other data stops the count", () => {
  const id3 = new Uint8Array(10 + 25);
  id3.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 25]);
  const tagged = new AdtsCounter();
  tagged.push(join(id3, frame(), frame()));
  assert.equal(tagged.frames, 2);
  assert.equal(tagged.failed, false);
  const trailer = new AdtsCounter();
  trailer.push(
    join(frame(), frame(), new TextEncoder().encode("TAG" + "x".repeat(125))),
  );
  assert.equal(trailer.frames, 2);
  assert.equal(trailer.failed, false);
  const other = new AdtsCounter();
  other.push(new TextEncoder().encode("OggS not aac at all"));
  assert.equal(other.failed, true);
  assert.equal(other.frames, 0);
});

test("G1 a read-aloud request is its own speech generation without a prompt or a turn", () => {
  assert.equal(generationRoute("chatgpt", url(), "GET"), true);
  assert.equal(generationRoute("chatgpt", url(), "POST"), false);
  assert.equal(
    generationRoute(
      "chatgpt",
      new URL("https://chatgpt.com/backend-api/conversations/x"),
      "GET",
    ),
    false,
  );
  assert.equal(
    generationRoute(
      "claude",
      new URL("https://claude.ai/backend-api/synthesize"),
      "GET",
    ),
    false,
  );
  const dispatch = parseDispatch("chatgpt", url(), "");
  assert.deepEqual(
    {
      action: dispatch.action,
      input: dispatch.input,
      conversationId: dispatch.conversationId,
      parentId: dispatch.parentId,
      requestId: dispatch.requestId,
      model: dispatch.model,
      attachments: dispatch.attachments,
      inputImages: dispatch.inputImages,
    },
    {
      action: "read_aloud",
      input: "",
      conversationId: "conv-1",
      parentId: null,
      requestId: null,
      model: null,
      attachments: 0,
      inputImages: [],
    },
  );
  const session =
    PACKAGED_PROVIDER_ADAPTERS.get("chatgpt")!.createSession(url());
  assert.ok(session instanceof ChatgptReadAloudSession);
  assert.equal(session.readMessageId, "answer-1");
});

test("G1 the read-aloud reply is timed by its frames, up to a stop, and falls back to the read text", () => {
  const session = new ChatgptReadAloudSession(url());
  assert.equal(session.snapshot().started, false);
  assert.equal(session.snapshot().text, null);
  const audio = join(...Array.from({ length: 24 }, () => frame()));
  session.bytes(audio.subarray(0, 100));
  assert.equal(session.snapshot().state, "generating");
  session.bytes(audio.subarray(100));
  session.bytesEnded();
  const done = session.snapshot();
  assert.equal(done.state, "completed");
  assert.equal(done.conversationId, "conv-1");
  assert.equal(done.text, "");
  assert.equal(done.thinking, "");
  assert.deepEqual(done.media, [
    {
      kind: "speech",
      basis: "audio_frames",
      seconds: (24 * 1024) / 24000,
      characters: null,
    },
  ]);
  assert.equal(done.limitations.includes("unknown_event_observed"), false);
  assert.equal(session.completionVerified(), true);
  // A stop keeps the speech received until then.
  const stopped = new ChatgptReadAloudSession(url());
  stopped.bytes(audio.subarray(0, frame().length * 3));
  stopped.stopped();
  assert.equal(stopped.snapshot().state, "cancelled");
  assert.deepEqual(stopped.snapshot().media, [
    {
      kind: "speech",
      basis: "audio_frames",
      seconds: (3 * 1024) / 24000,
      characters: null,
    },
  ]);
  assert.equal(stopped.completionVerified(), false);
  // Audio in another format uses the read message's characters at the reading rate.
  const other = new ChatgptReadAloudSession(url());
  other.bytes(new TextEncoder().encode("OggS opus audio"));
  other.bytesEnded();
  assert.deepEqual(
    other.snapshot().limitations.includes("unknown_event_observed"),
    true,
  );
  assert.equal(other.snapshot().media, undefined);
  other.readCharacters(340);
  assert.deepEqual(other.snapshot().media, [
    { kind: "speech", basis: "characters", seconds: null, characters: 340 },
  ]);
  assert.equal(
    other.snapshot().limitations.includes("unknown_event_observed"),
    false,
  );
  // A request with nothing received generated nothing that was seen.
  const empty = new ChatgptReadAloudSession(url("message_id=x"));
  empty.bytesEnded();
  assert.equal(empty.snapshot().started, false);
  assert.equal(empty.snapshot().media, undefined);
  assert.equal(empty.snapshot().conversationId, null);
});

test("G1 a frame counts once all its bytes arrived, so a stop never counts a cut frame", () => {
  const whole = frame(200);
  const counter = new AdtsCounter();
  counter.push(whole.subarray(0, 7));
  assert.equal(counter.frames, 0);
  counter.push(whole.subarray(7, 150));
  assert.equal(counter.frames, 0);
  counter.push(whole.subarray(150));
  assert.equal(counter.frames, 1);
  assert.equal(counter.seconds, 1024 / 24000);
  const session = new ChatgptReadAloudSession(url());
  session.bytes(join(frame(), frame(), whole.subarray(0, 50)));
  session.stopped();
  assert.deepEqual(session.snapshot().media, [
    {
      kind: "speech",
      basis: "audio_frames",
      seconds: (2 * 1024) / 24000,
      characters: null,
    },
  ]);
  // A frame of header only is whole at once.
  const empty = new AdtsCounter();
  empty.push(frame(0));
  assert.equal(empty.frames, 1);
});
