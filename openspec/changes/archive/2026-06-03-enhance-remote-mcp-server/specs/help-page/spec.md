## ADDED Requirements

### Requirement: Remote MCP documentation
The help documentation SHALL explain how to expose and consume the remote MCP Server for agents using `llmwiki serve` and the `/mcp` HTTP JSON-RPC endpoint.

#### Scenario: Remote MCP startup guidance
- **WHEN** user reads the Help page MCP section
- **THEN** the document SHALL explain how to start `llmwiki serve` for remote agent access
- **AND** SHALL state that remote MCP exposure requires token authentication

#### Scenario: Agent configuration example
- **WHEN** user reads the Help page MCP section
- **THEN** the document SHALL include or reference a `llmwiki mcp-config` example containing endpoint, transport, and Authorization header shape

#### Scenario: Readonly default documented
- **WHEN** user reads the Help page MCP section
- **THEN** the document SHALL state that remote MCP defaults to readonly/diagnostic tools
- **AND** SHALL explain that write/delete tools require explicit enablement

#### Scenario: Security guidance
- **WHEN** user reads the Help page MCP section
- **THEN** the document SHALL recommend using HTTPS or a trusted reverse proxy for non-local remote agent access
- **AND** SHALL warn against exposing unauthenticated `/mcp` on public networks
