## Quick Start

1. **Initialize a workspace** (requires git CLI):

```bash
llmwiki init ~/research
```

2. **Start the server** and open the Web UI:

```bash
llmwiki serve ~/research
# Open http://127.0.0.1:8868
```

3. **Configure a Provider**: add an LLM provider instance on **Settings** and pick a model.

4. **Ingest knowledge**: chat on **Ingest**, or use **Add context** to paste materials, then **Archive** when ready (review gate before writing to the wiki).

5. **Read the wiki**: click **Wiki** in the header to browse structured pages.

## Core Concepts

How LLM Wiki differs from traditional RAG:

| Traditional RAG | LLM Wiki |
|-----------------|----------|
| Retrieve fragments at query time | Compile knowledge at ingest time into persistent Markdown |
| Each question starts fresh | Knowledge accumulates with every source and archive |

Three core operations:

- **Ingest**: turn sources or conversations into wiki pages, update cross-links and indexes.
- **Query**: ask against the existing wiki; good answers can be archived back instead of living only in chat.
- **Lint**: find contradictions, stale claims, orphan pages, and missing links (via MCP or future tooling).

The filesystem is the source of truth; `.llmwiki/index.db` is a rebuildable search index only.

## Workspace Layout

Typical layout after `init`:

```
~/research/
├── purpose.md          # Goals and scope (human + LLM)
├── rules.md            # Writing and citation rules
├── wiki/               # LLM-maintained structured Markdown
├── raw/                # Immutable sources (read-only)
│   └── sources/
└── .llmwiki/
    └── index.db        # SQLite index (delete + reindex to rebuild)
```

- **`raw/`**: original PDFs, notes, web clips — LLM read-only.
- **`wiki/`**: generated knowledge pages in typed subdirectories (below).
- **`purpose.md` / `rules.md`**: edit in Obsidian or your editor; Settings shows previews and a rules supplement field.

## Wiki Organization

Business pages live in **typed directories**:

| Type | Directory | Purpose |
|------|-----------|---------|
| entity | `wiki/entities/` | People, orgs, products |
| concept | `wiki/concepts/` | Terms and ideas |
| source | `wiki/sources/` | Source summaries |
| synthesis | `wiki/synthesis/` | Cross-source synthesis |
| comparison | `wiki/comparisons/` | Comparisons |
| query | `wiki/queries/` | Archived Q&A |

Reserved top-level pages: `wiki/overview.md`, `wiki/index.md`, `wiki/log.md`. Templates under `wiki/templates/` guide generation and are not business content.

Updating an existing page **merges** by default (locked frontmatter, union arrays, LLM body merge). Use CLI `--force-overwrite` for legacy overwrite behavior.

## Web UI Guide

Workbench navigation:

| Page | Purpose |
|------|---------|
| **Ingest** | Multi-turn chat; **Add context** for plain text (no AI reply); attachments; **Archive** with review |
| **Jobs** | Ingest job lifecycle (queued / running / succeeded / failed), retry and cancel |
| **Timeline** | Git history and diffs for `wiki/` (when VC enabled at init) |
| **Logs** | System activity logs |
| **Settings** | Providers, UI/doc language, wiki rules supplement, MCP config |
| **Wiki** | Read-only reader: tree, search (⌘K / Ctrl+K), knowledge graph |

Recommended flow: **chat or add context → archive → confirm plan in review → watch Jobs → read Wiki**.

## CLI Reference

Common commands (from workspace dir or with path argument):

| Command | Description |
|---------|-------------|
| `llmwiki init <dir>` | Scaffold workspace, git (wiki/), SQLite index |
| `llmwiki serve [dir]` | HTTP API + embedded Web UI (default `127.0.0.1:8868`) |
| `llmwiki ingest <file>` | Ingest a source file (merge protection) |
| `llmwiki reindex [dir]` | Force full index rebuild from disk |
| `llmwiki mcp [dir]` | Local stdio MCP (legacy) |
| `llmwiki mcp-config` | Print MCP JSON for Claude Desktop / Claude Code |
| `llmwiki version` | Version, commit, build date |

Useful `serve` flags: `--port`, `--token`, `--public-wiki`, `--no-mcp`, `--no-watch`.

## MCP Integration

**RPC-first** access: `llmwiki serve` exposes MCP at `POST /mcp` (JSON-RPC 2.0) in the same process.

1. Start: `llmwiki serve ~/research`
2. Generate config: `llmwiki mcp-config`
3. Paste into your MCP client (Claude Desktop, Claude Code, etc.)

Tools expose wiki read, search, diagnostics, and more (see `tools/list`). Stdio `llmwiki mcp` remains available; HTTP RPC is the recommended path.

## FAQ

**Q: If I delete `.llmwiki/index.db`, is data lost?**  
A: No. Wiki and raw files remain; run `llmwiki reindex`.

**Q: Are UI language and generated doc language the same?**  
A: Not necessarily. **Settings** → `ui_language` vs `doc_language`.

**Q: PDF / Office extraction fails?**  
A: Check **Settings** or `GET /api/v1/capabilities` for processing tier; Tier B may need `pdftotext` or LibreOffice.

**Q: Chinese search broken after upgrade?**  
A: Run `llmwiki reindex` once after pulling CJK search improvements.

**Q: Where do Web-submitted materials go?**  
A: Persisted under `raw/sources/web-ingest/` before entering the ingest pipeline.
