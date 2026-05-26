## ADDED Requirements

### Requirement: Per-provider API Key 存储
系统 SHALL 在 SQLite `provider_keys` 表中按 provider_id 存储 API Key 和可选 base_url。

#### Scenario: 存储新 Key
- **WHEN** 客户端发送 `PUT /api/v1/settings/provider-keys/{provider_id}` 且 body 包含 `{api_key: "..."}`
- **THEN** 系统 SHALL 将 API Key 写入 `provider_keys` 表，关联到指定 provider_id

#### Scenario: 更新已有 Key
- **WHEN** 客户端对已有 Key 的 provider 再次发送 PUT 请求
- **THEN** 系统 SHALL 用新值覆盖旧值

#### Scenario: 自定义 base_url
- **WHEN** 请求 body 包含 `base_url` 字段
- **THEN** 系统 SHALL 将此 base_url 与 API Key 一起存储，用于覆盖 models.dev 的默认 base_url

#### Scenario: 删除 Key
- **WHEN** 客户端发送 `PUT /api/v1/settings/provider-keys/{provider_id}` 且 `api_key` 为空字符串
- **THEN** 系统 SHALL 删除该 provider 的 Key 记录

### Requirement: API Key 读取
系统 SHALL 支持按 provider_id 读取 API Key，并在 Settings API 中返回 masked 版本。

#### Scenario: 获取 Settings 包含 Key 状态
- **WHEN** 客户端请求 `GET /api/v1/settings`
- **THEN** 响应 SHALL 包含 `provider_keys` 字段，列出每个有 Key 的 provider 及其 masked key（如 `sk-...xyz`）

#### Scenario: 构造 LLM Client 时读取 Key
- **WHEN** 系统需要为某 provider 创建 LLM Client
- **THEN** 系统 SHALL 从 `provider_keys` 表读取该 provider 的 `api_key` 和 `base_url`

#### Scenario: Key 不存在报错
- **WHEN** 系统尝试为某 provider 创建 LLM Client 但 `provider_keys` 表中无该 provider 记录
- **THEN** 系统 SHALL 返回错误：该 provider API Key 未配置

### Requirement: 环境变量回退
系统 SHALL 支持从环境变量读取 API Key 作为回退。

#### Scenario: 环境变量回退
- **WHEN** `provider_keys` 表中无某 provider 的 Key，但环境中存在该 provider 对应的环境变量（如 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY`）
- **THEN** 系统 SHALL 使用环境变量中的 Key
