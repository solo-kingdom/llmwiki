## ADDED Requirements

### Requirement: Settings 导出文件
系统 SHALL 将非敏感应用配置导出到 workspace 文件 `.llmwiki/workspace-settings.json`，供轨道 B git 备份。

#### Scenario: 导出内容
- **WHEN** 系统执行 settings 导出
- **THEN** 文件 SHALL 包含 `version: 1` 及与 `GET /settings` 一致的非敏感字段（模型、语言、chunk、MCP JSON、rules_supplement、tool loop 等）
- **AND** SHALL NOT 包含任何 provider API Key 或 `provider_instances` 凭证

#### Scenario: Settings 保存触发导出
- **WHEN** `PUT /settings` 成功
- **THEN** SHALL 写入或更新 `.llmwiki/workspace-settings.json`

### Requirement: Settings 导入
系统 SHALL 在适当时机从 `.llmwiki/workspace-settings.json` 导入配置到 `app_config`。

#### Scenario: 新数据库首次 init 后导入
- **WHEN** `llmwiki init` 创建新 `index.db` 且 workspace 存在有效的 `workspace-settings.json`
- **THEN** SHALL 将文件中的允许键导入 `app_config`
- **AND** SHALL NOT 导入 API Key

#### Scenario: serve 启动时空配置导入
- **WHEN** `llmwiki serve` 启动且 `app_config` 无业务配置键且存在有效导出文件
- **THEN** SHALL 执行导入

#### Scenario: 无效导出文件
- **WHEN** 导出文件 JSON 无效或 `version` 不支持
- **THEN** SHALL 跳过导入并记录 warning，不阻塞 init/serve

### Requirement: API Key 新环境重填
系统 SHALL NOT 通过 git 备份恢复 provider API Key；导入后用户 MUST 在 Settings 重新配置凭证。

#### Scenario: 导入后 provider 为空
- **WHEN** settings 从文件导入完成
- **THEN** `provider_instances` SHALL 保持为空或仅含无 key 的占位
- **AND** Settings UI SHALL 可提示用户重新填写 API Key
