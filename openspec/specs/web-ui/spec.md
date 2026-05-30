# web-ui Specification

## Purpose
Define the management workbench web UI shell, navigation, and shared presentation requirements.
## Requirements
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

### Requirement: Wiki rules settings card
The Settings page SHALL expose workspace rule configuration with file preview and a supplement text field.

#### Scenario: Rules supplement editor
- **WHEN** user opens Settings
- **THEN** the page SHALL show a「Wiki 规则」section with a multiline field for `rules_supplement`
- **AND** the field SHALL display a character count with maximum 2048
- **AND** saving SHALL persist via PUT `/api/v1/settings`

#### Scenario: Workspace rule files preview
- **WHEN** user opens the Wiki rules section
- **THEN** the UI SHALL show read-only previews of `purpose.md` and `rules.md` (truncated) or a message when files are missing
- **AND** the UI SHALL indicate that full editing is done outside Settings (e.g. Obsidian or file editor)

#### Scenario: Supplement validation feedback
- **WHEN** user saves supplement longer than 2048 characters
- **THEN** the API SHALL return 400 and the UI SHALL show an error without partial save

### Requirement: Workbench markdown preview styling
The workbench SHALL render Markdown preview content in Chat archive review cards and related dialogs using the same wiki-prose styling system as the Wiki reader (headings, lists, code blocks with syntax highlighting, tables, blockquotes).

#### Scenario: Archive review plan markdown preview
- **WHEN** user views an ingest review plan in the Chat ArchiveReviewCard
- **THEN** the plan markdown SHALL be rendered with wiki-prose styles and GFM support
- **AND** code blocks SHALL display syntax highlighting

#### Scenario: Wide table overflow in previews
- **WHEN** previewed markdown contains a table wider than the container
- **THEN** the UI SHALL allow horizontal scrolling without breaking the surrounding layout

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

### Requirement: Settings page information architecture
The Settings page SHALL organize configuration controls into user-oriented groups rather than one undifferentiated long form. The grouping SHALL distinguish common settings, model/provider connection settings, workspace rule and MCP settings, automation/capacity settings, and version control status.

#### Scenario: Settings page shows grouped sections
- **WHEN** user opens Settings in the management workbench
- **THEN** the page SHALL present clearly labeled setting groups for common settings, model/provider connection settings, workspace rule and MCP settings, automation/capacity settings, and version control status
- **AND** each group SHALL provide enough descriptive text for users to understand the purpose of the settings inside it

#### Scenario: Advanced settings have lower default visual priority
- **WHEN** user opens Settings
- **THEN** low-frequency or expert-oriented controls such as MCP JSON, processing parameters, log retention limits, and tool loop limits SHALL be visually separated from common settings
- **AND** the UI SHALL keep those controls discoverable without presenting them as the first task on the page

### Requirement: Settings page save affordance
The Settings page SHALL provide a page-level save affordance that remains easy to reach on long pages and clearly communicates unsaved and saved states. Local actions such as Provider instance management and connection checks SHALL remain visually distinct from the page-level settings save action.

#### Scenario: User edits a setting on a long page
- **WHEN** user changes a Settings field
- **THEN** the UI SHALL indicate that there are unsaved changes
- **AND** the primary save action SHALL remain easy to access without requiring users to scroll to the end of the page

#### Scenario: User saves settings
- **WHEN** user activates the page-level save action
- **THEN** the UI SHALL persist changed Settings fields through the existing settings save flow
- **AND** the UI SHALL show success feedback after saving completes

#### Scenario: User manages provider instances
- **WHEN** user adds, edits, deletes, or checks a Provider instance
- **THEN** the Provider operation SHALL be presented as a local action distinct from the page-level Settings save action

### Requirement: Workbench width consistency
The management workbench SHALL use a centered content column for global navigation and workbench pages. Settings SHALL render within the same workbench content column as other management pages, using the workbench maximum width and horizontal padding rather than the Wiki reader full-screen layout.

#### Scenario: Settings uses workbench content width
- **WHEN** user opens Settings
- **THEN** the Settings header and page content SHALL align to the workbench content column
- **AND** the Settings page SHALL NOT adopt the Wiki reader three-column or full-width reading layout

#### Scenario: Workbench navigation aligns with content
- **WHEN** user views any management workbench page
- **THEN** the global header SHALL align with the same centered workbench content column used by the page body

### Requirement: Settings copy localization
The Settings page SHALL avoid untranslated user-facing copy in localized UI. Labels, actions, descriptions, status messages, and section titles SHALL use the application i18n system where equivalent localized strings are expected.

#### Scenario: User views Settings in Chinese
- **WHEN** the UI language is Chinese and user opens Settings
- **THEN** user-facing Settings section titles, labels, action text, descriptions, and save feedback SHALL be shown in Chinese
- **AND** technical identifiers MAY appear only when they are intentionally shown as field names or code-like configuration keys

### Requirement: Settings responsive layout
The Settings page SHALL remain usable on narrow viewports. Multi-column setting layouts SHALL collapse appropriately, and wide controls such as JSON editors or previews SHALL not overflow the viewport.

#### Scenario: User opens Settings on a narrow viewport
- **WHEN** the viewport cannot comfortably display multiple setting columns
- **THEN** Settings groups and controls SHALL stack into a single readable column
- **AND** wide editors or previews SHALL scroll internally or fit within the available viewport width

### Requirement: Index catalog table rendering
When the Wiki reader renders `wiki/index.md`, GFM tables in each typed section (entities, concepts, sources, etc.) SHALL display four distinct columns: page link, title, description summary, and update date.

#### Scenario: Index wikilink column renders as clickable link
- **WHEN** user opens `wiki/index.md` in the Wiki reader
- **AND** a table row contains a wikilink with GFM-escaped display separator (e.g. `[[entities/alpha\|Alpha Entity]]`)
- **THEN** the first column SHALL render a clickable link with display text `Alpha Entity`
- **AND** SHALL NOT show raw `[[` or `]]` syntax in the cell

#### Scenario: Index row shows title description and date
- **WHEN** user views an index table row generated from page frontmatter
- **THEN** the second column SHALL show the page title once
- **AND** the third column SHALL show the description summary
- **AND** the fourth column SHALL show the update date
- **AND** the title SHALL NOT be duplicated in the page link column beyond the link display text

#### Scenario: Typed section tables remain aligned
- **WHEN** user scrolls entities, concepts, or sources sections in `wiki/index.md`
- **THEN** each section table header row SHALL align with its data rows
- **AND** no extra columns SHALL appear due to wikilink pipe characters

