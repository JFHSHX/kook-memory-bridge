# kook-memory-bridge（DSH 插件）

KOOK 频道作为 DSH 长期记忆库：**日期与标签明文、正文 AES-256-GCM 密文**，本地 `index.jsonl` 保存明文用于召回。

## 消息格式

```text
[2026-11-14] #fact #项目
kmb1:<base64(iv|authTag|ciphertext)>
```

早期没有元数据行的全密文消息仍可解析。画像卡为明文并置顶。

## 工具

- `kook_status`：验证 token，必要时自动发现文字频道
- `kook_retain`：写入记忆
- `kook_recall`：关键词/标签召回，返回 `id`
- `kook_edit`：按 `id` / `msgId` / `query` 原位修改，保留原日期，可改标签
- `kook_forget`：删除频道消息并移除本地索引；失败结果带原因
- `kook_pin`：置顶/取消置顶记忆；传 `text` 时维护明文画像卡

## 配置与安装

敏感配置只在 `~/.dsh/kook-memory/config.json`（0600）：`botToken`、`channelId`、`key` 或 `passphrase+kdfSalt`。配置与独立 CLI 共用。

```sh
node test/offline.mjs
dsh plugin --profile web add ~/.dsh/dsh-go/plugins/kook-memory-bridge
```

代码变更后在 App「引擎」页重启引擎。卸载：`dsh plugin --profile web remove kook-memory-bridge`。
