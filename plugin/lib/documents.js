import { createHash } from 'node:crypto';
import { documentIdFor } from './units.js';

export function contentHash(text) { return createHash('sha256').update(String(text), 'utf8').digest('hex'); }

function breakNear(text, start, end, min) {
  const window = text.slice(min, end);
  const candidates = ['\n\n', '\n', '。', '！', '？', '. ', '! ', '? ', '；', '; '];
  let best = -1;
  for (const mark of candidates) {
    const at = window.lastIndexOf(mark);
    if (at >= 0) best = Math.max(best, min + at + mark.length);
  }
  return best > start ? best : end;
}

/** 字符预算切块（中文无需依赖 tokenizer），优先段落/句子边界，保留可控重叠。 */
export function chunkText(input, { maxChars = 3000, overlap = 200 } = {}) {
  const text = String(input || '');
  if (!text.trim()) return [];
  const size = Math.max(200, Number(maxChars) || 3000);
  const lap = Math.max(0, Math.min(Math.floor(size / 3), Number(overlap) || 0));
  if (text.length <= size) return [{ index: 0, id: 'chunk-0', text, start: 0, end: text.length }];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const hardEnd = Math.min(text.length, start + size);
    const min = Math.min(hardEnd, start + Math.floor(size * 0.65));
    const end = hardEnd === text.length ? hardEnd : breakNear(text, start, hardEnd, min);
    const index = chunks.length;
    chunks.push({ index, id: `chunk-${index}`, text: text.slice(start, end), start, end });
    if (end >= text.length) break;
    start = Math.max(start + 1, end - lap);
  }
  return chunks;
}

export function prepareDocument(input, { documentId, mode = 'concise', chunkSize = 3000, overlap = 200 } = {}) {
  const text = String(input || '').trim();
  if (!text) throw new Error('文档正文不能为空');
  const id = documentId || documentIdFor(text);
  const hash = contentHash(text);
  const effectiveMode = ['concise', 'verbose', 'custom', 'verbatim', 'chunks'].includes(mode) ? mode : 'concise';
  const chunks = effectiveMode === 'verbatim'
    ? [{ index: 0, id: 'chunk-0', text, start: 0, end: text.length }]
    : chunkText(text, { maxChars: chunkSize, overlap });
  return { documentId: id, contentHash: hash, mode: effectiveMode, originalLength: text.length, chunks };
}

export function makeDocumentRecord(prepared, chunk) {
  return {
    documentId: prepared.documentId,
    chunkId: chunk.id,
    contentHash: prepared.contentHash,
    text: chunk.text,
    metadata: { chunkIndex: chunk.index, start: chunk.start, end: chunk.end, originalLength: prepared.originalLength },
  };
}
