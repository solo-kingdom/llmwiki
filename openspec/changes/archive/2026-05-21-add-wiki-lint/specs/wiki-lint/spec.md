## ADDED Requirements

### Requirement: Wiki lint engine
The system SHALL provide mechanical Wiki health checks without LLM involvement, producing structured issues with severity, code, path, and message.

#### Scenario: Dead link detection
- **WHEN** a wiki page contains `[[concepts/nonexistent]]` and no matching file exists
- **THEN** lint report SHALL include an error with code `dead_link`

#### Scenario: Orphan page detection
- **WHEN** a wiki page under `wiki/entities/` has no incoming links from other wiki pages
- **THEN** lint report SHALL include a warning with code `orphan_page`
- **AND** `wiki/index.md`, `wiki/log.md`, `wiki/overview.md` SHALL be excluded from orphan checks

#### Scenario: Frontmatter type-directory consistency
- **WHEN** a file in `wiki/entities/` has frontmatter `type: concept`
- **THEN** lint report SHALL include an error with code `type_dir_mismatch`

#### Scenario: Log append-only contract
- **WHEN** `wiki/log.md` contains entries with decreasing dates or invalid prefix format
- **THEN** lint report SHALL include errors with codes `log_format_invalid` or `log_date_decreasing`

### Requirement: Lint CLI command
The system SHALL provide `llmwiki lint [dir]` with optional `--json` output.

#### Scenario: Lint CLI success
- **WHEN** user runs `llmwiki lint ~/research`
- **THEN** the command SHALL print human-readable issue summary and exit 0 if no errors (warnings allowed)

#### Scenario: Lint CLI JSON
- **WHEN** user runs `llmwiki lint --json`
- **THEN** output SHALL be valid JSON matching LintReport structure

### Requirement: Lint HTTP endpoint
The system SHALL expose `GET /api/v1/lint` returning the same LintReport as CLI.

#### Scenario: Web UI lint fetch
- **WHEN** client calls `GET /api/v1/lint`
- **THEN** response SHALL include issues array and stats object

### Requirement: Lint MCP access
The MCP `search` tool SHALL support `mode="lint"` returning structured lint results for agents.

#### Scenario: Agent lint query
- **WHEN** agent calls `search(mode="lint")`
- **THEN** results SHALL list lint issues grouped by severity
