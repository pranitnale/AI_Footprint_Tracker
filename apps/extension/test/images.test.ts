import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ChatgptSession,
  parseDispatch,
  initialSnapshot,
} from "@footprint/adapters";
import { Ledger } from "@footprint/ledger";
import { Coordinator } from "../lib/coordinator";
import { countByTextLength, unavailableCount } from "./counting-fixture";
const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../../fixtures/browser-audit-2026-09-10/chatgpt-image-structure.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
function session(handoff: any) {
  const value = new ChatgptSession();
  value.frame({
    event: "stream_handoff",
    data: JSON.stringify(handoff),
    value: handoff,
  });
  return value;
}
const asyncStatus = (status: number) => ({
  type: "conversation-update",
  payload: {
    conversation_id: "conversation-fixture",
    update_type: "set-conversation-async-status",
    update_content: {
      conversation_async_status: status,
      is_async_correction: false,
    },
  },
  metadata: null,
});
test("IM14 provisional image execution survives cancellation before asset delivery and reconciles by message identity", async () => {
  const ordinary = session(fixture.generation.handoff),
    unproven = structuredClone(fixture.generation.updates[0]);
  delete unproven.payload.update_content.messages[0].metadata.ghostrider;
  ordinary.socket(unproven);
  assert.equal(ordinary.snapshot().started, false);
  assert.equal(ordinary.snapshot().imageOperations.length, 0);
  const ledger = await Ledger.open(
    "image-before-output-" + crypto.randomUUID(),
  );
  const coordinator = new Coordinator(ledger, {
    hasConsent: async () => true,
    count: unavailableCount,
    sendDisplay: async () => {},
  });
  const scope = await coordinator.currentScope(),
    at = new Date().toISOString(),
    id = crypto.randomUUID();
  const sender = {
    tab: { id: 21 },
    frameId: 0,
    documentId: "pre-image",
    url: "https://chatgpt.com/",
  };
  const dispatch = parseDispatch(
    "chatgpt",
    new URL("https://chatgpt.com" + fixture.generation.path),
    JSON.stringify(fixture.generation.request),
  );
  const envelope: any = {
    channel: "ai-footprint-observation-v1",
    version: 1,
    id,
    revision: 1,
    event: "dispatch",
    site: "chatgpt",
    at,
    dispatch,
    snapshot: initialSnapshot(),
    failure: null,

    timing: null,
  };
  await coordinator.capture(envelope, sender);
  const s = session(fixture.generation.handoff);
  s.socket(fixture.generation.updates[0]);
  assert.equal(s.snapshot().started, true);
  assert.equal(s.snapshot().imageOperations.length, 1);
  assert.equal(s.snapshot().imageOperations[0].outputs.length, 0);
  s.stopped();
  await coordinator.capture(
    {
      ...envelope,
      revision: 2,
      event: "end",
      dispatch: null,
      snapshot: s.snapshot(),
    },
    sender,
  );
  const rows = await ledger.rows(scope.namespace),
    attempt = rows.find((row) => row.record.kind === "attempt")!.record;
  assert.equal(attempt.state, "cancelled");
  if (attempt.kind !== "attempt") throw new Error();
  assert.equal(attempt.execution_evidence, "provider_started");
  assert.equal(attempt.media.image_operations.length, 1);
  assert.equal(attempt.media.image_operations[0].state, "cancelled");
  assert.equal(attempt.media.image_operations[0].returned_count, null);
  assert.equal(attempt.media.image_operations[0].requested_count, null);
  assert.equal(attempt.media.generated_images.length, 0);
  assert.ok(!JSON.stringify(rows).includes("generation-intermediate"));
  // D1: a job that visibly started counts as one image, here on the OpenAI environment
  // (2.907 Wh times a PUE of 1.2, own calculation).
  assert.deepEqual(attempt.generation.media, [
    {
      kind: "image",
      model_id: null,
      count: "1",
      width: null,
      height: null,
      outcome: "started_not_returned",
    },
  ]);
  const persistedEstimate = await ledger.get<any>(
    "local_estimates",
    `current:${scope.namespace}:${attempt.attempt_id}`,
  );
  assert.ok(
    Math.abs(
      Number(persistedEstimate.estimate.metrics.energy.value) - 0.0034884,
    ) < 1e-12,
  );
  const observed = session(fixture.generation.handoff);
  for (const update of fixture.generation.updates) observed.socket(update);
  observed.socket(fixture.generation.updates[0]);
  assert.equal(observed.snapshot().imageOperations.length, 1);
  assert.equal(observed.snapshot().imageOperations[0].id, "gen-original");
  assert.equal(observed.snapshot().imageOperations[0].outputs.length, 1);
  ledger.close();
});
test("IM07 missing operation identity and conflicting observed image dimensions fail visibly", () => {
  const missing = structuredClone(fixture.edit.updates[1]);
  const part = missing.payload.update_content.messages[0].content.parts[0];
  delete part.metadata.generation.gen_id;
  delete part.metadata.dalle.gen_id;
  assert.throws(
    () => session(fixture.edit.handoff).socket(missing),
    /unsupported_schema/,
  );
  const conflicting = structuredClone(fixture.edit.updates[1]);
  conflicting.payload.update_content.messages[0].content.parts[0].metadata.generation.width = 512;
  assert.throws(
    () => session(fixture.edit.handoff).socket(conflicting),
    /conflicting_duplicate/,
  );
});
test("IM08 repeated asset metadata may fill unknown dimensions without creating another output", () => {
  const s = session(fixture.edit.handoff),
    sparse = structuredClone(fixture.edit.updates[1]);
  const part = sparse.payload.update_content.messages[0].content.parts[0];
  delete part.width;
  delete part.height;
  delete part.metadata.generation.width;
  delete part.metadata.generation.height;
  s.socket(sparse);
  s.socket(fixture.edit.updates[1]);
  s.socket(sparse);
  const images = s.snapshot().imageOperations;
  assert.equal(images.length, 1);
  assert.equal(images[0].outputs.length, 1);
  assert.equal(images[0].outputs[0].width, 1254);
  assert.equal(images[0].outputs[0].height, 1254);
});
test("IM01 IM02 observed edit metadata is per image part and output identity is independent of tool message", () => {
  const s = session(fixture.edit.handoff);
  for (const update of fixture.edit.updates) s.socket(update);
  const op = s.snapshot().imageOperations[0]!;
  assert.equal(op.outputs.length, 1);
  assert.equal(op.id, "gen-edited");
  assert.equal(op.parentId, "gen-original");
  assert.equal(op.kind, "image_edit");
  assert.equal(op.state, "completed");
  assert.equal(s.snapshot().model, null);
  // The reply started with its image; no answer text was written and tool text is not one.
  assert.equal(s.snapshot().text, "");
  const bad = structuredClone(fixture.edit.updates.at(-1));
  bad.payload.update_content.messages[0].content.parts[0].metadata.dalle.gen_id =
    "conflicting-gen";
  assert.throws(() => s.socket(bad), /conflicting_duplicate/);
});
test("IM03 async image completion requires correlated final generation plus sole-turn conversation terminal", () => {
  const s = session(fixture.edit.handoff);
  s.socket(asyncStatus(5), { allowConversationTerminal: true });
  s.socket({
    topic_id: "topic-edit",
    payload: {
      type: "conversation-turn-stream",
      payload: { type: "conversation-turn-complete" },
    },
  });
  for (const update of fixture.edit.updates.slice(0, 2)) s.socket(update);
  assert.equal(s.snapshot().state, "generating");
  s.socket(asyncStatus(4), { allowConversationTerminal: false });
  s.socket(fixture.edit.updates.at(-1));
  assert.equal(s.snapshot().state, "generating");
  s.socket(asyncStatus(4), { allowConversationTerminal: true });
  assert.equal(s.snapshot().state, "completed");
});
test("IM04 original image reference is an edit intent, not a new upload or requested output count", () => {
  const d = parseDispatch(
    "chatgpt",
    new URL("https://chatgpt.com" + fixture.edit.path),
    JSON.stringify(fixture.edit.request),
  );
  assert.equal(d.imageEditParentId, "gen-original");
  assert.equal(d.attachments, 0);
  const plain = parseDispatch(
    "chatgpt",
    new URL("https://chatgpt.com" + fixture.generation.path),
    JSON.stringify(fixture.generation.request),
  );
  assert.equal(plain.imageEditParentId, null);
});
test("IM05 numeric ledger retains one 1254px edit and its image estimate, without provider IDs/tool text", async () => {
  const ledger = await Ledger.open("image-pipeline-" + crypto.randomUUID());
  const displays: any[] = [];
  const coordinator = new Coordinator(ledger, {
    hasConsent: async () => true,
    sendDisplay: async (_, value) => {
      displays.push(value);
    },
    count: countByTextLength,
  });
  const scope = await coordinator.currentScope();
  const at = new Date().toISOString();
  const id = crypto.randomUUID();
  const sender = {
    tab: { id: 9 },
    frameId: 0,
    documentId: "image-doc",
    url: "https://chatgpt.com/c/fixture",
  };
  const dispatch = parseDispatch(
    "chatgpt",
    new URL("https://chatgpt.com" + fixture.edit.path),
    JSON.stringify(fixture.edit.request),
  );
  await coordinator.capture(
    {
      channel: "ai-footprint-observation-v1",
      version: 1,
      id,
      revision: 1,
      event: "dispatch",
      site: "chatgpt",
      at,
      dispatch,
      snapshot: initialSnapshot(),
      failure: null,

      timing: null,
    },
    sender,
  );
  const s = session(fixture.edit.handoff);
  for (const update of fixture.edit.updates) s.socket(update);
  s.socket(asyncStatus(4), { allowConversationTerminal: true });
  const snapshot = { ...s.snapshot(), text: "" };
  await coordinator.capture(
    {
      channel: "ai-footprint-observation-v1",
      version: 1,
      id,
      revision: 2,
      event: "end",
      site: "chatgpt",
      at,
      dispatch: null,
      snapshot,
      failure: null,

      timing: null,
    },
    sender,
  );
  const rows = await ledger.rows(scope.namespace);
  const attempt = rows.find((row) => row.record.kind === "attempt")!.record;
  assert.equal(attempt.kind, "attempt");
  if (attempt.kind !== "attempt") throw new Error();
  assert.equal(attempt.media.image_operations.length, 1);
  assert.equal(attempt.media.image_operations[0]!.returned_count, "1");
  assert.equal(attempt.media.generated_images.length, 1);
  assert.equal(attempt.media.image_operations[0]!.model_id, null);
  assert.equal(attempt.tokens.answer_output.value, "0");
  const [image] = attempt.media.generated_images;
  assert.deepEqual(attempt.generation.media, [
    {
      kind: "image",
      model_id: null,
      count: "1",
      width: image!.width,
      height: image!.height,
      outcome: "returned",
    },
  ]);
  const view = displays.at(-1).summary;
  assert.equal(view.images.returned, "1");
  // The answer has no text, so the reply's energy is the one image (D1, own calculation).
  assert.ok(Math.abs(Number(view.metrics.energy.value) - 0.0034884) < 1e-12);
  // The image benchmark data was removed on 20 October 2026: neither method produces a
  // reference any more, and the image above is still counted.
  assert.deepEqual(view.estimate.image_references, []);
  assert.equal("imageReferences" in view, false);
  const original = await coordinator.dashboard({
    calculationView: "recalculated",
    methodId: coordinator.engines.methods.original.method_id,
  });
  assert.deepEqual(original.summary.estimate.image_references, []);
  const persisted = JSON.stringify([
    ...rows,
    ...(await ledger.all("provider_key_map")),
  ]);
  for (const marker of [
    "asset-edit",
    "gen-edited",
    "gen-original",
    "Synthetic image-edit fixture",
    "Synthetic non-countable tool text",
  ])
    assert.ok(!persisted.includes(marker), marker);
  ledger.close();
});
