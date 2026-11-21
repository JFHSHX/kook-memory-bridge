#!/usr/bin/env node
import os from 'node:os';
import path from 'node:path';
import { __internals } from '../plugin/lib/index.js';
import { loadConfig, resolveDataDir } from '../plugin/lib/core.js';
import { createHttpServer } from '../plugin/lib/http-server.js';

const dataDir = resolveDataDir({});
const cfg = loadConfig({ dataDir }, dataDir);
const tools = __internals.buildTools({ dataDir });
const server = createHttpServer({
  tools,
  authToken: cfg.httpToken || process.env.KOOK_HTTP_TOKEN || '',
  host: process.env.KOOK_HTTP_HOST || cfg.httpHost || '127.0.0.1',
  port: Number(process.env.KOOK_HTTP_PORT || cfg.httpPort || 8787),
});
const address = await server.start({});
console.log(JSON.stringify({ ok: true, url: address.url, tools: tools.length }));
const shutdown = async () => { await server.stop(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);