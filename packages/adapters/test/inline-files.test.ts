import assert from "node:assert/strict";
import test from "node:test";
import {
  claudeInlineFiles,
  INLINE_FILE_LIMITS,
  parseDispatch,
} from "../src/index";

const attachment = (text = "FERN inline synthetic text") => ({
  file_name: "PRIVATE_FILENAME.txt",
  file_type: "text/plain",
  file_size: 158,
  extracted_content: text,
  origin: "user_upload",
  kind: "file",
});
test("Claude dispatch projects only directly observed inline text, independently from ordinary prompt", () => {
  const dispatch = parseDispatch(
    "claude",
    new URL(
      "https://claude.ai/api/organizations/synthetic/chat_conversations/synthetic/completion",
    ),
    JSON.stringify({
      prompt: "ordinary prompt",
      attachments: [attachment()],
      files: [],
    }),
  );
  assert.deepEqual(dispatch.inlineFiles, ["FERN inline synthetic text"]);
  assert.equal(dispatch.input, "ordinary prompt");
  assert.ok(!JSON.stringify(dispatch).includes("PRIVATE_FILENAME"));
  assert.deepEqual(claudeInlineFiles({ attachments: [], files: [] }), []);
});
test("unknown origins, formats, fields, body shapes and aggregate limits never imply an empty set", () => {
  for (const item of [
    { ...attachment(), origin: "retained" },
    { ...attachment(), file_type: "application/pdf" },
    { ...attachment(), url: "https://private.invalid/file" },
    { ...attachment(), file_size: -1 },
    { ...attachment(), extracted_content: null },
    { ...attachment(), extracted_content: { text: "unknown" } },
  ])
    assert.equal(claudeInlineFiles({ attachments: [item], files: [] }), null);
  for (const value of [
    {},
    { attachments: [] },
    { attachments: [], files: ["opaque-id"] },
    { attachments: Array.from({ length: 17 }, () => attachment()), files: [] },
    {
      attachments: [
        attachment("x".repeat(INLINE_FILE_LIMITS.textUnits)),
        attachment("x"),
      ],
      files: [],
    },
  ])
    assert.equal(claudeInlineFiles(value), null);
  assert.deepEqual(
    claudeInlineFiles({ attachments: [attachment("")], files: [] }),
    [""],
  );
});
