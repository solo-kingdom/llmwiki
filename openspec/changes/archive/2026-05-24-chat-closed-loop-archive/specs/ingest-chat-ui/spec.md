## MODIFIED Requirements

### Requirement: Archive flow in UI
The UI SHALL provide an **归档** action that confirms intent, triggers archive API, and surfaces archive review feedback inline in Chat via ArchiveReviewCard.

#### Scenario: Archive confirmation
- **WHEN** user clicks **归档**
- **THEN** UI SHALL show confirmation (title editable, optional source note) before submitting

#### Scenario: Archive success feedback
- **WHEN** archive API returns `review_id`
- **THEN** UI SHALL render ArchiveReviewCard in Chat with the returned review
- **AND** SHALL NOT navigate to or link to a separate Review page as the primary path

#### Scenario: Archive disabled when empty
- **WHEN** session has no persisted user messages (including when only optimistic `temp-*` client rows exist)
- **THEN** **归档** button SHALL be disabled with tooltip explaining why

#### Scenario: Archive disabled when session archived
- **WHEN** the active ingest session `status` is `archived`
- **THEN** **归档** button SHALL be disabled with tooltip indicating the session is already archived

#### Scenario: Archive submit deduplication
- **WHEN** user confirms archive while a submit is already in flight
- **THEN** the UI SHALL invoke the archive API at most once until the in-flight request completes
