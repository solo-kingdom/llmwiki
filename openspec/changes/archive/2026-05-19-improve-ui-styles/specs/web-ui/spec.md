## MODIFIED Requirements

### Requirement: Workspace management UI
The system SHALL provide a web interface for browsing wiki pages, viewing document content, and managing source files. The global navigation SHALL consist of four tabs: Ingest, Jobs, Wiki, and Settings. The default selected tab on load SHALL be Ingest. The global header SHALL use a centered floating style with rounded corners (`rounded-xl`), subtle shadow (`shadow-sm`), warm-toned background, and NO border. The header SHALL be horizontally centered within the page with spacing from the top edge.

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

#### Scenario: Centered floating header
- **WHEN** user loads the Web UI
- **THEN** the global header SHALL be centered horizontally, have rounded corners, a warm-toned background, a subtle shadow, and no border

### Requirement: Wiki tab document search
The system SHALL provide document search functionality within the Wiki tab only. The search input SHALL be placed at the top of the sidebar, above the file tree. The search results SHALL appear as a dropdown below the search input, overlaying the file tree. When a search result is selected, the corresponding document SHALL be opened and the search results SHALL be dismissed.

#### Scenario: Search bar placement
- **WHEN** user opens the Wiki tab
- **THEN** a search input SHALL be displayed at the top of the sidebar, with the file tree below it

#### Scenario: Search results dropdown
- **WHEN** user types a search query in the sidebar search input
- **THEN** search results SHALL appear as a dropdown below the input, overlaying the file tree content

#### Scenario: Search result selection
- **WHEN** user clicks a search result
- **THEN** the corresponding document SHALL be opened in the document viewer AND the search results dropdown SHALL close

#### Scenario: Search visibility scope
- **WHEN** user is on any tab other than Wiki
- **THEN** the document search input SHALL NOT be visible
