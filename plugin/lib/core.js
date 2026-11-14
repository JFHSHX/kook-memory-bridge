import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createCipheriv, createDecipheriv, randomBytes, scryptSync,
} from 'node:crypto';

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

export function encryptBody(text, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

export function decryptBody(blob, key) {
  const text = String(blob);
  if (!text.startsWith(PREFIX)) throw new Error('不是 kmb1 密文');
  const raw = Buffer.from(text.slice(PREFIX.length), 'base64');
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

// 同时兼容早期“整条消息只有 kmb1 密文”的格式。
export function parseMemoryMessage(content, key) {
  const raw = String(content || '').trim();
  if (raw.startsWith(PREFIX)) return { date: '', tags: [], text: decryptBody(raw, key), legacy: true };
  const split = raw.indexOf('\n');
  const header = split >= 0 ? raw.slice(0, split) : '';
  const body = split >= 0 ? raw.slice(split + 1).trim() : '';
  const match = header.match(/^\[(\d{4}-\d{2}-\d{2})\]\s*(.*)$/);
  if (!match || !body.startsWith(PREFIX)) throw new Error('无法识别 KOOK 记忆消息格式');
  return {
    date: match[1],
    tags: normalizeTags((match[2].match(/#[^\s#]+/g) || []).join(' ').split(' ')),
    text: decryptBody(body, key),
    legacy: false,
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
  const proof = Math.min(1, Math.max(0, 0.5 + Math.log(Math.max(1, entry.proof_count || 1)) / 10));
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

export function recallMemory(dir, { query = '', tag = '', limit = 8 } = {}) {
  const { terms, tagFilters } = queryParts(query, tag);
  const now = Date.now();
  return readMemory(dir).map(e => ({ e, score: scoreEntry(e, terms, tagFilters, now) }))
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

const A_START = '(?<![A-Za-z0-9_])';
const A_END = '(?![A-Za-z0-9_])';
const tok = body => new RegExp(A_START + body + A_END);
const SECRET_PATTERNS = [
  ['anthropic_key', tok('sk-ant-[A-Za-z0-9_-]{20,}')],
  ['openai_project_key', tok('sk-proj-[A-Za-z0-9_-]{48,}')],
  ['openai_admin_key', tok('sk-admin-[A-Za-z0-9_-]{40,}')],
  ['openai_key', tok('sk-[A-Za-z0-9_-]{20,}')],
  ['google_api_key', tok('AIza[0-9A-Za-z_-]{35}')],
  ['google_oauth', tok('ya29\\.[0-9A-Za-z_-]{20,}')],
  ['xai_key', tok('xai-[A-Za-z0-9]{20,}')],
  ['groq_key', tok('gsk_[A-Za-z0-9]{20,}')],
  ['huggingface_token', tok('hf_[A-Za-z0-9]{20,}')],
  ['replicate_token', tok('r8_[A-Za-z0-9]{20,}')],
  ['perplexity_key', tok('pplx-[A-Za-z0-9]{20,}')],
  ['databricks_token', tok('dapi[A-Za-z0-9]{32}')],
  ['aws_access_key', tok('A(?:KIA|SIA)[0-9A-Z]{16}')],
  ['digitalocean_token', tok('dop_v1_[0-9a-f]{64}')],
  ['github_pat', tok('github_pat_[A-Za-z0-9_]{22,}')],
  ['github_token', tok('gh[pousr]_[A-Za-z0-9]{36}')],
  ['gitlab_pat', tok('glpat-[A-Za-z0-9_-]{20,}')],
  ['npm_token', tok('npm_[A-Za-z0-9]{30,}')],
  ['pypi_token', tok('pypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{20,}')],
  ['stripe_key', tok('[sr]k_(?:live|test)_[0-9a-zA-Z]{20,}')],
  ['slack_token', tok('xox[abpr]-[0-9A-Za-z-]{10,}')],
  ['slack_webhook', /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]{20,}/],
  ['twilio_key', tok('S[KA][0-9a-fA-F]{32}')],
  ['sendgrid_key', tok('SG\\.[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43}')],
  ['mailgun_key', tok('key-[A-Za-z0-9]{32}')],
  ['discord_bot', tok('[MNO][A-Za-z0-9]{23}\\.[A-Za-z0-9_-]{6}\\.[A-Za-z0-9_-]{27}')],
  ['telegram_bot_token', tok('\\d{8,10}:[A-Za-z0-9_-]{35}')],
  ['kook_bot_token', /\d\/[A-Za-z0-9+/]{4,}={0,2}\/[A-Za-z0-9+/]{20,}={0,2}/],
  ['shopify_token', tok('shpat_[0-9a-fA-F]{32}')],
  ['db_connection_url', /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s:@]+:[^\s@]+@[^\s]*/],
  ['private_key_block', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY( BLOCK)?-----/],
  ['jwt', tok('eyJ[A-Za-z0-9_-]{10,}\\.eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}')],
  ['ssn_us', tok('\\d{3}-\\d{2}-\\d{4}')],
].map(([name, re]) => ({ name, re }));

export function defenseApply(cfg, input) {
  if (cfg.defense === false) return { text: String(input), hits: [] };
  let text = String(input);
  const hits = SECRET_PATTERNS.filter(p => p.re.test(text)).map(p => p.name);
  if (hits.length && cfg.defense === 'block') throw new Error(`疑似密钥/凭据（${hits.join(', ')}），已拦截`);
  for (const p of SECRET_PATTERNS) {
    if (hits.includes(p.name)) text = text.replace(new RegExp(p.re.source, 'g'), `[REDACTED:${p.name}]`);
  }
  return { text, hits };
}

export function diag(dir, event, fields = {}) {
  try {
    const file = path.join(dir, 'diag.jsonl');
    if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) fs.writeFileSync(file, '');
    fs.appendFileSync(file, JSON.stringify({ ts: Date.now(), event, ...fields }) + '\n');
  } catch { /* 日志永不致命 */ }
}
