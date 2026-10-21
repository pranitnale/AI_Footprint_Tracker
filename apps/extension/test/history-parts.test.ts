import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { Ledger } from "@footprint/ledger";
import type { HistoryMessage } from "@footprint/contracts";
import type { HistoryTextPage } from "@footprint/adapters";
import { Coordinator } from "../lib/coordinator";
import {
  HISTORY_CAPTURE_CHANNEL,
  type HistoryCaptureMessage,
} from "../lib/history-capture";
import { countByTextLength } from "./counting-fixture";
import { historyBinding, historyPage, historySender } from "./history-fixture";

async function saved(
  page: HistoryTextPage,
  labels: string[] = [],
  role: "prompt" | "response" = "response",
): Promise<HistoryMessage[]> {
  const db = await Ledger.open("history-parts-" + crypto.randomUUID());
  const c = new Coordinator(db, {
    count: countByTextLength,
    hasConsent: async () => true,
    hasSiteConsent: async () => true,
    sendDisplay: async () => {},
    transport: async () => {
      throw new TypeError("synthetic offline");
    },
  });
  try {
    await c.whenReady();
    const binding = historyBinding();
    const common: Omit<HistoryCaptureMessage, "event" | "page"> = {
      channel: HISTORY_CAPTURE_CHANNEL,
      id: crypto.randomUUID(),
      site: page.site,
      conversationId: page.conversationId,
      observedAt: page.observedAt,
    };
    for (const event of ["start", "page"] as const)
      assert.deepEqual(
        await c.history.receive(
          { ...common, event, page: event === "page" ? page : null },
          binding,
          historySender,
        ),
        { accepted: true },
      );
    const kept = await db.all<{ label: string }>("model_labels");
    labels.push(...kept.map((row) => row.label));
    const rows = await db.all<{ record: HistoryMessage }>("history_records");
    return rows.map((row) => row.record).filter((m) => m.role === role);
  } finally {
    c.history.invalidate();
    c.engines.dispose();
    db.close();
  }
}

test("D2 a saved reply counts every part its parser reads; unread parts stay unknown", async () => {
  const page = historyPage(4);
  Object.assign(page.messages[1]!, {
    thinking: "think",
    toolInput: "abc",
    intermediate: "",
    toolOutput: "xy",
  });
  const replies = await saved(page);
  const full = replies.find((m) => m.parts!.tool_input.value !== null)!;
  const plain = replies.find((m) => m.parts!.tool_input.value === null)!;
  assert.deepEqual(
    [
      full.parts!.answer_output.value,
      full.parts!.visible_thinking.value,
      full.parts!.tool_input.value,
      full.parts!.intermediate_output.value,
      full.parts!.tool_output.value,
    ],
    ["5", "5", "3", "0", "2"],
  );
  // Tool results are input, so the output total is answer, reasoning, tool input and
  // intermediate text.
  assert.equal(full.tokens.value, "13");
  assert.equal(full.tokens.completeness, "complete_for_scope");
  assert.equal(plain.tokens.value, "5");
  assert.equal(plain.tokens.completeness, "partial");
  assert.equal(plain.parts!.visible_thinking.reason, "observed_text_only");
  assert.equal(plain.parts!.tool_input.reason, "tool_work_unobserved");
  assert.equal(plain.parts!.intermediate_output.reason, "observed_text_only");
});

test("D3 a saved reply keeps other-model text, media facts and the provider's own total", async () => {
  const page = historyPage(2);
  Object.assign(page.messages[1]!, {
    thinking: "",
    toolInput: "",
    intermediate: "",
    usage: {
      output: 500,
      input: 100,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 120,
    },
    components: [
      {
        role: "side_calls",
        model: "claude-haiku-4-5",
        text: null,
        outputTokens: 40,
      },
      {
        role: "research",
        model: "claude-brand-new",
        text: "report",
        outputTokens: null,
      },
    ],
    media: [
      {
        kind: "image",
        model: null,
        count: 2,
        width: 1024,
        height: 1024,
        outcome: "returned",
      },
      {
        kind: "speech",
        basis: "stored_length",
        seconds: 12.5,
        characters: null,
      },
    ],
  });
  const labels: string[] = [];
  const [reply] = await saved(page, labels);
  // The unlisted label is kept on this device only, for Details; the record holds the
  // stand-in id.
  assert.deepEqual(labels, ["claude-brand-new"]);
  assert.equal(reply!.tokens.value, "500");
  assert.equal(reply!.tokens.evidence, "provider_reported");
  assert.equal(reply!.parts!.reported_reasoning.value, "120");
  // The counted parts stay for Details.
  assert.equal(reply!.parts!.answer_output.value, "5");
  assert.deepEqual(
    reply!.generation.text_components.map((c) => [
      c.role,
      c.model_id,
      c.tokens.value,
    ]),
    [
      ["side_calls", "claude-haiku-4-5", "40"],
      ["research", "claude-unlisted", "6"],
    ],
  );
  assert.deepEqual(reply!.generation.media, [
    {
      kind: "image",
      model_id: null,
      count: "2",
      width: 1024,
      height: 1024,
      outcome: "returned",
    },
    {
      kind: "speech",
      length_basis: "stored_length",
      seconds: "12.5",
      characters: null,
    },
  ]);
});

test("generated text is accepted only on replies and uploaded image sizes only on prompts", async () => {
  const prompt = historyPage(2);
  Object.assign(prompt.messages[0]!, { toolInput: "x" });
  await assert.rejects(saved(prompt), /payload_rejected/);
  const reply = historyPage(2);
  Object.assign(reply.messages[1]!, {
    inputImages: [{ width: 10, height: 10 }],
  });
  await assert.rejects(saved(reply), /payload_rejected/);
  // A component is either counted from its text or reported, never both.
  const both = historyPage(2);
  Object.assign(both.messages[1]!, {
    components: [{ role: "research", model: null, text: "x", outputTokens: 1 }],
  });
  await assert.rejects(saved(both), /payload_rejected/);
});

test("E1 a research component keeps its own time, which must come from the reply's own page", async () => {
  const timing = (source: string) => ({
    duration_seconds: "90",
    source,
    scope: "research_task",
    completeness: "complete_for_scope",
    profile_version: "timing-observation-1",
  });
  const page = historyPage(2);
  Object.assign(page.messages[1]!, {
    components: [
      {
        role: "research",
        model: null,
        text: "report",
        outputTokens: null,
        timing: timing("claude_history"),
      },
    ],
  });
  const [reply] = await saved(page);
  assert.deepEqual(
    reply!.generation.text_components[0]!.timing,
    timing("claude_history"),
  );
  const foreign = historyPage(2);
  Object.assign(foreign.messages[1]!, {
    components: [
      {
        role: "research",
        model: null,
        text: "report",
        outputTokens: null,
        timing: timing("chatgpt_history"),
      },
    ],
  });
  await assert.rejects(saved(foreign), /payload_rejected/);
});

test("D7 E1 a saved reply keeps the reasons it was read in part, and only known reasons pass", async () => {
  const page = historyPage(2);
  Object.assign(page.messages[1]!, {
    coverageReasons: ["research_work_unobserved", "unknown_event_observed"],
  });
  const [reply] = await saved(page);
  assert.ok(reply!.coverage_reasons.includes("history_only"));
  assert.ok(reply!.coverage_reasons.includes("research_work_unobserved"));
  assert.ok(reply!.coverage_reasons.includes("unknown_event_observed"));
  for (const coverageReasons of [
    [],
    ["history_only"],
    ["unknown_event_observed", "unknown_event_observed"],
    "unknown_event_observed",
  ]) {
    const bad = historyPage(2);
    Object.assign(bad.messages[1]!, { coverageReasons });
    await assert.rejects(
      saved(bad),
      /payload_rejected/,
      String(coverageReasons),
    );
  }
});

test("A7 a saved prompt keeps its text count and prices uploaded images as their own part", async () => {
  const page = historyPage(4);
  // The page names the answering model on the first prompt only; the other uses the
  // site's benchmark, Claude Opus 5.5, which reads images at high resolution.
  Object.assign(page.messages[0]!, {
    modelId: "claude-sonnet-4-6",
    inputImages: [{ width: 1920, height: 1080 }],
  });
  Object.assign(page.messages[2]!, {
    inputImages: [{ width: 1920, height: 1080 }],
  });
  const prompts = await saved(page, [], "prompt");
  assert.deepEqual(
    prompts
      .map((m) => [m.tokens.value, m.parts?.image_input_tokens.value])
      .sort(),
    [
      ["5", "1560"],
      ["5", "2691"],
    ],
  );
  for (const prompt of prompts)
    assert.equal(prompt.parts!.answer_output.evidence, "not_applicable");
  // A prompt without images carries no parts.
  const plain = await saved(historyPage(2), [], "prompt");
  assert.equal(plain[0]!.parts, null);
});
