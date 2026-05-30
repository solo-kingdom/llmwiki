## MODIFIED Requirements

### Requirement: Workspace initialization
The system SHALL initialize a workspace directory with the required structure upon `llmwiki init <dir>`. The structure SHALL include:

- Wiki subdirectories: `wiki/templates/`, `wiki/entities/`, `wiki/concepts/`, `wiki/sources/`, `wiki/synthesis/`, `wiki/comparisons/`, `wiki/queries/`
- Raw directories: `raw/sources/`, `raw/assets/`
- Application data: `.llmwiki/`, `.llmwiki/cache/`
- Version control helper: `revert/`
- Obsidian compatibility: `.obsidian/`
- Git repository: `.git/` (initialized by `llmwiki init`, initial commit tracking `wiki/` only; backup track configured via fine-grained `.gitignore`)

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
- **AND** initializes a git repository with fine-grained `.gitignore` (excludes `.llmwiki/cache/`, `.llmwiki/index.db`, `.llmwiki/worktrees/`, `revert/`; does not exclude `raw/` by default)
- **AND** creates an initial commit containing `wiki/` scaffold files only
- **AND** creates `~/research/.llmwiki/index.db` with the full schema
- **AND** runs initial reindex including `wiki/index.md` generation

#### Scenario: Already initialized workspace directory repair
- **WHEN** user runs `llmwiki init` on a workspace that already has `.llmwiki/index.db`
- **THEN** the system SHALL ensure all required directories exist
- **AND** SHALL create any missing scaffold files without overwriting existing files
- **AND** SHALL ensure git repository exists (init if missing, skip if present)
- **AND** SHALL migrate `.gitignore` to fine-grained rules when legacy blanket `.llmwiki/` entry exists
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

### Requirement: 新环境 settings 导入
`llmwiki init` on a fresh database SHALL import `.llmwiki/workspace-settings.json` when present (see `workspace-settings-export`).

#### Scenario: clone 后 init 导入设置
- **WHEN** user clones a remote workspace backup and runs `llmwiki init` creating new index.db
- **THEN** the system SHALL import non-secret settings from export file before reindex
- **AND** user SHALL re-enter API keys via Settings
