## MODIFIED Requirements

### Requirement: Workspace initialization
The system SHALL initialize a workspace directory with the required structure (wiki/, raw/sources/, .llmwiki/) and scaffold overview.md, log.md, purpose.md, and rules.md upon `llmwiki init <dir>`.

#### Scenario: Fresh workspace creation
- **WHEN** user runs `llmwiki init ~/research` on a non-existent directory
- **THEN** the system creates `~/research/wiki/overview.md` with placeholder content, `~/research/wiki/log.md`, `~/research/purpose.md`, `~/research/rules.md` (Chinese guidance scaffold), and `~/research/.llmwiki/index.db` with the full schema

#### Scenario: Already initialized workspace
- **WHEN** user runs `llmwiki init` on an already initialized workspace
- **THEN** the system prints a message indicating the workspace is already initialized and exits without error
- **AND** the system MAY repair missing `rules.md` via writeIfNotExists without overwriting existing user content in `purpose.md` or `rules.md`

## ADDED Requirements

### Requirement: rules.md scaffold
The system SHALL provide a default `rules.md` at the workspace root describing content fidelity, citation expectations, and domain constraints placeholders in Chinese.

#### Scenario: rules.md created on init
- **WHEN** user runs `llmwiki init` on a fresh workspace
- **THEN** `rules.md` SHALL exist with Chinese section headings for fidelity and domain rules

#### Scenario: rules.md not overwritten
- **WHEN** user runs init repair and `rules.md` already exists with user edits
- **THEN** the system SHALL NOT modify `rules.md`
