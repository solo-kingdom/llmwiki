## ADDED Requirements

### Requirement: Pipeline execution recording
The ingest pipeline SHALL emit structured execution events to the job recorder for the active ingest job.

#### Scenario: Normalize step recorded
- **WHEN** job source is normalized
- **THEN** pipeline SHALL record `step=normalize` with `phase=complete` and canonical path metadata

#### Scenario: Analysis request recorded
- **WHEN** analysis LLM call starts
- **THEN** pipeline SHALL record `step=analysis`, `phase=request` with messages and model parameters

#### Scenario: Analysis response recorded
- **WHEN** analysis stream completes successfully
- **THEN** pipeline SHALL record `step=analysis`, `phase=response` with assembled text preview and timing

#### Scenario: Generation request and response recorded
- **WHEN** generation LLM call runs
- **THEN** pipeline SHALL record request and response events analogous to analysis

#### Scenario: Pipeline error recorded
- **WHEN** analysis or generation fails
- **THEN** pipeline SHALL record `phase=error` with error message before job transitions to `failed`

#### Scenario: Apply files recorded
- **WHEN** wiki FILE blocks are applied to workspace
- **THEN** pipeline SHALL record `step=apply_files`, `phase=complete` with written and deleted paths

#### Scenario: Git commit recorded
- **WHEN** version control is enabled and commit runs for the job
- **THEN** processor SHALL record `step=git_commit` with success SHA or error details

#### Scenario: Index step recorded
- **WHEN** post-ingest file indexing runs
- **THEN** processor SHALL record per-file or summary `step=index` events for failures at minimum
