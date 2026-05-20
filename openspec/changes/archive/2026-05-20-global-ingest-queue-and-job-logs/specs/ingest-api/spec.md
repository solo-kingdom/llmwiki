## ADDED Requirements

### Requirement: Global serial ingest queue
The system SHALL ensure at most one ingest job is actively running per workspace database at any time.

#### Scenario: Single active runner
- **WHEN** job processor attempts to claim the next queued job
- **THEN** system SHALL NOT claim if another job has `status=running` with `heartbeat_at` within the stale threshold (120 seconds)
- **AND** SHALL claim at most one job per successful claim transaction

#### Scenario: Claim sets lease fields
- **WHEN** a queued job is claimed
- **THEN** system SHALL set `status=running`, `runner_id` to the current processor instance id, and `heartbeat_at` to current time
- **AND** claim SHALL occur inside a SQLite `BEGIN IMMEDIATE` transaction

#### Scenario: Heartbeat during execution
- **WHEN** a job remains in `running` status
- **THEN** the processor SHALL refresh `heartbeat_at` at least every 30 seconds while executing

### Requirement: Stale running job recovery
The system SHALL automatically recover stale running jobs to the queue.

#### Scenario: Recover on startup
- **WHEN** `JobProcessor` starts
- **THEN** system SHALL requeue all jobs where `status=running` and `heartbeat_at` is older than 120 seconds

#### Scenario: Recover before claim
- **WHEN** processor claims the next job
- **THEN** system SHALL run stale recovery in the same transaction before selecting a queued job

#### Scenario: Requeue clears failure fields
- **WHEN** a stale running job is recovered
- **THEN** system SHALL set `status=queued`
- **AND** SHALL clear `error`, `error_code`, `error_message`, `missing_dependency`, `remediation`, `result_summary`, `runner_id`, and `heartbeat_at`
- **AND** SHALL NOT set status to `failed`

#### Scenario: Rollback jobs included
- **WHEN** a stale job has `input_type=rollback`
- **THEN** recovery rules SHALL apply identically to ingest jobs

## MODIFIED Requirements

### Requirement: Ingest job lifecycle API
The system SHALL expose APIs to query ingest job status and results using a stable lifecycle: `queued`, `running`, `succeeded`, `failed`, `cancelled`.

#### Scenario: Query job status
- **WHEN** client requests a known job id
- **THEN** system SHALL return current lifecycle status, timestamps, and progress metadata if available
- **AND** MAY include `heartbeat_at` for running jobs to support UI staleness hints

#### Scenario: Query completed job result
- **WHEN** job status is `succeeded`
- **THEN** system SHALL return output summary including generated/updated document paths

#### Scenario: Query failed job result
- **WHEN** job status is `failed`
- **THEN** system SHALL return structured failure details including error code, message, and remediation hint when applicable
