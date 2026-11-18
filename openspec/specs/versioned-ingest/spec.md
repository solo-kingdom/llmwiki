# versioned-ingest

## Purpose

Record every ingest/review apply as an atomic change set.

## Requirements

### Requirement: DB-first apply

The ingest pipeline SHALL persist generated pages through the store's `ApplyChangeSet` transaction. It SHALL NOT write workspace files or create git commits.

#### Scenario: Ingest creates a page
- **WHEN** an ingest job writes `wiki/concepts/x.md`
- **THEN** a change set of kind `ingest` and a `create` revision SHALL be stored atomically with the document and chunks

### Requirement: Review apply

Applying an approved review plan SHALL create a `review_apply` change set and store its id on the review (`change_set_id`).

### Requirement: Source bytes

Uploaded source bytes SHALL be stored in `source_blobs`; the legacy `merge_commit_sha` field SHALL NOT exist.
