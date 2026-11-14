// Hindsight TEMPR 的零依赖检索内核。各臂独立排序，RRF 融合；graph 使用当前上游 link expansion。
const idOf = e => String(e?.id || e?.msgId || '');
const timeOf = e => {
  const parsed = Date.parse(e?.occurredStart || e?.mentionedAt || e?.occurredEnd || '');
  return Number.isFinite(parsed) ? parsed : Number(e?.ts || 0);
};
const clamp = (x, min = 0, max = 1) => Math.min(max, Math.max(min, x));
const ranked = items => items.map((item, i) => ({ ...item, rank: i + 1 }));

export function tokenize(input) {
  const text = String(input || '').toLocaleLowerCase();
  const out = [];
  for (const match of text.matchAll(/[a-z0-9_][a-z0-9_.+-]*|[\u3400-\u9fff]+/g)) {
    const part = match[0];
    if (/^[\u3400-\u9fff]+$/.test(part)) {
      if (part.length === 1) out.push(part);
      else {
        if (part.length <= 6) out.push(part);
        for (let i = 0; i + 2 <= part.length; i++) out.push(part.slice(i, i + 2));
      }
    } else out.push(part);
  }
  return out;
}

export function bm25Rank(entries, query, { k1 = 1.5, b = 0.75, limit = 60 } = {}) {
  const queryTerms = tokenize(query);
  if (!queryTerms.length) return [];
  const docs = entries.map(entry => ({ entry, tokens: tokenize(`${entry.text || ''} ${(entry.tags || []).join(' ')}`) }));
  const df = new Map();
  for (const doc of docs) for (const token of new Set(doc.tokens)) df.set(token, (df.get(token) || 0) + 1);
  const avg = docs.reduce((sum, doc) => sum + doc.tokens.length, 0) / Math.max(1, docs.length);
  const scored = [];
  for (const doc of docs) {
    const tf = new Map();
    for (const token of doc.tokens) tf.set(token, (tf.get(token) || 0) + 1);
    let score = 0;
    for (const term of new Set(queryTerms)) {
      const f = tf.get(term) || 0;
      if (!f) continue;
      const n = df.get(term) || 0;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * doc.tokens.length / Math.max(1, avg)));
    }
    if (score > 0) scored.push({ id: idOf(doc.entry), entry: doc.entry, score });
  }
  return ranked(scored.sort((a, b) => b.score - a.score)).slice(0, limit);
}

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

export function semanticRank(entries, queryEmbedding, { getEmbedding = e => e.embedding, threshold = 0.3, limit = 60 } = {}) {
  if (!Array.isArray(queryEmbedding)) return [];
  const scored = [];
  for (const entry of entries) {
    const vector = getEmbedding(entry);
    const score = cosineSimilarity(queryEmbedding, vector);
    if (score >= threshold) scored.push({ id: idOf(entry), entry, score });
  }
  return ranked(scored.sort((a, b) => b.score - a.score)).slice(0, limit);
}

const day = ts => { const d = new Date(ts); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
const iso = ts => new Date(ts).toISOString();

/** 明确支持的轻量子集，不冒充上游 dateparser/T5。 */
export function parseTemporalQuery(query, { now = Date.now() } = {}) {
  const text = String(query || '');
  const today = day(now);
  const range = text.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2})\s*(?:到|至|~|\.\.)\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})/);
  if (range) {
    const start = day(Date.parse(range[1].replaceAll('/', '-')));
    const end = day(Date.parse(range[2].replaceAll('/', '-'))) + 86400000;
    return { start: iso(Math.min(start, end - 86400000)), end: iso(Math.max(start, end - 86400000) + 86400000), source: 'explicit-range' };
  }
  const single = text.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?/);
  if (single) {
    const start = Date.UTC(Number(single[1]), Number(single[2]) - 1, Number(single[3]));
    if (/之后|以后|以来|起/.test(text)) return { start: iso(start), end: iso(today + 86400000), source: 'since' };
    if (/之前|以前/.test(text)) return { start: iso(0), end: iso(start + 86400000), source: 'before' };
    return { start: iso(start), end: iso(start + 86400000), source: 'date' };
  }
  const recent = text.match(/最近\s*(\d+)\s*(天|日|周|星期|个月|月|年)/);
  if (recent) {
    const unit = { 天: 1, 日: 1, 周: 7, 星期: 7, 个月: 30, 月: 30, 年: 365 }[recent[2]];
    return { start: iso(today - (Number(recent[1]) * unit - 1) * 86400000), end: iso(today + 86400000), source: 'recent' };
  }
  if (/最近|近期/.test(text)) return { start: iso(today - 6 * 86400000), end: iso(today + 86400000), source: 'recent-default' };
  if (/前天/.test(text)) return { start: iso(today - 2 * 86400000), end: iso(today - 86400000), source: 'relative-day' };
  if (/昨天/.test(text)) return { start: iso(today - 86400000), end: iso(today), source: 'relative-day' };
  if (/今天|今日/.test(text)) return { start: iso(today), end: iso(today + 86400000), source: 'relative-day' };
  const date = new Date(now);
  const weekday = (date.getUTCDay() + 6) % 7;
  if (/上周|上个星期/.test(text)) {
    const end = today - weekday * 86400000;
    return { start: iso(end - 7 * 86400000), end: iso(end), source: 'last-week' };
  }
  if (/本周|这周|本星期/.test(text)) {
    const start = today - weekday * 86400000;
    return { start: iso(start), end: iso(start + 7 * 86400000), source: 'this-week' };
  }
  if (/上月|上个月/.test(text)) {
    const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1);
    const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    return { start: iso(start), end: iso(end), source: 'last-month' };
  }
  if (/本月|这个月/.test(text)) {
    const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    return { start: iso(start), end: iso(end), source: 'this-month' };
  }
  if (/去年/.test(text)) {
    const start = Date.UTC(date.getUTCFullYear() - 1, 0, 1);
    return { start: iso(start), end: iso(Date.UTC(date.getUTCFullYear(), 0, 1)), source: 'last-year' };
  }
  if (/今年/.test(text)) {
    const start = Date.UTC(date.getUTCFullYear(), 0, 1);
    return { start: iso(start), end: iso(Date.UTC(date.getUTCFullYear() + 1, 0, 1)), source: 'this-year' };
  }
  return null;
}

function normalizeWindow(window) {
  if (!window) return null;
  const start = Date.parse(window.start || window[0]);
  const end = Date.parse(window.end || window[1]);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? { start, end } : null;
}

function diversifyTemporal(items, window, { buckets = 8, limit = 60 } = {}) {
  const groups = Array.from({ length: buckets }, () => []);
  const span = Math.max(1, window.end - window.start);
  for (const item of items) {
    const index = Math.min(buckets - 1, Math.max(0, Math.floor((timeOf(item.entry) - window.start) / span * buckets)));
    groups[index].push(item);
  }
  const out = [];
  while (out.length < Math.min(limit, items.length)) {
    let added = false;
    for (const group of groups) if (group.length && out.length < limit) { out.push(group.shift()); added = true; }
    if (!added) break;
  }
  return out;
}

export function propagateTemporal(entries, seeds, { decay = 0.7, iterations = 5 } = {}) {
  const byId = new Map(entries.map(e => [idOf(e), e]));
  const scores = new Map(seeds.map(s => [s.id, s.score]));
  let frontier = new Set(scores.keys());
  const boosts = { causes: 2, caused_by: 2, enables: 1.5, prevents: 1.5 };
  for (let round = 0; round < iterations; round++) {
    const next = new Set();
    for (const id of frontier) {
      const entry = byId.get(id);
      const parent = scores.get(id) || 0;
      const links = (entry?.links || []).filter(link => ['temporal', 'causes', 'caused_by', 'enables', 'prevents'].includes(link.type));
      for (const link of links) {
        const target = String(link.target);
        if (!byId.has(target)) continue;
        const score = parent * (link.weight ?? 1) * (boosts[link.type] || 1) * decay;
        if (score > (scores.get(target) || 0)) { scores.set(target, score); next.add(target); }
      }
    }
    if (!next.size) break;
    frontier = next;
  }
  return scores;
}

export function temporalRank(entries, inputWindow, { now = Date.now(), limit = 60, buckets = 8 } = {}) {
  const window = normalizeWindow(inputWindow);
  if (!window) return [];
  const direct = [];
  for (const entry of entries) {
    const effective = timeOf(entry);
    const start = Date.parse(entry.occurredStart || '') || effective;
    const end = Date.parse(entry.occurredEnd || '') || start;
    if (start > window.end || end < window.start) continue;
    const center = (window.start + window.end) / 2;
    const half = Math.max(1, (window.end - window.start) / 2);
    const proximity = window.end === window.start ? 1 : clamp(1 - Math.abs(effective - center) / half);
    direct.push({ id: idOf(entry), entry, score: proximity });
  }
  direct.sort((a, b) => b.score - a.score);
  const diversified = diversifyTemporal(direct, window, { buckets, limit });
  const propagated = propagateTemporal(entries, diversified, { iterations: 5 });
  const merged = entries.map(entry => {
    const id = idOf(entry);
    return propagated.has(id) ? { id, entry, score: propagated.get(id) } : null;
  }).filter(Boolean).sort((a, b) => b.score - a.score);
  return ranked(merged).slice(0, limit);
}

function entitySet(entry, byId) {
  const out = new Set((entry.entities || []).map(e => `${e.type || 'OTHER'}:${e.canonical || String(e.name || e).toLocaleLowerCase()}`));
  for (const sourceId of entry.sourceMemoryIds || []) {
    for (const entity of byId.get(String(sourceId))?.entities || []) out.add(`${entity.type || 'OTHER'}:${entity.canonical || String(entity.name || entity).toLocaleLowerCase()}`);
  }
  return out;
}

/** 当前上游图臂：semantic seeds 的共享实体 + semantic/causal 链接扩展，分数 0..3。 */
export function linkExpansionRank(entries, seeds, { limit = 60 } = {}) {
  const byId = new Map(entries.map(e => [idOf(e), e]));
  const seedIds = new Set(seeds.map(s => s.id));
  const seedEntities = new Set();
  for (const seed of seeds) for (const entity of entitySet(seed.entry || byId.get(seed.id) || {}, byId)) seedEntities.add(entity);
  const results = [];
  for (const candidate of entries) {
    const id = idOf(candidate);
    if (seedIds.has(id)) continue;
    const shared = [...entitySet(candidate, byId)].filter(e => seedEntities.has(e)).length;
    let semantic = 0;
    let causal = 0;
    const links = [...(candidate.links || [])];
    for (const seed of seeds) for (const link of seed.entry?.links || []) if (String(link.target) === id) links.push(link);
    for (const link of links) {
      if (!seedIds.has(String(link.target))) continue;
      if (link.type === 'semantic') semantic = Math.max(semantic, Number(link.weight ?? 1));
      if (['causes', 'caused_by', 'enables', 'prevents'].includes(link.type)) causal = Math.max(causal, Number(link.weight ?? 1));
    }
    const entityScore = Math.tanh(0.5 * shared);
    const score = entityScore + semantic + causal;
    if (score > 0) results.push({ id, entry: candidate, score, sharedEntities: shared });
  }
  return ranked(results.sort((a, b) => b.score - a.score)).slice(0, limit);
}

export function spreadActivation(entries, seeds, { decay = 0.7, iterations = 5, multipliers = {} } = {}) {
  const scores = new Map(seeds.map(s => [s.id, s.score]));
  const byId = new Map(entries.map(e => [idOf(e), e]));
  let frontier = new Set(scores.keys());
  for (let round = 0; round < iterations; round++) {
    const next = new Set();
    for (const id of frontier) for (const link of byId.get(id)?.links || []) {
      const score = (scores.get(id) || 0) * (link.weight ?? 1) * decay * (multipliers[link.type] || 1);
      if (score > (scores.get(String(link.target)) || 0)) { scores.set(String(link.target), score); next.add(String(link.target)); }
    }
    if (!next.size) break;
    frontier = next;
  }
  return scores;
}

export function rrfFusion(arms, { k = 60, limit = 300 } = {}) {
  const merged = new Map();
  for (const [arm, list] of Object.entries(arms || {})) {
    for (const [index, item] of (list || []).entries()) {
      const id = String(item.id);
      const rank = item.rank || index + 1;
      if (!merged.has(id)) merged.set(id, { id, entry: item.entry, rrf: 0, sources: {} });
      const target = merged.get(id);
      target.rrf += 1 / (k + rank);
      target.sources[arm] = { rank, score: item.score };
    }
  }
  const out = [...merged.values()].sort((a, b) => b.rrf - a.rrf).slice(0, limit);
  return out.map((item, i) => ({ ...item, rrfRank: i + 1 }));
}

export const rrfFallbackScore = (index, count) => 1 - 0.9 * index / Math.max(1, count - 1);
const sigmoid = x => 1 / (1 + Math.exp(-x));

export function applyBoosts(results, { rerankScores, now = Date.now() } = {}) {
  const external = Array.isArray(rerankScores) ? rerankScores : null;
  const rawAllUnit = external?.length && external.every(x => x >= 0 && x <= 1);
  return results.map((item, index) => {
    let base;
    if (external && index < external.length) base = rawAllUnit ? external[index] : sigmoid(external[index]);
    else if (rerankScores && !Array.isArray(rerankScores) && rerankScores[item.id] !== undefined) base = rerankScores[item.id];
    else base = rrfFallbackScore(index, results.length);
    const timestamp = timeOf(item.entry);
    const recency = timestamp ? clamp(1 - Math.max(0, now - timestamp) / 86400000 / 365, 0.1, 1) : 0.5;
    const temporal = item.sources.temporal?.score ?? 0.5;
    const proofCount = Math.max(1, Number(item.entry.proofCount || item.entry.proof_count || 1));
    const proof = clamp(0.5 + Math.log(proofCount) / 10);
    const recencyBoost = 1 + 0.2 * (recency - 0.5);
    const temporalBoost = 1 + 0.2 * (temporal - 0.5);
    const proofBoost = 1 + 0.1 * (proof - 0.5);
    return { ...item, base, recency, temporal, proof, finalScore: base * recencyBoost * temporalBoost * proofBoost };
  }).sort((a, b) => b.finalScore - a.finalScore);
}

export function estimateTokens(value) {
  let units = 0;
  for (const char of String(value || '')) units += char.codePointAt(0) < 128 ? 0.25 : 0.75;
  return Math.max(1, Math.ceil(units));
}

export function packBudget(results, { maxTokens = 4096, getText = item => item.entry.text } = {}) {
  const out = [];
  let used = 0;
  for (const item of results) {
    const tokens = estimateTokens(getText(item));
    if (!out.length) { out.push({ ...item, tokens }); used += tokens; continue; }
    if (used + tokens > maxTokens) continue;
    out.push({ ...item, tokens });
    used += tokens;
  }
  return out;
}

export function searchMemories(entries, query, options = {}) {
  const {
    bank = 'default', factTypes, kinds = ['memory', 'observation'], now = Date.now(), candidateLimit = 300,
    limit = 10, maxTokens = 4096, queryEmbedding, getEmbedding = e => e.embedding,
    rerankScores, window,
  } = options;
  const kindSet = new Set(kinds);
  const typeSet = factTypes ? new Set(Array.isArray(factTypes) ? factTypes : [factTypes]) : null;
  const filtered = entries.filter(e => (!bank || e.bank === bank) && kindSet.has(e.kind || 'memory') && (!typeSet || typeSet.has(e.factType)));
  const keyword = tokenize(query).length ? bm25Rank(filtered, query, { limit: candidateLimit })
    : ranked(filtered.map(entry => ({ id: idOf(entry), entry, score: 1 })).sort((a, b) => timeOf(b.entry) - timeOf(a.entry))).slice(0, candidateLimit);
  const semantic = Array.isArray(queryEmbedding) ? semanticRank(filtered, queryEmbedding, { getEmbedding, limit: candidateLimit }) : [];
  const queryWindow = normalizeWindow(window) || parseTemporalQuery(query, { now });
  const temporal = queryWindow ? temporalRank(filtered, queryWindow, { now, limit: candidateLimit }) : [];
  const graph = semantic.length ? linkExpansionRank(filtered, semantic.slice(0, 10), { limit: candidateLimit }) : [];
  const fused = rrfFusion({ semantic, keyword, graph, temporal }, { limit: candidateLimit });
  const boosted = applyBoosts(fused, { rerankScores, now });
  const results = packBudget(boosted, { maxTokens }).slice(0, Math.max(limit, 1));
  return {
    results, candidates: fused.length, candidateResults: fused, queryWindow,
    armStats: { semantic: semantic.length, keyword: keyword.length, graph: graph.length, temporal: temporal.length },
    disabledArms: [semantic.length ? null : 'semantic', graph.length ? null : 'graph', temporal.length ? null : 'temporal'].filter(Boolean),
  };
}
