## MODIFIED Requirements

### Requirement: Search tool modes
The MCP search tool SHALL support modes: list, search, references, and lint.

#### Scenario: Lint mode via MCP
- **WHEN** agent invokes search with `mode="lint"`
- **THEN** the tool SHALL return wiki health check results
