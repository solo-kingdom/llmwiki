## MODIFIED Requirements

### Requirement: Workspace initialization
`llmwiki init [dir] --database-url <dsn>` SHALL create the PostgreSQL schema and workspace row. When a directory is given, it SHALL also create the optional scaffold directory (wiki/, raw/, rules.md, purpose.md) for import/export use.

Scaffold rules:
- Existing files SHALL NOT be overwritten.
- `llmwiki init` SHALL NOT require git or create `.git/`.
- A missing directory is created only when explicitly passed.

#### Scenario: Fresh workspace
- **WHEN** user runs `llmwiki init --name research`
- **THEN** the system creates the schema and a `workspace` row
- **AND** no git repository or SQLite file is created

#### Scenario: Scaffold not overwritten
- **WHEN** `purpose.md` already exists with user-edited content
- **THEN** the system does not modify it

#### Scenario: git unavailable
- **WHEN** git is not installed
- **THEN** `llmwiki init` succeeds without invoking git

### Requirement: Legacy workspace migration
`llmwiki migrate --workspace <dir>` SHALL import files, legacy SQLite settings/provider rows, source blobs and initial revisions into PostgreSQL without modifying the source directory.

#### Scenario: Migration verification
- **WHEN** migration completes
- **THEN** every wiki markdown file has a document row and an initial `create` revision
- **AND** the report lists imported file, document, revision and blob counts
