# v0.4.0 — Hindsight 第二阶段完整能力

## 新增

- **完整 Reflect Agent Loop**：`plugin/lib/reflect-agent.js` 提供有界多轮检索、decision model、真实 ID 校验、answer_found/done/next_query 与 toolTrace；无 LLM 时保留 evidence-only。
- **Knowledge Pages 文件服务**：`plugin/lib/pages.js` 与 `kook_pages` 由 Mental Model 原子生成 Markdown，支持安全读取与 stale 后台刷新。
- **完整 consolidation 状态机**：`plugin/lib/consolidation-state.js` 提供持久化状态、跨进程锁、失败恢复、精确/近似去重，raw facts 不改。
- **MCP/HTTP**：`kook_http` 与 `standalone/http.mjs` 将同一工具注册表暴露为 14 个工具，支持工具发现、通用执行、记忆/模型/页面路由和可选 Bearer 鉴权。
- **完整 Mental Model 调度**：`standalone/cron.mjs` 支持五字段 cron、每模型 `refresh_cron`、`full_refresh_cron`、`refresh_after_consolidation`、最小刷新间隔、dry-run 与动态 next-run。
- **Embedding 故障回退**：上游拒绝时回退关键词/RRF，并保留错误说明。

## 验证

- 根仓库与独立调度全套测试通过。
- 真实 KOOK：HTTP 14 工具、真实 reflect 多轮、consolidation committed、三频道重建 `195 imported / 0 failed`。
- 真实回答包含证据 ID；decision model 能识别证据不足。

## 边界

这是 KOOK 的 Hindsight 风格实现，不是 PostgreSQL/Oracle、分布式队列、完整上游 39 工具协议、附件多模态或完整 fs mount/admin UI 的替代。`reflect-agent` 是有界多轮循环，不等同上游所有 provider 的容错与 structured-output 变体。
