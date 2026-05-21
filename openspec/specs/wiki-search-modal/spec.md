## ADDED Requirements

### Requirement: Wiki reader search modal
The Wiki reader SHALL provide document search through a modal dialog aligned with the mdserve search experience, not through a clipped sidebar dropdown.

#### Scenario: Open search from header
- **WHEN** the user clicks the search control in the Wiki reader header
- **THEN** the system SHALL open a search modal with a focused query input

#### Scenario: Open search via keyboard shortcut
- **WHEN** the user presses Ctrl+K (Windows/Linux) or Cmd+K (macOS) while the Wiki reader is active
- **THEN** the system SHALL open the same search modal

#### Scenario: Search and open document
- **WHEN** the user enters a query and selects a result
- **THEN** the system SHALL navigate the reader to that document using `document_id` from the search API
- **AND** the modal SHALL close

#### Scenario: Search uses appropriate API
- **WHEN** public wiki mode is enabled
- **THEN** search SHALL call the public wiki search endpoint
- **WHEN** public wiki mode is disabled
- **THEN** search SHALL call the authenticated management search endpoint

#### Scenario: Sidebar does not host primary search UI
- **WHEN** the user views the Wiki reader document tree sidebar
- **THEN** the primary search entry SHALL NOT be an inline sidebar text field with absolutely positioned results that can be clipped by panel overflow

### Requirement: Wiki search page-type filter
The Wiki search modal SHALL allow filtering results by wiki page type in addition to the full-text query.

#### Scenario: Search with query and types
- **WHEN** user enters query `q` and selects one or more page types
- **THEN** the client SHALL call the search API with both `q` and `types`
- **AND** results SHALL match full-text `q` AND have page type in the selected set (types combined with OR)

#### Scenario: Wiki-only search results
- **WHEN** user searches from the Wiki reader
- **THEN** results SHALL only include `source_kind=wiki` documents
- **AND** SHALL NOT include raw source files

#### Scenario: Type filter chips in modal
- **WHEN** the search modal is open
- **THEN** the UI SHALL show selectable page-type chips including entity, concept, and「来源摘要」for type `source`
