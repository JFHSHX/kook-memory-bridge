# 交接说明 / Handoff

## 当前版本与位置

- 版本：v0.4.0（隔离 worktree：`C:\Users\Administrator\.dsh\dsh-go\plugins\kook-memory-bridge\.agents\worktrees\kook-hindsight-parity`）。
- 主仓库：`C:\Users\Administrator\.dsh\dsh-go\plugins\kook-memory-bridge`。
- KOOK 主库与本地缓存/向量分离；频道 ID 与密钥只在本地配置，不进入仓库。

## 已交付模块

1. `plugin/lib/reflect-agent.js`：完整多轮 reflect 与 decision model。
2. `plugin/lib/pages.js`：Knowledge Pages 文件后端与 `kook_pages`。
3. `plugin/lib/consolidation-state.js`：状态机、锁、恢复、去重。
4. `plugin/lib/http-server.js`：HTTP API 与 `kook_http`；`standalone/http.mjs` 独立启动。
5. `standalone/cron.mjs`、`standalone/scheduler-core.mjs`：每模型 cron、最小间隔、after-consolidation、dry-run 和动态 next-run。

## 验证命令

```bash
npm test
node standalone/scheduler.test.mjs
node standalone/cron.test.mjs
node standalone/scheduler-cron.test.mjs
node standalone/index.mjs --status
node standalone/index.mjs --once dry-run
node standalone/http.mjs
```

真实验收还验证了 HTTP 14 工具、真实 reflect、consolidation committed、三频道 `195/0` 重建。临时验收脚本不进入仓库，也不保留测试记忆。

## 配置提醒

- `KOOK_BOT_TOKEN`、`KOOK_CHANNEL_ID`、AES key 与模型 API key 通过本地配置或环境变量提供。
- 中转密钥环境变量名按用户当前配置为 `a`；不要在文档、日志、Release 或记忆中写入实际值。
- 可选频道映射：`channels.mental` 与 `channels.exp`；不配时保持单频道兼容。
- `llmDisableThinking=true` 用于推理模型；慢速 embedding 可调整 `embeddingTimeoutMs`。

## 未完成边界

- 未复刻 PostgreSQL/Oracle、分布式队列、多租户、附件多模态、完整上游 39 工具协议、完整 fs mount/admin UI。
- HTTP 是 localhost JSON API，默认无 TLS；生产使用应放在反向代理之后并配置 `KOOK_HTTP_TOKEN`。
- `reflect-agent` 不是上游所有 structured-output/provider 变体的逐行移植。

## 后续建议

1. 合并 worktree 分支并运行完整测试。
2. 推送 main 后创建 v0.4.0 GitHub Release。
3. 若继续补齐，优先做完整文档 replace/append delta、更多 BM25 后端与运维 trace。
