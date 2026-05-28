## MODIFIED Requirements

### Requirement: Knowledge graph Web UI
The Web UI SHALL provide a graph visualization view for browsing wiki page relationships within the Wiki reader shell, with correct layout constraints, force simulation parameters, and node click navigation that directly loads the target document.

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
- **AND** force parameters SHALL be configured via engine initialization callback (not React effects), ensuring correct configuration regardless of component loading timing
- **AND** nodes SHALL have randomized initial positions to reduce warmup convergence time

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
- **THEN** the system SHALL call `selectDocument` from WikiReaderContext to load the target document
- **AND** the URL SHALL be updated to `/wiki?doc=<id>`
- **AND** the Wiki reader SHALL display the selected document's content

#### Scenario: Empty graph state
- **WHEN** workspace has fewer than 2 linked wiki pages
- **THEN** the graph view SHALL show a Chinese empty state message

#### Scenario: Legacy graph URL redirect
- **WHEN** user navigates to `/graph`
- **THEN** the system SHALL redirect to `/wiki/graph` or equivalent Wiki graph route
