#!/usr/bin/env node
'use strict';
// 用法: node cli.js <retain|edit|forget|pin|unpin|recall|peek|status> [...]
const cfg = require('./src/config').loadOrCreate();
const { createBridge } = require('./src/bridge');
const store = require('./src/store');
const { homeDir } = require('./src/config');

const [cmd, ...rest] = process.argv.slice(2);
const bridge = createBridge(cfg);

(async () => {
  switch (cmd) {
    case 'retain': {
      const tags = rest.length > 1 ? rest[1].split(',').map(s => s.trim()).filter(Boolean) : [];
      const e = await bridge.retain(rest[0], tags);
      console.log('已写入 #' + e.id + ' → 群消息 ' + e.msgId + '（密文）');
      break;
    }
    case 'edit':   await bridge.edit(rest[0], rest[1]);   console.log('已原位更新 ' + rest[0]); break;
    case 'forget': await bridge.forget(rest[0]);          console.log('已双侧删除 ' + rest[0]); break;
    case 'pin':    await bridge.pin(rest[0]);             console.log('已置顶 ' + rest[0]); break;
    case 'unpin':  await bridge.unpin(rest[0]);           console.log('已取消置顶 ' + rest[0]); break;
    case 'recall': {
      const hits = bridge.recall(rest[0]);
      console.log(hits.length
        ? hits.map(h => '#' + h.id + ' [' + (h.tags || []).join(' ') + '] ' + h.text).join('\n---\n')
        : '（无命中）');
      break;
    }
    case 'peek':   console.log(bridge.peek(rest[0])); break; // 传 kmb1: 密文字符串
    case 'status':
      console.log('配置目录: ' + homeDir());
      console.log('apiBase : ' + cfg.apiBase);
      console.log('botToken: ' + (cfg.botToken ? '已配置' : '未配置（developer.kookapp.cn 创建应用后填入）'));
      console.log('channel : ' + (cfg.channelId || '未配置'));
      console.log('key     : 已生成（64hex，仅存本机）');
      console.log('索引条数: ' + store.count());
      break;
    default:
      console.log([
        '用法: node cli.js retain "内容" [tag1,tag2]',
        '      node cli.js edit <id> "新内容" | forget <id>',
        '      node cli.js pin|unpin <id> | recall "关键词" | peek <密文> | status',
      ].join('\n'));
  }
})().catch(e => { console.error('失败: ' + e.message); process.exit(1); });
