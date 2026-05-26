## ADDED Requirements

### Requirement: Full-text search via SQLite FTS5
The system SHALL support full-text search over document chunks using SQLite FTS5 with BM25 ranking and context snippet extraction.

#### Scenario: Keyword search across wiki
- **WHEN** client searches for "transformer attention" with mode="search"
- **THEN** results SHALL return matched chunks with filename, title, page number, header breadcrumb, BM25 score, and 120-character context snippet highlighting the query term

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
