import assert from 'node:assert/strict';
import { normalizeUnit, encodeUnit, decodeUnit, documentIdFor, entityKey } from '../lib/units.js';
import { formatUnitMessage, parseMemoryMessage } from '../lib/core.js';

const key = Buffer.from('22'.repeat(32), 'hex');
const unit = normalizeUnit({
  bank: 'project', documentId: 'doc-1', text: '用户上周从 React 迁到 Vue',
  context: '前端技术选型', factType: 'world', tags: ['fact', '#frontend'],
  occurredStart: '2026-11-01', occurredEnd: '2026-11-08', mentionedAt: '2026-11-14T12:00:00Z',
  entities: [{ name: 'React', type: 'PRODUCT' }, 'react', { name: 'Vue', type: 'PRODUCT' }],
  links: [{ target: 'old-msg', type: 'caused_by', weight: 0.8 }],
  metadata: { harness: 'dsh' }, proofCount: 3, confidence: 0.9,
});
assert.equal(unit.occurredStart, '2026-11-01T00:00:00.000Z');
assert.equal(unit.occurredEnd, '2026-11-08T00:00:00.000Z');
assert.equal(unit.entities.length, 2, '实体 canonical 去重');
assert.equal(unit.eventDate, unit.occurredStart);
assert.equal(unit.links[0].type, 'caused_by');
assert.equal(unit.metadata.harness, 'dsh');
assert.equal(decodeUnit(encodeUnit(unit)).text, unit.text);
console.log('✓ MemoryUnit 双时间轴/实体/链接/证据/metadata 归一化与 codec');

const wire = formatUnitMessage({ ...unit, date: '2026-11-14' }, key);
assert.ok(wire.startsWith('[2026-11-14] #fact #frontend\nkmb2:'));
assert.ok(!wire.includes('React 迁到'));
const parsed = parseMemoryMessage(wire, key);
assert.equal(parsed.text, unit.text);
assert.equal(parsed.unit.bank, 'project');
assert.equal(parsed.unit.entities[0].name, 'React');
assert.equal(parsed.unit.links[0].target, 'old-msg');
assert.equal(parsed.unit.proofCount, 3);
assert.equal(parsed.unit.metadata.harness, 'dsh');
console.log('✓ kmb2 结构化密文 round-trip，元数据可随 KOOK 重建');

assert.throws(() => normalizeUnit({ text: '反向时间', occurredStart: '2026-11-08', occurredEnd: '2026-11-01' }), /不能早于/);
assert.throws(() => normalizeUnit({ text: '坏链接', links: [{ target: 'x', type: 'unknown' }] }), /不支持的链接/);
assert.equal(documentIdFor('abc'), documentIdFor('abc'));
assert.notEqual(documentIdFor('abc'), documentIdFor('abd'));
assert.equal(entityKey({ name: 'React', type: 'PRODUCT' }), 'PRODUCT:react');
console.log('✓ 校验、稳定文档 id、实体键');
