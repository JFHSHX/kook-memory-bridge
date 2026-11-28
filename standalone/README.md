# 独立 Mental Model 调度器

这是一个**独立 Node.js 程序**：不调用 Hindsight API，不使用 DSH schedule_create，也不需要 DSH agent 会话。它只复用 kook-memory-bridge 自身的插件模块和 KOOK 数据目录。

## 能力

- 每小时 UTC 整点执行 delta：只有 stale 才调用 LLM；也支持每模型五字段 cron 与动态 next-run。
- 每周日 03:30 UTC 执行 full：只有上次 full 后发生过 delta 才重建；支持 `full_refresh_cron`、`refresh_after_consolidation`、`min_refresh_interval_seconds` 和 dry-run。
- 首次或缺少 `<!-- mm:` 基线时先 full。
- 每个模型最多重试 3 次；失败后暂停，检测到外部手动刷新成功后恢复。
- 独立记录 lastFullCompletedAt，原子写状态文件。
- 单实例锁、防重复 daemon、日志脱敏。

## 要求

- Node.js >= 20。
- KOOK 插件位于本仓库。
- `KOOK_BOT_TOKEN` 环境变量，或 config.json 中的 botToken。
- 聊天与 embedding 所需环境变量，例如 `NS_API_KEY`。
- 默认读取 `~/.dsh/kook-memory/config.json`；可用 `KOOK_MEMORY_HOME` 整体迁移数据目录。
- 支持可选多频道路由：config.json 配 `channels: { mental, exp }` 后，模型与分块写入 `mental` 频道、experience 写入 `exp` 频道，重建遍历全部配置频道；不配置则与单频道行为一致。

## 命令

在仓库根目录执行：

```bash
# 查看模型和下次运行时间
node standalone/index.mjs --status

# 立即执行一次增量检查
node standalone/index.mjs --once delta

# 立即执行一次全量门控检查
node standalone/index.mjs --once full
node standalone/index.mjs --once dry-run

# 常驻运行：启动时先检查 delta，再按 UTC 计划调度
node standalone/index.mjs --daemon

# DSH 插件方式：配置 autoStartRuntime=true 后，DSH 启动自动启动完整运行时，停止时自动清理

# 独立 HTTP API（与 kook_http 共用注册表）
node standalone/http.mjs
# 可配 KOOK_HTTP_TOKEN、KOOK_HTTP_HOST、KOOK_HTTP_PORT
```

状态与日志默认位于 KOOK 数据目录：

- `scheduler-state.json`：失败暂停和 full 水位。
- `scheduler-state.json.lock`：单实例锁。
- `scheduler.log`：运行日志，不记录密钥或模型全文。

可用 `KOOK_SCHEDULER_STATE` 覆盖状态文件路径。

## Windows 后台启动

Windows 任务计划程序只负责在登录时启动常驻进程，**不承担每小时/每周刷新逻辑**。示例（把路径替换为实际仓库路径）：

```powershell
$repo = 'C:\path\to\kook-memory-bridge'
$action = New-ScheduledTaskAction -Execute 'node.exe' -Argument "$repo\standalone\index.mjs --daemon"
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName 'KOOK Memory Scheduler' -Action $action -Trigger $trigger -Description 'Independent KOOK mental-model scheduler'
```

## 测试

```bash
node standalone/scheduler.test.mjs
```
