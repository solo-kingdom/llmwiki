---
name: llmwiki-query
description: Answer questions from an llmwiki vault and inspect its structure over HTTP — search chunks, read pages, walk backlinks/forward links, and find uncited or stale material. Use when the user asks what the wiki knows about a topic, wants a summary grounded in wiki pages, or asks how pages relate.
license: MIT
metadata:
  author: llmwiki
  version: "2.0"
---

# llmwiki-query

Answer from the vault, never from memory. `$LLMWIKI_URL` and the optional auth header come from the `llmwiki` entry skill.

## Search

```bash
curl -fsS -G "${AUTH[@]}" "$LLMWIKI_URL/api/v1/search" \
  --data-urlencode "q=attention mechanism" \
  --data-urlencode "scope=wiki" \
  --data-urlencode "limit=10" \
  --data-urlencode "offset=0" \
  --data-urlencode "filter=wiki" \
  --data-urlencode "match=fuzzy" \
  --data-urlencode "types=concept"
```

- `q` is required; an empty `q` returns `400`.
- `scope` (`wiki|archives|all`, default `wiki`): searches Wiki pages, raw Archives (`archive_results` / `archive_total`), or both in parallel.
- `filter=wiki` (default) searches wiki pages only and skips hidden dirs (`wiki/sources/`); `filter=sources` searches source material; `filter=wiki/<subpath>` or `folder=<subpath>` narrows to a folder prefix.
- `match` (`fuzzy|all_terms|phrase|regex`, default `fuzzy`) and `case_sensitive=true|false`: exact `phrase` and `regex` (invalid regex returns `400`) return `matched_lines: [{line, text}]`.
- Rich filters: `types`, `kinds`, `statuses`, `confidences`, `tags` + `tag_mode=any|all`, `updated_after`, `updated_before`, `archived` (`exclude|include|only`, default `exclude`), `review_overdue=true`, `sort` (`relevance|updated_desc|updated_asc`), `group_by` (`document|chunk`, default `document`).
- Pagination & mode observability: `limit` (1–100), `offset`, `total`, `has_more`, plus `effective_mode` and `degraded_reason` when hybrid falls back to keyword.
- Search also matches `aliases`, `symptoms`, and `tags`. Each chunk carries `relative_path`, `tags`, `updated_at`, `snippet`, and optional `matched_lines`.

Search behaviour that matters:

- FTS5 handles Latin terms; CJK recall is weaker, so try the Chinese term and its English/alias variant before concluding "not covered".
- Metadata (title, filename, path) is matched too.
- Zero results from one phrasing is not proof of absence: broaden, then check `GET /api/v1/documents?source_kind=source` for raw material.

## Read pages

```bash
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/documents/by-path?path=wiki/concepts/attention.md&include_content=false"
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/documents/{id}/content"
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/documents/batch-get" \
  -H 'Content-Type: application/json' -d '{"paths":["wiki/concepts/attention.md"],"fields":"outline"}'
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/documents?source_kind=wiki&exclude_hidden=true&paginated=true&limit=50"
```

`GET /api/v1/documents/by-path` addresses directly by path (`include_content=false` omits body). `POST /api/v1/documents/batch-get` fetches multiple pages (`fields=meta|content|outline`). `GET /api/v1/documents` supports `folder`, `tags`, `tag_mode`, `updated_after`, `updated_before`, `limit`, `offset`, `paginated=true`.

## Structure and relations

```bash
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/graph?limit=300"        # {nodes, edges, total_nodes, truncated}
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/graph/backlinks/{id}"   # who links here
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/graph/forward/{id}"     # what this page links to
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/graph/uncited"          # sources no page cites
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/graph/stale"            # pages needing refresh
```

Nodes carry `{id, document_id, title, type, link_count}`; edges carry `{source, target, type}` and are keyed by page path, not document id. Backlink and forward rows use the same `path`-is-a-directory convention plus `filename`. `truncated: true` means the graph is cut to `limit` nodes — raise `limit` only when you really need the full picture.

## Answer protocol

1. Search 2–3 phrasings before deciding a topic is missing.
2. Read the top 2–5 pages fully; the snippet is not the page.
3. Check `backlinks` for pages that contradict or qualify the answer.
4. Answer in the user's language, citing page paths (`wiki/concepts/attention.md`) for every claim.
5. If the vault does not cover it, say so plainly, name what is missing, and offer `llmwiki-ingest` to add a source. Do not fill the gap with general knowledge unless the user asked for it and you label it as outside the vault.
6. When sources and pages disagree, present both and name the conflict instead of picking one silently.

## Read-only guard

Query work never writes. If answering requires a new page or a merge, hand off to `llmwiki-organize` and keep the user's question answered from what already exists.
