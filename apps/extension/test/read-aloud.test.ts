import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Ledger } from "@footprint/ledger";
import { initialSnapshot } from "@footprint/adapters";
import {
  createMethodRegistry,
  LocalEstimateExecutor,
} from "@footprint/estimator";
import config from "../../../config/estimation.build.json";
import mappings from "../../../config/estimation.mappings.json";
import media from "../../../config/estimation.media.json";
import { installCapture } from "../lib/capture-runtime";
import { Coordinator } from "../lib/coordinator";
import { summarize } from "../lib/summary";
import { countByTextLength } from "./counting-fixture";

// ChatGPT read aloud (G1, owner 3 Oct): a GET of AAC audio, timed by its frames.
class TestWindow extends EventTarget {
  messages: any[] = [];
  fetch: typeof fetch;
  WebSocket: any;
  constructor(fetcher: typeof fetch) {
    super();
    this.fetch = fetcher;
    this.WebSocket = class extends EventTarget {};
  }
  postMessage(value: any) {
    this.messages.push(value);
  }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
function frame(payload = 30) {
  const length = 7 + payload;
  const bytes = new Uint8Array(length);
  bytes.set([
    0xff,
    0xf1,
    (1 << 6) | (6 << 2),
    (1 << 6) | ((length >> 11) & 0x03),
    (length >> 3) & 0xff,
    ((length & 0x07) << 5) | 0x1f,
    0xfc,
  ]);
  return bytes;
}
const audio = (frames: number) => {
  const one = frame();
  const out = new Uint8Array(one.length * frames);
  for (let i = 0; i < frames; i++) out.set(one, i * one.length);
  return out;
};
const synthesize = (message: string) =>
  `https://chatgpt.com/backend-api/synthesize?message_id=${message}&conversation_id=00000000-0000-4000-8000-000000000042&voice=ember&format=aac`;
function environment(fetcher: typeof fetch) {
  const win = new TestWindow(fetcher);
  Object.assign(globalThis, {
    window: win,
    location: {
      origin: "https://chatgpt.com",
      hostname: "chatgpt.com",
      pathname: "/c/00000000-0000-4000-8000-000000000042",
      href: "https://chatgpt.com/c/00000000-0000-4000-8000-000000000042",
    },
  });
  installCapture();
  return win;
}
const ends = (win: TestWindow) =>
  win.messages.filter((m) => m.channel && m.event === "end");

test("G1 read aloud is captured as its own speech, timed by the audio frames the page receives", async () => {
  const bytes = audio(240);
  const win = environment((() =>
    Promise.resolve(
      new Response(bytes, { headers: { "content-type": "audio/aac" } }),
    )) as typeof fetch);
  try {
    const response = await win.fetch(synthesize("answer-1"), {
      headers: { Authorization: "Bearer synthetic" },
    });
    // The page receives its audio unchanged.
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
    for (let i = 0; i < 50 && !ends(win).length; i++) await tick();
    const dispatch = win.messages.find((m) => m.event === "dispatch");
    assert.equal(dispatch.dispatch.action, "read_aloud");
    assert.equal(dispatch.dispatch.input, "");
    assert.equal(dispatch.dispatch.parentId, null);
    const [end] = ends(win);
    assert.equal(end.failure, null);
    assert.equal(end.snapshot.state, "completed");
    assert.equal(end.snapshot.text, "");
    assert.deepEqual(end.snapshot.media, [
      {
        kind: "speech",
        basis: "audio_frames",
        seconds: (240 * 1024) / 24000,
        characters: null,
      },
    ]);
    assert.ok(end.timing);
    assert.equal(
      win.messages.some((m) => m.event === "health"),
      false,
    );
  } finally {
    win.dispatchEvent(new Event("pagehide"));
  }
});

test("G1 stopping read aloud keeps the speech received and is not a tracking problem", async () => {
  const one = audio(10);
  let push!: (bytes: Uint8Array) => void, fail!: () => void;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      push = (bytes) => controller.enqueue(bytes);
      fail = () => controller.error(new DOMException("aborted", "AbortError"));
    },
  });
  const win = environment((() =>
    Promise.resolve(new Response(stream))) as typeof fetch);
  try {
    const response = await win.fetch(synthesize("answer-2"));
    const reader = response.body!.getReader();
    push(one);
    await reader.read();
    await tick();
    fail();
    await reader.read().catch(() => {});
    for (let i = 0; i < 50 && !ends(win).length; i++) await tick();
    const [end] = ends(win);
    assert.equal(end.failure, null);
    assert.equal(end.snapshot.state, "cancelled");
    assert.deepEqual(end.snapshot.media, [
      {
        kind: "speech",
        basis: "audio_frames",
        seconds: (10 * 1024) / 24000,
        characters: null,
      },
    ]);
  } finally {
    win.dispatchEvent(new Event("pagehide"));
  }
});

test("G1 a read aloud stopped before its audio starts is a stop, not a tracking problem", async () => {
  const win = environment((() =>
    Promise.reject(new DOMException("aborted", "AbortError"))) as typeof fetch);
  try {
    // The page sees its own abort unchanged.
    await assert.rejects(win.fetch(synthesize("answer-4")), {
      name: "AbortError",
    });
    for (let i = 0; i < 50 && !ends(win).length; i++) await tick();
    const [end] = ends(win);
    assert.equal(end.failure, null);
    assert.equal(end.snapshot.state, "cancelled");
    assert.equal(end.snapshot.started, false);
    assert.equal(end.snapshot.media, undefined);
    assert.equal(
      win.messages.some((m) => m.event === "health"),
      false,
    );
  } finally {
    win.dispatchEvent(new Event("pagehide"));
  }
});

test("G1 a lost connection during read aloud keeps the speech received and reports the interruption", async () => {
  let push!: (bytes: Uint8Array) => void, fail!: () => void;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      push = (bytes) => controller.enqueue(bytes);
      // A dropped connection rejects reads with a TypeError, not an abort.
      fail = () => controller.error(new TypeError("network error"));
    },
  });
  const win = environment((() =>
    Promise.resolve(new Response(stream))) as typeof fetch);
  try {
    const response = await win.fetch(synthesize("answer-5"));
    const reader = response.body!.getReader();
    push(audio(10));
    await reader.read();
    await tick();
    fail();
    await reader.read().catch(() => {});
    for (let i = 0; i < 50 && !ends(win).length; i++) await tick();
    const [end] = ends(win);
    assert.equal(end.failure, "capture_interrupted");
    assert.equal(end.snapshot.state, "interrupted_unconfirmed");
    assert.deepEqual(end.snapshot.media, [
      {
        kind: "speech",
        basis: "audio_frames",
        seconds: (10 * 1024) / 24000,
        characters: null,
      },
    ]);
  } finally {
    win.dispatchEvent(new Event("pagehide"));
  }
});

test("G1 a turn of several answers lends read aloud no joined length", async () => {
  const message = (id: string, text: string, end: boolean) =>
    `data: ${JSON.stringify({
      message: {
        id,
        author: { role: "assistant" },
        channel: "final",
        end_turn: end,
        status: "finished_successfully",
        content: { content_type: "text", parts: [text] },
      },
    })}\n\n`;
  let next: () => Response = () =>
    new Response(
      message("part-1", "x".repeat(100), false) +
        message("part-2", "y".repeat(50), true) +
        'data: {"type":"message_stream_complete"}\n\n',
    );
  const win = environment((() => Promise.resolve(next())) as typeof fetch);
  try {
    const reply = await win.fetch(
      "https://chatgpt.com/backend-api/conversation",
      {
        method: "POST",
        body: JSON.stringify({
          action: "next",
          conversation_id: "00000000-0000-4000-8000-000000000042",
          messages: [
            {
              id: "prompt",
              author: { role: "user" },
              content: { content_type: "text", parts: ["Explain"] },
            },
          ],
        }),
      },
    );
    await reply.text();
    for (let i = 0; i < 50 && !ends(win).length; i++) await tick();
    assert.equal(ends(win)[0].snapshot.text.length, 151);
    next = () =>
      new Response(new TextEncoder().encode("OggS synthetic opus audio"));
    // Each answer is read on its own; the joined 151 characters fit neither.
    for (const [index, id] of ["part-2", "part-1"].entries()) {
      const read = await win.fetch(synthesize(id));
      await read.arrayBuffer();
      for (let i = 0; i < 50 && ends(win).length < index + 2; i++) await tick();
      const speech = ends(win)[index + 1];
      assert.equal(speech.snapshot.media, undefined, id);
      assert.ok(speech.snapshot.limitations.includes("unknown_event_observed"));
    }
  } finally {
    win.dispatchEvent(new Event("pagehide"));
  }
});

test("G1 audio the reader cannot time takes the read answer's characters at the reading rate", async () => {
  const final = (id: string, text: string) =>
    `data: ${JSON.stringify({
      message: {
        id,
        author: { role: "assistant" },
        channel: "final",
        end_turn: true,
        status: "finished_successfully",
        content: { content_type: "text", parts: [text] },
      },
    })}\n\ndata: {"type":"message_stream_complete"}\n\n`;
  let next: () => Response = () =>
    new Response(final("answer-3", "x".repeat(340)));
  const win = environment((() => Promise.resolve(next())) as typeof fetch);
  try {
    const reply = await win.fetch(
      "https://chatgpt.com/backend-api/conversation",
      {
        method: "POST",
        body: JSON.stringify({
          action: "next",
          conversation_id: "00000000-0000-4000-8000-000000000042",
          messages: [
            {
              id: "prompt",
              author: { role: "user" },
              content: { content_type: "text", parts: ["Explain"] },
            },
          ],
        }),
      },
    );
    await reply.text();
    for (let i = 0; i < 50 && !ends(win).length; i++) await tick();
    // The audio arrives in a format the reader does not know.
    next = () =>
      new Response(new TextEncoder().encode("OggS synthetic opus audio"));
    const read = await win.fetch(synthesize("answer-3"));
    await read.arrayBuffer();
    for (let i = 0; i < 50 && ends(win).length < 2; i++) await tick();
    const speech = ends(win)[1];
    assert.equal(speech.failure, null);
    assert.deepEqual(speech.snapshot.media, [
      { kind: "speech", basis: "characters", seconds: null, characters: 340 },
    ]);
    // An answer the page never showed leaves the speech unknown, said in Details.
    const unknown = await win.fetch(synthesize("answer-unseen"));
    await unknown.arrayBuffer();
    for (let i = 0; i < 50 && ends(win).length < 3; i++) await tick();
    const unseen = ends(win)[2];
    assert.equal(unseen.snapshot.media, undefined);
    assert.ok(unseen.snapshot.limitations.includes("unknown_event_observed"));
  } finally {
    win.dispatchEvent(new Event("pagehide"));
  }
});

test("G1 read aloud adds its attempt to the totals but never a request", () => {
  const request = (id: string, action: string) => ({
    key: id,
    era: 1,
    record: {
      kind: "request",
      request_id: id,
      site: "chatgpt",
      action,
      model_id: null,
      dispatched_at: "2026-10-04T10:00:00.000Z",
      documents: {
        extracted_text: null,
        upload_count: null,
        types: [],
        processing: "none",
      },
      media: {
        input_images: [],
        requested_operations: [],
        coverage_reasons: [],
      },
    },
  });
  const summary = summarize(
    [request("send-1", "send"), request("read-1", "read_aloud")] as any,
    [],
  );
  assert.equal(summary.requests, 1);
  assert.equal(summary.tools.chatgpt, 1);
});

// The product's current method, which estimates generated speech.
const methods = createMethodRegistry(config, mappings, media);
const estimation = { methods, executor: new LocalEstimateExecutor(methods) };

test("G1 the coordinator saves read aloud as audio and keeps showing the reply it read", async () => {
  const conversation = "00000000-0000-4000-8000-000000000042";
  const sender = {
    tab: { id: 3 },
    frameId: 0,
    documentId: "read-aloud-document",
    url: `https://chatgpt.com/c/${conversation}`,
  };
  const db = await Ledger.open("read-aloud-" + crypto.randomUUID());
  const displays: any[] = [];
  const coordinator = new Coordinator(db, {
    estimation,
    count: countByTextLength,
    hasConsent: async () => true,
    sendDisplay: async (_, message) => {
      displays.push(message);
    },
    transport: async () => {
      throw new Error("personal mode stays local");
    },
  });
  // The page binds each capture to its document, as the content script does.
  const binding = (captureId: string) => ({
    documentNonce: "00000000-0000-4000-8000-0000000000d1",
    navigationNonce: "00000000-0000-4000-8000-0000000000d2",
    captureId,
  });
  const message = (id: string, action: string, input: string) => ({
    timing: null,
    channel: "ai-footprint-observation-v1",
    version: 1,
    id,
    revision: 1,
    event: "dispatch",
    site: "chatgpt",
    at: new Date().toISOString(),
    dispatch: {
      site: "chatgpt",
      action,
      input,
      conversationId: conversation,
      parentId: null,
      requestId: null,
      model: null,
      attachments: 0,
      imageEditParentId: null,
    },
    snapshot: initialSnapshot(),
    failure: null,
  });
  try {
    await coordinator.updateSettings({ budget: 1000 });
    const reply = message(crypto.randomUUID(), "send", "Explain heat pumps");
    await coordinator.capture(reply as any, sender, binding(reply.id));
    await coordinator.capture(
      {
        ...reply,
        revision: 2,
        event: "end",
        dispatch: null,
        snapshot: {
          ...initialSnapshot(),
          text: "Heat pumps move heat.",
          thinking: "",
          started: true,
          state: "completed",
          conversationId: conversation,
          outputId: "answer-1",
          attemptId: "answer-1",
        },
      } as any,
      sender,
      binding(reply.id),
    );
    const shown = displays
      .filter((d) => d.target === "footprint-display")
      .at(-1);
    assert.ok(shown.activeContext !== null);
    const before = displays.length;
    const speech = message(crypto.randomUUID(), "read_aloud", "");
    await coordinator.capture(speech as any, sender, binding(speech.id));
    await coordinator.capture(
      {
        ...speech,
        revision: 2,
        event: "end",
        dispatch: null,
        snapshot: {
          ...initialSnapshot(),
          text: "",
          thinking: "",
          toolInput: "",
          intermediate: "",
          toolOutput: "",
          started: true,
          state: "completed",
          conversationId: conversation,
          media: [
            {
              kind: "speech",
              basis: "audio_frames",
              seconds: 10.24,
              characters: null,
            },
          ],
        },
      } as any,
      sender,
      binding(speech.id),
    );
    const requests = (await db.all<{ record: any }>("requests")).map(
      (row) => row.record,
    );
    const spoken = requests.find((r) => r.action === "read_aloud");
    assert.deepEqual(spoken.features, ["audio"]);
    const attempts = (await db.all<{ record: any }>("attempts")).map(
      (row) => row.record,
    );
    const audio = attempts.find((a) => a.request_id === spoken.request_id);
    assert.deepEqual(audio.generation.media, [
      {
        kind: "speech",
        length_basis: "audio_frames",
        seconds: "10.24",
        characters: null,
      },
    ]);
    // Its input is the reply it reads, not a new turn's context.
    assert.equal(audio.tokens.logical_input_total.value, null);
    // The tab still shows the reply, now with totals that hold one request. The page
    // never selects the read aloud, so no display is bound to it.
    const after = displays.slice(before);
    assert.equal(after.length, 1);
    const [last] = after;
    assert.equal(last.displayBinding.captureId, reply.id);
    assert.equal(last.summary.requests, 1);
    // Both attempts count, and the speech adds energy to the reply's.
    assert.equal(last.summary.attempts, 2);
    assert.equal(last.summary.metrics.energy.known, 2);
    assert.ok(
      Number(last.summary.metrics.energy.value) >
        Number(shown.summary.metrics.energy.value),
    );
    assert.equal(last.activeContext, shown.activeContext);
    assert.equal(last.state, "completed");
    assert.ok(displays.every((d) => d.displayBinding?.captureId !== speech.id));
    // In a tab that shows no reply, the page reads its saved totals itself.
    const elsewhere = {
      ...sender,
      tab: { id: 4 },
      documentId: "other-document",
    };
    const second = message(crypto.randomUUID(), "read_aloud", "");
    const count = displays.length;
    await coordinator.capture(second as any, elsewhere, binding(second.id));
    await coordinator.capture(
      {
        ...second,
        revision: 2,
        event: "end",
        dispatch: null,
        snapshot: {
          ...initialSnapshot(),
          text: "",
          thinking: "",
          toolInput: "",
          intermediate: "",
          toolOutput: "",
          started: true,
          state: "completed",
          conversationId: conversation,
          media: [
            {
              kind: "speech",
              basis: "audio_frames",
              seconds: 2.048,
              characters: null,
            },
          ],
        },
      } as any,
      elsewhere,
      binding(second.id),
    );
    assert.equal(displays.length, count);
    const saved = (await db.all<{ record: any }>("requests")).filter(
      (row) => row.record.action === "read_aloud",
    );
    assert.equal(saved.length, 2);
  } finally {
    coordinator.engines.dispose();
    db.close();
  }
});
