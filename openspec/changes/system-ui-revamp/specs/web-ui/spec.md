## MODIFIED Requirements

### Requirement: Workspace management UI
The system SHALL provide a web interface for browsing wiki pages, viewing document content, and managing source files. The global navigation SHALL consist of four top-level entries: Ingest, Jobs, Wiki, and Settings. The default selected entry on load SHALL be Ingest. The global header SHALL use a centered floating style with rounded corners (`rounded-xl`), subtle shadow (`shadow-sm`), warm-toned background, and no heavy border. The global navigation visual treatment SHALL use semantic navigation buttons instead of a tab-group control. The Settings page SHALL provide a Provider instance management section for adding, editing, and deleting provider configurations.

#### Scenario: File tree navigation
- **WHEN** user opens the Wiki entry in the Web UI
- **THEN** a file tree SHALL display the wiki/ and raw/ directory structure with expandable folders

#### Scenario: Document content view
- **WHEN** user clicks on a wiki page in the file tree
- **THEN** the page content SHALL be rendered as formatted markdown (GFM tables, code blocks, wikilinks)

#### Scenario: Four-entry global navigation
- **WHEN** user loads the Web UI
- **THEN** the global header SHALL display four entries: Ingest (with optional warning icon), Jobs, Wiki, and Settings

#### Scenario: Ingest-first default landing
- **WHEN** user opens the Web UI root URL
- **THEN** the default active entry SHALL be Ingest with the chat-based ingest interface

#### Scenario: Navigation uses semantic buttons
- **WHEN** user views the global header navigation
- **THEN** each navigation item SHALL be rendered as a navigation button-style control, not as a tab-group trigger

#### Scenario: Centered floating header
- **WHEN** user loads the Web UI
- **THEN** the global header SHALL be centered horizontally, have rounded corners, a warm-toned background, a subtle shadow, and no heavy border

#### Scenario: Settings provider section replaced with instance management
- **WHEN** user opens the Settings entry
- **THEN** the Provider section SHALL show a list of user-added provider instances (not all catalog providers) with add, edit, and delete affordances

#### Scenario: Provider keys section removed
- **WHEN** user views the Settings page
- **THEN** the old "Provider Keys" card that listed all catalog providers SHALL NOT be present
