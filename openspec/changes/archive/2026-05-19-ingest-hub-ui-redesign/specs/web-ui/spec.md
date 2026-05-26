## MODIFIED Requirements

### Requirement: Workspace management UI
The system SHALL provide a web interface for browsing wiki pages, viewing document content, and managing source files. The global navigation SHALL consist of four tabs: Ingest Hub, Jobs, Wiki, and Settings.

#### Scenario: File tree navigation
- **WHEN** user opens the Web UI
- **THEN** a file tree SHALL display the wiki/ and raw/ directory structure with expandable folders

#### Scenario: Document content view
- **WHEN** user clicks on a wiki page in the file tree
- **THEN** the page content SHALL be rendered as formatted markdown (GFM tables, code blocks, wikilinks)

#### Scenario: Four-tab global navigation
- **WHEN** user loads the Web UI
- **THEN** the global header SHALL display four tabs: Ingest Hub (with optional warning icon), Jobs, Wiki, and Settings
