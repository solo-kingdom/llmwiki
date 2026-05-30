---
name: llmwiki-guide
description: Explore and understand an LLM Wiki workspace. Use when you need to understand the workspace's purpose, structure, existing pages, or current state before performing any action.
license: MIT
metadata:
  author: llmwiki
  version: "1.0"
---

Explore an LLM Wiki workspace — understand its purpose, structure, and current state.

This skill is a blueprint for the Go runtime prompts. External LLM Wiki references are distilled into `skills/` first, then mapped into `internal/ingest/prompts.go`, `internal/mcp/tools.go`, and related runtime prompts. It is a design source, not a runtime command surface.

## When to Use

- First interaction with a workspace ("what's in this wiki?")
- Before planning ingestion or reorganization
- When asked "what do we know about X?"
- As a prerequisite before `/llmwiki-ingest`, `/llmwiki-query`, or `/llmwiki-lint`

## Core Invariants

- `raw/` is the immutable source layer. Read it, never edit it.
- `wiki/` is the persistent knowledge layer maintained by the LLM and governed by `purpose.md` and `rules.md`.
- The filesystem is the source of truth; `.llmwiki/index.db` / SQLite FTS5 is rebuildable.
- Search and read before writing; read back after writing.
- `wiki/log.md` is append-only. Entries use `## [YYYY-MM-DD] action | description`.

## Steps

1. **Call the MCP `guide` tool** to get workspace overview
   - Current implementation returns an architecture note, top-level `wiki/` Markdown files, `raw/sources/` files, and the MCP tool list.
   - It is a fast entry point, not a full directory tree and not proof that `purpose.md` / `rules.md` have been read.

2. **Read workspace conventions**
   ```
   read(path="purpose.md")
   read(path="rules.md")
   read(path="wiki/overview.md")
   read(path="wiki/index.md")
   ```
   If a file is missing, say so explicitly instead of assuming rules.

3. **Explore content more deeply** with MCP `search`:
   ```
   search(query="", mode="list")  → all wiki pages
   search(query="topic", mode="search")  → full-text search
   search(query="document-id", mode="references")  → citation/link graph
   ```

4. **For specific pages**, use MCP `read` tool:
   ```
   read(path="wiki/entities/some-entity.md")
   ```

5. **Route to the next skill**:
   - New materials, files, URLs, or conversation to digest → `/llmwiki-ingest`
   - Questions over existing wiki knowledge or reorganization → `/llmwiki-query`
   - Broken links, frontmatter, orphan pages, or log format checks → `/llmwiki-lint`

6. **Summarize** what you found:
   - Workspace purpose and scope
   - Page count by type (entities, concepts, sources, etc.)
   - Key topics covered
   - Any notable patterns or gaps

## Workspace Structure

```
~/research/
├── purpose.md          # Research goals (human + LLM read)
├── rules.md            # Writing and citation rules
├── wiki/               # LLM-maintained structured Markdown
│   ├── entities/       # People, orgs, products
│   ├── concepts/       # Terms and ideas
│   ├── sources/        # Source summaries
│   ├── synthesis/      # Cross-source analysis
│   ├── comparisons/    # Comparisons
│   ├── queries/        # Archived Q&A
│   ├── templates/      # System page templates (not business content)
│   ├── overview.md     # Global overview
│   ├── index.md        # Directory listing (auto-rebuilt after apply)
│   └── log.md          # Append-only operation log
├── raw/                # Immutable sources (read-only, outside wiki/)
│   └── sources/
└── .llmwiki/
    └── index.db        # SQLite FTS5 index (rebuildable)
```

Canonical layout: `docs/workspace-layout.md`.

## MCP Tools Available

| Tool | Purpose |
|------|---------|
| `guide` | Fast workspace overview and tool list |
| `search` | List pages / full-text search / references / lint |
| `read` | Read a wiki page |
| `write` | Create or update wiki pages (documents the MCP contract; built-in ingest primarily writes through FILE blocks and the pipeline) |
| `delete` | Remove documents (`overview.md` and `log.md` are MCP-protected; treat `index.md` as a system page too) |
| `ping` | Test MCP connectivity |

## Guardrails

- Always call `guide` first when exploring a new workspace
- Read `purpose.md` and `rules.md` before any write operation
- The filesystem is the source of truth; `index.db` is rebuildable
- Never modify files under `raw/` — they are immutable sources
- Do not treat `guide` output as complete state; use `search`, `read`, `references`, or `/llmwiki-lint` for deeper work
