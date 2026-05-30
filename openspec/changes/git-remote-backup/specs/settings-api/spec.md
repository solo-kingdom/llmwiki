## ADDED Requirements

### Requirement: 备份与远程相关配置键
Settings API SHALL 支持读写 `backup_include_raw` 与 `vc_auto_push`。

#### Scenario: GET settings 包含备份与 push 键
- **WHEN** client calls GET `/api/v1/settings`
- **THEN** the response SHALL include `backup_include_raw` (default `"true"` if unset)
- **AND** SHALL include `vc_auto_push` (default `"false"` if unset)

#### Scenario: PUT backup_include_raw
- **WHEN** client PUTs `backup_include_raw` as `"true"` or `"false"`
- **THEN** the value SHALL be stored in `app_config`
- **AND** when set to `"false"` the system SHALL ensure `raw/` is listed in workspace `.gitignore`

#### Scenario: PUT vc_auto_push
- **WHEN** client PUTs `vc_auto_push` as `"true"` or `"false"`
- **THEN** the value SHALL be stored in `app_config`

#### Scenario: Settings 保存触发导出与备份
- **WHEN** client PUT `/api/v1/settings` succeeds
- **THEN** the system SHALL export `workspace-settings.json` and attempt a backup track commit per `workspace-backup-track`
