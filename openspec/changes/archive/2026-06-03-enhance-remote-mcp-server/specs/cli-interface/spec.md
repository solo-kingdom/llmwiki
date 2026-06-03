## MODIFIED Requirements

### Requirement: MCP config command
The system SHALL provide `llmwiki mcp-config [dir]` to print a JSON configuration snippet for connecting remote agents to the RPC MCP endpoint.

#### Scenario: MCP config output
- **WHEN** user runs `llmwiki mcp-config ~/research`
- **THEN** the output SHALL include a valid JSON block with the MCP RPC endpoint URL and configuration details for the workspace
- **AND** the output SHALL declare HTTP POST JSON-RPC transport and readonly default tool policy

#### Scenario: MCP config output with token
- **WHEN** user runs `llmwiki mcp-config ~/research --token secret`
- **THEN** the output SHALL include an Authorization header configuration using `Bearer secret`
- **AND** the output SHALL NOT print unrelated application secrets

#### Scenario: Remote MCP config without token
- **WHEN** user requests an MCP config for a non-loopback bind or externally reachable host without providing a token
- **THEN** the command SHALL refuse to generate an unauthenticated remote config or SHALL print a blocking error explaining that remote MCP requires a token

## ADDED Requirements

### Requirement: Remote MCP serve safety
The system SHALL prevent accidental unauthenticated exposure of the MCP Server when `llmwiki serve` is bound for remote access.

#### Scenario: Remote bind requires token for MCP
- **WHEN** user runs `llmwiki serve --bind 0.0.0.0` with MCP enabled
- **THEN** the command SHALL require a configured token before exposing `/mcp` to remote clients

#### Scenario: Local bind can remain development-friendly
- **WHEN** user runs `llmwiki serve --bind 127.0.0.1` without token
- **THEN** the server MAY allow local development access to `/mcp`
- **AND** health or help metadata SHALL still report that remote MCP deployments require authentication

#### Scenario: MCP disabled
- **WHEN** user runs `llmwiki serve --no-mcp`
- **THEN** the server SHALL NOT register `/mcp`
- **AND** `mcp-config` output for that running configuration SHALL indicate that MCP is disabled if runtime status is consulted
