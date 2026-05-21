## Requirements

### Requirement: rules_supplement configuration
The Settings API SHALL support reading and writing `rules_supplement` for append-only wiki generation rules.

#### Scenario: GET settings includes supplement
- **WHEN** client calls GET `/api/v1/settings`
- **THEN** the response SHALL include `rules_supplement` as a string (empty string if unset)

#### Scenario: PUT settings validates supplement length
- **WHEN** client PUTs `rules_supplement` with length greater than 2048 characters
- **THEN** the API SHALL return HTTP 400 with a descriptive error
- **WHEN** client PUTs a valid supplement
- **THEN** the value SHALL be stored in `app_config` and returned on subsequent GET

#### Scenario: Disallowed keys ignored
- **WHEN** client PUTs unknown keys alongside `rules_supplement`
- **THEN** unknown keys SHALL be ignored per existing settings behavior

### Requirement: Workspace rule files preview API
The system SHALL expose GET `/api/v1/workspace/rule-files` returning truncated previews of `purpose.md` and `rules.md` for the active workspace.

#### Scenario: Preview returns truncated content
- **WHEN** client calls GET `/api/v1/workspace/rule-files` with an initialized workspace
- **THEN** the response SHALL include `purpose_preview` and `rules_preview` strings each at most 500 characters
- **AND** SHALL include file modification hints when available
