import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SseDecoder,
  GeminiDecoder,
  patchAt,
  safeJson,
  CaptureError,
  LIMITS,
  siteForHost,
} from "../src/index";

test("SSE byte-split Unicode and multi-line events preserve code points", () => {
  const frames: any[] = [];
  const decoder = new SseDecoder((f) => frames.push(f));
  const wire =
    ': ping\r\nevent: delta\r\ndata: {"text":\r\ndata: "é é 🌿 你好"}\r\n\r\n';
  for (const byte of new TextEncoder().encode(wire))
    decoder.push(new Uint8Array([byte]));
  decoder.finish();
  assert.equal(frames[0].value.text, "é é 🌿 你好");
  assert.equal(frames.length, 1);
});
test("Gemini framing is UTF16 length after UTF8 decoding", () => {
  const value = [
    [
      "wrb.fr",
      null,
      JSON.stringify([null, null, null, null, [["selected", ["🌿 é"]]]]),
    ],
  ];
  const payload = "\n" + JSON.stringify(value) + "\n";
  const wire = ")]}'\n\n" + payload.length + payload;
  const frames: any[] = [];
  const d = new GeminiDecoder((v) => frames.push(v));
  for (const b of new TextEncoder().encode(wire)) d.push(Uint8Array.of(b));
  d.finish();
  assert.deepEqual(frames, [value]);
});
test("Truncation, oversized frames and prototype writes fail closed", () => {
  const d = new SseDecoder(() => {});
  d.pushText("data: {");
  assert.throws(() => d.finish(), /capture_interrupted/);
  assert.throws(
    () => new SseDecoder(() => {}).pushText("x".repeat(LIMITS.frame + 1)),
    /buffer_overflow/,
  );
  assert.throws(
    () => safeJson('{"__proto__":{"polluted":true}}'),
    /malformed_frame/,
  );
  assert.throws(
    () => patchAt({}, "/constructor/prototype/x", "add", true),
    /malformed_frame/,
  );
  assert.equal(({} as any).polluted, undefined);
});
test("Type-aware patches do not coerce values or silently create parents", () => {
  const root = { answer: ["one"], metadata: {} };
  patchAt(root, "/answer/0", "append", " two");
  assert.deepEqual(root.answer, ["one two"]);
  assert.throws(
    () => patchAt(root, "/answer/0", "append", 2),
    /unsupported_schema/,
  );
  assert.throws(
    () => patchAt(root, "/missing/child", "add", "x"),
    /unsupported_schema/,
  );
  assert.throws(
    () => patchAt(root, "/answer/999", "add", "x"),
    /unsupported_schema/,
  );
});
test("Patches keep the frame's depth and size bounds", () => {
  const deep = (depth: number): unknown =>
    depth ? { child: deep(depth - 1) } : "leaf";
  const tree: any = { a: { b: {} } };
  // A value grafted deep down would pass the bound counted from its own root.
  assert.throws(
    () => patchAt(tree, "/a/b/c", "add", deep(LIMITS.depth - 2)),
    /buffer_overflow/,
  );
  patchAt(tree, "/a/b/c", "add", deep(3));
  assert.equal(tree.a.b.c.child.child.child, "leaf");
  const list: any = { items: Array(LIMITS.items).fill("") };
  assert.throws(
    () => patchAt(list, "/items/" + LIMITS.items, "add", ""),
    /buffer_overflow/,
  );
  const wide: any = {
    map: Object.fromEntries(
      Array.from({ length: LIMITS.items }, (_, index) => ["k" + index, 1]),
    ),
  };
  assert.throws(() => patchAt(wide, "/map/extra", "add", 1), /buffer_overflow/);
  assert.throws(
    () => patchAt(wide, "/map", "append", { extra: 1 }),
    /buffer_overflow/,
  );
  // Replacing an existing key does not grow the object.
  patchAt(wide, "/map/k0", "replace", 2);
  assert.equal(wide.map.k0, 2);
});
test("Provider allowlist rejects lookalike hosts", () => {
  assert.equal(siteForHost("claude.ai.evil.test"), null);
  assert.equal(siteForHost("claude.ai"), "claude");
});
// Signed-out ChatGPT streams a reply as one JSON object per line (live, 20 Oct 2026).
test("JSON lines split across chunks and code points are read whole, in order", async () => {
  const { JsonLinesDecoder } = (await import("../src/index")) as any;
  assert.equal(typeof JsonLinesDecoder, "function");
  const values: any[] = [];
  const decoder = new JsonLinesDecoder((value: unknown) => values.push(value));
  const wire =
    '{"type":"control","n":1}\n\r\n{"type":"content","markdown":"é 🌿 你好"}\r\n{"type":"end"}\n';
  for (const byte of new TextEncoder().encode(wire))
    decoder.push(new Uint8Array([byte]));
  decoder.finish();
  assert.deepEqual(values, [
    { type: "control", n: 1 },
    { type: "content", markdown: "é 🌿 你好" },
    { type: "end" },
  ]);
  // A last line without its newline is still a whole object.
  const tail: any[] = [];
  const last = new JsonLinesDecoder((value: unknown) => tail.push(value));
  last.pushText('{"type":"end"}');
  last.finish();
  assert.deepEqual(tail, [{ type: "end" }]);
});
test("JSON lines fail closed when cut, malformed or polluting", async () => {
  const { JsonLinesDecoder } = (await import("../src/index")) as any;
  const cut = new JsonLinesDecoder(() => {});
  cut.pushText('{"type":"content","markdown":"ab');
  assert.throws(() => cut.finish(), /capture_interrupted/);
  assert.throws(
    () => new JsonLinesDecoder(() => {}).pushText("not json\n"),
    /malformed_frame/,
  );
  // An oversized line: see "JSON lines have their own line bound".
  assert.throws(
    () => new JsonLinesDecoder(() => {}).pushText('{"__proto__":{"polluted":true}}\n'),
    /malformed_frame/,
  );
  assert.throws(
    () => new JsonLinesDecoder(() => {}).push(new Uint8Array([0xff, 0x0a])),
    /malformed_frame/,
  );
  assert.equal(({} as any).polluted, undefined);
});
// A signed-out ChatGPT line repeats the page's metadata of the whole answer so far, so a long
// answer's lines outgrow LIMITS.frame (live, 20 Oct 2026: 557 KB for about 48,000 characters).
test("JSON lines have their own line bound, above the frame limit", async () => {
  const { JsonLinesDecoder, JSON_LINE_LIMITS } = (await import("../src/index")) as any;
  assert.ok(JSON_LINE_LIMITS, "the bounds of a JSON-lines stream are exported");
  assert.ok(JSON_LINE_LIMITS.line > LIMITS.frame);
  assert.ok(JSON_LINE_LIMITS.stream > LIMITS.stream);
  const values: any[] = [];
  const decoder = new JsonLinesDecoder((value: unknown) => values.push(value));
  const big = JSON.stringify({ type: "content", references: [{ title: "r".repeat(LIMITS.frame + 10) }] });
  decoder.pushText(big.slice(0, 500_000));
  decoder.pushText(big.slice(500_000) + "\n");
  decoder.finish();
  assert.equal(values.length, 1);
  assert.equal(values[0].references[0].title.length, LIMITS.frame + 10);
  assert.throws(
    () => new JsonLinesDecoder(() => {}).pushText("x".repeat(JSON_LINE_LIMITS.line + 1)),
    /buffer_overflow/,
  );
});
test("A large network chunk of small frames does not exceed the per-frame buffer", () => {
  let count = 0;
  const d = new SseDecoder(() => count++);
  const frame = 'data: {"x":"' + "a".repeat(200) + '"}\n\n';
  d.push(new TextEncoder().encode(frame.repeat(6000)));
  d.finish();
  assert.equal(count, 6000);
});
