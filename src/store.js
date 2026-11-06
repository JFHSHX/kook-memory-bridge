'use strict';
// 本地索引：明文只落这里（本机信任根），群上只有密文。
// JSONL 追加写，与 tg-memory-bridge 的本地索引同思路。
const fs = require('fs');
const path = require('path');
const config = require('./config');

function readAll() {
  const p = config.indexPath();
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function append(entry) {
  fs.mkdirSync(path.dirname(config.indexPath()), { recursive: true });
  fs.appendFileSync(config.indexPath(), JSON.stringify(entry) + '\n');
}

function update(id, patch) {
  const p = config.indexPath();
  const rows = readAll();
  let hit = null;
  const next = rows.map(r => {
    if (r.id === id) {
      hit = { ...r, ...patch, updatedAt: new Date().toISOString() };
      return hit;
    }
    return r;
  });
  if (!hit) throw new Error('本地索引里找不到 id=' + id);
  fs.writeFileSync(p, next.map(r => JSON.stringify(r)).join('\n') + '\n');
  return hit;
}

function remove(id) {
  const p = config.indexPath();
  const rows = readAll();
  const next = rows.filter(r => r.id !== id);
  if (next.length === rows.length) throw new Error('本地索引里找不到 id=' + id);
  fs.writeFileSync(p, next.map(r => JSON.stringify(r)).join('\n') + (next.length ? '\n' : ''));
}

function get(id) { return readAll().find(r => r.id === id); }

// 简易关键词召回：命中数优先，其次新者优先（四式召回/TEMPR 后续再借）
function recall(kw, limit = 8) {
  const kws = String(kw).toLowerCase().split(/\s+/).filter(Boolean);
  return readAll()
    .map(r => {
      const hay = ((r.text || '') + ' ' + (r.tags || []).join(' ')).toLowerCase();
      return { r, hits: kws.filter(k => hay.includes(k)).length };
    })
    .filter(x => x.hits > 0)
    .sort((a, b) => b.hits - a.hits || (a.r.ts < b.r.ts ? 1 : -1))
    .slice(0, limit)
    .map(x => x.r);
}

function count() { return readAll().length; }

module.exports = { readAll, append, update, remove, get, recall, count };
