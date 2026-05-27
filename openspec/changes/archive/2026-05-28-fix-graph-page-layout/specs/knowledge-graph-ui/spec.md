## MODIFIED Requirements

### Requirement: Knowledge graph API
The system SHALL expose `GET /api/v1/graph` returning wiki page nodes and reference edges, with optional `limit` query parameter to cap result size.

#### Scenario: Graph data fetch (no limit)
- **WHEN** client calls `GET /api/v1/graph` without limit parameter
- **THEN** response SHALL include at most 300 nodes sorted by `link_count` descending, and only edges between the returned nodes
- **AND** each node SHALL include id, document_id, title, type, link_count
- **AND** each edge SHALL include source, target, type

#### Scenario: Graph data fetch with custom limit
- **WHEN** client calls `GET /api/v1/graph?limit=100`
- **THEN** response SHALL include at most 100 nodes sorted by `link_count` descending, and only edges between the returned nodes

#### Scenario: Graph data fetch with limit exceeding total nodes
- **WHEN** client calls `GET /api/v1/graph?limit=99999` and the workspace has 50 nodes
- **THEN** response SHALL include all 50 nodes and all edges between them

#### Scenario: Response includes truncation metadata
- **WHEN** the total number of wiki nodes exceeds the requested limit
- **THEN** response SHALL include a `truncated: true` field and `total_nodes` count
- **WHEN** the total number of wiki nodes is within the limit
- **THEN** response SHALL include `truncated: false` and `total_nodes` count

### Requirement: Knowledge graph Web UI
The Web UI SHALL provide a graph visualization view for browsing wiki page relationships within the Wiki reader shell, with correct layout constraints and force simulation parameters.

#### Scenario: Graph view layout
- **WHEN** user opens the knowledge graph from the Wiki reader
- **THEN** the graph component SHALL render as a direct flex child without intermediate padding wrapper divs
- **AND** the graph canvas container SHALL have a stable height derived from flex layout (no ResizeObserver feedback loop)
- **AND** ForceGraph2D SHALL auto-detect its container size without explicit width/height props

#### Scenario: Force simulation parameters
- **WHEN** the force-directed graph renders
- **THEN** the charge force strength SHALL be strong enough to spread nodes apart (at least -100)
- **AND** the simulation SHALL run enough ticks for convergence (at least 100 cooldown ticks)
- **AND** warmup ticks SHALL be configured so initial render shows partially settled layout

#### Scenario: Node label readability
- **WHEN** the graph is rendered
- **THEN** node label font size SHALL have both upper and lower bounds
- **AND** labels SHALL be hidden when zoomed out beyond a threshold (globalScale < 0.4)
- **AND** node radius SHALL scale with connection count to visually distinguish hub nodes

#### Scenario: Large graph truncation indicator
- **WHEN** the graph API returns `truncated: true`
- **THEN** the UI SHALL display a message indicating that only the top connected nodes are shown
- **AND** the message SHALL include the total node count

#### Scenario: Node click opens reader
- **WHEN** user clicks a node in the graph view
- **THEN** the system SHALL navigate to Wiki Reader for that page

#### Scenario: Empty graph state
- **WHEN** workspace has fewer than 2 linked wiki pages
- **THEN** the graph view SHALL show a Chinese empty state message

#### Scenario: Legacy graph URL redirect
- **WHEN** user navigates to `/graph`
- **THEN** the system SHALL redirect to `/wiki/graph` or equivalent Wiki graph route
