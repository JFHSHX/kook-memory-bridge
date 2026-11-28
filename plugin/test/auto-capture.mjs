import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply } from '../lib/index.js';
import { readMemory } from '../lib/core.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kook-auto-capture-'));
const key = '33'.repeat(32);
process.env.TEST_KEY = 'test-only';
const created = [];
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ autoCapture: true, autoCaptureFactType: 'experience', channels: { exp: 'exp-channel' }, botToken: 'mock', channelId: 'channel-1', key, llmBaseURL: 'https://mock.llm/v1', llmModel: 'mock', llmApiKeyEnv: 'TEST_KEY' }));
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  if (url.pathname.endsWith('/message/list')) return { ok: true, json: async () => ({ code: 0, data: { items: [] } }) };
  if (url.pathname.endsWith('/message/create')) {
    const body = JSON.parse(options.body);
    created.push(body);
    return { ok: true, json: async () => ({ code: 0, data: { msg_id: 'capture-1', msg_timestamp: Date.now() } }) };
  }
  if (url.href === 'https://mock.llm/v1/chat/completions') return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ facts: [{ text: '用户喜欢 Vue', factType: 'world' }] }) } }] }) };
  throw new Error('unexpected ' + url.href);
};
const handlers = new Map();
const ctx = {
  inject: (names, cb) => {
    if (names.join() === 'tools') cb({ tools: { register: () => {} } });
    else if (names.join() === 'systemPrompt') cb({ systemPrompt: { section: () => () => {} } });
  },
  on: (name, fn) => handlers.set(name, fn),
  logger: { info() {}, warn() {} },
};
try {
  apply(ctx, { dataDir: dir });
  const agent = { session: { header: { id: 's1' }, snapshotEvents: () => [{ role: 'user', content: '用户喜欢 Vue' }] } };
  await handlers.get('agent/session-start')({ agent });
  await handlers.get('agent/turn-stopping')({ agent });
  const rows = readMemory(dir);
  assert.ok(rows.some(row => row.tags.includes('#auto-capture') && row.text.includes('用户喜欢 Vue')));
  assert.equal(created.length, 1);
  assert.equal(created[0].target_id, 'exp-channel');
  await handlers.get('turn/end')({ sessionId: 's1' });
  assert.equal(created.length, 1);
  await handlers.get('agent/pre-step')({ agent }, async () => ({ kind: 'enter', messages: [{ role: 'user', content: '用户偏好 TypeScript' }] }));
  await handlers.get('turn/end')({ sessionId: 's1' });
  assert.equal(created.length, 2);
  console.log('✓ autoCapture 在 turn-stopping 自动抽取并写入记忆');
} finally {
  globalThis.fetch = realFetch;
  fs.rmSync(dir, { recursive: true, force: true });
}
