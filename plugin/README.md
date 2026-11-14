# kook-memory-bridge（DSH 插件）

KOOK 频道作为 DSH 长期记忆库：**KOOK 是唯一事实源，`index.jsonl` 只是可重建缓存**。日期与标签明文，正文 AES-256-GCM 密文；`kmb2` 保存完整 MemoryUnit。

## 消息格式

```text
[2026-11-15] #fact #项目
kmb2:<base64(iv|authTag|json-ciphertext)>
```

早期 `kmb1` 与无元数据行消息仍可解析。画像卡为明文并置顶，不进入记忆缓存。

## 工具

- `kook_status`：验证 token，必要时自动发现文字频道
- `kook_retain`：写入记忆
- `kook_recall`：关键词/标签召回，严格 bank 隔离；缓存不存在自动重建
- `kook_rebuild`：全量翻页解密，原子重建缓存
- `kook_bank`：list/get/set bank 配置，配置同样可重建
- `kook_edit`：按 `id` / `msgId` / `query` 原位修改，保留原日期与富字段
- `kook_forget`：KOOK 删除成功后才清缓存；失败保留并带原因
- `kook_pin`：置顶/取消置顶记忆；传 `text` 时维护明文画像卡

## 配置与安装

敏感配置只在 `~/.dsh/kook-memory/config.json`（0600）：`botToken`、`channelId`、`key` 或 `passphrase+kdfSalt`。配置与独立 CLI 共用。

```sh
npm test
dsh plugin --profile web add ~/.dsh/dsh-go/plugins/kook-memory-bridge
```

代码变更后在 App「引擎」页重启引擎。卸载：`dsh plugin --profile web remove kook-memory-bridge`。
