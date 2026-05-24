## ADDED Requirements

### Requirement: Typed organization aware index generation
The system SHALL generate `wiki/index.md` from typed business content pages only. Reserved top-level pages and system template files SHALL be excluded from content index entries.

#### Scenario: Template files excluded from generated index
- **WHEN** `llmwiki reindex` rebuilds `wiki/index.md`
- **THEN** files under `wiki/templates/` SHALL NOT appear as content rows in the generated index

#### Scenario: Misplaced top-level pages excluded from typed groups
- **WHEN** `llmwiki reindex` sees `wiki/dsp.md`
- **THEN** `wiki/dsp.md` SHALL NOT be inserted into the entities, concepts, sources, synthesis, comparisons, or queries groups
- **AND** lint or organize diagnostics SHALL remain responsible for reporting the misplaced page

### Requirement: Init repair preserves typed directory scaffold
The system SHALL ensure all typed wiki directories and system directories exist on every `llmwiki init` run, including repair runs on older workspaces.

#### Scenario: Repair creates missing typed directories
- **WHEN** user runs `llmwiki init` on a workspace missing `wiki/entities/` or `wiki/concepts/`
- **THEN** the system SHALL create the missing typed directories
- **AND** SHALL NOT overwrite existing wiki pages

#### Scenario: Repair creates templates directory
- **WHEN** user runs `llmwiki init` on a workspace missing `wiki/templates/`
- **THEN** the system SHALL create `wiki/templates/` and missing template scaffold files
- **AND** SHALL NOT treat template scaffold files as business content pages
