<!-- Added by change: web-default-data-ingestion -->

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

## ADDED Requirements

### Requirement: Rollback job 创建端点
系统 SHALL 提供 HTTP API 用于创建 rollback job。

#### Scenario: 创建 rollback job
- **WHEN** 客户端发送 `POST /api/v1/ingest/rollback` 请求，body 包含 `commit_sha`
- **THEN** 系统 SHALL 验证 commit SHA 有效且为 ingest 类型 commit
- **AND** 创建 `input_type = 'rollback'` 的 job，`source_ref` 存储 commit SHA
- **AND** 返回创建的 job 信息

#### Scenario: 无效 commit SHA
- **WHEN** 请求的 commit SHA 不存在
- **THEN** 系统 SHALL 返回 404 错误

#### Scenario: Rollback commit 不可回滚
- **WHEN** 目标 commit 是 rollback 类型（非 ingest 产生）
- **THEN** 系统 SHALL 返回 400 错误，提示该 commit 不支持回滚

#### Scenario: 版本控制未启用
- **WHEN** workspace 未启用版本控制
- **THEN** 系统 SHALL 返回 400 错误，提示需先启用版本控制
