---
name: llmwiki-lint
description: Check and fix LLM Wiki health issues. Use when the user wants to audit the wiki for problems, or when you notice issues during other operations.
license: MIT
metadata:
  author: llmwiki
  version: "1.0"
---

Check LLM Wiki health — find and fix broken links, orphan pages, frontmatter issues, and structural problems.

This skill is the blueprint for health-diagnosis and organization prompts. Deterministic lint is executed by Go code; prompts explain, prioritize, and plan repairs, especially in organize mode and future LLM-assisted quality checks.

## When to Use

- User says "check wiki health", "lint the wiki", "audit"
- Before/after major reorganization
- After bulk ingestion to verify consistency
- When you notice dead links or inconsistencies during other operations

## Core Invariants

- `raw/` is read-only; lint fixes must not modify source material.
- The filesystem is the source of truth; lint reports are derived from wiki files and rebuildable indexes.
- Read affected pages before fixing to avoid losing information just to clear a warning.
- `wiki/log.md` is append-only; format fixes should be minimal and must not delete historical entries.
- During session diagnosis, report issues and proposed fixes only; archive confirmation moves the workflow into plan/generation steps.

## Steps

1. **Run lint check** using MCP `search`:
   ```
   search(query="", mode="lint")
   ```

2. **Review the report** — issues are categorized by severity:

   | Severity | Issues | Action |
   |:--------:|--------|--------|
   | **error** | Dead links, missing frontmatter, log format errors | Fix immediately |
   | **warning** | Orphan pages, type mismatches, misplaced pages, entity-concept coupling | Evaluate and fix |

3. **Fix error-level issues first**:

   **Dead links** (`dead_link`):
   - Find the link target — was the page renamed or deleted?
   - Either create the missing page or update the link to point to the correct target
   - Use `read` to see the page, `write` to fix the link

   **Missing frontmatter** (`missing_frontmatter`):
   - Read the page, determine its type and title
   - Add proper frontmatter using `write`

   **Log format errors** (`log_format_invalid`, `log_date_decreasing`):
   - Read `wiki/log.md`
   - Fix entry format to match spec: `## [YYYY-MM-DD] action | description`
   - Ensure dates are non-decreasing (append-only; do not delete historical entries)

4. **Fix warning-level issues**:

   **Orphan pages** (`orphan_page`):
   - Read the page to understand its content
   - Find related pages that should link to it
   - Add `[[wikilinks]]` from those pages

   **Type mismatch** (`type_dir_mismatch`):
   - Either move the page to the correct directory, or update its `type` field

   **Misplaced pages** (`misplaced_wiki_page`):
   - Move to the correct typed subdirectory

   **Entity-concept coupling** (`entity_concept_coupling`):
   - Read the concept page and confirm the title binds a concrete entity name to an abstract concept
   - Rename to a neutral concept title (e.g. `组织裁剪方法论`) while preserving body content
   - Link the entity as a case via `[[Entity Name]]` in the concept body; update related links on the entity page
   - After move/rename, update wikilinks pointing to the old path to avoid dead links

5. **Re-run lint** to verify all fixes
   ```
   search(query="", mode="lint")
   ```
   If errors remain, continue fixing. Warnings may be consciously deferred with an explanation.

## Lint Checks Reference

| Code | Severity | What it checks |
|------|:--------:|----------------|
| `dead_link` | error | `[[link]]` or `[text](path)` target doesn't exist |
| `missing_frontmatter` | error | Missing required fields: title, type, date |
| `log_format_invalid` | error | `log.md` entry format doesn't match spec |
| `log_date_decreasing` | error | Log entries not in chronological order |
| `type_dir_mismatch` | warning | Page `type` doesn't match its directory |
| `misplaced_wiki_page` | warning | Business page not in typed subdirectory |
| `entity_concept_coupling` | warning | Concept title appears to bind an entity name to an abstract concept |
| `orphan_page` | warning | No incoming links from other wiki pages |

## Fix Strategy

- **Dead links**: first check for renamed pages or slug differences; if uncertain, ask or mark an open question before creating a placeholder page.
- **Frontmatter**: infer type from directory, but do not casually change identity fields; if date is missing, use the current repair date.
- **Orphan pages**: decide whether the orphan is legitimate, such as a source summary or temporary query page; otherwise add links from related overview, entity, or concept pages.
- **Misplaced / type mismatch**: prefer keeping type and directory consistent; after moving pages, update links pointing to old paths.
- **Entity-concept coupling**: split into a neutral concept page plus entity case links; do not delete concept content just to clear the warning.
- **Log issues**: fix format and ordering problems only; do not rewrite historical meaning.

## Guardrails

- Always run lint AFTER making changes, not just before
- Fix errors before warnings
- When fixing dead links, prefer creating the missing page over removing the link
- Never modify `raw/` directory
- Log format in `wiki/log.md` is strictly append-only — only fix format, never delete entries; entry prefixes are `## [YYYY-MM-DD] action | description`
- If a page has multiple issues, fix them all in one pass
- `overview.md`, `index.md`, and `log.md` are system pages; do not move or delete them as ordinary business pages

## Done Criteria

- [ ] Lint report shows 0 errors
- [ ] All dead links resolved (pages created or links updated)
- [ ] All pages have valid frontmatter
- [ ] `wiki/log.md` format is valid and dates are ascending
- [ ] Warning-level issues reviewed and either fixed or consciously deferred
- [ ] Key repaired pages were read back to confirm old information was not lost
