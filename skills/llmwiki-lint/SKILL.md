---
name: llmwiki-lint
description: Check and fix LLM Wiki health issues. Use when the user wants to audit the wiki for problems, or when you notice issues during other operations.
license: MIT
metadata:
  author: llmwiki
  version: "1.0"
---

Check LLM Wiki health — find and fix broken links, orphan pages, frontmatter issues, and structural problems.

## When to Use

- User says "check wiki health", "lint the wiki", "audit"
- Before/after major reorganization
- After bulk ingestion to verify consistency
- When you notice dead links or inconsistencies during other operations

## Steps

1. **Run lint check** using MCP `search`:
   ```
   search(query="", mode="lint")
   ```

2. **Review the report** — issues are categorized by severity:

   | Severity | Issues | Action |
   |:--------:|--------|--------|
   | **error** | Dead links, missing frontmatter, log format errors | Fix immediately |
   | **warning** | Orphan pages, type mismatches, misplaced pages | Evaluate and fix |

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
   - Fix entry format to match spec: `### YYYY-MM-DD — description`
   - Ensure dates are in ascending order (append-only)

4. **Fix warning-level issues**:

   **Orphan pages** (`orphan_page`):
   - Read the page to understand its content
   - Find related pages that should link to it
   - Add `[[wikilinks]]` from those pages

   **Type mismatch** (`type_dir_mismatch`):
   - Either move the page to the correct directory, or update its `type` field

   **Misplaced pages** (`misplaced_wiki_page`):
   - Move to the correct typed subdirectory

5. **Re-run lint** to verify all fixes

## Lint Checks Reference

| Code | Severity | What it checks |
|------|:--------:|----------------|
| `dead_link` | error | `[[link]]` or `[text](path)` target doesn't exist |
| `missing_frontmatter` | error | Missing required fields: title, type, date |
| `log_format_invalid` | error | `log.md` entry format doesn't match spec |
| `log_date_decreasing` | error | Log entries not in chronological order |
| `type_dir_mismatch` | warning | Page `type` doesn't match its directory |
| `misplaced_wiki_page` | warning | Business page not in typed subdirectory |
| `orphan_page` | warning | No incoming links from other wiki pages |

## Guardrails

- Always run lint AFTER making changes, not just before
- Fix errors before warnings
- When fixing dead links, prefer creating the missing page over removing the link
- Never modify `raw/` directory
- Log format in `wiki/log.md` is strictly append-only — only fix format, never delete entries
- If a page has multiple issues, fix them all in one pass

## Done Criteria

- [ ] Lint report shows 0 errors
- [ ] All dead links resolved (pages created or links updated)
- [ ] All pages have valid frontmatter
- [ ] `wiki/log.md` format is valid and dates are ascending
- [ ] Warning-level issues reviewed and either fixed or consciously deferred
