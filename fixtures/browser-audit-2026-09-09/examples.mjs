export const expectedText = 'Grüner Fußabdruck 🌿 | café | 你好 | é';

export function sse(event, data) {
  return 'event: ' + event + '\ndata: ' + (typeof data === 'string' ? data : JSON.stringify(data)) + '\n\n';
}

export const claudeRequest = {
  prompt: 'Reply with exactly: TOKEN TEST OK',
  model: 'claude-fable-5-1',
  tools: [{ name: 'synthetic_tool', description: 'Not automatically model input' }],
  attachments: [], files: [],
};

export const claudeRetry = {
  prompt: '', parent_message_uuid: 'synthetic-human',
  turn_message_uuids: { assistant: 'synthetic-retry-answer' },
  completion_request_id: 'synthetic-retry-request',
};

export const claudeFrames = [
  ['message_start', { type: 'message_start', message: { id: 'synthetic-answer', role: 'assistant', stop_reason: null } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', summaries: [] } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }],
  ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: expectedText.slice(0, 5) } }],
  ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: expectedText.slice(5) } }],
  ['content_block_stop', { type: 'content_block_stop', index: 1 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' } }],
  ['message_limit', { type: 'message_limit', message_limit: { windows: { '5h': { utilization: 25 } } } }],
  ['message_stop', { type: 'message_stop' }],
];

function socketItem(id, event, data) {
  return { type: 'message', topic_id: 'synthetic-topic', payload: {
    type: 'conversation-turn-stream', payload: {
      type: 'stream-item', stream_item_id: id, encoded_item: sse(event, data),
    },
  } };
}

const gptRoot = socketItem('synthetic-item-1', 'delta', {
  p: '', o: 'add', c: 0,
  v: { message: { id: 'synthetic-answer', author: { role: 'assistant' }, channel: 'final',
    content: { content_type: 'text', parts: [''] }, status: 'in_progress', end_turn: false, metadata: {} } },
});
const gptAppend = socketItem('synthetic-item-2', 'delta', { p: '/message/content/parts/0', o: 'append', v: 'TOKEN ' });
const gptInherited = socketItem('synthetic-item-3', 'delta', { v: 'TEST OK' });
const gptFinish = socketItem('synthetic-item-4', 'delta', { p: '', o: 'patch', v: [
  { p: '/message/status', o: 'replace', v: 'finished_successfully' },
  { p: '/message/end_turn', o: 'replace', v: true },
  { p: '/message/metadata', o: 'append', v: { finish_details: { type: 'stop', stop_tokens: [200002] } } },
] });

export const gptHandoff = sse('delta_encoding', '"v1"') +
  sse('stream_handoff', { type: 'stream_handoff', options: [{ type: 'subscribe_ws_topic', topic_id: 'synthetic-topic' }] }) +
  sse('message', '[DONE]');

export const gptSocket = [
  { type: 'reply', reply: { type: 'subscribe', topic_id: 'synthetic-topic', catchups: [gptRoot, gptAppend] } },
  structuredClone(gptAppend), gptInherited, gptFinish,
  socketItem('synthetic-item-5', 'message', { type: 'message_stream_complete' }),
  { type: 'message', topic_id: 'synthetic-topic', payload: { type: 'conversation-turn-stream', payload: { type: 'done' } } },
];

const workflow = { steps: [{ id: 'synthetic-step', status: 'WORKFLOW_RUNNING', items: [{
  id: 'synthetic-text-item', type: 'WORKFLOW_ITEM_TEXT', variant: 'answer', display_mode: 'WORKFLOW_ITEM_ALWAYS_EXPAND',
  payload: { text_payload: { text: '', chunks: ['TOKEN '], is_streaming: true } },
}] }] };
const finalWorkflow = structuredClone(workflow);
finalWorkflow.steps[0].status = 'WORKFLOW_COMPLETED';
finalWorkflow.steps[0].items[0].payload.text_payload = { text: 'TOKEN TEST OK', chunks: ['TOKEN ', 'TEST OK'], is_streaming: false };

export const perplexityFrames = [
  { blocks: [{ intended_usage: 'workflow_root', diff_block: { field: 'workflow_block', patches: [{ op: 'replace', path: '', value: workflow }] } }] },
  { blocks: [{ intended_usage: 'workflow_root', diff_block: { field: 'workflow_block', patches: [
    { op: 'add', path: '/steps/0/items/0/payload/text_payload/chunks/1', value: 'TEST OK' },
  ] } }] },
  { status: 'COMPLETED', final: true, final_sse_message: true, text_completed: true,
    telemetry_data: { has_first_token: true, has_first_output_token: true },
    structured_answer_block_usages: ['workflow_root'],
    blocks: [{ intended_usage: 'workflow_root', workflow_block: finalWorkflow },
      { intended_usage: 'sources_answer_mode', sources_mode_block: { result_count: 10 } }],
  },
];

export function geminiInner(text, candidate = 'synthetic-candidate') {
  const inner = Array(60).fill(null);
  inner[1] = ['synthetic-conversation', 'synthetic-response'];
  inner[4] = [[candidate, [text]]];
  inner[26] = [[[[null, [null, null, text]]]]];
  return inner;
}

export function geminiWire(texts) {
  return ")]}'\n\n" + texts.map(text => {
    const payload = '\n' + JSON.stringify([['wrb.fr', null, JSON.stringify(geminiInner(text))]]) + '\n';
    return String(payload.length) + payload;
  }).join('');
}
