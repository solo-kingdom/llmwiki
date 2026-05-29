## MODIFIED Requirements

### Requirement: Help content scope
The help documentation SHALL explain LLM Wiki for human users covering Web UI usage, workspace and wiki design, CLI usage summary, MCP RPC integration, AND expanded core workflow guidance. The content SHALL be distilled from project design documents (`docs/`) and `README.md`, written for end users rather than copying full developer documentation.

In addition to the existing scope, the help content SHALL include:

1. **Session mode guidance**: Describe the three session modes (chat/qa/organize), their purpose, when to use each, and the archive→review→apply workflow
2. **Lint usage guidance**: Explain how to trigger wiki health checks (via MCP or API), what checks are performed (dead links, orphan pages, frontmatter validation, log format, misplaced pages), and how to interpret the report
3. **Recommended workflows**: Provide scenario-based guidance for common use patterns (new wiki setup, continuous ingestion, periodic maintenance, deep Q&A)

#### Scenario: Core concepts section
- **WHEN** user reads the Help page
- **THEN** the document SHALL include a section explaining the compile-time wiki model (persistent wiki vs query-time RAG) and the three operations Ingest, Query, and Lint

#### Scenario: Workspace structure section
- **WHEN** user reads the Help page
- **THEN** the document SHALL describe workspace layout including `purpose.md`, `rules.md`, `raw/`, `wiki/` typed directories, and `.llmwiki/` index storage

#### Scenario: Web UI usage section
- **WHEN** user reads the Help page
- **THEN** the document SHALL describe Chat ingest (including context append and archive review), Jobs, Timeline, Logs, Settings, and Wiki reader navigation

#### Scenario: CLI summary section
- **WHEN** user reads the Help page
- **THEN** the document SHALL summarize primary CLI commands (`init`, `serve`, `ingest`, `reindex`, `mcp`, `mcp-config`, `version`) with brief purpose descriptions

#### Scenario: MCP integration section
- **WHEN** user reads the Help page
- **THEN** the document SHALL describe RPC-first MCP access via `llmwiki serve` at `/mcp` and using `llmwiki mcp-config` for client setup

#### Scenario: Session mode guidance section
- **WHEN** user reads the Help page
- **THEN** the document SHALL include a section describing the three session modes (chat for ingestion exploration, qa for knowledge retrieval, organize for structural maintenance), their characteristics, and the archive→plan review→apply workflow

#### Scenario: Lint usage section
- **WHEN** user reads the Help page
- **THEN** the document SHALL include a section explaining wiki health checks: how to trigger them, what checks are performed (dead links, orphan pages, frontmatter mismatches, misplaced pages, log format issues), and how to read the report

#### Scenario: Recommended workflows section
- **WHEN** user reads the Help page
- **THEN** the document SHALL include a section with scenario-based recommended workflows for common use cases
