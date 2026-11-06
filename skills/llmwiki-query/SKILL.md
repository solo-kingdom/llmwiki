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
  --data-urlencode "limit=10" \
  --data-urlencode "filter=wiki" \
  --data-urlencode "types=concept"
```

- `q` is required; an empty `q` returns `400`.
- `filter=wiki` (default) searches wiki pages only and skips hidden dirs (`wiki/sources/`, `wiki/templates/`).
- `filter=sources` searches source material (`raw/…`, ingested originals).
- `filter` with any other value searches everything.
- `types` is repeatable (`types=concept&types=entity`) and narrows by page type.
- Results are chunks: `{document_id, content, header_breadcrumb, chunk_index, filename, title, path, file_type, score}`.
- `path` is the **directory** with leading and trailing slash (`/wiki/concepts/`). The page path you cite is `path + filename` → `wiki/concepts/attention.md`.

Search behaviour that matters:

- FTS5 handles Latin terms; CJK recall is weaker, so try the Chinese term and its English/alias variant before concluding "not covered".
- Metadata (title, filename, path) is matched too.
- Zero results from one phrasing is not proof of absence: broaden, then check `GET /api/v1/documents?source_kind=source` for raw material.

## Read pages

```bash
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/documents/{id}/content"
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/documents?source_kind=wiki&exclude_hidden=true"
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/documents?source_kind=wiki&types=entity&types=concept"
```

`GET /api/v1/documents` returns full rows (including `content`) — prefer `/documents/{id}/content` when you only need the body. Enumerate with `exclude_hidden=true` unless you specifically want `wiki/sources/` provenance pages.

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
