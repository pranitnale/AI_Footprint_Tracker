import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parseDispatch } from "../src/index";
const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../../fixtures/provider-uploads-2026-09-10.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const attachment = fixture.chatgpt.generation.attachment;
const request = (parts: unknown[], refs?: unknown) => ({
  action: "next",
  messages: [
    {
      id: "synthetic-dispatch",
      author: { role: "user" },
      content: { parts },
      metadata: refs === undefined ? {} : { attachments: refs },
    },
  ],
});
const parse = (value: unknown) =>
  parseDispatch(
    "chatgpt",
    new URL("https://chatgpt.com/backend-api/f/conversation"),
    JSON.stringify(value),
  );

test("actual metadata-only ChatGPT attachment is counted without leaking its reference metadata", () => {
  const result = parse(request(["ordinary text"], [attachment]));
  assert.equal(result.attachments, 1);
  assert.equal(result.attachmentPresence, true);
  assert.equal(result.input, "ordinary text");
  for (const raw of [
    attachment.id,
    attachment.name,
    attachment.library_file_id,
  ])
    assert.ok(!JSON.stringify(result).includes(raw));
});
test("compatible same-ID references deduplicate across metadata and parts, conflicting or opaque overlap stays unknown", () => {
  const duplicate = parse(
    request(["ordinary", attachment], [attachment, { ...attachment }]),
  );
  assert.equal(duplicate.attachments, 1);
  assert.equal(duplicate.attachmentPresence, true);
  const distinct = parse(
    request(
      ["ordinary", { ...attachment, id: "synthetic-other-file" }],
      [attachment, { ...attachment, id: "synthetic-other-file" }],
    ),
  );
  assert.equal(distinct.attachments, 2);
  for (const part of [
    { ...attachment, size: attachment.size + 1 },
    {
      content_type: "image_asset_pointer",
      asset_pointer: `file-service://${attachment.id}`,
    },
    { file_id: attachment.id },
    { ...attachment, id: "unobserved-part-reference" },
    null,
  ]) {
    const result = parse(request(["ordinary", part], [attachment]));
    assert.equal(result.attachments, null);
    assert.equal(result.attachmentPresence, true);
  }
});
test("malformed and over-limit attachment sets never imply cardinality zero or erase proved presence", () => {
  for (const refs of [
    null,
    "unknown",
    [{}],
    Array.from({ length: 101 }, () => attachment),
    [attachment, { ...attachment, source: "unverified" }],
  ]) {
    const result = parse(request(["ordinary"], refs));
    assert.equal(result.attachments, null);
  }
  assert.equal(parse(request(["ordinary"], [])).attachments, 0);
  assert.equal(parse(request(["ordinary"])).attachmentPresence, undefined);
  assert.equal(parse(request([{ unobserved_schema: true }])).attachments, null);
});

test("A7 a ChatGPT send carries its uploaded image sizes; an unknown part leaves them unknown", () => {
  const send = (content: unknown, metadata: unknown = {}) =>
    parse({
      action: "next",
      messages: [
        {
          id: "synthetic-dispatch",
          author: { role: "user" },
          content,
          metadata,
        },
      ],
    });
  assert.deepEqual(
    send({ content_type: "text", parts: ["ordinary text"] }).inputImages,
    [],
  );
  const sized = send({
    content_type: "multimodal_text",
    parts: [
      {
        content_type: "image_asset_pointer",
        asset_pointer: "sediment://synthetic-image",
        size_bytes: 1000,
        width: 1024,
        height: 768,
      },
      {
        content_type: "image_asset_pointer",
        asset_pointer: "sediment://other",
      },
      "Describe",
    ],
  });
  assert.deepEqual(sized.inputImages, [
    { width: 1024, height: 768 },
    { width: null, height: null },
  ]);
  assert.equal(sized.input, "Describe");
  assert.equal(
    send({
      content_type: "multimodal_text",
      parts: [{ content_type: "new_kind" }, "Describe"],
    }).inputImages,
    undefined,
  );
  // An image the metadata names without its image part is not known to be absent.
  assert.equal(
    send(
      { content_type: "text", parts: ["Describe"] },
      { attachments: [{ id: "file_1", mime_type: "image/png" }] },
    ).inputImages,
    undefined,
  );
  // A request shape without a content type is not read.
  assert.equal(parse(request(["ordinary text"])).inputImages, undefined);
});
