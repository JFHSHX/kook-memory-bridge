'use strict';
// KOOK /api/v3 最小 mock：create/update/delete/pin/unpin/list，内存态。
// 应答封包与官方一致：{ code: 0, message: '操作成功', data }
const http = require('http');

function createMock() {
  const state = { messages: new Map(), pins: new Set(), calls: [] };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://mock');
    const p = url.pathname.replace(/^\/api\/v3/, '');
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString() || '{}') : {};
      const reply = data => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ code: 0, message: '操作成功', data }));
      };
      const fail = (code, msg) => res.end(JSON.stringify({ code, message: msg, data: null }));
      state.calls.push(p);

      if (p === '/message/create') {
        const msgId = 'mock-' + String(state.messages.size + 1).padStart(3, '0');
        state.messages.set(msgId, { id: msgId, content: body.content, target_id: body.target_id, create_at: Date.now() });
        return reply({ msg_id: msgId, msg_timestamp: Date.now() });
      }
      if (p === '/message/update') {
        const m = state.messages.get(body.msg_id);
        if (!m) return fail(40000, '消息不存在');
        m.content = body.content;
        m.updated_at = Date.now();
        return reply([]);
      }
      if (p === '/message/delete') {
        if (!state.messages.has(body.msg_id)) return fail(40000, '消息不存在');
        state.messages.delete(body.msg_id);
        return reply([]);
      }
      if (p === '/message/pin' || p === '/message/unpin') {
        if (!state.messages.has(body.msg_id)) return fail(40000, '消息不存在');
        if (p === '/message/pin') state.pins.add(body.msg_id); else state.pins.delete(body.msg_id);
        return reply([]);
      }
      if (p === '/message/list') {
        const items = [...state.messages.values()].map(m => ({ id: m.id, content: m.content, create_at: m.create_at }));
        return reply({ items });
      }
      fail(404, 'mock 未实现 ' + p);
    });
  });

  const listen = (port = 0) =>
    new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server.address().port)));
  const close = () => new Promise(r => server.close(r));

  return { server, listen, close, state };
}

module.exports = { createMock };
