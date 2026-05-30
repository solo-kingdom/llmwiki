## Requirements

### Requirement: Independent Wiki reader
The system SHALL provide a Wiki reader experience that is visually and semantically distinct from the management workbench. The Wiki reader SHALL render `[[wikilink]]` syntax as clickable links that navigate to referenced documents.

#### Scenario: User opens Wiki reader URL
- **WHEN** the user opens `/wiki`
- **THEN** the system SHALL render a reader-oriented Wiki interface rather than the management workbench tab content

#### Scenario: Reader excludes management navigation
- **WHEN** the user views the Wiki reader
- **THEN** the primary reader navigation SHALL NOT present Ingest, Jobs, and Settings as peer tab controls inside the reader surface

#### Scenario: Workbench links to reader
- **WHEN** the user is in the management workbench
- **THEN** the system SHALL provide a clear affordance for opening the Wiki reader

#### Scenario: Reader header exposes search
- **WHEN** the user views the Wiki reader on any viewport size
- **THEN** the reader header SHALL expose a search affordance that opens the Wiki search modal (see `wiki-search-modal` capability)

#### Scenario: Wikilink renders as clickable link
- **WHEN** the user views a wiki document containing `[[attention]]` in the Wiki reader
- **THEN** the system SHALL render it as a clickable link that navigates to the referenced document

#### Scenario: Broken wikilink displays with distinct style
- **WHEN** the user views a wiki document containing `[[nonexistent]]` that does not resolve to any document
- **THEN** the system SHALL render it with a `wikilink-broken` CSS class for visual distinction

### Requirement: Wiki-only document scope
The Wiki reader SHALL load and display only documents with `source_kind=wiki`. Raw source files and other non-wiki documents SHALL NOT appear in the reader sidebar tree or entity list.

#### Scenario: Sidebar excludes raw files
- **WHEN** user opens the Wiki reader
- **THEN** the document tree SHALL NOT include paths under `raw/`
- **AND** listed documents SHALL be limited to wiki summary pages

### Requirement: Wiki sidebar type filter
The Wiki reader sidebar SHALL provide page-type filters ONLY in pages mode. Wiki mode SHALL NOT display page-type filters.

#### Scenario: Filter pages mode by type
- **WHEN** user is in pages mode and selects one or more page types
- **THEN** the directory tree SHALL show only wiki pages whose page type matches the selection within pages mode
- **AND** selecting no types SHALL show all wiki page types in pages mode

#### Scenario: Wiki mode hides type filter
- **WHEN** user is in Wiki mode
- **THEN** the sidebar SHALL NOT display page-type filter chips
- **AND** all entity and concept documents SHALL be shown without type filtering

#### Scenario: Source pages labeled as summaries
- **WHEN** the UI displays page type `source`
- **THEN** the label SHALL read「来源摘要」in Chinese UI (not a generic「来源」that implies raw files)

### Requirement: Wiki sidebar entity list
The Wiki reader sidebar SHALL expose a grouped knowledge list in Wiki mode with entities and concepts displayed as separate, independently collapsible sections. Each section SHALL show its own header with item count.

#### Scenario: Wiki mode shows grouped entity and concept lists
- **WHEN** user opens the Wiki reader in Wiki mode
- **THEN** the sidebar SHALL show two independently collapsible sections: one for entity pages and one for concept pages
- **AND** each section header SHALL display the type label and item count
- **AND** items within each section SHALL be sorted alphabetically

#### Scenario: Entity section lists entity-type documents
- **WHEN** Wiki mode renders the entity section
- **THEN** the section SHALL list only documents whose page type is `entity` (including overview documents)
- **AND** each entry SHALL navigate to that document on click

#### Scenario: Concept section lists concept-type documents
- **WHEN** Wiki mode renders the concept section
- **THEN** the section SHALL list only documents whose page type is `concept`
- **AND** each entry SHALL navigate to that document on click

#### Scenario: Empty section behavior
- **WHEN** a section (entity or concept) has no matching documents
- **THEN** that section SHALL NOT be rendered
- **AND** the other section SHALL still display normally if it has items

#### Scenario: Pages mode hides grouped list
- **WHEN** user switches sidebar to pages mode
- **THEN** the sidebar SHALL render the wiki directory tree for pages browsing
- **AND** the grouped entity/concept list sections SHALL be hidden

### Requirement: Wiki reader graph entry
The Wiki reader SHALL expose a navigation affordance to the global knowledge graph view within the Wiki shell.

#### Scenario: Open graph from Wiki header
- **WHEN** user clicks the graph entry in the Wiki reader chrome
- **THEN** the system SHALL navigate to `/wiki/graph` while keeping Wiki reader chrome (not Workbench tabs)

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
