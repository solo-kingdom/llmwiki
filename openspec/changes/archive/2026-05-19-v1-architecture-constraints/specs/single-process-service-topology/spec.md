## ADDED Requirements

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
