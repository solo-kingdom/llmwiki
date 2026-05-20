## ADDED Requirements

### Requirement: Search index updated after ingest and file changes
The system SHALL keep FTS5 search indexes in sync when wiki documents are produced or updated through ingest and when workspace wiki files change on disk.

#### Scenario: Ingest success indexes document chunks
- **WHEN** an ingest job succeeds and writes or updates wiki markdown under the workspace
- **THEN** the system SHALL chunk and store rows in `document_chunks` for the corresponding document so FTS search can return matches

#### Scenario: File watcher indexes changed wiki files
- **WHEN** the server file watcher detects a create or update under indexed wiki paths
- **THEN** the system SHALL update `document_chunks` for the affected document without requiring a manual CLI reindex

#### Scenario: Search hit includes document id
- **WHEN** client queries `/api/v1/search` or `/api/public/wiki/search` with a matching query
- **THEN** each result item SHALL include a stable `document_id` (or `id`) field suitable for opening the document in the Wiki reader
