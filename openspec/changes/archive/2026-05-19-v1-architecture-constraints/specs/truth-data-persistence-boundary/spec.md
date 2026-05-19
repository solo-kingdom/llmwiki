## ADDED Requirements

### Requirement: File-first truth persistence
Business truth data SHALL be persisted to filesystem artifacts as canonical source of truth.

#### Scenario: Canonical wiki page persistence
- **WHEN** a wiki page is created or updated
- **THEN** the canonical content is written to markdown files on disk before or atomically with index updates

### Requirement: Derived-only database policy
SQLite SHALL store only rebuildable derived data (e.g., chunks, FTS index, references, status indexes), while allowing optional cached mirrors for performance.

#### Scenario: Rebuild after DB loss
- **WHEN** SQLite index database is removed and reindex is executed
- **THEN** core wiki business semantics (content, frontmatter-derived metadata, references) are reconstructed from filesystem truth artifacts

### Requirement: Cache non-authoritativeness
Any cached truth mirror in DB SHALL be treated as non-authoritative and replaceable by filesystem reconstruction.

#### Scenario: Cache divergence recovery
- **WHEN** cached metadata in DB diverges from file content
- **THEN** file content prevails and cache is refreshed during reindex or reconciliation
