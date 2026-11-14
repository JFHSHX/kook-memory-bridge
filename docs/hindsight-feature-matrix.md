# Hindsight → kook-memory-bridge 可执行功能矩阵

> 基线：本机 upstream/hindsight 提交 `5318be8ea572aa00ceae636c71c1d8d334f805b6`（2026-11-14）；参考 hindsight-tg/docs/hindsight-intel.md，但以当前源码为准。
> 路径缩写：`U=hindsight-api-slim/hindsight_api`，`D=hindsight-docs/docs/developer`，`K=/root/workspace/kook-memory-bridge`。
> 优先级：P0=先做/修正底座，P1=核心体验，P2=外部模型接入后增强，P3=不纳入零依赖近期范围。
> 零依赖仅指 Node 18 标准库；LLM/embedding/reranker 可走 HTTP，但不能把“远程模型存在”写成“本地模型已复刻”。KOOK 仍是密文事实源，本地索引是缓存。

## 〇、当前实施状态（2026-11-15，第二轮后）

| 能力 | 状态与位置 |
|---|---|
| KOOK 主库、原子缓存重建、稳定 msgId | **已实弹**：`plugin/lib/core.js`；缓存删除后从真实频道恢复 |
| versioned MemoryUnit、bank/document/chunk、双时间轴、实体/链接/proof/payload | **已实弹**：`units.js`＋`retain.js`，kmb2 富字段可重建 |
| bank 隔离、disposition/mission/config、directives | **已实弹**：`banks.js`、`bank-tool.js`、`advanced-tools.js` |
| 五种 retain modes | **已接主流程**：chunks/verbatim 离线；concise/verbose/custom 走 LLM，未配置明确降级；长文档与 mock concise 通过 |
| TEMPR / RRF / boost / budget | **已接 `kook_recall`**：`retrieval.js`、`search.js`；BM25＋可选语义＋时间＋link expansion，公式数值测试通过 |
| embedding / rerank | **已接**：local lexical-hash、OpenAI embeddings、TEI/OpenAI rerank；向量缓存与故障 RRF 回退通过 |
| observations | **已接 `kook_consolidate`**：无 LLM append-only＋精确强化；LLM scope 对账、证据并集、历史保留、raw facts 不改 |
| reflect | **reflect-lite 已接 `kook_reflect`**：分层检索、disposition/directives、真实 id 引用校验；无 LLM 返回证据。**不是完整 agent loop** |
| mental models | **已接 `kook_mental_model`**：scoped stale、watermark、full/delta、失败保旧文、未变块保留；定时调度未做 |
| Defense | **已统一到 retain/edit**：46＋KOOK、Luhn/UUID/指纹；可选本地 prompt-injection heuristic，不冒充 cloud |
| DSH / CLI / MCP | **12 工具＋生命周期注入＋统一 CLI＋MCP stdio**；HTTP 与全 39 工具未做 |
| pages | **仅有 knowledge-page 投影纯函数**；无 fs mount/后台页面服务 |
| 真实验证 | 全部离线测试＋真实 KOOK 主库/kmb2/bank/observation/directive/mental/local-vector；生成式 LLM 为 mock，本机未配 key |

> 以下第一至三节保留第二轮前的差距基线和精确上游公式。“当前 KOOK 状态”列描述的是当时起点；最新完成度以本节和 [verification.md](verification.md) 为准。

## 一、总矩阵（第二轮前基线：现状 → 下一步 → 降级边界）

| 功能与上游证据 | 当前 KOOK 状态 | 零依赖 JS 下一步（优先级） | 合理降级 / 不能复刻 |
|---|---|---|---|
| **数据模型**：`U/engine/memories/base.py:301-357,570-648`；`U/alembic/versions/5a366d414dce_initial_schema.py:183-306,418-499`；`b7c4d8e9f1a2_add_chunks_table.py:24-58` | `K/plugin/lib/core.js:164-190` 是扁平 JSONL，只有 id/msgId/ts/tags/text/date 等；无双时间轴、chunk、证据边。 | **P0** 用 versioned JSONL 定义 `Bank/Document/Chunk/MemoryUnit/Entity/Link`；MemoryUnit 至少有 `id,bankId,documentId,chunkId,text,factType,context,tags,metadata,occurredStart/End,mentionedAt,createdAt,updatedAt,observationScopes,proofCount,sourceMemoryIds,consolidatedAt`。原文只在 KOOK 密文消息，派生索引可重建。 | 不复制 PostgreSQL 类型/索引。旧条目缺字段按 world + mentionedAt=ts 迁移；不伪造 occurred 时间。PG 的事务、UUID 外键、pgvector/Oracle 属**不可原位复刻**。 |
| **banks**：隔离、自动创建、配置覆盖 `U/engine/config_resolver.py:1-8`；`U/alembic/versions/x9s0t1u2v3w4_add_bank_config_column.py:35-50`；`D/api/memory-banks.mdx:23-41,97-140` | 当前相当单一 default bank，配置散在 config.json；无 bank 生命周期/alias。 | **P0** 先显式 `default` bankId，所有索引 key 带 bankId，配置采用 defaults→bank overrides；缺失读不静默当空库。**P1** 多 bank 文件分区与 list/create/get/update/delete；查询不跨 bank。 | 单 bank 可作为长期降级。多租户、API key metering、alias/primary、跨实例 transfer 属 P3；不能把频道标签过滤误称 bank 隔离。 |
| **retain extraction modes**：`U/engine/retain/fact_extraction.py:1081-1166,1204-1240,1597-1748,3515-3572,3612-3615,3722-3768`；`D/api/memory-banks.mdx:112-126` | `K/src/bridge.js:53-69` 一条输入直接一密文一索引；无五种模式和 LLM 抽取。 | **P0** `chunks`（切 chunk→原文 unit，无 LLM）与 `verbatim`（原文 unit + 可选远程元数据）先行；**P1** concise/custom（结构化 JSON、共指/时间/说话人）；**P2** verbose。`retain_mission` 注入用户消息而非替换输出 schema。assistant 映射 experience，其余 world。 | 无 LLM 时只允许 chunks 自动降级并明确标记，不能假装完成 concise/verbose。图片、附件、Batch API、文档 replace/append delta 全量等价属 P3。 |
| **TEMPR 四路**：`U/engine/search/retrieval.py:129-272`；`U/engine/memories/pg/recall.py:29-306,309-701`；`U/engine/memories/pg/link_expansion.py` | `K/plugin/lib/core.js:193-227` 是子串覆盖 × recency × proof；`K/src/store.js:47-58` 仅关键词数+新者。 | **P0** 统一四路接口与 `RetrievalResult`，先实现 keyword、temporal，semantic/graph 可空；**P1** 远程 embedding 后开 semantic；**P2** 实体扩展后开 graph。每路独立排序，不能混用原始分数。 | 无 embedding 时 semantic/graph 必须显式 disabled，不以子串分冒充 cosine；无日期解析时 temporal 仅接受显式 window。完整 dateparser/T5、五种 BM25 后端、HNSW 属不可零依赖复刻。 |
| **RRF / rerank**：`U/engine/search/fusion.py:8-109`；`recall_boost.py:73-245`；`reranking.py:179-309`；`U/engine/memory_engine.py:10396-10914` | 当前只有单个 base，无候选臂、rank、CE fallback 或 temporal boost。 | **P0** 原样实现 RRF(k=60)、RRF-only 排名映射和三个乘法 boost；**P1** HTTP reranker，失败回退 RRF；**P2** strategy boosts。token 装填跳过超长项、全放不下保第一项。 | 不实现本地 CE/决策模型；显式 `rrf` 必须跳过 stage-2 additive boost。决策模型顺序与 stage-3 互斥，不能叠公式。 |
| **实体与图扩展**：`U/engine/memories/pg/entity_resolver.py:1163-1500`；`link_expansion.py:1-27,233-297`；`links.py:44-146,569-658` | tags 有弱分类作用；无实体注册、消解、unit_entities 或 links。 | **P1** 建 entity/unit_entity/link 表，先做大小写不敏感精确实体与共享实体一路扩展；**P2** 加名字/共现/时间消解和 semantic/causal 边。图分数按当前 link-expansion，不抄旧扩散激活。 | 无 NER 时只接受调用方/LLM 已给实体；无向量不建 semantic kNN。spaCy/pg_trgm 和完整歧义防护不承诺；错误合并须可查看并拆分。 |
| **reflect agent loop**：`U/engine/reflect/agent.py:159-170,1220-1310,1434-1878,2289-2459`；`tools_schema.py:18-175,216-255,385-484` | 无 reflect；只有召回和 prompt 注入。 | **P1** 单 bank 小循环：search_mental_models→search_observations→recall，按需 read/expand，最多 10 轮；answer_found=false 且未 recall 时强制 recall；done 仅接受检索过的 id；保存 based_on/tool_trace。**P2** decision-model 并行轮。 | 无工具调用模型时用一次性“分层检索+生成”而非假 agent；上下文超限应 map/reduce 或明确失败。完整 provider 容错、长度重写、structured_output 二次抽取可后置。 |
| **observations consolidation**：`U/engine/consolidation/consolidator.py:791-1089,1820-2243,2900-3278,3365-3545`；`prompts.py:98-221`；`D/observations.mdx:39-134` | KOOK 可有 digest 概念，但当前核心无独立 observation unit、scope 状态机和可靠证据表。 | **P1** raw fact 永不改；新增 `kind=lasting|momentary`、effect=`unrelated|repeats|changes|ends`、`adds` 与 `same_as_fact`，再生成 create/update/delete/skip；proofCount=去重 source ids；repeats 只加证据，changes/ends 保历史；consolidatedAt 与 observation 同一本地原子写。 | 无 LLM 只能 append-only，不可自动判矛盾。0.97 向量去重须等 embedding；先只用规范化精确文本。scope 并行锁、崩溃恢复、云端 triage 属 P3。 |
| **mental models**：`D/mental-models.mdx`；`D/api/mental-models.mdx:108-264`；`U/engine/response_models.py:1035-1254`；`U/engine/mental_model_refresh.py:132-203` | 置顶 pin 卡最接近预写答案，但无 source_query、watermark、delta 文档树。 | **P1** `id,name,sourceQuery,content,tags,trigger,basedOn,lastRefreshedAt,lastMemorySeenAt`；读取零 LLM；只有 scope 内新写入才 stale/refresh。**P2** full/delta，delta 对 section/block id 操作，未触及块逐字保留；失败保旧文和水位。 | 先手动 refresh + full；KOOK pin 只是投影不是事实源。cron、失败暂停、scheduled full、history/dry-run/trace 完整 parity 属 P3；删除不自动置 stale 的上游陷阱不要照搬，可选择显式重建。 |
| **directives**：`U/engine/directives/models.py:9-37`；`U/engine/memory_engine.py:16498-16523`；`D/api/memory-banks.mdx:577-678` | 插件 POLICY 是全局静态提示，不是 bank 内可管理规则。 | **P1** 独立 Directive `{id,bankId,name,content,priority,isActive,tags}`；untagged 全局、tagged 按 reflect scope，applyAll 可绕过；按 priority 注入 reflect 首尾并返回 directivesApplied。 | “硬规则”仍是 prompt 约束，不能声称形式化合规。`directive_compliance` 只是模型自证；确定性的禁词/密钥拦截须由 defense/validator 做。CRUD/version UI 可后置。 |
| **Memory Defense**：`U/extensions/memory_defense.py:24-333`；`extensions/builtin/memory_defense_regex.py:25-57`；`U/engine/retain/orchestrator.py:1834-1920`；`D/memory-defense/index.md` | `K/plugin/lib/core.js:248-295` 已有 CJK 安全边界、redact/block 和 KOOK token，但目录较窄、无 Luhn/指纹命中；`K/src/bridge.js:7-8` 旧 CommonJS 仍是 allow stub。 | **P0** 先统一两条入口共用 defense，再补齐上游当前 **46** 个 pattern（文档仍写45）、特定前缀优先、Luhn+重复数字/UUID排除、只存 `[REDACTED:type]` 与指纹；redact 同时覆盖正文和 document body；全 block 错、部分 block 对齐索引。 | OSS 仅 sensitive_data 的 allow/redact/block；prompt_injection/quarantine/protected/immutable 等 cloud 能力不可冒充。审计/webhook/receipt_uri 可降级为本地 diag；历史数据不回溯，密钥绝不进日志。 |
| **MCP API**：`U/mcp_tools.py:49-112,1017-1735`；`U/api/mcp.py:114-209,333-661`；`D/mcp-server.md` | 已有宿主工具 `kook_status/retain/recall/forget/edit/pin`，不是上游 39 工具 MCP server。 | **P0** 保持现有工具，先对齐 retain/sync_retain/recall/reflect 参数、错误和 read-after-write；**P1** stdio JSON-RPC initialize/tools/list/tools/call + 单 bank；**P2** HTTP `/mcp/{bank}/` 与 X-Bank-Id、allowlist/annotations；**P3** 全 39 工具。 | 当前源码是 **39 全量 / 36 单 bank**，不是文档旧数字30/27。FastMCP session/SSE、tenant/auth、扩展点不必自研；不能提供协议时只承诺宿主工具兼容，不自称 MCP。 |

## 二、必须照抄的精确算法（防旧报告漂移）

### 1. 四路含义与 RRF

- semantic：`similarity = 1 - cosine_distance`，默认下限0.3；独立降序。关键词：native 是 tsvector/ts_rank_cd（不是严格 BM25），其余为可插拔后端；图：见下；temporal：仅在解析/显式给出 window 时加入，window 是召回臂**不是全局过滤**。
- temporal 先取窗口重叠且语义达标的前60/事实类型，再分8桶、每桶按 similarity 分层轮选10个入口；可沿 temporal/causal 边走最多5批迭代。中心 prox=`1-min(daysFromMid/(windowDays/2),1)`（零宽=1，无日期入口=.5）；邻居传播=`parentTemporal × linkWeight × relationBoost × 0.7`，causes/caused_by=2、enables/prevents=1.5，其余1，最终 temporalScore=`max(prox, propagated)`。
- 对候选 d，只累加它实际出现的臂：`RRF(d)=Σ_{i∈{semantic,bm25,graph,temporal}, d∈L_i} 1/(60+rank_i(d))`，rank 从1开始、四臂等权、缺臂不补0分；按 RRF 降序并赋 rrfRank。同一 id 首次出现的 payload 获胜，但各臂 rank/score 分存。`interleave` 是 consolidation 专用替代，不能混入普通 TEMPR 公式。
- 预裁默认 top300；每臂 cap 默认0=不关。无 CE 时按 RRF 顺序第 j（0基）造 `base_j=1-0.9*j/max(1,n-1)`，落[0.1,1]，再施 boost。CE 全部原始分已在[0,1]则原样用，否则逐个 sigmoid。
- 默认最终分：`final=CE_norm × (1+.2(recency-.5)) × (1+.2(temporal-.5)) × (1+.1(proofNorm-.5))`；默认 `recency=clamp(1-days/365,.1,1)`，无日期=.5，`proofNorm=clamp(.5+ln(proofCount)/10,0,1)`，非 temporal/非 observation 对应信号=.5。可选 exponential/none recency，不必首版实现。总极值约+27%/-23%。
- strategy boost 不改原始 RRF：超出300预裁时排序分=`rrf + Σ[1/(60+r_i/D_i)-1/(60+r_i)]`，low/medium/high 的 D=2/4/8。真实 CE 后另加 `A_i×D_i/(D_i+r_i-1)`，A=.05/.2/.5；temporal 不随 rank 衰减恒为 A；passthrough 不加。
- 证据：`U/engine/search/fusion.py:29-109`、`recall_boost.py:112-245`、`reranking.py:255-309`、`U/engine/memories/pg/recall.py:309-701`。

### 2. 图与实体公式

- 当前图臂是 semantic seeds 的 **link expansion**，不是旧报告的通用 `A(f,t+1)`：entity=`tanh(.5×sharedDistinctEntityCount)`；semantic/causal 各取该候选最大边权；`graphScore=entity+semantic+causal ∈[0,3]`，降序截 budget 后才进入 RRF。实体扇出默认每实体200；超时非 observation 可退 semantic+causal，observation 图臂为空但其他臂继续。Observation 经 sourceMemoryIds→raw facts→entities→other observations。
- 链构建：temporal 同 factType、24h 内，`w=max(.3,1-hours/24)`，每 unit 顶20；semantic 默认阈值0.7；retain 只新写 caused_by，历史 causes/enables/prevents 只供导入/读取。
- 实体候选先过 trigram≥0.3与逐词/数字兼容门；若 trigram=1直接 score=1，否则 `score=.5×SequenceMatcherRatio + .3×(Σ_{共享附近实体}1/sqrt(degree)/|附近实体|) + .2×max(0,1-days/7)`（最后一项仅<7天），`round(score,6)>=.6` 才复用。label 与 resolve_entities=false 仅大小写精确匹配，不能模糊合并。
- 证据：`U/engine/memories/pg/link_expansion.py:233-297`、`entity_resolver.py:1230-1500`、`links.py:44-146,569-658`。

### 3. Consolidation / mental model 的不可省不变量

- Scope：combined=全部 tags 一个集合；per_tag=每 tag；all_combinations=所有非空子集；shared=`[[]]` 全局 untagged；显式空 `[]` 仍回退 combined，不等于 shared。不同 scope 不进同一 LLM call，已有 observation 用 all_strict 精确 scope，防串租户证据。
- 时间：event_date/occurredStart 取所有 source 最早非空，occurredEnd/mentionedAt 取最新非空；proofCount 是去重且仍存活的 source 数，不是“ reinforce 调用次数”。历史表每 observation 最近50版本；近重 top5、cos≥.97 后由 LLM merge/keep，PG only，不能拿阈值自动合并否定/数字/实体差异。
- Mental model trigger：full/delta；refresh_after_consolidation 与 refresh_cron 互斥；full_refresh_cron 独立；自动刷新最小间隔合并等待任务。stale 比较的是 lastMemorySeenAt 而非 lastRefreshedAt；delta 只看新记忆但 basedOn 累积；无基线或 sourceQuery 改变回 full；失败不得用空答案覆盖旧文。
- 证据：`U/engine/consolidation/consolidator.py:501-693,987-1182,3365-3545`；`U/engine/response_models.py:1035-1254`；`D/api/mental-models.mdx:209-264`。

## 三、建议落地顺序与验收

1. **P0（纯函数先行）**：versioned schema/default bank、chunks、四路接口中的 keyword+temporal、RRF及组合分、统一 Defense；mock 固定输入断言上述公式，而非只测“能返回”。
2. **P1（记忆闭环）**：observations/source ids/scope、directives、手动 mental model、实体精确图、reflect-lite；保留旧 JSONL 的导入/重建工具和错误提示。
3. **P2（远程能力）**：OpenAI-compatible embedding/rerank/LLM adapter，再开 semantic graph、向量去重、verbose、decision model、stdio/HTTP MCP。
4. **P3（明确暂缓）**：本地神经模型、PG/Oracle、完整分布式队列与多租户、五 BM25 后端、全39工具/pages/fs mount、附件多模态、完整运维 trace/迁移矩阵。

**最小回归清单**：RRF 同 id 多臂求和/缺臂；RRF-only 首尾=.1/1且boost不改RRF；时间窗不过滤其他臂；实体同名不同人不合并；重复事实只增证据；纠正保留历史且 raw fact 不丢；scope 不串证据；stale 模型必须回查 raw；未检索 id 不可引用；CJK 邻接 token、Luhn 假卡、PEM/JWT 不脱敏失败；KOOK 重建后索引与密文对账一致。
