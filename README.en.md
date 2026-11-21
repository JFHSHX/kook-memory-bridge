# kook-memory-bridge

[中文 README](README.md) · [Hindsight matrix](docs/hindsight-feature-matrix.md) · [Verification](docs/verification.md)

An encrypted long-term memory engine on KOOK, reimplementing the core memory loop of [vectorize-io/hindsight](https://github.com/vectorize-io/hindsight). **KOOK is the single source of truth; local indexes and vectors are disposable, rebuildable caches.** Dates and tags remain readable; memory bodies use AES-256-GCM.

## What works

- Full-history pagination and atomic cache rebuilds; stable IDs equal KOOK `msgId`
- Backward-compatible `kmb1` and structured `kmb2` MemoryUnits
- Banks, documents/chunks, world/experience/observation/opinion facts, dual timelines, entities, temporal/semantic/entity/causal links, evidence counts and source IDs
- Strict bank isolation and KOOK-persisted bank configuration, dispositions and missions
- All five retain modes: `concise`, `verbose`, `custom`, `verbatim`, `chunks`; explicit fallback to chunks without an LLM
- TEMPR-style retrieval: BM25, optional embeddings, temporal windows/buckets, semantic-seed link expansion, RRF(k=60), multiplicative boosts and token budgets
- Deterministic lexical-hash fallback, OpenAI-compatible embeddings, TEI/OpenAI-compatible reranking with RRF fallback
- Append-only and exact-strengthening observations offline; scoped LLM reconciliation with evidence and historical preservation
- Reflect-agent with bounded multi-round retrieval, decision-model evaluation, real-ID validation and evidence-only fallback when no LLM is configured
- Mental models with scoped staleness, watermarks, full/delta refresh, untouched-block preservation and page projection; at most 5 evidence IDs and 2 short history previews, chunked storage, per-model cron, min refresh intervals, after-consolidation and dry-run
- 46 upstream Defense patterns plus KOOK tokens, CJK-safe boundaries, Luhn/UUID filtering and fingerprint-only audit hits
- DSH plugin/lifecycle integration, CLI and standard MCP stdio with 14 tools, plus an optionally Bearer-authenticated localhost HTTP API

## Wire format

```text
[2026-11-15] #fact #project
kmb2:<base64(iv|authTag|json-ciphertext)>
```

The encrypted JSON includes bank, document/chunk IDs, fact type, context, occurrence and mention times, entities, links, proof count, source IDs and system payloads. Plaintext profile cards are not memory units.

## Setup

Node ≥20; no runtime npm dependencies.

```bash
git clone git@github.com:JFHSHX/kook-memory-bridge.git
cd kook-memory-bridge
npm test
node cli.js status
```

Create `~/.dsh/kook-memory/config.json` (mode 0600; override the directory with `KOOK_MEMORY_HOME`):

```json
{
  "botToken": "<KOOK bot token>",
  "channelId": "<text channel id>",
  "key": "<64 hex chars; or use passphrase+kdfSalt>",
  "embeddingProvider": "none",
  "llmBaseURL": "https://your-openai-compatible-gateway/v1",
  "llmModel": "your-model",
  "llmApiKeyEnv": "NS_API_KEY"
}
```

Provider options:

- `embeddingProvider=local`: deterministic lexical hashing, **not a neural embedding**
- `embeddingProvider=openai-compatible`: configure `embeddingBaseURL`, `embeddingModel`, `embeddingApiKeyEnv`; NVIDIA asymmetric models also use `embeddingQueryInputType=query` and `embeddingDocumentInputType=passage`; slow requests can be tuned with `embeddingTimeoutMs`
- `rerankerProvider=tei|openai-compatible`: configure `rerankerBaseURL`, `rerankerModel`, `rerankerApiKeyEnv`
- Without an LLM, reflect returns evidence only and consolidation is append-only/exact strengthening
- Optional multi-channel routing: set `channels` in config.json to route content to separate channels; without it everything goes to the main channel

```json
"channels": { "mental": "<mental-model channel id>", "exp": "<experience channel id>" }
```

`mental_model` units and their chunk messages go to `mental`; `experience` memories go to `exp`; everything else goes to the main channel. Rebuild walks every configured channel and merges results (`msgId` is globally unique, so no duplicates).

## Tools

`kook_status`, `kook_retain`, `kook_recall`, `kook_rebuild`, `kook_bank`, `kook_forget`, `kook_edit`, `kook_pin`, `kook_reflect`, `kook_consolidate`, `kook_mental_model`, `kook_directive`.

```bash
dsh plugin --profile web add ~/.dsh/dsh-go/plugins/kook-memory-bridge
```

Restart the engine after code changes. `autoCapture` is opt-in and also requires an LLM. Set `autoCaptureFactType=experience` to route automatic captures to the `exp` channel; otherwise they go to the main channel.

## v0.4.0 second-stage capabilities

- `plugin/lib/reflect-agent.js`: bounded multi-round retrieval with a decision model, real-ID validation, answer_found/done/next_query decisions, and full tool traces.
- `plugin/lib/pages.js` + `kook_pages`: atomic Markdown generation from mental models, safe reads, and stale-driven background refresh.
- `plugin/lib/consolidation-state.js`: persistent state machine, cross-process locking, failure recovery, and exact/near-duplicate grouping.
- `plugin/lib/http-server.js` + `standalone/http.mjs`: tool discovery, generic execution, memory/model/page routes, and optional Bearer authentication.
- `standalone/cron.mjs` and the full scheduler: per-model `refresh_cron`, `full_refresh_cron`, `refresh_after_consolidation`, minimum refresh intervals, dry-run, and dynamic next-run calculation.

## Standalone Mental Model scheduler

Runs as an independent Node.js process without the Hindsight API, DSH `schedule_create`, or agent sessions. It provides hourly stale/delta checks, a weekly full-refresh gate, failure pausing and manual-success recovery:

```bash
node standalone/index.mjs --status
node standalone/index.mjs --once delta
node standalone/index.mjs --once full
node standalone/index.mjs --daemon
```

Reasoning models can set `llmDisableThinking=true` to send `chat_template_kwargs.enable_thinking=false`. See [standalone/README.md](standalone/README.md).

## CLI and MCP

```bash
node cli.js retain "User prefers Vue" fact,project chunks
node cli.js recall "preference"
node cli.js reflect "What does the user prefer?"
node cli.js consolidate
node cli.js rebuild

node plugin/bin/mcp-stdio.js
```

MCP supports `initialize`, `ping`, `tools/list`, and `tools/call` over stdio, using the same 12 tool definitions as DSH.

## Verification and limits

```bash
npm test
cd plugin && npm test
```

Real KOOK tests cover cache deletion/rebuild, rich-unit and bank-config persistence, append-only observations, proof strengthening, directives, mental-model staleness and local embeddings. Generative LLM paths are covered by mocks; evidence-only behavior is used for real KOOK validation when no LLM is configured. See [verification](docs/verification.md).

Not implemented: PostgreSQL/Oracle, distributed queues, multi-tenancy, local neural models, the full reflect agent loop/decision model, all 39 MCP tools or HTTP transport, pages/fs mount, multimodal attachments, the complete consolidation state machine and scheduled refreshes. Temporal parsing and zero-dependency retrieval are explicit subsets; no benchmark parity is claimed.

## License

MIT
