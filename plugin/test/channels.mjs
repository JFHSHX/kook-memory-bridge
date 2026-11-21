import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply } from '../lib/index.js';
import { channelKindFor, channelFor, channelList, parseMemoryMessage } from '../lib/core.js';

const cfgMulti = { channelId: 'ch-main', channels: { mental: 'ch-mental', exp: 'ch-exp' } };
assert.equal(channelKindFor({ kind: 'mental_model' }), 'mental');
assert.equal(channelKindFor({ kind: 'document', modelId: 'm1', documentId: 'mental-model:m1' }), 'mental');
assert.equal(channelKindFor({ kind: 'document', documentId: 'doc-other' }), 'memory');
assert.equal(channelKindFor({ kind: 'memory', factType: 'experience' }), 'exp');
assert.equal(channelKindFor({ kind: 'memory', factType: 'world' }), 'memory');
assert.equal(channelKindFor({ kind: 'observation' }), 'memory');
assert.equal(channelFor(cfgMulti, { kind: 'mental_model' }), 'ch-mental');
assert.equal(channelFor(cfgMulti, { kind: 'memory', factType: 'experience' }), 'ch-exp');
assert.equal(channelFor(cfgMulti, { kind: 'memory', factType: 'world' }), 'ch-main');
assert.equal(channelFor({ channelId: 'ch-only' }, { kind: 'mental_model' }), 'ch-only');
assert.deepEqual(channelList(cfgMulti), ['ch-main', 'ch-mental', 'ch-exp']);
assert.deepEqual(channelList({ channelId: 'ch-only' }), ['ch-only']);
console.log('✓ 频道路由纯函数：mental/exp/主频道与未配置回落');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kook-channels-'));
const key = '33'.repeat(32);
const messages = new Map();
const creates = [];
let seq = 0;
const reply = data => ({ ok: true, status: 200, json: async () => ({ code: 0, message: '操作成功', data }) });
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  const endpoint = url.pathname.replace('/api/v3', '');
  const body = options.body ? JSON.parse(options.body) : {};
  if (endpoint === '/user/me') return reply({ username: 'mock-bot' });
  if (endpoint === '/message/create') {
    const msgId = `multi-${++seq}`;
    creates.push({ msgId, target_id: body.target_id, content: body.content });
    messages.set(msgId, { id: msgId, content: body.content, target_id: body.target_id, create_at: Date.now() });
    return reply({ msg_id: msgId, msg_timestamp: Date.now() });
  }
  if (endpoint === '/message/list') {
    const target = url.searchParams.get('target_id');
    const size = Number(url.searchParams.get('page_size') || 50);
    const cursor = url.searchParams.get('msg_id');
    const all = [...messages.values()].filter(m => !target || m.target_id === target)
      .sort((a, b) => b.create_at - a.create_at || a.id.localeCompare(b.id));
    const start = cursor ? all.findIndex(m => m.id === cursor) + 1 : 0;
    return reply({ items: all.slice(start, start + size).map(m => ({ id: m.id, content: m.content, create_at: m.create_at })) });
  }
  throw new Error(`未 mock 的端点: ${endpoint}`);
};

try {
  const defs = {};
  const ctx = {
    inject: (names, cb) => {
      if (names.join() === 'tools') cb({ tools: { register: def => { defs[def.name] = def; } } });
      else if (names.join() === 'systemPrompt') cb({ systemPrompt: { section: () => () => {} } });
      else throw new Error(`未知服务 ${names}`);
    },
    on: () => {},
    logger: { info() {}, warn() {} },
  };
  apply(ctx, { dataDir, botToken: 'mock-token', channelId: 'ch-main', channels: { mental: 'ch-mental', exp: 'ch-exp' }, key });

  await defs.kook_retain.execute({ text: '用户偏好中文交流', tags: ['#fact'] });
  await defs.kook_retain.execute({ text: 'agent 完成了一次频道验证', factType: 'experience' });
  await defs.kook_mental_model.execute({ action: 'create', bank: 'default', modelId: 'profile', name: '画像', sourceQuery: '总结偏好' });

  const keyBuf = Buffer.from(key, 'hex');
  const sent = creates.map(create => ({ target_id: create.target_id, ...parseMemoryMessage(create.content, keyBuf) }));
  assert.equal(sent.find(item => item.text.includes('用户偏好中文交流')).target_id, 'ch-main');
  assert.equal(sent.find(item => item.text.includes('完成了一次频道验证')).target_id, 'ch-exp');
  assert.equal(sent.find(item => item.unit?.kind === 'mental_model').target_id, 'ch-mental');
  console.log('✓ 三类写入按配置路由到对应频道');

  const rebuilt = await defs.kook_rebuild.execute({});
  assert.equal(rebuilt.channels.length, 3);
  assert.equal(rebuilt.scanned, 3);
  assert.equal(rebuilt.imported, 3);
  assert.equal(rebuilt.failed, 0);
  assert.equal((await defs.kook_recall.execute({ query: '完成了一次频道验证' })).hits[0].factType, 'experience');
  assert.equal((await defs.kook_recall.execute({ query: '用户偏好中文交流' })).hits[0].id, creates[0].msgId);
  console.log('✓ 重建遍历三频道合并，无重复且召回正常');
} finally {
  globalThis.fetch = realFetch;
  fs.rmSync(dataDir, { recursive: true, force: true });
}
console.log('多频道测试通过');
