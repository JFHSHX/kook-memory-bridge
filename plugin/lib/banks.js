import { normalizeUnit } from './units.js';

export const DEFAULT_BANK_CONFIG = Object.freeze({
  disposition: Object.freeze({ skepticism: 3, literalism: 3, empathy: 3 }),
  biasStrength: 0.5,
  retainMission: '保留 durable、具体、长期有证据价值的事实；过滤寒暄与瞬时过程。',
  observationsMission: '合成长期稳定、可证据回溯的观察；矛盾时保留历史。',
  reflectMission: '基于检索证据回答，保持诚实、简洁，不编造来源。',
  retainExtractionMode: 'concise',
  retainChunkSize: 3000,
  enableObservations: true,
  enableAutoConsolidation: false,
  recallPreferObservations: false,
  maxObservationsPerScope: -1,
});
const MODES = new Set(['concise', 'verbose', 'custom', 'verbatim', 'chunks']);

export function assertBankId(bank) {
  const id = String(bank || 'default');
  if (!/^\S{1,64}$/.test(id)) throw new Error('bank id 需为 1–64 个非空白字符');
  return id;
}

export function validateBankConfig(input = {}) {
  const out = { ...DEFAULT_BANK_CONFIG };
  // 白名单：bank config 可入 KOOK，不允许把未知字段（如 apiKey）夹带入库。
  for (const key of Object.keys(DEFAULT_BANK_CONFIG)) {
    if (input[key] !== undefined) out[key] = input[key];
  }
  const disposition = { ...DEFAULT_BANK_CONFIG.disposition, ...(input.disposition || {}) };
  for (const key of ['skepticism', 'literalism', 'empathy']) {
    const n = Number(disposition[key]);
    if (!Number.isInteger(n) || n < 1 || n > 5) throw new Error(`disposition.${key} 必须是 1–5 的整数`);
    disposition[key] = n;
  }
  out.disposition = disposition;
  out.biasStrength = Number(out.biasStrength);
  if (!(out.biasStrength >= 0 && out.biasStrength <= 1)) throw new Error('biasStrength 必须在 0–1');
  if (!MODES.has(out.retainExtractionMode)) throw new Error(`未知 retainExtractionMode: ${out.retainExtractionMode}`);
  out.retainChunkSize = Math.max(500, Math.min(6000, Number(out.retainChunkSize) || 3000));
  out.maxObservationsPerScope = Math.max(-1, Number(out.maxObservationsPerScope) || -1);
  for (const key of ['enableObservations', 'enableAutoConsolidation', 'recallPreferObservations']) out[key] = Boolean(out[key]);
  for (const key of ['retainMission', 'observationsMission', 'reflectMission']) out[key] = String(out[key] || '');
  return out;
}

/** 从 KOOK 重建出的 system units 解析最新 bank 配置；本地默认不含独有事实。 */
export function resolveBankConfig(entries, bank = 'default') {
  const id = assertBankId(bank);
  const latest = entries.filter(e => e.bank === id && e.kind === 'bank_config')
    .sort((a, b) => (a.ts || 0) - (b.ts || 0)).at(-1);
  return validateBankConfig(latest?.payload || {});
}

export function makeBankConfigUnit(bank, config, ts = Date.now()) {
  const id = assertBankId(bank);
  const valid = validateBankConfig(config);
  return normalizeUnit({
    kind: 'bank_config', bank: id, factType: 'world', tags: ['#bank-config'],
    text: `Bank ${id} 配置`, payload: valid,
    documentId: `bank-config:${id}`, mentionedAt: new Date(ts).toISOString(),
  });
}

/** 严格 bank 隔离；system units 不混入普通事实召回。 */
export function bankMemories(entries, bank = 'default', { kinds = ['memory', 'observation'], factTypes } = {}) {
  const id = assertBankId(bank);
  const kindSet = new Set(kinds);
  const typeSet = factTypes ? new Set(factTypes) : null;
  return entries.filter(e => e.bank === id && kindSet.has(e.kind || 'memory') && (!typeSet || typeSet.has(e.factType)));
}

export function makeDirectiveUnit({ bank = 'default', text, tags = ['#directive'], priority = 100, enabled = true }, ts = Date.now()) {
  if (!String(text || '').trim()) throw new Error('directive text 不能为空');
  return normalizeUnit({
    kind: 'directive', bank: assertBankId(bank), factType: 'world', text, tags,
    payload: { priority: Number(priority) || 100, enabled: Boolean(enabled) },
    documentId: `directive:${assertBankId(bank)}`, mentionedAt: new Date(ts).toISOString(),
  });
}

export function activeDirectives(entries, bank = 'default', tags = []) {
  const wanted = new Set((tags || []).map(String));
  return bankMemories(entries, bank, { kinds: ['directive'] })
    .filter(e => e.payload?.enabled !== false)
    .filter(e => !wanted.size || e.tags.some(t => wanted.has(t)))
    .sort((a, b) => (a.payload?.priority || 100) - (b.payload?.priority || 100));
}
