## Workspace Layout

Typical layout after `init`:

```
~/research/
├── purpose.md          # Goals and scope (workspace root)
├── rules.md            # Writing and citation rules (workspace root)
├── wiki/               # LLM-maintained structured Markdown
│   ├── overview.md     # Global overview (system page)
│   ├── index.md        # Content catalog (auto-rebuilt after apply)
│   ├── log.md          # Operation log (system page)
│   ├── entities/       # Entities (plural typed dirs)
│   ├── concepts/
│   ├── sources/
│   ├── synthesis/
│   ├── comparisons/
│   ├── queries/
│   └── templates/      # System templates (not business content)
├── raw/                # Immutable sources (outside wiki/)
│   └── sources/
└── .llmwiki/          # legacy SQLite directory (unused by the TypeScript rewrite)
```

See `docs/workspace-layout.md` for the canonical layout.

- **`raw/`**: original PDFs, notes, web clips — LLM read-only.
- **`wiki/`**: generated knowledge pages in typed subdirectories (below).
- **`purpose.md` / `rules.md`**: edit in Obsidian or your editor; Settings shows previews and a rules supplement field.
