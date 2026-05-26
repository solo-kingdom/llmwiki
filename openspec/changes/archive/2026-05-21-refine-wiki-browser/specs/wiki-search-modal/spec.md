## ADDED Requirements

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
