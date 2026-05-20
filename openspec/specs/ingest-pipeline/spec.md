## ADDED Requirements

### Requirement: Session archive ingest input
The ingest pipeline SHALL accept `session_archive` input type where normalized content is a frozen session transcript markdown file on disk.

#### Scenario: Session archive normalization
- **WHEN** ingest job has `input_type=session_archive` and valid `source_path`
- **THEN** system SHALL load transcript markdown as normalized source content for the two-step pipeline

#### Scenario: Session archive pipeline execution
- **WHEN** session archive job enters processing
- **THEN** system SHALL execute the same analysis and generation steps as conversation ingest jobs

## MODIFIED Requirements

### Requirement: Two-step ingest pipeline
The system SHALL orchestrate a two-step LLM pipeline for ingestion jobs: first analyzing normalized ingest content, then generating wiki page files based on the analysis.

#### Scenario: Analysis step
- **WHEN** an ingest job enters processing stage with normalized source content
- **THEN** the system SHALL send the content to the LLM with a system prompt requesting structured analysis of entities, concepts, arguments, connections to existing wiki, contradictions, and structural recommendations (temperature=0.1, max_tokens=4096)

#### Scenario: Generation step
- **WHEN** the analysis step completes
- **THEN** the system SHALL send the original normalized content and analysis results to the LLM with a system prompt requesting FILE block output (temperature=0.1, max_tokens=8192), starting with `---FILE:` immediately with no preamble

#### Scenario: Conversational draft as ingest input
- **WHEN** a user-confirmed conversational draft is submitted via legacy conversation API
- **THEN** the pipeline SHALL normalize draft content into source input and process it through the same two-step flow

#### Scenario: Session archive as ingest input
- **WHEN** an ingest job is created from session archive API
- **THEN** the pipeline SHALL normalize the session archive markdown and process it through the same two-step flow

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
