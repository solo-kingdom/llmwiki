## MODIFIED Requirements

### Requirement: Init command
The system SHALL provide `llmwiki init <dir>` to initialize a workspace directory with the required structure, SQLite schema, scaffold wiki files, and Obsidian compatibility configuration.

#### Scenario: Init creates directory structure
- **WHEN** user runs `llmwiki init ~/research`
- **THEN** the directory SHALL contain:
  - `wiki/entities/`, `wiki/concepts/`, `wiki/sources/`, `wiki/synthesis/`, `wiki/comparisons/`, `wiki/queries/`
  - `raw/sources/`, `raw/assets/`
  - `.llmwiki/`, `.llmwiki/cache/`, `.llmwiki/index.db`
  - `revert/`, `.obsidian/`
  - `purpose.md`, `wiki/overview.md`, `wiki/log.md`, `wiki/index.md`

#### Scenario: Init scaffold language
- **WHEN** user runs `llmwiki init` on a fresh workspace
- **THEN** scaffold file body text SHALL be in Simplified Chinese
- **AND** `wiki/log.md` SHALL contain an init entry with today's date
