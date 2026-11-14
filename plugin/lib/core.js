import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createCipheriv, createDecipheriv, randomBytes, scryptSync,
} from 'node:crypto';
import { encodeUnit, decodeUnit, normalizeUnit } from './units.js';
import { applyDefense } from './defense.js';

export const MAX_TEXT = 3500;
export const API_BASE = 'https://www.kookapp.cn/api/v3';
const PREFIX = 'kmb1:';

export function resolveDataDir(config = {}) {
  const dir = config.dataDir || process.env.KOOK_MEMORY_HOME
    || path.join(os.homedir(), '.dsh', 'kook-memory');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}

export function loadConfig(config, dir) {
  const file = path.join(dir, 'config.json');
  const local = readJson(file, {});
  const cfg = { ...config, ...local };
  if (!cfg.key && !cfg.passphrase) {
    local.key = randomBytes(32).toString('hex');
    local.createdAt ||= new Date().toISOString();
    writeJson(file, local);
    cfg.key = local.key;
  }
  if (cfg.passphrase && !cfg.kdfSalt) {
    local.kdfSalt = randomBytes(16).toString('hex');
    writeJson(file, local);
    cfg.kdfSalt = local.kdfSalt;
  }
  return cfg;
}

export function readState(dir) { return readJson(path.join(dir, 'state.json'), {}); }
export function writeState(dir, state) { writeJson(path.join(dir, 'state.json'), state); }

export function resolveToken(cfg) {
  const token = cfg.botToken || process.env.KOOK_BOT_TOKEN || '';
  if (!token) throw new Error('未配置 KOOK botToken：填入 ~/.dsh/kook-memory/config.json，或设置 KOOK_BOT_TOKEN');
  return token;
}

export function resolveChannel(cfg, state) {
  return String(cfg.channelId || process.env.KOOK_CHANNEL_ID || state.channelId || '');
}

export function requireChannel(cfg, state) {
  const channelId = resolveChannel(cfg, state);
  if (!channelId) throw new Error('尚未确定 KOOK 文字频道：先运行 kook_status 自动发现，或在 config.json 填 channelId');
  return channelId;
}

export function resolveKey(cfg) {
  if (cfg.passphrase) {
    if (!cfg.kdfSalt) throw new Error('passphrase 模式缺少 kdfSalt；重载插件后会自动补齐');
    return scryptSync(String(cfg.passphrase), Buffer.from(cfg.kdfSalt, 'hex'), 32,
      { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  }
  const key = Buffer.from(String(cfg.key || ''), 'hex');
  if (key.length !== 32) throw new Error('KOOK 记忆密钥必须是 64 位 hex（32 字节）');
  return key;
}

function encryptPayload(text, key, prefix) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return prefix + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

export function encryptBody(text, key) { return encryptPayload(text, key, PREFIX); }
export function encryptUnit(unit, key) { return encryptPayload(encodeUnit(unit), key, 'kmb2:'); }

export function decryptBody(blob, key) {
  const text = String(blob);
  const prefix = text.startsWith('kmb2:') ? 'kmb2:' : (text.startsWith(PREFIX) ? PREFIX : '');
  if (!prefix) throw new Error('不是 kmb1/kmb2 密文');
  const raw = Buffer.from(text.slice(prefix.length), 'base64');
  if (raw.length < 29) throw new Error('密文过短或已损坏');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

export function normalizeTags(tags) {
  const list = Array.isArray(tags) ? tags : (tags ? [tags] : []);
  const out = list.map(String).map(s => s.trim()).filter(Boolean)
    .map(s => s.startsWith('#') ? s : `#${s}`);
  return out.length ? [...new Set(out)] : ['#fact'];
}

export function dateOf(ts = Date.now()) { return new Date(ts).toISOString().slice(0, 10); }

// 新格式：元数据明文，正文密文。KOOK 客户端可直接按日期/标签浏览。
export function formatMemoryMessage(entry, text, key) {
  const date = entry.date || dateOf(entry.ts);
  const header = `[${date}] ${normalizeTags(entry.tags).join(' ')}`;
  return `${header}\n${encryptBody(text, key)}`;
}

export function formatUnitMessage(input, key) {
  const unit = normalizeUnit(input);
  const date = input.date || dateOf(unit.mentionedAt);
  return `[${date}] ${normalizeTags(unit.tags).join(' ')}\n${encryptUnit(unit, key)}`;
}

// 同时兼容早期“整条消息只有 kmb1 密文”的格式。
export function parseMemoryMessage(content, key) {
  const raw = String(content || '').trim();
  if (raw.startsWith(PREFIX)) return { date: '', tags: [], text: decryptBody(raw, key), legacy: true };
  const split = raw.indexOf('\n');
  const header = split >= 0 ? raw.slice(0, split) : '';
  const body = split >= 0 ? raw.slice(split + 1).trim() : '';
  const match = header.match(/^\[(\d{4}-\d{2}-\d{2})\]\s*(.*)$/);
  if (!match || !/^kmb[12]:/.test(body)) throw new Error('无法识别 KOOK 记忆消息格式');
  const plain = decryptBody(body, key);
  const structured = body.startsWith('kmb2:');
  const unit = structured ? decodeUnit(plain) : null;
  if (structured && !unit) throw new Error('kmb2 结构化载荷无效');
  const tags = normalizeTags((match[2].match(/#[^\s#]+/g) || []).join(' ').split(' '));
  return {
    date: match[1], tags, text: unit ? unit.text : plain,
    unit: unit ? { ...unit, tags } : null, legacy: false, structured,
  };
}

export async function kookCall(cfg, endpoint, { method = 'POST', body, query } = {}) {
  const token = resolveToken(cfg);
  const url = new URL(String(cfg.apiBase || API_BASE).replace(/\/$/, '') + endpoint);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, String(v));
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    throw new Error(`KOOK 网络请求失败（${endpoint}）：${error?.cause?.code || error?.message || error}`);
  }
  if (!res.ok) throw new Error(`KOOK HTTP ${res.status}（${endpoint}），请检查网络与 apiBase`);
  const json = await res.json();
  if (json.code !== 0) throw new Error(`KOOK code=${json.code} ${json.message || ''}（${endpoint}）`);
  return json.data;
}

export const kook = {
  me: cfg => kookCall(cfg, '/user/me', { method: 'GET' }),
  guilds: cfg => kookCall(cfg, '/guild/list', { method: 'GET', query: { page_size: 100 } }),
  channels: (cfg, guildId) => kookCall(cfg, '/channel/list', { method: 'GET', query: { guild_id: guildId } }),
  send: (cfg, channelId, content) => kookCall(cfg, '/message/create', {
    body: { type: 9, target_id: channelId, content },
  }),
  edit: (cfg, msgId, content) => kookCall(cfg, '/message/update', { body: { msg_id: msgId, content } }),
  del: (cfg, msgId) => kookCall(cfg, '/message/delete', { body: { msg_id: msgId } }),
  pin: (cfg, channelId, msgId) => kookCall(cfg, '/message/pin', { body: { msg_id: msgId, target_id: channelId } }),
  unpin: (cfg, channelId, msgId) => kookCall(cfg, '/message/unpin', { body: { msg_id: msgId, target_id: channelId } }),
  view: (cfg, msgId) => kookCall(cfg, '/message/view', { method: 'GET', query: { msg_id: msgId } }),
  list: (cfg, channelId, opts = {}) => kookCall(cfg, '/message/list', {
    method: 'GET',
    query: { target_id: channelId, page_size: opts.pageSize || 50, ...(opts.msgId ? { msg_id: opts.msgId, flag: opts.flag || 'before' } : {}) },
  }),
};

export function readMemory(dir) {
  const file = path.join(dir, 'index.jsonl');
  let rows = [];
  try {
    rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  } catch { rows = []; }
  return rows.map((e, i) => ({
    ...e,
    id: e.id || `legacy-${e.msgId || e.message_id || i}`,
    msgId: String(e.msgId || e.message_id || ''),
    ts: Number(e.ts || e.createdAt || Date.now()),
    tags: normalizeTags(e.tags),
    text: String(e.text || ''),
    date: e.date || dateOf(Number(e.ts || Date.now())),
    bank: e.bank || 'default', kind: e.kind || 'memory', factType: e.factType || e.fact_type || 'world',
    documentId: e.documentId || e.document_id || null,
    occurredStart: e.occurredStart || e.occurred_start || null,
    occurredEnd: e.occurredEnd || e.occurred_end || null,
    mentionedAt: e.mentionedAt || e.mentioned_at || null,
    entities: Array.isArray(e.entities) ? e.entities : [], links: Array.isArray(e.links) ? e.links : [],
    proofCount: Number(e.proofCount || e.proof_count || 1),
  }));
}

export function writeMemory(dir, rows) {
  const file = path.join(dir, 'index.jsonl');
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  fs.renameSync(tmp, file);
}

export function appendMemory(dir, entry) {
  fs.appendFileSync(path.join(dir, 'index.jsonl'), JSON.stringify(entry) + '\n');
}

export function cacheExists(dir) { return fs.existsSync(path.join(dir, 'index.jsonl')); }

/**
 * 从 KOOK 全量重建缓存。只有完整分页结束后才原子替换 index.jsonl；
 * 中途网络失败不会破坏旧缓存。id 永远等于 msgId，因此换机/重建后定位不变。
 */
export async function rebuildCache(cfg, dir, { pageSize = 50, maxPages = 200 } = {}) {
  const channelId = requireChannel(cfg, readState(dir));
  const key = resolveKey(cfg);
  const seen = new Map();
  let cursor = '';
  for (let page = 0; page < maxPages; page++) {
    const data = await kook.list(cfg, channelId, { pageSize, msgId: cursor, flag: 'before' });
    const items = Array.isArray(data?.items) ? data.items : [];
    for (const item of items) seen.set(String(item.id), item);
    if (items.length < pageSize) break;
    const oldest = items.reduce((a, b) => Number(a.create_at || 0) <= Number(b.create_at || 0) ? a : b);
    const next = String(oldest.id || '');
    if (!next || next === cursor) throw new Error('KOOK 历史分页游标未前进，重建已中止且旧缓存未改动');
    cursor = next;
    if (page === maxPages - 1) throw new Error(`历史超过 ${maxPages * pageSize} 条，重建已中止且旧缓存未改动`);
  }

  const rows = [];
  const errors = [];
  let nonMemory = 0;
  for (const item of seen.values()) {
    const content = String(item.content || '').trim();
    const looksMemory = content.startsWith('kmb1:') || /^\[\d{4}-\d{2}-\d{2}\][^\n]*\nkmb[12]:/.test(content);
    if (!looksMemory) { nonMemory++; continue; }
    const msgId = String(item.id);
    try {
      const parsed = parseMemoryMessage(content, key);
      const ts = Number(item.create_at || Date.now());
      rows.push({
        ...(parsed.unit || {}),
        id: msgId, msgId, ts,
        date: parsed.date || dateOf(ts),
        tags: parsed.legacy ? ['#fact'] : normalizeTags(parsed.tags),
        text: parsed.text,
        createdAt: new Date(ts).toISOString(),
      });
    } catch (error) {
      errors.push({ msgId, error: String(error?.message || error).slice(0, 160) });
    }
  }
  rows.sort((a, b) => a.ts - b.ts || a.msgId.localeCompare(b.msgId));
  writeMemory(dir, rows);
  const state = readState(dir);
  writeState(dir, { ...state, channelId, lastRebuildAt: new Date().toISOString(), cacheCount: rows.length });
  diag(dir, 'rebuild', { scanned: seen.size, imported: rows.length, failed: errors.length });
  return {
    ok: true, channelId, scanned: seen.size, imported: rows.length,
    non_memory: nonMemory, failed: errors.length, errors: errors.slice(0, 10),
    cache: path.join(dir, 'index.jsonl'),
  };
}

export function scoreEntry(entry, terms, tagFilters, now = Date.now()) {
  const tags = (entry.tags || []).map(t => String(t).toLowerCase());
  if (tagFilters.length && !tagFilters.some(f => tags.some(t => t.includes(f)))) return -1;
  let base = 0.5;
  if (terms.length) {
    const hay = String(entry.text || '').toLowerCase();
    const matched = terms.filter(t => hay.includes(t)).length;
    if (!matched) return -1;
    base = 0.5 + 0.5 * (matched / terms.length);
  }
  const days = Math.max(0, (now - (entry.ts || now)) / 86400000);
  const recency = Math.min(1, Math.max(0.1, 1 - days / 365));
  const proof = Math.min(1, Math.max(0, 0.5 + Math.log(Math.max(1, entry.proofCount || entry.proof_count || 1)) / 10));
  return base * (1 + 0.2 * (recency - 0.5)) * (1 + 0.1 * (proof - 0.5));
}

function queryParts(query, tag) {
  const terms = [];
  const tagFilters = [];
  for (const raw of `${query || ''} ${tag || ''}`.toLowerCase().split(/\s+/)) {
    if (!raw) continue;
    if (raw.startsWith('#')) tagFilters.push(raw.replace(/^#+/, ''));
    else terms.push(raw);
  }
  return { terms, tagFilters };
}

export function recallMemory(dir, { query = '', tag = '', limit = 8, bank = '', factTypes, kinds = ['memory', 'observation'] } = {}) {
  const { terms, tagFilters } = queryParts(query, tag);
  const now = Date.now();
  const kindSet = new Set(kinds);
  const typeSet = factTypes ? new Set(Array.isArray(factTypes) ? factTypes : [factTypes]) : null;
  return readMemory(dir)
    .filter(e => (!bank || e.bank === bank) && kindSet.has(e.kind || 'memory') && (!typeSet || typeSet.has(e.factType)))
    .map(e => ({ e, score: scoreEntry(e, terms, tagFilters, now) }))
    .filter(x => x.score >= 0)
    .sort((a, b) => b.score - a.score || (b.e.ts || 0) - (a.e.ts || 0))
    .slice(0, Math.min(50, Math.max(1, Number(limit) || 8)))
    .map(x => x.e);
}

export function locateMemory(dir, args = {}) {
  const rows = readMemory(dir);
  if (args.id) {
    const target = rows.find(e => String(e.id) === String(args.id));
    if (!target) throw new Error(`找不到记忆 id=${args.id}；先用 kook_recall 查询`);
    return { target, msgId: target.msgId };
  }
  if (args.msgId) {
    return { target: rows.find(e => e.msgId === String(args.msgId)) || null, msgId: String(args.msgId) };
  }
  if (args.query && String(args.query).trim()) {
    const target = recallMemory(dir, { query: args.query, limit: 1 })[0];
    if (!target) throw new Error('没有命中任何记忆，未执行操作');
    return { target, msgId: target.msgId };
  }
  throw new Error('需要 id、msgId 或 query 之一；推荐先用 kook_recall 获取 id');
}

export function defenseApply(cfg, input) {
  const result = applyDefense(input, {
    action: cfg.defense === false ? 'allow' : (cfg.defense === 'block' ? 'block' : 'redact'),
    promptInjection: cfg.promptInjection || 'off',
  });
  return { ...result, hits: result.matchedTypes, auditHits: result.hits };
}

export function diag(dir, event, fields = {}) {
  try {
    const file = path.join(dir, 'diag.jsonl');
    if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) fs.writeFileSync(file, '');
    fs.appendFileSync(file, JSON.stringify({ ts: Date.now(), event, ...fields }) + '\n');
  } catch { /* 日志永不致命 */ }
}
