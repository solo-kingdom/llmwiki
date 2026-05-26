## ADDED Requirements

### Requirement: Wiki-only document scope
The Wiki reader SHALL load and display only documents with `source_kind=wiki`. Raw source files and other non-wiki documents SHALL NOT appear in the reader sidebar tree or entity list.

#### Scenario: Sidebar excludes raw files
- **WHEN** user opens the Wiki reader
- **THEN** the document tree SHALL NOT include paths under `raw/`
- **AND** listed documents SHALL be limited to wiki summary pages

### Requirement: Wiki sidebar type filter
The Wiki reader sidebar SHALL provide multi-select page-type filters that apply to both the directory tree and the entity list.

#### Scenario: Filter tree by type
- **WHEN** user selects one or more page types (e.g. concept only)
- **THEN** the directory tree SHALL show only wiki pages whose page type matches the selection
- **AND** selecting no types SHALL show all wiki page types

#### Scenario: Source pages labeled as summaries
- **WHEN** the UI displays page type `source`
- **THEN** the label SHALL read「来源摘要」in Chinese UI (not a generic「来源」that implies raw files)

### Requirement: Wiki sidebar entity list
The Wiki reader sidebar SHALL include a dedicated entity list section showing all wiki pages with page type `entity`, sorted by title.

#### Scenario: Entity list visible by default
- **WHEN** user opens the Wiki reader on desktop
- **THEN** the sidebar SHALL show an entity list above or beside the directory tree
- **AND** each entry SHALL navigate to that document on click

#### Scenario: Entity list respects type filter
- **WHEN** user selects type filters that exclude entity
- **THEN** the entity list section SHALL be hidden or empty

### Requirement: Wiki reader graph entry
The Wiki reader SHALL expose a navigation affordance to the global knowledge graph view within the Wiki shell.

#### Scenario: Open graph from Wiki header
- **WHEN** user clicks the graph entry in the Wiki reader chrome
- **THEN** the system SHALL navigate to `/wiki/graph` while keeping Wiki reader chrome (not Workbench tabs)

## MODIFIED Requirements

### Requirement: Reader three-column layout
The Wiki reader SHALL present document navigation, document content, and document outline as a reader-first layout on desktop screens. Document navigation SHALL include page-type filters, an entity list, and a wiki-only directory tree as defined in sidebar requirements.

#### Scenario: Desktop reader layout
- **WHEN** the user opens the Wiki reader on a desktop-sized viewport at `/wiki` with a document selected
- **THEN** the system SHALL show a left navigation panel (type filters, entity list, wiki tree), a central document card, and a right outline panel

#### Scenario: Empty outline does not break reading
- **WHEN** the current document has no extractable headings
- **THEN** the system SHALL keep the document readable and MAY hide or show an empty outline panel without affecting the central content

#### Scenario: Narrow viewport reader layout
- **WHEN** the user opens the Wiki reader on a narrow viewport
- **THEN** the system SHALL avoid compressing the article into three columns and SHALL provide mobile-appropriate access to document navigation and outline

#### Scenario: Graph route uses reader chrome
- **WHEN** the user opens `/wiki/graph`
- **THEN** the system SHALL render the global knowledge graph in the main content area
- **AND** the reader chrome SHALL remain available for returning to document reading
