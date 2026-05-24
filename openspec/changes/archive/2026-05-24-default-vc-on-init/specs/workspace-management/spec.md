## MODIFIED Requirements

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

## ADDED Requirements

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
