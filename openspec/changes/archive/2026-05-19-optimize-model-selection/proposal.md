## Why

当前系统的 LLM 配置存在严重缺陷：Settings 纯内存不持久化（重启丢失）、只有一个全局 API Key（无法同时使用多个 provider）、provider/model 列表硬编码（只有 4 个选项且 `custom` 无实际功能）、所有 session 共用同一个 LLM Client。用户无法在不同对话中使用不同模型，也无法按 provider 独立管理 API Key。

## What Changes

- **Per-provider API Key 存储**：每个 provider 独立存储自己的 API Key 和可选 base_url，替代当前的全局单一 Key
- **models.dev 动态 provider/model 注册表**：启动时从 models.dev 同步 provider 和 model 元数据到 SQLite 缓存，定时更新；同步完成前使用 Go embed 的内置快照兜底
- **Per-session provider/model 选择**：每个 ingest session 可以独立配置 provider 和 model，存入数据库
- **"最近使用"全局配置**：新增后端配置功能，记录用户最近选择的 provider+model，新建 session 时自动继承
- **多 session 侧边栏**：前端新增 ChatGPT 式侧边栏，支持创建/切换/管理多个 session
- **输入框守卫**：session 未配置 provider/model 或对应 provider 缺少 API Key 时，输入框禁用并给出明确提示
- **统一存储到 SQLite**：所有配置（Settings、provider keys、最近使用）持久化到 SQLite，废弃 `.llmwiki/config.json` 文件和内存 SettingsConfig
- **删除 ConfigManager**：`internal/llm/config.go` 中的 `ConfigManager` 及文件配置机制被 SQLite 存储取代

## Capabilities

### New Capabilities
- `provider-registry`: provider 和 model 的元数据管理，包括 models.dev 同步、内置快照、API 查询
- `provider-key-store`: per-provider API Key 的安全存储和读取
- `model-selection-ui`: session 级别的 provider/model 选择器、联动下拉、输入框守卫
- `chat-sidebar-ui`: 多 session 侧边栏，支持创建/切换/列表展示

### Modified Capabilities
- `llm-integration`: 新增 per-session LLM client 创建逻辑，取代全局单例 client
- `ingest-session-api`: session 增加 provider/model 字段、新增列表和更新端点
- `ingest-chat-ui`: 集成 model-selection-ui 和 chat-sidebar-ui，输入框增加守卫逻辑

## Impact

- **后端**：`internal/llm/` 重构（删除 ConfigManager，client 创建逻辑变更）、`internal/api/` 大改（新增 provider/model/settings 端点）、`internal/store/sqlite/` 新增多张表和迁移
- **前端**：`AppContext` 重构为多 session 管理、新增 `ChatSidebar` 组件、`IngestChat` 增加选择器和守卫、`SettingsPage` 改为 per-provider Key 管理
- **数据库**：新增 `provider_keys`、`app_config`、`provider_info_cache`、`provider_models_cache` 四张表；`ingest_sessions` 增加 `llm_provider`、`llm_model` 列
- **外部依赖**：运行时需要网络访问 `models.dev`（首次启动或缓存过期时）
- **破坏性变更**：`.llmwiki/config.json` 不再使用，已有配置需迁移；前端 Settings 页面结构完全改变
