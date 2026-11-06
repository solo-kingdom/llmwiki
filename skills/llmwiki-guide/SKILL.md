---
name: llmwiki-guide
description: Set up and operate an llmwiki server through HTTP — check the vault, configure the model instance used by ingest and sessions, rebuild the index, and manage git snapshots. Use when the wiki is unreachable, freshly deployed, missing model config, gives stale search results, or when the user asks to back up, push or restore the vault.
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
| `layout.index_db` | `.llmwiki/index.db` exists | `false` ⇒ `POST /api/v1/reindex` |
| `counts` | documents / wiki pages / sources | all zero with files presumably present ⇒ reindex |
| `page_types` | pages per type (entity, concept, …) | mismatch with `wiki_dirs` hints at misplacement — see `llmwiki-lint` |
| `wiki_dirs` | markdown files per `wiki/` subdir, `""` = top level | empty subdirs mean the vault has no content yet |

`503` here means the server was started without `--workspace`. Stop and report; retrying cannot fix it.

## 2. Rebuild the derived index

```bash
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/reindex"
```

Response: `{"indexed": <n>, "status": "ok"}`. It is synchronous, and the server kills any non-streaming request after 60s — on a large vault a timeout does not necessarily mean the run failed. Check `GET /api/v1/workspace` counts and `GET /api/v1/lint` before retrying. Reindex walks the vault, re-reads frontmatter and links, prunes rows whose files disappeared, and regenerates `wiki/index.md`. Run it after changes made outside the write API and after restoring files.

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

`PUT /api/v1/settings` is a partial update: send only the keys you change. Accepted keys include `job_instance_id`, `job_model`, `temperature`, `max_tokens`, `chunk_size`, `chunk_overlap`, `auto_reindex`, `watch_sources`, `doc_language` (`zh`/`en`), `ui_language`, `rules_supplement`, `backup_include_raw`, `vc_auto_push`, `default_agent_kind`, `default_acp_agent_id`. Unknown keys are ignored — verify by re-reading settings.

`GET` on provider instances returns `api_key_masked` only, never the key. `PUT /api/v1/provider-instances/{id}` replaces fields, including the key.

About 25 catalog providers ship with an empty `api_base` (e.g. `openai`, `groq`, `xai`) — the instance is unusable until you pass `base_url` yourself. `check` says `未设置 Base URL` in that case.

Secrets: never echo an `api_key` back to the user or into a report.

## 4. Know what the server can parse

```bash
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/capabilities"
```

Returns `file_types[]` with `tier`, `can_extract`, `can_chunk`, `missing_deps`, `remediation`, plus `runtime_dependencies[]`. If a requested format has `missing_deps`, tell the user which dependency is missing instead of queueing an ingest job that will fail.

`GET /api/v1/vcs/status` also reports git availability; without git, snapshots and ingest apply cannot commit.

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

## 6. Git snapshots

```bash
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/vcs/status"    # initialised, remote, dirty, ahead/behind
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/vcs/log?limit=20"
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/vcs/diff/{sha}"
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/vcs/init"                      # first time only
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/vcs/remote" -d '{"url":"<remote>"}' -H 'Content-Type: application/json'
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/vcs/backup"                    # commit snapshot → {"status":"ok","commit_sha":"…"}
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/vcs/push"
```

`backup` exports settings, stages the vault and commits; it returns an empty `commit_sha` when nothing changed. `push` needs a configured remote. Restoring an older state is `POST /api/v1/ingest/rollback {"commit_sha": "…"}`, which queues a rollback job — poll it like any ingest job.

## 7. Finish

Report: vault `root`, counts after reindex, the configured `job_instance_id`/`job_model`, and the snapshot sha if you committed. Skip fields you did not touch.
