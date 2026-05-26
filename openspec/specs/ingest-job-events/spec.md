## ADDED Requirements

### Requirement: Job execution event storage
The system SHALL persist per-job execution events in SQLite table `ingest_job_events` with fields: `job_id`, `step`, `phase`, `message`, `payload` (JSON string), `created_at`.

#### Scenario: Record pipeline step
- **WHEN** an ingest job progresses through normalize, analysis, generation, apply_files, git_commit, or index
- **THEN** the system SHALL append one or more events with appropriate `step` and `phase` values

#### Scenario: Record LLM request and response
- **WHEN** the pipeline invokes analysis or generation LLM calls
- **THEN** the system SHALL record a `request` phase event containing model and message payloads (sanitized)
- **AND** SHALL record a `response` phase event after the stream completes with assembled output preview and duration metadata

#### Scenario: Sanitize sensitive fields
- **WHEN** writing event payload JSON
- **THEN** the system SHALL omit or redact `api_key`, `authorization`, and similar secret fields

### Requirement: Per-job event retention
The system SHALL retain at most N execution events per job, where N is read from `ingest_job_events_max_count` in `app_config`.

#### Scenario: Trim on insert
- **WHEN** a new event is inserted for job `J`
- **THEN** the system SHALL delete oldest events for `J` until count ≤ N

#### Scenario: Default retention
- **WHEN** `ingest_job_events_max_count` is unset or invalid
- **THEN** the system SHALL use default N = 200

#### Scenario: Config bounds
- **WHEN** client sets `ingest_job_events_max_count` via Settings API
- **THEN** the system SHALL accept integers from 50 to 2000 inclusive

### Requirement: Stale recovery event
The system SHALL record a `stale_recovered` event when a stale running job is requeued.

#### Scenario: Stale job requeued
- **WHEN** a running job is recovered to `queued` due to heartbeat timeout
- **THEN** the system SHALL append event with `step=system`, `phase=stale_recovered`
- **AND** message SHALL indicate heartbeat timeout and requeue

### Requirement: Job events query API
The system SHALL expose job execution events for debugging.

#### Scenario: List events for job
- **WHEN** client requests `GET /api/v1/ingest/jobs/{id}/events`
- **THEN** system SHALL return events for that job ordered by `id` ascending (chronological)
- **AND** SHALL support optional `limit` query parameter (default 500, max 500)

#### Scenario: Job not found
- **WHEN** client requests events for unknown job id
- **THEN** system SHALL return HTTP 404

#### Scenario: Cascade delete
- **WHEN** an ingest job row is deleted
- **THEN** associated `ingest_job_events` rows SHALL be removed (ON DELETE CASCADE)
