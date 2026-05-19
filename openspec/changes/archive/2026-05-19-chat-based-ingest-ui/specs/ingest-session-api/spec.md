## ADDED Requirements

### Requirement: Ingest session lifecycle API
The system SHALL expose HTTP APIs to create, read, and manage ingest sessions within the active workspace.

#### Scenario: Create session
- **WHEN** client sends `POST /api/v1/ingest/sessions` with optional title
- **THEN** system SHALL create a session record and return `session_id`, `status=active`, and timestamps

#### Scenario: Get session
- **WHEN** client requests `GET /api/v1/ingest/sessions/{id}`
- **THEN** system SHALL return session metadata including title, status, and storage paths

#### Scenario: Session not found
- **WHEN** client requests an unknown session id
- **THEN** system SHALL return HTTP 404 with structured error

### Requirement: Session message API
The system SHALL persist and list messages for an ingest session with roles `user`, `assistant`, and attachment-derived assistant summaries.

#### Scenario: Append user message
- **WHEN** client posts `POST /api/v1/ingest/sessions/{id}/messages` with text content
- **THEN** system SHALL append a `user` message and return message id and created_at

#### Scenario: List messages
- **WHEN** client requests `GET /api/v1/ingest/sessions/{id}/messages`
- **THEN** system SHALL return ordered messages including role, content, attachment references, and streaming completion status

### Requirement: Session attachment API
The system SHALL accept file and image uploads associated with a session and persist originals under the session directory in workspace storage.

#### Scenario: Upload attachment
- **WHEN** client uploads a supported file via `POST /api/v1/ingest/sessions/{id}/attachments`
- **THEN** system SHALL store the file under `raw/sources/web-ingest/sessions/{id}/attachments/` and return `attachment_id` with filename and mime metadata

#### Scenario: Reject unsupported attachment
- **WHEN** client uploads an unsupported file type
- **THEN** system SHALL reject with structured `error_code` and remediation consistent with ingest upload semantics

### Requirement: Archive session to ingest job
The system SHALL freeze the session into a canonical archive artifact, persist it to workspace storage, and enqueue an ingest job.

#### Scenario: Archive creates raw and job
- **WHEN** client posts `POST /api/v1/ingest/sessions/{id}/archive` with optional title override
- **THEN** system SHALL write `archive-<timestamp>.md` under the session directory, create ingest job with `input_type=session_archive`, and return `job_id` with initial status `queued`

#### Scenario: Archive includes conversation and attachment context
- **WHEN** session contains user messages, assistant messages, and attachment summaries
- **THEN** archive markdown SHALL include full transcript and references to stored attachment paths

#### Scenario: Archive empty session rejected
- **WHEN** client archives a session with no user messages
- **THEN** system SHALL return HTTP 400 with clear validation error

### Requirement: Session filesystem layout
Session data SHALL be stored on the filesystem as source of truth under `raw/sources/web-ingest/sessions/{session_id}/`.

#### Scenario: Session directory structure
- **WHEN** a session is created
- **THEN** system SHALL ensure directories exist for messages manifest, attachments, and future archive files
