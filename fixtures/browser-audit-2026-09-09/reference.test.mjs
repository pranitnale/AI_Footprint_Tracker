import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'node:zlib';
import { expectedText, sse, claudeRequest, claudeRetry, claudeFrames, gptHandoff, gptSocket, perplexityFrames, geminiWire } from './examples.mjs';
import { parseSseChunks, parseGeminiChunks, replayClaude, replayChatgpt, replayPerplexity, geminiCandidateText } from './reference-decoders.mjs';

const encode = text => new TextEncoder().encode(text);
const pieces = (bytes, width) => Array.from({ length: Math.ceil(bytes.length / width) }, (_, i) => bytes.slice(i * width, (i + 1) * width));
const claudeWire = claudeFrames.map(([event, data]) => sse(event, data)).join('');

test('Claude gzip decoding selects new prompt, not the envelope or tools', () => {
  const compressed = gzipSync(JSON.stringify(claudeRequest));
  const decoded = JSON.parse(gunzipSync(compressed).toString('utf8'));
  assert.equal(decoded.prompt, 'Reply with exactly: TOKEN TEST OK');
  assert.equal(decoded.prompt.length, 33);
  assert.ok(JSON.stringify(decoded).length > decoded.prompt.length);
});

for (const width of [1, 2, 3, 7, 64]) test('Claude UTF-8 and SSE survive byte fragments of ' + width, () => {
  const result = replayClaude(parseSseChunks(pieces(encode(claudeWire), width)));
  assert.equal(result.text, expectedText);
  assert.equal(result.state, 'completed');
  assert.equal(result.providerUsage, null);
  assert.equal(result.reportedReasoning, null);
});

test('Empty Claude thinking and a quota percentage are not token usage', () => {
  const result = replayClaude(parseSseChunks([encode(claudeWire)]));
  assert.equal(result.providerUsage, null);
  assert.equal(result.reportedReasoning, null);
});

test('Claude Retry has no new prompt but still identifies a new dispatch', () => {
  assert.equal(claudeRetry.prompt, '');
  assert.equal(claudeRetry.parent_message_uuid, 'synthetic-human');
  assert.notEqual(claudeRetry.turn_message_uuids.assistant, claudeRetry.parent_message_uuid);
});

test('Claude stop retains observed output without inventing natural completion', () => {
  const partial = parseSseChunks([encode(claudeFrames.slice(0, 6).map(([e, d]) => sse(e, d)).join(''))]);
  assert.equal(replayClaude(partial, true).state, 'cancelled');
  assert.equal(replayClaude(partial, true).text, expectedText);
  assert.equal(replayClaude(partial).state, 'interrupted_unconfirmed');
});

test('SSE comments are ignored, CRLF and multiline data are preserved', () => {
  const wire = ': keepalive\r\n\r\nevent: message\r\ndata: {"a":\r\ndata: 1}\r\n\r\n';
  assert.deepEqual(parseSseChunks(pieces(encode(wire), 1)).map(f => f.value), [{ a: 1 }]);
});

test('Invalid UTF-8 and incomplete SSE data fail visibly', () => {
  assert.throws(() => parseSseChunks([Uint8Array.from([0xf0, 0x9f])]), /encoded data/);
  assert.throws(() => parseSseChunks([encode('data: {"x":1}')]), /Incomplete SSE/);
  assert.throws(() => parseSseChunks([encode('data: {broken}\n\n')]), SyntaxError);
});

test('An HTTP handoff DONE does not constitute a complete ChatGPT answer', () => {
  const frames = parseSseChunks([encode(gptHandoff)]);
  assert.equal(frames.at(-1).data, '[DONE]');
  assert.equal(replayChatgpt([]).state, 'interrupted_unconfirmed');
});

test('ChatGPT catchups, live duplication, inherited append and final patch count text once', () => {
  const result = replayChatgpt(gptSocket);
  assert.equal(result.text, 'TOKEN TEST OK');
  assert.equal(result.duplicateItems, 1);
  assert.equal(result.state, 'completed');
  assert.equal(result.providerUsage, null);
});

test('Conflicting duplicate ChatGPT items fail instead of silently choosing one', () => {
  const input = structuredClone(gptSocket);
  input[1].payload.payload.encoded_item += ': changed\n\n';
  assert.throws(() => replayChatgpt(input), /Conflicting duplicate/);
});

test('A different ChatGPT topic cannot contaminate the observed turn', () => {
  const unrelated = structuredClone(gptSocket[2]);
  unrelated.topic_id = 'another-synthetic-topic';
  assert.equal(replayChatgpt([...gptSocket, unrelated]).text, 'TOKEN TEST OK');
});

test('ChatGPT client_stopped overrides successful transport termination', () => {
  const input = structuredClone(gptSocket);
  input[3].payload.payload.encoded_item = sse('delta', { p: '', o: 'patch', v: [
    { p: '/message/metadata', o: 'append', v: { finish_details: { type: 'interrupted', reason: 'client_stopped' } } },
  ] });
  assert.equal(replayChatgpt(input).state, 'cancelled');
  assert.equal(replayChatgpt(input).text, 'TOKEN TEST OK');
});

test('Unsupported ChatGPT operations and unsafe pointers fail closed', () => {
  for (const delta of [
    { p: '/message/status', o: 'remove', v: null },
    { p: '/__proto__/polluted', o: 'add', v: true },
    { p: '/message/missing/child', o: 'replace', v: true },
  ]) {
    const input = structuredClone(gptSocket);
    input[3].payload.payload.encoded_item = sse('delta', delta);
    assert.throws(() => replayChatgpt(input));
  }
  assert.equal({}.polluted, undefined);
});

test('Perplexity chunks supply provisional text while its canonical text is empty', () => {
  assert.equal(replayPerplexity(perplexityFrames.slice(0, 1)).text, 'TOKEN ');
  assert.equal(replayPerplexity(perplexityFrames.slice(0, 2)).text, 'TOKEN TEST OK');
  assert.equal(replayPerplexity(perplexityFrames.slice(0, 2)).state, 'interrupted_unconfirmed');
});

test('Perplexity final text replaces chunks and repeated final snapshots', () => {
  const result = replayPerplexity([...perplexityFrames, perplexityFrames.at(-1)]);
  assert.equal(result.text, 'TOKEN TEST OK');
  assert.equal(result.state, 'completed');
  assert.equal(result.providerUsage, null);
});

test('Source counts, block usages and first-token booleans are not token totals', () => {
  assert.equal(perplexityFrames.at(-1).blocks[1].sources_mode_block.result_count, 10);
  assert.equal(replayPerplexity(perplexityFrames).providerUsage, null);
});

test('Perplexity malformed patch arrays fail without fabricating output', () => {
  const input = structuredClone(perplexityFrames.slice(0, 2));
  input[1].blocks[0].diff_block.patches[0].path = '/steps/999/items/0';
  assert.throws(() => replayPerplexity(input), /Missing patch parent/);
});

test('Multiple Perplexity answer items require a new validated aggregation profile', () => {
  const input = structuredClone(perplexityFrames);
  const items = input.at(-1).blocks[0].workflow_block.steps[0].items;
  items.push({ ...structuredClone(items[0]), id: 'synthetic-second-answer' });
  assert.throws(() => replayPerplexity(input), /Multiple or missing answer/);
});

test('An unverified Perplexity text variant is not silently treated as the answer', () => {
  const input = structuredClone(perplexityFrames);
  input.at(-1).blocks[0].workflow_block.steps[0].items[0].variant = 'synthetic-unverified-variant';
  assert.throws(() => replayPerplexity(input), /Unverified text-item variant/);
});

for (const width of [1, 2, 3, 7, 64]) test('Gemini nested JSON and Unicode survive byte fragments of ' + width, () => {
  const frames = parseGeminiChunks(pieces(encode(geminiWire(['', expectedText.slice(0, 6), expectedText, expectedText])), width));
  assert.equal(geminiCandidateText(frames), expectedText);
});

test('Gemini frame length counts UTF-16 units: the leaf payload is 8 units, not 10 bytes', () => {
  const payload = '\n["🌿"]\n';
  assert.equal(payload.length, 8);
  assert.equal(encode(payload).length, 10);
  assert.deepEqual(parseGeminiChunks(pieces(encode(")]}'\n\n8" + payload), 1)), [['🌿']]);
  assert.throws(() => parseGeminiChunks([encode(")]}'\n\n10" + payload)]), /Incomplete Gemini/);
});

test('Gemini malformed guard, excessive length and truncation fail visibly', () => {
  assert.throws(() => parseGeminiChunks([encode('not-json')]), /XSSI/);
  assert.throws(() => parseGeminiChunks([encode(")]}'\n\n9999999999\n")]), /length limit/);
  assert.throws(() => parseGeminiChunks([encode(geminiWire([expectedText]).slice(0, -5))]), /Incomplete Gemini/);
});

test('Gemini rich duplicates and other candidates are not added to selected output', () => {
  const frames = parseGeminiChunks([encode(geminiWire(['TOKEN TEST', 'TOKEN TEST OK', 'TOKEN TEST OK']))]);
  assert.equal(geminiCandidateText(frames), 'TOKEN TEST OK');
  assert.throws(() => geminiCandidateText(frames, 'unobserved-candidate'), /No selected candidate/);
});

test('NFD and NFC strings stay distinct until a tokenizer profile explicitly says otherwise', () => {
  const nfd = 'e\u0301', nfc = '\u00e9';
  assert.notEqual(nfd, nfc);
  assert.equal(nfd.length, 2);
  assert.equal(nfc.length, 1);
});
