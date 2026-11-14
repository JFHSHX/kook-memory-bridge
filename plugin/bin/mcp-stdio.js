#!/usr/bin/env node
import readline from 'node:readline';
import { __internals } from '../lib/index.js';
import { createMcpHandler } from '../lib/mcp.js';

const tools = __internals.buildTools({});
const handle = createMcpHandler(tools);
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let queue = Promise.resolve();
rl.on('line', line => {
  queue = queue.then(async () => {
    if (!line.trim()) return;
    let message;
    try { message = JSON.parse(line); }
    catch (error) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON 解析失败' } }) + '\n');
      return;
    }
    const response = await handle(message);
    if (response) process.stdout.write(JSON.stringify(response) + '\n');
  }).catch(error => {
    process.stderr.write(`MCP 处理失败: ${error?.stack || error}\n`);
  });
});
rl.on('close', () => { queue.finally(() => process.exit(0)); });
