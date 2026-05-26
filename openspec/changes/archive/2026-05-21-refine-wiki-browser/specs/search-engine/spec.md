## ADDED Requirements

### Requirement: HTTP search filtered by wiki page type
The system SHALL support filtering `GET /api/v1/search` results by wiki page type in combination with the full-text query parameter `q`.

#### Scenario: Search with types parameter
- **WHEN** client calls `GET /api/v1/search?q=attention&types=concept,entity`
- **THEN** results SHALL include only chunks from documents with `source_kind=wiki`
- **AND** document page type SHALL be in the `types` set (OR semantics among listed types)
- **AND** chunks SHALL match full-text query `q` (AND semantics between `q` and type filter)

#### Scenario: Search defaults to wiki scope
- **WHEN** client calls `GET /api/v1/search?q=foo` without path or type filters
- **THEN** results SHALL NOT include raw source documents
- **AND** SHALL be limited to wiki summary pages (equivalent to wiki path/source_kind filter)

#### Scenario: Public wiki search supports types
- **WHEN** public wiki is enabled and client calls the public wiki search endpoint with `types`
- **THEN** the same type filtering semantics SHALL apply to public wiki documents only
