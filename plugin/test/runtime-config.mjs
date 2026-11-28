import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply } from '../lib/index.js';
import { getKookRuntimeStatus, stopKookRuntime } from '../lib/runtime.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kook-runtime-config-'));
const stateFile = path.join(dir, 'scheduler-state.json');
const key = '33'.repeat(32);
process.env.TEST_KEY = 'test-only';
const realFetch = globalThis.fetch;
globalThis.fetch = async input => {
  const url = new URL(String(input));
  if (url.pathname.endsWith('/message/list')) return { ok: true, json: async () => ({ code: 0, data: { items: [] } }) };
  throw new Error('unexpected ' + url.href);
};
const registered = [];
const registeredDefs = [];
const handlers = new Map();
const ctx = {
  inject: (names, cb) => {
    if (names.join() === 'tools') cb({ tools: { register: def => { registered.push(def.name); registeredDefs.push(def); } } });
    else if (names.join() === 'systemPrompt') cb({ systemPrompt: { section: () => () => {} } });
  },
  on: (name, fn) => handlers.set(name, fn),
  logger: { info() {}, warn(message) { throw new Error(String(message)); } },
};
try {
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ autoStartRuntime: true, botToken: 'mock', channelId: 'channel-1', key, llmBaseURL: 'https://mock.llm/v1', llmModel: 'mock', llmApiKeyEnv: 'TEST_KEY' }));
  apply(ctx, { dataDir: dir });
  for (let i = 0; i < 100 && !getKookRuntimeStatus({ stateFile }).ready; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(getKookRuntimeStatus({ stateFile }).ready, true);
  assert.ok(registered.includes('kook_pages'));
  const pagesTool = registeredDefs.find(def => def.name === 'kook_pages');
  assert.equal((await pagesTool.execute({ action: 'status' })).running, true);
  await handlers.get('agent/disposed')({ agent: { session: { header: { id: 's1' } } } });
  assert.equal(getKookRuntimeStatus({ stateFile }).running, true);
  await handlers.get('dispose')();
  assert.equal(getKookRuntimeStatus({ stateFile }).running, false);
  console.log('✓ apply 从本地配置读取 autoStartRuntime 并自动启动运行时');
} finally {
  await stopKookRuntime({ stateFile });
  globalThis.fetch = realFetch;
  fs.rmSync(dir, { recursive: true, force: true });
}
