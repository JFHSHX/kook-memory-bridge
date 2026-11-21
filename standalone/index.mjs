#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { __internals } from '../plugin/lib/index.js';
import { loadConfig } from '../plugin/lib/core.js';
import { MentalModelScheduler, DEFAULT_MODEL_ID, DEFAULT_SOURCE_QUERY, nextDeltaAt, nextFullAt } from './scheduler-core.mjs';

const dataDir = process.env.KOOK_MEMORY_HOME || path.join(os.homedir(), '.dsh', 'kook-memory');
const stateFile = process.env.KOOK_SCHEDULER_STATE || path.join(dataDir, 'scheduler-state.json');
const lockFile = stateFile + '.lock';
const logFile = path.join(dataDir, 'scheduler.log');
const args = process.argv.slice(2);
const command = args[0] || '--daemon';
const mode = args[1];

function log(level, event) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, ...event });
  console.log(line);
  try { fs.appendFileSync(logFile, line + '\n', { mode: 0o600 }); } catch {}
}

const config = loadConfig({ dataDir }, dataDir);
if (!config.botToken && !process.env.KOOK_BOT_TOKEN) {
  throw new Error('独立运行需要 KOOK_BOT_TOKEN（环境变量）或 config.json 中的 botToken；Hindsight 与 DSH 均不需要。');
}
const defs = Object.fromEntries(__internals.buildTools({ dataDir }).map(def => [def.name, def]));
const execute = (action, args = {}) => defs.kook_mental_model.execute({ action, bank: 'default', ...args });
const tools = {
  list: () => execute('list'),
  get: ({ modelId }) => execute('get', { modelId }),
  create: ({ modelId, name, sourceQuery }) => execute('create', { modelId, name, sourceQuery, tags: ['#mental-model'], scope: [] }),
  refresh: ({ modelId, full, force }) => execute('refresh', { modelId, full, force }),
};
const scheduler = new MentalModelScheduler({ tools, stateFile });

async function ensureDefaultModel() {
  const listing = await tools.list();
  if (!(listing.models || []).some(model => model.modelId === DEFAULT_MODEL_ID)) {
    await tools.create({ modelId: DEFAULT_MODEL_ID, name: '全局项目与偏好画像', sourceQuery: DEFAULT_SOURCE_QUERY });
    log('info', { event: 'model-created', modelId: DEFAULT_MODEL_ID });
  }
}

function acquireLock() {
  if (fs.existsSync(lockFile)) {
    try {
      const previous = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
      process.kill(Number(previous.pid), 0);
      throw new Error('另一个独立调度进程仍在运行，pid=' + previous.pid);
    } catch (error) {
      if (String(error.message).includes('另一个独立调度进程')) throw error;
      fs.rmSync(lockFile, { force: true });
    }
  }
  fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
}
function releaseLock() { try { fs.rmSync(lockFile, { force: true }); } catch {} }

async function main() {
  if (command === '--status') {
    const listing = await tools.list();
    console.log(JSON.stringify({ dataDir, stateFile, nextDeltaAt: (await scheduler.nextRunAt('delta')).toISOString(), nextFullAt: (await scheduler.nextRunAt('full')).toISOString(), models: listing.models || [] }, null, 2));
    return;
  }
  await ensureDefaultModel();
  if (command === '--once') {
    if (!['delta', 'full', 'dry-run'].includes(mode)) throw new Error('用法：--once delta|full|dry-run');
    const result = await scheduler.run(mode, { afterConsolidation: args.includes('--after-consolidation') });
    console.log(JSON.stringify(result, null, 2));
    if (result.counts.failed) process.exitCode = 1;
    return;
  }
  if (command !== '--daemon') throw new Error('用法：--once delta|full | --daemon | --status');
  acquireLock();
  const timers = new Set();
  const later = (mode, at) => {
    const timer = setTimeout(async () => {
      timers.delete(timer);
      try { log('info', { event: 'scheduled-run', result: await scheduler.run(mode) }); }
      catch (error) { log('error', { event: 'scheduled-run-failed', error: error.message }); }
      later(mode, await scheduler.nextRunAt(mode));
    }, Math.max(1000, at.getTime() - Date.now()));
    timers.add(timer);
  };
  const shutdown = () => {
    for (const timer of timers) clearTimeout(timer);
    releaseLock();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('exit', releaseLock);
  log('info', { event: 'daemon-started', pid: process.pid, nextDeltaAt: nextDeltaAt().toISOString(), nextFullAt: nextFullAt().toISOString() });
  try { log('info', { event: 'initial-run', result: await scheduler.run('delta') }); }
  catch (error) { log('error', { event: 'initial-run-failed', error: error.message }); }
  later('delta', nextDeltaAt());
  later('full', nextFullAt());
}

main().catch(error => { releaseLock(); log('error', { event: 'fatal', error: error.message }); process.exitCode = 1; });
