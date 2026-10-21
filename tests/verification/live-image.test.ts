import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ChatgptSession } from '../../packages/adapters/src/chatgpt';

const fixture = JSON.parse(readFileSync(new URL('../../fixtures/browser-audit-2026-09-10/chatgpt-image-structure.json', import.meta.url), 'utf8'));

function observedSession(handoff: unknown) {
  const session = new ChatgptSession();
  session.frame({ event: 'stream_handoff', data: JSON.stringify(handoff), value: handoff });
  return session;
}

test('independent live image oracle counts one asset across two provider tool-message identities', () => {
  const session = observedSession(fixture.generation.handoff);
  for (const update of fixture.generation.updates) session.socket(update);
  const images = session.snapshot().imageOperations;
  assert.equal(images.length, 1);
  assert.equal(images[0]?.kind, 'text_to_image');
  assert.equal(images[0]?.outputs.length, fixture.expected.generation_output_images);
  assert.deepEqual(images[0]?.outputs.map(({ width, height }) => ({ width, height })), [{ width: 1254, height: 1254 }]);
  assert.equal(images[0]?.requestedCount, null);
});

test('independent live edit oracle retains one transformed output and rejects other turns', () => {
  const session = observedSession(fixture.edit.handoff);
  for (const update of fixture.generation.updates) session.socket(update);
  assert.equal(session.snapshot().imageOperations.length, 0);
  for (const update of fixture.edit.updates) session.socket(update);
  const images = session.snapshot().imageOperations;
  assert.equal(images.length, 1);
  assert.equal(images[0]?.kind, 'image_edit');
  assert.equal(images[0]?.outputs.length, fixture.expected.edit_output_images);
  assert.equal(images[0]?.state, 'completed');
  const foreign = structuredClone(fixture.edit.updates.at(-1));
  foreign.payload.conversation_id = 'unrelated-conversation';
  foreign.payload.update_content.messages[0].content.parts[0].asset_pointer = 'file-service://unrelated-asset';
  session.socket(foreign);
  assert.equal(session.snapshot().imageOperations[0]?.outputs.length, 1);
});
