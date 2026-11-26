## Core Concepts

How ZhiLin (知林) differs from traditional RAG:

| Traditional RAG | ZhiLin |
|-----------------|----------|
| Retrieve fragments at query time | Compile knowledge at ingest time into persistent Markdown |
| Each question starts fresh | Knowledge accumulates with every source and archive |

Three core operations:

- **Ingest**: turn sources or conversations into wiki pages, update cross-links and indexes.
- **Query**: ask against the existing wiki; good answers can be archived back instead of living only in chat.
- **Lint**: find contradictions, stale claims, orphan pages, and missing links (via MCP or future tooling).

Pages, history and search indexes live in PostgreSQL; workspace Markdown is used for init, export and rule files.
