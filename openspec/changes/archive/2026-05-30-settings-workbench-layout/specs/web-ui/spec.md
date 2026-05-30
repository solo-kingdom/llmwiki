## ADDED Requirements

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
