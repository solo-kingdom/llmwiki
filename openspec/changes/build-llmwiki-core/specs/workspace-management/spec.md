## ADDED Requirements

### Requirement: Workspace initialization
The system SHALL initialize a workspace directory with the required structure (wiki/, raw/sources/, .llmwiki/) and scaffold overview.md and log.md upon `llmwiki init <dir>`.

#### Scenario: Fresh workspace creation
- **WHEN** user runs `llmwiki init ~/research` on a non-existent directory
- **THEN** the system creates `~/research/wiki/overview.md` with placeholder content, `~/research/wiki/log.md`, and `~/research/.llmwiki/index.db` with the full schema

#### Scenario: Already initialized workspace
- **WHEN** user runs `llmwiki init` on an already initialized workspace
- **THEN** the system prints a message indicating the workspace is already initialized and exits without error

### Requirement: Workspace reindex
The system SHALL support rebuilding the entire SQLite index from filesystem files via `llmwiki reindex <dir>`. This includes parsing YAML frontmatter from wiki pages to repopulate tags, date, and metadata, and re-parsing citations and wiki links to rebuild the reference graph.

#### Scenario: Reindex after DB deletion
- **WHEN** the `.llmwiki/index.db` is deleted and user runs `llmwiki reindex ~/research`
- **THEN** all wiki pages' content, tags, date, and description are restored from their markdown files; all source files are re-indexed; all reference graph edges are rebuilt from footnote and wikilink parsing

#### Scenario: Reindex with frontmatter recovery
- **WHEN** reindex processes a wiki page with YAML frontmatter containing `tags: [ai, llm]` and `date: 2025-03-15`
- **THEN** the documents table row SHALL have `tags = '["ai", "llm"]'` and `date = '2025-03-15'`

### Requirement: File watcher
The system SHALL monitor the workspace directory for file changes (create, modify, delete) and automatically update the SQLite index, with self-write protection to avoid re-indexing files written by the system itself.

#### Scenario: External file creation
- **WHEN** a new `.md` file is created in `wiki/concepts/` by an external editor
- **THEN** within the debounce window (700ms), the file is indexed in the database with source_kind='wiki'

#### Scenario: Self-write ignored
- **WHEN** the system's write handler creates a new wiki page via MCP or HTTP
- **THEN** the file watcher SHALL NOT trigger re-indexing for that path within the cooldown window (4 seconds)

### Requirement: Ignore patterns
The system SHALL ignore changes in `.llmwiki/`, `.git/`, `node_modules/`, `__pycache__/`, `.venv/`, and directories starting with `.`.

#### Scenario: Ignored directory change
- **WHEN** a file is created inside `.llmwiki/cache/`
- **THEN** the file watcher SHALL NOT index it

### Requirement: Tiered source file processing
The system SHALL support PDF and Office file ingestion via tiered capability levels: Layer A (built-in Go parsing), Layer B (optional system dependencies like pdftotext/LibreOffice), Layer C (degradation with readable limitation markers and remediation hints).

#### Scenario: Tier selection on processing
- **WHEN** a PDF or Office file is submitted for ingest
- **THEN** the system selects the highest available processing tier based on runtime capabilities

#### Scenario: Dependency unavailable fallback
- **WHEN** required optional dependency for high-tier extraction is unavailable
- **THEN** the system degrades to a lower tier and returns structured reason metadata

#### Scenario: Degradation observability
- **WHEN** Office processing falls back due to missing converter dependency
- **THEN** response payload and logs include fallback tier, missing dependency, and remediation hint
