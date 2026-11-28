import path from 'node:path';
import { MentalModelScheduler } from '../../standalone/scheduler-core.mjs';

const runtimes = new Map();

function makeTools(defs) {
  const execute = (name, args) => {
    const tool = defs[name];
    if (!tool?.execute) throw new Error('缺少工具: ' + name);
    return tool.execute(args);
  };
  return {
    list: () => execute('kook_mental_model', { action: 'list' }),
    get: ({ modelId }) => execute('kook_mental_model', { action: 'get', modelId }),
    create: args => execute('kook_mental_model', { action: 'create', ...args }),
    refresh: ({ modelId, full, force }) => execute('kook_mental_model', { action: 'refresh', modelId, full, force }),
  };
}

export async function startKookRuntime({ tools, stateFile, logger = null }) {
  if (runtimes.has(stateFile)) return runtimes.get(stateFile);
  const scheduler = new MentalModelScheduler({ tools: makeTools(tools), stateFile });
  const runtime = {
    scheduler, timers: new Map(), running: true, stateFile,
    async run(mode) {
      try { return await scheduler.run(mode); } catch (error) { logger?.warn?.(`kook runtime ${mode} failed: ${error.message}`); return { error: error.message }; }
    },
    async schedule(mode) {
      if (!runtime.running) return;
      const next = await scheduler.nextRunAt(mode);
      const delay = Math.max(1000, next.getTime() - Date.now());
      const timer = setTimeout(async () => {
        await runtime.run(mode);
        await runtime.schedule(mode);
      }, delay);
      runtime.timers.set(mode, timer);
    },
    async stop() {
      runtime.running = false;
      for (const timer of runtime.timers.values()) clearTimeout(timer);
      runtime.timers.clear();
      if (tools.kook_pages?.execute) await tools.kook_pages.execute({ action: 'stop' });
      runtimes.delete(stateFile);
      return { ok: true, running: false };
    },
    status() { return { ok: true, running: runtime.running, stateFile, timers: [...runtime.timers.keys()] }; }
  };
  runtimes.set(stateFile, runtime);
  try {
    if (tools.kook_pages?.execute) await tools.kook_pages.execute({ action: 'start', bank: 'default' });
    await runtime.run('delta');
    await runtime.schedule('delta');
    await runtime.schedule('full');
    return runtime;
  } catch (error) {
    await runtime.stop();
    throw error;
  }
}

export async function stopKookRuntime({ stateFile }) {
  const runtime = runtimes.get(stateFile);
  return runtime ? runtime.stop() : { ok: true, running: false };
}

export function getKookRuntimeStatus({ stateFile }) {
  return runtimes.get(stateFile)?.status() || { ok: true, running: false, stateFile };
}