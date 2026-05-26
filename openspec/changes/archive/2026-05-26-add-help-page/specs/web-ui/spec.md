## MODIFIED Requirements

### Requirement: Workspace management UI
The system SHALL provide a web interface for browsing wiki summary pages in the Wiki reader and for managing ingest operations in the workbench. The workbench global navigation SHALL consist of top-level entries: Ingest (Chat), Jobs, Timeline, Logs, Help, and Settings, plus a Wiki reader link. The workbench SHALL NOT include a separate Raw Ingest entry, a Graph top-level entry, or a Review top-level entry. The default selected entry on load SHALL be Ingest (Chat). Ready-made plain text materials SHALL be addable from within the Chat interface via the context append dialog, not as a standalone workbench view or direct pipeline submission. The management workbench global header SHALL use the same card-style bar as the Wiki reader header (`rounded-xl`, `border-border/70`, `bg-card/70`, `backdrop-blur-sm`, `shadow-sm`, fixed height `h-12`). The workbench header width SHALL match the workbench content column (`max-w-5xl` with consistent horizontal padding). The global navigation visual treatment SHALL use semantic navigation buttons instead of a tab-group control. The Settings page SHALL provide a Provider instance management section for adding, editing, and deleting provider configurations.

#### Scenario: Wiki reader shows wiki-only tree
- **WHEN** user opens the Wiki reader
- **THEN** the sidebar tree SHALL display only the `wiki/` directory structure (not `raw/`)

#### Scenario: Document content view
- **WHEN** user clicks on a wiki page in the Wiki reader tree or entity list
- **THEN** the page content SHALL be rendered as formatted markdown (GFM tables, code blocks, wikilinks)

#### Scenario: Global navigation includes Help entry
- **WHEN** user loads the management workbench
- **THEN** the global header SHALL display navigation entries including Ingest (Chat), Jobs, Timeline, Logs, Help, and Settings
- **AND** a separate Raw Ingest tab, Review, and Graph SHALL NOT appear in workbench navigation

#### Scenario: Ingest-first default landing
- **WHEN** user opens the Web UI root URL
- **THEN** the default active entry SHALL be Ingest (Chat) with the chat-based ingest interface

#### Scenario: Legacy ingest route redirects to Chat
- **WHEN** user navigates to `/ingest`
- **THEN** the UI SHALL redirect to the Chat (Ingest) view
- **AND** SHALL open the context append dialog automatically

#### Scenario: Navigation uses semantic buttons
- **WHEN** user views the global header navigation
- **THEN** each navigation item SHALL be rendered as a navigation button-style control, not as a tab-group trigger

## ADDED Requirements

### Requirement: Help workbench page
The system SHALL provide a Help page at route `/help` within the management workbench. Selecting the Help navigation entry SHALL navigate to `/help` and display bundled user documentation rendered with wiki-prose styling.

#### Scenario: Help route activation
- **WHEN** user clicks the Help navigation entry
- **THEN** the UI SHALL navigate to `/help`
- **AND** SHALL highlight Help as the active navigation entry

#### Scenario: Direct Help URL
- **WHEN** user navigates directly to `/help`
- **THEN** the Help page SHALL load within the workbench shell with global header navigation visible

#### Scenario: Help page layout
- **WHEN** user views the Help page
- **THEN** the page SHALL render within the workbench content column (`max-w-5xl`)
- **AND** SHALL include a section table of contents and scrollable documentation body
