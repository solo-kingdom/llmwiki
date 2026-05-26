## ADDED Requirements

### Requirement: Session active review summary
The system SHALL expose active ingest review metadata on session detail responses so Chat can restore ArchiveReviewCard without client-only state.

#### Scenario: Session detail includes active review
- **WHEN** client requests `GET /api/v1/ingest/sessions/{id}`
- **AND** the session has an associated ingest review in a non-terminal state (`planning`, `ready_for_review`, `revising`, `approved`, `applying`) or recently succeeded review linked to the session
- **THEN** the response SHALL include an `active_review` object with at minimum: `review_id`, `status`, `current_plan_version`
- **AND** when apply has completed with VCS enabled SHALL include `merge_commit_sha`

#### Scenario: Session without review
- **WHEN** client requests session detail for a session with no ingest review
- **THEN** `active_review` SHALL be omitted or null

### Requirement: Review detail merge commit SHA
The system SHALL return merge commit SHA on review detail when review apply completed with version control enabled.

#### Scenario: Succeeded review returns commit SHA
- **WHEN** client requests `GET /api/v1/ingest/reviews/{id}`
- **AND** review status is `succeeded`
- **AND** apply merged to main via git
- **THEN** the response SHALL include `merge_commit_sha`

#### Scenario: Non-VCS apply omits commit SHA
- **WHEN** review succeeded without version control
- **THEN** `merge_commit_sha` SHALL be omitted or empty
