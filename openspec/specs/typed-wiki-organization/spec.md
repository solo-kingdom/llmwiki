# typed-wiki-organization Specification

## Purpose
Define the typed wiki organization contract for business knowledge pages, including typed directories, reserved top-level pages, system directories, shared path classification, and migration-safe misplaced page handling.

## Requirements

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

### Requirement: Semantic boundary between entity and concept pages
The typed wiki organization contract SHALL define a semantic boundary between entity pages and concept pages. Entity pages SHALL describe concrete objects such as people, organizations, products, and projects. Concept pages SHALL describe reusable terms, methods, frameworks, mechanisms, theories, or models that can be linked from multiple entities or sources.

#### Scenario: Concrete organization belongs to entity page
- **WHEN** the wiki stores knowledge about a concrete company such as `AppLovin`
- **THEN** the canonical page for that object SHALL be an entity page under `wiki/entities/`

#### Scenario: Reusable method belongs to concept page
- **WHEN** the wiki stores knowledge about a reusable method such as `组织裁剪方法论`
- **THEN** the canonical page for that abstraction SHALL be a concept page under `wiki/concepts/`

#### Scenario: Entity-specific case links to reusable concept
- **WHEN** a concrete entity is an example or practitioner of a reusable concept
- **THEN** the entity page and concept page SHALL be connected through wikilinks
- **AND** the organization contract SHALL prefer a neutral concept title rather than embedding the entity name

### Requirement: Concept page naming avoids entity binding
Concept page titles and filenames SHALL avoid combining an existing entity name with an abstract concept label by default. If the source establishes the combined phrase as a fixed proper term, the page MUST explain that naming basis in the body or source context.

#### Scenario: Entity-bound concept name is discouraged
- **WHEN** a candidate concept title is shaped as `AppLovin组织裁剪方法论`
- **THEN** the organization contract SHALL prefer the neutral concept title `组织裁剪方法论`
- **AND** the page body SHALL link `[[AppLovin]]` as the relevant case or source context

#### Scenario: Proper term exception
- **WHEN** a source explicitly treats an entity-prefixed phrase as a fixed proper term
- **THEN** the wiki SHALL allow preserving the combined title
- **AND** the page SHALL include source-backed context explaining why the combined name is retained
