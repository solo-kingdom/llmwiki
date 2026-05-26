## ADDED Requirements

### Requirement: Wiki page templates scaffold
The system SHALL create `wiki/templates/` with template files for each wiki page type on workspace init.

#### Scenario: Templates on init
- **WHEN** user runs `llmwiki init`
- **THEN** `wiki/templates/` SHALL contain entity, concept, source, synthesis, comparison, and query template files
- **AND** templates SHALL use Simplified Chinese section headings

### Requirement: Generation prompt template guidance
The ingest pipeline generation step SHALL inject page type section requirements referencing wiki templates.

#### Scenario: Entity page generation
- **WHEN** pipeline generates a page under `wiki/entities/`
- **THEN** the generation system prompt SHALL include required sections for entity pages
