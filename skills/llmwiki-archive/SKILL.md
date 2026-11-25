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
| `GET /api/v1/archives/tree` | `?kind=&q=` | Returns `{ folders, files }` |
| `POST /api/v1/archives/folders` | `{ path, display_name?, description?, sort_order? }` | Auto-creates missing parent folders |
| `PATCH /api/v1/archives/folders` | `{ path, display_name?, description?, sort_order? }` | Updates folder metadata |
| `POST /api/v1/archives/folders/move` | `{ from_path, to_path }` | Moves folder tree and updates child file paths |
| `DELETE /api/v1/archives/folders` | `?path=&mode=empty\|move_to_parent\|cascade&target_folder=` | `cascade` also deletes external blobs |

### Files (by ID or relative path)

| Method & Path | Body / Query | Notes |
|---|---|---|
| `POST /api/v1/archives/files` | `multipart/form-data`: `files` (or `file`), `folder_path?`, `overwrite?` | Supports multiple files; `overwrite=true` replaces content in-place keeping ID and Wiki links |
| `GET /api/v1/archives/files/:id` | — | Returns file metadata + `wiki_documents` |
| `GET /api/v1/archives/files/by-path` | `?path=<relative_path>` | Lookup file metadata + `wiki_documents` by path |
| `GET /api/v1/archives/files/:id/raw` | `Range` header, `?download=1` | Streams raw bytes (`200` / `206 Partial Content`) |
| `GET /api/v1/archives/files/by-path/raw` | `?path=<relative_path>&download=1` | Streams raw bytes by path |
| `PATCH /api/v1/archives/files/:id` | `{ folder_path?, filename? }` | Move or rename file |
| `PUT /api/v1/archives/files/:id/content` | `{ content }` | Replace UTF-8 text content; returns `{ file, promoted, previous_backend }` |
| `DELETE /api/v1/archives/files/:id` | — | Deletes DB row and external blob |

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

- Readonly: `archive_list`, `archive_read`
- Write (requires `--mcp-allow-write`): `archive_mkdir`, `archive_upload`, `archive_move`, `archive_delete`, `archive_link`, `archive_ingest`

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
