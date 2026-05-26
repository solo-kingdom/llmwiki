## ADDED Requirements

### Requirement: Full-text search via SQLite FTS5
The system SHALL support full-text search over document chunks using SQLite FTS5 with BM25 ranking and context snippet extraction. For CJK (Chinese) content and queries, search SHALL use a tokenizer strategy that enables character-level matching (trigram or equivalent), not relying solely on LIKE fallback for primary ranking.

#### Scenario: Keyword search across wiki
- **WHEN** client searches for "transformer attention" with mode="search"
- **THEN** results SHALL return matched chunks with filename, title, page number, header breadcrumb, BM25 score, and 120-character context snippet highlighting the query term

#### Scenario: Chinese keyword search
- **WHEN** client searches for a Chinese term present in indexed wiki content (e.g. "注意力")
- **THEN** results SHALL return matching chunks via FTS5 with BM25 ranking
- **AND** results SHALL NOT depend solely on LIKE fallback for primary ranking

#### Scenario: English search unchanged
- **WHEN** client searches for English terms (e.g. "transformer attention")
- **THEN** results SHALL continue to return relevant matches with ranking

#### Scenario: Reindex rebuilds CJK index
- **WHEN** user runs `llmwiki reindex` after CJK search upgrade
- **THEN** all document chunks SHALL be re-indexed into the updated FTS5 virtual table

#### Scenario: Search filtered by path
- **WHEN** client searches with path="/wiki/**" 
- **THEN** only documents with source_kind='wiki' SHALL appear in results

#### Scenario: Search filtered by tags
- **WHEN** client searches with tags=["research", "ai"]
- **THEN** only documents whose tags array contains ALL specified tags SHALL appear in results

### Requirement: Document listing / browsing
The system SHALL support browsing files and folders via glob matching.

#### Scenario: List wiki directory
- **WHEN** client uses mode="list" with path="/wiki/concepts/*"
- **THEN** results SHALL show filenames, titles, file types, and update timestamps for all files matching the glob, grouped by directory

### Requirement: Reference graph queries
The system SHALL support querying the citation/link graph via search mode="references".

#### Scenario: Query backlinks
- **WHEN** client queries `search(mode="references", path="/wiki/concepts/attention.md")`
- **THEN** results SHALL list all documents that link to or cite the attention page, grouped by reference_type

#### Scenario: Find uncited sources
- **WHEN** client queries `search(mode="references", query="uncited")`
- **THEN** results SHALL list all source documents that have NO wiki pages citing them

#### Scenario: Find stale pages
- **WHEN** client queries `search(mode="references", query="stale")`
- **THEN** results SHALL list all wiki pages marked with stale_since, ordered by most recently stale

### Requirement: Chunking strategy
The system SHALL chunk document content into overlapping segments (512 token target, 128 token overlap) for FTS5 indexing, preserving markdown header breadcrumbs.

#### Scenario: Document with headers chunked
- **WHEN** a document has headings "## Introduction > ### Motivation" followed by content
- **THEN** chunks under that heading SHALL have header_breadcrumb = "Introduction > Motivation"

### Requirement: FTS5 triggers for auto-sync
The system SHALL maintain FTS5 synchronization via INSERT/UPDATE/DELETE triggers on the document_chunks table.

#### Scenario: Chunk updated triggers FTS refresh
- **WHEN** a document chunk is updated in document_chunks
- **THEN** the FTS5 index SHALL automatically reflect the new content without manual re-indexing

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

### Requirement: HTTP search filtered by wiki page type
The system SHALL support filtering `GET /api/v1/search` results by wiki page type in combination with the full-text query parameter `q`.

#### Scenario: Search with types parameter
- **WHEN** client calls `GET /api/v1/search?q=attention&types=concept,entity`
- **THEN** results SHALL include only chunks from documents with `source_kind=wiki`
- **AND** document page type SHALL be in the `types` set (OR semantics among listed types)
- **AND** chunks SHALL match full-text query `q` (AND semantics between `q` and type filter)

#### Scenario: Search defaults to wiki scope
- **WHEN** client calls `GET /api/v1/search?q=foo` without path or type filters
- **THEN** results SHALL NOT include raw source documents
- **AND** SHALL be limited to wiki summary pages (equivalent to wiki path/source_kind filter)

#### Scenario: Public wiki search supports types
- **WHEN** public wiki is enabled and client calls the public wiki search endpoint with `types`
- **THEN** the same type filtering semantics SHALL apply to public wiki documents only
