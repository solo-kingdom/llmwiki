## Why

当前 Settings 页面将 models.dev 同步的所有 provider（18+ 个）全部平铺展示 API key 配置表单，认知负担巨大。每个 provider 只能配一个 key，无法支持同一 provider 多账号的场景。Chat 模型选择器同样列出所有 provider，用户要在大量未配置的 ⚠ 标记中寻找自己要用的。需要将"全部平铺"改为"用户主动添加"模式，支持命名实例，让用户只看到自己配置的 provider。

## What Changes

- **新增 provider_instances 数据层**：新建 `provider_instances` 表替代 `provider_keys`，支持多个同名 provider 的不同实例，每个实例有用户自定义名称、API key、base URL
- **BREAKING 重构 Settings Provider 区域**：从平铺 18 个 provider 表单改为"我的 Provider 列表 + 添加表单"模式
- **重构 Chat 模型选择器**：Provider 下拉从"所有 catalog provider"改为"已添加的实例列表"
- **BREAKING 废弃 provider_keys 表和相关 API**：被 provider_instances 完全替代
- **BREAKING 更改 session 和 config 的 provider 引用方式**：从 `provider_id` 改为 `instance_id`

## Capabilities

### New Capabilities
- `provider-instance-management`: Provider 实例的 CRUD 数据层、API、Settings UI，包括添加（下拉选类型 + inline 表单）、编辑（允许改类型但保留 key）、删除、命名

### Modified Capabilities
- `llm-integration`: LLM 客户端创建逻辑从按 provider_id 查 key 改为按 instance_id 查实例信息，再通过 catalog_id 获取 api_format
- `ingest-chat-ui`: 模型选择器从 provider+model 改为 instance+model，空状态引导改为提示先去 Settings 添加 Provider
- `web-ui`: Settings 页面的 Provider Keys 区域完全重构为实例列表 + 添加表单

## Impact

- **数据库**: 新增 `provider_instances` 表，`ingest_sessions` 表 `llm_provider` 字段改为 `llm_instance_id`，`app_config` 中 `last_provider` 改为 `last_instance_id`，废弃 `provider_keys` 表
- **Go 后端**: `internal/store/sqlite/` 新增 `provider_instance.go`，修改 `ingest_sessions.go`、`app_config.go`；`internal/api/` 新增 instance CRUD endpoints，修改 `settings.go`、`providers.go`、`api.go` 中 `providerLLMClient()` 逻辑
- **前端类型**: `types.ts` 新增 `ProviderInstance` 类型，`Settings` 接口调整
- **前端 API**: `lib/api.ts` 新增 instance CRUD 函数
- **前端状态**: `AppContext.tsx` 新增 instances 状态管理，调整 providers/models 加载逻辑
- **前端 UI**: `SettingsPage.tsx` Provider 区域重写，`IngestChat.tsx` 模型选择器重写，`ChatSidebar.tsx` 显示实例名
- **不做数据迁移**: 废弃的表和字段直接替换，不保留旧数据
