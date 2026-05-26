## ADDED Requirements

### Requirement: Knowledge graph API
The system SHALL expose `GET /api/v1/graph` returning wiki page nodes and reference edges.

#### Scenario: Graph data fetch
- **WHEN** client calls `GET /api/v1/graph`
- **THEN** response SHALL include nodes array (id, title, type) and edges array (source, target, type)
- **AND** edges SHALL include links_to relationships from the reference graph

### Requirement: Knowledge graph Web UI
The Web UI SHALL provide a graph visualization view for browsing wiki page relationships.

#### Scenario: Graph view navigation
- **WHEN** user opens the Graph entry in workbench navigation
- **THEN** a force-directed graph SHALL display wiki pages as nodes and links as edges

#### Scenario: Node click opens reader
- **WHEN** user clicks a node in the graph view
- **THEN** the system SHALL navigate to Wiki Reader for that page

#### Scenario: Empty graph state
- **WHEN** workspace has fewer than 2 linked wiki pages
- **THEN** the graph view SHALL show a Chinese empty state message
