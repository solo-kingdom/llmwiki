## ADDED Requirements

### Requirement: Document CRUD operations
The system SHALL support creating, reading, updating, and deleting documents (both wiki pages and source files) with path safety validation and dual write to filesystem and SQLite.

#### Scenario: Create a new wiki page
- **WHEN** a client creates a page with title "Attention Mechanisms" at path `/wiki/concepts/`
- **THEN** the system writes `wiki/concepts/attention-mechanisms.md` to the filesystem, inserts a row in the documents table with source_kind='wiki', and parses YAML frontmatter to extract date and description

#### Scenario: Read a document with backlinks
- **WHEN** a client reads a wiki page that has 3 incoming references from other pages
- **THEN** the response SHALL include a "Referenced by (3)" section listing the source pages and reference types

#### Scenario: Update document content with str_replace
- **WHEN** a client uses str_replace to change a specific text block in a wiki page
- **THEN** the system SHALL verify the old_text matches exactly one occurrence, replace it, write to filesystem, update the DB record (version++), re-chunk for FTS5, and sync the reference graph

#### Scenario: Delete with protection
- **WHEN** a client attempts to delete `/wiki/overview.md` or `/wiki/log.md`
- **THEN** the system SHALL return an error: "Cannot delete — these are structural wiki pages. Use write/edit instead."

#### Scenario: Path traversal prevention
- **WHEN** a client attempts to write a file with path containing `../` or absolute paths
- **THEN** the system SHALL reject the operation

### Requirement: Filename slugification
The system SHALL automatically convert titles to safe filenames by lowercasing, replacing spaces with hyphens, and removing special characters.

#### Scenario: Title to filename
- **WHEN** a client creates a page with title "KV Cache Efficiency"
- **THEN** the filename SHALL be `kv-cache-efficiency.md`

### Requirement: Frontmatter parsing
The system SHALL parse YAML frontmatter (`---\n...\n---`) from markdown files on write and reindex, extracting at minimum `title`, `date`, `tags`, and `description` fields.

#### Scenario: Write with frontmatter
- **WHEN** a wiki page is created or updated with YAML frontmatter containing `tags: [optimization, memory]` and `description: A comprehensive guide`
- **THEN** the DB record SHALL have `tags` JSON array and `metadata.description` populated

### Requirement: Cascade deletion
When a source file is deleted, the system SHALL remove its wiki summary page, clean up references from other wiki pages' `sources[]` arrays, and purge dead wikilinks.

#### Scenario: Source with multiple contributors deleted
- **WHEN** a source file is deleted and a wiki page's `sources` frontmatter lists 3 sources including the deleted one
- **THEN** the wiki page SHALL remain with the 2 surviving sources in its `sources[]` array

#### Scenario: Source with sole contributor deleted
- **WHEN** a source file is deleted and it is the ONLY source in a wiki page's `sources` frontmatter
- **THEN** the wiki page SHALL be deleted as it has no remaining source of truth
