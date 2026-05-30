# help-page Specification (delta)

## ADDED Requirements

### Requirement: Bilingual help documentation content
The system SHALL ship user-facing help documentation as static Markdown bundled with the web frontend. The help content SHALL exist in two files: Simplified Chinese (`help.zh.md`) and English (`help.en.md`). The active document SHALL be selected by the current UI language setting (`ui_language`: `zh` or `en`).

#### Scenario: Chinese UI shows Chinese help
- **WHEN** user opens the Help page with `ui_language=zh`
- **THEN** the page SHALL render the Chinese help Markdown document

#### Scenario: English UI shows English help
- **WHEN** user opens the Help page with `ui_language=en`
- **THEN** the page SHALL render the English help Markdown document

### Requirement: Help content scope
The help documentation SHALL explain LLM Wiki for human users covering Web UI usage, workspace and wiki design, CLI usage summary, and MCP RPC integration. The content SHALL be distilled from project design documents (`docs/`) and `README.md`, written for end users rather than copying full developer documentation.

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

### Requirement: Help page markdown rendering
The Help page SHALL render documentation using the same wiki-prose Markdown presentation as the Wiki reader and workbench previews (GFM tables, code blocks with syntax highlighting, blockquotes).

#### Scenario: Code blocks in help
- **WHEN** help content includes fenced code blocks
- **THEN** the Help page SHALL render them with syntax highlighting

#### Scenario: Wide tables in help
- **WHEN** help content includes a table wider than the content column
- **THEN** the UI SHALL allow horizontal scrolling without breaking layout

### Requirement: Help page table of contents
The Help page SHALL provide an in-page table of contents for major sections so users can jump to topics without scrolling the entire document.

#### Scenario: Section jump navigation
- **WHEN** user clicks a table-of-contents entry
- **THEN** the page SHALL scroll to the corresponding section heading in the help document

### Requirement: Help content isolation from workspace wiki
Help documentation SHALL NOT be stored under the user workspace `wiki/` tree and SHALL NOT be modified by ingest or archive operations.

#### Scenario: Help is application bundled content
- **WHEN** user ingests or archives chat sessions into the wiki
- **THEN** workspace wiki files SHALL NOT include or overwrite application help pages
