## MODIFIED Requirements

### Requirement: Retry and cancellation controls
The system SHALL provide operational controls for retrying failed and cancelled jobs and cancelling pending/running jobs within supported boundaries.

#### Scenario: Retry failed job
- **WHEN** client issues retry for a failed job
- **THEN** system SHALL create a new job attempt linked to the original job lineage

#### Scenario: Retry cancelled job (Restart)
- **WHEN** client issues retry for a cancelled job
- **THEN** system SHALL create a new job attempt linked to the original job lineage, preserving the cancellation history

#### Scenario: Retry unsupported status
- **WHEN** client issues retry for a job in queued, running, or succeeded status
- **THEN** system SHALL return a 400 error with message indicating only failed and cancelled jobs can be retried

#### Scenario: Cancel queued job
- **WHEN** client cancels a job in `queued` state
- **THEN** system SHALL transition the job to `cancelled` and prevent execution

#### Scenario: Cancel unsupported running stage
- **WHEN** client cancels a running job stage that does not support interruption
- **THEN** system SHALL return a deterministic response indicating cancellation is deferred or unsupported for the current stage

## ADDED Requirements

### Requirement: Job source file API
The system SHALL provide an API endpoint to read the source file associated with an ingest job.

#### Scenario: Read text source file
- **WHEN** client requests `GET /api/v1/ingest/jobs/{id}/source` for a job whose `source_path` has `.md` or `.txt` extension
- **THEN** system SHALL return JSON `{ content: string, filename: string }` with the file's text content

#### Scenario: Read image source file
- **WHEN** client requests `GET /api/v1/ingest/jobs/{id}/source` for a job whose `source_path` has an image extension
- **THEN** system SHALL return the binary file content with the appropriate `Content-Type` header

#### Scenario: Job not found
- **WHEN** client requests source for a non-existent job ID
- **THEN** system SHALL return HTTP 404

#### Scenario: Source file not found on disk
- **WHEN** client requests source for a job whose `source_path` file has been deleted from disk
- **THEN** system SHALL return HTTP 404 with a descriptive error message

#### Scenario: Path traversal prevention
- **WHEN** a job's `source_path` contains `..` components or resolves outside the workspace directory
- **THEN** system SHALL return HTTP 400 with a security error message
