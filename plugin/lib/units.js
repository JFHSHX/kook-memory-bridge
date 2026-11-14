// Hindsight MemoryUnit 的 KOOK 可重建表示。
// 结构化对象整体位于 kmb2 密文内；向量不写入频道，属于可重算缓存。
export const UNIT_VERSION = 2;
export const FACT_TYPES = new Set(['world', 'experience', 'observation', 'opinion']);
export const UNIT_KINDS = new Set(['memory', 'observation', 'mental_model', 'directive', 'document', 'bank_config']);
export const LINK_TYPES = new Set(['temporal', 'semantic', 'entity', 'causes', 'caused_by', 'enables', 'prevents']);
const ENTITY_TYPES = new Set(['PERSON', 'ORG', 'LOCATION', 'PRODUCT', 'CONCEPT', 'OTHER']);

function iso(value, field, { nullable = true } = {}) {
  if (value === null || value === undefined || value === '') {
    if (nullable) return null;
    throw new Error(`${field} 不能为空`);
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${field} 不是有效日期: ${value}`);
  return date.toISOString();
}

function text(value, fallback = '') { return value === null || value === undefined ? fallback : String(value); }
function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function cleanTags(tags) {
  const list = Array.isArray(tags) ? tags : (tags ? [tags] : []);
  const out = list.map(String).map(s => s.trim()).filter(Boolean).map(s => s.startsWith('#') ? s : `#${s}`);
  return out.length ? [...new Set(out)] : ['#fact'];
}

export function normalizeEntity(entity) {
  const raw = typeof entity === 'string' ? { name: entity } : (entity || {});
  const name = text(raw.name || raw.canonical_name).trim();
  if (!name) throw new Error('实体 name 不能为空');
  const type = text(raw.type || 'OTHER').toUpperCase();
  return {
    name,
    canonical: text(raw.canonical || name).trim().toLocaleLowerCase(),
    type: ENTITY_TYPES.has(type) ? type : 'OTHER',
  };
}

export function normalizeLink(link) {
  const type = text(link?.type || link?.link_type || 'entity');
  if (!LINK_TYPES.has(type)) throw new Error(`不支持的链接类型: ${type}`);
  const target = text(link?.target || link?.to || link?.to_unit_id).trim();
  if (!target) throw new Error('链接 target 不能为空');
  return { target, type, weight: clamp(link?.weight, 0, 1, 1) };
}

/** 宽松输入 → 严格、可 JSON 序列化的 MemoryUnit。 */
export function normalizeUnit(input = {}) {
  const body = text(input.text).trim();
  if (!body) throw new Error('记忆 text 不能为空');
  const mentionedAt = iso(input.mentionedAt || input.mentioned_at || Date.now(), 'mentionedAt', { nullable: false });
  const occurredStart = iso(input.occurredStart || input.occurred_start, 'occurredStart');
  const occurredEnd = iso(input.occurredEnd || input.occurred_end, 'occurredEnd');
  if (occurredStart && occurredEnd && occurredEnd < occurredStart) {
    throw new Error('occurredEnd 不能早于 occurredStart');
  }
  const factType = text(input.factType || input.fact_type || 'world');
  if (!FACT_TYPES.has(factType)) throw new Error(`不支持的 factType: ${factType}`);
  const kind = text(input.kind || (factType === 'observation' ? 'observation' : 'memory'));
  if (!UNIT_KINDS.has(kind)) throw new Error(`不支持的 unit kind: ${kind}`);
  const entities = [];
  const entitySlots = new Map();
  for (const raw of Array.isArray(input.entities) ? input.entities : []) {
    const entity = normalizeEntity(raw);
    const existing = entitySlots.get(entity.canonical);
    if (existing === undefined) {
      entitySlots.set(entity.canonical, entities.length);
      entities.push(entity);
    } else if (entities[existing].type === 'OTHER' && entity.type !== 'OTHER') {
      entities[existing] = entity; // 同名实体合并，保留更明确的类型
    }
  }
  const links = [];
  const seenLinks = new Set();
  for (const raw of Array.isArray(input.links) ? input.links : []) {
    const link = normalizeLink(raw);
    const key = `${link.target}:${link.type}`;
    if (!seenLinks.has(key)) { seenLinks.add(key); links.push(link); }
  }
  let payload = null;
  if (input.payload !== undefined && input.payload !== null) {
    const serialized = JSON.stringify(input.payload);
    if (serialized === undefined) throw new Error('payload 必须可 JSON 序列化');
    if (Buffer.byteLength(serialized, 'utf8') > 65536) throw new Error('payload 超过 64 KiB');
    payload = JSON.parse(serialized);
  }
  const metadata = {};
  for (const [key, value] of Object.entries(input.metadata || input.unit_metadata || {})) {
    if (/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key) && ['string', 'number', 'boolean'].includes(typeof value)) {
      metadata[key] = value;
    }
  }
  return {
    v: UNIT_VERSION,
    kind,
    bank: text(input.bank || 'default').trim() || 'default',
    documentId: input.documentId || input.document_id ? text(input.documentId || input.document_id) : null,
    chunkId: input.chunkId || input.chunk_id ? text(input.chunkId || input.chunk_id) : null,
    text: body,
    context: text(input.context) || null,
    occurredStart,
    occurredEnd,
    mentionedAt,
    eventDate: occurredStart || mentionedAt,
    factType,
    tags: cleanTags(input.tags),
    entities,
    links,
    metadata,
    proofCount: Math.max(1, Math.floor(clamp(input.proofCount || input.proof_count, 1, 1000000, 1))),
    confidence: clamp(input.confidence, 0, 1, factType === 'opinion' ? 0.5 : 1),
    sourceMemoryIds: [...new Set((input.sourceMemoryIds || input.source_memory_ids || []).map(String).filter(Boolean))].slice(0, 1000),
    scope: input.scope === null || input.scope === undefined
      ? null
      : [...new Set((Array.isArray(input.scope) ? input.scope : [input.scope]).map(String))],
    modelId: input.modelId || input.model_id ? text(input.modelId || input.model_id) : null,
    question: input.question ? text(input.question) : null,
    contentHash: input.contentHash || input.content_hash ? text(input.contentHash || input.content_hash) : null,
    payload,
  };
}

export function encodeUnit(input) {
  return JSON.stringify(normalizeUnit(input));
}

export function decodeUnit(plain) {
  let value;
  try { value = JSON.parse(String(plain)); } catch { return null; }
  if (!value || Number(value.v) !== UNIT_VERSION || typeof value.text !== 'string') return null;
  return normalizeUnit(value);
}

export function isStructuredPlaintext(plain) { return decodeUnit(plain) !== null; }

/** 供召回/图扩展使用的稳定实体键与文档派生 id。 */
export function entityKey(entity) {
  const e = normalizeEntity(entity);
  return `${e.type}:${e.canonical}`;
}

export function documentIdFor(textValue, namespace = 'doc') {
  // 不使用密钥；只用于把同一输入的多个事实归组，不用于完整性安全证明。
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (const ch of String(textValue)) {
    const c = ch.codePointAt(0);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
  }
  return `${namespace}-${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}
