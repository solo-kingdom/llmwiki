## MODIFIED Requirements

### Requirement: Two-step ingest pipeline
The system SHALL orchestrate a two-step LLM pipeline for ingestion jobs: first analyzing normalized ingest content, then generating wiki page files based on the analysis. System prompts for both steps SHALL be composed via `ComposeSystemPrompt` including workspace `purpose.md`, `rules.md`, optional `.llmwiki/prompts.yaml` append segments, and `rules_supplement` from settings. The generation step SHALL also include typed wiki organization rules and SHALL require generated wiki page text to use the active `doc_language` setting by default.

#### Scenario: Analysis step
- **WHEN** an ingest job enters processing stage with normalized source content
- **THEN** the system SHALL send the content to the LLM with a composed Chinese (when `doc_language=zh`) system prompt requesting structured analysis of entities, concepts, arguments, connections to existing wiki, contradictions, and structural recommendations, grounded in the source without external hallucination (temperature=0.1, max_tokens=4096)

#### Scenario: Generation step
- **WHEN** the analysis step completes
- **THEN** the system SHALL send the original normalized content and analysis results to the LLM with a composed system prompt requesting FILE block output (temperature=0.1, max_tokens=8192), starting with `---FILE:` immediately with no preamble, with fidelity constraints prohibiting content not supported by the source
- **AND** the generation system prompt SHALL list required sections per page type (entity, concept, source, synthesis, comparison, query) referencing `wiki/templates/`
- **AND** the generation system prompt SHALL instruct the model to write business pages only under typed wiki directories, not as `wiki/*.md` top-level pages
- **AND** generated titles, descriptions, headings, and body text SHALL use the active `doc_language` setting by default

#### Scenario: Template-aware generation prompt
- **WHEN** the pipeline runs the generation LLM step
- **THEN** the system message SHALL list required sections per page type (entity, concept, source, synthesis, comparison, query)
- **AND** the system message SHALL map each page type to its allowed typed directory

#### Scenario: Conversational draft as ingest input
- **WHEN** a user-confirmed conversational draft is submitted via legacy conversation API
- **THEN** the pipeline SHALL normalize draft content into source input and process it through the same two-step flow

#### Scenario: Session archive as ingest input
- **WHEN** an ingest job is created from session archive API
- **THEN** the pipeline SHALL normalize the session archive markdown and process it through the same two-step flow

## ADDED Requirements

### Requirement: Typed wiki FILE block application
When applying LLM-generated FILE blocks, the system SHALL reject new business wiki pages that target `wiki/` top-level paths outside the reserved top-level pages.

#### Scenario: Typed content page accepted
- **WHEN** a FILE block targets `wiki/entities/dsp.md`
- **THEN** the system SHALL accept the path for writing if other validation passes

#### Scenario: Reserved top-level page accepted
- **WHEN** a FILE block targets `wiki/overview.md`, `wiki/index.md`, or `wiki/log.md`
- **THEN** the system SHALL accept the path as a reserved top-level wiki page if other validation passes

#### Scenario: Top-level business page rejected
- **WHEN** a FILE block targets `wiki/dsp.md`
- **THEN** the system SHALL reject the block with an error that identifies the path as a misplaced business page
- **AND** the error SHALL list the allowed typed wiki directories

#### Scenario: Template target rejected for ingest output
- **WHEN** an ingest generation FILE block targets `wiki/templates/entity.md`
- **THEN** the system SHALL reject the block as a system template path
- **AND** SHALL NOT overwrite the scaffold template
