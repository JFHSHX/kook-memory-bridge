import assert from 'node:assert/strict';
import { DEFAULT_BANK_CONFIG, validateBankConfig, makeBankConfigUnit, resolveBankConfig, bankMemories, makeDirectiveUnit, activeDirectives } from '../lib/banks.js';
import { prepareDocument, chunkText, makeDocumentRecord } from '../lib/documents.js';

const base = { disposition: { skepticism: 5, literalism: 2, empathy: 4 }, biasStrength: 0.8, retainExtractionMode: 'verbose' };
const valid = validateBankConfig(base);
assert.equal(valid.disposition.skepticism, 5);
assert.equal(valid.retainMission, DEFAULT_BANK_CONFIG.retainMission);
assert.throws(() => validateBankConfig({ disposition: { skepticism: 0 } }), /1–5/);
assert.throws(() => validateBankConfig({ retainExtractionMode: 'bad' }), /未知/);
const old = makeBankConfigUnit('project', valid, 1000);
const latest = makeBankConfigUnit('project', { ...valid, biasStrength: 0.2 }, 2000);
assert.equal(resolveBankConfig([old, latest], 'project').biasStrength, 0.2);
assert.equal(resolveBankConfig([old, latest], 'other').biasStrength, 0.5);
console.log('✓ bank 配置/disposition/mission/最新值与默认值');

const rows = [
  { bank: 'a', kind: 'memory', factType: 'world', text: 'A' },
  { bank: 'b', kind: 'memory', factType: 'world', text: 'B' },
  { bank: 'a', kind: 'observation', factType: 'observation', text: 'AO' },
  { bank: 'a', kind: 'mental_model', factType: 'world', text: 'AM' },
];
assert.deepEqual(bankMemories(rows, 'a').map(e => e.text), ['A', 'AO']);
assert.deepEqual(bankMemories(rows, 'a', { kinds: ['memory'] }).map(e => e.text), ['A']);
assert.deepEqual(bankMemories(rows, 'b').map(e => e.text), ['B']);
console.log('✓ 严格 bank 隔离与 system unit 排除');

const directives = [
  makeDirectiveUnit({ bank: 'a', text: '低优先', priority: 200 }),
  makeDirectiveUnit({ bank: 'a', text: '高优先', priority: 10 }),
  makeDirectiveUnit({ bank: 'a', text: '关闭', enabled: false }),
];
assert.deepEqual(activeDirectives(directives, 'a').map(e => e.text), ['高优先', '低优先']);
console.log('✓ directives 优先级和启用状态');

const long = Array.from({ length: 120 }, (_, i) => `第 ${i} 句。这是用于切块的中文内容，包含完整语义边界。`).join('\n');
const chunks = chunkText(long, { maxChars: 500, overlap: 50 });
assert.ok(chunks.length > 3);
for (const c of chunks) {
  assert.ok(c.text.length <= 500);
  assert.equal(long.slice(c.start, c.end), c.text);
}
const doc = prepareDocument(long, { chunkSize: 500, overlap: 50 });
assert.equal(doc.chunks.length, chunks.length);
assert.equal(doc.contentHash.length, 64);
assert.equal(makeDocumentRecord(doc, doc.chunks[0]).documentId, doc.documentId);
assert.equal(prepareDocument(long, { mode: 'verbatim' }).chunks.length, 1);
console.log(`✓ 文档 hash/稳定 id/${chunks.length} 块/边界/verbatim`);
