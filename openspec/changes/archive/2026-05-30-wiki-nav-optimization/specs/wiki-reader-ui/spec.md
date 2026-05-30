## MODIFIED Requirements

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
