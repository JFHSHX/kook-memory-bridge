#!/usr/bin/env node
'use strict';
// CLI 与 DSH/MCP 共用 plugin/lib 的同一引擎；src/ 仅保留早期兼容实现。
const path = require('path');
const os = require('os');

const USAGE = `用法:
  node cli.js status | rebuild
  node cli.js retain "内容" [tag1,tag2] [chunks|verbatim|concise|verbose|custom]
  node cli.js recall "关键词" [bank] | edit <id> "新内容" | forget <id>
  node cli.js pin|unpin <id> | peek "<完整消息或密文>"
  node cli.js bank list|get|set [bank] [JSON配置]
  node cli.js reflect "问题" [bank] | consolidate [bank]
  node cli.js mental list|get|create|refresh|delete [modelId] [sourceQuery]

配置: ~/.dsh/kook-memory/config.json（可用 KOOK_MEMORY_HOME 覆盖）
MCP: node plugin/bin/mcp-stdio.js`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd) { console.log(USAGE); return; }
  const dataDir = process.env.KOOK_MEMORY_HOME || path.join(os.homedir(), '.dsh', 'kook-memory');
  const { __internals } = await import('./plugin/lib/index.js');
  const defs = Object.fromEntries(__internals.buildTools({ dataDir }).map(d => [d.name, d]));
  async function run(name, args) {
    const def = defs[name];
    const value = await def.execute(args);
    const rendered = def.output?.render?.(args, value);
    if (rendered) console.log(rendered.map(x => x.text || JSON.stringify(x)).join('\n'));
    else console.log(JSON.stringify(value, null, 2));
    if (value?.ok === false) process.exitCode = 1;
  }
  switch (cmd) {
    case 'status': return run('kook_status', {});
    case 'rebuild': return run('kook_rebuild', {});
    case 'retain': return run('kook_retain', {
      text: rest[0] || '', tags: rest[1] ? rest[1].split(',') : undefined, mode: rest[2] || undefined,
    });
    case 'recall':
    case 'search': return run('kook_recall', { query: rest[0] || '', bank: rest[1] || 'default' });
    case 'edit': return run('kook_edit', { id: rest[0], text: rest.slice(1).join(' ') });
    case 'forget': return run('kook_forget', { id: rest[0] });
    case 'pin': return run('kook_pin', { id: rest[0] });
    case 'unpin': return run('kook_pin', { id: rest[0], unpin: true });
    case 'bank': return run('kook_bank', { action: rest[0] || 'list', bank: rest[1], config: rest[2] ? JSON.parse(rest[2]) : undefined });
    case 'reflect': return run('kook_reflect', { question: rest[0] || '', bank: rest[1] || 'default' });
    case 'consolidate': return run('kook_consolidate', { bank: rest[0] || 'default' });
    case 'mental': return run('kook_mental_model', {
      action: rest[0] || 'list', modelId: rest[1], sourceQuery: rest.slice(2).join(' ') || undefined,
    });
    case 'peek': {
      const core = await import('./plugin/lib/core.js');
      const cfg = core.loadConfig({ dataDir }, dataDir);
      console.log(core.parseMemoryMessage(rest[0] || '', core.resolveKey(cfg)).text);
      return;
    }
    default:
      console.error(`未知命令: ${cmd}\n\n${USAGE}`);
      process.exitCode = 1;
  }
}

main().catch(error => { console.error(`失败: ${error?.message || error}`); process.exitCode = 1; });
