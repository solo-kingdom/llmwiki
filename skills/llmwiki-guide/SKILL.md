---
name: llmwiki-guide
description: Set up and operate an llmwiki server through HTTP — check the vault, configure the model instance used by ingest and sessions and the embedding provider, rebuild the index, and inspect or roll back revision history. Use when the wiki is unreachable, freshly deployed, missing model config, gives stale search results, or when the user asks to inspect history or restore a page.
license: MIT
metadata:
  author: llmwiki
  version: "2.0"
---

# llmwiki-guide

Setup and operation. Every step is one HTTP call; nothing here needs shell access to the vault.

`$LLMWIKI_URL` and the optional `Authorization` header come from the `llmwiki` entry skill.

## 1. Is it alive and does it have a vault?

```bash
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/health"
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/workspace"
```

Read the workspace payload before anything else:

| Field | Meaning | Action when it looks wrong |
|---|---|---|
| `root` | vault path on the server | report it; never assume it locally |
| `layout.purpose` / `layout.rules` | `purpose.md` / `rules.md` present | missing ⇒ the vault is uninitialised; tell the user to run `llmwiki init` on the server (there is no HTTP init) |
| `layout.wiki` / `layout.raw_sources` | content dirs present | missing ⇒ same as above |
| `layout.index_db` | PostgreSQL is reachable and initialized | `false` ⇒ check `--database-url` and run `llmwiki init` |
| `counts` | documents / wiki pages / sources | all zero with files presumably present ⇒ reindex |
| `page_types` | pages per type (entity, concept, …) | mismatch with `wiki_dirs` hints at misplacement — see `llmwiki-lint` |
| `wiki_dirs` | markdown files per `wiki/` subdir, `""` = top level | empty subdirs mean the vault has no content yet |

`503` here means the server was started without `--workspace`. Stop and report; retrying cannot fix it.

## 2. Rebuild the derived index

```bash
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/reindex"
```

Response: `{"indexed": <n>, "status": "ok"}`. It is synchronous, and the server kills any non-streaming request after 60s — on a large vault a timeout does not necessarily mean the run failed. Check `GET /api/v1/workspace` counts and `GET /api/v1/lint` before retrying. Reindex rebuilds chunks, references, and folder `_overview.md` pages from PostgreSQL documents.

## 3. Configure the model used by ingest and sessions

Ingest jobs and ingest sessions need one provider instance plus a model, stored in settings as `job_instance_id` / `job_model`.

```bash
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/providers"                       # catalog: id, name, api_base
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/providers/{catalog_id}/models"   # known models for that catalog entry
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/provider-instances" \
  -H 'Content-Type: application/json' \
  -d '{"name":"main","catalog_id":"<id>","api_key":"<key>","base_url":"<optional override>"}'
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/provider-instances/{instance_id}/check"  # live connectivity probe
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/settings"
curl -fsS "${AUTH[@]}" -X PUT "$LLMWIKI_URL/api/v1/settings" \
  -H 'Content-Type: application/json' \
  -d '{"job_instance_id":"<instance_id>","job_model":"<model id>"}'
```

`PUT /api/v1/settings` is a partial update: send only the keys you change. Accepted keys include `job_instance_id`, `job_model`, `job_parallel_enabled`, `job_max_concurrent`, `temperature`, `max_tokens`, `chunk_size`, `chunk_overlap`, `doc_language` (`zh`/`en`), `ui_language`, `rules_supplement`, `embedding_instance_id`, `embedding_model`, `embedding_dim`, `default_agent_kind`, `default_acp_agent_id`. Unknown keys are ignored — verify by re-reading settings.

`GET` on provider instances returns `api_key_masked` only, never the key. `PUT /api/v1/provider-instances/{id}` replaces fields, including the key.

About 25 catalog providers ship with an empty `api_base` (e.g. `openai`, `groq`, `xai`) — the instance is unusable until you pass `base_url` yourself. `check` says `未设置 Base URL` in that case.

Secrets: never echo an `api_key` back to the user or into a report.

## 4. Know what the server can parse

```bash
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/capabilities"
```

Returns `file_types[]` with `tier`, `can_extract`, `can_chunk`, `missing_deps`, `remediation`, plus `runtime_dependencies[]`. If a requested format has `missing_deps`, tell the user which dependency is missing instead of queueing an ingest job that will fail.

Writes now land in PostgreSQL as the single source of truth; every write creates a change set and per-page revisions.

## 5. House rules (`rules.md`)

```bash
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/workspace/rule-files"   # current purpose.md / rules.md content
```

Read this before ingest or organize work: it carries the user's conventions. Purpose and rules are written through the same endpoint:

```bash
curl -fsS "${AUTH[@]}" -X PUT "$LLMWIKI_URL/api/v1/workspace/rule-files" \
  -H 'Content-Type: application/json' \
  -d '{"rules": "# 约定\n- 中文页面，实体页必须链接来源页\n"}'
```

`PUT` accepts `purpose` and/or `rules` (markdown, non-empty); it writes the file and reindexes it. Only change these when the user asks to change house rules — they steer every future LLM step. Extra one-off instructions belong in `rules_supplement` via `PUT /api/v1/settings`. Do not paste long policies into pages.

## 6. History and rollback

```bash
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/history?limit=20"          # change sets
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/history/{id}"              # affected pages and revisions
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/history/{id}/diff"         # unified diff
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/pages/history?path=wiki/concepts/x.md"
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/history/{id}/rollback"   # undo that change set
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/revisions/{id}/restore"  # restore one page revision
```

Rollback is deterministic: each page in the change set returns to its parent revision, and pages created by it are soft-deleted; no LLM call is involved. `POST /api/v1/ingest/rollback {"change_set_id":"…"}` queues a rollback job — poll it like any other job. The old `commit_sha` field is no longer accepted.

## 7. Finish

Report: vault `root`, counts after reindex, the configured `job_instance_id`/`job_model`, whether embeddings are configured, and the change set id you rolled back. Skip fields you did not touch.
