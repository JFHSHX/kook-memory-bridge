import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MentalModelScheduler } from './scheduler-core.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kook-scheduler-cron-'));
let now = Date.parse('2026-11-21T12:00:00Z');
let calls = 0;
const model = { modelId: 'm1', text: '<!-- mm:x -->\n旧内容', stale: true, payload: { trigger: 'delta', lastRefreshMode: 'delta', lastRefreshedAt: new Date(now - 86400000).toISOString(), schedule: { refresh_cron: '0 * * * *', full_refresh_cron: '30 3 * * 0', refresh_after_consolidation: true, min_refresh_interval_seconds: 0 } } };
const tools = {
  list: async () => ({ ok: true, models: [{ modelId: 'm1', stale: model.stale, schedule: model.payload.schedule }] }),
  get: async () => ({ ok: true, stale: model.stale, model }),
  refresh: async args => { calls++; model.stale = false; model.payload.lastRefreshedAt = new Date(now).toISOString(); model.payload.lastRefreshMode = args.full ? 'full' : 'delta'; model.text = '<!-- mm:x -->\n新内容'; return { ok: true, refreshed: true }; },
};
const make = () => new MentalModelScheduler({ tools, stateFile: path.join(dir, 'state.json'), now: () => now, retryDelayMs: 0 });
const first = await make().run('delta');
assert.equal(first.counts.refreshed, 1);
console.log('✓ refresh_cron 到期时执行 delta');
model.stale = true; now += 60000;
const notDue = await make().run('delta');
assert.equal(notDue.results[0].reason, 'cron-not-due');
console.log('✓ cron 未到期不调用 LLM');
model.stale = true; now = Date.parse('2026-11-21T12:05:00Z');
const after = await make().run('delta', { afterConsolidation: true });
assert.equal(after.counts.refreshed, 1);
console.log('✓ refresh_after_consolidation 绕过 cron 但保留 stale 门控');
model.stale = true; model.payload.schedule.min_refresh_interval_seconds = 3600;
const limited = await make().run('delta');
assert.equal(limited.results[0].reason, 'min-refresh-interval');
console.log('✓ min_refresh_interval_seconds 生效');
model.payload.schedule.min_refresh_interval_seconds = 0; model.stale = true; now = Date.parse('2026-11-21T13:00:00Z');
const dry = await make().run('dry-run');
assert.equal(dry.results[0].status, 'would-refresh');
console.log('✓ dry-run 只报告计划，不写模型');
model.payload.lastRefreshMode = 'delta'; now = Date.parse('2026-11-22T03:30:00Z');
const full = await make().run('full');
assert.equal(full.counts.refreshed, 1);
console.log('✓ full_refresh_cron 与 delta-since-full 门控生效');
fs.rmSync(dir, { recursive: true, force: true });