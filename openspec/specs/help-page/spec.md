# help-page Specification

## Purpose
TBD - created by archiving change add-help-page. Update Purpose after archive.
## Requirements
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

### Requirement: Canonical workspace layout documentation
The help documentation SHALL describe the full canonical workspace layout including workspace-root files (`purpose.md`, `rules.md`), `raw/` placement, all typed wiki subdirectories (plural names), reserved system pages, and `wiki/templates/` as a system directory.

#### Scenario: Full wiki subtree in help
- **WHEN** user reads the workspace structure section in Help
- **THEN** the document SHALL list `wiki/entities/`, `wiki/concepts/`, `wiki/sources/`, `wiki/synthesis/`, `wiki/comparisons/`, `wiki/queries/`, `wiki/templates/`, and reserved pages `overview.md`, `index.md`, `log.md`
- **AND** SHALL state that `purpose.md` and `rules.md` live at the workspace root, not under `wiki/`

#### Scenario: Bilingual parity
- **WHEN** help content is updated for workspace layout
- **THEN** both `help.zh.md` and `help.en.md` SHALL include equivalent layout guidance

### Requirement: Wiki layout anti-pattern FAQ
The help documentation SHALL include a short FAQ listing common invalid wiki paths that agents and users MUST NOT treat as canonical.

#### Scenario: Anti-patterns documented
- **WHEN** user reads the workspace structure or FAQ section
- **THEN** the document SHALL explicitly disallow `wiki/purpose.md`, `wiki/rules.md`, `wiki/raw/`, singular typed directories such as `wiki/entity/`, and non-existent directories such as `wiki/skills/`

### Requirement: Structure tool output example in help
The help documentation SHALL include an example of the Local `structure()` diagnostic tool output format so users can distinguish real tool results from LLM-fabricated directory trees.

#### Scenario: Example shows tool header format
- **WHEN** user reads the Organize or diagnostics section
- **THEN** the document SHALL show that authentic structure output begins with `# Wiki 目录结构` (or English equivalent)
- **AND** SHALL show typed subdirectory lines such as `├── entities/ (N 页)` rather than generic placeholder filenames

#### Scenario: Example warns against fabricated trees
- **WHEN** the help describes Organize mode diagnostics
- **THEN** it SHALL state that directory trees with emoji prefixes, `root/` wrappers, or English placeholder pages are not valid structure tool output

