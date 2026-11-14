import { normalizeUnit } from './units.js';

export function scopeVariants(tags, mode = 'combined') {
  const clean = [...new Set((tags || []).map(String).filter(Boolean))].sort();
  if (mode === 'shared') return [[]];
  if (mode === 'per_tag') return clean.map(tag => [tag]);
  if (mode === 'all_combinations') {
    const out = [];
    for (let mask = 1; mask < (1 << clean.length); mask++) {
      out.push(clean.filter((_, i) => mask & (1 << i)));
    }
    return out;
  }
  return clean.length ? [clean] : [[]]; // 显式 [] 回退 combined，不等于 shared
}

export const scopeKey = scope => JSON.stringify([...(scope || [])].sort());
const norm = text => String(text || '').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
const unique = values => [...new Set(values.map(String).filter(Boolean))];
const maxIso = values => values.filter(Boolean).sort().at(-1) || null;
const minIso = values => values.filter(Boolean).sort()[0] || null;

export function validateObservationDecision(decision, pendingFacts) {
  const action = decision?.action;
  if (!['create', 'update', 'delete', 'skip', 'new', 'reinforce', 'refine'].includes(action)) {
    throw new Error(`未知 observation action: ${action}`);
  }
  const allowed = new Set(pendingFacts.map(f => String(f.id || f.msgId)));
  const cited = (decision.sourceMemoryIds || decision.evidenceFactIds || []).map(String);
  const unknown = cited.filter(id => !allowed.has(id));
  if (unknown.length) throw new Error(`观察引用了未输入的 fact id: ${unknown.join(', ')}`);
  if (['create', 'new', 'refine'].includes(action) && !String(decision.text || decision.digest || '').trim()) {
    throw new Error(`${action} 需要非空 text`);
  }
  return { ...decision, sourceMemoryIds: cited };
}

/**
 * 应用一次 observation 对账。raw facts 只读；返回新/更新后的 observation。
 * proofCount 永远由去重 sourceMemoryIds 推导，不是 reinforce 次数。
 */
export function reconcileObservation({ observation = null, facts = [], decision, now = Date.now() }) {
  const checked = validateObservationDecision(decision, facts);
  const action = ({ new: 'create', reinforce: 'update', refine: 'update' })[checked.action] || checked.action;
  if (action === 'skip') return { action, observation, changed: false };
  if (action === 'delete') return { action, observation, changed: Boolean(observation) };
  if (action === 'update' && !observation) throw new Error('update 缺少现有 observation');
  const effect = checked.effect || (checked.action === 'reinforce' ? 'repeats' : checked.action === 'refine' ? 'changes' : 'adds');
  const oldSources = observation?.sourceMemoryIds || [];
  const sourceMemoryIds = unique([...oldSources, ...checked.sourceMemoryIds]);
  if (!sourceMemoryIds.length) throw new Error('observation 至少需要一个 sourceMemoryId');
  const byId = new Map(facts.map(f => [String(f.id || f.msgId), f]));
  const sources = sourceMemoryIds.map(id => byId.get(id) || (observation?.payload?.sourceFacts || []).find(f => String(f.id) === id)).filter(Boolean);
  const history = [...(observation?.payload?.history || [])];
  if (observation && ['changes', 'ends'].includes(effect)) {
    history.push({ text: observation.text, sourceMemoryIds: oldSources, at: new Date(now).toISOString(), effect });
  }
  let text = observation?.text;
  if (action === 'create' || ['changes', 'ends', 'adds'].includes(effect)) text = checked.text || checked.digest;
  if (checked.append_note) text = `${text || ''}\n${checked.append_note}`.trim();
  if (!String(text || '').trim()) throw new Error('更新后 observation 文本为空，已拒绝覆盖旧文');
  const scope = checked.scope || observation?.scope || observation?.tags || [];
  const unit = normalizeUnit({
    ...(observation || {}),
    kind: 'observation', factType: 'observation',
    bank: checked.bank || observation?.bank || facts[0]?.bank || 'default',
    text,
    tags: checked.tags || observation?.tags || (scope.length ? scope : ['#observation']),
    scope,
    occurredStart: minIso(sources.map(f => f.occurredStart)) || observation?.occurredStart || null,
    occurredEnd: maxIso(sources.map(f => f.occurredEnd || f.occurredStart)) || observation?.occurredEnd || null,
    mentionedAt: maxIso(sources.map(f => f.mentionedAt)) || new Date(now).toISOString(),
    sourceMemoryIds,
    proofCount: sourceMemoryIds.length,
    confidence: checked.confidence ?? observation?.confidence ?? 1,
    payload: {
      ...(observation?.payload || {}), effect, scope, history,
      consolidatedAt: new Date(now).toISOString(),
      sourceFacts: sources.map(f => ({ id: String(f.id || f.msgId), occurredStart: f.occurredStart || null, occurredEnd: f.occurredEnd || null, mentionedAt: f.mentionedAt || null })),
    },
  });
  return { action, effect, observation: unit, changed: true };
}

/** 无 LLM 时只做规范化精确文本去重，不判断矛盾、不合并“相似”事实。 */
export function consolidateExactDuplicates({ observations = [], facts = [], now = Date.now() }) {
  const out = [];
  for (const fact of facts) {
    const factId = String(fact.id || fact.msgId);
    const existing = observations.find(o => o.bank === (fact.bank || 'default')
      && scopeKey(o.scope || o.tags) === scopeKey(fact.scope || fact.tags)
      && norm(o.text) === norm(fact.text));
    if (!existing || existing.sourceMemoryIds.includes(factId)) {
      out.push({ action: 'skip', factId, changed: false });
      continue;
    }
    out.push(reconcileObservation({
      observation: existing, facts: [...facts, { ...existing, id: `observation-${existing.msgId || 'existing' }` }],
      decision: { action: 'update', effect: 'repeats', sourceMemoryIds: [factId] }, now,
    }));
  }
  return out;
}

export function observationsAreStale(observation, rawFacts) {
  const consolidatedAt = Date.parse(observation?.payload?.consolidatedAt || 0);
  const ids = new Set(observation?.sourceMemoryIds || []);
  return rawFacts.some(f => ids.has(String(f.id || f.msgId)) && (f.ts || 0) > consolidatedAt);
}
