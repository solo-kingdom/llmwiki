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

### Requirement: Review plan step prompt composition
The ingest review plan step SHALL use the same prompt composer with step `plan`, including workspace rules and append-only overrides.

#### Scenario: Plan step uses composed prompt
- **WHEN** the pipeline runs the review plan LLM step
- **THEN** the system message SHALL be produced by `ComposeSystemPrompt(plan, ctx)` and SHALL NOT output FILE blocks
