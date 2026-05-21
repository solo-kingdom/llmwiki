## MODIFIED Requirements

### Requirement: Knowledge graph Web UI
The Web UI SHALL provide a graph visualization view for browsing wiki page relationships within the Wiki reader shell.

#### Scenario: Graph view navigation
- **WHEN** user opens the knowledge graph from the Wiki reader (e.g. `/wiki/graph`)
- **THEN** a force-directed graph SHALL display wiki pages as nodes and links as edges
- **AND** the view SHALL NOT be a primary Workbench top-level navigation tab

#### Scenario: Node click opens reader
- **WHEN** user clicks a node in the graph view
- **THEN** the system SHALL navigate to Wiki Reader for that page

#### Scenario: Empty graph state
- **WHEN** workspace has fewer than 2 linked wiki pages
- **THEN** the graph view SHALL show a Chinese empty state message

#### Scenario: Legacy graph URL redirect
- **WHEN** user navigates to `/graph`
- **THEN** the system SHALL redirect to `/wiki/graph` or equivalent Wiki graph route

## REMOVED Requirements

### Requirement: Workbench graph navigation entry
**Reason**: Global knowledge graph is a wiki summary browsing affordance, not an ingest/workbench operation.
**Migration**: Use Wiki reader graph entry at `/wiki/graph`; remove Graph from Workbench `NAV_ITEMS`.
