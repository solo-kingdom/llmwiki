## MODIFIED Requirements

### Requirement: JSON-RPC 2.0 RPC transport (RPC-first)
The system SHALL implement MCP (Model Context Protocol) as a JSON-RPC 2.0 server exposed via HTTP POST endpoint (`/mcp`) within the `llmwiki serve` single process. Remote access SHALL use the same endpoint and SHALL NOT require native Claude Desktop stdio direct connection as a release gate.

#### Scenario: Initialization handshake via RPC
- **WHEN** client sends `POST /mcp` with `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}`
- **THEN** the server SHALL respond with serverInfo (name: "LLM Wiki", version), capabilities (tools: {}), and instructions text
- **AND** the response `_meta` SHALL declare RPC-first remote access, HTTP POST JSON-RPC transport, authentication expectations, and the default readonly tool policy

#### Scenario: Tool list discovery via RPC
- **WHEN** client sends `POST /mcp` with `{"jsonrpc":"2.0","id":2,"method":"tools/list"}`
- **THEN** the server SHALL return the tools enabled by the active MCP server policy with their names, descriptions, and inputSchema JSON schemas
- **AND** remote default policy SHALL list only readonly and diagnostic tools unless write tools are explicitly enabled

#### Scenario: Tool execution via RPC
- **WHEN** client sends `POST /mcp` with `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search","arguments":{...}}}`
- **THEN** the server SHALL parse arguments, dispatch to the enabled tool handler, and return the result in `{"content":[{"type":"text","text":"..."}]}` format

#### Scenario: Unknown or disabled tool
- **WHEN** client sends `tools/call` with an unrecognized or policy-disabled tool name
- **THEN** the server SHALL return `{"error":{"code":-32000,"message":"Tool not found: ..."}}` or an equivalent policy-denied JSON-RPC error without executing the tool

#### Scenario: MCP compatibility scope documented
- **WHEN** user reviews product documentation or capabilities endpoint
- **THEN** the MCP compatibility scope SHALL explicitly state RPC-first remote behavior and non-goal for no-modification Claude Desktop stdio connection

## ADDED Requirements

### Requirement: Remote MCP authentication boundary
The system SHALL protect remote MCP access with Bearer token authentication when the service is configured for remote access or bound to a non-loopback address.

#### Scenario: Remote bind without token is rejected
- **WHEN** operator starts `llmwiki serve --bind 0.0.0.0` with MCP enabled and no token configured
- **THEN** the system SHALL refuse to expose unauthenticated remote MCP access or SHALL fail startup with an actionable error

#### Scenario: Remote MCP request with token
- **WHEN** remote client calls `POST /mcp` with `Authorization: Bearer <token>` matching the configured token
- **THEN** the request SHALL be allowed to proceed to JSON-RPC handling

#### Scenario: Remote MCP request without token
- **WHEN** remote client calls `POST /mcp` without a valid Bearer token while authentication is required
- **THEN** the server SHALL return HTTP 401 and SHALL NOT parse or execute the JSON-RPC method

### Requirement: Remote MCP readonly default policy
The system SHALL expose only readonly and diagnostic MCP tools to remote agents by default. Tools that create, update, delete, or otherwise mutate workspace files or records MUST require explicit enablement.

#### Scenario: Default remote tool list
- **WHEN** remote client calls `tools/list` on a default server configuration
- **THEN** the response SHALL include readonly or diagnostic tools such as `guide`, `search`, `read`, `references`, `lint`, and `ping`
- **AND** the response SHALL NOT include mutating tools such as `write` or `delete`

#### Scenario: Disabled write tool call
- **WHEN** remote client calls `tools/call` for `write` or `delete` while write tools are not enabled
- **THEN** the server SHALL reject the call without modifying filesystem or SQLite state

#### Scenario: Explicit write enablement
- **WHEN** operator explicitly enables remote MCP write tools
- **THEN** `tools/list` MAY include mutating tools
- **AND** mutating tool calls SHALL still use the shared dependency context and existing workspace safety checks

### Requirement: Remote MCP request validation
The system SHALL validate remote MCP requests before dispatching tool handlers.

#### Scenario: Invalid JSON
- **WHEN** client sends malformed JSON to `POST /mcp`
- **THEN** the server SHALL return a JSON-RPC parse error with HTTP 400

#### Scenario: Unsupported HTTP method
- **WHEN** client sends a non-POST request to `/mcp`
- **THEN** the server SHALL reject it with HTTP 405 and SHALL NOT execute any MCP method

#### Scenario: Tool arguments defaulting
- **WHEN** client calls `tools/call` without an `arguments` object
- **THEN** the server SHALL treat arguments as an empty object and apply the tool schema/handler validation
