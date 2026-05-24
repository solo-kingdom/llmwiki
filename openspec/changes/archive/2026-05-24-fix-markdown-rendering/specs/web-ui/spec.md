## ADDED Requirements

### Requirement: Workbench markdown preview styling
The workbench SHALL render Markdown preview content in Review and related dialogs using the same wiki-prose styling system as the Wiki reader (headings, lists, code blocks with syntax highlighting, tables, blockquotes).

#### Scenario: Review plan markdown preview
- **WHEN** user views an ingest review plan in the Review page
- **THEN** the plan markdown SHALL be rendered with wiki-prose styles and GFM support
- **AND** code blocks SHALL display syntax highlighting

#### Scenario: Wide table overflow in previews
- **WHEN** previewed markdown contains a table wider than the container
- **THEN** the UI SHALL allow horizontal scrolling without breaking the surrounding layout
