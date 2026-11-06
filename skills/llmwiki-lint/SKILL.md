---
name: llmwiki-lint
description: Audit and repair an llmwiki vault over HTTP — read lint findings by severity, trace each one to its page, fix it through the document API, then reindex and prove the vault is clean. Use when the user asks for a health check, wants broken links or orphans cleaned up, or a lint run reports errors.
license: MIT
metadata:
  author: llmwiki
  version: "2.0"
---

# llmwiki-lint

Lint is read-only: it reports what is wrong. Repair happens through `llmwiki-organize` endpoints. `$LLMWIKI_URL` and auth come from the `llmwiki` entry skill.

## Run it

```bash
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/lint"
```

```json
{
  "issues": [
    {"severity": "error", "code": "dead_link", "path": "wiki/concepts/attention.md", "message": "死链：目标不存在 \"entities/transformer\""}
  ],
  "stats": {"page_count": 42, "source_count": 7, "last_updated": "…"},
  "checked_at": "…"
}
```

Severities: `error` (breaks navigation, indexing or the page contract), `warning` (structure drift that a human may accept), `info` (advisory). Start a sweep with `python3 -c` / `jq` to group by `code` — fixing twenty of one code is usually one cause.

## Codes and repairs

| Code | Severity | Meaning | Repair |
|---|---|---|---|
| `missing_frontmatter` | error | `title`, `date` or `type` absent in a typed page | `PUT /documents/{id}/content` with a complete frontmatter block |
| `type_dir_mismatch` | error | `type` disagrees with the directory | decide which is right; usually move the page into the correct dir (create + delete), otherwise fix `type` |
| `dead_link` | error | `[[target]]` resolves to nothing | create the target page, or repoint the link to the page that exists |
| `ghost_index_entry` | error | SQLite has a row whose file no longer exists | `POST /api/v1/reindex` prunes it; if it survives, delete the document row via `DELETE /documents/{id}` |
| `misplaced_wiki_page` | warning | business page sits at `wiki/*.md` | move it into its typed subdir; only `overview.md`, `index.md`, `log.md` belong at the wiki root |
| `orphan_page` | warning | no other wiki page links here | link it from a related page; `index.md` is generated, so editing it does nothing |
| `duplicate_page` | warning | two pages in one dir share a normalized filename | merge into one, repoint inbound links, delete the loser |
| `entity_concept_coupling` | warning | a concept page's title is bound to one entity | rename/generalize the concept and link the entity case as `[[entities/…]]` |
| `log_format_invalid` | error | `wiki/log.md` entry breaks `## [YYYY-MM-DD] action \| description` | rewrite that one entry; never reorder the log |
| `log_date_decreasing` | warning | log entries out of chronological order | reorder entries, keep every one |

`wiki/templates/` is scaffolding and is skipped by every check — a freshly initialised vault lints clean. If it does not, the vault itself is broken.

Frontmatter is not validated beyond presence and directory agreement: an odd `date` value passes lint but displays wrong, so check dates when you touch a page anyway.

`page_count` / `source_count` in `stats` are the fastest sanity check after a bulk import: a sudden drop means reindex pruned files that are actually gone from disk.

## Sweep protocol

1. `GET /lint`. If `issues` is empty, report the stats and stop — do not "improve" pages nobody asked about.
2. Group by `code`; pick the code with the largest count and a mechanical fix (frontmatter and dates first — they are cheap and unambiguous).
3. Resolve `path` to a document: `GET /documents?source_kind=wiki&exclude_hidden=true`, match `relative_path`, or `GET /api/v1/search?q=<filename>`. Then `GET /documents/{id}/content`.
4. Fix with `PUT /documents/{id}/content` (full body) — the only write that keeps file and index in sync. Structural moves follow `llmwiki-organize`.
5. After each batch: `POST /api/v1/reindex`, then `GET /lint` again and diff the issue list. Count going *up* means your fix introduced something (usually a link you forgot to repoint).
6. Stop when the remaining issues are ones only the user can decide (for example: two pages that both look correct and need a subject-matter call). Report them with paths instead of guessing.

## Report

Give: issues by severity before → after, the files changed, anything deliberately left, and the commands to reproduce. Quote exact `code` values and paths so the user can re-check. If you ran `POST /api/v1/vcs/backup`, include the commit sha.

## Never

- Edit `wiki/index.md`, `.llmwiki/`, or `raw/` to silence a finding.
- Delete a page with inbound links before repointing them.
- Mass-delete "orphans" — an orphan is often a page that simply needs one link, and deleting user knowledge to make a number go down is not a fix.
- Claim a clean vault without a post-fix `GET /lint`.
