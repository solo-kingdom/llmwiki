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
- **WHEN** a user-confirmed conversational draft is submitted
- **THEN** the pipeline SHALL normalize draft content into source input and process it through the same two-step flow

### Requirement: Ingest queue with crash recovery
The system SHALL process ingest jobs serially within a workspace queue context, persist queue state to SQLite, and support retry (max 3) on failure.

#### Scenario: Queue survives restart
- **WHEN** the service is restarted while ingest jobs are pending
- **THEN** pending jobs SHALL be recovered from SQLite and processing resumes

#### Scenario: Failed job retries
- **WHEN** an ingest job fails
- **THEN** the system SHALL retry up to 3 times before marking it as permanently failed

#### Scenario: User-triggered retry lineage
- **WHEN** user retries a permanently failed job via ingest API
- **THEN** system SHALL create a new retry attempt linked to the original job lineage for traceability

## ADDED Requirements

### Requirement: Multi-input normalization
The system SHALL normalize conversational drafts, direct text submissions, and uploaded files into a canonical ingest source representation before pipeline execution.

#### Scenario: Text submission normalization
- **WHEN** user submits raw text from Web ingest form
- **THEN** system SHALL generate canonical source artifact metadata and normalized content payload for downstream processing

#### Scenario: File upload normalization
- **WHEN** user uploads a supported file format
- **THEN** system SHALL normalize extracted or raw content with format metadata and capability tier markers

#### Scenario: Unsupported input normalization failure
- **WHEN** input format cannot be normalized
- **THEN** system SHALL mark job as failed with structured reason and remediation hint

### Requirement: Structured ingest failure diagnostics
The system SHALL classify ingest failures with deterministic error codes and remediation fields consumable by Web UI.

#### Scenario: Missing dependency classification
- **WHEN** PDF/Office extraction fails due to missing runtime dependency
- **THEN** failure metadata SHALL include dependency name and installation guidance

#### Scenario: Partial batch classification
- **WHEN** multi-file submission includes both valid and invalid items
- **THEN** system SHALL preserve per-item outcome so UI can display accepted and rejected subsets
