---
name: llmwiki-guide
description: Explore and understand an LLM Wiki workspace. Use when you need to understand the workspace's purpose, structure, existing pages, or current state before performing any action.
license: MIT
metadata:
  author: llmwiki
  version: "1.0"
---

Explore an LLM Wiki workspace — understand its purpose, structure, and current state.

## When to Use

- First interaction with a workspace ("what's in this wiki?")
- Before planning ingestion or reorganization
- When asked "what do we know about X?"
- As a prerequisite before `/llmwiki-ingest`, `/llmwiki-query`, or `/llmwiki-lint`

## Steps

1. **Call the MCP `guide` tool** to get workspace overview
   - Returns: `purpose.md`, `rules.md`, page counts, file listing
   - This is the fastest way to understand the workspace

2. **If deeper exploration is needed**, use MCP `search` tool:
   ```
   search(query="", mode="list")  → all wiki pages
   search(query="topic", mode="search")  → full-text search
   ```

3. **For specific pages**, use MCP `read` tool:
   ```
   read(path="wiki/entities/some-entity.md")
   ```

4. **Summarize** what you found:
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
│   ├── overview.md     # Global overview
│   ├── index.md        # Directory listing
│   └── log.md          # Append-only operation log
├── raw/                # Immutable sources (read-only)
│   └── sources/
└── .llmwiki/
    └── index.db        # SQLite FTS5 index (rebuildable)
```

## MCP Tools Available

| Tool | Purpose |
|------|---------|
| `guide` | Workspace overview (purpose, rules, file list) |
| `search` | List pages / full-text search / lint |
| `read` | Read a wiki page |
| `write` | Create or edit wiki pages |
| `delete` | Remove pages (system pages protected) |

## Guardrails

- Always call `guide` first when exploring a new workspace
- Read `purpose.md` and `rules.md` before any write operation
- The filesystem is the source of truth; `index.db` is rebuildable
- Never modify files under `raw/` — they are immutable sources
