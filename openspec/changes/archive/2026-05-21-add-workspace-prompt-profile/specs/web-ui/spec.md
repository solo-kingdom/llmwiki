## ADDED Requirements

### Requirement: Wiki rules settings card
The Settings page SHALL expose workspace rule configuration with file preview and a supplement text field.

#### Scenario: Rules supplement editor
- **WHEN** user opens Settings
- **THEN** the page SHALL show a「Wiki 规则」section with a multiline field for `rules_supplement`
- **AND** the field SHALL display a character count with maximum 2048
- **AND** saving SHALL persist via PUT `/api/v1/settings`

#### Scenario: Workspace rule files preview
- **WHEN** user opens the Wiki rules section
- **THEN** the UI SHALL show read-only previews of `purpose.md` and `rules.md` (truncated) or a message when files are missing
- **AND** the UI SHALL indicate that full editing is done outside Settings (e.g. Obsidian or file editor)

#### Scenario: Supplement validation feedback
- **WHEN** user saves supplement longer than 2048 characters
- **THEN** the API SHALL return 400 and the UI SHALL show an error without partial save
