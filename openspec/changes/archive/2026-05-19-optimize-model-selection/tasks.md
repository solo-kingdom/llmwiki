## 1. 数据库 Schema 与存储层

- [x] 1.1 在 `internal/store/sqlite/schema.sql` 新增 `app_config` 表（key-value）、`provider_keys` 表（provider_id, api_key, base_url）、`provider_info_cache` 表（id, name, api_base, api_format, env_key, doc_url）、`provider_models_cache` 表（provider_id, model_id, name, family, context_limit, output_limit, cost_input, cost_output, reasoning, tool_call, attachment, modalities）
- [x] 1.2 `ingest_sessions` 表新增 `llm_provider TEXT DEFAULT ''` 和 `llm_model TEXT DEFAULT ''` 列（ALTER TABLE 或在 schema.sql 中修改）
- [x] 1.3 在 `internal/store/sqlite/` 新增 `app_config.go`，实现 `GetConfig(key) string`、`SetConfig(key, value)`、`GetAllConfig() map[string]string` 方法
- [x] 1.4 在 `internal/store/sqlite/` 新增 `provider_keys.go`，实现 `SetProviderKey(providerID, apiKey, baseURL)`、`GetProviderKey(providerID) (apiKey, baseURL, error)`、`DeleteProviderKey(providerID)`、`ListProviderKeys() ([]ProviderKey, error)` 方法
- [x] 1.5 在 `internal/store/sqlite/` 新增 `provider_cache.go`，实现 `UpsertProviderInfo(providers []ProviderInfo)`、`UpsertModels(models []ModelInfo)`、`ListProviders() ([]ProviderInfo, error)`、`ListModelsByProvider(providerID) ([]ModelInfo, error)`、`GetProviderInfo(providerID) (*ProviderInfo, error)` 方法
- [x] 1.6 在 `internal/store/sqlite/ingest_sessions.go` 中修改 `IngestSession` struct 新增 `LLMProvider` 和 `LLMModel` 字段，更新所有 SQL 和 scan 函数
- [x] 1.7 在 `internal/store/sqlite/ingest_sessions.go` 新增 `ListIngestSessions() ([]IngestSession, error)` 和 `UpdateIngestSessionLLM(id, provider, model string) error` 方法
- [x] 1.8 为所有新增存储方法编写单元测试

## 2. Provider Registry — models.dev 同步

- [x] 2.1 创建 `internal/llm/provider_snapshot.go`，用 `go:embed` 嵌入精简的 provider/model JSON 快照文件（约 20 个常用 provider），提供 `LoadSnapshot() ([]ProviderInfo, []ModelInfo)` 函数
- [x] 2.2 创建精简 JSON 快照文件 `internal/llm/providers_snapshot.json`，包含 openai、anthropic、ollama、groq、deepseek、mistral、openrouter、together、fireworks-ai、xai、google 等 ~20 个 provider 及其主要 models
- [x] 2.3 创建 `internal/llm/provider_sync.go`，实现 `SyncModelsDev(ctx context.Context, db *sqlite.DB) error` 函数：GET `https://models.dev/api.json`，解析 JSON，确定 api_format（anthropic→anthropic, ollama→ollama, 其余→openai），写入 `provider_info_cache` 和 `provider_models_cache` 表
- [x] 2.4 在 `internal/server/server.go` 的 `Start()` 方法中启动同步 goroutine：先调用 `SyncModelsDev`，再启动每小时定时器
- [x] 2.5 编写 `internal/llm/provider_sync_test.go`：测试 JSON 解析、api_format 映射规则、空数据处理
- [x] 2.6 编写 `internal/llm/provider_snapshot_test.go`：测试快照加载、验证数据格式正确

## 3. API 层 — Provider 与 Settings 端点

- [x] 3.1 创建 `internal/api/providers.go`，实现 `GET /api/v1/providers` 端点：从 `provider_info_cache` 表读 provider 列表，关联 `provider_keys` 表判断 `has_key`，返回 JSON
- [x] 3.2 实现 `GET /api/v1/providers/{id}/models` 端点：从 `provider_models_cache` 表按 provider_id 查询，返回 model 列表
- [x] 3.3 重构 `internal/api/settings.go`：将 `SettingsConfig` 内存 struct 替换为从 SQLite `app_config` + `provider_keys` 表读取，`GetSettings` 和 `UpdateSettings` 操作数据库
- [x] 3.4 新增 `PUT /api/v1/settings/last-model` 端点：更新 `app_config` 的 `last_provider` 和 `last_model`
- [x] 3.5 新增 `PUT /api/v1/settings/provider-keys/{provider_id}` 端点：存储/更新/删除 per-provider API Key 和 base_url
- [x] 3.6 在 `internal/server/server.go` 中注册新路由：`/providers`、`/providers/{id}/models`、`/settings/last-model`、`/settings/provider-keys/{provider_id}`
- [x] 3.7 编写 `internal/api/providers_test.go` 和 `settings_test.go` 测试

## 4. API 层 — Session 端点改造

- [x] 4.1 修改 `CreateIngestSession` handler：接受可选的 `provider` 和 `model` 字段，未提供时从 `app_config` 读取 `last_provider` 和 `last_model` 填入
- [x] 4.2 新增 `ListIngestSessions` handler：`GET /api/v1/ingest/sessions` 返回 session 列表（含 llm_provider, llm_model）
- [x] 4.3 新增 `UpdateIngestSession` handler：`PATCH /api/v1/ingest/sessions/{id}` 更新 provider/model/title，同时更新 `app_config` 的 `last_provider`/`last_model`
- [x] 4.4 修改 `streamSessionReply`：从 session 读取 provider/model，回退到 `app_config` 的 `last_provider`/`last_model`，从 `provider_keys` 读 API Key，动态创建 `llm.Client`
- [x] 4.5 在 `internal/server/server.go` 中注册新路由：`GET /ingest/sessions`、`PATCH /ingest/sessions/{id}`
- [x] 4.6 编写 `internal/api/ingest_session_test.go` 新增测试：带 provider/model 创建 session、列表、更新、未配置时报错

## 5. 旧配置迁移

- [x] 5.1 在服务启动流程中（`cmd/llmwiki/` 或 `internal/server/`）添加迁移检测：`.llmwiki/config.json` 存在且 `provider_keys` 表为空时，读取 JSON 并写入 `provider_keys` 和 `app_config` 表
- [x] 5.2 编写迁移测试

- [x] 6.1 在 `web/src/types.ts` 新增类型定义：`Provider`、`ModelInfo`、`ProviderKeyStatus`、`SessionListItem`，修改 `IngestSession` 增加 `llm_provider` 和 `llm_model`，修改 `Settings` 增加 `provider_keys` 和 `last_provider`/`last_model`
- [x] 6.2 在 `web/src/lib/api.ts` 新增 API 函数：`listProviders()`、`listProviderModels(providerId)`、`updateLastModel(provider, model)`、`setProviderKey(providerId, apiKey, baseURL?)`、`listIngestSessions()`、`updateIngestSession(id, {provider?, model?, title?})`
- [x] 6.3 编写前端 API 测试

## 7. 前端 — Context 多 Session 管理

- [x] 7.1 重构 `web/src/context/AppContext.tsx`：新增 `sessions: SessionListItem[]`、`activeSessionId: string | null`、`providers: Provider[]`、`currentModels: ModelInfo[]` 状态
- [x] 7.2 新增方法：`loadProviders()`、`loadModels(providerId)`、`listSessions()`、`createSession()`、`switchSession(id)`、`updateSessionLLM(id, provider, model)`、`updateLastModel(provider, model)`
- [x] 7.3 修改 `ensureIngestSession`：使用 `createSession()` 逻辑，传入最近使用的 provider/model
- [x] 7.4 修改 `sendSessionMessage`：在发送前检查 provider/model/key 是否就绪

## 8. 前端 — ChatSidebar 组件

- [x] 8.1 创建 `web/src/components/ChatSidebar.tsx`：session 列表、新建按钮、切换逻辑、provider 信息展示、归档状态区分、可折叠
- [x] 8.2 在 `web/src/App.tsx` 的 Ingest tab 中集成 ChatSidebar（左侧）和 IngestChat（右侧）布局

## 9. 前端 — Model Selection UI

- [x] 9.1 在 `web/src/components/IngestChat.tsx` 顶部新增 Provider 下拉和 Model 下拉选择器，实现联动逻辑
- [x] 9.2 Provider 选项中显示 has_key 警告标识（⚠️ 未配 Key）
- [x] 9.3 实现输入框守卫逻辑：检查 provider + model + has_key，未满足时禁用输入框并显示提示
- [x] 9.4 切换 provider/model 时调用 `updateSessionLLM` 和 `updateLastModel`

## 10. 前端 — Settings 页面改造

- [x] 10.1 重构 `web/src/components/SettingsPage.tsx` LLM Configuration 区域：显示 provider 列表，每行包含 provider 名称、Key 状态 badge、Key 输入框、可选 base_url 输入框
- [x] 10.2 保存时调用 `setProviderKey` API
- [x] 10.3 保留通用 Settings（temperature, max_tokens, chunk_size 等）区域，调用更新后的 `saveSettings`

## 11. 清理与删除

- [x] 11.1 删除 `internal/llm/config.go` 中的 `ConfigManager`、`LoadConfig`、`SaveConfig`、`WorkspaceConfig` 及相关代码
- [x] 11.2 删除 `internal/api/api.go` 中的 `configMgr` 字段
- [x] 11.3 更新所有引用 `ConfigManager` 的代码（`cmd/llmwiki/`、`internal/server/`）
- [x] 11.4 更新或删除 `internal/llm/config_test.go` 中已不适用的测试

## 12. 集成测试与端到端验证

- [x] 12.1 后端集成测试：启动服务器 → GET /providers → 选择 provider → GET /models → 创建 session 带 provider/model → 发送消息验证流式响应
- [x] 12.2 前端集成测试：渲染 Ingest tab → 验证侧边栏 → 切换 provider → 验证 model 联动 → 验证输入框守卫
- [x] 12.3 迁移测试：准备 `.llmwiki/config.json` → 启动服务器 → 验证配置已迁移到 SQLite → 验证 API 正常工作
