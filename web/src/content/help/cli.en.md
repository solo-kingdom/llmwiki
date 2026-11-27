## CLI Reference

Common commands (works in pure PostgreSQL mode without a local workspace directory):

| Command | Description |
|---------|-------------|
| `llmwiki init [dir]` | Initialize PostgreSQL workspace (with optional one-way import from `[dir]`) |
| `llmwiki serve [dir]` | HTTP API + embedded Web UI (default `127.0.0.1:8868`) |
| `llmwiki ingest <file>` | Ingest a source file (merge protection) |
| `llmwiki reindex` | Rebuild chunks, references, and folder overviews from PostgreSQL content |
| `llmwiki lint [dir]` | Check wiki health (PostgreSQL by default, or local dir if `[dir]` is passed) |
| `llmwiki export --out <dir>` | Export pages from PostgreSQL (`--include-raw`, `--with-index`) |
| `llmwiki cleanup-legacy` | Find and clean up legacy system pages (`wiki/log.md`, `wiki/index.md`, `wiki/templates/*`) |
| `llmwiki mcp` | Local stdio MCP |
| `llmwiki mcp-config` | Print MCP JSON for Claude Desktop / Claude Code |
| `llmwiki version` | Version information |

Useful `serve` flags: `--port`, `--token`, `--public-wiki`, `--no-mcp`, `--mcp-allow-write` (enable remote MCP write tools).
