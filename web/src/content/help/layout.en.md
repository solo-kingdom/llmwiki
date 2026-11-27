## Data & Logical Layout

PostgreSQL is the single source of truth for wiki pages, topic folders, revision history (`change_sets` / `page_revisions`), and raw `archives`:

```text
PostgreSQL SSOT
├── Knowledge Base Rules (app_config)
│   ├── Purpose
│   └── Rules
├── wiki/                     # Structured knowledge pages (logical paths)
│   ├── overview.md           # Global pyramid overview
│   ├── <domain>/             # Lowercase kebab-case topic domain
│   │   ├── _overview.md      # Domain overview
│   │   └── <group>/          # Topic group
│   │       ├── _overview.md  # Group overview
│   │       └── <page>.md     # Knowledge page
└── archives/                 # Raw source archive (DB inline / local / S3)
```

- **`archives/`**: original PDFs, notes, and session attachments stored via ArchiveStorageService.
- **`wiki/`**: knowledge pages organized by topic domain and group; `page_type` describes page role.
- **Knowledge Base Rules**: edited directly in **Settings → 知识库规则** and applied to ingest, chat, and organize prompts.
