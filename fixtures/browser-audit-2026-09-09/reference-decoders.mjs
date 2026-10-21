// Research examples only. Unknown shapes fail instead of producing plausible counts.
const MAX_UNITS = 1_048_576;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);

function safeValue(value) {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (forbidden.has(key)) throw new Error('Unsafe object key');
      safeValue(value[key]);
    }
  }
  return value;
}

function consumeUtf8(chunks, onText) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (const chunk of chunks) onText(decoder.decode(chunk, { stream: true }));
  onText(decoder.decode());
}

export function parseSseChunks(chunks) {
  let buffer = '';
  const frames = [];
  consumeUtf8(chunks, text => {
    buffer += text;
    if (buffer.length > MAX_UNITS) throw new Error('SSE buffer limit');
    let separator;
    while ((separator = /\r?\n\r?\n/.exec(buffer))) {
      const raw = buffer.slice(0, separator.index);
      buffer = buffer.slice(separator.index + separator[0].length);
      let event = 'message';
      const data = [];
      for (const line of raw.split(/\r?\n/)) {
        if (line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const key = colon < 0 ? line : line.slice(0, colon);
        let value = colon < 0 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (key === 'event') event = value;
        if (key === 'data') data.push(value);
      }
      if (!data.length) continue;
      const joined = data.join('\n');
      frames.push({ event, data: joined, value: joined === '[DONE]' ? null : safeValue(JSON.parse(joined)) });
    }
  });
  if (buffer.trim()) throw new Error('Incomplete SSE frame');
  return frames;
}

export function parseGeminiChunks(chunks) {
  const guard = ")]}'\n\n";
  let buffer = '', guarded = false;
  const frames = [];
  consumeUtf8(chunks, text => {
    buffer += text;
    if (buffer.length > MAX_UNITS) throw new Error('Gemini buffer limit');
    if (!guarded) {
      if (buffer.length < guard.length) return;
      if (!buffer.startsWith(guard)) throw new Error('Unknown XSSI guard');
      buffer = buffer.slice(guard.length);
      guarded = true;
    }
    for (;;) {
      buffer = buffer.replace(/^[\r\n]+/, '');
      if (!buffer.length) return;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const prefix = buffer.slice(0, newline);
      if (!/^\d+$/.test(prefix)) throw new Error('Invalid frame length');
      const length = Number(prefix);
      if (!Number.isSafeInteger(length) || length < 2 || length > MAX_UNITS) throw new Error('Frame length limit');
      // The observed length starts at this LF, after UTF-8 has been decoded.
      if (buffer.length < newline + length) return;
      const payload = buffer.slice(newline, newline + length);
      if (!payload.endsWith('\n')) throw new Error('Invalid frame boundary');
      frames.push(safeValue(JSON.parse(payload)));
      buffer = buffer.slice(newline + length);
    }
  });
  if (!guarded || buffer.trim()) throw new Error('Incomplete Gemini frame');
  return frames;
}

function patchAt(root, path, operation, value) {
  safeValue(value);
  if (!['add', 'replace', 'append'].includes(operation)) throw new Error('Unsupported patch operation');
  if (path === '') {
    if (operation === 'append') throw new Error('Unsupported root append');
    return structuredClone(value);
  }
  if (typeof path !== 'string' || !path.startsWith('/') || /~(?![01])/.test(path)) throw new Error('Invalid pointer');
  const parts = path.slice(1).split('/').map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (parts.some(p => forbidden.has(p))) throw new Error('Unsafe pointer');
  let parent = root;
  for (const key of parts.slice(0, -1)) {
    if (!parent || !Object.hasOwn(parent, key)) throw new Error('Missing patch parent');
    parent = parent[key];
  }
  if (!parent || typeof parent !== 'object') throw new Error('Invalid patch parent');
  const key = parts.at(-1);
  const exists = Object.hasOwn(parent, key);
  if (operation !== 'add' && !exists) throw new Error('Missing patch target');
  if (Array.isArray(parent)) {
    if (!/^(0|[1-9]\d*)$/.test(key)) throw new Error('Invalid array index');
    const index = Number(key);
    if (index > parent.length || (operation !== 'add' && index === parent.length)) throw new Error('Array index range');
    if (operation === 'add') {
      parent.splice(index, 0, structuredClone(value));
      return root;
    }
  }
  if (operation === 'append') {
    const old = parent[key];
    if (typeof old === 'string' && typeof value === 'string') parent[key] = old + value;
    else if (Array.isArray(old) && Array.isArray(value)) parent[key] = old.concat(structuredClone(value));
    else if (old && value && typeof old === 'object' && typeof value === 'object' && !Array.isArray(old) && !Array.isArray(value)) {
      parent[key] = { ...old, ...structuredClone(value) };
    } else throw new Error('Append type mismatch');
  } else parent[key] = structuredClone(value);
  return root;
}

export function replayClaude(frames, userStopped = false) {
  const blocks = new Map();
  let terminal = false, endTurn = false;
  for (const { value } of frames) {
    if (value?.type === 'content_block_start') blocks.set(value.index, structuredClone(value.content_block));
    if (value?.type === 'content_block_delta') {
      const block = blocks.get(value.index);
      if (!block) throw new Error('Delta without block');
      if (value.delta?.type !== 'text_delta' || block.type !== 'text') throw new Error('Unsupported Claude delta in reduced fixture');
      if (typeof value.delta.text !== 'string') throw new Error('Invalid text delta');
      block.text += value.delta.text;
    }
    if (value?.type === 'message_delta') endTurn = value.delta?.stop_reason === 'end_turn';
    if (value?.type === 'message_stop') terminal = true;
  }
  return {
    text: [...blocks.values()].filter(b => b.type === 'text').map(b => b.text).join(''),
    state: userStopped ? 'cancelled' : terminal && endTurn ? 'completed' : 'interrupted_unconfirmed',
    providerUsage: null, reportedReasoning: null,
  };
}

export function replayChatgpt(socket, topic = 'synthetic-topic') {
  const seen = new Map(), messages = new Map();
  let root = null, path = null, operation = null, transportDone = false, duplicateItems = 0;
  for (const envelope of socket.flatMap(m => m.reply?.catchups || [m])) {
    if (envelope.topic_id !== topic || envelope.payload?.type !== 'conversation-turn-stream') continue;
    const item = envelope.payload.payload;
    if (item.type === 'done') { transportDone = true; continue; }
    if (item.type !== 'stream-item' || typeof item.stream_item_id !== 'string') throw new Error('Unknown stream item');
    if (seen.has(item.stream_item_id)) {
      if (seen.get(item.stream_item_id) !== item.encoded_item) throw new Error('Conflicting duplicate item');
      duplicateItems++;
      continue;
    }
    seen.set(item.stream_item_id, item.encoded_item);
    const frames = parseSseChunks([new TextEncoder().encode(item.encoded_item)]);
    for (const frame of frames) {
      if (frame.event !== 'delta') continue;
      const delta = frame.value;
      path = delta.p ?? path;
      operation = delta.o ?? operation;
      if (path === null || operation === null) throw new Error('Missing delta inheritance');
      if (operation === 'patch') {
        if (path !== '' || !Array.isArray(delta.v)) throw new Error('Unsupported patch envelope');
        for (const patch of delta.v) root = patchAt(root, patch.p, patch.o, patch.v);
      } else root = patchAt(root, path, operation, delta.v);
      if (typeof root?.message?.id !== 'string') throw new Error('Missing message identity');
      messages.set(root.message.id, structuredClone(root.message));
    }
  }
  const answers = [...messages.values()].filter(m => m.author?.role === 'assistant' && m.channel === 'final' && m.content?.content_type === 'text');
  const interrupted = answers.some(m => m.metadata?.finish_details?.type === 'interrupted');
  return {
    text: answers.flatMap(m => m.content.parts).join(''), duplicateItems,
    state: interrupted ? 'cancelled' : transportDone && answers.length > 0 && answers.every(m => m.end_turn === true) ? 'completed' : 'interrupted_unconfirmed',
    providerUsage: null,
  };
}

export function replayPerplexity(frames) {
  let workflow = null, final = false;
  for (const frame of frames) {
    for (const block of frame.blocks || []) {
      if (block.intended_usage !== 'workflow_root') continue;
      if (block.workflow_block) workflow = structuredClone(safeValue(block.workflow_block));
      if (block.diff_block) {
        if (block.diff_block.field !== 'workflow_block') throw new Error('Unknown workflow target');
        for (const patch of block.diff_block.patches) workflow = patchAt(workflow, patch.path, patch.op, patch.value);
      }
    }
    final = frame.final === true && frame.final_sse_message === true && frame.text_completed === true && frame.status === 'COMPLETED';
  }
  if (!workflow) throw new Error('Missing workflow');
  const items = new Map();
  for (const step of workflow.steps) for (const item of step.items) {
    if (item.type !== 'WORKFLOW_ITEM_TEXT') continue;
    if (item.variant !== 'answer') throw new Error('Unverified text-item variant');
    if (typeof item.id !== 'string' || items.has(item.id)) throw new Error('Ambiguous workflow item');
    const payload = item.payload?.text_payload;
    if (!payload || typeof payload.text !== 'string' || !Array.isArray(payload.chunks) || !payload.chunks.every(c => typeof c === 'string')) throw new Error('Invalid text payload');
    items.set(item.id, payload.is_streaming ? payload.chunks.join('') : payload.text);
  }
  if (items.size !== 1) throw new Error('Multiple or missing answer items are not validated');
  return { text: [...items.values()].join(''), state: final ? 'completed' : 'interrupted_unconfirmed', providerUsage: null };
}

export function geminiCandidateText(frames, candidate = 'synthetic-candidate') {
  let text = null;
  for (const outer of frames) for (const row of outer) {
    if (row[0] !== 'wrb.fr' || typeof row[2] !== 'string') continue;
    const inner = safeValue(JSON.parse(row[2]));
    for (const entry of inner[4] || []) {
      if (entry[0] !== candidate) continue;
      if (typeof entry?.[1]?.[0] !== 'string') throw new Error('Unknown candidate shape');
      text = entry[1][0];
    }
  }
  if (text === null) throw new Error('No selected candidate observed');
  return text;
}
