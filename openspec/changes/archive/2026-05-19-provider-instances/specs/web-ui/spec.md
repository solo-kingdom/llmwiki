## MODIFIED Requirements

### Requirement: Workspace management UI
The system SHALL provide a web interface for browsing wiki pages, viewing document content, and managing source files. The global navigation SHALL consist of four tabs: Ingest, Jobs, Wiki, and Settings. The default selected tab on load SHALL be Ingest. The Settings page SHALL provide a Provider instance management section for adding, editing, and deleting provider configurations.

#### Scenario: File tree navigation
- **WHEN** user opens the Wiki tab in the Web UI
- **THEN** a file tree SHALL display the wiki/ and raw/ directory structure with expandable folders

#### Scenario: Document content view
- **WHEN** user clicks on a wiki page in the file tree
- **THEN** the page content SHALL be rendered as formatted markdown (GFM tables, code blocks, wikilinks)

#### Scenario: Four-tab global navigation
- **WHEN** user loads the Web UI
- **THEN** the global header SHALL display four tabs: Ingest (with optional warning icon), Jobs, Wiki, and Settings

#### Scenario: Ingest-first default landing
- **WHEN** user opens the Web UI root URL
- **THEN** the default active tab SHALL be Ingest with the chat-based ingest interface

#### Scenario: Settings provider section replaced with instance management
- **WHEN** user opens the Settings tab
- **THEN** the Provider section SHALL show a list of user-added provider instances (not all catalog providers) with add, edit, and delete affordances

#### Scenario: Provider keys section removed
- **WHEN** user views the Settings page
- **THEN** the old "Provider Keys" card that listed all 18+ catalog providers SHALL NOT be present
