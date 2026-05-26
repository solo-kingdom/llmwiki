## MODIFIED Requirements

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

#### Scenario: Reader header exposes search
- **WHEN** the user views the Wiki reader on any viewport size
- **THEN** the reader header SHALL expose a search affordance that opens the Wiki search modal (see `wiki-search-modal` capability)
