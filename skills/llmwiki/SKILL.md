---
name: llmwiki
description: Operate an LLM Wiki server over its HTTP API — read and write wiki pages, run ingest pipelines, lint and repair the vault, and inspect or roll back history. Use when the user mentions llmwiki, the wiki server, or asks to add, query, ingest, reorganize, lint, or roll back wiki knowledge. Entry skill: it routes to the stage skills.
license: MIT
metadata:
  author: llmwiki
  version: "2.1"
---

# llmwiki

> **Version declaration**: `skill: project-design-patterns@1.1.0` — This document follows the `agent-api-ops` conventions in `project-design-patterns`. Before the first operation in a session, compare your local `project-design-patterns` version; if older, upgrade via `npx skills add sunzhenkai/solo-skills -s project-design-patterns -g -y` and re-read `references/agent-api-ops.md`.

An LLM Wiki is a markdown vault (`wiki/` + `raw/`) backed by a PostgreSQL store that the server keeps in sync. This skill talks to that server over HTTP only. You do not need filesystem access to the vault, and you must not assume it — every read and write goes through the API.

## Access & Authentication

- **API Base**: Use the server URL from the handoff prompt (e.g. `http://127.0.0.1:8080` or `https://wiki.lan`).
- **Authentication**: Send `Authorization: Bearer <API Key>` on every `/api/v1/*` business request. Keys use the `llmwiki_sk_…` prefix and are created in **Settings › Access Control** (the legacy `--token` / `api_token` is also accepted).
- **Public endpoints** (no auth required): `GET /api/v1/health`, `GET /api/public/wiki/status` (and `/api/public/wiki/*` when public wiki is enabled), `GET /skill.md`, `GET /skills/*`, `GET /api/v1/skills`.
- **Boundary**: An API Key can call all business endpoints, but **cannot manage credentials** (`GET/POST/DELETE /api/v1/api-keys*` and modifying `api_token` via `PUT /api/v1/settings` return `403`). Manage keys in the web UI.
- **401 handling**: `401` means the key is invalid or revoked — stop retrying and ask the user to recreate a key in **Settings › Access Control** and update `~/.agent-state/app-keys/llmwiki.env`. Never print full keys in output or logs; only show the prefix (`llmwiki_sk_xxxx…`).

```bash
source ~/.agent-state/app-keys/llmwiki.env   # APP_API_BASE, APP_API_KEY
AUTH=(-H "Authorization: Bearer $APP_API_KEY")

curl -fsS "$APP_API_BASE/api/v1/health"                   # {"status":"ok"}
curl -fsS "${AUTH[@]}" "$APP_API_BASE/api/v1/workspace"   # vault layout & counts
```

`GET /api/v1/workspace` is the first call of every task. It returns `root`, `layout` (which parts of the vault exist), `counts`, `page_types`, `wiki_dirs`. Empty counts + `layout.index_db: false` means PostgreSQL is not initialized: check `--database-url` and run `llmwiki init` before anything else.

## Install the skills

The server serves its own skills without authentication, so an agent can inspect or install them without cloning the repo:

```bash
curl -fsS "$APP_API_BASE/skill.md"           # this entry doc
curl -fsS "$APP_API_BASE/api/v1/skills"      # {"entry":"/skill.md","skills":[{name,description,lang,url,url_zh}]}
curl -fsS "$APP_API_BASE/skills/<name>.md"   # stage skill (or <name>.zh.md for Chinese)
```

If a file-based `llm-wiki` skill is also installed, the two cover different targets: that one edits a local markdown vault directly, this one drives a running server over HTTP. Do not mix them on the same vault at the same time — pick the one that matches how the user reaches the knowledge.

## Core Endpoints

| Area | Method & Path | Summary |
| --- | --- | --- |
| System | `GET /api/v1/health` | Health check (public) |
| Workspace | `GET /api/v1/workspace` | Vault layout, counts, page types, directories |
| Index | `POST /api/v1/reindex` | Rebuild derived index from store/vault |
| Tree & Folders | `GET /api/v1/tree`, `GET/POST/PATCH/DELETE /api/v1/folders`, `POST /api/v1/folders/move` | Topic tree and folder management |
| Documents | `GET/POST /api/v1/documents`, `GET/PATCH/DELETE /api/v1/documents/:id` | List/create/read/update metadata/delete pages |
| Content | `GET/PUT /api/v1/documents/:id/content` | Read or replace full markdown body (including frontmatter) |
| Lifecycle | `POST /api/v1/documents/:id/{move,archive,reopen}`, `POST /api/v1/documents/bulk-delete` | Move, archive, reopen, bulk delete |
| Search | `GET /api/v1/search?q=&mode=&limit=` | Full-text / hybrid search across chunks & metadata |
| Graph & Lint | `GET /api/v1/graph`, `GET /api/v1/graph/{backlinks/:id,forward/:id,uncited,stale}`, `GET /api/v1/lint` | Knowledge graph and vault health checks |
| Ingest | `GET/POST /api/v1/ingest/jobs*`, `GET/POST /api/v1/ingest/sessions*`, `GET/POST /api/v1/ingest/reviews*` | Ingest jobs, interactive sessions, review plans |
| History | `GET /api/v1/history`, `GET /api/v1/history/:id{,/diff}`, `POST /api/v1/history/:id/rollback`, `GET /api/v1/pages/history`, `POST /api/v1/revisions/:id/restore` | Change sets, diffs, rollback, revision restore |
| Archives | `GET /api/v1/archives/tree`, `GET /api/v1/archives/search`, `POST/PATCH/DELETE /api/v1/archives/folders`, `POST /api/v1/archives/folders/move`, `POST /api/v1/archives/files`, `GET /api/v1/archives/files/by-path{,/raw}`, `GET/PATCH/DELETE /api/v1/archives/files/:id`, `GET /api/v1/archives/files/:id/raw`, `PUT /api/v1/archives/files/:id/content`, `POST /api/v1/archives/files/:id/ingest`, `POST/DELETE /api/v1/documents/:id/archive-sources` | File tree & raw file storage (md/html/image/video/etc.), content search, Range streaming, Wiki linking & ingest |
| Settings | `GET/PUT /api/v1/settings`, `POST /api/v1/settings/storage/check`, `GET/PUT /api/v1/workspace/rule-files` | Runtime settings (`api_token` and S3 credentials blocked for API Keys) and `purpose.md` / `rules.md` |

## Vault model

```
purpose.md            vault goal, read at the start of ingest/organize work
rules.md              house rules injected into every LLM step
raw/sources/…         source material (uploads, fetched pages) — read-only for agents
wiki/overview.md      top-level orientation page
wiki/index.md         generated table of contents — never hand-edit
wiki/log.md           append-only journal: `## [YYYY-MM-DD] action | description`
wiki/<topic>/...      nested topic folders (page `type` in frontmatter: entity|concept|synthesis|comparison|query|experience|ledger|page)
wiki/sources/         source summaries (hidden from listing/search/graph)
wiki/templates/       system page templates
PostgreSQL            pages, folders, revisions, search, graph, lint — the only source of truth
```

- **Write through the API.** Changes made behind the server's back need `POST /api/v1/reindex` before search, graph or lint can see them.
- `wiki/index.md` is rebuilt by reindex and by ingest apply. Do not write it.
- `wiki/sources/` and `wiki/templates/` are indexed but hidden from listing, search and the graph — they exist for provenance, not for browsing.
- `raw/` is read-only for agents. Ingest jobs write there; agents cite it, never edit it.
- Every path in a response is workspace-relative (`wiki/concepts/foo.md`). Quote those paths when reporting.

## Route the task

| Task | Stage skill | Endpoint |
| --- | --- | --- |
| Install, first run, configure models and embeddings, history and rollback | `llmwiki-guide` | `GET /skills/llmwiki-guide.md` |
| Answer a question, find pages, inspect references | `llmwiki-query` | `GET /skills/llmwiki-query.md` |
| Create, edit, merge, move or delete pages | `llmwiki-organize` | `GET /skills/llmwiki-organize.md` |
| Manage raw files, folders, media & Wiki source links | `llmwiki-archive` | `GET /skills/llmwiki-archive.md` |
| Turn files/URLs/paste into wiki knowledge | `llmwiki-ingest` | `GET /skills/llmwiki-ingest.md` |
| Find and repair vault defects | `llmwiki-lint` | `GET /skills/llmwiki-lint.md` |

Read the stage skill before starting its task; each one lists the exact payloads and the verification step.

## Hard rules

1. **Read before you write.** `GET /api/v1/documents?source_kind=wiki` and the search endpoint tell you what exists; never create a page that duplicates an existing one without merging.
2. **One page, one truth.** Content edits go to `PUT /api/v1/documents/{id}/content` with the full markdown body including frontmatter.
3. **Frontmatter is mandatory** on wiki pages: `title`, `date` (`YYYY-MM-DD`), `type`; `status` is required for `experience`/`ledger`; include `confidence` (`high|medium|low`) and `sources`.
4. **No silent inventing.** If the vault lacks the evidence, say so and ingest a source instead of guessing; never present `draft`, `deprecated`, or archived pages as current truth.
5. **Confirm destructive changes.** Confirm with the user before deleting, overwriting, or bulk-modifying pages.
6. **Verify with lint after every batch** of page changes; do not report success while `GET /api/v1/lint` returns `severity: error` issues you caused.
7. **Never edit `wiki/index.md`, `.llmwiki/` or `raw/`.**
8. **Report evidence, not activity**: list the paths you changed, the lint result, and the change set id when you rolled back.

## Response conventions

- Errors are `{"error": "message"}` with a 4xx/5xx status. `503` on `/api/v1/workspace` or ingest endpoints means the server has no vault configured — stop and report, do not retry in a loop.
- Lists return `[]`, never `null`.
- Ingest jobs return an id immediately; poll `GET /api/v1/ingest/jobs/{id}` (statuses `queued → running → succeeded|failed`) instead of assuming completion.
- `GET /api/v1/ingest/jobs` returns `{ jobs, total, counts }`, not a bare array. Filter with `status` (comma-separated `queued`, `running`, `succeeded`, `failed`, `cancelled`), `input_type`, and `q` (matches id, source path, and source ref). `limit` defaults to 50 and caps at 100; `offset` pages through `total`. `counts` is the unfiltered tally of every status.
- Every non-streaming request is cut off after 60s by the server's timeout middleware. A long `POST /api/v1/reindex` on a big vault can hit it — treat a timeout as "maybe still running", re-read state, and do not fire a second reindex blindly.
