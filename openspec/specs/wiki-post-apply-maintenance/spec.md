# wiki-post-apply-maintenance Specification

## Purpose
Define automatic post-apply maintenance tasks that run after successful ingest review apply, including wiki index rebuild and organize structure log appending.
## Requirements

### Requirement: Post-apply index rebuild
After a successful ingest review apply that writes or deletes wiki pages, the system SHALL automatically rebuild `wiki/index.md` from the current workspace filesystem without requiring a manual `llmwiki reindex`.

#### Scenario: Ingest apply rebuilds index
- **WHEN** apply completes successfully and at least one wiki FILE or DELETE block was applied
- **THEN** the system SHALL regenerate `wiki/index.md` using the index builder
- **AND** SHALL re-index the updated `wiki/index.md` in SQLite

#### Scenario: Apply with no wiki changes skips rebuild
- **WHEN** apply completes but no wiki paths were written or deleted
- **THEN** the system SHALL NOT rebuild `wiki/index.md`

#### Scenario: Index rebuild failure is non-fatal
- **WHEN** index rebuild fails after an otherwise successful apply
- **THEN** the apply job SHALL remain `succeeded`
- **AND** the system SHALL record a warning in job events

### Requirement: Organize apply structure log entry
When an organize mode review apply includes structural plan actions (move, merge, or path-level delete), the system SHALL append a single entry to `wiki/log.md` describing the structural change summary.

#### Scenario: Move actions append log
- **WHEN** organize apply succeeds and the plan contains one or more move actions with valid `from_path` and `to_path`
- **THEN** the system SHALL append a log entry using format `## [YYYY-MM-DD] organize | <summary>`
- **AND** the summary SHALL mention the count of move actions

#### Scenario: Merge actions append log
- **WHEN** organize apply succeeds and the plan contains one or more merge actions
- **THEN** the log entry summary SHALL mention the count of merge actions

#### Scenario: Update-only organize apply skips structure log
- **WHEN** organize apply succeeds but all plan actions are `update`
- **THEN** the system SHALL NOT append an organize-specific structure log entry

#### Scenario: Log append preserves existing content
- **WHEN** the system appends an organize structure log entry
- **THEN** existing `wiki/log.md` content SHALL be preserved
- **AND** the new entry SHALL be appended at the end

### Requirement: Post-apply index consistency
After post-apply maintenance runs, the SQLite index SHALL reflect the rebuilt `wiki/index.md` and other files touched during apply.

#### Scenario: Index file re-indexed after rebuild
- **WHEN** post-apply maintenance rebuilds `wiki/index.md`
- **THEN** the file watcher or apply indexer hook SHALL index the new index content into SQLite
