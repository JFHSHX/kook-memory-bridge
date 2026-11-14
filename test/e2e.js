'use strict';
// mock 全链路 e2e：[日期]标签明文+正文密文 → retain → edit 同 msgId → pin/unpin → recall → forget → 篡改拒绝 → 历史回读 → passphrase 派生
process.env.KOOK_MEMORY_HOME = require('os').tmpdir() + '/kmb-e2e-' + Date.now();
const assert = require('assert');
const { createMock } = require('../mock/kook-mock');
const { loadOrCreate, homeDir } = require('../src/config');
const { createBridge, parseMessage } = require('../src/bridge');
const { decrypt, keyFromHex } = require('../src/crypto');
const { createKook } = require('../src/kook');
const store = require('../src/store');

(async () => {
  const mock = createMock();
  const port = await mock.listen(0);
  const cfg = loadOrCreate();
  cfg.apiBase = 'http://127.0.0.1:' + port + '/api/v3';
  cfg.botToken = 'mock-token';
  cfg.channelId = 'ch-1';

  const bridge = createBridge(cfg);
  const key = keyFromHex(cfg.key);
  const results = [];

  // 1. retain：首行明文 [日期] 标签，第二行 kmb1 密文；索引明文；召回命中
  const e1 = await bridge.retain('本机直连 discord.com 可达', ['#fact', '#hindsight-tg']);
  const wire1 = mock.state.messages.get(e1.msgId).content;
  assert(/^\[\d{4}-\d{2}-\d{2}\] #fact #hindsight-tg\n/.test(wire1), '首行应为明文日期+标签: ' + wire1.split('\n')[0]);
  const cipher1 = wire1.split('\n')[1];
  assert(cipher1 && cipher1.startsWith('kmb1:'), '第二行应为 kmb1 密文');
  assert(!wire1.includes('discord'), '密文不得泄漏明文关键词');
  assert(bridge.recall('discord')[0].text.includes('discord'), '本地召回应命中明文');
  results.push('✓ retain：[日期] 标签明文 + 正文密文 / 索引明文 / 召回命中');

  // 2. edit：原位更新，同一消息，日期与标签保留
  await bridge.edit(e1.id, '改口：本机直连 KOOK 0.9s');
  const wire1b = mock.state.messages.get(e1.msgId).content;
  assert(parseMessage(wire1b, key).text === '改口：本机直连 KOOK 0.9s', '频道消息解密应为新文本');
  assert(/^\[\d{4}-\d{2}-\d{2}\] #fact #hindsight-tg\n/.test(wire1b), '编辑后明文头部应保留');
  assert(store.get(e1.id).text === '改口：本机直连 KOOK 0.9s', '索引应同步更新');
  results.push('✓ edit：同 msgId 原位更新，日期/标签保留');

  // 3. pin/unpin
  await bridge.pin(e1.id);
  assert(mock.state.pins.has(e1.msgId), '应已置顶');
  await bridge.unpin(e1.id);
  assert(!mock.state.pins.has(e1.msgId), '应已取消置顶');
  results.push('✓ pin/unpin');

  // 4. 第二条 + recall 多条
  await bridge.retain('KOOK 配额每天 10000 条', ['#fact']);
  assert(bridge.recall('kook').length === 2, 'kook 应命中两条');
  results.push('✓ recall：多条命中');

  // 5. forget：双侧删除
  await bridge.forget(e1.id);
  assert(!mock.state.messages.has(e1.msgId), '群上消息应已删');
  assert(!store.get(e1.id), '索引应已删');
  results.push('✓ forget：群 + 索引双侧删除');

  // 6. 完整性：翻转密文最后一个字节，GCM 必须拒绝
  const cipherNow = wire1b.split('\n')[1];
  const raw = Buffer.from(cipherNow.slice(5), 'base64');
  raw[raw.length - 1] ^= 0xff;
  let threw = false;
  try { decrypt('kmb1:' + raw.toString('base64'), key); } catch { threw = true; }
  assert(threw, '篡改密文必须解密失败');
  results.push('✓ 完整性：篡改被 GCM auth tag 拒绝');

  // 7. 回读历史：全部可按新格式解析
  const history = await createKook(cfg).list();
  assert(history.length >= 1 && history.every(h => parseMessage(h.content, key).legacy === false), '回读历史应全为新格式');
  results.push('✓ list：回读历史均为 [日期]标签 + 密文格式');

  // 8. passphrase 派生模式：同口令同 salt 必须可复现，异口令必须解不开
  const cryptoMod = require('../src/crypto');
  const cfgP = { ...cfg, passphrase: 'test-pass-114514', kdfSalt: cryptoMod.newSaltHex() };
  delete cfgP.key;
  const bridgeP = createBridge(cfgP);
  const e3 = await bridgeP.retain('口令派生模式金丝雀');
  const blob = mock.state.messages.get(e3.msgId).content;
  assert(createBridge({ ...cfgP }).peek(blob) === '口令派生模式金丝雀', '同口令重建必须可解');
  let threw2 = false;
  try { createBridge({ ...cfgP, passphrase: 'wrong-pass' }).peek(blob); } catch { threw2 = true; }
  assert(threw2, '异口令必须解不开（GCM 拒绝）');
  results.push('✓ passphrase：scrypt 派生可复现 / 异口令拒绝');

  await mock.close();
  console.log('\nKOOK + AES-GCM mock 全链路通过：\n' + results.map(r => '  ' + r).join('\n'));
  console.log('测试目录: ' + homeDir());
})().catch(e => { console.error('E2E 失败:', e && e.message); process.exit(1); });
