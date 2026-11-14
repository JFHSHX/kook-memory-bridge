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
- Reflect-lite with layered evidence, citation validation and directives; no invented answer when no LLM is configured
- Mental models with scoped staleness, watermarks, full/delta refresh, untouched-block preservation and page projection
- 46 upstream Defense patterns plus KOOK tokens, CJK-safe boundaries, Luhn/UUID filtering and fingerprint-only audit hits
- DSH plugin/lifecycle integration, CLI and standard MCP stdio with 12 tools

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
- `embeddingProvider=openai-compatible`: configure `embeddingBaseURL`, `embeddingModel`, `embeddingApiKeyEnv`
- `rerankerProvider=tei|openai-compatible`: configure `rerankerBaseURL`, `rerankerModel`, `rerankerApiKeyEnv`
- Without an LLM, reflect returns evidence only and consolidation is append-only/exact strengthening

## Tools

`kook_status`, `kook_retain`, `kook_recall`, `kook_rebuild`, `kook_bank`, `kook_forget`, `kook_edit`, `kook_pin`, `kook_reflect`, `kook_consolidate`, `kook_mental_model`, `kook_directive`.

```bash
dsh plugin --profile web add ~/.dsh/dsh-go/plugins/kook-memory-bridge
```

Restart the engine after code changes. `autoCapture` is opt-in and also requires an LLM.

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
