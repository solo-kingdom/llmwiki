## MODIFIED Requirements

### Requirement: Init command
The system SHALL provide `llmwiki init <dir>` to initialize a workspace directory.

#### Scenario: Lint command available
- **WHEN** user runs `llmwiki --help`
- **THEN** `lint` subcommand SHALL be listed alongside init, serve, reindex
