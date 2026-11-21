# 验证记录 / Verification log

日期：2026-11-15。基线：上游 `vectorize-io/hindsight@5318be8`。

## 自动化测试

`npm test` 覆盖：

- 旧 CommonJS mock e2e、统一 CLI 子进程
- MemoryUnit/kmb1/kmb2、双时间轴、实体/链接、payload
- bank 隔离、bank config、文档 hash/切块、directives
- Defense 46＋1 类：CJK、特定前缀、GitHub 家族、支付、PEM/JWT/DB、Luhn/UUID、block/allow/policy
- TEMPR：BM25、cosine、时间窗/时间桶/传播、link expansion、RRF 数值、乘法 boost、预算
- lexical-hash、OpenAI embeddings、向量缓存、TEI rerank、故障 RRF 回退
- LLM JSON/客户端/抽取/observation/reflect 引用校验
- append-only→精确强化→LLM 纠正保历史→reflect→mental model 完整闭环
- DSH 14 工具注册、生命周期注入去重、长文档 chunks、mock concise
- reflect-agent 多轮检索、decision model 真实 id 校验、Knowledge Pages 原子生成、consolidation 状态机与锁、HTTP 鉴权与通用执行、cron/dry-run
- MCP handler 与真实 stdio 子进程

## 真实 KOOK 实弹

使用独立 `validation` bank，结束后删除全部临时单元并重建：

1. 缓存备份后删除，从真实频道全量恢复；稳定 msgId 不变。
2. `kmb2` 的 bank/document/entities/links 重建后完整，原位编辑不丢字段。
3. bank config 的 disposition/retain mode 重建后保留。
4. reflect 无 LLM 时返回真实分层证据，不生成伪答案。
5. append-only observation 写入成功；重复事实强化为 proof=2，刷新缓存后保持。
6. directive 进入 reflect applied ids；mental model scoped stale 正确。
7. 显式 `embeddingProvider=local` 开启语义臂并生成向量缓存。
8. 清理后默认缓存恢复为 3 条真实开发/验证记忆，重建失败数 0。

## 未伪装成已验证的部分

- 已使用 OpenAI-compatible LLM 与 NVIDIA 8B embedding 做真实 concise、Semantic、Mental Model full/delta、reflect 与全量重建验收；历史未配置 LLM 时的记录仅作对照。
- lexical-hash 是确定性词汇回退，不是神经语义 embedding。
- 未运行上游 PostgreSQL/torch 服务，也未跑 LongMemEval/LoCoMo；不声称 benchmark 对齐。

## 2026-11-21 v0.4.0 真实验收

- HTTP `/healthz` 与 `/v1/tools` 均返回 14 个工具；`kook_http` 自身也包含在注册表中。
- 真实 reflect 返回 `mode=reflect`、`iterations=2`、decision model 启用，回答包含真实证据 ID；decision model 能识别证据不足。
- `kook_consolidate` 返回 `state=committed`；失败状态持久化并可恢复。
- 三频道 `文字频道/mental/exp` 路由实测通过；跨频道重建 `imported=195, failed=0`。
- embedding 上游拒绝时按预期回退关键词/RRF，reflect 不被单条拒绝拖垮。
