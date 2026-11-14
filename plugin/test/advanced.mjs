import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply } from '../lib/index.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kook-advanced-test-'));
const key = '33'.repeat(32);
const messages = new Map();
let seq = 0;
let llmMode = 'none';
let latestFactId = '';
let observationId = '';

globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  if (url.href === 'https://mock.advanced/v1/chat/completions') {
    const body = JSON.parse(options.body);
    const system = body.messages[0].content;
    let content;
    if (system.includes('长期记忆抽取器')) {
      content = JSON.stringify({ facts: [{ text: '用户现在偏好 Vue', factType: 'world', occurredStart: '2026-11-15', entities: [{ name: 'Vue', type: 'PRODUCT' }], links: [] }] });
    } else if (system.includes('你在整合长期观察')) {
      content = JSON.stringify({ decisions: [{ action: 'update', effect: 'changes', observationId, text: '用户此前偏好 React，现在偏好 Vue', sourceMemoryIds: [latestFactId], scope: ['#pref'] }] });
    } else if (body.messages[1].content.includes('search_mental_models')) {
      content = `你当前偏好 Vue [${observationId}]`;
    } else {
      content = '<!-- mm:summary -->用户当前偏好 Vue\n<!-- mm:history -->此前偏好 React\n';
    }
    return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
  }
  const endpoint = url.pathname.replace('/api/v3', '');
  const body = options.body ? JSON.parse(options.body) : {};
  const reply = (data, code = 0, message = 'ok') => ({ ok: true, json: async () => ({ code, message, data }) });
  if (endpoint === '/user/me') return reply({ username: 'mock' });
  if (endpoint === '/message/create') {
    const id = `advanced-${++seq}`;
    messages.set(id, { id, content: body.content, create_at: Date.now() + seq });
    return reply({ msg_id: id, msg_timestamp: Date.now() + seq });
  }
  if (endpoint === '/message/update') {
    if (!messages.has(body.msg_id)) return reply(null, 40000, '不存在');
    messages.get(body.msg_id).content = body.content;
    return reply([]);
  }
  if (endpoint === '/message/delete') { messages.delete(body.msg_id); return reply([]); }
  if (endpoint === '/message/view') return reply(messages.get(url.searchParams.get('msg_id')));
  if (endpoint === '/message/list') {
    const size = Number(url.searchParams.get('page_size') || 50);
    const cursor = url.searchParams.get('msg_id');
    const all = [...messages.values()].sort((a, b) => b.create_at - a.create_at || a.id.localeCompare(b.id));
    const start = cursor ? all.findIndex(m => m.id === cursor) + 1 : 0;
    return reply({ items: all.slice(start, start + size) });
  }
  if (endpoint === '/message/pin' || endpoint === '/message/unpin') return reply([]);
  throw new Error(`未 mock: ${endpoint}`);
};

function makeDefs(withLLM = false) {
  const defs = {};
  apply({
    inject(names, cb) {
      if (names.join() === 'tools') cb({ tools: { register: d => { defs[d.name] = d; } } });
      else cb({ systemPrompt: { section: () => () => {} } });
    }, on() {}, logger: { info() {}, warn() {} },
  }, {
    dataDir, botToken: 'mock', channelId: 'ch', key,
    ...(withLLM ? { llmBaseURL: 'https://mock.advanced/v1', llmModel: 'mock', llmApiKey: 'test' } : {}),
  });
  return defs;
}

const defs = makeDefs();
const f1 = await defs.kook_retain.execute({ text: '用户偏好 React', tags: ['#pref'] });
const evidence = await defs.kook_reflect.execute({ question: '用户偏好是什么' });
assert.equal(evidence.mode, 'evidence-only');
assert.equal(evidence.answer, null);
assert.ok(evidence.evidence.memories.length > 0);
console.log('✓ 无 LLM reflect 返回分层证据，不伪造答案');

const first = await defs.kook_consolidate.execute({});
assert.equal(first.mode, 'append-only');
assert.equal(first.created, 1);
const obsSearch = await defs.kook_recall.execute({ query: 'React', factTypes: ['observation'] });
observationId = obsSearch.hits[0].msgId;
assert.equal(obsSearch.hits[0].proofCount, 1);
console.log('✓ append-only 创建 observation，proof=1');

await defs.kook_retain.execute({ text: '用户偏好 React', tags: ['#pref'] });
const repeated = await defs.kook_consolidate.execute({});
assert.equal(repeated.updated, 1);
const reinforced = await defs.kook_recall.execute({ query: 'React', factTypes: ['observation'], refresh: true });
assert.equal(reinforced.hits[0].proofCount, 2);
console.log('✓ 精确重复只强化证据，proof=2');

const directive = await defs.kook_directive.execute({ action: 'create', text: '始终用中文', priority: 10 });
const model = await defs.kook_mental_model.execute({ action: 'create', modelId: 'prefs', sourceQuery: '用户偏好是什么', scope: [] });
assert.ok(model.msgId);
fs.rmSync(path.join(dataDir, 'index.jsonl'));
await defs.kook_rebuild.execute({});
assert.equal((await defs.kook_recall.execute({ query: 'React', factTypes: ['observation'] })).hits[0].proofCount, 2);
assert.equal((await defs.kook_mental_model.execute({ action: 'list' })).models[0].stale, true);
console.log('✓ observation/模型/directive 随 KOOK 重建');

const llm = makeDefs(true);
const f3 = await llm.kook_retain.execute({ text: '用户现在偏好 Vue', tags: ['#pref'] });
latestFactId = f3.msgId;
const reconciled = await llm.kook_consolidate.execute({});
assert.equal(reconciled.mode, 'llm-reconcile');
assert.equal(reconciled.updated, 1);
const changed = await llm.kook_recall.execute({ query: '现在偏好 Vue', factTypes: ['observation'], refresh: true });
assert.equal(changed.hits[0].proofCount, 3);
assert.ok(changed.hits[0].text.includes('此前偏好 React'));
assert.ok(changed.hits[0].text.includes('现在偏好 Vue'));
console.log('✓ LLM 纠正保留历史，proof=3，raw facts 不改');

const reflected = await llm.kook_reflect.execute({ question: '用户偏好是什么' });
assert.equal(reflected.mode, 'reflect');
assert.ok(reflected.answer.includes(observationId));
assert.deepEqual(reflected.basedOn, [observationId]);
assert.ok(reflected.directivesApplied.includes(directive.msgId));
console.log('✓ reflect 引用实际 observation 且 directives 生效');

const refreshed = await llm.kook_mental_model.execute({ action: 'refresh', modelId: 'prefs', full: true });
assert.equal(refreshed.refreshed, true);
assert.ok(refreshed.content.includes('当前偏好 Vue'));
assert.ok(refreshed.basedOn.includes(f3.msgId));
const read = await defs.kook_mental_model.execute({ action: 'get', modelId: 'prefs' });
assert.equal(read.stale, false);
assert.ok(read.content.includes('此前偏好 React'));
console.log('✓ mental model full 刷新/watermark/basedOn，读取零 LLM');
