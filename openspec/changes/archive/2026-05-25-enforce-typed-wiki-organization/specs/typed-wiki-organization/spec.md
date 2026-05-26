## ADDED Requirements

### Requirement: Typed wiki content directories
The system SHALL define a typed wiki organization contract for business knowledge pages. Business knowledge pages SHALL be stored under one of the known typed directories: `wiki/entities/`, `wiki/concepts/`, `wiki/sources/`, `wiki/synthesis/`, `wiki/comparisons/`, or `wiki/queries/`.

#### Scenario: Entity page belongs in entities directory
- **WHEN** a business page has page type `entity`
- **THEN** its canonical path SHALL be under `wiki/entities/`

#### Scenario: Concept page belongs in concepts directory
- **WHEN** a business page has page type `concept`
- **THEN** its canonical path SHALL be under `wiki/concepts/`

#### Scenario: Query page belongs in queries directory
- **WHEN** a business page has page type `query`
- **THEN** its canonical path SHALL be under `wiki/queries/`

### Requirement: Reserved top-level wiki pages
The system SHALL reserve `wiki/overview.md`, `wiki/index.md`, and `wiki/log.md` as the only top-level wiki markdown pages that are valid by default.

#### Scenario: Reserved navigation page allowed
- **WHEN** the system validates `wiki/overview.md`, `wiki/index.md`, or `wiki/log.md`
- **THEN** the path SHALL be accepted as a top-level system page

#### Scenario: Top-level business page is misplaced
- **WHEN** the system validates a top-level markdown page such as `wiki/dsp.md`
- **THEN** the page SHALL be classified as misplaced unless it is one of the reserved top-level pages

### Requirement: Wiki system directories
The system SHALL classify `wiki/templates/` as a system directory rather than a business knowledge directory.

#### Scenario: Template page excluded from content classification
- **WHEN** the system classifies `wiki/templates/entity.md`
- **THEN** the path SHALL be treated as a system template file
- **AND** SHALL NOT be treated as an `entity` business page

### Requirement: Shared wiki path classification
The system SHALL provide a shared path classification used consistently by ingest, lint, index generation, reindex, and organize diagnostics.

#### Scenario: Classification is reused by ingest and lint
- **WHEN** `ApplyWikiBlocks` and the lint engine evaluate the same wiki path
- **THEN** both components SHALL use the same typed wiki organization rules

#### Scenario: Unknown typed subdirectory is not business content
- **WHEN** the system classifies `wiki/random/foo.md`
- **THEN** it SHALL NOT infer a business page type unless `random` is registered as a typed wiki directory

### Requirement: Migration-safe misplaced page handling
The system SHALL report existing misplaced pages without automatically moving, deleting, or rewriting them.

#### Scenario: Existing top-level page reported only
- **WHEN** a workspace already contains `wiki/dsp.md`
- **THEN** lint or organize diagnostics SHALL report it as misplaced
- **AND** SHALL NOT move or rewrite the file automatically

#### Scenario: Suggested destination from frontmatter type
- **WHEN** a misplaced page has frontmatter `type: entity`
- **THEN** diagnostics SHALL include `wiki/entities/` as the suggested destination directory
