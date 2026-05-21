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
The system SHALL orchestrate a two-step LLM pipeline for ingestion jobs: first analyzing normalized ingest content, then generating wiki page files based on the analysis. System prompts for both steps SHALL be composed via `ComposeSystemPrompt` including workspace `purpose.md`, `rules.md`, optional `.llmwiki/prompts.yaml` append segments, and `rules_supplement` from settings.

#### Scenario: Analysis step
- **WHEN** an ingest job enters processing stage with normalized source content
- **THEN** the system SHALL send the content to the LLM with a composed Chinese (when `doc_language=zh`) system prompt requesting structured analysis of entities, concepts, arguments, connections to existing wiki, contradictions, and structural recommendations, grounded in the source without external hallucination (temperature=0.1, max_tokens=4096)

#### Scenario: Generation step
- **WHEN** the analysis step completes
- **THEN** the system SHALL send the original normalized content and analysis results to the LLM with a composed system prompt requesting FILE block output (temperature=0.1, max_tokens=8192), starting with `---FILE:` immediately with no preamble, with fidelity constraints prohibiting content not supported by the source

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

#### Scenario: Cache hit recorded
- **WHEN** ingest pipeline skips LLM steps due to SHA256 cache hit
- **THEN** pipeline SHALL record `step=cache`, `phase=hit` with canonical path and written paths metadata

#### Scenario: Git commit recorded
- **WHEN** version control is enabled and commit runs for the job
- **THEN** processor SHALL record `step=git_commit` with success SHA or error details

#### Scenario: Index step recorded
- **WHEN** post-ingest file indexing runs
- **THEN** processor SHALL record per-file or summary `step=index` events for failures at minimum

### Requirement: Review plan step prompt composition
The ingest review plan step SHALL use the same prompt composer with step `plan`, including workspace rules and append-only overrides.

#### Scenario: Plan step uses composed prompt
- **WHEN** the pipeline runs the review plan LLM step
- **THEN** the system message SHALL be produced by `ComposeSystemPrompt(plan, ctx)` and SHALL NOT output FILE blocks

### Requirement: SHA256 incremental cache
The ingest pipeline SHALL skip LLM analysis and generation when the source content hash matches a cached entry for the same canonical path.

#### Scenario: File ingest cache hit
- **WHEN** `Ingest()` is called on a source file whose SHA256 matches the cache entry
- **THEN** the pipeline SHALL skip LLM steps and return previously written wiki paths

#### Scenario: Normalized ingest cache hit
- **WHEN** `IngestNormalized()` is called with content whose SHA256 matches a cached entry for the same canonical path
- **THEN** the pipeline SHALL skip LLM steps and return previously written wiki paths

#### Scenario: Cache miss on content change
- **WHEN** source content SHA256 differs from cached entry
- **THEN** the pipeline SHALL run full two-step ingest and update the cache entry

#### Scenario: Cache miss when written files missing
- **WHEN** cache entry exists but one or more `WrittenFiles` no longer exist on disk
- **THEN** the pipeline SHALL treat as cache miss and re-run ingest
