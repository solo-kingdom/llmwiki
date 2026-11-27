## Wiki Organization

Knowledge pages are organized into **topic domain → topic group → page** using lowercase kebab-case slug paths, while frontmatter `type` (`entity` / `concept` / `synthesis` / `comparison` / `query` / `experience` / `ledger`) describes page role.

Navigation pages: `wiki/overview.md` (global overview) and per-folder `_overview.md`. Change history is tracked automatically in PostgreSQL `change_sets` and `activity_logs`.

### Invalid layouts (anti-patterns)

Not canonical: `wiki/purpose.md`, `wiki/rules.md`, `wiki/raw/`, `wiki/skills/`, or top-level business pages under `wiki/*.md`.

### structure() tool output

In Organize mode, call `structure()` first to inspect the live PostgreSQL folder tree. **Quote the tool result; do not invent example trees.**

Updating an existing page **merges** by default (locked frontmatter fields, unioned arrays, LLM body merge). Every write is recorded in `change_sets` and `page_revisions`.
