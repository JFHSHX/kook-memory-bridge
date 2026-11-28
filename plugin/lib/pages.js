import fs from 'node:fs';
import path from 'node:path';
import { readMemory } from './core.js';
import { groupMentalModels, isMentalModelStale, knowledgePageProjection } from './mental-models.js';

const safeId = value => {
  const text = String(value || '');
  if (!/^[A-Za-z0-9_.-]+$/.test(text)) throw new Error('页面 ID 只能包含字母、数字、点、下划线和短横线');
  return text;
};

export class KnowledgePages {
  constructor({ dir, refreshModel, intervalMs = 60000, autoRefresh = true }) {
    this.dir = dir;
    this.root = path.join(dir, 'pages');
    this.refreshModel = refreshModel;
    this.intervalMs = intervalMs;
    this.autoRefresh = autoRefresh;
    this.timer = null;
    this.busy = false;
  }

  models(bank) { return groupMentalModels(readMemory(this.dir).filter(row => row.bank === bank && row.kind === 'mental_model')); }

  fileFor(bank, modelId) {
    const file = path.resolve(this.root, safeId(bank), safeId(modelId) + '.md');
    if (!file.startsWith(path.resolve(this.root) + path.sep)) throw new Error('页面路径越界');
    return file;
  }

  async writeModel(model) {
    const [page] = knowledgePageProjection([model]);
    const file = this.fileFor(model.bank, model.modelId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const previous = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (previous === page.content) return false;
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, page.content, { mode: 0o600 });
    fs.renameSync(tmp, file);
    return true;
  }

  async sync(bank = 'default') {
    const models = this.models(bank);
    let written = 0;
    for (const model of models) if (await this.writeModel(model)) written++;
    return { bank, models: models.length, written };
  }

  async list(bank = 'default') {
    return this.models(bank).map(model => ({
      bank, modelId: model.modelId, name: model.payload?.name || model.modelId,
      path: bank + '/' + model.modelId + '.md',
      stale: isMentalModelStale(model, readMemory(this.dir)),
      lastRefreshedAt: model.payload?.lastRefreshedAt || null,
      exists: fs.existsSync(this.fileFor(bank, model.modelId)),
    }));
  }

  async read(bank, modelId) {
    const file = this.fileFor(bank, modelId);
    if (!fs.existsSync(file)) await this.sync(bank);
    if (!fs.existsSync(file)) throw new Error('页面不存在: ' + modelId);
    return fs.readFileSync(file, 'utf8');
  }

  async refresh(bank = 'default') {
    if (this.busy) return { ok: true, busy: true, refreshed: 0, written: 0 };
    this.busy = true;
    try {
      let refreshed = 0;
      const rows = readMemory(this.dir);
      if (this.autoRefresh) {
        for (const model of this.models(bank)) {
          if (!isMentalModelStale(model, rows)) continue;
          await this.refreshModel({ modelId: model.modelId, full: false, force: false });
          refreshed++;
        }
      }
      const synced = await this.sync(bank);
      return { ok: true, busy: false, refreshed, written: synced.written, models: synced.models };
    } finally { this.busy = false; }
  }

  async start() {
    if (this.timer) return this.status();
    await this.refresh();
    this.timer = setInterval(() => this.refresh().catch(() => {}), this.intervalMs);
    return this.status();
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; return this.status(); }

  status() { return { ok: true, running: Boolean(this.timer), intervalMs: this.intervalMs, autoRefresh: this.autoRefresh, root: this.root }; }
}

const services = new Map();

export function createPageTools({ dir, refreshModel, intervalMs = 60000, autoRefresh = true }) {
  let service = services.get(dir);
  if (!service) {
    service = new KnowledgePages({ dir, refreshModel, intervalMs, autoRefresh });
    services.set(dir, service);
  }
  const output = render => ({ schema: { type: 'object' }, render });
  const text = value => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }];
  return [{
    name: 'kook_pages',
    description: 'Knowledge Pages：由 Mental Model 生成 Markdown 文件，支持安全读取、原子写盘与 stale 后台刷新。',
    parameters: { type: 'object', properties: {
      action: { type: 'string', enum: ['list', 'get', 'refresh', 'start', 'stop', 'status'] },
      bank: { type: 'string' }, modelId: { type: 'string' },
    }, required: ['action'], additionalProperties: false },
    output: output((_a, value) => text(value)),
    timeoutMs: 180000, isConcurrencySafe: false,
    execute: async args => {
      const bank = args.bank || 'default';
      if (args.action === 'list') return { ok: true, action: 'list', pages: await service.list(bank) };
      if (args.action === 'get') return { ok: true, action: 'get', modelId: args.modelId, content: await service.read(bank, args.modelId) };
      if (args.action === 'refresh') return service.refresh(bank);
      if (args.action === 'start') return service.start();
      if (args.action === 'stop') return service.stop();
      if (args.action === 'status') return service.status();
      throw new Error('未知 pages action: ' + args.action);
    },
  }];
}