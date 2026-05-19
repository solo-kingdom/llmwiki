## ADDED Requirements

<!-- Modified by change: web-default-data-ingestion -->

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

### Requirement: SHA256 incremental cache
The system SHALL compute SHA256 hashes of source file content before ingestion. If the hash matches a previous successful ingest, the pipeline SHALL be skipped.

#### Scenario: Cache hit skips LLM
- **WHEN** a source file with unchanged SHA256 is re-ingested
- **THEN** the system SHALL return the previously written file paths without making any LLM calls

#### Scenario: Cache miss proceeds with pipeline
- **WHEN** a source file has a new or changed SHA256
- **THEN** the system SHALL proceed with the full two-step ingest pipeline

#### Scenario: Cache saved only on zero hard failures
- **WHEN** ingestion completes with zero filesystem-level errors (disk full, permission denied)
- **THEN** the SHA256 cache SHALL be saved. If there are hard failures, the cache SHALL NOT be saved.

### Requirement: FILE block parsing
The system SHALL parse LLM output for `---FILE: <path> ... ---END FILE---` blocks, extract file paths and content, validate path safety, and write files to disk.

#### Scenario: Single file block parsed
- **WHEN** LLM output contains `---FILE: wiki/concepts/attention.md\n# Content\n---END FILE---`
- **THEN** the system SHALL extract path `wiki/concepts/attention.md` and content `# Content`, validate the path, and write the file

#### Scenario: Multiple file blocks parsed
- **WHEN** LLM output contains 5 FILE blocks for different wiki pages
- **THEN** the system SHALL parse and write all 5 files, handling each independently (one block's failure does not prevent others)

#### Scenario: Path traversal rejected
- **WHEN** LLM output contains `---FILE: ../../../etc/passwd\n...`
- **THEN** the system SHALL reject the block with a path safety error

#### Scenario: Non-wiki path rejected
- **WHEN** LLM output contains `---FILE: not-in-wiki/notes.md\n...`
- **THEN** the system SHALL reject the block (only paths under `wiki/` are valid targets)

### Requirement: Page merge protection
When re-ingesting into an existing wiki page, the system SHALL protect against data loss: array fields (sources, tags, related) SHALL be deterministically merged, body content SHALL be passed to LLM for merging with a minimum length sanity check (output >= 70% of max input), and locked fields (type, title, created) SHALL be preserved.

#### Scenario: Array field merge
- **WHEN** an existing page has `sources: [source1, source2]` and re-ingest produces `sources: [source3]`
- **THEN** the merged result SHALL be `sources: [source1, source2, source3]`

#### Scenario: Body merge via LLM
- **WHEN** an existing page has different body content than the re-ingest output
- **THEN** the system SHALL call LLM to merge the two versions, and SHALL reject the merge result if output < 70% of max(old, new) length

#### Scenario: Locked field preservation
- **WHEN** re-ingest output has `type: concept` but the existing page has `type: entity`
- **THEN** the merged result SHALL retain `type: entity`

<!-- Modified by change: web-default-data-ingestion -->

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

### Requirement: Concurrent ingest with same-page serialization
The system SHALL allow concurrent ingestion of different source files, while serializing writes that target the same page path using a page-level mutex keyed by normalized path.

#### Scenario: Parallel ingest on distinct targets
- **WHEN** two ingest jobs operate on different source files targeting different wiki pages
- **THEN** both jobs may proceed concurrently without global serialization

#### Scenario: Same-page contention
- **WHEN** two ingest jobs attempt to update the same wiki page concurrently
- **THEN** one job acquires the page lock and the other waits until lock release

#### Scenario: Lock contention observability
- **WHEN** lock wait time exceeds configured threshold
- **THEN** the system emits structured diagnostics containing page path and wait duration

<!-- Added by change: web-default-data-ingestion -->

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

<!-- v1-architecture-constraints codified: ingest-concurrency-control (cross-file concurrent ingest, same-page serialization, lock scope visibility already present) -->
