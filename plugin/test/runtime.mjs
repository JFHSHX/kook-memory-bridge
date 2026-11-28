import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startKookRuntime, stopKookRuntime, getKookRuntimeStatus } from '../lib/runtime.js';

const stateFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kook-runtime-')), 'scheduler-state.json');
const model = { modelId: 'm1', text: '（尚未生成）', stale: true, payload: { sourceQuery: '用户偏好', lastRefreshedAt: null, lastMemorySeenAt: 0 } };
const actions = [];
const tools = {
  kook_pages: { execute: async args => { actions.push(args.action); return { ok: true, running: args.action === 'start' }; } },
  kook_mental_model: { execute: async args => {
    if (args.action === 'list') return { ok: true, models: [{ modelId: 'm1', stale: model.stale }] };
    if (args.action === 'get') return { ok: true, model, stale: model.stale };
    if (args.action === 'refresh') { actions.push(args.action); model.text = '<!-- mm:x -->\n用户偏好 Vue'; model.payload.lastRefreshedAt = new Date().toISOString(); model.payload.lastRefreshMode = args.full ? 'full' : 'delta'; model.stale = false; return { ok: true, refreshed: true }; }
    throw new Error('unexpected ' + args.action);
  } },
};
const runtime = await startKookRuntime({ tools, stateFile });
assert.equal(runtime.running, true);
assert.equal(actions.filter(action => action === 'refresh').length, 1);
assert.equal(getKookRuntimeStatus({ stateFile }).running, true);
const same = await startKookRuntime({ tools, stateFile });
assert.equal(same, runtime);
await stopKookRuntime({ stateFile });
assert.equal(getKookRuntimeStatus({ stateFile }).running, false);
assert.equal(actions.at(-1), 'stop');
console.log('✓ DSH 启动自动启动完整运行时，停止时清理且不会重复启动');
fs.rmSync(path.dirname(stateFile), { recursive: true, force: true });