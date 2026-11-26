## CLI Reference

Common commands (from workspace dir or with path argument):

| Command | Description |
|---------|-------------|
| `llmwiki init <dir>` | Scaffold workspace and PostgreSQL revision history |
| `llmwiki serve [dir]` | HTTP API + embedded Web UI (default `127.0.0.1:8868`) |
| `llmwiki ingest <file>` | Ingest a source file (merge protection) |
| `llmwiki reindex [dir]` | Force full index rebuild from disk |
| `llmwiki mcp [dir]` | Local stdio MCP (legacy) |
| `llmwiki mcp-config` | Print MCP JSON for Claude Desktop / Claude Code |
| `llmwiki version` | Version, commit, build date |

Useful `serve` flags: `--port`, `--token`, `--public-wiki`, `--no-mcp`, `--no-watch`, `--mcp-allow-write` (enable remote MCP write tools).
