# kook-memory-bridge（DSH 插件）

KOOK 唯一事实源的 Hindsight 风格记忆引擎。日期与标签明文，正文 AES-256-GCM；本地 `index.jsonl` 与 `vectors.json` 都是可重建缓存。`kmb2` 保存 MemoryUnit、bank、文档、双时间轴、实体、链接与证据。

## 工具（12）

- 基础：`kook_status` / `kook_retain` / `kook_recall` / `kook_rebuild`
- 管理：`kook_bank` / `kook_edit` / `kook_forget` / `kook_pin`
- Hindsight：`kook_reflect` / `kook_consolidate` / `kook_mental_model` / `kook_directive`

retain 支持 `concise/verbose/custom/verbatim/chunks`；无 LLM 明确降级 chunks。recall 使用 TEMPR＋RRF，可选 local/OpenAI embedding 和 TEI/OpenAI rerank。reflect 无 LLM 时只返回分层证据。consolidation 无 LLM 时只做 append-only＋精确强化。

## 配置

`~/.dsh/kook-memory/config.json`（0600，可用 `KOOK_MEMORY_HOME` 覆盖）：

```json
{
  "botToken": "<KOOK bot token>",
  "channelId": "<文字频道 id>",
  "key": "<64 hex；或 passphrase+kdfSalt>",
  "embeddingProvider": "none",
  "llmBaseURL": "https://your-gateway/v1",
  "llmModel": "your-model",
  "llmApiKeyEnv": "NS_API_KEY"
}
```

可选：`embeddingProvider=local`、`embeddingBaseURL/Model/ApiKeyEnv`、`rerankerProvider=tei`、`rerankerBaseURL/Model/ApiKeyEnv`。`autoCapture=true` 且配置 LLM 后才会自动沉淀。

## 安装、测试与 MCP

```sh
npm test
dsh plugin --profile web add ~/.dsh/dsh-go/plugins/kook-memory-bridge
node bin/mcp-stdio.js
```

MCP stdio 支持 initialize/tools/list/tools/call。lib 改动后在 App「引擎」页重启。完整功能与限制见仓库 `README.md`、`README.en.md` 和 `docs/hindsight-feature-matrix.md`。
