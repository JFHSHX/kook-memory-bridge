import { normalizeUnit } from './units.js';

export function createMentalModel({ bank = 'default', modelId, name, sourceQuery, tags = ['#mental-model'], scope, trigger = 'manual' }, now = Date.now()) {
  if (!String(modelId || '').trim()) throw new Error('modelId 不能为空');
  if (!String(sourceQuery || '').trim()) throw new Error('sourceQuery 不能为空');
  return normalizeUnit({
    kind: 'mental_model', bank, modelId, question: sourceQuery, factType: 'world', tags,
    text: '（尚未生成）', scope: scope === undefined ? tags : scope,
    payload: {
      name: name || modelId, sourceQuery, trigger, basedOn: [],
      lastRefreshedAt: null, lastMemorySeenAt: 0, history: [],
    },
    mentionedAt: new Date(now).toISOString(),
  });
}

export function isMentalModelStale(model, memories) {
  const basedScope = new Set(model.scope || model.tags || []);
  const lastSeen = Number(model.payload?.lastMemorySeenAt || 0);
  return memories.some(m => m.bank === model.bank
    && (basedScope.size === 0 || (m.tags || []).some(t => basedScope.has(t)))
    && (m.ts || 0) > lastSeen);
}

/** 失败/空内容返回旧模型；水位只能在内容成功生成后推进。 */
export function refreshMentalModel(model, { content, sourceMemories = [], basedOn = [], now = Date.now(), trigger = 'manual' }) {
  if (!String(content || '').trim()) return { model, refreshed: false, stale: true };
  const ids = [...new Set([...(model.payload?.basedOn || []), ...basedOn, ...sourceMemories.map(m => String(m.id || m.msgId))])];
  const latest = sourceMemories.reduce((max, m) => Math.max(max, Number(m.ts || 0)), Number(model.payload?.lastMemorySeenAt || 0));
  const next = normalizeUnit({
    ...model, text: String(content), mentionedAt: new Date(now).toISOString(),
    payload: {
      ...model.payload, basedOn: ids, trigger,
      lastRefreshedAt: new Date(now).toISOString(), lastMemorySeenAt: latest,
      history: [...(model.payload?.history || []), { text: model.text, at: model.payload?.lastRefreshedAt }].slice(-50),
    },
  });
  return { model: next, refreshed: true, stale: false };
}

/** 块格式：<!-- mm:block-id --> 到下一个标记。未操作块逐字保留。 */
export function applyMentalModelDelta(content, operations) {
  const source = String(content || '');
  const marker = /<!-- mm:([A-Za-z0-9_.-]+) -->/g;
  const blocks = [];
  let match;
  while ((match = marker.exec(source))) {
    blocks.push({ id: match[1], start: match.index, contentStart: marker.lastIndex });
  }
  for (let i = 0; i < blocks.length; i++) blocks[i].end = blocks[i + 1]?.start ?? source.length;
  const result = blocks.map(b => ({ id: b.id, text: source.slice(b.start, b.end) }));
  for (const op of operations || []) {
    const at = result.findIndex(b => b.id === op.id);
    if (op.action === 'delete') {
      if (at >= 0) result.splice(at, 1);
    } else if (op.action === 'replace') {
      if (!String(op.text || '').trim()) throw new Error(`delta replace ${op.id} 不允许空文`);
      const block = `<!-- mm:${op.id} -->${String(op.text).startsWith('\n') ? '' : '\n'}${op.text}`;
      if (at >= 0) result[at].text = block.endsWith('\n') ? block : `${block}\n`;
      else result.push({ id: op.id, text: block.endsWith('\n') ? block : `${block}\n` });
    } else if (op.action === 'append') {
      const block = `<!-- mm:${op.id} -->\n${op.text}${String(op.text).endsWith('\n') ? '' : '\n'}`;
      if (at >= 0) result[at].text += op.text;
      else result.push({ id: op.id, text: block });
    } else {
      throw new Error(`未知 mental model delta action: ${op.action}`);
    }
  }
  if (!result.length && source && !blocks.length) return operations?.length ? String(operations.map(o => o.text || '').join('\n')) : source;
  return result.map(b => b.text).join('');
}

export function knowledgePageProjection(models) {
  return models.map(model => ({
    path: `${model.bank}/${model.modelId}.md`,
    content: `---\nbank: ${model.bank}\nmodel: ${model.modelId}\nsourceQuery: ${JSON.stringify(model.payload?.sourceQuery || model.question || '')}\nlastMemorySeenAt: ${model.payload?.lastMemorySeenAt || 0}\n---\n\n${model.text}`,
  }));
}
