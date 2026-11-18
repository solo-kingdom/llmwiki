# revisions

## Purpose

Define PostgreSQL as the single source of truth for pages, history and search, and replace git-based version control with deterministic change sets.

## Requirements

### Requirement: PostgreSQL single source of truth

The system SHALL store page content, chunks, references, settings, ingest jobs and revision history in PostgreSQL. Workspace files SHALL be optional exports produced by `llmwiki export`, never the runtime authority.

#### Scenario: Workspace files removed
- **WHEN** an operator deletes the workspace directory
- **THEN** document, search, graph and history APIs SHALL keep returning the stored content

#### Scenario: No git dependency
- **WHEN** `llmwiki init` or `llmwiki serve` runs on a machine without git
- **THEN** it SHALL succeed without invoking git

### Requirement: Change sets and page revisions

Every write (ingest, review apply, manual edit, delete, rollback, import) SHALL append one change set and one revision per affected page within a single PostgreSQL transaction.

#### Scenario: Two consecutive edits
- **WHEN** a page is updated twice
- **THEN** two revisions SHALL exist with increasing `revision_no` and the second pointing at the first as parent

### Requirement: Deterministic rollback

Rolling back a change set SHALL restore each touched page to its parent revision and soft-delete pages created by that change set. Rollback SHALL NOT call an LLM.

#### Scenario: Undo an update
- **WHEN** `POST /api/v1/history/{id}/rollback` targets an update change set
- **THEN** the page content SHALL equal the pre-update revision and a new `rollback` change set SHALL be recorded

#### Scenario: Restore a deleted page
- **WHEN** a revision recorded before deletion is restored
- **THEN** the document SHALL become visible again with the restored content

### Requirement: History API

The system SHALL expose `/api/v1/history`, `/api/v1/history/{id}`, `/api/v1/history/{id}/diff`, `/api/v1/pages/history`, `/api/v1/revisions/{id}` and `/api/v1/revisions/{id}/restore`. `/api/v1/vcs/*` SHALL NOT exist.

### Requirement: Search

Keyword search SHALL use PostgreSQL `tsvector` plus `pg_trgm` for CJK substrings. Semantic search SHALL store chunk embeddings in pgvector and be available when an OpenAI-compatible embedding provider is configured; hybrid mode fuses both rankings.
