## MODIFIED Requirements

### Requirement: Wiki file application with merge protection
When applying LLM-generated FILE blocks to existing wiki pages, the pipeline SHALL merge with existing content instead of blind overwrite.

#### Scenario: New page direct write
- **WHEN** FILE block targets a path that does not exist
- **THEN** the system SHALL write the new content directly

#### Scenario: Existing page field merge
- **WHEN** FILE block targets an existing wiki page
- **THEN** locked frontmatter fields (type, title, created) SHALL be preserved from existing file
- **AND** array fields (tags, sources, related) SHALL be union-merged without duplicates

#### Scenario: Existing page body merge
- **WHEN** new body content differs from existing body
- **THEN** the system SHALL invoke LLM-assisted merge preserving existing information
- **AND** merged body length SHALL NOT be less than 70% of existing body length

#### Scenario: Merge failure aborts write
- **WHEN** merge fails or length guard triggers
- **THEN** the system SHALL NOT write partial content and SHALL return an error

#### Scenario: Force overwrite bypass
- **WHEN** ingest is invoked with force overwrite enabled
- **THEN** the system SHALL skip merge and overwrite as current behavior
