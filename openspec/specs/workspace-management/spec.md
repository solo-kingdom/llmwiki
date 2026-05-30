# workspace-management Specification

## Purpose
Define workspace initialization, scaffolding, reindex, file watching, and related directory structure requirements.

## Requirements

### Requirement: Workspace initialization
The system SHALL initialize a workspace directory with the required structure upon `llmwiki init <dir>`. The structure SHALL include:

- Wiki subdirectories: `wiki/templates/`, `wiki/entities/`, `wiki/concepts/`, `wiki/sources/`, `wiki/synthesis/`, `wiki/comparisons/`, `wiki/queries/`
- Raw directories: `raw/sources/`, `raw/assets/`
- Application data: `.llmwiki/`, `.llmwiki/cache/`
- Version control helper: `revert/`
- Obsidian compatibility: `.obsidian/`
- Git repository: `.git/` (initialized by `llmwiki init`, tracking `wiki/` only)

Scaffold files (created only if missing):

- `purpose.md` — Chinese template with YAML fields `goals`, `key_questions`, `scope`
- `wiki/overview.md` — Chinese global overview placeholder
- `wiki/log.md` — Chinese header with first append-only entry `## [YYYY-MM-DD] init | 工作区初始化`
- `wiki/index.md` — Chinese grouped empty table framework for content catalog
- `wiki/templates/` — Chinese page-type templates (entity, concept, source, synthesis, comparison, query) with required section headings
- `rules.md` — Chinese guidance scaffold (see rules.md scaffold requirement)

#### Scenario: Fresh workspace creation
- **WHEN** user runs `llmwiki init ~/research` on a non-existent directory
- **THEN** the system creates all required directories and scaffold files listed above
- **AND** initializes a git repository with `.gitignore` excluding `.llmwiki/`, `raw/`, `revert/`
- **AND** creates an initial commit containing `wiki/` scaffold files
- **AND** creates `~/research/.llmwiki/index.db` with the full schema
- **AND** runs initial reindex including `wiki/index.md` generation

#### Scenario: Already initialized workspace directory repair
- **WHEN** user runs `llmwiki init` on a workspace that already has `.llmwiki/index.db`
- **THEN** the system SHALL ensure all required directories exist
- **AND** SHALL create any missing scaffold files without overwriting existing files
- **AND** SHALL ensure git repository exists (init if missing, skip if present)
- **AND** SHALL NOT recreate or reset the database
- **AND** SHALL print a message indicating the workspace was already initialized

#### Scenario: Scaffold not overwritten
- **WHEN** user runs `llmwiki init` and `purpose.md` already exists with user-edited content
- **THEN** the system SHALL NOT modify `purpose.md`

#### Scenario: Git unavailable on init
- **WHEN** user runs `llmwiki init` and git CLI is not available on the system
- **THEN** the system SHALL fail with a clear error message indicating git is required
- **AND** SHALL NOT create a partial workspace without version control

### Requirement: Version control bootstrap on init
The system SHALL initialize version control as part of every `llmwiki init` execution, including repair runs on existing workspaces.

#### Scenario: Idempotent git init
- **WHEN** `llmwiki init` runs and `.git` already exists in the workspace
- **THEN** the system SHALL NOT re-initialize git
- **AND** SHALL preserve existing git history

#### Scenario: Git init after scaffolds
- **WHEN** `llmwiki init` runs on a fresh workspace
- **THEN** git initialization SHALL occur after scaffold files are written
- **AND** before database creation and reindex

### Requirement: rules.md scaffold
The system SHALL provide a default `rules.md` at the workspace root describing content fidelity, citation expectations, and domain constraints placeholders in Chinese.

#### Scenario: rules.md created on init
- **WHEN** user runs `llmwiki init` on a fresh workspace
- **THEN** `rules.md` SHALL exist with Chinese section headings for fidelity and domain rules

#### Scenario: rules.md not overwritten
- **WHEN** user runs init repair and `rules.md` already exists with user edits
- **THEN** the system SHALL NOT modify `rules.md`

### Requirement: Workspace reindex
The system SHALL support rebuilding the entire SQLite index from filesystem files via `llmwiki reindex <dir>`. This includes parsing YAML frontmatter from wiki pages to repopulate tags, date, and metadata, and re-parsing citations and wiki links to rebuild the reference graph.

#### Scenario: Reindex after DB deletion
- **WHEN** the `.llmwiki/index.db` is deleted and user runs `llmwiki reindex ~/research`
- **THEN** all wiki pages' content, tags, date, and description are restored from their markdown files; all source files are re-indexed; all reference graph edges are rebuilt from footnote and wikilink parsing

#### Scenario: Reindex with frontmatter recovery
- **WHEN** reindex processes a wiki page with YAML frontmatter containing `tags: [ai, llm]` and `date: 2025-03-15`
- **THEN** the documents table row SHALL have `tags = '["ai", "llm"]'` and `date = '2025-03-15'`

### Requirement: File watcher
The system SHALL monitor the workspace directory for file changes (create, modify, delete) and automatically update the SQLite index, with self-write protection to avoid re-indexing files written by the system itself.

#### Scenario: External file creation
- **WHEN** a new `.md` file is created in `wiki/concepts/` by an external editor
- **THEN** within the debounce window (700ms), the file is indexed in the database with source_kind='wiki'

#### Scenario: Self-write ignored
- **WHEN** the system's write handler creates a new wiki page via MCP or HTTP
- **THEN** the file watcher SHALL NOT trigger re-indexing for that path within the cooldown window (4 seconds)

### Requirement: Ignore patterns
The system SHALL ignore changes in `.llmwiki/`, `.git/`, `node_modules/`, `__pycache__/`, `.venv/`, and directories starting with `.`.

#### Scenario: Ignored directory change
- **WHEN** a file is created inside `.llmwiki/cache/`
- **THEN** the file watcher SHALL NOT index it

### Requirement: Tiered source file processing
The system SHALL support PDF and Office file ingestion via tiered capability levels: Layer A (built-in Go parsing), Layer B (optional system dependencies like pdftotext/LibreOffice), Layer C (degradation with readable limitation markers and remediation hints).

#### Scenario: Tier selection on processing
- **WHEN** a PDF or Office file is submitted for ingest
- **THEN** the system selects the highest available processing tier based on runtime capabilities

#### Scenario: Dependency unavailable fallback
- **WHEN** required optional dependency for high-tier extraction is unavailable
- **THEN** the system degrades to a lower tier and returns structured reason metadata

#### Scenario: Degradation observability
- **WHEN** Office processing falls back due to missing converter dependency
- **THEN** response payload and logs include fallback tier, missing dependency, and remediation hint

<!-- Added by change: web-default-data-ingestion -->

### Requirement: Web ingest file-first persistence boundary
The system SHALL persist Web-submitted ingest inputs as filesystem artifacts before treating ingestion as accepted for processing.

#### Scenario: Direct text persisted before processing
- **WHEN** user submits text/markdown via Web ingest form
- **THEN** system SHALL materialize canonical source content under workspace-managed storage before ingest job processing starts

#### Scenario: Uploaded files persisted before queue enqueue
- **WHEN** user uploads source files via Web ingest hub
- **THEN** system SHALL persist files to workspace source storage and only then enqueue ingest jobs

#### Scenario: Persistence failure blocks ingest acceptance
- **WHEN** workspace write fails due to permission or disk errors
- **THEN** system SHALL reject ingest acceptance and SHALL NOT enqueue processing jobs

### Requirement: Reindex consistency for web-ingested sources
The system SHALL ensure sources created through Web ingest are discoverable and reconstructable by workspace reindex.

#### Scenario: Reindex after database loss includes web-ingested sources
- **WHEN** SQLite index is deleted and `llmwiki reindex` runs
- **THEN** sources persisted via Web ingest SHALL be rediscovered from filesystem and restored into index state

<!-- v1-architecture-constraints codified: tiered-source-processing-v1 (tiered processing, optional deps, degradation observability already present) -->

<!-- Added by change: v1-architecture-constraints -->

<!-- Constraints from v1-architecture-constraints -->

### Requirement: File-first truth persistence
Business truth data SHALL be persisted to filesystem artifacts as canonical source of truth.

#### Scenario: Canonical wiki page persistence
- **WHEN** a wiki page is created or updated
- **THEN** the canonical content is written to markdown files on disk before or atomically with index updates

### Requirement: Derived-only database policy
SQLite SHALL store only rebuildable derived data (e.g., chunks, FTS index, references, status indexes), while allowing optional cached mirrors for performance.

#### Scenario: Rebuild after DB loss
- **WHEN** SQLite index database is removed and reindex is executed
- **THEN** core wiki business semantics (content, frontmatter-derived metadata, references) are reconstructed from filesystem truth artifacts

### Requirement: Cache non-authoritativeness
Any cached truth mirror in DB SHALL be treated as non-authoritative and replaceable by filesystem reconstruction.

#### Scenario: Cache divergence recovery
- **WHEN** cached metadata in DB diverges from file content
- **THEN** file content prevails and cache is refreshed during reindex or reconciliation

### Requirement: Forward enhancement declaration
The capability SHALL include documented extension points for future higher-fidelity parsing/OCR enhancements.

#### Scenario: Roadmap visibility
- **WHEN** operators review source processing documentation
- **THEN** they can identify planned enhancement path beyond first-release baseline tiers

### Requirement: Workspace 初始化预留 revert 目录
系统在 workspace 初始化时 SHALL 创建 `revert/` 目录结构。

#### Scenario: 初始化创建 revert 目录
- **WHEN** 用户执行 `llmwiki init <dir>` 初始化 workspace
- **THEN** 系统 SHALL 创建 `revert/` 目录（与 `wiki/`、`raw/sources/` 并列）

### Requirement: Reindex 兼容 git checkout 后的文件变化
系统 reindex 流程 SHALL 正确处理因 git checkout 导致的 wiki 文件批量变化。

#### Scenario: Git checkout 恢复文件后 reindex
- **WHEN** wiki/ 目录中的文件因 git checkout 发生批量变化（新增、修改、删除）
- **THEN** file watcher SHALL 检测到变化并触发 reindex
- **AND** reindex SHALL 正确处理文件删除（从 index 中移除对应记录）

#### Scenario: Revert 目录不参与 reindex
- **WHEN** reindex 扫描 workspace 目录
- **THEN** 系统 SHALL 忽略 `revert/` 目录中的文件

### Requirement: Wiki index automatic generation
The system SHALL generate `wiki/index.md` deterministically from wiki page frontmatter during `llmwiki reindex` and initial `llmwiki init` reindex.

The generated index SHALL:

- Group entries by wiki subdirectory (entities, concepts, sources, synthesis, comparisons, queries)
- Exclude navigation pages: `wiki/index.md`, `wiki/log.md`, `wiki/overview.md`
- Include columns: page wikilink, title, description summary, date
- Use Chinese section headings matching subdirectory purpose
- Include YAML frontmatter with `title`, `type: index`, and generation date
- Escape literal pipe characters (`|`) inside GFM table cell values as `\|` so wikilink display separators do not break column boundaries

#### Scenario: Reindex rebuilds index from wiki pages
- **WHEN** `llmwiki reindex` runs on a workspace with wiki pages under `wiki/entities/` and `wiki/concepts/`
- **THEN** the system writes `wiki/index.md` with entries grouped by subdirectory
- **AND** each entry reflects the page's frontmatter title and description

#### Scenario: Empty workspace index scaffold
- **WHEN** `llmwiki init` runs on a fresh workspace with no wiki content pages
- **THEN** `wiki/index.md` contains grouped section headers and empty tables in Chinese

#### Scenario: Index page indexed in SQLite
- **WHEN** reindex completes index generation
- **THEN** `wiki/index.md` is indexed in SQLite and searchable via FTS5

#### Scenario: Wikilink pipe escaped in table cells
- **WHEN** `llmwiki reindex` generates an index row with wikilink `[[entities/alpha|Alpha Entity]]`
- **THEN** the written markdown SHALL escape the wikilink display separator as `\|` (e.g. `[[entities/alpha\|Alpha Entity]]`)
- **AND** the row SHALL contain exactly four table columns: page wikilink, title, description, date

#### Scenario: Cell values with embedded pipes escaped
- **WHEN** a wiki page title or description contains a literal `|` character
- **THEN** the generated index table cell SHALL escape that character as `\|`
- **AND** the row SHALL remain parseable as four GFM columns

### Requirement: Typed organization aware index generation
The system SHALL generate `wiki/index.md` from typed business content pages only. Reserved top-level pages and system template files SHALL be excluded from content index entries.

#### Scenario: Template files excluded from generated index
- **WHEN** `llmwiki reindex` rebuilds `wiki/index.md`
- **THEN** files under `wiki/templates/` SHALL NOT appear as content rows in the generated index

#### Scenario: Misplaced top-level pages excluded from typed groups
- **WHEN** `llmwiki reindex` sees `wiki/dsp.md`
- **THEN** `wiki/dsp.md` SHALL NOT be inserted into the entities, concepts, sources, synthesis, comparisons, or queries groups
- **AND** lint or organize diagnostics SHALL remain responsible for reporting the misplaced page

### Requirement: Init repair preserves typed directory scaffold
The system SHALL ensure all typed wiki directories and system directories exist on every `llmwiki init` run, including repair runs on older workspaces.

#### Scenario: Repair creates missing typed directories
- **WHEN** user runs `llmwiki init` on a workspace missing `wiki/entities/` or `wiki/concepts/`
- **THEN** the system SHALL create the missing typed directories
- **AND** SHALL NOT overwrite existing wiki pages

#### Scenario: Repair creates templates directory
- **WHEN** user runs `llmwiki init` on a workspace missing `wiki/templates/`
- **THEN** the system SHALL create `wiki/templates/` and missing template scaffold files
- **AND** SHALL NOT treat template scaffold files as business content pages

### Requirement: Obsidian compatibility scaffold
The system SHALL create minimal `.obsidian/` configuration on `llmwiki init` when files do not already exist.

#### Scenario: Obsidian config on init
- **WHEN** user runs `llmwiki init ~/research`
- **THEN** `.obsidian/app.json` exists with basic Obsidian settings
- **AND** existing `.obsidian/` files are not overwritten on subsequent init
