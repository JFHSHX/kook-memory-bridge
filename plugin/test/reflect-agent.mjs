import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runReflectAgent } from '../lib/reflect-agent.js';
import { normalizeUnit } from '../lib/units.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kook-reflect-agent-'));
const memory = { ...normalizeUnit({ kind: 'memory', factType: 'world', text: '用户喜欢 Vue', tags: ['#fact'] }), id: 'm1', msgId: 'm1' };
fs.writeFileSync(path.join(dir, 'index.jsonl'), JSON.stringify(memory) + '\n');

const makeClient = (answers = []) => ({
  enabled: true,
  calls: 0,
  async completeJson() { this.calls++; return answers.shift() || { answer_found: true, done: true, reason: 'ok', next_query: '', include_ids: [] }; },
  async complete() { return '依据 [m1]'; },
});
const base = { question: 'Vue', bank: 'default', maxIterations: 3, decisionModel: true };
const client = makeClient();
const result = await runReflectAgent({ ...base, cfg: {}, dir, client });
assert.equal(result.iterations, 1);
assert.equal(result.decisionModel.enabled, true);
assert.deepEqual(result.basedOn, ['m1']);
assert.ok(result.toolTrace.some(item => item.tool === 'recall'));
console.log('✓ reflect agent 强制 raw recall、真实引用和 decision model');

const badClient = makeClient([{ answer_found: false, done: false, reason: '缺证据', next_query: '', include_ids: ['fake'] }]);
await assert.rejects(() => runReflectAgent({ ...base, cfg: {}, dir, client: badClient }), /未检索 id/);
console.log('✓ decision model 非法 ID 被拒绝');

const noDecision = await runReflectAgent({ ...base, cfg: {}, dir, client: makeClient(), decisionModel: false });
fs.rmSync(dir, { recursive: true, force: true });
assert.equal(noDecision.decisionModel.enabled, false);
console.log('✓ 可关闭 decision model 且保持 agent loop');