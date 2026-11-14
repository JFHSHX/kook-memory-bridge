import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply, __internals } from '../lib/index.js';
import { parseMemoryMessage, encryptBody } from '../lib/core.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kook-plugin-test-'));
const key = '11'.repeat(32);
const keyBuf = Buffer.from(key, 'hex');
const messages = new Map();
const pins = new Set();
const calls = [];
const deleteFailures = new Set();
let seq = 0;

const reply = (data, code = 0, message = '操作成功') => ({
  ok: true, status: 200,
  json: async () => ({ code, message, data }),
});

globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  const endpoint = url.pathname.replace('/api/v3', '');
  const body = options.body ? JSON.parse(options.body) : {};
  calls.push({ endpoint, body });
  if (endpoint === '/user/me') return reply({ username: 'mock-bot' });
  if (endpoint === '/message/create') {
    const msgId = `mock-${++seq}`;
    messages.set(msgId, { id: msgId, content: body.content, create_at: Date.now() });
    return reply({ msg_id: msgId, msg_timestamp: Date.now() });
  }
  if (endpoint === '/message/update') {
    if (!messages.has(body.msg_id)) return reply(null, 40000, '消息不存在');
    messages.get(body.msg_id).content = body.content;
    return reply([]);
  }
  if (endpoint === '/message/delete') {
    if (deleteFailures.has(body.msg_id)) return reply(null, 50000, '模拟删除失败');
    if (!messages.has(body.msg_id)) return reply(null, 40000, '消息不存在');
    messages.delete(body.msg_id);
    return reply([]);
  }
  if (endpoint === '/message/pin' || endpoint === '/message/unpin') {
    if (endpoint === '/message/pin') pins.add(body.msg_id); else pins.delete(body.msg_id);
    return reply([]);
  }
  if (endpoint === '/message/view') return reply(messages.get(url.searchParams.get('msg_id')));
  throw new Error(`未 mock 的端点: ${endpoint}`);
};

function makeCtx(capture) {
  const handlers = {};
  return {
    handlers,
    inject: (names, cb) => {
      if (names.join() === 'tools') cb({ tools: { register: capture } });
      else if (names.join() === 'systemPrompt') cb({ systemPrompt: { section: () => () => {} } });
      else throw new Error(`未知服务 ${names}`);
    },
    on: (event, handler) => { handlers[event] = handler; },
    logger: { info() {}, warn() {} },
  };
}

const defs = {};
const ctx = makeCtx(def => { defs[def.name] = def; });
apply(ctx, { dataDir, botToken: 'mock-token', channelId: 'channel-1', key });
assert.deepEqual(Object.keys(defs), [
  'kook_status', 'kook_retain', 'kook_recall', 'kook_forget', 'kook_edit', 'kook_pin',
]);
console.log('✓ 6 个工具注册');

const status = await defs.kook_status.execute({});
assert.equal(status.ok, true);
assert.equal(status.channelId, 'channel-1');
console.log('✓ status');

const r1 = await defs.kook_retain.execute({
  text: '用户偏好中文，KOOK 记忆正文需要加密', tags: ['fact', '#kook'],
});
const originalWire = messages.get(r1.msgId).content;
const [header, cipher] = originalWire.split('\n');
assert.match(header, /^\[\d{4}-\d{2}-\d{2}\] #fact #kook$/);
assert.ok(cipher.startsWith('kmb1:'));
assert.ok(!originalWire.includes('用户偏好'));
assert.equal(parseMemoryMessage(originalWire, keyBuf).text, '用户偏好中文，KOOK 记忆正文需要加密');
console.log('✓ retain：日期/标签明文，正文密文');

const recalled = await defs.kook_recall.execute({ query: '中文' });
assert.equal(recalled.count, 1);
assert.equal(recalled.hits[0].id, r1.id);
console.log('✓ recall 返回可编辑 id');

const edited = await defs.kook_edit.execute({ id: r1.id, text: '用户偏好简体中文，正文已改' });
assert.equal(edited.msgId, r1.msgId);
assert.equal(edited.date, r1.date);
const editedWire = messages.get(r1.msgId).content;
assert.notEqual(editedWire, originalWire);
assert.ok(editedWire.startsWith(`[${r1.date}] #fact #kook\n`));
assert.equal(parseMemoryMessage(editedWire, keyBuf).text, '用户偏好简体中文，正文已改');
assert.equal((await defs.kook_recall.execute({ query: '正文已改' })).hits[0].id, r1.id);
console.log('✓ edit by id：原消息原位更新，日期/标签保留');

const r2 = await defs.kook_retain.execute({ text: '旧项目决定使用 Vue', tags: ['#fact'] });
const edited2 = await defs.kook_edit.execute({ query: 'Vue', text: '旧项目决定使用 React', tags: ['#exp'] });
assert.equal(edited2.id, r2.id);
assert.equal(parseMemoryMessage(messages.get(r2.msgId).content, keyBuf).text, '旧项目决定使用 React');
assert.ok(messages.get(r2.msgId).content.startsWith(`[${r2.date}] #exp\n`));
console.log('✓ edit by query：正文与标签均可修改');

await defs.kook_pin.execute({ id: r1.id });
assert.ok(pins.has(r1.msgId));
await defs.kook_pin.execute({ id: r1.id, unpin: true });
assert.ok(!pins.has(r1.msgId));
const card = await defs.kook_pin.execute({ text: '👤 测试画像卡：偏好中文' });
assert.equal(card.mode, 'card');
assert.equal(messages.get(card.msgId).content, '👤 测试画像卡：偏好中文');
assert.ok(pins.has(card.msgId));
console.log('✓ 记忆 pin/unpin + 明文画像卡');

const injection = __internals.buildInjection(dataDir, '简体中文');
assert.ok(injection.includes('测试画像卡'));
assert.ok(injection.includes('正文已改'));
ctx.handlers['agent/session-start']({ agent: { session: { header: { id: 's1' } } } });
const decision = { kind: 'enter', messages: [{ role: 'user', content: [{ type: 'text', text: '简体中文' }] }] };
const pre1 = await ctx.handlers['agent/pre-step']({ agent: { session: { header: { id: 's1' } } } }, async () => decision);
assert.equal(pre1.messages.length, 2);
const pre2 = await ctx.handlers['agent/pre-step']({ agent: { session: { header: { id: 's1' } } } }, async () => decision);
assert.equal(pre2.messages.length, 1);
console.log('✓ 生命周期注入与去重');

const forgotten2 = await defs.kook_forget.execute({ query: 'React' });
assert.equal(forgotten2.id, r2.id);
assert.equal(forgotten2.deleted_in_kook, true);
assert.equal(forgotten2.removed_from_index, 1);
assert.equal(messages.has(r2.msgId), false);
console.log('✓ forget by query：频道与索引双侧删除');

deleteFailures.add(r1.msgId);
const forgotten1 = await defs.kook_forget.execute({ id: r1.id });
assert.equal(forgotten1.deleted_in_kook, false);
assert.equal(forgotten1.removed_from_index, 1);
assert.ok(forgotten1.note.includes('模拟删除失败'));
console.log('✓ 频道删除失败不伪报成功，结果带原因');

const legacyCipher = encryptBody('旧格式正文', keyBuf);
assert.equal(parseMemoryMessage(legacyCipher, keyBuf).text, '旧格式正文');
assert.equal(parseMemoryMessage(legacyCipher, keyBuf).legacy, true);
console.log('✓ 旧全密文格式兼容');

await assert.rejects(() => defs.kook_edit.execute({ text: '无定位' }), /需要 id、msgId 或 query/);
await assert.rejects(() => defs.kook_forget.execute({}), /需要 id、msgId 或 query/);
await assert.rejects(() => defs.kook_retain.execute({ text: ' ' }), /不能为空/);
console.log('✓ 参数错误可行动');

console.log(`\n全部离线测试通过；临时目录 ${dataDir}`);
