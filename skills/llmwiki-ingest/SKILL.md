---
name: llmwiki-ingest
description: Feed files, URLs or pasted text into an llmwiki vault over HTTP — queue ingest jobs, drive the review/plan/approve pipeline for sessions, and roll back a commit. Use when the user wants to add source material, ingest a document, summarize a conversation into the wiki, or undo a previous ingest.
license: MIT
metadata:
  author: llmwiki
  version: "2.0"
---

# llmwiki-ingest

Ingest turns source material into vault knowledge: the server extracts text, writes it under `raw/`, has the configured model draft source summaries and page updates, and (in the review flow) commits only after approval. `$LLMWIKI_URL` and auth come from the `llmwiki` entry skill.

Prerequisite: `job_instance_id` and `job_model` must be set (`llmwiki-guide` §3), otherwise jobs fail with a configuration error.

## Fast path: one source, one job

```bash
# pasted text or a small document
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/ingest/jobs/text" \
  -H 'Content-Type: application/json' \
  -d '{"content":"<text>","title":"<title>","filename":"note.md","source_ref":"user-paste"}'
# → 201 {"job":{"id":"…","status":"queued",…}}

# files (multipart, repeat -F files=@… for several)
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/ingest/jobs/upload" \
  -F "files=@./paper.pdf" -F "source_ref=user-upload"
```

The processor picks queued jobs up within a couple of seconds and walks `queued → running → succeeded | failed`. Poll:

```bash
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/ingest/jobs/{id}"
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/ingest/jobs/{id}/events"   # step-by-step progress
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/ingest/jobs/{id}/source"   # the stored source text
```

- `succeeded`: `result_summary` names the pages created or updated. Verify with `llmwiki-query`, not by trusting the summary.
- `failed`: read `error_code`, `error_message`, `missing_dependency`, `remediation`. A missing dependency (e.g. a PDF/OCR tool) is reported by `GET /api/v1/capabilities` — surface it to the user instead of retrying.
- `POST /api/v1/ingest/jobs/{id}/retry` requeues a failed job (bounded by `max_retries`); `POST /{id}/cancel` stops a queued/running one.

Do not poll in a tight loop. Check once, then wait ~10–30s between checks, and stop after a few minutes with the job id and last event in your report.

`POST /api/v1/ingest/jobs/conversation` is the legacy one-shot path (paste → job). Prefer the session flow below when the user wants to discuss, refine, or review before committing.

## Reviewed path: session → archive → plan → approve

```
POST /ingest/sessions              → session id
POST /ingest/sessions/{id}/messages (stream)  ← discuss, refine, attach files
POST /ingest/sessions/{id}/archive → review(id) in status "planning" + plan job
GET  /ingest/reviews/{review_id}/plans        → plan versions (plan_markdown + plan_json)
POST /ingest/reviews/{id}/feedback            → request changes, then /replan
POST /ingest/reviews/{id}/approve             → apply job, merges into the vault
GET  /ingest/jobs/{apply_job_id}              → succeeded → review.merge_commit_sha
```

### Session

```bash
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/ingest/sessions" \
  -H 'Content-Type: application/json' \
  -d '{"title":"季报要点","mode":"ingest"}'
```

`mode` is `ingest` (default), `qa` or `organize`; `agent_kind` defaults to `native` (this server's own LLM runtime) and can be `acp` with `acp_agent_id` to delegate to an external agent — leave it unset unless the user asks.

Messages:

```bash
# store only (no model call)
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/ingest/sessions/{id}/messages" \
  -H 'Content-Type: application/json' -d '{"content":"…"}'

# stream a model reply (SSE)
curl -fsS -N "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/ingest/sessions/{id}/messages?stream=1" \
  -H 'Content-Type: application/json' \
  -d '{"content":"请把这份纪要整理成 wiki/sources 下的来源页","wiki_refs":[{"path":"wiki/concepts/foo.md"}]}'
```

SSE events: `user_message`, `assistant_start`, `token`, `thought`, `tool_start`, `tool_done`, `plan`, `permission`, `warning`, `done` (final message object), `error`. One stream at a time per session — a second request returns `409`. Attachment upload is `POST /ingest/sessions/{id}/attachments` (multipart `file`); attachments are archived with the session.

### Archive → review

```bash
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/ingest/sessions/{id}/archive" \
  -H 'Content-Type: application/json' -d '{"title":"季报要点","deep_organize":false}'
# → 201 {"review_id":"…","status":"planning","source_path":"raw/sources/…","plan_job_id":"…"}
```

The archive transcript becomes a source file under `raw/sources/`; the review then plans how to fold it into the wiki. `deep_organize: true` lets the planner touch existing pages, not just add new ones.

Review statuses: `planning → ready_for_review → (revising ⇄) → approved → applying → succeeded | failed | cancelled`. Read plans and request changes:

```bash
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/ingest/reviews/{id}"          # review row incl. current_plan_version
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/ingest/reviews/{id}/plans"    # [{version, plan_markdown, plan_json}]
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/ingest/reviews/{id}/feedback" \
  -H 'Content-Type: application/json' -d '{"content":"合并到现有 attention 页，不要新建"}'
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/ingest/reviews/{id}/replan"   # 202, regenerates the plan
```

Show the user `plan_markdown` before approving — this is the last checkpoint before the vault changes. `approve` is only accepted in `ready_for_review` and returns `202` with an apply job id; the write happens in a worktree and merges on success, so the vault is never left half-written.

### Verify

```bash
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/ingest/reviews/{id}"     # succeeded + merge_commit_sha
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/reindex"
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/lint"
```

Then answer the user's question from the new pages and cite their paths.

## Rollback

```bash
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/ingest/rollback" \
  -H 'Content-Type: application/json' -d '{"commit_sha":"<sha from review or /vcs/log>"}'
```

Queues a rollback job: it reverts the commit, un-indexes the pages it added and re-indexes the rest. Poll it like any job, then reindex and lint. Never roll back a commit you did not identify from `GET /api/v1/vcs/log`.

## Rules

- One concern per session. A session archive becomes one source file; mixing unrelated material makes the plan unmergeable.
- Never approve a plan the user has not seen, and never approve twice — the second call returns `409`.
- If a job fails for a missing dependency or unavailable model, stop and report; retrying cannot fix configuration.
- Ingest writes `raw/` and `wiki/` itself. Do not hand-edit those files while a job on them is running.
