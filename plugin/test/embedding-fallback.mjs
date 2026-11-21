import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { searchKookMemory } from '../lib/search.js';
import { normalizeUnit } from '../lib/units.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kook-embedding-fallback-'));
const memory = { ...normalizeUnit({ kind: 'memory', factType: 'world', text: '用户偏好 Vue', tags: ['#fact'] }), id: 'm1', msgId: 'm1' };
fs.writeFileSync(path.join(dir, 'index.jsonl'), JSON.stringify(memory) + '\n');
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: false, status: 502, text: async () => 'upstream rejected' });
try {
  const result = await searchKookMemory({ embeddingProvider: 'openai-compatible', embeddingBaseURL: 'https://mock.test/v1', embeddingModel: 'mock', embeddingApiKey: 'test' }, dir, { query: 'Vue', bank: 'default' });
  assert.equal(result.embedding, 'disabled');
  assert.ok(result.note.includes('embedding 失败'));
  assert.ok(result.results.some(item => item.entry.id === 'm1'));
  console.log('✓ embedding 上游失败时降级关键词/RRF 并保留错误说明');
} finally { globalThis.fetch = originalFetch; fs.rmSync(dir, { recursive: true, force: true }); }