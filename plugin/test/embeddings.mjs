import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  localEmbed, cosineSimilarity, embeddingInput, serializeVector, deserializeVector,
  createEmbeddingProvider, embedWithCache, createReranker,
} from '../lib/embeddings.js';

const a = localEmbed('用户偏好 Vue');
assert.deepEqual(a, localEmbed('用户偏好 Vue'));
assert.notDeepEqual(a, localEmbed('完全不同的内容'));
assert.ok(Math.abs(cosineSimilarity(a, a) - 1) < 1e-12);
assert.ok(Math.abs(serializeVector(a).length > 0));
const restored = deserializeVector(serializeVector(a));
assert.equal(restored.length, a.length);
assert.ok(Math.abs(cosineSimilarity(a, restored) - 1) < 1e-5);
assert.ok(embeddingInput({ text: '迁移', occurredStart: '2026-11-01' }).startsWith('时间：2026-11-01'));
console.log('✓ lexical-hash 确定性/归一化/时间增强/序列化');

const calls = [];
const fetchMock = async (url, options) => {
  calls.push({ url, options });
  const input = JSON.parse(options.body).input;
  return {
    ok: true,
    json: async () => ({ data: input.map((text, index) => ({ index, embedding: [text.length, 1, 0] })) }),
  };
};
const provider = createEmbeddingProvider({
  embeddingProvider: 'openai-compatible', embeddingBaseURL: 'https://mock.test/v1',
  embeddingModel: 'mock-embed', embeddingApiKey: 'test-only',
}, { fetch: fetchMock, env: {} });
const vector = await provider.encodeQuery('abc');
assert.deepEqual(vector, [3, 1, 0]);
assert.equal(calls[0].url, 'https://mock.test/v1/embeddings');
assert.equal(JSON.parse(calls[0].options.body).input_type, undefined);
assert.throws(() => createEmbeddingProvider({ embeddingProvider: 'openai', embeddingBaseURL: 'https://x' }, { env: {} }), /缺少 API key/);
console.log('✓ OpenAI embeddings 请求/维度/缺 key 可行动错误');

const asymmetric = createEmbeddingProvider({
  embeddingProvider: 'openai-compatible', embeddingBaseURL: 'https://mock.test/v1',
  embeddingModel: 'nvidia/nemotron-3.5-embed-8b', embeddingApiKey: 'test-only',
  embeddingQueryInputType: 'query', embeddingDocumentInputType: 'passage',
}, { fetch: fetchMock, env: {} });
await asymmetric.encodeQuery('query');
assert.equal(JSON.parse(calls.at(-1).options.body).input_type, 'query');
await asymmetric.encodeDocuments([{ text: 'document' }]);
assert.equal(JSON.parse(calls.at(-1).options.body).input_type, 'passage');
console.log('✓ NVIDIA 非对称 embeddings：query/passage input_type，默认请求保持兼容');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kook-vector-cache-'));
const file = path.join(dir, 'vectors.json');
const entries = [{ text: '缓存向量' }, { text: '缓存向量' }];
const first = await embedWithCache(entries, provider, file);
const before = calls.length;
const second = await embedWithCache(entries, provider, file);
assert.equal(calls.length, before, '第二次全部命中缓存');
assert.deepEqual(first, second);
assert.ok(fs.existsSync(file));
console.log('✓ 向量缓存按内容哈希命中，可删除重算');

const reranker = createReranker({ rerankerProvider: 'tei', rerankerBaseURL: 'https://rerank.test' }, {
  env: {},
  fetch: async () => ({ ok: true, json: async () => [{ index: 1, score: 0.9 }, { index: 0, score: 0.2 }] }),
});
assert.deepEqual(await reranker.predict([['q', 'a'], ['q', 'b']]), [0.2, 0.9]);
assert.equal(createReranker({ rerankerProvider: 'none' }), null);
console.log('✓ TEI rerank 与未配置回退');
