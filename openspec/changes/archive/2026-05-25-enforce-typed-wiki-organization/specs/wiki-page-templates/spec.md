## MODIFIED Requirements

### Requirement: Wiki page templates scaffold
The system SHALL create `wiki/templates/` with template files for each wiki page type on workspace init. Template files SHALL be treated as system scaffolds, not business knowledge pages.

#### Scenario: Templates on init
- **WHEN** user runs `llmwiki init`
- **THEN** `wiki/templates/` SHALL contain entity, concept, source, synthesis, comparison, and query template files
- **AND** templates SHALL use Simplified Chinese section headings

#### Scenario: Templates are system files
- **WHEN** the system indexes, lints, or diagnoses wiki content
- **THEN** files under `wiki/templates/` SHALL be classified as system template files
- **AND** SHALL NOT count as business knowledge pages

### Requirement: Generation prompt template guidance
The ingest pipeline generation step SHALL inject page type section requirements referencing wiki templates, allowed typed directories, and the active `doc_language` setting.

#### Scenario: Entity page generation
- **WHEN** pipeline generates a page under `wiki/entities/`
- **THEN** the generation system prompt SHALL include required sections for entity pages
- **AND** SHALL identify `wiki/entities/` as the allowed directory for entity pages

#### Scenario: Chinese generation guidance
- **WHEN** pipeline runs generation with `doc_language=zh`
- **THEN** template guidance SHALL be written in Chinese
- **AND** generated page titles, descriptions, headings, and body text SHALL default to Chinese

#### Scenario: English generation guidance
- **WHEN** pipeline runs generation with `doc_language=en`
- **THEN** template guidance SHALL be written in English
- **AND** generated page titles, descriptions, headings, and body text SHALL default to English
