import path from 'node:path';
import {
  requireChannel, readState, resolveKey, formatUnitMessage, kook, channelFor,
  readMemory, appendMemory, writeMemory, defenseApply, dateOf,
} from './core.js';
import { normalizeUnit } from './units.js';
import { resolveBankConfig } from './banks.js';
import { prepareDocument } from './documents.js';
import { createLLMClient, extractFacts } from './llm.js';
import { createEmbeddingProvider, embedWithCache, cosineSimilarity } from './embeddings.js';

const entityNames = unit => new Set((unit.entities || []).map(e => e.canonical || String(e.name || e).toLocaleLowerCase()));

export async function enrichUnitLinks(cfg, dir, input) {
  const unit = normalizeUnit(input);
  const candidates = readMemory(dir).filter(e => e.bank === unit.bank && e.kind === 'memory');
  const links = [...unit.links];
  const mine = entityNames(unit);
  if (mine.size) {
    const shared = candidates.filter(e => [...entityNames(e)].some(name => mine.has(name)))
      .sort((a, b) => b.ts - a.ts).slice(0, 5);
    for (const entry of shared) links.push({ target: entry.msgId, type: 'entity', weight: 1 });
  }
  const event = Date.parse(unit.occurredStart || unit.mentionedAt);
  const nearby = candidates.filter(e => e.factType === unit.factType && Math.abs(Date.parse(e.occurredStart || e.mentionedAt || e.date) - event) <= 86400000)
    .sort((a, b) => Math.abs(Date.parse(a.occurredStart || a.mentionedAt || a.date) - event) - Math.abs(Date.parse(b.occurredStart || b.mentionedAt || b.date) - event))
    .slice(0, 20);
  for (const entry of nearby) {
    const hours = Math.abs(Date.parse(entry.occurredStart || entry.mentionedAt || entry.date) - event) / 3600000;
    links.push({ target: entry.msgId, type: 'temporal', weight: Math.max(0.3, 1 - hours / 24) });
  }
  if ((cfg.embeddingProvider || 'none') !== 'none' && candidates.length) {
    const provider = createEmbeddingProvider(cfg);
    const vectors = await embedWithCache([...candidates, unit], provider, path.join(dir, 'vectors.json'));
    const query = vectors.at(-1);
    const semantic = candidates.map((entry, i) => ({ entry, score: cosineSimilarity(query, vectors[i]) }))
      .filter(x => x.score >= 0.7).sort((a, b) => b.score - a.score).slice(0, 5);
    for (const { entry, score } of semantic) links.push({ target: entry.msgId, type: 'semantic', weight: score });
  }
  return normalizeUnit({ ...unit, links });
}

export async function persistNewUnit(cfg, dir, input, { enrich = true } = {}) {
  const unit = enrich ? await enrichUnitLinks(cfg, dir, input) : normalizeUnit(input);
  const channelId = channelFor(cfg, unit) || requireChannel(cfg, readState(dir));
  const sent = await kook.send(cfg, channelId, formatUnitMessage(unit, resolveKey(cfg)));
  const ts = Number(sent.msg_timestamp) || Date.now();
  const entry = {
    ...unit, id: String(sent.msg_id), msgId: String(sent.msg_id), ts,
    date: dateOf(unit.mentionedAt || ts), createdAt: new Date(ts).toISOString(),
  };
  let note = '';
  try { appendMemory(dir, entry); } catch (error) { note = `KOOK 已写入，缓存待重建：${error?.message || error}`; }
  return { entry, note };
}

export async function persistExistingUnit(cfg, dir, previous, input) {
  const unit = normalizeUnit(input);
  await kook.edit(cfg, previous.msgId, formatUnitMessage({ ...unit, date: previous.date }, resolveKey(cfg)));
  const entry = {
    ...unit, id: previous.msgId, msgId: previous.msgId, ts: previous.ts,
    date: previous.date || dateOf(previous.ts), createdAt: previous.createdAt,
    updatedAt: new Date().toISOString(),
  };
  const rows = readMemory(dir);
  writeMemory(dir, rows.some(e => e.msgId === previous.msgId)
    ? rows.map(e => e.msgId === previous.msgId ? entry : e)
    : [...rows, entry]);
  return entry;
}

export async function deletePersistedUnit(cfg, dir, msgId) {
  await kook.del(cfg, msgId);
  const rows = readMemory(dir);
  writeMemory(dir, rows.filter(e => e.msgId !== msgId));
}

export async function retainDocument(cfg, dir, args = {}) {
  const bank = args.bank || 'default';
  const bankConfig = resolveBankConfig(readMemory(dir), bank);
  const defended = defenseApply(cfg, args.text || '');
  const requestedMode = args.mode || bankConfig.retainExtractionMode;
  const prepared = prepareDocument(defended.text, {
    documentId: args.documentId, mode: requestedMode,
    // 中文 UTF-8 + base64 后仍需低于 KOOK 8000 字符；结构化 JSON 另留余量。
    chunkSize: Math.min(1200, Number(args.chunkSize || bankConfig.retainChunkSize) || 1200),
    overlap: args.overlap ?? 120,
  });
  const ts = Date.now();
  const mentionedAt = args.mentionedAt || new Date(ts).toISOString();
  let actualMode = requestedMode;
  let degraded = '';
  const notes = defended.hits.length ? [`Defense 已脱敏：${defended.hits.join(', ')}`] : [];
  let units = [];
  const makeUnit = (chunk, extra = {}) => {
    const factType = args.factType || 'world';
    const autoTag = factType === 'experience' ? '#exp' : factType === 'observation' ? '#observation' : factType === 'opinion' ? '#opinion' : '#fact';
    return normalizeUnit({
      ...args, bank, kind: args.kind || (factType === 'observation' ? 'observation' : 'memory'),
      factType, text: chunk.text,
      documentId: prepared.documentId, chunkId: chunk.id,
      contentHash: prepared.contentHash, mentionedAt,
      tags: [...new Set([...(args.tags || ['#fact']), autoTag])],
      metadata: { ...(args.metadata || {}), mode: actualMode, chunkIndex: chunk.index },
      ...extra,
    });
  };

  if (['chunks', 'verbatim'].includes(requestedMode)) {
    units = prepared.chunks.map(chunk => makeUnit(chunk));
  } else {
    const client = createLLMClient(cfg);
    if (!client.enabled) {
      actualMode = 'chunks';
      degraded = 'llm-not-configured';
      notes.push('未配置 LLM，已明确降级为 chunks；未执行伪抽取');
      units = prepared.chunks.map(chunk => makeUnit(chunk));
    } else {
      for (const chunk of prepared.chunks) {
        const facts = await extractFacts(client, {
          content: chunk.text, mode: requestedMode,
          mission: [bankConfig.retainMission, args.customInstructions].filter(Boolean).join('\n'),
          context: args.context || '', now: new Date(ts).toISOString(),
          bank, documentId: prepared.documentId, chunkId: chunk.id,
          tags: args.tags, context: args.context || '', mentionedAt,
          metadata: { ...(args.metadata || {}), mode: actualMode, contentHash: prepared.contentHash },
        });
        if (!facts.length) {
          notes.push(`${chunk.id} 未抽得事实，已按原文保留`);
          units.push(makeUnit(chunk, { metadata: { mode: actualMode, extractionFallback: 'empty-llm-result' } }));
        } else {
          for (const fact of facts) {
            const clean = defenseApply(cfg, fact.text);
            units.push(normalizeUnit({ ...fact, text: clean.text }));
          }
        }
      }
    }
  }

  const persisted = [];
  for (const unit of units) persisted.push(await persistNewUnit(cfg, dir, unit));
  const entries = persisted.map(x => x.entry);
  notes.push(...persisted.map(x => x.note).filter(Boolean));
  return {
    ok: true, bank, documentId: prepared.documentId, contentHash: prepared.contentHash,
    requestedMode, actualMode, degraded: degraded || null,
    count: entries.length, ids: entries.map(e => e.msgId), facts: entries,
    id: entries[0]?.id, msgId: entries[0]?.msgId, date: entries[0]?.date,
    tags: entries[0]?.tags || [], text: entries[0]?.text,
    notes,
  };
}
