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
| `llmwiki mcp [dir]` | Run MCP JSON-RPC 2.0 server on stdin/stdout |
| `llmwiki mcp-config` | Print MCP configuration JSON for Claude Desktop / Claude Code |
| `llmwiki version` | Print version, commit, and build date |

### Serve Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--bind` | `127.0.0.1` | Bind address |
| `--port` | `8868` | HTTP port |
| `--token` | | API token for authentication (optional) |
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

**Three entry points** into a single Go binary:

1. **MCP (stdio)** — For LLM agents (Claude, Cursor). JSON-RPC 2.0 over stdin/stdout.
2. **HTTP REST API** — For the web UI and remote clients. Serves at `/api/v1/`.
3. **CLI** — For humans and scripts. Powered by cobra.

**Data model**: Files are the source of truth. SQLite is an index only — deleting the database and running `reindex` fully rebuilds it. FTS5 provides full-text search with BM25 ranking.

**Web UI**: React 19 + Vite + TypeScript, embedded via `go:embed` into the binary. SPA with client-side routing, served with index.html fallback.

## MCP RPC-First Compatibility

The MCP server follows the JSON-RPC 2.0 specification over stdio. It supports:

- `initialize` — Returns server info and capabilities
- `tools/list` — Returns available tools with schemas
- `tools/call` — Dispatches to tool handlers

For remote usage, the HTTP server can proxy MCP requests. Use `llmwiki mcp-config` to generate configuration for your MCP client.

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

## License

MIT
