## MODIFIED Requirements

### Requirement: Retry and cancellation controls
The system SHALL provide operational controls for retrying failed and cancelled jobs and cancelling pending/running jobs within supported boundaries.

#### Scenario: Retry failed job
- **WHEN** client issues retry for a failed job
- **THEN** system SHALL transition the **same** job to `queued`
- **AND** system SHALL clear failure and result fields (`error`, `error_code`, `error_message`, `missing_dependency`, `remediation`, `result_summary`) so the job presents as a clean retry
- **AND** system SHALL NOT create a new ingest job row or set `parent_job_id` for the retry

#### Scenario: Retry cancelled job (Restart)
- **WHEN** client issues retry for a cancelled job
- **THEN** system SHALL transition the **same** job to `queued` with failure and result fields cleared, matching the failed-job retry behavior
- **AND** system SHALL NOT create a new ingest job row

#### Scenario: Retry response returns same job
- **WHEN** retry succeeds for a failed or cancelled job with id `J`
- **THEN** HTTP response SHALL return job id `J` with status `queued`

#### Scenario: Retry unsupported status
- **WHEN** client issues retry for a job in queued, running, or succeeded status
- **THEN** system SHALL return a 400 error with message indicating only failed and cancelled jobs can be retried

#### Scenario: Cancel queued job
- **WHEN** client cancels a job in `queued` state
- **THEN** system SHALL transition the job to `cancelled` and prevent execution

#### Scenario: Cancel unsupported running stage
- **WHEN** client cancels a running job stage that does not support interruption
- **THEN** system SHALL return a deterministic response indicating cancellation is deferred or unsupported for the current stage
