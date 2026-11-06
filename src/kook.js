'use strict';
// KOOK 开放 API 最小客户端：发/改/删/钉/列。零依赖。
// 文档: https://developer.kookapp.cn/doc/http/message
// 注意: update 仅支持 type 9(KMarkdown)/10(卡片)，故发送统一用 type 9。
const BASE_DEFAULT = 'https://www.kookapp.cn/api/v3';

function createKook(config) {
  const base = (config.apiBase || BASE_DEFAULT).replace(/\/$/, '');
  const token = config.botToken;

  async function call(p, { method = 'POST', body, query } = {}) {
    if (!token) {
      throw new Error('未配置 botToken：到 developer.kookapp.cn 创建应用获取后填入 config.json');
    }
    const url = new URL(base + p);
    for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': 'Bot ' + token,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      throw new Error('KOOK HTTP ' + res.status + '（' + p + '）：网络层失败，检查 apiBase/网络后重试');
    }
    const json = await res.json();
    if (json.code !== 0) {
      throw new Error('KOOK code=' + json.code + ' ' + (json.message || '') + '（' + p + '）');
    }
    return json.data;
  }

  return {
    send: (content) =>
      call('/message/create', { body: { type: 9, target_id: config.channelId, content } })
        .then(d => ({ msgId: d.msg_id, ts: d.msg_timestamp })),
    edit: (msgId, content) => call('/message/update', { body: { msg_id: msgId, content } }),
    del: (msgId) => call('/message/delete', { body: { msg_id: msgId } }),
    pin: (msgId) => call('/message/pin', { body: { msg_id: msgId, target_id: config.channelId } }),
    unpin: (msgId) => call('/message/unpin', { body: { msg_id: msgId, target_id: config.channelId } }),
    // 回读频道历史（flag: before/after/around），重建本地索引用
    list: (opts = {}) =>
      call('/message/list', {
        query: {
          target_id: config.channelId,
          page_size: String(opts.pageSize || 50),
          ...(opts.msgId ? { msg_id: opts.msgId, flag: opts.flag || 'before' } : {}),
        },
      }).then(d => (d.items || []).map(m => ({ msgId: m.id, content: m.content, ts: m.create_at }))),
  };
}

module.exports = { createKook, BASE_DEFAULT };
