## ADDED Requirements

### Requirement: RPC-first MCP exposure
The system SHALL expose MCP functionality through service RPC endpoints as the default access model.

#### Scenario: RPC MCP tool invocation
- **WHEN** a client invokes an MCP tool through the service RPC endpoint
- **THEN** the server executes the requested tool and returns a protocol-compliant MCP response payload

### Requirement: No default stdio dependency
The first release SHALL NOT require native Claude Desktop stdio MCP integration as a release gate.

#### Scenario: Release acceptance without stdio
- **WHEN** release readiness is evaluated
- **THEN** MCP RPC capability is sufficient even if Claude Desktop stdio direct connection is not implemented

### Requirement: Explicit compatibility statement
The system SHALL document that first-release MCP focuses on RPC access and may require adaptation for specific desktop clients.

#### Scenario: Client compatibility visibility
- **WHEN** user reviews product documentation or capabilities endpoint
- **THEN** the first-release MCP compatibility scope explicitly states RPC-first behavior and non-goal for no-modification Claude Desktop connection
