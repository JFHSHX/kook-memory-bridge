import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { tokenize, cosineSimilarity as cosine } from './retrieval.js';
import { resolveProviderKey } from './provider-credentials.js';

export { cosine as cosineSimilarity };
const hash = value => createHash('sha256').update(String(value), 'utf8').digest();
const unitLength = vector => Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0)) || 1;

/** 本地确定性 lexical hashing，不是神经语义 embedding；用于离线回退与测试。 */
export function localEmbed(input, { dimensions = 256 } = {}) {
  const dim = Math.max(16, Math.min(4096, Number(dimensions) || 256));
  const vector = Array(dim).fill(0);
  const terms = tokenize(input);
  for (const term of terms) {
    for (const suffix of ['', ':s'] ) {
      const digest = hash(`${suffix}${term}`);
      const index = digest.readUInt32BE(0) % dim;
      const sign = digest[4] & 1 ? 1 : -1;
      const weight = suffix ? 0.35 : 1;
      vector[index] += sign * weight;
    }
  }
  const length = unitLength(vector);
  return vector.map(x => x / length);
}

export function localEmbeddings(texts, options) { return texts.map(text => localEmbed(text, options)); }

export function embeddingInput(entry) {
  const text = typeof entry === 'string' ? entry : entry.text;
  if (typeof entry === 'string') return text;
  const start = entry.occurredStart ? new Date(entry.occurredStart).toISOString().slice(0, 10) : '';
  const end = entry.occurredEnd ? new Date(entry.occurredEnd).toISOString().slice(0, 10) : '';
  const time = start ? `时间：${start}${end && end !== start ? ` 至 ${end}` : ''}。` : '';
  return `${time}${text}`;
}

export function serializeVector(vector) {
  const floats = Float32Array.from(vector);
  return Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength).toString('base64');
}
export function deserializeVector(encoded) {
  const buffer = Buffer.from(encoded, 'base64');
  if (buffer.byteLength % 4) throw new Error('向量缓存字节长度不是 Float32 的整数倍');
  return Array.from(new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4));
}

async function request(fetchImpl, url, { apiKey, body, timeoutMs = 30000, retries = 1 }) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const error = new Error(`模型服务 HTTP ${response.status}: ${text.slice(0, 160)}`);
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt >= retries || error.retryable === false) break;
    }
  }
  throw new Error(`模型服务调用失败：${lastError?.message || lastError}`);
}

export function createEmbeddingProvider(config = {}, { fetch: fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const provider = config.embeddingProvider || 'local';
  const dimensions = Number(config.embeddingDimensions || 256);
  if (provider === 'local' || provider === 'lexical-hash') {
    return {
      kind: 'lexical-hash', model: `lexical-hash-v1-${dimensions}`, dimensions,
      async encodeQuery(text) { return localEmbed(embeddingInput(text), { dimensions }); },
      async encodeDocuments(entries) { return entries.map(entry => localEmbed(embeddingInput(entry), { dimensions })); },
    };
  }
  if (!['openai', 'openai-compatible', 'remote'].includes(provider)) throw new Error(`未知 embeddingProvider: ${provider}`);
  const baseURL = String(config.embeddingBaseURL || config.llmBaseURL || '').replace(/\/$/, '');
  const model = config.embeddingModel || 'text-embedding-3-small';
  const apiKeyEnv = config.embeddingApiKeyEnv || 'OPENAI_API_KEY';
  if (!baseURL) throw new Error('远程 embedding 需要 embeddingBaseURL（OpenAI 兼容 /v1 地址）');
  const apiKey = resolveProviderKey({ env, name: apiKeyEnv, explicit: config.embeddingApiKey, allowCredentials: env === process.env });
  if (!apiKey) throw new Error(`远程 embedding 缺少 API key：设置 ${apiKeyEnv} 或改 embeddingProvider=local`);
  async function embed(entries, inputType) {
    const inputs = entries.map(embeddingInput);
    const json = await request(fetchImpl, `${baseURL}/embeddings`, {
      apiKey, body: { model, input: inputs, ...(inputType ? { input_type: inputType } : {}) }, retries: 1, timeoutMs: Number(config.embeddingTimeoutMs) || 30000,
    });
    if (!Array.isArray(json.data) || json.data.length !== inputs.length) throw new Error('embedding 返回数量与输入不一致');
    const vectors = json.data.sort((a, b) => a.index - b.index).map(item => item.embedding);
    const dim = vectors[0]?.length;
    if (!dim || vectors.some(v => !Array.isArray(v) || v.length !== dim || v.some(x => !Number.isFinite(x)))) {
      throw new Error('embedding 返回维度无效或不一致');
    }
    return vectors;
  }
  return {
    kind: 'openai-compatible', model, dimensions: config.embeddingDimensions || null,
    async encodeQuery(text) { return (await embed([text], config.embeddingQueryInputType || config.embeddingInputType || ''))[0]; },
    async encodeDocuments(entries) {
      const out = [];
      for (let i = 0; i < entries.length; i += 32) out.push(...await embed(entries.slice(i, i + 32), config.embeddingDocumentInputType || config.embeddingInputType || ''));
      return out;
    },
  };
}

export function readVectorCache(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { version: 1, entries: {} }; }
}
export function writeVectorCache(file, cache) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache));
  fs.renameSync(tmp, file);
}
export function vectorCacheKey(provider, entry) {
  return createHash('sha256').update(`${provider.kind}:${provider.model}:${embeddingInput(entry)}`).digest('hex');
}
export async function embedWithCache(entries, provider, file) {
  const cache = readVectorCache(file);
  const output = new Array(entries.length);
  const missing = [];
  for (let i = 0; i < entries.length; i++) {
    const key = vectorCacheKey(provider, entries[i]);
    if (cache.entries[key]) output[i] = deserializeVector(cache.entries[key]);
    else missing.push({ i, key, entry: entries[i] });
  }
  for (let i = 0; i < missing.length; i += 32) {
    const batch = missing.slice(i, i + 32);
    const vectors = await provider.encodeDocuments(batch.map(x => x.entry));
    for (let j = 0; j < batch.length; j++) {
      output[batch[j].i] = vectors[j];
      cache.entries[batch[j].key] = serializeVector(vectors[j]);
    }
  }
  if (missing.length) writeVectorCache(file, cache);
  return output;
}

export function createReranker(config = {}, { fetch: fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const provider = config.rerankerProvider || 'none';
  if (['none', 'off', 'local', 'rrf'].includes(provider)) return null;
  const baseURL = String(config.rerankerBaseURL || '').replace(/\/$/, '');
  const model = config.rerankerModel || 'rerank-v1';
  const apiKeyEnv = config.rerankerApiKeyEnv || 'RERANKER_API_KEY';
  const apiKey = config.rerankerApiKey || env[apiKeyEnv] || '';
  if (!baseURL) throw new Error('远程 reranker 需要 rerankerBaseURL');
  return {
    kind: provider, model,
    async predict(pairs) {
      if (!pairs.length) return [];
      const query = pairs[0][0];
      const documents = pairs.map(pair => pair[1]);
      const body = provider === 'tei'
        ? { query, texts: documents }
        : { model, query, documents, top_n: documents.length };
      const json = await request(fetchImpl, `${baseURL}/rerank`, { apiKey, body, retries: 1 });
      const rows = Array.isArray(json) ? json : (json.results || json.data || []);
      const scores = new Array(pairs.length).fill(0);
      for (const row of rows) {
        const index = Number(row.index);
        if (index >= 0 && index < scores.length) scores[index] = Number(row.score ?? row.relevance_score);
      }
      return scores;
    },
  };
}
