## MODIFIED Requirements

### Requirement: Two-step ingest generation
The generation step SHALL include wiki page type section requirements in the system prompt.

#### Scenario: Template-aware generation prompt
- **WHEN** the pipeline runs the generation LLM step
- **THEN** the system message SHALL list required sections per page type (entity, concept, source, synthesis, comparison, query)
