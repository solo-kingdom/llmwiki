## ADDED Requirements

### Requirement: Unified ingest submission API
The system SHALL provide a unified HTTP API for creating ingest jobs from conversational drafts, direct text submissions, and file uploads.

#### Scenario: Create job from conversational draft
- **WHEN** client submits a confirmed conversational draft to ingest API
- **THEN** system SHALL create a new ingest job and return a unique job id with initial status `queued`

#### Scenario: Create job from direct text
- **WHEN** client submits plain text or markdown content
- **THEN** system SHALL persist the canonical source artifact to workspace storage and create an ingest job referencing that artifact

#### Scenario: Create job from uploaded files
- **WHEN** client uploads one or multiple files to ingest API
- **THEN** system SHALL validate supported input constraints, persist accepted files, and create ingest jobs for accepted items

### Requirement: Ingest job lifecycle API
The system SHALL expose APIs to query ingest job status and results using a stable lifecycle: `queued`, `running`, `succeeded`, `failed`, `cancelled`.

#### Scenario: Query job status
- **WHEN** client requests a known job id
- **THEN** system SHALL return current lifecycle status, timestamps, and progress metadata if available

#### Scenario: Query completed job result
- **WHEN** job status is `succeeded`
- **THEN** system SHALL return output summary including generated/updated document paths

#### Scenario: Query failed job result
- **WHEN** job status is `failed`
- **THEN** system SHALL return structured failure details including error code, message, and remediation hint when applicable

### Requirement: Retry and cancellation controls
The system SHALL provide operational controls for retrying failed jobs and cancelling pending/running jobs within supported boundaries.

#### Scenario: Retry failed job
- **WHEN** client issues retry for a failed job
- **THEN** system SHALL create a new job attempt linked to the original job lineage

#### Scenario: Cancel queued job
- **WHEN** client cancels a job in `queued` state
- **THEN** system SHALL transition the job to `cancelled` and prevent execution

#### Scenario: Cancel unsupported running stage
- **WHEN** client cancels a running job stage that does not support interruption
- **THEN** system SHALL return a deterministic response indicating cancellation is deferred or unsupported for the current stage
