## ADDED Requirements

### Requirement: Init command
The system SHALL provide `llmwiki init <dir>` to initialize a workspace directory with the required structure, SQLite schema, and scaffold wiki files.

#### Scenario: Init creates directory structure
- **WHEN** user runs `llmwiki init ~/research`
- **THEN** the directory SHALL contain `wiki/`, `raw/sources/`, `.llmwiki/`, `.llmwiki/cache/`, `.llmwiki/index.db`, `wiki/overview.md`, and `wiki/log.md`

### Requirement: Serve command
The system SHALL provide `llmwiki serve [dir]` to start the HTTP API server and embedded Web UI, with configurable port, bind address, and optional API token.

#### Scenario: Serve with defaults
- **WHEN** user runs `llmwiki serve` in a workspace directory
- **THEN** the HTTP server SHALL start on port 8868, serving the Web UI at `/` and API at `/api/v1/`

#### Scenario: Serve with custom port
- **WHEN** user runs `llmwiki serve --port 9000`
- **THEN** the HTTP server SHALL start on port 9000

#### Scenario: Serve with remote bind
- **WHEN** user runs `llmwiki serve --bind 0.0.0.0 --token secret`
- **THEN** the HTTP server SHALL bind to all interfaces and require `Authorization: Bearer secret` for API requests

### Requirement: Reindex command
The system SHALL provide `llmwiki reindex <dir>` to force a full rebuild of the SQLite index from the filesystem.

#### Scenario: Reindex output
- **WHEN** user runs `llmwiki reindex ~/research`
- **THEN** the command SHALL report the number of files re-indexed and exit with a success message

### Requirement: MCP config command
The system SHALL provide `llmwiki mcp-config [dir]` to print a JSON configuration snippet for connecting to the RPC MCP endpoint.

#### Scenario: MCP config output
- **WHEN** user runs `llmwiki mcp-config ~/research`
- **THEN** the output SHALL include a valid JSON block with the MCP RPC endpoint URL and configuration details for the workspace

### Requirement: Ingest command
The system SHALL provide `llmwiki ingest <file>` to trigger the two-step ingestion of a source file into the workspace.

#### Scenario: Ingest a file
- **WHEN** user runs `llmwiki ingest paper.pdf`
- **THEN** the system SHALL run the two-step pipeline and report the number of wiki pages created/updated

### Requirement: Version command
The system SHALL provide `llmwiki version` to print the binary version and build information.

#### Scenario: Version output
- **WHEN** user runs `llmwiki version`
- **THEN** output SHALL include version number, commit hash, and build date

<!-- Added by change: v1-architecture-constraints -->

## Constraints from v1-architecture-constraints

### Requirement: Single-process service composition
The system SHALL run HTTP API, Web UI static serving, MCP RPC endpoint, and background indexing/watch components within a single service process started by `llmwiki serve`.

#### Scenario: Service boot composition
- **WHEN** the operator starts `llmwiki serve <workspace>`
- **THEN** the process initializes API routes, Web UI routes, MCP RPC routes, and background workers in one process context

### Requirement: Shared dependency context
The service SHALL share one application dependency context (store, engine, lock manager, config manager) across API and MCP handlers.

#### Scenario: Shared state access
- **WHEN** a write is made via MCP RPC and a read is made via HTTP API
- **THEN** both handlers operate on the same in-process dependency graph and observe consistent post-write state

### Requirement: Operational mode declaration
The service SHALL expose current runtime mode metadata indicating single-process topology and enabled subcomponents.

#### Scenario: Runtime mode introspection
- **WHEN** a client calls service health/capabilities endpoint
- **THEN** the response includes flags for enabled API, Web UI, MCP RPC, and watcher/index workers
