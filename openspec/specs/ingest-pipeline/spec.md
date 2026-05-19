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
