import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { __internals } from '../lib/index.js';
import { createMcpHandler } from '../lib/mcp.js';
import { normalizeUnit } from '../lib/units.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kook-mcp-test-'));
const row = { ...normalizeUnit({ text: 'MCP 召回测试', tags: ['#fact'] }), id: 'm1', msgId: 'm1', ts: Date.now() };
fs.writeFileSync(path.join(dir, 'index.jsonl'), JSON.stringify(row) + '\n');
const tools = __internals.buildTools({ dataDir: dir, botToken: 'mock', channelId: 'ch', key: '44'.repeat(32) });
const handler = createMcpHandler(tools);
const init = await handler({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
assert.equal(init.result.serverInfo.name, 'kook-memory-bridge');
const list = await handler({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
assert.equal(list.result.tools.length, 12);
assert.ok(list.result.tools.find(t => t.name === 'kook_reflect').inputSchema.properties.question);
const recall = await handler({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'kook_recall', arguments: { query: 'MCP' } } });
assert.equal(recall.result.structuredContent.count, 1);
assert.equal(recall.result.isError, false);
const invalid = await handler({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'kook_retain', arguments: { text: '' } } });
assert.equal(invalid.result.isError, true);
assert.ok(invalid.result.content[0].text.includes('不能为空'));
console.log('✓ MCP handler initialize/list/call/structuredContent/error');

const bin = path.resolve('bin/mcp-stdio.js');
const input = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  { jsonrpc: '2.0', id: 2, method: 'tools/list' },
].map(JSON.stringify).join('\n') + '\n';
const child = spawnSync(process.execPath, [bin], {
  input, encoding: 'utf8', timeout: 15000,
  env: { ...process.env, KOOK_MEMORY_HOME: dir },
});
const lines = child.stdout.trim().split('\n').filter(Boolean).map(JSON.parse);
assert.equal(lines.length, 2);
assert.equal(lines[1].result.tools.length, 12);
console.log('✓ 真实 stdio 子进程 JSON-RPC 初始化与 12 工具列表');
