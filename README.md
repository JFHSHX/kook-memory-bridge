# kook-memory-bridge

[English README](README.en.md) · [Hindsight 功能矩阵](docs/hindsight-feature-matrix.md) · [验证记录](docs/verification.md)

KOOK 加密长期记忆引擎，复刻 [vectorize-io/hindsight](https://github.com/vectorize-io/hindsight) 的核心记忆循环。**KOOK 是唯一事实源，本地索引和向量都只是可重建缓存**；日期与标签明文，正文使用 AES-256-GCM。

## 已实现

- **存储**：全量分页、原子重建、稳定 id=`msgId`；`kmb1` 向后兼容，`kmb2` 保存 MemoryUnit JSON
- **数据模型**：bank、document/chunk、world/experience/observation/opinion、双时间轴、实体、temporal/semantic/entity/causal links、proof/source ids
- **banks**：严格隔离；disposition、retain/observations/reflect mission、配置也存 KOOK 并可重建
- **retain**：`concise / verbose / custom / verbatim / chunks`；无 LLM 时明确降级 chunks，长文档与实体/时间/语义链接
- **TEMPR**：BM25 关键词、可选 embedding 语义、时间窗与时间桶、语义种子的 link expansion、RRF(k=60)、三类乘法 boost、token 预算
- **providers**：确定性 lexical-hash 回退、OpenAI-compatible embeddings、TEI/OpenAI-compatible rerank；故障回退 RRF
- **观察与反思**：append-only/精确强化、LLM create/update/delete/skip、scope 隔离、证据与历史保留；reflect-lite 分层证据、引用 id 校验、directives
- **mental models**：scoped stale、watermark、full/delta、未变块保留、50 版历史、knowledge-page 投影
- **Defense**：上游当前 46 类＋KOOK token；CJK 边界、Luhn/UUID、指纹审计，可选 prompt-injection 检测
- **接入**：DSH 插件与生命周期注入、CLI、标准 MCP stdio（12 工具）

## 消息格式

```text
[2026-11-15] #fact #project
kmb2:<base64(iv|authTag|json-ciphertext)>
```

`kmb2` 解密后包含 `bank/documentId/chunkId/text/factType/context/occurredStart/occurredEnd/mentionedAt/entities/links/proofCount/sourceMemoryIds/payload` 等字段。明文画像卡不进入记忆缓存。

## 安装与配置

要求 Node ≥20，无 npm 运行依赖。

```bash
git clone git@github.com:JFHSHX/kook-memory-bridge.git
cd kook-memory-bridge
npm test
node cli.js status
```

配置 `~/.dsh/kook-memory/config.json`（0600；可用 `KOOK_MEMORY_HOME` 覆盖）：

```json
{
  "botToken": "<KOOK bot token>",
  "channelId": "<文字频道 id>",
  "key": "<64 位 hex；或改用 passphrase+kdfSalt>",
  "embeddingProvider": "none",
  "llmBaseURL": "https://your-openai-compatible-gateway/v1",
  "llmModel": "your-model",
  "llmApiKeyEnv": "NS_API_KEY"
}
```

可选 provider：

- `embeddingProvider=local`：离线 lexical-hash，**不是神经语义模型**
- `embeddingProvider=openai-compatible`：另配 `embeddingBaseURL/embeddingModel/embeddingApiKeyEnv`
- `rerankerProvider=tei|openai-compatible`：另配 `rerankerBaseURL/rerankerModel/rerankerApiKeyEnv`
- 未配置 LLM 时，reflect 返回分层证据，consolidation 只做 append-only/精确强化

## DSH 工具

`kook_status`、`kook_retain`、`kook_recall`、`kook_rebuild`、`kook_bank`、`kook_forget`、`kook_edit`、`kook_pin`、`kook_reflect`、`kook_consolidate`、`kook_mental_model`、`kook_directive`。

```bash
dsh plugin --profile web add ~/.dsh/dsh-go/plugins/kook-memory-bridge
```

代码变更后在 App「引擎」页重启。`autoCapture` 默认关闭，开启且配置 LLM 后才会在 turn-stopping 自动抽取。

## CLI 与 MCP

```bash
node cli.js retain "用户偏好 Vue" fact,project chunks
node cli.js recall "偏好"
node cli.js reflect "用户偏好什么？"
node cli.js consolidate
node cli.js rebuild

# MCP stdio
node plugin/bin/mcp-stdio.js
```

MCP 支持 `initialize`、`ping`、`tools/list`、`tools/call`，直接复用同一组 12 个 DSH 工具。

## 验证

```bash
npm test                 # 根 mock e2e + CLI + 插件全部测试
cd plugin && npm test   # 单元、公式、闭环、MCP、KOOK mock
```

真实 KOOK 已验证：缓存删除恢复、富字段与 bank config 重建、append-only 观察、proof 强化、directives、mental model stale、显式 local embedding。生成式 LLM 路径使用 mock；本机未配置 LLM 时以真实 KOOK 的证据模式验收。详见 [验证记录](docs/verification.md)。

## 与完整 Hindsight 的边界

不包含 PostgreSQL/Oracle、分布式队列、多租户、神经本地模型、完整 reflect agent loop/decision model、全量 39 工具 MCP/HTTP、pages/fs mount、附件多模态、完整 consolidation 状态机和定时刷新。时间解析是明确子集；关键词与图扩展是零依赖近似，不声称检索质量或 benchmark 对齐。完整对照见 [功能矩阵](docs/hindsight-feature-matrix.md)。

## License

MIT
