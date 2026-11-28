---
name: llmwiki-organize
description: Create, edit, merge, move and delete llmwiki pages over HTTP — enforce frontmatter and directory contract, and leave the vault lintable. Use when the user asks to add or rewrite a wiki page, clean up duplicates, reorganize structure, or fix page metadata.
license: MIT
metadata:
  author: llmwiki
  version: "2.0"
---

# llmwiki-organize

Writes go through the API so the file, the index and the graph stay consistent. `$LLMWIKI_URL` and auth come from the `llmwiki` entry skill.

## Page contract

Use `wiki/<topic-domain>/<topic-group>/<page>.md` with two folder levels by default. Page type is independent of folders; one topic group may mix entity, concept, and experience pages. `concepts/`, `entities/`, `devices/`, and similar type roots are legacy paths for existing-page updates only.

| `type` | Independent-page threshold | Required sections |
|---|---|---|
| `entity` | Unique identity and reusable facts | 概述 / 关键事实 / 相关概念 / 来源 |
| `concept` | Neutral and reusable across cases | 定义 / 核心要点 / 适用边界 / 来源 |
| `synthesis` | Relationship analysis has independent value | 问题与结论 / 分析 / 证据 / 未决项 |
| `comparison` | At least two objects and explicit dimensions | 对比维度 / 异同 / 结论 |
| `query` | Reusable question and answer | 问题 / 回答 / 引用 |
| `experience` | One complete reusable experience, not one page per phrase | 现象 / 经验结论 / 最短判别 / 根因 / 处理 / 验证 / 边界 / 证据 |
| `ledger` | Current state plus append-only history | 当前状态 / 历史 / 来源 |
| `source` | Source summary; always under `wiki/sources/` | 摘要 / 关键观点 / 相关实体或概念 |

Write content as a pyramid: conclusion and applicability, then key points, then evidence. Ordinary relationships use wikilinks/structured references, not relation pages. Filenames use stable readable names, `-` for whitespace, never `_` word splitting; old names and abbreviations belong in `aliases`.

Frontmatter on every wiki page — a missing `title`, `date` or `type` is a lint error:

```yaml
---
title: 注意力机制
type: concept
date: 2025-01-31
description: 一句话摘要
tags: [transformer, nlp]
---
```

Rules the linter enforces:

- `type` must be valid (`entity`, `concept`, `source`, `synthesis`, `comparison`, `query`, `experience`, `ledger`, `page`). Only `wiki/sources/` requires `type: source`; business pages can live in any nested topic folder under `wiki/`.
- `experience` requires `status` (`draft`/`validated`/`deprecated`) and supports `kind` (`practice`/`pitfall`/`pattern`) and `symptoms`; `ledger` requires `status`; `confidence: high` requires `last_verified`, and `validated` experience requires `last_verified` and `review_after`.
- Business pages live inside topic subfolders (e.g. `wiki/AI-Engineering/Agent/harness.md`). `wiki/foo.md` is `misplaced_wiki_page`; only `wiki/overview.md` may sit at the top level.
- Links use Obsidian syntax: `[[AI-Engineering/Agent/harness|Harness]]`, `[[entities/transformer|Transformer]]`, or bare `[[attention]]` when the slug is unique. Markdown links `[text](/wiki/concepts/attention.md)` work too. A link to a missing page is `dead_link`.
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
    "path": "/wiki/AI与Agent/Skills与工具",
    "title": "注意力机制",
    "tags": ["transformer"],
    "content": "---\ntitle: 注意力机制\ntype: concept\ndate: 2025-01-31\n---\n\n# 定义\n…\n"
  }'
```

The response is the created row: check `source_kind == "wiki"` and `relative_path == "wiki/AI与Agent/Skills与工具/attention-mechanism.md"`. `content` must contain the frontmatter — the API stores the body verbatim and does not invent metadata.

## Edit a page

Prefer atomic partial edits (`PATCH /content`) with optimistic locking (`expected_version`, `expected_content_hash`, or `If-Match` header — returns `409 Conflict` on mismatch):

```bash
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/documents/by-path?path=wiki/topic/page.md&include_content=false"
curl -fsS "${AUTH[@]}" -X PATCH "$LLMWIKI_URL/api/v1/documents/{id}/content" \
  -H 'Content-Type: application/json' \
  -d '{
    "expected_version": 3,
    "dry_run": false,
    "edits": [
      {"op": "replace", "old_text": "old line", "new_text": "new line"},
      {"op": "insert_after", "anchor": "## Summary", "text": "\nNew bullet"}
    ]
  }'
```

Supported `edits[]` ops: `replace` (`replace_all?`), `replace_lines` (`start_line`, `end_line`, `text`), `append`, `prepend`, `insert_after`. Use `PUT /api/v1/documents/{id}/content` when rewriting the whole body. `PATCH /api/v1/documents/{id}` syncs `title` / `tags` / `date` / `metadata` and supports optimistic locking (`expected_version` / `If-Match`).

## Batch operations & dry_run

Use `POST /api/v1/documents/batch` (max 100 ops) to run mixed `create`, `replace`, `patch`, `update_meta`, `move`, `archive`, `reopen`, `delete` atomically in a single `change_set` (with merged link-rewriting and `dry_run: true` preflight):

```bash
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/documents/batch" \
  -H 'Content-Type: application/json' \
  -d '{"dry_run": true, "summary": "reorganize topic", "ops": [{"op": "move", "path": "wiki/a/p.md", "target_folder": "b"}]}'
```

Read many pages at once with `POST /api/v1/documents/batch-get` (`{"ids": [...], "paths": [...], "fields": "meta|content|outline"}`). `POST /api/v1/organize/auto-cluster` also emits `batch_ops` ready for `POST /api/v1/documents/batch`.

## Merge duplicates

1. `GET /graph/backlinks/{id}` on the page you plan to drop — inbound links must be repointed first.
2. Write the survivor with the merged content (`PUT /content`).
3. Update each inbound page's link to the survivor (`PUT /content`).
4. Delete the redundant page (below).
5. `POST /api/v1/reindex`, then confirm `GET /api/v1/lint` no longer reports `dead_link` or `duplicate_page`.

## Move or rename

Use `POST /api/v1/documents/{id}/move` (`{"target_folder": "AI-Engineering/Agent", "filename": "new-name.md"}`) or `POST /api/v1/folders/move` (`{"from_path": "old", "to_path": "new", "on_conflict": "fail|merge"}`). `on_conflict: "merge"` merges folders/subfolders transactionally and returns `409` with `conflicts[]` on filename collision. Moves preserve `document_id`, version history, and automatically rewrite explicit path-qualified wikilinks/markdown links. Use `GET /api/v1/tree` and `POST/PATCH/DELETE /api/v1/folders` (`exist_ok: true` for idempotent mkdir) to inspect and manage the folder tree.

## Archive and reopen (in-place, distinct from delete)

```bash
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/documents/{id}/archive" \
  -H 'Content-Type: application/json' \
  -d '{"reason":"Superseded by newer design","superseded_by":"[[new-page]]"}'

curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/documents/{id}/reopen" \
  -H 'Content-Type: application/json' \
  -d '{"reason":"Re-verified","confidence":"medium","last_verified":"2026-11-25"}'
```

## Delete a page

```bash
curl -fsS "${AUTH[@]}" -X DELETE "$LLMWIKI_URL/api/v1/documents/{id}"
# {"status":"deleted","path":"wiki/concepts/old.md"}
```

Delete removes the document from PostgreSQL (recorded in `change_sets`). Before deleting, check `backlinks`; afterwards reindex and check lint. `POST /documents/bulk-delete {"ids":[…]}` does the same for many pages.

## Close the loop

```bash
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/reindex"     # rebuilds chunks, graph + folder overviews
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/lint"                # must have no error-severity issue you caused
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/history?limit=1"  # change set id for the write you just made
```

Report the changed paths, the lint summary, and the change set id if you rolled back.

## Never

- Edit derived system state directly outside the document API.
- Create pages at `wiki/` root, in singular dirs (`entity/`, `concept/`) or in `wiki/raw/`.
- Write a page whose body contradicts its frontmatter (`type`, `date`).
- Leave a batch of edits unlinted or unreindexed.
