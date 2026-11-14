import path from 'node:path';
import { readMemory } from './core.js';
import { searchMemories, applyBoosts, packBudget } from './retrieval.js';
import { createEmbeddingProvider, createReranker, embedWithCache, embeddingInput } from './embeddings.js';

/** 完整搜索管线：可重建向量缓存 → TEMPR → 可选 rerank → 失败 RRF 回退。 */
export async function searchKookMemory(cfg, dir, args = {}) {
  const bank = args.bank || 'default';
  const limit = Math.max(1, Math.min(50, Number(args.limit) || 8));
  const maxTokens = Number(args.maxTokens || 4096);
  const candidateLimit = Math.max(limit, Math.min(300, Number(args.candidateLimit) || 300));
  let entries = readMemory(dir).filter(e => e.bank === bank);
  const providerName = cfg.embeddingProvider || 'none';
  let queryEmbedding;
  let embedding = 'disabled';
  if (providerName !== 'none' && String(args.query || '').trim()) {
    const provider = createEmbeddingProvider(cfg);
    const vectors = await embedWithCache(entries, provider, path.join(dir, 'vectors.json'));
    entries = entries.map((entry, i) => ({ ...entry, embedding: vectors[i] }));
    queryEmbedding = await provider.encodeQuery(args.query);
    embedding = provider.kind;
  }
  const base = await searchMemories(entries, args.query || '', {
    bank, factTypes: args.factTypes, kinds: args.kinds, now: args.now,
    queryEmbedding, candidateLimit, limit: candidateLimit, maxTokens: Number.MAX_SAFE_INTEGER,
    window: args.window,
  });
  let results = base.results;
  let rerankerName = 'rrf';
  let note = '';
  const reranker = createReranker(cfg);
  if (reranker && base.candidateResults.length && String(args.query || '').trim()) {
    try {
      const scores = await reranker.predict(base.candidateResults.map(item => [args.query, embeddingInput(item.entry)]));
      results = packBudget(applyBoosts(base.candidateResults, { rerankScores: scores, now: args.now }), { maxTokens }).slice(0, limit);
      rerankerName = reranker.kind;
    } catch (error) {
      note = `reranker 失败，已回退 RRF：${error?.message || error}`;
      results = packBudget(base.results, { maxTokens }).slice(0, limit);
    }
  } else {
    results = packBudget(base.results, { maxTokens }).slice(0, limit);
  }
  return { ...base, results, embedding, reranker: rerankerName, note };
}
