import {
  requireChannel, readState, resolveKey, formatUnitMessage, kook,
  readMemory, writeMemory, rebuildCache, cacheExists, dateOf,
} from './core.js';
import { assertBankId, resolveBankConfig, makeBankConfigUnit } from './banks.js';

export function createBankTool(cfg, dir) {
  return {
    name: 'kook_bank',
    description: '管理记忆 banks：list/get/set。配置含 disposition、三类 mission、retain 模式和 observation 开关；以加密 system unit 存 KOOK，可重建。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'get', 'set'], description: '默认 list' },
        bank: { type: 'string', description: '默认 default' },
        config: { type: 'object', description: 'set 时传入；只接受白名单配置，禁止密钥' },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object' },
      render: (_a, v) => [{ type: 'text', text: v.ok
        ? (v.action === 'list'
          ? `banks: ${v.banks.map(b => `${b.bank}(${b.memories})`).join(', ') || '(空)'}`
          : `${v.bank}:\n${JSON.stringify(v.config, null, 2)}`)
        : `失败: ${v.error || ''}` }],
    },
    timeoutMs: 60000,
    isConcurrencySafe: false,
    execute: async (args = {}) => {
      const action = args.action || 'list';
      const bank = assertBankId(args.bank || 'default');
      if (!cacheExists(dir)) await rebuildCache(cfg, dir);
      const rows = readMemory(dir);
      if (action === 'list') {
        const ids = new Set(['default', ...rows.map(e => e.bank || 'default')]);
        return {
          ok: true, action,
          banks: [...ids].sort().map(id => ({
            bank: id,
            memories: rows.filter(e => e.bank === id && e.kind === 'memory').length,
            observations: rows.filter(e => e.bank === id && e.kind === 'observation').length,
            config: resolveBankConfig(rows, id),
          })),
        };
      }
      if (action === 'get') return { ok: true, action, bank, config: resolveBankConfig(rows, bank) };
      if (action !== 'set') throw new Error(`未知 action: ${action}`);
      const unit = makeBankConfigUnit(bank, args.config || {});
      const channelId = requireChannel(cfg, readState(dir));
      const previous = rows.filter(e => e.bank === bank && e.kind === 'bank_config')
        .sort((a, b) => a.ts - b.ts).at(-1);
      let msgId;
      let ts;
      if (previous) {
        msgId = previous.msgId;
        ts = previous.ts;
        await kook.edit(cfg, msgId, formatUnitMessage({ ...unit, date: previous.date }, resolveKey(cfg)));
      } else {
        const sent = await kook.send(cfg, channelId, formatUnitMessage(unit, resolveKey(cfg)));
        msgId = String(sent.msg_id);
        ts = Number(sent.msg_timestamp) || Date.now();
      }
      const entry = {
        ...unit, id: msgId, msgId, ts, date: previous?.date || dateOf(ts),
        createdAt: previous?.createdAt || new Date(ts).toISOString(),
      };
      writeMemory(dir, previous
        ? rows.map(e => e.msgId === msgId ? entry : e)
        : [...rows, entry]);
      return { ok: true, action, bank, msgId, config: resolveBankConfig([...rows.filter(e => e.msgId !== msgId), entry], bank) };
    },
  };
}
