import assert from 'node:assert/strict';
import { scopeVariants, scopeKey, reconcileObservation, consolidateExactDuplicates, observationsAreStale, validateObservationDecision } from '../lib/consolidation.js';
import { createMentalModel, isMentalModelStale, refreshMentalModel, applyMentalModelDelta, knowledgePageProjection } from '../lib/mental-models.js';

assert.deepEqual(scopeVariants(['#b', '#a']), [['#a', '#b']]);
assert.deepEqual(scopeVariants([], 'shared'), [[]]);
assert.equal(scopeVariants(['#a', '#b', '#c'], 'all_combinations').length, 7);
assert.equal(scopeKey(['#b', '#a']), scopeKey(['#a', '#b']));
console.log('✓ observation scope combined/per_tag/all/shared');

const facts = [
  { id: 'f1', bank: 'default', text: '用户喜欢 React', tags: ['#pref'], occurredStart: '2026-01-01T00:00:00Z', mentionedAt: '2026-01-02T00:00:00Z', ts: 1000 },
  { id: 'f2', bank: 'default', text: '用户现在喜欢 Vue', tags: ['#pref'], occurredStart: '2026-02-01T00:00:00Z', mentionedAt: '2026-02-02T00:00:00Z', ts: 2000 },
];
const created = reconcileObservation({ facts, decision: { action: 'create', text: '用户曾偏好 React', sourceMemoryIds: ['f1'], scope: ['#pref'] }, now: 1500 });
assert.equal(created.observation.proofCount, 1);
const refined = reconcileObservation({ observation: created.observation, facts, decision: { action: 'update', effect: 'changes', text: '用户此前偏好 React，现在偏好 Vue', sourceMemoryIds: ['f2'] }, now: 2500 });
assert.equal(refined.observation.proofCount, 2);
assert.equal(refined.observation.sourceMemoryIds.length, 2);
assert.equal(Date.parse(refined.observation.occurredStart), Date.parse(facts[0].occurredStart));
assert.equal(refined.observation.payload.history.length, 1);
assert.equal(facts[0].text, '用户喜欢 React', 'raw fact 不得改写');
assert.throws(() => validateObservationDecision({ action: 'create', text: '伪造', sourceMemoryIds: ['not-seen'] }, facts), /未输入/);
console.log('✓ create/update 证据并集、双时间、历史保留、raw facts 不变');

const exact = consolidateExactDuplicates({ observations: [refined.observation], facts });
assert.equal(exact[0].action, 'skip');
assert.equal(observationsAreStale(refined.observation, facts), false);
console.log('✓ 无 LLM 仅精确去重，不做相似/矛盾自动判断');

let model = createMentalModel({ bank: 'default', modelId: 'prefs', sourceQuery: '用户偏好', tags: ['#pref'] }, 1000);
assert.equal(isMentalModelStale(model, facts), true);
const failed = refreshMentalModel(model, { content: '', sourceMemories: facts, now: 3000 });
assert.equal(failed.refreshed, false);
assert.equal(failed.model.text, model.text);
assert.equal(failed.model.payload.lastMemorySeenAt, 0, '失败不得推进水位');
model = refreshMentalModel(model, { content: '<!-- mm:summary -->用户偏好 Vue\n<!-- mm:history -->此前偏好 React\n', sourceMemories: facts, now: 3000 }).model;
assert.equal(model.payload.lastMemorySeenAt, 2000);
assert.equal(isMentalModelStale(model, facts), false);
console.log('✓ mental model watermark/stale/失败保旧文');

const before = model.text;
const delta = applyMentalModelDelta(before, [{ action: 'replace', id: 'summary', text: '用户当前偏好 Vue 与 Vite\n' }]);
assert.ok(delta.includes('Vue 与 Vite'));
assert.ok(delta.endsWith('<!-- mm:history -->此前偏好 React'), '未触及块必须逐字保留');
assert.ok(!applyMentalModelDelta(delta, []).includes('undefined'));
assert.equal(knowledgePageProjection([model])[0].path, 'default/prefs.md');
console.log('✓ 块级增量编辑与 knowledge page 投影');
