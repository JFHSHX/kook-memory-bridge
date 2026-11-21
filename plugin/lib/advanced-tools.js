import {
  readMemory, rebuildCache, cacheExists, kook, writeMemory,
} from './core.js';
import { resolveBankConfig, activeDirectives, makeDirectiveUnit } from './banks.js';
import { searchKookMemory } from './search.js';
import {
  createLLMClient, reflect as reflectWithLLM, parseObservationDecisions,
  buildObservationReconcilePrompt, buildMentalModelDeltaPrompt, buildReflectPrompt,
} from './llm.js';
import { reconcileObservation, scopeVariants, scopeKey, observationsAreStale } from './consolidation.js';
import {
  createMentalModel, isMentalModelStale, refreshMentalModel, applyMentalModelDelta,
  groupMentalModels, splitMentalModelContent, mentalModelDocumentId,
} from './mental-models.js';
import { persistNewUnit, persistExistingUnit, deletePersistedUnit } from './retain.js';

const output = render => ({ schema: { type: 'object' }, render });
const text = value => [{ type: 'text', text: value }];
const idOf = e => String(e.id || e.msgId);

export function createAdvancedTools(cfg, dir) {
  async function ensureCache() { if (!cacheExists(dir)) await rebuildCache(cfg, dir); }

  const reflectTool = {
    name: 'kook_reflect',
    description: 'Hindsight 风格分层反思：mental models（stale 回查）→ observations → raw facts，应用 bank disposition/directives；无 LLM 时只返回证据。',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string' }, bank: { type: 'string' },
        limit: { type: 'integer', description: '每层证据上限，默认 6' },
        maxTokens: { type: 'integer' }, tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['question'], additionalProperties: false,
    },
    output: output((_a, v) => text(v.answer
      ? `${v.answer}\n\n依据: ${v.basedOn.join(', ') || '(无引用)'}`
      : `证据模式（未配置 LLM）：mental=${v.evidence?.mentalModels.length || 0} observation=${v.evidence?.observations.length || 0} raw=${v.evidence?.memories.length || 0}\n${v.note || ''}`)),
    timeoutMs: 180000,
    isConcurrencySafe: false,
    execute: async args => {
      if (!String(args.question || '').trim()) throw new Error('kook_reflect: question 不能为空');
      await ensureCache();
      const bank = args.bank || 'default';
      const rows = readMemory(dir);
      const limit = Math.max(1, Math.min(20, Number(args.limit) || 6));
      const [mm, obs, raw] = await Promise.all([
        searchKookMemory(cfg, dir, { query: args.question, bank, kinds: ['mental_model'], limit, maxTokens: 3000 }),
        searchKookMemory(cfg, dir, { query: args.question, bank, kinds: ['observation'], limit, maxTokens: 3000 }),
        searchKookMemory(cfg, dir, { query: args.question, bank, kinds: ['memory'], limit, maxTokens: args.maxTokens || 6000 }),
      ]);
      const mentalModels = mm.results.map(x => ({ ...x.entry, stale: isMentalModelStale(x.entry, rows) }));
      const observations = obs.results.map(x => ({ ...x.entry, stale: observationsAreStale(x.entry, rows) }));
      const memories = raw.results.map(x => x.entry);
      const directives = activeDirectives(rows, bank, args.tags || []);
      const bankConfig = resolveBankConfig(rows, bank);
      const toolTrace = ['search_mental_models', 'search_observations', 'recall'];
      const client = createLLMClient(cfg);
      if (!client.enabled) {
        return {
          ok: true, mode: 'evidence-only', answer: null,
          evidence: { mentalModels, observations, memories },
          directivesApplied: directives.map(idOf), toolTrace,
          note: '未配置 LLM：已执行分层检索，未伪造生成式反思',
        };
      }
      const result = await reflectWithLLM(client, {
        question: args.question, mentalModels, observations, memories,
        directives, bankConfig, toolTrace, maxTokens: args.maxTokens || 3000,
      });
      return { ok: true, mode: 'reflect', ...result, directivesApplied: directives.map(idOf) };
    },
  };

  const consolidateTool = {
    name: 'kook_consolidate',
    description: '整合 observations：scope 隔离、证据并集、重复强化、纠正保留历史；无 LLM 时 append-only＋精确去重，raw facts 永不改。',
    parameters: {
      type: 'object',
      properties: {
        bank: { type: 'string' }, scopeMode: { type: 'string', enum: ['combined', 'per_tag', 'all_combinations', 'shared'] },
        factIds: { type: 'array', items: { type: 'string' }, description: '只整合指定 raw fact ids' },
        full: { type: 'boolean', description: '重新处理全部被观察覆盖的 facts' },
      },
      additionalProperties: false,
    },
    output: output((_a, v) => text(`观察整合（${v.mode}）：创建 ${v.created}，更新 ${v.updated}，删除 ${v.deleted}，跳过 ${v.skipped}${v.note ? `\n${v.note}` : ''}`)),
    timeoutMs: 180000,
    isConcurrencySafe: false,
    execute: async (args = {}) => {
      await ensureCache();
      const bank = args.bank || 'default';
      const rows = readMemory(dir);
      const wanted = args.factIds ? new Set(args.factIds.map(String)) : null;
      let facts = rows.filter(e => e.bank === bank && e.kind === 'memory' && (!wanted || wanted.has(idOf(e))));
      const covered = new Set(rows.filter(e => e.bank === bank && e.kind === 'observation').flatMap(o => o.sourceMemoryIds || []));
      if (!args.full && !wanted) facts = facts.filter(f => !covered.has(idOf(f)));
      const observations = rows.filter(e => e.bank === bank && e.kind === 'observation');
      if (!facts.length) return { ok: true, mode: 'noop', created: 0, updated: 0, deleted: 0, skipped: 0, note: '没有待整合的新事实' };
      const client = createLLMClient(cfg);
      const counts = { created: 0, updated: 0, deleted: 0, skipped: 0 };
      const apply = async (decision, groupFacts, existing) => {
        const result = reconcileObservation({ observation: existing, facts: groupFacts, decision, now: Date.now() });
        if (result.action === 'skip') { counts.skipped++; return; }
        if (result.action === 'delete') {
          if (existing) { await deletePersistedUnit(cfg, dir, existing.msgId); counts.deleted++; }
          return;
        }
        if (existing) { await persistExistingUnit(cfg, dir, existing, result.observation); counts.updated++; }
        else { await persistNewUnit(cfg, dir, result.observation, { enrich: false }); counts.created++; }
      };

      if (!client.enabled) {
        for (const fact of facts) {
          const scope = fact.scope || fact.tags || [];
          const existing = observations.find(o => scopeKey(o.scope || o.tags) === scopeKey(scope)
            && String(o.text).toLocaleLowerCase().replace(/\s+/g, ' ').trim() === String(fact.text).toLocaleLowerCase().replace(/\s+/g, ' ').trim());
          if (existing?.sourceMemoryIds.includes(idOf(fact))) { counts.skipped++; continue; }
          await apply({
            action: existing ? 'update' : 'create', effect: existing ? 'repeats' : 'adds',
            text: fact.text, sourceMemoryIds: [idOf(fact)], scope, bank,
          }, facts, existing);
        }
        return { ok: true, mode: 'append-only', ...counts, note: '未配置 LLM：未自动判断相似或矛盾，只新增/精确强化' };
      }

      const groups = new Map();
      for (const fact of facts) {
        for (const scope of scopeVariants(fact.tags, args.scopeMode || 'combined')) {
          const key = scopeKey(scope);
          if (!groups.has(key)) groups.set(key, { scope, facts: [] });
          groups.get(key).facts.push(fact);
        }
      }
      for (const group of groups.values()) {
        const existing = observations.filter(o => scopeKey(o.scope || o.tags) === scopeKey(group.scope));
        const groupFacts = group.facts.slice(-50);
        const raw = await client.completeJson(buildObservationReconcilePrompt({
          observations: existing.map(o => ({ id: idOf(o), text: o.text, sourceMemoryIds: o.sourceMemoryIds, scope: o.scope })),
          facts: groupFacts.map(f => ({ id: idOf(f), text: f.text, occurredStart: f.occurredStart, occurredEnd: f.occurredEnd, mentionedAt: f.mentionedAt })),
          mission: resolveBankConfig(rows, bank).observationsMission,
        }), { maxTokens: 4000 });
        const decisions = parseObservationDecisions(raw, groupFacts);
        for (const decision of decisions) {
          const target = existing.find(o => idOf(o) === String(decision.observationId || decision.id));
          await apply(decision, groupFacts, target || null);
        }
      }
      return { ok: true, mode: 'llm-reconcile', ...counts, note: '' };
    },
  };

  async function persistChunkedMentalModel(previous, refreshed) {
    const chunks = splitMentalModelContent(refreshed.text, 400);
    const documentId = mentalModelDocumentId(previous.modelId);
    const previousDocuments = readMemory(dir).filter(e => e.kind === 'document' && e.modelId === previous.modelId && e.documentId === documentId);
    const created = [];
    let mainUpdated = false;
    try {
      const entry = await persistExistingUnit(cfg, dir, previous, {
        ...refreshed, documentId, chunkId: 'chunk-0', text: chunks[0],
        metadata: { ...refreshed.metadata, chunkIndex: 0, chunkCount: chunks.length },
      });
      mainUpdated = true;
      for (let index = 1; index < chunks.length; index++) {
        const document = await persistNewUnit(cfg, dir, {
          ...refreshed, kind: 'document', documentId, chunkId: `chunk-${index}`, text: chunks[index],
          payload: { partOf: previous.modelId, sourceQuery: refreshed.payload?.sourceQuery },
          metadata: { chunkIndex: index, chunkCount: chunks.length },
        }, { enrich: false });
        created.push(document.entry);
      }
      for (const old of previousDocuments) await deletePersistedUnit(cfg, dir, old.msgId);
      return entry;
    } catch (error) {
      for (const document of created) {
        try { await deletePersistedUnit(cfg, dir, document.msgId); } catch {}
      }
      if (mainUpdated) {
        try { await persistExistingUnit(cfg, dir, previous, previous); } catch {}
      }
      throw error;
    }
  }

  const mentalModelTool = {
    name: 'kook_mental_model',
    description: '管理预写心智模型：list/get/create/refresh/delete；scoped stale、watermark、full/delta 刷新，未变块保留，读取不调用 LLM。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'get', 'create', 'refresh', 'delete'] },
        bank: { type: 'string' }, modelId: { type: 'string' }, msgId: { type: 'string' },
        name: { type: 'string' }, sourceQuery: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } }, scope: { type: 'array', items: { type: 'string' } },
        force: { type: 'boolean' }, full: { type: 'boolean' },
      },
      required: ['action'], additionalProperties: false,
    },
    output: output((_a, v) => text(v.ok
      ? (v.action === 'list' ? `mental models: ${v.models.map(m => `${m.modelId}${m.stale ? '(stale)' : ''}`).join(', ') || '(空)'}`
        : `${v.action} ${v.modelId || ''}${v.refreshed === false ? '：无需刷新' : ''}\n${v.content || ''}`)
      : `失败: ${v.error || ''}`)),
    timeoutMs: 180000,
    isConcurrencySafe: false,
    execute: async (args = {}) => {
      await ensureCache();
      const action = args.action;
      const bank = args.bank || 'default';
      const rows = readMemory(dir);
      const models = groupMentalModels(rows.filter(e => e.bank === bank));
      if (action === 'list') {
        return { ok: true, action, models: models.map(m => ({ modelId: m.modelId, msgId: m.msgId, name: m.payload?.name, stale: isMentalModelStale(m, rows), lastMemorySeenAt: m.payload?.lastMemorySeenAt })) };
      }
      if (action === 'create') {
        const modelId = args.modelId || args.name;
        if (models.some(m => m.modelId === modelId)) throw new Error(`mental model 已存在: ${modelId}`);
        const model = createMentalModel({ bank, modelId, name: args.name, sourceQuery: args.sourceQuery, tags: args.tags || ['#mental-model'], scope: args.scope || [] });
        const entry = (await persistNewUnit(cfg, dir, model, { enrich: false })).entry;
        return { ok: true, action, modelId, msgId: entry.msgId, content: entry.text };
      }
      const model = models.find(m => m.modelId === args.modelId || m.msgId === args.msgId);
      if (!model) throw new Error('找不到 mental model；先 list 或 create');
      if (action === 'get') return { ok: true, action, modelId: model.modelId, msgId: model.msgId, content: model.text, stale: isMentalModelStale(model, rows), model };
      if (action === 'delete') {
        for (const target of rows.filter(e => e.modelId === model.modelId && ['mental_model', 'document'].includes(e.kind))) {
          await deletePersistedUnit(cfg, dir, target.msgId);
        }
        return { ok: true, action, modelId: model.modelId, msgId: model.msgId };
      }
      if (action !== 'refresh') throw new Error(`未知 action: ${action}`);
      if (!args.force && !isMentalModelStale(model, rows)) return { ok: true, action, modelId: model.modelId, refreshed: false, content: model.text };
      const client = createLLMClient(cfg);
      if (!client.enabled) throw new Error('refresh 需要 LLM；list/get 可直接读取现有模型，未配置时不伪造刷新');
      const search = await searchKookMemory(cfg, dir, { query: model.payload?.sourceQuery || model.question, bank, limit: 20, maxTokens: 10000 });
      const sourceMemories = search.results.map(x => x.entry);
      const scope = new Set(model.scope || []);
      const latest = rows.filter(e => e.bank === bank && e.kind === 'memory' && (!scope.size || e.tags.some(t => scope.has(t)))).sort((a, b) => b.ts - a.ts)[0];
      if (latest && !sourceMemories.some(e => e.msgId === latest.msgId)) sourceMemories.push(latest);
      let content;
      if (args.full || !model.text.includes('<!-- mm:') || model.text === '（尚未生成）') {
        content = await client.complete(buildReflectPrompt({
          question: model.payload?.sourceQuery || model.question,
          mentalModels: [], observations: [], memories: sourceMemories,
          directives: [], bankConfig: resolveBankConfig(rows, bank), toolTrace: ['recall'],
        }), { maxTokens: 5000 });
      } else {
        const raw = await client.completeJson(buildMentalModelDeltaPrompt({ model, newMemories: sourceMemories }), { maxTokens: 4000 });
        content = applyMentalModelDelta(model.text, raw.operations || []);
      }
      const refreshed = refreshMentalModel(model, { content, sourceMemories, now: Date.now(), trigger: args.full ? 'full' : 'delta' });

      if (!refreshed.refreshed) throw new Error('LLM 返回空内容，已保留旧模型且水位未推进');
      const entry = await persistChunkedMentalModel(model, refreshed.model);
      return { ok: true, action, modelId: model.modelId, msgId: model.msgId, refreshed: true, content: refreshed.model.text, basedOn: entry.payload.basedOn };
    },
  };

  const directiveTool = {
    name: 'kook_directive',
    description: '管理 bank 硬规则：list/create/update/delete，支持 tags scope、priority、isActive；reflect 按优先级注入并返回 applied ids。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'create', 'update', 'delete'] }, bank: { type: 'string' },
        msgId: { type: 'string' }, text: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } },
        priority: { type: 'integer' }, enabled: { type: 'boolean' },
      },
      required: ['action'], additionalProperties: false,
    },
    output: output((_a, v) => text(v.ok ? `${v.action} ${v.msgId || ''}\n${v.text || v.directives?.map(d => `${d.msgId}: ${d.text}`).join('\n') || ''}` : `失败: ${v.error || ''}`)),
    timeoutMs: 60000,
    isConcurrencySafe: false,
    execute: async (args = {}) => {
      await ensureCache();
      const bank = args.bank || 'default';
      const rows = readMemory(dir);
      const existing = rows.filter(e => e.bank === bank && e.kind === 'directive');
      if (args.action === 'list') return { ok: true, action: 'list', directives: existing.map(d => ({ msgId: d.msgId, text: d.text, priority: d.payload?.priority, enabled: d.payload?.enabled, tags: d.tags })) };
      if (args.action === 'create') {
        const unit = makeDirectiveUnit({ bank, text: args.text, tags: args.tags || ['#directive'], priority: args.priority ?? 100, enabled: args.enabled ?? true });
        const entry = (await persistNewUnit(cfg, dir, unit, { enrich: false })).entry;
        return { ok: true, action: 'create', msgId: entry.msgId, text: entry.text };
      }
      const target = existing.find(d => d.msgId === args.msgId);
      if (!target) throw new Error('找不到 directive msgId');
      if (args.action === 'delete') {
        await deletePersistedUnit(cfg, dir, target.msgId);
        return { ok: true, action: 'delete', msgId: target.msgId };
      }
      if (args.action !== 'update') throw new Error(`未知 action: ${args.action}`);
      const unit = makeDirectiveUnit({
        bank, text: args.text ?? target.text, tags: args.tags || target.tags,
        priority: args.priority ?? target.payload?.priority ?? 100,
        enabled: args.enabled ?? target.payload?.enabled ?? true,
      });
      const entry = await persistExistingUnit(cfg, dir, target, unit);
      return { ok: true, action: 'update', msgId: entry.msgId, text: entry.text };
    },
  };

  return [reflectTool, consolidateTool, mentalModelTool, directiveTool];
}
