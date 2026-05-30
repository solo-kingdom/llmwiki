## ADDED Requirements

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
