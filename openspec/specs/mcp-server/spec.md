## ADDED Requirements

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

### Requirement: Guide tool
The system SHALL provide a `guide` tool that returns architecture documentation, wiki writing standards, and a list of available workspaces.

#### Scenario: Guide with workspaces
- **WHEN** client invokes the `guide` tool
- **THEN** the response SHALL include the LLM Wiki architecture overview and a list of available knowledge bases

### Requirement: Search tool
The system SHALL provide a `search` tool supporting four modes: list (browse files), search (FTS5 keyword search), references (reference graph queries), and lint (wiki health checks).

#### Scenario: List mode
- **WHEN** client uses `search(mode="list", path="/wiki/*")`
- **THEN** results SHALL list files and directories matching the glob pattern

#### Scenario: Search mode
- **WHEN** client uses `search(mode="search", query="transformer", limit=5)`
- **THEN** results SHALL show up to 5 FTS5 matches with chunk content, scores, and metadata

#### Scenario: References mode for backlinks
- **WHEN** client uses `search(mode="references", path="/wiki/concepts/attention.md")`
- **THEN** results SHALL show both forward references (what this page cites) and backlinks (what links to this page)

#### Scenario: Lint mode via MCP
- **WHEN** agent invokes search with `mode="lint"`
- **THEN** the tool SHALL return wiki health check results grouped by severity

### Requirement: Read tool
The system SHALL provide a `read` tool that handles different file types (markdown, PDF, spreadsheets, images, glob batch) with appropriate rendering.

#### Scenario: Read markdown
- **WHEN** client reads a .md file
- **THEN** the response SHALL include the full content, user highlights (if any, formatted as "Highlights & Annotations" appendix), and backlinks summary

#### Scenario: Read PDF with page range
- **WHEN** client reads a PDF with `pages="1-5,10"`
- **THEN** the response SHALL include content only from pages 1-5 and 10

#### Scenario: Read image
- **WHEN** client reads a .png file
- **THEN** the response SHALL include a base64-encoded ImageContent block

#### Scenario: Batch glob read with budget control
- **WHEN** client uses glob to read multiple files
- **THEN** the system SHALL respect a 120K character budget, returning first pages or truncated content as needed

### Requirement: Write tool
The system SHALL provide `create`, `edit`, and `append` sub-tools for writing wiki pages.

#### Scenario: Create with frontmatter extraction
- **WHEN** client creates a page with YAML frontmatter
- **THEN** the system SHALL parse frontmatter and update DB with date, description, and tags

#### Scenario: Edit with exact match
- **WHEN** client uses `edit` with `old_text` that appears exactly once in the document
- **THEN** the system SHALL replace it with `new_text` and return a snippet showing the edit location with 5 lines of context

#### Scenario: Edit with multiple matches rejected
- **WHEN** client uses `edit` with `old_text` that appears 3 times in the document
- **THEN** the system SHALL return an error: "found 3 matches. Provide more context to match exactly once."

#### Scenario: Append to log
- **WHEN** client uses `append` on `/wiki/log.md`
- **THEN** the new content SHALL be appended to the end of the file with double newline separator

### Requirement: Delete tool
The system SHALL provide a `delete` tool supporting path and glob-based deletion, with protection for structural pages.

#### Scenario: Delete single file
- **WHEN** client deletes `/wiki/concepts/old-concept.md`
- **THEN** the file SHALL be removed from disk and its database record archived

#### Scenario: Glob deletion with wildcard protection
- **WHEN** client attempts to delete with path `"*"` or `"**"`
- **THEN** the system SHALL reject the operation with a warning about deleting all files

### Requirement: Write impact reporting
After a wiki page is written, the system SHALL report which other pages reference it (impact surface), so the LLM knows to update them.

#### Scenario: Impact surface reported
- **WHEN** client updates a wiki page that has 4 backlinks
- **THEN** the response SHALL include: "**4 page(s) reference this document** — consider updating:" followed by the list of referencing pages

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

<!-- v1-architecture-constraints codified: single-process-service-topology (shared dependency context already present), mcp-rpc-access-model (RPC-first, no-stdio-dep, compatibility statement already present) -->

<!-- Added by change: v1-architecture-constraints -->

## Constraints from v1-architecture-constraints

### Requirement: Operational mode declaration
The service SHALL expose current runtime mode metadata indicating single-process topology and enabled subcomponents.

#### Scenario: Runtime mode introspection
- **WHEN** a client calls service health/capabilities endpoint
- **THEN** the response includes flags for enabled API, Web UI, MCP RPC, and watcher/index workers
