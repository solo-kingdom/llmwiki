## Web UI Guide

Workbench navigation:

| Page | Purpose |
|------|---------|
| **Ingest** | Multi-turn chat; **Add context** for plain text (no AI reply); attachments; **Archive** with review |
| **Jobs** | Ingest job lifecycle (queued / running / succeeded / failed), retry and cancel |
| **Timeline** | Change history, diffs and rollbacks for `wiki/` (PostgreSQL revisions) |
| **Logs** | System activity logs |
| **Settings** | Providers, UI/doc language, wiki rules supplement, MCP config |
| **Wiki** | Read-only reader: tree, search (⌘K / Ctrl+K), knowledge graph |

Recommended flow: **chat or add context → archive → confirm plan in review → watch Jobs → read Wiki**.
