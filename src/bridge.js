'use strict';
// 编排层：明文 → [Memory Defense 钩子] → AES-256-GCM 加密 → KOOK 群；本地索引留明文。
const crypto = require('./crypto');
const kookMod = require('./kook');
const store = require('./store');

// TODO: 接入 tg-memory-bridge 的 Memory Defense（30+ 类 redact）后再启用拦截
const defense = { check: (t) => ({ ok: true, text: t }) };

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function normalizeTags(tags) {
  const list = Array.isArray(tags) ? tags : (tags ? [tags] : []);
  const out = list.map(String).map(s => s.trim()).filter(Boolean)
    .map(s => s.startsWith('#') ? s : '#' + s);
  return out.length ? [...new Set(out)] : ['#fact'];
}

const dateOf = ts => new Date(Number(ts) || Date.now()).toISOString().slice(0, 10);

// 日期与标签明文，正文密文；兼容早期只有一行 kmb1 密文的消息。
function formatMessage(entry, text, key) {
  return '[' + (entry.date || dateOf(entry.ts)) + '] ' + normalizeTags(entry.tags).join(' ')
    + '\n' + crypto.encrypt(text, key);
}

function parseMessage(content, key) {
  const raw = String(content || '').trim();
  if (raw.startsWith('kmb1:')) return { date: '', tags: [], text: crypto.decrypt(raw, key), legacy: true };
  const at = raw.indexOf('\n');
  const header = at >= 0 ? raw.slice(0, at) : '';
  const body = at >= 0 ? raw.slice(at + 1).trim() : '';
  const match = header.match(/^\[(\d{4}-\d{2}-\d{2})\]\s*(.*)$/);
  if (!match || !body.startsWith('kmb1:')) throw new Error('无法识别 KOOK 记忆消息格式');
  return {
    date: match[1],
    tags: (match[2].match(/#[^\s#]+/g) || ['#fact']),
    text: crypto.decrypt(body, key),
    legacy: false,
  };
}

// 密钥解析：passphrase（scrypt 派生，优先）> 随机 key
function resolveKeyHex(cfg) {
  if (cfg.passphrase) {
    if (!cfg.kdfSalt) throw new Error('config 有 passphrase 但缺 kdfSalt；删掉 kdfSalt 字段重跑一次即可自动补齐');
    return crypto.deriveKeyHex(cfg.passphrase, cfg.kdfSalt, cfg.kdf);
  }
  if (cfg.key) return cfg.key;
  throw new Error('config 缺少 key 或 passphrase，无法解析密钥');
}

function createBridge(cfg) {
  const kook = kookMod.createKook(cfg);
  const key = crypto.keyFromHex(resolveKeyHex(cfg));

  return {
    async retain(text, tags = []) {
      const d = defense.check(text);
      const ts = Date.now();
      const normalized = normalizeTags(tags);
      const wire = formatMessage({ ts, date: dateOf(ts), tags: normalized }, d.text, key);
      const sent = await kook.send(wire);
      const entry = {
        id: newId(), msgId: sent.msgId, ts: sent.ts || ts, date: dateOf(ts), tags: normalized,
        text: d.text, createdAt: new Date(ts).toISOString(),
      };
      store.append(entry);
      return entry;
    },

    async edit(entryId, text) {
      const e = store.get(entryId);
      if (!e) throw new Error('找不到本地条目 ' + entryId);
      const d = defense.check(text);
      const next = { ...e, date: e.date || dateOf(e.ts), tags: normalizeTags(e.tags) };
      await kook.edit(e.msgId, formatMessage(next, d.text, key));
      return store.update(entryId, { text: d.text, date: next.date, tags: next.tags });
    },

    async forget(entryId) {
      const e = store.get(entryId);
      if (!e) throw new Error('找不到本地条目 ' + entryId);
      await kook.del(e.msgId);
      store.remove(entryId);
      return true;
    },

    async pin(entryId) {
      const e = store.get(entryId);
      if (!e) throw new Error('找不到本地条目 ' + entryId);
      await kook.pin(e.msgId);
      return true;
    },

    async unpin(entryId) {
      const e = store.get(entryId);
      if (!e) throw new Error('找不到本地条目 ' + entryId);
      await kook.unpin(e.msgId);
      return true;
    },

    recall: (kw) => store.recall(kw),
    // 人工核对用：解一条群上消息（新格式或旧全密文）
    peek: (content) => parseMessage(content, key).text,
  };
}

module.exports = { createBridge, defense, formatMessage, parseMessage, normalizeTags, dateOf };
