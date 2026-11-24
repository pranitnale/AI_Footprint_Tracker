import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  ClaudeTokenFactorSchema,
  HistoryPageSchema,
  type HistoryMessage,
  type HistoryPage,
} from "@footprint/contracts";
import { HistoryAccumulator } from "../src/history";

// Package EC (owner decision of 23 Nov 2026): the company summary of a Claude chat shows the
// input the browser shows. The fixture is shared with the server's test of the same uploads,
// so both sides must reach the same input rows.
const fixture = JSON.parse(
  readFileSync(
    new URL("../../contracts/test/fixtures/exact-input-company.json", import.meta.url),
    "utf8",
  ),
) as {
  pages: HistoryPage[];
  expected: {
    prompt_count: string;
    response_count: string;
    input_rows: Array<Record<string, string | null>>;
  };
};
const factor = ClaudeTokenFactorSchema.parse(
  JSON.parse(
    readFileSync(
      new URL("../../../config/estimation.media.json", import.meta.url),
      "utf8",
    ),
  ).claude_token_factor,
);

test("a chat's uploads sum to the input the browser shows: Claude's exact input once per turn, text counts elsewhere", () => {
  for (const page of fixture.pages)
    assert.equal(HistoryPageSchema.safeParse(page).success, true);
  // What the company keeps of the uploads: each message's latest copy and latest exact input,
  // without the text rows exact rows replaced.
  const messages = new Map<string, HistoryMessage>();
  const exact = new Map<string, NonNullable<HistoryPage["exact_inputs"]>[number]>();
  const replaced = new Set<string>();
  for (const page of fixture.pages) {
    for (const message of page.messages) messages.set(message.message_key, message);
    for (const entry of page.exact_inputs ?? []) exact.set(entry.message_key, entry);
    for (const key of page.replaced_message_keys ?? []) replaced.add(key);
  }
  const kept = [...messages.values()].filter((m) => !replaced.has(m.message_key));
  // As HistoryService.local: the prompt an exact reply answers adds no token rows.
  const answered = new Set(
    kept
      .filter((m) => m.role === "response" && exact.has(m.message_key))
      .map((m) => m.prompt_key),
  );
  const summary = new HistoryAccumulator(factor);
  for (const message of kept) {
    const entry = message.role === "response" ? exact.get(message.message_key) : undefined;
    summary.add(message, {
      // Resources are not compared here: input is not modelled, and the fixture's method
      // is no estimator method.
      estimate: [],
      ...(entry
        ? {
            exactInput: String(
              BigInt(entry.new) + BigInt(entry.cache_write) + BigInt(entry.cache_read),
            ),
          }
        : {}),
      ...(answered.has(message.message_key) ? { inputCounted: true } : {}),
    });
  }
  const order = (row: Record<string, unknown>) =>
    [row.role, row.part, row.evidence, row.profile_id].join("|");
  assert.deepEqual(
    summary.summary.tokens
      .filter(
        (row) =>
          row.role === "prompt" ||
          row.part === "tool_output" ||
          row.part === "image_input_tokens",
      )
      .map((row) => ({ ...row }))
      .sort((a, b) => order(a).localeCompare(order(b))),
    [...fixture.expected.input_rows].sort((a, b) =>
      order(a).localeCompare(order(b)),
    ),
  );
  assert.equal(summary.summary.prompt_count, fixture.expected.prompt_count);
  assert.equal(summary.summary.response_count, fixture.expected.response_count);
});
