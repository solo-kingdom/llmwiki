---
name: llmwiki-archive
description: Manage raw files and multi-level folder trees in llmwiki Archives (markdown, html, image, video, audio, pdf, code) over HTTP API or MCP — upload/overwrite, browse, edit text with auto-promotion, link/unlink to Wiki pages, and trigger Wiki ingest from archived files.
license: MIT
metadata:
  author: llmwiki
  version: "1.0"
---

# llmwiki-archive

Archives store raw files and media independently from the Wiki abstraction layer (`wiki/`). `$LLMWIKI_URL` and auth (`Authorization: Bearer <token_or_api_key>`) come from the `llmwiki` entry skill.

## Storage model

- **Small files** (`size <= archive_inline_max_bytes`, default `131072` / 128 KB) are stored inline in PostgreSQL (`storage_backend = "db"`).
- **Large files** are stored in `local` (`<workspace>/.archive-blobs`) or `s3` (S3 / Aliyun OSS / MinIO).
- Editing a `db` file past the threshold via `PUT /api/v1/archives/files/:id/content` or `overwrite=true` automatically promotes it to external storage.
- HTML and SVG responses on `/raw` include `Content-Security-Policy: sandbox` and `X-Content-Type-Options: nosniff`.

## HTTP Endpoints

### Folder tree & folders

| Method & Path | Body / Query | Notes |
|---|---|---|
| `GET /api/v1/archives/tree` | `?folder=&kind=&q=` | Returns `{ folders, files }` filtered by optional `folder` subtree |
| `GET /api/v1/archives/search` | `?q=&kind=&folder=&match=&origin=&media_type=&unlinked_only=&limit=&offset=` | Searches `filename`, `title`, `relative_path`, and `searchable_text` (`fuzzy\|all_terms\|phrase\|regex`); returns `{ query, results, total, limit, offset, has_more }` |
| `POST /api/v1/archives/folders` | `{ path, display_name?, description?, sort_order?, exist_ok? }` | Auto-creates missing parent folders (`exist_ok: true` returns existing folder idempotently) |
| `PATCH /api/v1/archives/folders` | `{ path, display_name?, description?, sort_order? }` | Updates folder metadata |
| `POST /api/v1/archives/folders/move` | `{ from_path, to_path, on_conflict?: "fail" \| "merge" }` | Moves/merges folder tree (`merge` rolls back with `409 conflicts[]` on filename collision) |
| `DELETE /api/v1/archives/folders` | `?path=&mode=empty\|move_to_parent\|cascade&target_folder=` | `move_to_parent` preserves subfolder hierarchy; `cascade` deletes external blobs |

### Files (by ID or relative path)

| Method & Path | Body / Query | Notes |
|---|---|---|
| `POST /api/v1/archives/files` | `multipart/form-data` (`files`, `folder_path?`, `relative_paths?`, `overwrite?`) or `application/json` (`{ filename, folder_path?, content? \| content_base64?, title?, source_ref?, overwrite? }`) | Supports subtree `relative_paths` (`!overwrite` conflicts pre-checked atomically) and JSON creation |
| `GET /api/v1/archives/files/:id` | — | Returns file metadata + `wiki_documents` |
| `GET /api/v1/archives/files/by-path` | `?path=<relative_path>` | Lookup file metadata + `wiki_documents` by path |
| `GET /api/v1/archives/files/:id/raw` | `Range` header, `?download=1` | Streams raw bytes (`200` / `206 Partial Content`) |
| `GET /api/v1/archives/files/by-path/raw` | `?path=<relative_path>&download=1` | Streams raw bytes by path |
| `PATCH /api/v1/archives/files/:id` | `{ folder_path?, filename?, title?, source_ref?, expected_sha256? }` | Move/rename or update `title`/`source_ref` with optional `expected_sha256` / `If-Match` |
| `PUT /api/v1/archives/files/:id/content` | `{ content, expected_sha256? }` | Replace UTF-8 text content (`409` on sha256 mismatch); returns `{ file, promoted, previous_backend }` |
| `PATCH /api/v1/archives/files/:id/content` | `{ edits, expected_sha256?, dry_run? }` | Atomic text patch (`replace`/`replace_lines`/`append`/`prepend`/`insert_after`) on text-editable files |
| `POST /api/v1/archives/files/batch-get` | `{ ids?, paths?, include_text? }` | Batch read metadata and optional UTF-8 text |
| `POST /api/v1/archives/files/bulk-move` | `{ items: [{ id?\|path?, folder_path?, filename? }], dry_run? }` | Pre-checks conflicts and moves multiple files |
| `POST /api/v1/archives/files/bulk-delete` | `{ ids?, paths? }` | Deletes multiple archive files & external blobs |
| `POST /api/v1/archives/files/bulk-ingest` | `{ ids?, paths? }` | Queues ingest jobs for multiple archive files |
| `POST /api/v1/archives/files/bulk-link` | `{ action: "link"\|"unlink", items }` | Links/unlinks multiple archive files to Wiki documents |
| `DELETE /api/v1/archives/files/:id` | `?expected_sha256=` | Deletes DB row and external blob |

### Wiki integration & ingest

| Method & Path | Body | Notes |
|---|---|---|
| `POST /api/v1/archives/files/:id/ingest` | `{ source_ref? }` | Queues a Wiki ingest job from an existing archive file (`201 { job, archive_file }`) |
| `POST /api/v1/documents/:id/archive-sources` | `{ archive_file_id? \| path?, relation? }` | Manually links an archive file to a Wiki document |
| `DELETE /api/v1/documents/:id/archive-sources/:archiveId` | — | Unlinks an archive file from a Wiki document |

### Storage settings & credentials

- `GET/PUT /api/v1/settings` manages `archive_inline_max_bytes`, `archive_storage_backend` (`local`/`s3`), `archive_local_dir`, and `archive_s3_*`.
- `POST /api/v1/settings/storage/check` tests local directory writability or S3 bucket reachability.
- **Credential boundary**: Agent API Keys can read/write all `/api/v1/archives/*` and `/api/v1/documents/*/archive-sources*` endpoints, but `PUT /api/v1/settings` returns `403` if `archive_s3_access_key_id` or `archive_s3_secret_access_key` is included.

## MCP Tools

- Readonly: `archive_list`, `archive_read`, `archive_search`
- Write (requires `--mcp-allow-write`): `archive_mkdir`, `archive_upload`, `archive_patch`, `archive_move`, `archive_delete`, `archive_link`, `archive_ingest`, `archive_batch`

## Examples

```bash
# Upload a file into docs/specs
curl -sS -X POST "$LLMWIKI_URL/api/v1/archives/files" \
  -H "Authorization: Bearer $LLMWIKI_TOKEN" \
  -F "folder_path=docs/specs" \
  -F "files=@./spec.md"

# Read metadata by path, then queue Wiki ingest
curl -sS "$LLMWIKI_URL/api/v1/archives/files/by-path?path=docs/specs/spec.md" \
  -H "Authorization: Bearer $LLMWIKI_TOKEN"

curl -sS -X POST "$LLMWIKI_URL/api/v1/archives/files/<archive_id>/ingest" \
  -H "Authorization: Bearer $LLMWIKI_TOKEN" \
  -H "Content-Type: application/json" -d '{}'
```
