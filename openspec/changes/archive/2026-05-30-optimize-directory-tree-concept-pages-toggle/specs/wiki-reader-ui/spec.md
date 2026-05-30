## MODIFIED Requirements

### Requirement: Wiki sidebar type filter
The Wiki reader sidebar SHALL provide page-type filters scoped to the current sidebar mode, and the filters SHALL apply to the list currently rendered in that mode.

#### Scenario: Filter concept mode by type
- **WHEN** user is in concept mode and selects one or more page types (e.g. concept only)
- **THEN** the concept list SHALL show only wiki pages whose page type matches the selection
- **AND** selecting no types SHALL show all concept-mode supported page types

#### Scenario: Filter pages mode by type
- **WHEN** user is in pages mode and selects one or more page types
- **THEN** the directory tree SHALL show only wiki pages whose page type matches the selection within pages mode
- **AND** selecting no types SHALL show all wiki page types in pages mode

#### Scenario: Source pages labeled as summaries
- **WHEN** the UI displays page type `source`
- **THEN** the label SHALL read「来源摘要」in Chinese UI (not a generic「来源」that implies raw files)

### Requirement: Wiki sidebar entity list
The Wiki reader sidebar SHALL expose a concept-oriented list in concept mode, and SHALL NOT present a standalone entity list section in pages mode.

#### Scenario: Concept list visible by default
- **WHEN** user opens the Wiki reader on desktop
- **THEN** the sidebar SHALL default to concept mode and show a concept list containing entity pages, concept pages, and overview pages
- **AND** each entry SHALL navigate to that document on click

#### Scenario: Pages mode hides concept list section
- **WHEN** user switches sidebar to pages mode
- **THEN** the sidebar SHALL render the wiki directory tree for pages browsing
- **AND** the dedicated concept list section SHALL be hidden

### Requirement: Reader three-column layout
The Wiki reader SHALL present document navigation, document content, and document outline as a reader-first layout on desktop screens. Document navigation SHALL include page-type filters, sidebar mode switching, and mode-specific navigation content (concept list or wiki tree).

#### Scenario: Desktop reader layout
- **WHEN** the user opens the Wiki reader on a desktop-sized viewport at `/wiki` with a document selected
- **THEN** the system SHALL show a left navigation panel (mode switcher, type filters, concept list or wiki tree), a central document card, and a right outline panel

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
