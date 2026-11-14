import assert from 'node:assert/strict';
import {
  tokenize, bm25Rank, semanticRank, parseTemporalQuery, temporalRank,
  linkExpansionRank, rrfFusion, rrfFallbackScore, applyBoosts, packBudget,
  searchMemories, propagateTemporal,
} from '../lib/retrieval.js';

const now = Date.parse('2026-11-15T12:00:00Z');
const e = (id, text, extra = {}) => ({ id, msgId: id, bank: 'default', kind: 'memory', factType: 'world', text, ts: now - 86400000, mentionedAt: '2026-11-14T12:00:00Z', tags: ['#fact'], entities: [], links: [], ...extra });

assert.ok(tokenize('用户偏好Vue').includes('用户'));
assert.ok(tokenize('用户偏好Vue').includes('Vue'.toLowerCase()));
const lexical = bm25Rank([e('a', '用户偏好 Vue 与 Vite'), e('b', '今天天气很好')], 'Vue');
assert.equal(lexical[0].id, 'a');
assert.equal(lexical[0].rank, 1);
console.log('✓ CJK/英文分词与 BM25 独立排序');

const explicit = parseTemporalQuery('2026-11-01 到 2026-11-03', { now });
assert.equal(explicit.start, '2026-11-01T00:00:00.000Z');
assert.equal(explicit.end, '2026-11-04T00:00:00.000Z');
const lastWeek = parseTemporalQuery('上周', { now });
assert.equal(lastWeek.start, '2026-11-02T00:00:00.000Z');
assert.equal(lastWeek.end, '2026-11-09T00:00:00.000Z');
assert.equal(parseTemporalQuery('没有日期', { now }), null);
console.log('✓ 显式日期/上周时间窗');

const seed = e('seed', 'React 技术选型', { embedding: [1, 0], entities: [{ name: 'React', type: 'PRODUCT', canonical: 'react' }] });
const other = e('other', 'KOOK 后端', { embedding: [0, 1] });
assert.equal(semanticRank([seed, other], [1, 0])[0].id, 'seed');
assert.equal(semanticRank([seed, other], [0, 1], { threshold: 0.8 })[0].id, 'other');
console.log('✓ 语义臂 cosine 与阈值');

const arms = {
  semantic: [{ id: 'a', rank: 1, score: 0.9 }, { id: 'b', rank: 2, score: 0.8 }],
  keyword: [{ id: 'b', rank: 1, score: 4 }, { id: 'a', rank: 2, score: 3 }],
  temporal: [{ id: 'a', rank: 1, score: 0.7 }],
};
const fused = rrfFusion(arms);
assert.equal(fused[0].id, 'a');
assert.ok(Math.abs(fused[0].rrf - (1 / 61 + 1 / 62 + 1 / 61)) < 1e-12);
assert.equal(fused[1].sources.temporal, undefined, '缺臂不得补分');
assert.equal(rrfFallbackScore(0, 3), 1);
assert.ok(Math.abs(rrfFallbackScore(2, 3) - 0.1) < 1e-12);
console.log('✓ RRF 同 id 多臂求和/缺臂/fallback 首尾');

const boosted = applyBoosts([{ id: 'a', entry: seed, rrf: 0.03, sources: { temporal: { score: 1 } } }], { now });
const recency = Math.max(0.1, 1 - 1 / 365);
const expected = 1 * (1 + 0.2 * (recency - 0.5)) * (1 + 0.2 * (1 - 0.5)) * (1 + 0.1 * (0.5 - 0.5));
assert.ok(Math.abs(boosted[0].finalScore - expected) < 1e-12);
console.log('✓ recency/temporal/proof 乘法 boost 数值');

const linked = e('linked', 'Vue 迁移决策', {
  entities: [{ name: 'React', type: 'PRODUCT', canonical: 'react' }],
  links: [{ target: 'seed', type: 'semantic', weight: 0.7 }, { target: 'seed', type: 'caused_by', weight: 0.4 }],
});
const graph = linkExpansionRank([seed, linked], [{ id: 'seed', entry: seed, score: 1 }]);
assert.equal(graph[0].id, 'linked');
assert.ok(Math.abs(graph[0].score - (Math.tanh(0.5) + 0.7 + 0.4)) < 1e-12);
console.log('✓ link expansion=tanh(shared/2)+semantic+causal');

const temporalEntries = [
  e('direct', '窗口内事实', { occurredStart: '2026-11-03T00:00:00Z', occurredEnd: '2026-11-04T00:00:00Z', links: [{ target: 'neighbor', type: 'caused_by', weight: 1 }] }),
  e('neighbor', '窗口外因果邻居', { occurredStart: '2025-01-01T00:00:00Z' }),
  e('outside', '无关联旧事实', { occurredStart: '2025-01-01T00:00:00Z' }),
];
const temporal = temporalRank(temporalEntries, lastWeek, { now });
assert.ok(temporal.some(x => x.id === 'direct'));
assert.ok(temporal.some(x => x.id === 'neighbor'), '因果邻居应沿时间臂传播');
assert.ok(!temporal.some(x => x.id === 'outside'));
const propagated = propagateTemporal(temporalEntries, [{ id: 'direct', score: 1 }]);
assert.ok(propagated.get('neighbor') > 1, 'caused_by relationBoost=2 后可超过1，temporalRank 再封顶');
console.log('✓ 时间窗/时间桶/因果传播');

const packed = packBudget([
  { entry: { text: '首' } },
  { entry: { text: '第二条超长会被跳过第二条超长会被跳过' } },
  { entry: { text: '短' } },
], { maxTokens: 5 });
assert.equal(packed.length, 2);
assert.equal(packed[1].entry.text, '短');
assert.equal(packBudget([{ entry: { text: '第一条本身已经超出全部预算第一条本身已经超出全部预算' } }, { entry: { text: '短' } }], { maxTokens: 2 }).length, 1);
console.log('✓ token 预算跳过超长项且首条兜底');

const all = [
  seed,
  linked,
  e('other-bank', 'React 在其他 bank', { bank: 'secret', embedding: [1, 0] }),
];
const full = searchMemories(all, 'React 最近7天', { now, queryEmbedding: [1, 0], limit: 10 });
assert.ok(full.armStats.semantic > 0);
assert.ok(full.armStats.keyword > 0);
assert.ok(full.armStats.graph > 0);
assert.ok(full.armStats.temporal > 0);
assert.ok(full.results.every(x => x.entry.bank === 'default'));
const noSemantic = searchMemories(all, 'React', { now, limit: 5 });
assert.ok(noSemantic.disabledArms.includes('semantic'));
assert.ok(noSemantic.disabledArms.includes('graph'));
console.log('✓ searchMemories 四臂融合/严格 bank/未配置臂显式 disabled');
