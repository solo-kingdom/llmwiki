## MODIFIED Requirements

### Requirement: Workspace initialization
The system SHALL initialize a workspace directory with the required structure upon `llmwiki init <dir>`. The structure SHALL include:

- Wiki subdirectories: `wiki/entities/`, `wiki/concepts/`, `wiki/sources/`, `wiki/synthesis/`, `wiki/comparisons/`, `wiki/queries/`
- Raw directories: `raw/sources/`, `raw/assets/`
- Application data: `.llmwiki/`, `.llmwiki/cache/`
- Version control helper: `revert/`
- Obsidian compatibility: `.obsidian/`

Scaffold files (created only if missing):

- `purpose.md` — Chinese template with YAML fields `goals`, `key_questions`, `scope`
- `wiki/overview.md` — Chinese global overview placeholder
- `wiki/log.md` — Chinese header with first append-only entry `## [YYYY-MM-DD] init | 工作区初始化`
- `wiki/index.md` — Chinese grouped empty table framework for content catalog

#### Scenario: Fresh workspace creation
- **WHEN** user runs `llmwiki init ~/research` on a non-existent directory
- **THEN** the system creates all required directories and scaffold files listed above
- **AND** creates `~/research/.llmwiki/index.db` with the full schema
- **AND** runs initial reindex including `wiki/index.md` generation

#### Scenario: Already initialized workspace directory repair
- **WHEN** user runs `llmwiki init` on a workspace that already has `.llmwiki/index.db`
- **THEN** the system SHALL ensure all required directories exist
- **AND** SHALL create any missing scaffold files without overwriting existing files
- **AND** SHALL NOT recreate or reset the database
- **AND** SHALL print a message indicating the workspace was already initialized

#### Scenario: Scaffold not overwritten
- **WHEN** user runs `llmwiki init` and `purpose.md` already exists with user-edited content
- **THEN** the system SHALL NOT modify `purpose.md`

## ADDED Requirements

### Requirement: Wiki index automatic generation
The system SHALL generate `wiki/index.md` deterministically from wiki page frontmatter during `llmwiki reindex` and initial `llmwiki init` reindex.

The generated index SHALL:

- Group entries by wiki subdirectory (entities, concepts, sources, synthesis, comparisons, queries)
- Exclude navigation pages: `wiki/index.md`, `wiki/log.md`, `wiki/overview.md`
- Include columns: page wikilink, title, description summary, date
- Use Chinese section headings matching subdirectory purpose
- Include YAML frontmatter with `title`, `type: index`, and generation date

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

### Requirement: Obsidian compatibility scaffold
The system SHALL create minimal `.obsidian/` configuration on `llmwiki init` when files do not already exist.

#### Scenario: Obsidian config on init
- **WHEN** user runs `llmwiki init ~/research`
- **THEN** `.obsidian/app.json` exists with basic Obsidian settings
- **AND** existing `.obsidian/` files are not overwritten on subsequent init
