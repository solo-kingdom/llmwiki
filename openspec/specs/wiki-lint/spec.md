## Requirements

### Requirement: Wiki lint engine
The system SHALL provide mechanical Wiki health checks without LLM involvement, producing structured issues with severity, code, path, and message. The lint engine SHALL enforce typed wiki organization by detecting misplaced top-level business pages and system template files that are accidentally treated as business content.

#### Scenario: Dead link detection
- **WHEN** a wiki page contains `[[concepts/nonexistent]]` and no matching file exists
- **THEN** lint report SHALL include an error with code `dead_link`

#### Scenario: Orphan page detection
- **WHEN** a wiki page under `wiki/entities/` has no incoming links from other wiki pages
- **THEN** lint report SHALL include a warning with code `orphan_page`
- **AND** `wiki/index.md`, `wiki/log.md`, `wiki/overview.md`, and files under `wiki/templates/` SHALL be excluded from orphan checks

#### Scenario: Frontmatter type-directory consistency
- **WHEN** a file in `wiki/entities/` has frontmatter `type: concept`
- **THEN** lint report SHALL include an error with code `type_dir_mismatch`

#### Scenario: Log append-only contract
- **WHEN** `wiki/log.md` contains entries with decreasing dates or invalid prefix format
- **THEN** lint report SHALL include errors with codes `log_format_invalid` or `log_date_decreasing`

#### Scenario: Misplaced top-level business page detection
- **WHEN** a workspace contains `wiki/dsp.md`
- **THEN** lint report SHALL include an issue with code `misplaced_wiki_page`
- **AND** the issue SHALL identify that business pages belong under typed wiki directories

#### Scenario: Misplaced page destination suggestion
- **WHEN** a misplaced top-level page contains frontmatter `type: entity`
- **THEN** lint report SHALL include `wiki/entities/` as the suggested destination in the issue message or structured metadata

#### Scenario: Template files excluded from business lint checks
- **WHEN** lint scans `wiki/templates/entity.md`
- **THEN** the file SHALL NOT be reported as an orphan business page
- **AND** the file SHALL NOT be validated against the entity page directory contract

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
