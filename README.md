# LLM Wiki

A personal knowledge workspace powered by LLMs. LLM Wiki incrementally builds and maintains a structured, interlinked wiki from your source documents. The LLM reads, extracts, and integrates knowledge into persistent markdown files — compiled once, kept current.

Single Go binary with embedded React web UI, REST API, and MCP (Model Context Protocol) server.

## Quick Start

```bash
# Build (requires Go 1.21+ and Node.js 18+)
make build

# Initialize a workspace
./llmwiki init ~/research

# Start the server
./llmwiki serve ~/research

# Open http://127.0.0.1:8868
```

For development without building the web frontend:

```bash
make dev
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `llmwiki init <dir>` | Initialize a workspace directory with scaffold files and SQLite index |
| `llmwiki serve [dir]` | Start HTTP API server with embedded web UI |
| `llmwiki reindex [dir]` | Force full rebuild of the SQLite index from filesystem |
| `llmwiki mcp [dir]` | Run MCP JSON-RPC 2.0 server on stdin/stdout (legacy local mode) |
| `llmwiki mcp-config` | Print MCP configuration JSON for Claude Desktop / Claude Code |
| `llmwiki version` | Print version, commit, and build date |

### Serve Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--bind` | `127.0.0.1` | Bind address |
| `--port` | `8868` | HTTP port |
| `--token` | | API token for authentication (optional) |
| `--public-wiki` | `false` | Enable public read-only Wiki at `/wiki` and `/api/public/wiki/*` |
| `--no-mcp` | `false` | Disable MCP server |
| `--no-watch` | `false` | Disable file watcher |

## Project Structure

```
llmwiki/
├── cmd/llmwiki/          # CLI entry point (cobra commands)
├── internal/
│   ├── api/              # REST API handlers (documents, search, graph, settings)
│   ├── engine/           # Core processing (chunking, frontmatter, references, reindex)
│   ├── ingest/           # Ingestion pipeline (queue, locking)
│   ├── llm/              # LLM client (OpenAI/Anthropic compatible)
│   ├── mcp/              # MCP JSON-RPC 2.0 server (stdio)
│   ├── server/           # HTTP server (chi router, SPA fallback)
│   ├── store/            # Storage layer (SQLite adapter, document service)
│   │   └── sqlite/       # SQLite driver (modernc.org/sqlite, FTS5)
│   └── watcher/          # File system watcher (fsnotify)
├── web/                  # React 19 + Vite + TypeScript frontend
├── docs/                 # Design documents
├── embed.go              # Embeds web/dist/ into the binary
└── Makefile              # Build, test, cross-compilation targets
```

## Workspace Structure

After `llmwiki init ~/research`:

```
~/research/
├── purpose.md            # Goals, key questions, research scope
├── wiki/
│   ├── overview.md       # Auto-maintained global overview
│   ├── log.md            # Append-only operation log
│   ├── entities/         # Entity pages
│   ├── concepts/         # Concept pages
│   ├── sources/          # Source summaries
│   └── ...
├── raw/
│   └── sources/          # Source documents (immutable)
└── .llmwiki/
    └── index.db          # SQLite index (rebuildable from files)
```

## Architecture

**Single-process, single-binary** architecture — all components run in one Go process:

1. **HTTP REST API** — For the web UI and remote clients. Serves at `/api/v1/`.
2. **MCP RPC Endpoint** — JSON-RPC 2.0 over HTTP POST at `/mcp`. This is the primary MCP access model.
3. **Embedded Web UI** — React 19 + Vite + TypeScript, served with SPA fallback.
4. **CLI** — For humans and scripts. Powered by cobra.
5. **File Watcher** — Automatic index updates on file changes.

**Data model**: Files are the source of truth. SQLite is an index only — deleting the database and running `reindex` fully rebuilds it. FTS5 provides full-text search with BM25 ranking.

**Web UI**: React 19 + Vite + TypeScript, embedded via `go:embed` into the binary. SPA with client-side routing, served with index.html fallback.

### Web-first Ingest Workflow

The Web UI separates two ingestion entry points:

- **Chat** (`/`): explore a topic with the assistant across multiple turns, then archive the session into the wiki when ready
- **Ingest** (`/ingest`): submit raw materials directly — upload multiple files and/or paste multiple text blocks, then click **直接归档** without a chat session

Both paths enqueue standard ingest jobs observable from **Jobs**:

- **Text ingest**: pasted or composed markdown/plain text
- **File upload ingest**: one or multiple files with accepted/rejected feedback
- **Ingest job observability**: lifecycle states (`queued`, `running`, `succeeded`, `failed`, `cancelled`), retry and cancel controls

All Web-submitted sources are persisted to workspace files under `raw/sources/web-ingest/` before enqueueing.

## MCP RPC-First Compatibility

The first release uses an **RPC-first** MCP access model. The MCP server is exposed as an HTTP POST endpoint at `/mcp` within the main `llmwiki serve` process.

**What works:**
- `initialize` — Returns server info, capabilities, and RPC-first metadata
- `tools/list` — Returns available tools with schemas
- `tools/call` — Dispatches to tool handlers
- Any HTTP-capable MCP client can connect

**First release does NOT require:**
- Direct Claude Desktop stdio connection (not a release gate)
- MCP proxy tool
- Zero system dependencies for PDF/Office processing

**Use `llmwiki mcp-config`** to generate configuration JSON for your MCP client. The generated config points to the RPC endpoint (`http-post` transport).

## Source Processing Tiers

First release supports PDF and Office documents via tiered processing:

| Tier | Description | Requirements |
|------|-------------|-------------|
| **A** | Built-in text extraction | None (always available) |
| **B** | System dependency extraction | `pdftotext` (PDF) or `libreoffice` (Office) |
| **C** | Degraded fallback | None (file recognized, extraction unavailable) |

Run `GET /api/v1/capabilities` to see current tier status and missing dependencies.

## Build Targets

```bash
make build              # Build web + Go binary
make build-web          # Build web frontend only
make build-go           # Build Go binary only
make build-linux-amd64  # Cross-compile for Linux amd64
make build-linux-arm64  # Cross-compile for Linux arm64
make build-darwin-amd64 # Cross-compile for macOS amd64
make build-darwin-arm64 # Cross-compile for macOS arm64
make test               # Run tests with race detector
make lint               # Run golangci-lint
make clean              # Remove build artifacts
```

Version info is injected via ldflags: `main.Version`, `main.Commit`, `main.BuildDate`.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health` | Health check |
| GET | `/api/v1/documents` | List documents |
| GET | `/api/v1/documents/{id}` | Get document metadata |
| GET | `/api/v1/documents/{id}/content` | Get document content |
| POST | `/api/v1/documents` | Create document |
| PUT | `/api/v1/documents/{id}/content` | Update document content |
| PATCH | `/api/v1/documents/{id}` | Update document metadata |
| DELETE | `/api/v1/documents/{id}` | Delete document |
| POST | `/api/v1/documents/bulk-delete` | Bulk delete documents |
| GET | `/api/v1/search` | Full-text search |
| GET | `/api/v1/graph/backlinks/{id}` | Backlinks for a document |
| GET | `/api/v1/graph/forward/{id}` | Forward references |
| GET | `/api/v1/graph/uncited` | Uncited sources |
| GET | `/api/v1/graph/stale` | Stale pages |
| GET | `/api/v1/settings` | Get settings |
| PUT | `/api/v1/settings` | Update settings |
| GET | `/api/v1/capabilities` | Server capabilities |
| GET | `/api/v1/ingest/jobs` | List ingest jobs |
| GET | `/api/v1/ingest/jobs/{id}` | Get ingest job detail |
| POST | `/api/v1/ingest/jobs/{id}/retry` | Retry a failed ingest job |
| POST | `/api/v1/ingest/jobs/{id}/cancel` | Cancel a queued/running ingest job |
| POST | `/api/v1/ingest/jobs/conversation` | Create ingest job from conversation draft |
| POST | `/api/v1/ingest/jobs/text` | Create ingest job from direct text |
| POST | `/api/v1/ingest/jobs/upload` | Create ingest jobs from uploaded files |

## License

MIT

## Language Settings

LLM Wiki supports bilingual UI and document generation (Chinese / English).

| Setting | Values | Description |
|---------|--------|-------------|
| `ui_language` | `zh` (default), `en` | Controls the display language of the web interface |
| `doc_language` | `zh` (default), `en` | Controls the output language for all wiki document generation |

Both settings are configured via the **Settings** page in the web UI or via `PUT /api/v1/settings`.

**Note:** `doc_language` affects all generation paths: file upload, text ingest, conversation ingest, session archive, and rollback regeneration.

**Known limitations (first release):**
- Only Chinese (`zh`) and English (`en`) are supported.
- Not all UI pages have been migrated to the translation system — core pages (navigation, settings, chat) are covered first.
- `doc_language` is resolved at job execution time; if the setting changes while a job is queued, the new value will be used.
