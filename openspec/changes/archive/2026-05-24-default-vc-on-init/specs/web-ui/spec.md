## MODIFIED Requirements

### Requirement: Workspace management UI
The system SHALL provide a web interface for browsing wiki summary pages in the Wiki reader and for managing ingest operations in the workbench. The workbench global navigation SHALL consist of top-level entries: Ingest (Chat), Jobs, Timeline, Logs, and Settings, plus a Wiki reader link. The workbench SHALL NOT include a separate Raw Ingest entry, a Graph top-level entry, or a Review top-level entry. The default selected entry on load SHALL be Ingest (Chat). Direct raw ingest (batch files and text blocks) SHALL be accessible from within the Chat interface, not as a standalone workbench view. The management workbench global header SHALL use the same card-style bar as the Wiki reader header (`rounded-xl`, `border-border/70`, `bg-card/70`, `backdrop-blur-sm`, `shadow-sm`, fixed height `h-12`). The workbench header width SHALL match the workbench content column (`max-w-5xl` with consistent horizontal padding). The global navigation visual treatment SHALL use semantic navigation buttons instead of a tab-group control. The Settings page SHALL provide a Provider instance management section for adding, editing, and deleting provider configurations.

#### Scenario: Wiki reader shows wiki-only tree
- **WHEN** user opens the Wiki reader
- **THEN** the sidebar tree SHALL display only the `wiki/` directory structure (not `raw/`)

#### Scenario: Document content view
- **WHEN** user clicks on a wiki page in the Wiki reader tree or entity list
- **THEN** the page content SHALL be rendered as formatted markdown (GFM tables, code blocks, wikilinks)

#### Scenario: Global navigation excludes separate Ingest tab
- **WHEN** user loads the management workbench
- **THEN** the global header SHALL display navigation entries including Ingest (Chat), Jobs, Timeline, Logs, and Settings
- **AND** a separate Raw Ingest tab, Review, and Graph SHALL NOT appear in workbench navigation

#### Scenario: Ingest-first default landing
- **WHEN** user opens the Web UI root URL
- **THEN** the default active entry SHALL be Ingest (Chat) with the chat-based ingest interface

#### Scenario: Legacy ingest route redirects to Chat
- **WHEN** user navigates to `/ingest`
- **THEN** the UI SHALL redirect to the Chat (Ingest) view
- **AND** SHALL open the direct ingest panel automatically

#### Scenario: Navigation uses semantic buttons
- **WHEN** user views the global header navigation
- **THEN** each navigation item SHALL be rendered as a navigation button-style control, not as a tab-group trigger
