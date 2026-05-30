## ADDED Requirements

### Requirement: Typed directory naming uses plural subdirectories
The typed wiki organization contract SHALL document that canonical typed directories use plural directory names (`entities`, `concepts`, `sources`, `synthesis`, `comparisons`, `queries`) and that singular aliases (`entity/`, `concept/`, `source/`) are invalid canonical paths.

#### Scenario: Singular directory is not canonical
- **WHEN** documentation or diagnostics describe the typed wiki layout
- **THEN** they SHALL refer to `wiki/entities/` rather than `wiki/entity/`
- **AND** SHALL treat singular paths as normalization input only, not canonical storage locations

#### Scenario: Workspace root files are outside wiki
- **WHEN** documentation describes workspace layout
- **THEN** it SHALL state that `purpose.md` and `rules.md` belong to the workspace root
- **AND** SHALL NOT list them as children of `wiki/` in canonical layout diagrams

### Requirement: Structure diagnostics align with typed wiki contract
Organize diagnostics and documentation SHALL use the same typed subdirectory list as `engine.TypedWikiSubdirs` when presenting wiki structure.

#### Scenario: Structure output lists all typed directories
- **WHEN** the `structure` tool renders typed subdirectories
- **THEN** it SHALL include all directories in `TypedWikiSubdirs` even when empty
- **AND** SHALL mark `wiki/templates/` as system templates when present
