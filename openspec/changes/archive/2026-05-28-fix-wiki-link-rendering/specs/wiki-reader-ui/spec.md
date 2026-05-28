## MODIFIED Requirements

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
