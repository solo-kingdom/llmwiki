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

### Invalid layouts (anti-patterns)

Not canonical: `wiki/purpose.md`, `wiki/rules.md` (belong at workspace root), `wiki/raw/`, singular `wiki/entity/`, or fictitious `wiki/skills/`. Directory trees with emoji prefixes or `root/` wrappers are usually LLM-fabricated, not real `structure()` output.

### structure() tool output

In Organize mode, call `structure()` first. Authentic output starts with `# Wiki 目录结构` / workspace path lines and `├── entities/ (N pages)` entries. See `docs/workspace-layout.md` for format examples. **Quote the tool result; do not invent example trees.**

Updating an existing page **merges** by default. After a successful wiki apply, `wiki/index.md` is rebuilt automatically; organize move/merge actions append a structure entry to `wiki/log.md`.
