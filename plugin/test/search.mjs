import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { searchKookMemory } from '../lib/search.js';
import { normalizeUnit } from '../lib/units.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kook-search-test-'));
const rows = [
  { ...normalizeUnit({ text: '用户偏好 Vue 与 Vite', tags: ['#pref'], entities: [{ name: 'Vue', type: 'PRODUCT' }] }), id: 'a', msgId: 'a', ts: Date.now() },
  { ...normalizeUnit({ text: '用户上周使用 React 开发后台', tags: ['#exp'], occurredStart: '2026-11-01', entities: [{ name: 'React', type: 'PRODUCT' }] }), id: 'b', msgId: 'b', ts: Date.now() - 86400000 },
  { ...normalizeUnit({ bank: 'other', text: '其他 bank 的 Vue', tags: ['#pref'] }), id: 'c', msgId: 'c', ts: Date.now() },
];
fs.writeFileSync(path.join(dir, 'index.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');

const local = await searchKookMemory({ embeddingProvider: 'local', embeddingDimensions: 64 }, dir, { query: 'Vue', limit: 5 });
assert.equal(local.embedding, 'lexical-hash');
assert.ok(local.armStats.semantic > 0);
assert.ok(local.results.every(x => x.entry.bank === 'default'));
assert.ok(fs.existsSync(path.join(dir, 'vectors.json')));
console.log('✓ 显式 local embedding 开启语义臂，向量缓存落盘且 bank 隔离');

let rerankCalled = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async url => {
  if (String(url).includes('/rerank')) {
    rerankCalled++;
    return { ok: true, json: async () => [{ index: 0, score: 0.8 }, { index: 1, score: 0.9 }] };
  }
  return realFetch(url);
};
const reranked = await searchKookMemory({ embeddingProvider: 'local', rerankerProvider: 'tei', rerankerBaseURL: 'https://mock.rerank' }, dir, { query: 'Vue', limit: 2 });
assert.equal(rerankCalled, 1);
assert.equal(reranked.reranker, 'tei');
console.log('✓ 外部 reranker 真实进入管线');

globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => 'mock down' });
const fallback = await searchKookMemory({ embeddingProvider: 'local', rerankerProvider: 'tei', rerankerBaseURL: 'https://mock.rerank' }, dir, { query: 'Vue', limit: 2 });
assert.equal(fallback.reranker, 'rrf');
assert.ok(fallback.note.includes('回退 RRF'));
assert.ok(fallback.results.length > 0);
console.log('✓ reranker 故障明确回退 RRF，不丢结果');
globalThis.fetch = realFetch;
