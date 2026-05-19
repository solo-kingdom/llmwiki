## ADDED Requirements

### Requirement: models.dev 同步与缓存
系统 SHALL 在启动时从 `https://models.dev/api.json` 获取 provider 和 model 元数据，解析后写入 `provider_info_cache` 和 `provider_models_cache` SQLite 表。

#### Scenario: 启动时同步
- **WHEN** 服务启动
- **THEN** 系统 SHALL 在后台 goroutine 中发起 GET 请求到 `https://models.dev/api.json`，成功后将数据写入缓存表

#### Scenario: 定时同步
- **WHEN** 服务运行中
- **THEN** 系统 SHALL 每小时自动触发一次同步，更新缓存表中的 provider 和 model 数据

#### Scenario: 同步失败不阻塞
- **WHEN** models.dev 请求失败（网络错误、超时、非 200 响应）
- **THEN** 系统 SHALL 记录日志但不影响任何已有功能，继续使用缓存或内置快照

#### Scenario: 同步成功更新时间戳
- **WHEN** 同步成功完成
- **THEN** 系统 SHALL 更新 `app_config` 表中 `models_synced_at` 的值为当前时间

### Requirement: 内置 provider 快照
系统 SHALL 通过 Go embed 内置一份精简的 provider/model JSON 快照，包含至少 20 个常用 provider 及其核心 models。

#### Scenario: 无缓存时使用快照
- **WHEN** 缓存表为空且 models.dev 同步尚未完成
- **THEN** 系统 SHALL 从内置快照加载数据到缓存表

#### Scenario: 快照优先级低于远程
- **WHEN** models.dev 同步成功
- **THEN** 远程数据 SHALL 覆盖快照数据

### Requirement: Provider 列表 API
系统 SHALL 暴露 `GET /api/v1/providers` 端点返回所有可用 provider 列表。

#### Scenario: 返回 provider 列表
- **WHEN** 客户端请求 `GET /api/v1/providers`
- **THEN** 系统 SHALL 返回 `[{id, name, api_base, api_format, has_key, doc_url}, ...]`，其中 `has_key` 表示该 provider 是否在 `provider_keys` 表中存有 API Key

#### Scenario: 空缓存返回内置快照
- **WHEN** 缓存表为空且快照尚未加载
- **THEN** 系统 SHALL 先加载内置快照再返回

### Requirement: Provider Models 列表 API
系统 SHALL 暴露 `GET /api/v1/providers/{id}/models` 端点返回指定 provider 的 model 列表。

#### Scenario: 返回 model 列表
- **WHEN** 客户端请求 `GET /api/v1/providers/{provider_id}/models`
- **THEN** 系统 SHALL 返回 `[{id, name, family, context_limit, output_limit, reasoning, tool_call, attachment, cost_input, cost_output}, ...]`

#### Scenario: Provider 不存在
- **WHEN** 请求的 provider_id 在缓存中不存在
- **THEN** 系统 SHALL 返回 HTTP 404

### Requirement: 协议格式映射
系统 SHALL 为每个 provider 确定其底层 API 协议格式（`openai`、`anthropic` 或 `ollama`），存储在 `provider_info_cache.api_format` 中。

#### Scenario: 映射规则
- **WHEN** 同步 models.dev 数据时
- **THEN** 系统 SHALL 将 `anthropic` provider 映射为 `anthropic` 格式、`ollama` 映射为 `ollama` 格式、其余所有 provider 映射为 `openai` 格式
