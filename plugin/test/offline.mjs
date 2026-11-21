import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply, __internals } from '../lib/index.js';
import { parseMemoryMessage, encryptBody, formatMemoryMessage } from '../lib/core.js';

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
  if (url.href === 'https://mock.llm/v1/chat/completions') {
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ facts: [
        { text: '用户上周完成 Vue 迁移', factType: 'world', occurredStart: '2026-11-01', occurredEnd: '2026-11-08', entities: [{ name: 'Vue', type: 'PRODUCT' }], links: [] },
        { text: 'Agent 验证了 concise 抽取', factType: 'experience', occurredStart: '2026-11-15', entities: [], links: [] },
      ] }) } }] }),
    };
  }
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
  if (endpoint === '/message/view') {
    const value = messages.get(url.searchParams.get('msg_id'));
    return value ? reply(value) : reply(null, 40000, '消息不存在');
  }
  if (endpoint === '/message/list') {
    const size = Number(url.searchParams.get('page_size') || 50);
    const cursor = url.searchParams.get('msg_id');
    const all = [...messages.values()].sort((a, b) => b.create_at - a.create_at || a.id.localeCompare(b.id));
    const start = cursor ? all.findIndex(m => m.id === cursor) + 1 : 0;
    return reply({ items: all.slice(start, start + size) });
  }
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
  'kook_status', 'kook_retain', 'kook_recall', 'kook_rebuild', 'kook_bank', 'kook_forget', 'kook_edit', 'kook_pin',
  'kook_reflect', 'kook_consolidate', 'kook_mental_model', 'kook_directive', 'kook_pages', 'kook_http',
]);
console.log('✓ 14 个工具注册');

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
assert.ok(cipher.startsWith('kmb2:'));
assert.ok(!originalWire.includes('用户偏好'));
assert.equal(parseMemoryMessage(originalWire, keyBuf).text, '用户偏好中文，KOOK 记忆正文需要加密');
assert.equal(parseMemoryMessage(originalWire, keyBuf).unit.bank, 'default');
assert.ok(parseMemoryMessage(originalWire, keyBuf).unit.documentId);
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
assert.equal(forgotten1.ok, false);
assert.equal(forgotten1.deleted_in_kook, false);
assert.equal(forgotten1.removed_from_index, 0);
assert.ok(forgotten1.error.includes('模拟删除失败'));
assert.equal((await defs.kook_recall.execute({ query: '正文已改' })).count, 1, '主库删除失败时缓存必须保留');
console.log('✓ 频道删除失败：不伪报成功且缓存保留');

// bank 配置与严格隔离：配置本身也随 KOOK 重建
const configured = await defs.kook_bank.execute({ action: 'set', bank: 'project', config: { disposition: { skepticism: 5 }, retainExtractionMode: 'verbose' } });
assert.equal(configured.config.disposition.skepticism, 5);
assert.equal(configured.config.disposition.literalism, 3);
const otherBank = await defs.kook_retain.execute({ bank: 'project', text: '项目 bank 专属记忆', tags: ['#fact'] });
assert.equal((await defs.kook_recall.execute({ query: '项目 bank 专属记忆' })).count, 0);
assert.equal((await defs.kook_recall.execute({ query: '项目 bank 专属记忆', bank: 'project' })).hits[0].id, otherBank.msgId);
const bankGet = await defs.kook_bank.execute({ action: 'get', bank: 'project' });
assert.equal(bankGet.config.retainExtractionMode, 'verbose');
console.log('✓ kook_bank set/get + 严格跨 bank 召回隔离');

// 缓存可删除：召回发现无缓存时自动从 KOOK 重建，id 仍是 msgId
const r3 = await defs.kook_retain.execute({ text: '缓存重建金丝雀', tags: ['#exp'] });
fs.rmSync(path.join(dataDir, 'index.jsonl'));
const auto = await defs.kook_recall.execute({ query: '缓存重建金丝雀' });
assert.equal(auto.rebuilt, true);
assert.equal(auto.hits[0].id, r3.msgId);
assert.equal(auto.hits[0].text, '缓存重建金丝雀');
console.log('✓ 缓存删除后自动重建，id=msgId 稳定');

// 超过一页：55 条额外记忆 + 前面数据，必须翻页完整恢复
for (let i = 0; i < 55; i++) {
  const id = `bulk-${i}`;
  const ts = Date.now() - 100000 - i * 1000;
  messages.set(id, {
    id, create_at: ts,
    content: formatMemoryMessage({ ts, tags: ['#bulk'] }, `批量记忆 ${i}`, keyBuf),
  });
}
const rebuilt = await defs.kook_rebuild.execute({});
assert.ok(rebuilt.scanned >= 58);
assert.ok(rebuilt.imported >= 57);
assert.ok(rebuilt.non_memory >= 1, '明文画像卡不应进入记忆缓存');
assert.equal((await defs.kook_recall.execute({ query: '批量记忆 54' })).hits[0].id, 'bulk-54');
assert.equal((await defs.kook_bank.execute({ action: 'get', bank: 'project' })).config.disposition.skepticism, 5, 'bank config 必须随重建保留');
console.log(`✓ 全量分页重建：扫描 ${rebuilt.scanned}，导入 ${rebuilt.imported}，非记忆 ${rebuilt.non_memory}`);

// 无缓存时也能按 msgId 直接读取 KOOK 并编辑
fs.rmSync(path.join(dataDir, 'index.jsonl'));
await defs.kook_edit.execute({ msgId: r3.msgId, text: '无缓存直接编辑成功' });
assert.equal(parseMemoryMessage(messages.get(r3.msgId).content, keyBuf).text, '无缓存直接编辑成功');
console.log('✓ 无缓存时按 msgId 从主库读取并编辑');

const legacyCipher = encryptBody('旧格式正文', keyBuf);
assert.equal(parseMemoryMessage(legacyCipher, keyBuf).text, '旧格式正文');
assert.equal(parseMemoryMessage(legacyCipher, keyBuf).legacy, true);
console.log('✓ 旧全密文格式兼容');

// 长文档 chunks：一次 retain 生成多条、同 documentId、同 contentHash
const longText = Array.from({ length: 40 }, (_, i) => `第 ${i} 段包含长期项目事实与完整语义边界。`).join('\n');
const longResult = await defs.kook_retain.execute({ text: longText, mode: 'chunks', chunkSize: 200, documentId: 'long-doc' });
assert.ok(longResult.count > 3);
assert.equal(longResult.actualMode, 'chunks');
assert.ok(longResult.facts.every(f => f.documentId === 'long-doc'));
assert.equal(new Set(longResult.facts.map(f => f.contentHash)).size, 1);
console.log(`✓ chunks 长文档一次写入 ${longResult.count} 个可重建单元`);

// concise + mock LLM：真正产生两条结构化事实，不退回原文
const defsLLM = {};
apply(makeCtx(d => { defsLLM[d.name] = d; }), {
  dataDir, botToken: 'mock-token', channelId: 'channel-1', key,
  llmBaseURL: 'https://mock.llm/v1', llmModel: 'mock', llmApiKey: 'test-only',
});
const llmResult = await defsLLM.kook_retain.execute({ text: '用户上周完成 Vue 迁移，agent 今天验证。', mode: 'concise' });
assert.equal(llmResult.actualMode, 'concise');
assert.equal(llmResult.count, 2);
assert.equal(llmResult.facts[0].entities[0].canonical, 'vue');
assert.equal(llmResult.facts[1].factType, 'experience');
assert.ok(llmResult.facts[0].occurredStart);
console.log('✓ concise mock LLM 多事实/时间/实体/factType 全链路');

await assert.rejects(() => defs.kook_edit.execute({ text: '无定位' }), /需要 id、msgId 或 query/);
await assert.rejects(() => defs.kook_forget.execute({}), /需要 id、msgId 或 query/);
await assert.rejects(() => defs.kook_retain.execute({ text: ' ' }), /不能为空/);
console.log('✓ 参数错误可行动');

console.log(`\n全部离线测试通过；临时目录 ${dataDir}`);
