## MODIFIED Requirements

### Requirement: Workspace management UI
The system SHALL provide a web interface for browsing wiki summary pages in the Wiki reader and for managing ingest operations in the workbench. The workbench global navigation SHALL consist of top-level entries: Ingest (Chat), Jobs, Timeline (when version control enabled), Logs, and Settings, plus a Wiki reader link. The workbench SHALL NOT include a separate Raw Ingest entry, a Graph top-level entry, or a Review top-level entry. The default selected entry on load SHALL be Ingest (Chat). Direct raw ingest (batch files and text blocks) SHALL be accessible from within the Chat interface, not as a standalone workbench view. The management workbench global header SHALL use the same card-style bar as the Wiki reader header (`rounded-xl`, `border-border/70`, `bg-card/70`, `backdrop-blur-sm`, `shadow-sm`, fixed height `h-12`). The workbench header width SHALL match the workbench content column (`max-w-5xl` with consistent horizontal padding). The global navigation visual treatment SHALL use semantic navigation buttons instead of a tab-group control. The Settings page SHALL provide a Provider instance management section for adding, editing, and deleting provider configurations.

#### Scenario: Wiki reader shows wiki-only tree
- **WHEN** user opens the Wiki reader
- **THEN** the sidebar tree SHALL display only the `wiki/` directory structure (not `raw/`)

#### Scenario: Document content view
- **WHEN** user clicks on a wiki page in the Wiki reader tree or entity list
- **THEN** the page content SHALL be rendered as formatted markdown (GFM tables, code blocks, wikilinks)

#### Scenario: Global navigation excludes separate Ingest tab
- **WHEN** user loads the management workbench
- **THEN** the global header SHALL display navigation entries including Ingest (Chat), Jobs, Logs, and Settings
- **AND** Timeline SHALL appear when version control is enabled
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

#### Scenario: Workbench header matches reader shell
- **WHEN** user loads the management workbench
- **THEN** the global header SHALL use the same card-style bar treatment as the Wiki reader header
- **AND** the header width SHALL align with the workbench content column (`max-w-5xl`)

#### Scenario: Settings provider section replaced with instance management
- **WHEN** user opens the Settings entry
- **THEN** the Provider section SHALL show a list of user-added provider instances (not all catalog providers) with add, edit, and delete affordances

#### Scenario: Provider keys section removed
- **WHEN** user views the Settings page
- **THEN** the old "Provider Keys" card that listed all catalog providers SHALL NOT be present

#### Scenario: Activity logs retention setting
- **WHEN** user opens the Settings entry
- **THEN** the Settings page SHALL include a "Logs" or system section with a numeric input for maximum activity log retention count (`activity_logs_max_count`)
- **AND** the input SHALL show the current value and allowed range hint (100–100000)
- **AND** saving Settings SHALL persist the value via `PUT /api/v1/settings`

#### Scenario: Job execution events retention setting
- **WHEN** user opens the Settings entry
- **THEN** the Settings page SHALL include a numeric input for `ingest_job_events_max_count` (每个 Job 执行日志保留条数)
- **AND** the input SHALL show allowed range hint (50–2000) and default 200 when unset
- **AND** saving Settings SHALL persist the value via `PUT /api/v1/settings` and trim existing per-job events if needed
