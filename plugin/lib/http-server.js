import http from 'node:http';
import { URL } from 'node:url';

const json = (value, status = 200) => ({ status, body: JSON.stringify(value) });
const clean = value => String(value || '').replace(/Bearer\s+\S+/gi, 'Bearer <redacted>').slice(0, 500);

export function createHttpServer({ tools, authToken = '', host = '127.0.0.1', port = 8787 }) {
  const registry = typeof tools === 'function' ? tools : () => tools;
  const find = name => registry().find(def => def.name === name);
  const execute = async (name, args) => {
    const def = find(name);
    if (!def) throw new Error('未知工具: ' + name);
    return def.execute(args || {});
  };
  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    const send = (status, value) => {
      const body = JSON.stringify(value);
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(body);
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (authToken && req.headers.authorization !== 'Bearer ' + authToken) return send(401, { ok: false, error: 'unauthorized' });
      if (req.method === 'GET' && url.pathname === '/healthz') return send(200, { ok: true, status: 'ok', tools: registry().length, uptimeMs: Date.now() - started });
      if (req.method === 'GET' && url.pathname === '/v1/status') return send(200, await execute('kook_status', {}));
      if (req.method === 'GET' && url.pathname === '/v1/tools') return send(200, { ok: true, tools: registry().map(def => ({ name: def.name, description: def.description, parameters: def.parameters })) });
      if (req.method === 'GET' && url.pathname === '/v1/memories') return send(200, await execute('kook_recall', { query: url.searchParams.get('query') || undefined, bank: url.searchParams.get('bank') || 'default', limit: Number(url.searchParams.get('limit') || 10) }));
      if (req.method === 'GET' && url.pathname === '/v1/mental-models') return send(200, await execute('kook_mental_model', { action: 'list', bank: url.searchParams.get('bank') || 'default' }));
      if (req.method === 'GET' && url.pathname === '/v1/pages') return send(200, await execute('kook_pages', { action: 'list', bank: url.searchParams.get('bank') || 'default' }));
      if (req.method === 'GET' && url.pathname === '/v1/banks') return send(200, await execute('kook_bank', { action: 'list' }));
      if (req.method === 'GET' && url.pathname === '/v1/banks/' + url.pathname.split('/')[3] + '/config') return send(200, await execute('kook_bank', { action: 'get', bank: url.pathname.split('/')[3] }));
      if (req.method === 'GET' && url.pathname.startsWith('/v1/pages/')) {
        const parts = url.pathname.split('/');
        return send(200, await execute('kook_pages', { action: 'get', bank: parts[3], modelId: parts[4] }));
      }
      if (req.method === 'GET' && url.pathname.startsWith('/v1/mental-models/')) return send(200, await execute('kook_mental_model', { action: 'get', bank: url.searchParams.get('bank') || 'default', modelId: url.pathname.split('/')[3] }));
      if (req.method !== 'POST' && req.method !== 'DELETE') return send(405, { ok: false, error: 'method not allowed' });
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
        if (chunks.reduce((sum, item) => sum + item.length, 0) > 1048576) return send(413, { ok: false, error: 'body too large' });
      }
      let args = {};
      if (chunks.length) { try { args = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { ok: false, error: 'invalid JSON' }); } }
      if (req.method === 'POST' && url.pathname === '/v1/retain') return send(200, await execute('kook_retain', args));
      if (req.method === 'POST' && url.pathname === '/v1/recall') return send(200, await execute('kook_recall', args));
      if (req.method === 'POST' && url.pathname === '/v1/reflect') return send(200, await execute('kook_reflect', args));
      if (req.method === 'POST' && url.pathname === '/v1/consolidate') return send(200, await execute('kook_consolidate', args));
      if (req.method === 'POST' && url.pathname === '/v1/rebuild') return send(200, await execute('kook_rebuild', args));
      if (req.method === 'POST' && url.pathname === '/v1/pages/refresh') return send(200, await execute('kook_pages', { action: 'refresh', ...args }));
      if (req.method === 'POST' && url.pathname === '/v1/banks/' + url.pathname.split('/')[3] + '/config') return send(200, await execute('kook_bank', { action: 'set', bank: url.pathname.split('/')[3], ...args }));
      if (req.method === 'POST' && url.pathname === '/v1/mental-models') return send(200, await execute('kook_mental_model', { action: 'create', ...args }));
      if (req.method === 'POST' && url.pathname.startsWith('/v1/mental-models/') && url.pathname.endsWith('/refresh')) return send(200, await execute('kook_mental_model', { action: 'refresh', modelId: url.pathname.split('/')[3], ...args }));
      if (req.method === 'DELETE' && url.pathname.startsWith('/v1/mental-models/')) return send(200, await execute('kook_mental_model', { action: 'delete', modelId: url.pathname.split('/')[3], ...args }));
      if (req.method === 'POST' && url.pathname.startsWith('/v1/tools/')) return send(200, await execute(url.pathname.split('/')[3], args));
      return send(404, { ok: false, error: 'not found' });
    } catch (error) { return send(500, { ok: false, error: clean(error.message) }); }
  });
  return {
    server,
    async start({ port: requestedPort = port, host: requestedHost = host } = {}) {
      await new Promise((resolve, reject) => {
        const onError = error => { server.off('listening', resolve); reject(error); };
        server.once('error', onError);
        server.listen(requestedPort, requestedHost, () => { server.off('error', onError); resolve(); });
      });
      const address = server.address();
      return { ok: true, url: 'http://' + requestedHost + ':' + address.port, host: requestedHost, port: address.port };
    },
    async stop() { await new Promise(resolve => server.close(() => resolve())); return { ok: true }; },
  };
}

export function createHttpTools({ cfg, dir, tools }) {
  let running = null;
  const output = render => ({ schema: { type: 'object' }, render });
  const text = value => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }];
  return [{
    name: 'kook_http',
    description: 'HTTP API：工具发现、通用工具执行、记忆/模型/页面路由与可选 Bearer 鉴权。',
    parameters: { type: 'object', properties: {
      action: { type: 'string', enum: ['start', 'stop', 'status'] },
      port: { type: 'integer' }, host: { type: 'string' },
    }, required: ['action'], additionalProperties: false },
    output: output((_a, value) => text(value)),
    timeoutMs: 30000, isConcurrencySafe: false,
    execute: async args => {
      if (args.action === 'stop') { if (running) await running.stop(); running = null; return { ok: true, running: false }; }
      if (args.action === 'status') return { ok: true, running: Boolean(running), ...(running ? { url: running.url } : {}) };
      if (args.action === 'start') {
        if (running) return { ok: true, running: true, url: running.url };
        running = createHttpServer({ tools, authToken: cfg.httpToken || process.env.KOOK_HTTP_TOKEN || '', host: args.host || cfg.httpHost || '127.0.0.1', port: args.port ?? cfg.httpPort ?? 8787 });
        const address = await running.start({ port: args.port ?? cfg.httpPort ?? 8787, host: args.host || cfg.httpHost || '127.0.0.1' });
        running.url = address.url;
        return { ok: true, running: true, url: address.url };
      }
      throw new Error('未知 http action: ' + args.action);
    },
  }];
}