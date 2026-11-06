'use strict';
// 编排层：明文 → [Memory Defense 钩子] → AES-256-GCM 加密 → KOOK 群；本地索引留明文。
const crypto = require('./crypto');
const kookMod = require('./kook');
const store = require('./store');

// TODO: 接入 tg-memory-bridge 的 Memory Defense（30+ 类 redact）后再启用拦截
const defense = { check: (t) => ({ ok: true, text: t }) };

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function createBridge(cfg) {
  const kook = kookMod.createKook(cfg);
  const key = crypto.keyFromHex(cfg.key);

  return {
    async retain(text, tags = []) {
      const d = defense.check(text);
      const cipher = crypto.encrypt(d.text, key);
      const { msgId, ts } = await kook.send(cipher);
      const entry = { id: newId(), msgId, ts, tags, text: d.text, createdAt: new Date().toISOString() };
      store.append(entry);
      return entry;
    },

    async edit(entryId, text) {
      const e = store.get(entryId);
      if (!e) throw new Error('找不到本地条目 ' + entryId);
      const d = defense.check(text);
      const cipher = crypto.encrypt(d.text, key);
      await kook.edit(e.msgId, cipher);
      return store.update(entryId, { text: d.text });
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
    // 人工核对用：解一条群上密文
    peek: (cipher) => crypto.decrypt(cipher, key),
  };
}

module.exports = { createBridge, defense };
