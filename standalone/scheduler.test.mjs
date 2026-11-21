import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MentalModelScheduler, nextDeltaAt, nextFullAt, sanitizeError, PLACEHOLDER } from './scheduler-core.mjs';

assert.equal(nextDeltaAt(new Date('2026-11-15T16:59:00Z')).toISOString(), '2026-11-15T17:00:00.000Z');
assert.equal(nextFullAt(new Date('2026-11-15T02:00:00Z')).toISOString(), '2026-11-15T03:30:00.000Z');
assert.equal(nextFullAt(new Date('2026-11-15T04:00:00Z')).toISOString(), '2026-11-22T03:30:00.000Z');
assert.equal(nextFullAt(new Date('2026-11-16T00:00:00Z')).toISOString(), '2026-11-22T03:30:00.000Z');
console.log('✓ UTC delta/full 下次运行时间');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kook-standalone-scheduler-'));
const stateFile = path.join(dir, 'state.json');
let now = Date.parse('2026-11-15T00:00:00Z');
const model = {
  modelId: 'm1', text: PLACEHOLDER, stale: true,
  payload: { trigger: 'manual', lastRefreshedAt: null, lastMemorySeenAt: 0 },
};
const calls = [];
let failures = 0;
const tools = {
  list: async () => ({ ok: true, models: [{ modelId: 'm1', stale: model.stale }] }),
  get: async () => ({ ok: true, stale: model.stale, model }),
  refresh: async (args) => {
    calls.push(args);
    if (failures > 0) { failures--; throw new Error('temporary failure'); }
    model.text = '<!-- mm:interval -->\n8 小时\n';
    model.stale = false;
    model.payload.lastRefreshedAt = new Date(now).toISOString();
    model.payload.trigger = args.full ? 'full' : 'delta';
    return { ok: true, refreshed: true };
  },
};
const makeScheduler = () => new MentalModelScheduler({ tools, stateFile, now: () => now, retryDelayMs: 0 });

const initial = await makeScheduler().run('delta');
assert.equal(initial.counts.refreshed, 1);
assert.equal(calls[0].full, true);
assert.ok(initial.results[0].mode === 'full');
console.log('✓ 首次占位模型自动 full 建基线');

const beforeQuiet = calls.length;
const quiet = await makeScheduler().run('delta');
assert.equal(quiet.counts.skipped, 1);
assert.equal(calls.length, beforeQuiet, '无变化不得调用 LLM');
console.log('✓ 非 stale 跳过且零 LLM 调用');

now += 3600000;
model.stale = true;
const delta = await makeScheduler().run('delta');
assert.equal(delta.results[0].mode, 'delta');
assert.equal(calls.at(-1).full, false);
console.log('✓ 有基线且 stale 时执行 delta');

now += 3600000;
const full = await makeScheduler().run('full');
assert.equal(full.results[0].mode, 'full');
const fullAgain = await makeScheduler().run('full');
assert.equal(fullAgain.results[0].reason, 'no-delta-since-full');
console.log('✓ full 仅在 lastFull 后发生过 delta 时执行');

failures = 2;
now += 1000;
model.stale = true;
const retried = await makeScheduler().run('delta');
assert.equal(retried.results[0].attempts, 3);
assert.equal(retried.counts.failed, 0);
console.log('✓ 前两次失败后第三次成功，不进入暂停');

failures = 8;
now += 1000;
model.stale = true;
const failed = await makeScheduler().run('delta');
assert.equal(failed.counts.failed, 1);
const pausedState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
assert.ok(pausedState.paused.m1.pausedAt);
const callsBeforePause = calls.length;
const paused = await makeScheduler().run('delta');
assert.equal(paused.results[0].status, 'paused');
assert.equal(calls.length, callsBeforePause, '暂停后不得继续消耗 LLM');
console.log('✓ 三次失败暂停并持久化，后续调度跳过');

failures = 0;
model.payload.lastRefreshedAt = new Date(now + 60000).toISOString();
model.stale = true;
const resumed = await makeScheduler().run('delta');
assert.equal(resumed.counts.refreshed, 1);
assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).paused.m1, undefined);
console.log('✓ 检测外部手动刷新成功后自动恢复');

model.text = PLACEHOLDER;
const noBaseline = await makeScheduler().run('full');
assert.equal(noBaseline.results[0].reason, 'no-baseline');
assert.ok(!sanitizeError(new Error('Bearer abc nvapi-secret')).includes('abc'));
assert.ok(!sanitizeError(new Error('Bearer abc nvapi-secret')).includes('nvapi-secret'));
console.log('✓ full 无基线跳过、错误信息脱敏、状态文件可重建读取');

fs.rmSync(dir, { recursive: true, force: true });
console.log('全部独立调度测试通过');
