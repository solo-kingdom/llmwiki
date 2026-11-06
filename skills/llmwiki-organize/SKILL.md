---
name: llmwiki-organize
description: Create, edit, merge, move and delete llmwiki pages over HTTP — enforce frontmatter and directory contract, keep wiki/log.md current, and leave the vault lintable. Use when the user asks to add or rewrite a wiki page, clean up duplicates, reorganize structure, or fix page metadata.
license: MIT
metadata:
  author: llmwiki
  version: "2.0"
---

# llmwiki-organize

Writes go through the API so the file, the index and the graph stay consistent. `$LLMWIKI_URL` and auth come from the `llmwiki` entry skill.

## Page contract

| Directory | `type` | Required sections |
|---|---|---|
| `wiki/entities/` | `entity` | 概述 / 关键事实 / 相关概念 / 来源 |
| `wiki/concepts/` | `concept` | 定义 / 核心要点 / 相关实体 / 来源 |
| `wiki/synthesis/` | `synthesis` | 问题或目的 / 分析 / 引用 / 后续 |
| `wiki/comparisons/` | `comparison` | 对比维度 / 异同 / 结论 |
| `wiki/queries/` | `query` | 问题 / 回答 / 引用 |
| `wiki/sources/` | `source` | 摘要 / 关键观点 / 相关实体或概念 |

Frontmatter on every wiki page — a missing `title`, `date` or `type` is a lint error:

```yaml
---
title: 注意力机制
type: concept
date: 2025-01-31
description: 一句话摘要，会进入 wiki/index.md
tags: [transformer, nlp]
---
```

Rules the linter enforces:

- `type` must match the directory (singular type, plural directory).
- Business pages live only in typed subdirs. `wiki/foo.md` is `misplaced_wiki_page`; only `wiki/overview.md`, `wiki/index.md` and `wiki/log.md` may sit at the top level.
- Links use Obsidian syntax: `[[entities/transformer|Transformer]]`, `[[concepts/attention]]`, or bare `[[attention]]` when the slug is unique. Markdown links `[text](/wiki/concepts/attention.md)` work too. A link to a missing page is `dead_link`.
- One page, one subject. If a page grows two subjects, split it and link the halves.

## Create a page

```bash
# 1. does it already exist?
curl -fsS -G "${AUTH[@]}" "$LLMWIKI_URL/api/v1/search" --data-urlencode "q=<topic>" --data-urlencode "limit=5"

# 2. write it (path → kind is derived: wiki/** is a wiki page, anything else is a source)
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/documents" \
  -H 'Content-Type: application/json' \
  -d '{
    "filename": "attention-mechanism.md",
    "path": "/wiki/concepts",
    "title": "注意力机制",
    "tags": ["transformer"],
    "content": "---\ntitle: 注意力机制\ntype: concept\ndate: 2025-01-31\n---\n\n# 定义\n…\n"
  }'
```

The response is the created row: check `source_kind == "wiki"` and `relative_path == "wiki/concepts/attention-mechanism.md"`. `content` must contain the frontmatter — the API stores the body verbatim and does not invent metadata.

## Edit a page

```bash
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/documents/{id}/content"    # {"content": "…"}
# edit the markdown locally, then send the whole body back
curl -fsS "${AUTH[@]}" -X PUT "$LLMWIKI_URL/api/v1/documents/{id}/content" \
  -H 'Content-Type: application/json' \
  -d '{"content": "<full markdown, frontmatter included>"}'
```

`PUT /content` is a full replace: partial text deletes the rest. Preserve sections you did not intend to change, and bump `date` when the substance changes.

Avoid `PATCH /api/v1/documents/{id}` (`title`, `tags`, `date`, `metadata`): it updates only the index row, so the file's frontmatter and the index drift apart until the next reindex. Change frontmatter through `PUT /content`.

## Merge duplicates

1. `GET /graph/backlinks/{id}` on the page you plan to drop — inbound links must be repointed first.
2. Write the survivor with the merged content (`PUT /content`).
3. Update each inbound page's link to the survivor (`PUT /content`).
4. Delete the redundant page (below).
5. `POST /api/v1/reindex`, then confirm `GET /api/v1/lint` no longer reports `dead_link` or `duplicate_page`.

## Move or rename

There is no move endpoint. Create the destination page, repoint links, delete the old one. Reindex afterwards; skipping the link repair leaves `dead_link` errors.

## Delete a page

```bash
curl -fsS "${AUTH[@]}" -X DELETE "$LLMWIKI_URL/api/v1/documents/{id}"
# {"status":"deleted","path":"wiki/concepts/old.md"}
```

Delete removes the file **and** the index row, so reindex will not resurrect it. Before deleting, check `backlinks`; afterwards reindex and check lint. `POST /documents/bulk-delete {"ids":[…]}` does the same for many pages.

## Journal (`wiki/log.md`)

Append-only, newest entry on top or bottom consistently with the file you read — match what is already there:

```bash
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/documents/{log_id}/content"
# read, prepend: ## [2025-01-31] create | concepts/attention-mechanism | 新增注意力机制概念页
curl -fsS "${AUTH[@]}" -X PUT "$LLMWIKI_URL/api/v1/documents/{log_id}/content" \
  -H 'Content-Type: application/json' -d '{"content": "<old body + new entry>"}'
```

Format is fixed: `## [YYYY-MM-DD] <action> | <description>`. Actions in use: `create`, `update`, `merge`, `move`, `delete`, `ingest`. Do not reorder or rewrite older entries.

## Close the loop

```bash
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/reindex"     # regenerates wiki/index.md + graph
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/lint"                # must have no error-severity issue you caused
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/vcs/backup"  # only when the user wants a snapshot
```

Report the changed paths, the lint summary, and the commit sha if you committed.

## Never

- Edit `wiki/index.md` (generated), `.llmwiki/` (derived), or anything under `raw/`.
- Create pages at `wiki/` root, in singular dirs (`entity/`, `concept/`) or in `wiki/raw/`.
- Write a page whose body contradicts its frontmatter (`type`, `date`).
- Leave a batch of edits unlinted or unreindexed.
