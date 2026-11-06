---
name: llmwiki
description: Operate an LLM Wiki server over its HTTP API — read and write wiki pages, run ingest pipelines, lint and repair the vault, back up with git. Use when the user mentions llmwiki, the wiki server, or asks to add, query, ingest, reorganize, lint, or back up wiki knowledge. Entry skill: it routes to the stage skills.
license: MIT
metadata:
  author: llmwiki
  version: "2.0"
---

# llmwiki

An LLM Wiki is a markdown vault (`wiki/` + `raw/`) plus a derived SQLite index that the server keeps in sync. This skill talks to that server over HTTP only. You do not need filesystem access to the vault, and you must not assume it — every read and write goes through the API.

## Setup

```bash
export LLMWIKI_URL=http://127.0.0.1:8080   # replace with the server address
export LLMWIKI_TOKEN=                       # only if the server runs with --token
AUTH=(); [ -n "$LLMWIKI_TOKEN" ] && AUTH=(-H "Authorization: Bearer $LLMWIKI_TOKEN")

curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/health"      # {"status":"ok"} means reachable
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/workspace"   # server address + vault state
```

`GET /api/v1/workspace` is the first call of every task. It returns `root`, `layout` (which parts of the vault exist), `counts`, `page_types`, `wiki_dirs`. Empty counts + `layout.index_db: false` means a fresh or unindexed vault: run `POST /api/v1/reindex` before anything else.

When a token is configured, every `/api/v1/*` call needs the `Authorization` header. Only `/api/v1/health` and `/api/public/wiki/status` are unauthenticated.

## Install the skills

The server serves its own skills, so an agent can install them without cloning the repo:

```bash
mkdir -p ~/.agents/skills/llmwiki && cd ~/.agents/skills/llmwiki
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/skill.md"           # this file
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/skills"      # {"entry":"/skill.md","skills":[{name,description,lang,url}]}
# then, for every skill in the index:
mkdir -p <name> && curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/skills/<name>.md" -o <name>/SKILL.md
```

The served copies are English; the repository also carries `SKILL.zh.md` translations next to each `SKILL.md`. Install the language the user works in. Fetching `/skill.md` needs the token when the server runs with `--token`.

If a file-based `llm-wiki` skill is also installed, the two cover different targets: that one edits a local markdown vault directly, this one drives a running server over HTTP. Do not mix them on the same vault at the same time — pick the one that matches how the user reaches the knowledge.

## Vault model

```
purpose.md            vault goal, read at the start of ingest/organize work
rules.md              house rules injected into every LLM step
raw/sources/…         source material (uploads, fetched pages) — read-only for agents
wiki/overview.md      top-level orientation page
wiki/index.md         generated table of contents — never hand-edit
wiki/log.md           append-only journal: `## [YYYY-MM-DD] action | description`
wiki/entities/ concepts/ synthesis/ comparisons/ queries/ sources/
.llmwiki/index.db     derived index (search, graph, lint) — rebuildable, never edited
```

- **Files are the truth, the index is derived.** Write through the API, then let it reindex. Changes made behind the server's back need `POST /api/v1/reindex` before search, graph or lint can see them.
- `wiki/index.md` is rebuilt by reindex and by ingest apply. Do not write it.
- `wiki/sources/` and `wiki/templates/` are indexed but hidden from listing, search and the graph — they exist for provenance, not for browsing.
- `raw/` is read-only for agents. Ingest jobs write there; agents cite it, never edit it.
- Every path in a response is workspace-relative (`wiki/concepts/foo.md`). Quote those paths when reporting.

## Route the task

| Task | Stage skill | Endpoint |
|---|---|---|
| Install, first run, configure models, git backup | `llmwiki-guide` | `GET /skills/llmwiki-guide.md` |
| Answer a question, find pages, inspect references | `llmwiki-query` | `GET /skills/llmwiki-query.md` |
| Create, edit, merge, move or delete pages | `llmwiki-organize` | `GET /skills/llmwiki-organize.md` |
| Turn files/URLs/paste into wiki knowledge | `llmwiki-ingest` | `GET /skills/llmwiki-ingest.md` |
| Find and repair vault defects | `llmwiki-lint` | `GET /skills/llmwiki-lint.md` |

Read the stage skill before starting its task; each one lists the exact payloads and the verification step.

## Hard rules

1. **Read before you write.** `GET /api/v1/documents?source_kind=wiki` and the search endpoint tell you what exists; never create a page that duplicates an existing one without merging.
2. **One page, one truth.** Content edits go to `PUT /api/v1/documents/{id}/content` with the full markdown body including frontmatter. The file wins; DB metadata is a cache.
3. **Frontmatter is mandatory** on wiki pages: `title`, `date` (`YYYY-MM-DD`), `type` matching the directory.
4. **No silent inventing.** If the vault lacks the evidence, say so and ingest a source instead of guessing.
5. **Verify with lint after every batch** of page changes; do not report success while `GET /api/v1/lint` returns `severity: error` issues you caused.
6. **Never edit `wiki/index.md`, `.llmwiki/` or `raw/`.**
7. **Report evidence, not activity**: list the paths you changed, the lint result, and the git commit sha when you committed.

## Response conventions

- Errors are `{"error": "message"}` with a 4xx/5xx status. `503` on `/api/v1/workspace` or ingest endpoints means the server has no vault configured — stop and report, do not retry in a loop.
- Lists return `[]`, never `null`.
- Ingest jobs return an id immediately; poll `GET /api/v1/ingest/jobs/{id}` (statuses `queued → running → succeeded|failed`) instead of assuming completion.
- Every non-streaming request is cut off after 60s by the server's timeout middleware. A long `POST /api/v1/reindex` on a big vault can hit it — treat a timeout as "maybe still running", re-read state, and do not fire a second reindex blindly.
