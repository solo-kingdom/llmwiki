## ADDED Requirements

### Requirement: Independent Wiki reader
The system SHALL provide a Wiki reader experience that is visually and semantically distinct from the management workbench.

#### Scenario: User opens Wiki reader URL
- **WHEN** the user opens `/wiki`
- **THEN** the system SHALL render a reader-oriented Wiki interface rather than the management workbench tab content

#### Scenario: Reader excludes management navigation
- **WHEN** the user views the Wiki reader
- **THEN** the primary reader navigation SHALL NOT present Ingest, Jobs, and Settings as peer tab controls inside the reader surface

#### Scenario: Workbench links to reader
- **WHEN** the user is in the management workbench
- **THEN** the system SHALL provide a clear affordance for opening the Wiki reader

### Requirement: Reader three-column layout
The Wiki reader SHALL present document navigation, document content, and document outline as a reader-first layout on desktop screens.

#### Scenario: Desktop reader layout
- **WHEN** the user opens the Wiki reader on a desktop-sized viewport
- **THEN** the system SHALL show a left document tree panel, a central document card, and a right outline panel

#### Scenario: Empty outline does not break reading
- **WHEN** the current document has no extractable headings
- **THEN** the system SHALL keep the document readable and MAY hide or show an empty outline panel without affecting the central content

#### Scenario: Narrow viewport reader layout
- **WHEN** the user opens the Wiki reader on a narrow viewport
- **THEN** the system SHALL avoid compressing the article into three columns and SHALL provide mobile-appropriate access to document navigation and outline
