## ADDED Requirements

### Requirement: JSON-RPC 2.0 RPC transport (RPC-first)
The system SHALL implement MCP (Model Context Protocol) as a JSON-RPC 2.0 server exposed via HTTP POST endpoint (`/mcp`) within the `llmwiki serve` single process. First release focuses on RPC access and does not require native Claude Desktop stdio direct connection as a release gate.

#### Scenario: Initialization handshake via RPC
- **WHEN** client sends `POST /mcp` with `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}`
- **THEN** the server SHALL respond with serverInfo (name: "LLM Wiki", version), capabilities (tools: {}), and instructions text

#### Scenario: Tool list discovery via RPC
- **WHEN** client sends `POST /mcp` with `{"jsonrpc":"2.0","id":2,"method":"tools/list"}`
- **THEN** the server SHALL return all 6 registered tools (guide, search, read, write, delete, ping) with their names, descriptions, and inputSchema JSON schemas

#### Scenario: Tool execution via RPC
- **WHEN** client sends `POST /mcp` with `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search","arguments":{...}}}`
- **THEN** the server SHALL parse arguments, dispatch to the search handler, and return the result in `{"content":[{"type":"text","text":"..."}]}` format

#### Scenario: Unknown tool
- **WHEN** client sends `tools/call` with an unrecognized tool name
- **THEN** the server SHALL return `{"error":{"code":-32000,"message":"Tool not found: ..."}}`

#### Scenario: MCP compatibility scope documented
- **WHEN** user reviews product documentation or capabilities endpoint
- **THEN** the first-release MCP compatibility scope explicitly states RPC-first behavior and non-goal for no-modification Claude Desktop connection

### Requirement: Shared dependency context
MCP RPC handlers SHALL share the same in-process dependency graph (store, engine, lock manager, config) as HTTP API handlers, ensuring consistent state observation.

#### Scenario: Consistent state across MCP and HTTP
- **WHEN** a write is made via MCP RPC and a read is made via HTTP API
- **THEN** both handlers operate on the same in-process state and observe consistent post-write data

### Requirement: Guide tool
The system SHALL provide a `guide` tool that returns architecture documentation, wiki writing standards, and a list of available workspaces.

#### Scenario: Guide with workspaces
- **WHEN** client invokes the `guide` tool
- **THEN** the response SHALL include the LLM Wiki architecture overview and a list of available knowledge bases

### Requirement: Search tool
The system SHALL provide a `search` tool supporting three modes: list (browse files), search (FTS5 keyword search), and references (reference graph queries).

#### Scenario: List mode
- **WHEN** client uses `search(mode="list", path="/wiki/*")`
- **THEN** results SHALL list files and directories matching the glob pattern

#### Scenario: Search mode
- **WHEN** client uses `search(mode="search", query="transformer", limit=5)`
- **THEN** results SHALL show up to 5 FTS5 matches with chunk content, scores, and metadata

#### Scenario: References mode for backlinks
- **WHEN** client uses `search(mode="references", path="/wiki/concepts/attention.md")`
- **THEN** results SHALL show both forward references (what this page cites) and backlinks (what links to this page)

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
