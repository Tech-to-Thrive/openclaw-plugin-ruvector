# @openclaw/plugin-memory-ruvector

Long-term memory plugin for [OpenClaw](https://openclaw.dev) backed by [RuVector](https://github.com/Tech-to-Thrive/ruvector) — a high-performance vector database written in Rust.

Drop-in replacement for the `memory-milvus` plugin. Same tools, same hooks, zero subprocess overhead.

## Architecture

```
OpenClaw Gateway
  └── memory-ruvector plugin (TypeScript, ~800 LOC)
       ├── 7 tools (recall, store, forget, update, share, reindex, status)
       ├── 2 hooks (auto-recall on prompt, auto-capture on agent end)
       ├── Pluggable embeddings (Gemini default, OpenAI supported)
       ├── Agent scoping + sensitive agent isolation
       └── HTTP client → RuVector server (localhost:6333)
```

**Key difference from memory-milvus:** No Python subprocess, no bridge protocol, no PID file management. Direct HTTP to a Rust server — sub-millisecond on localhost.

## Prerequisites

- **Node.js** >= 20
- **Rust toolchain** (for building the server) or a pre-built RuVector server
- **RuVector server** running (default: `http://localhost:6333`)
- **Embedding API key** (Google Gemini by default, or any OpenAI-compatible provider)

## Quick Start — Server

This repo includes a minimal Rust server wrapper in `server/`:

```bash
# Build and run the RuVector server
cd server
cargo build --release
./target/release/ruvector-server

# Or with custom host/port:
RUVECTOR_HOST=127.0.0.1 RUVECTOR_PORT=6333 ./target/release/ruvector-server
```

The server uses the [`ruvector-server`](https://crates.io/crates/ruvector-server) crate (v0.1.30) from crates.io.

## Installation

```bash
# Clone into your OpenClaw extensions directory
cd ~/.openclaw/extensions
git clone https://github.com/Tech-to-Thrive/openclaw-plugin-ruvector.git memory-ruvector
cd memory-ruvector
npm install
```

Or add to your OpenClaw config:

```json
{
  "plugins": {
    "memory-ruvector": {
      "path": "~/.openclaw/extensions/memory-ruvector",
      "config": {
        "embedding": {
          "apiKey": "${GOOGLE_API_KEY}"
        }
      }
    }
  }
}
```

## Configuration

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `uri` | string | `http://localhost:6333` | RuVector server URI |
| `collectionName` | string | `fleet_memory` | Vector collection name |
| `embedding.apiKey` | string | *required* | Embedding API key (supports `${ENV_VAR}` syntax) |
| `embedding.model` | string | `gemini-embedding-2-preview` | Embedding model |
| `embedding.baseUrl` | string | Gemini endpoint | Base URL for embedding API |
| `embedding.dimensions` | number | auto-detected | Vector dimensions |
| `autoRecall` | boolean | `true` | Inject relevant memories before each prompt |
| `autoCapture` | boolean | `false` | Auto-capture important info from conversations |
| `recallLimit` | number | `3` | Max memories injected per prompt |
| `recallMinScore` | number | `0.01` | Minimum similarity score for recall |
| `captureMaxChars` | number | `500` | Max message length eligible for auto-capture |
| `sensitiveAgents` | string[] | `[]` | Additional agent IDs to privacy-isolate |
| `ttlEnabled` | boolean | `true` | Enable time-to-live for memories |
| `importanceDefault` | number | `0.5` | Default importance score (0-1) |

### Minimal config

```json
{
  "embedding": {
    "apiKey": "${GOOGLE_API_KEY}"
  }
}
```

### Full config example

```json
{
  "uri": "http://ruvector.internal:6333",
  "collectionName": "my_fleet_memory",
  "embedding": {
    "apiKey": "${GOOGLE_API_KEY}",
    "model": "gemini-embedding-2-preview",
    "dimensions": 3072
  },
  "autoRecall": true,
  "autoCapture": true,
  "captureMaxChars": 1000,
  "recallLimit": 5,
  "recallMinScore": 0.05,
  "sensitiveAgents": ["payroll", "legal"],
  "ttlEnabled": true,
  "importanceDefault": 0.5
}
```

### Using OpenAI embeddings

```json
{
  "embedding": {
    "apiKey": "${OPENAI_API_KEY}",
    "model": "text-embedding-3-large",
    "baseUrl": "https://api.openai.com/v1",
    "dimensions": 3072
  }
}
```

## Tools

### `memory_recall`
Search through long-term memories by semantic similarity.

```
query: "user preferences for IDE"
limit: 5  (optional, default: 5, max: 20)
```

### `memory_store`
Save important information — preferences, facts, decisions, entities.

```
text: "User prefers dark mode in VS Code"
category: "preference"  (optional: preference|fact|decision|entity|other)
importance: 0.8          (optional: 0.0-1.0)
ttl_days: 90             (optional: auto-expires after N days)
```

Built-in protections:
- Prompt injection detection (rejects malicious text)
- Exact dedup via SHA-256 chunk hash
- Near-dedup via cosine similarity > 0.85

### `memory_forget`
Delete memories by ID or semantic search. GDPR-compliant.

```
memoryId: "abc123def456..."  (direct delete by chunk_hash)
query: "that old API key"     (search-based: auto-deletes if 1 match > 0.9)
```

### `memory_update`
Supersede an existing memory with new content. Finds the closest match, deletes it, stores the replacement.

```
query: "employee count"
newText: "We now have 15 employees"
category: "fact"
```

### `memory_share`
Store a fleet-wide or multi-agent shared memory.

```
text: "Company switched from Slack to Teams"
scope: "fleet"                        (or "engineering,devops,qa")
category: "decision"
```

### `memory_reindex`
Re-index workspace markdown files into the memory database.

```
path: "/custom/docs/path"    (optional: defaults to ~/.openclaw/agents/)
agentId: "engineering"       (optional: required with custom path)
```

### `memory_status`
Health check and statistics.

Returns: server health, collection count, embedding model/cache, circuit breaker state.

## Hooks

### `before_prompt_build` (auto-recall)
Automatically searches memories relevant to the user's message and injects them as context. Respects agent scoping and sensitive agent isolation.

### `agent_end` (auto-capture)
Analyzes conversation messages for important information (preferences, decisions, contact info) and stores them automatically. Limited to 3 captures per conversation.

## Agent Scoping

Memories are scoped by `agent_id` — each agent only sees its own memories plus shared ones.

**Sensitive agents** (`finance`, `hr`, `home`, `vendor` by default) are fully isolated:
- Their memories never appear in cross-fleet searches
- They cannot see other agents' memories
- Add more via the `sensitiveAgents` config option

**Shared memories** (via `memory_share`) can be scoped to:
- `"fleet"` — visible to all non-sensitive agents
- Comma-separated agent IDs — visible only to listed agents

## Circuit Breaker

If the RuVector server becomes unreachable, the circuit breaker opens after 5 consecutive failures. During the 60-second cooldown:
- Tools return clear error messages
- Hooks silently skip (never block the agent)
- After cooldown, the circuit resets and retries

## Migration from memory-milvus

```bash
# Ensure RuVector server is running, then:
npx tsx migration.ts

# Options:
npx tsx migration.ts --milvus-db ~/.memsearch/milvus.db \
                     --ruvector-uri http://localhost:6333 \
                     --collection fleet_memory \
                     --dimension 3072

# Dry run (export only, don't import):
npx tsx migration.ts --dry-run
```

The migration tool:
1. Exports all records from Milvus Lite via the Python bridge
2. Imports into RuVector with proper metadata mapping
3. Verifies per-agent counts match

## Testing

```bash
npm test           # Run all tests
npm run test:watch # Watch mode
```

## RuVector REST API Reference

The plugin communicates with RuVector via these endpoints:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/collections` | Create collection |
| GET | `/collections/:name` | Get collection info |
| PUT | `/collections/:name/points` | Upsert points |
| POST | `/collections/:name/points/search` | Vector search |
| GET | `/collections/:name/points/:id` | Get point by ID |
| POST | `/collections/:name/points/delete` | Delete points |

## File Structure

```
├── index.ts           # Plugin entry: 7 tools + 2 hooks + service
├── client.ts          # RuVectorClient HTTP wrapper (fetch-based)
├── embeddings.ts      # Embedding providers (Gemini, OpenAI via OpenAI SDK)
├── types.ts           # TypeScript interfaces
├── config.ts          # Config validation + defaults
├── migration.ts       # Milvus → RuVector migration CLI
├── server/            # Rust server binary wrapper
│   ├── Cargo.toml     # Depends on ruvector-server from crates.io
│   └── src/main.rs    # Minimal server launcher (15 LOC)
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── LICENSE            # MIT
├── README.md
└── tests/
    ├── client.test.ts
    ├── config.test.ts
    ├── embeddings.test.ts
    ├── hooks.test.ts
    └── tools.test.ts
```

## License

MIT - Tech to Thrive Inc.
