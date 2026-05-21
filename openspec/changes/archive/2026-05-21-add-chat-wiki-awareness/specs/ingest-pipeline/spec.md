## MODIFIED Requirements

### Requirement: Session archive ingest input
The ingest pipeline SHALL accept `session_archive` input type where normalized content is a frozen session transcript markdown file on disk, including referenced wiki page metadata when present.

#### Scenario: Session archive normalization
- **WHEN** ingest job has `input_type=session_archive` and valid `source_path`
- **THEN** system SHALL load transcript markdown as normalized source content for the two-step pipeline
- **AND** SHALL preserve `referenced_wiki_pages` frontmatter fields when present

#### Scenario: Session archive pipeline execution
- **WHEN** session archive job enters processing
- **THEN** system SHALL execute the same analysis and generation steps as conversation ingest jobs

#### Scenario: Plan considers referenced wiki pages
- **WHEN** review plan or analysis runs on a session archive containing `referenced_wiki_pages`
- **THEN** the pipeline SHALL treat listed paths as existing wiki anchors and prefer update/merge actions over blind create for those paths in plan output
