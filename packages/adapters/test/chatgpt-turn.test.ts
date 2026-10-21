import test from "node:test";
import assert from "node:assert/strict";
import { ChatgptSession, parseDispatch } from "../src/index";
import { chatgptTurn } from "../src/chatgpt-content";

// Synthetic ChatGPT messages in the shapes seen on 9 Sep, 1 Oct and 3 Oct 2026.
const frame = (value: any, event = "message") => ({
  event,
  data: JSON.stringify(value),
  value,
});
const assistant = (
  id: string,
  content: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => ({
  id,
  author: { role: "assistant" },
  content,
  status: "finished_successfully",
  end_turn: false,
  recipient: "all",
  channel: null,
  metadata: {},
  ...extra,
});
const tool = (
  id: string,
  content: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => ({
  id,
  author: { role: "tool", name: "python" },
  content,
  status: "finished_successfully",
  recipient: "all",
  metadata: {},
  ...extra,
});
const text = (...parts: string[]) => ({ content_type: "text", parts });
const thoughts = (...items: unknown[]) => ({
  content_type: "thoughts",
  thoughts: items,
  source_analysis_msg_id: "analysis",
});
const code = (body: string) => ({
  content_type: "code",
  language: "json",
  text: body,
});

test("a ChatGPT turn counts thoughts, commentary, plans, tool input and shown results by one rule", () => {
  const turn = chatgptTurn([
    { id: "user", author: { role: "user" }, content: text("Question") },
    assistant(
      "thinking",
      thoughts(
        {
          summary: "Planning",
          content: "First idea",
          chunks: ["First ", "idea"],
          finished: true,
        },
        // Without its text, the streamed chunks hold it.
        { summary: "Checking", chunks: ["Second ", "idea"], finished: false },
      ),
    ),
    // The "Thought for N s" label is not text the model wrote for the user (A1).
    assistant("recap", {
      content_type: "reasoning_recap",
      content: "Thought for 4s",
    }),
    assistant("plan", code('{"steps":["look","answer"]}'), {
      recipient: "turn_plan.update_turn_plan",
    }),
    assistant("progress", text("Looking it up"), { channel: "commentary" }),
    assistant("call", code('{"query":"weather","limit":3}'), {
      recipient: "api_tool.call_tool",
    }),
    assistant("run", code("print(17 * 23)"), { recipient: "container.exec" }),
    tool("output", { content_type: "execution_output", text: "391" }),
    tool("page", {
      content_type: "tether_browsing_display",
      result: "Page text",
      summary: "",
    }),
    // A hidden tool message and an unlisted tool result are not shown in full (A6).
    tool(
      "hidden",
      { content_type: "execution_output", text: "secret" },
      {
        metadata: { is_visually_hidden_from_conversation: true },
      },
    ),
    tool("quote", { content_type: "tether_quote", text: "quoted" }),
    assistant("answer", text("It is ", "391."), {
      channel: "final",
      end_turn: true,
      metadata: {
        model_slug: "gpt-5-6-thinking",
        resolved_model_slug: "gpt-5-4-auto-thinking",
      },
    }),
  ]);
  assert.deepEqual(
    {
      answer: turn.answer,
      thinking: turn.thinking,
      intermediate: turn.intermediate,
      toolInput: turn.toolInput,
      toolOutput: turn.toolOutput,
      unknown: turn.unknown,
      attemptId: turn.attemptId,
      outputId: turn.outputId,
      model: turn.model,
    },
    {
      answer: "It is 391.",
      thinking: "Planning\nFirst idea\nChecking\nSecond idea",
      intermediate: "look\nanswer\nLooking it up",
      toolInput: "weather\n3\nprint(17 * 23)",
      toolOutput: "391\nPage text",
      unknown: false,
      // A turn with one answer keeps the answer's id, as replies saved earlier did.
      attemptId: "answer",
      outputId: "answer",
      // The model that answered wins over the one requested (B0, owner 3 Oct).
      model: "gpt-5-4-auto-thinking",
    },
  );
  // Without an answer, the first message the reply counts names it; hidden context and
  // the thinking label never do.
  const unanswered = chatgptTurn([
    assistant("memory", {
      content_type: "model_editable_context",
      model_set_context: "",
    }),
    assistant("recap", {
      content_type: "reasoning_recap",
      content: "Thought for 4s",
    }),
    assistant(
      "thinking",
      thoughts({ summary: "Plan", content: "Steps", finished: true }),
    ),
    assistant("call", code('{"q":"x"}'), { recipient: "web.run" }),
  ]);
  assert.equal(unanswered.attemptId, "thinking");
  assert.equal(unanswered.outputId, null);
  assert.equal(
    chatgptTurn([
      assistant("memory", { content_type: "model_editable_context" }),
    ]).attemptId,
    null,
  );
});

test("several finals answer one turn; an unknown message leaves the reply partial without failing", () => {
  const turn = chatgptTurn([
    assistant("first", text("Part one"), { channel: "final" }),
    assistant("odd", { content_type: "new_kind", data: 1 }),
    assistant("other-channel", text("hidden plan"), { channel: "analysis" }),
    assistant("second", text("Part two"), {
      channel: "final",
      metadata: { model_slug: "gpt-6-astra-wm" },
    }),
  ]);
  assert.equal(turn.answer, "Part one\nPart two");
  assert.equal(turn.unknown, true);
  assert.equal(turn.attemptId, "first");
  assert.equal(turn.outputId, "second");
  assert.equal(turn.model, "gpt-6-astra-wm");
  // A final whose parts are not text is unknown, which fails the reply closed (D7).
  assert.equal(
    chatgptTurn([
      assistant(
        "bad",
        { content_type: "text", parts: [{}] },
        { channel: "final" },
      ),
    ]).answerUnreadable,
    true,
  );
  // Voice replies are their transcript, with the speech read at 17 characters a second.
  const voice = chatgptTurn([
    assistant(
      "voice",
      {
        content_type: "multimodal_text",
        parts: [
          {
            content_type: "audio_transcription",
            text: "Hello there",
            direction: "out",
          },
        ],
      },
      { metadata: { model_slug: "bidi" } },
    ),
  ]);
  assert.equal(voice.answer, "Hello there");
  assert.equal(voice.speechCharacters, 11);
  assert.equal(voice.model, "bidi");
});

test("the live ChatGPT reply carries every part, both ids and the served model", () => {
  const s = new ChatgptSession();
  const messages = [
    assistant(
      "thinking",
      thoughts({ summary: "Plan", content: "Steps", finished: true }),
    ),
    assistant("call", code('{"q":"x"}'), { recipient: "web.run" }),
    tool("result", {
      content_type: "tether_browsing_display",
      result: "Found",
    }),
    assistant("answer-1", text("First"), { channel: "final" }),
    assistant("answer-2", text("Second"), {
      channel: "final",
      end_turn: true,
      metadata: { model_slug: "gpt-5-6" },
    }),
  ];
  s.frame(
    frame({
      type: "server_ste_metadata",
      metadata: { model_slug: "gpt-5-4-thinking" },
    }),
  );
  s.frame(frame({ message: messages[0] }));
  // Before its answer, the reply's first counted message names it only for now, so a
  // stream that can still bring the answer names no reply yet (14 Oct 2026).
  assert.equal(s.snapshot().attemptId, null);
  for (const message of messages.slice(1)) s.frame(frame({ message }));
  const snapshot = s.snapshot();
  assert.equal(snapshot.state, "completed");
  assert.equal(snapshot.text, "First\nSecond");
  assert.equal(snapshot.thinking, "Plan\nSteps");
  assert.equal(snapshot.toolInput, "x");
  assert.equal(snapshot.intermediate, "");
  assert.equal(snapshot.toolOutput, "Found");
  assert.equal(snapshot.outputId, "answer-2");
  // The first answer names the reply and stays while more answers follow (G8).
  assert.equal(snapshot.attemptId, "answer-1");
  // A message's own slug wins over the stream's metadata.
  assert.equal(snapshot.model, "gpt-5-6");
  assert.equal(snapshot.searchOperations, 1);
  // The stream's served model fills in only when no message names one (G13).
  const bare = new ChatgptSession();
  bare.frame(
    frame({
      type: "server_ste_metadata",
      metadata: { model_slug: "gpt-5-4-thinking" },
    }),
  );
  bare.frame(
    frame({
      message: assistant("only", text("Hi"), {
        channel: "final",
        end_turn: true,
      }),
    }),
  );
  assert.equal(bare.snapshot().model, "gpt-5-4-thinking");
  // An earlier final that did not end the turn keeps it running.
  const running = new ChatgptSession();
  running.frame(
    frame({
      message: assistant("a", text("One"), {
        channel: "final",
        end_turn: true,
      }),
    }),
  );
  running.frame(
    frame({
      message: assistant("b", text("Two"), {
        channel: "final",
        status: "in_progress",
      }),
    }),
  );
  assert.equal(running.snapshot().state, "generating");
});

test("ChatGPT deltas of several messages in one stream patch the message their c names (C2, 6 Oct)", () => {
  // Since 6 Oct 2026 a reply streams two thoughts messages and its answer side by side.
  // Each delta names its message with c; c, p and o carry over to deltas that omit them.
  const s = new ChatgptSession();
  const delta = (value: any) => s.frame(frame(value, "delta"));
  s.frame(frame("v1", "delta_encoding"));
  delta({
    p: "",
    o: "add",
    c: 0,
    v: { message: assistant("t0", thoughts()), conversation_id: "chat" },
  });
  delta({
    c: 1,
    v: {
      message: assistant(
        "t1",
        thoughts({ summary: "", content: "Weighing", finished: false }),
      ),
      conversation_id: "chat",
    },
  });
  // Only thoughts so far: the answer, which names the reply, is still to come.
  assert.equal(s.snapshot().attemptId, null);
  delta({
    c: 2,
    v: {
      message: assistant("answer", text(""), {
        channel: "final",
        status: "in_progress",
      }),
      conversation_id: "chat",
    },
  });
  delta({
    c: 1,
    o: "patch",
    v: [
      { p: "/message/content/thoughts/0/summary", o: "replace", v: "Plan" },
      { p: "/message/content/thoughts/0/finished", o: "replace", v: true },
    ],
  });
  delta({
    c: 2,
    v: [{ p: "/message/content/parts/0", o: "append", v: "OK" }],
  });
  assert.equal(s.snapshot().state, "generating");
  assert.equal(s.snapshot().attemptId, "answer");
  // Without c, a delta continues the message the previous delta named.
  delta({
    v: [
      { p: "/message/status", o: "replace", v: "finished_successfully" },
      { p: "/message/end_turn", o: "replace", v: true },
    ],
  });
  s.frame(frame({ type: "message_stream_complete", conversation_id: "chat" }));
  const snapshot = s.snapshot();
  assert.equal(snapshot.state, "completed");
  assert.equal(snapshot.text, "OK");
  assert.equal(snapshot.thinking, "Plan\nWeighing");
  assert.equal(snapshot.attemptId, "answer");
  assert.equal(snapshot.outputId, "answer");
  assert.ok(!snapshot.limitations.includes("unknown_event_observed"));
  // A message slot must be a small whole number; anything else is a shape not yet seen.
  for (const c of [-1, 1.5, "1", null, 10_000]) {
    const odd = new ChatgptSession();
    assert.throws(
      () =>
        odd.frame(
          frame(
            { p: "", o: "add", c, v: { message: assistant("x", text("")) } },
            "delta",
          ),
        ),
      /unsupported_schema/,
      `c ${String(c)}`,
    );
  }
});

test("a ChatGPT turn without an answer is named by its first counted message once nothing can rename it", () => {
  const thinking = assistant(
    "thinking",
    thoughts({ summary: "Plan", content: "Steps", finished: true }),
  );
  // A stop ends the turn before its answer.
  const stopped = new ChatgptSession();
  stopped.frame(frame({ message: thinking }));
  assert.equal(stopped.snapshot().attemptId, null);
  stopped.stopped();
  assert.equal(stopped.snapshot().state, "cancelled");
  assert.equal(stopped.snapshot().attemptId, "thinking");
  // A stream that completed without an answer brings none any more.
  const ended = new ChatgptSession();
  ended.frame(frame({ message: thinking }));
  ended.frame(frame({ type: "message_stream_complete" }));
  assert.equal(ended.snapshot().attemptId, "thinking");
  // A message arriving in progress opens the stream again.
  ended.frame(
    frame({
      message: assistant("more", thoughts(), { status: "in_progress" }),
    }),
  );
  assert.equal(ended.snapshot().attemptId, null);
  // Saved history reads whole turns, so it names an unanswered turn as before.
  assert.equal(chatgptTurn([thinking]).attemptId, "thinking");
  assert.equal(chatgptTurn([thinking]).attemptIdProvisional, true);
});

test("a ChatGPT turn stopped after ChatGPT took it, before any message, is cancelled with nothing written", () => {
  // Live, 19 Oct 2026: GPT-6 Pro stopped while thinking. The body only handed the turn to
  // the socket, which carried no message before the stop.
  const handedOff = new ChatgptSession();
  handedOff.frame(
    frame({
      type: "stream_handoff",
      conversation_id: "chat",
      turn_exchange_id: "turn",
      options: [{ type: "subscribe_ws_topic", topic_id: "topic" }],
    }),
  );
  // Cut off without a stop, its output stays unknown.
  assert.equal(handedOff.snapshot().started, false);
  assert.equal(handedOff.snapshot().text, null);
  handedOff.stopped();
  const stopped = handedOff.snapshot();
  assert.equal(stopped.state, "cancelled");
  assert.equal(stopped.started, true);
  assert.equal(stopped.text, "");
  assert.equal(stopped.thinking, "");
  assert.equal(stopped.attemptId, null);
  // The old body echoes the prompt first, which shows the same.
  const echoed = new ChatgptSession();
  echoed.frame(
    frame({
      type: "input_message",
      input_message: { id: "prompt", author: { role: "user" } },
      conversation_id: "chat",
    }),
  );
  echoed.stopped();
  assert.equal(echoed.snapshot().started, true);
  assert.equal(echoed.snapshot().text, "");
  // A stop before ChatGPT answered at all shows nothing about the turn.
  const early = new ChatgptSession();
  early.stopped();
  assert.equal(early.snapshot().state, "cancelled");
  assert.equal(early.snapshot().started, false);
  assert.equal(early.snapshot().text, null);
});

test("a stopped ChatGPT image job counts as started once, never as an image twice", () => {
  const s = new ChatgptSession();
  s.frame(
    frame({
      message: assistant("prompt", code('{"prompt":"a cat"}'), {
        recipient: "t2uay3k.sj1i4kz",
      }),
    }),
  );
  const stopped = tool(
    "job",
    { content_type: "multimodal_text", parts: [] },
    {
      author: { role: "tool", name: "t2uay3k.sj1i4kz" },
      metadata: {
        async_source: "image-job",
        finish_details: { type: "interrupted" },
      },
    },
  );
  s.frame(frame({ message: stopped }));
  s.frame(frame({ message: { ...stopped, id: "job-copy" } }));
  s.stopped();
  const operations = s.snapshot().imageOperations;
  assert.equal(operations.length, 1);
  assert.deepEqual(operations[0]!.outputs, []);
  assert.equal(operations[0]!.state, "cancelled");
  // A connector call that stops is not an image job.
  const connector = new ChatgptSession();
  connector.frame(
    frame({
      message: {
        ...stopped,
        author: { role: "tool", name: "api_tool.call_tool" },
      },
    }),
  );
  assert.deepEqual(connector.snapshot().imageOperations, []);
});

test("a ChatGPT image job that runs apart from the stream waits for the saved chat under the job's id (I4, 5 Oct)", () => {
  // Live shape of 5 Oct: the stream completes with one asynchronous assistant message
  // still in progress; saved history later keeps that id for the job's tool message.
  const placeholder = assistant("job", thoughts(), {
    status: "in_progress",
    metadata: { async_source: "image-job" },
  });
  const served = frame({
    type: "server_ste_metadata",
    metadata: { model_slug: "gpt-5-6-thinking" },
  });
  const s = new ChatgptSession();
  s.frame(frame({ p: "", o: "add", v: { message: placeholder } }, "delta"));
  s.frame(served);
  s.frame(frame({ type: "message_stream_complete" }));
  assert.equal(s.awaitingAsync(), true);
  assert.equal(s.completionVerified(), false);
  const snapshot = s.snapshot();
  assert.equal(snapshot.state, "generating");
  assert.equal(snapshot.attemptId, "job");
  assert.equal(snapshot.text, "");
  // The saved chat names the job's model; the stream's served model can differ.
  assert.equal(snapshot.model, null);
  // The saved job's tool message names the same turn.
  const saved = chatgptTurn([
    tool(
      "job",
      { content_type: "multimodal_text", parts: [] },
      {
        author: { role: "tool", name: "t2uay3k.sj1i4kz" },
        channel: "final",
        metadata: {
          async_source: "image-job",
          ghostrider: { status: "final" },
        },
      },
    ),
    assistant("label", {
      content_type: "reasoning_recap",
      content: "Thought for 10s",
    }),
  ]);
  assert.equal(saved.attemptId, "job");
  // An in-progress reply that is not a job does not wait.
  const plain = new ChatgptSession();
  plain.frame(
    frame(
      {
        p: "",
        o: "add",
        v: { message: { ...placeholder, metadata: {} } },
      },
      "delta",
    ),
  );
  plain.frame(served);
  plain.frame(frame({ type: "message_stream_complete" }));
  assert.equal(plain.awaitingAsync(), false);
  assert.equal(plain.snapshot().model, "gpt-5-6-thinking");
  // A stream handed to the socket learns its end from the conversation's status.
  const handed = new ChatgptSession();
  handed.frame(
    frame(
      {
        type: "stream_handoff",
        options: [{ type: "subscribe_ws_topic", topic_id: "topic" }],
      },
      "stream_handoff",
    ),
  );
  handed.frame(
    frame({ p: "", o: "add", v: { message: placeholder } }, "delta"),
  );
  handed.frame(frame({ type: "message_stream_complete" }));
  assert.equal(handed.awaitingAsync(), false);
});

test("a final of a content type not yet seen ends and names the turn, and its text stays unknown", () => {
  const unseen = { content_type: "new_kind", data: 1 };
  const s = new ChatgptSession();
  s.frame(
    frame({
      message: assistant("progress", text("Working on it"), {
        channel: "commentary",
      }),
    }),
  );
  s.frame(
    frame({
      message: assistant("new-final", unseen, {
        channel: "final",
        end_turn: true,
      }),
    }),
  );
  s.frame(frame({ type: "message_stream_complete" }));
  const snapshot = s.snapshot();
  assert.equal(snapshot.state, "completed");
  assert.equal(s.completionVerified(), true);
  // Unknown, not zero: the answer was not read.
  assert.equal(snapshot.text, null);
  assert.equal(snapshot.intermediate, "Working on it");
  assert.equal(snapshot.attemptId, "new-final");
  // The next request names this message as its parent.
  assert.equal(snapshot.outputId, "new-final");
  assert.ok(snapshot.limitations.includes("unknown_event_observed"));
  // After a known answer, the known text counts and the unseen final ends the turn.
  const after = chatgptTurn([
    assistant("first", text("Part one"), { channel: "final" }),
    assistant("second", unseen, { channel: "final", end_turn: true }),
  ]);
  assert.equal(after.answer, "Part one");
  assert.equal(after.answerUnknown, true);
  assert.equal(after.attemptId, "first");
  assert.equal(after.outputId, "second");
  // Without the final channel or the turn's end, such a message is no answer.
  const aside = chatgptTurn([
    assistant("first", text("Answer"), { channel: "final", end_turn: true }),
    assistant("later", unseen),
  ]);
  assert.equal(aside.answerUnknown, false);
  assert.equal(aside.outputId, "first");
  assert.equal(aside.unknown, true);
});

test("a message of a type not yet seen that ends the turn on another channel still ends and names it", () => {
  const s = new ChatgptSession();
  s.frame(
    frame({
      message: assistant(
        "closing",
        { content_type: "new_kind" },
        {
          channel: "analysis",
          end_turn: true,
        },
      ),
    }),
  );
  s.frame(frame({ type: "message_stream_complete" }));
  const snapshot = s.snapshot();
  assert.equal(snapshot.state, "completed");
  assert.equal(snapshot.text, null);
  assert.equal(snapshot.attemptId, "closing");
  assert.equal(snapshot.outputId, "closing");
  assert.ok(snapshot.limitations.includes("unknown_event_observed"));
});

test("a shown tool result without readable text leaves tool results unknown, not empty", () => {
  const unreadable = chatgptTurn([
    assistant("run", code("print(1)"), { recipient: "container.exec" }),
    tool("output", { content_type: "execution_output", text: { value: 1 } }),
    assistant("answer", text("Done"), { channel: "final", end_turn: true }),
  ]);
  assert.equal(unreadable.toolOutput, undefined);
  assert.equal(unreadable.unknown, true);
  // A tool message the page does not show in full is input the page hides (A6).
  const hidden = chatgptTurn([
    tool("quote", { content_type: "tether_quote", text: "Quoted" }),
    assistant("answer", text("Done"), { channel: "final", end_turn: true }),
  ]);
  assert.equal(hidden.toolOutput, "");
  assert.equal(hidden.unknown, false);
  const s = new ChatgptSession();
  s.frame(
    frame({
      message: tool("output", {
        content_type: "tether_browsing_display",
        result: 7,
      }),
    }),
  );
  s.frame(
    frame({
      message: assistant("answer", text("Done"), {
        channel: "final",
        end_turn: true,
      }),
    }),
  );
  assert.equal(s.snapshot().toolOutput, undefined);
  assert.ok(s.snapshot().limitations.includes("unknown_event_observed"));
});

test("a spoken prompt in a send counts its transcript, as saved history does (A9)", () => {
  const send = parseDispatch(
    "chatgpt",
    new URL("https://chatgpt.com/backend-api/conversation"),
    JSON.stringify({
      action: "next",
      messages: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          author: { role: "user" },
          content: {
            content_type: "multimodal_text",
            parts: [
              {
                content_type: "audio_transcription",
                text: "What is the weather",
                direction: "in",
              },
            ],
          },
        },
      ],
      model: "auto",
    }),
  );
  assert.equal(send.input, "What is the weather");
});
