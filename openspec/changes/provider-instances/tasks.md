## 1. 数据库 Schema 变更

- [x] 1.1 在 `schema.sql` 中新增 `provider_instances` 表（id, name, catalog_id, api_key, base_url, created_at, updated_at）
- [x] 1.2 在 `schema.sql` 中为 `ingest_sessions` 表新增 `llm_instance_id TEXT` 列
- [x] 1.3 更新 `app_config` 逻辑：`last_provider` 改为 `last_instance_id`（在 store 层处理 key 名变更）

## 2. Store 层 — Provider Instance CRUD

- [x] 2.1 新建 `internal/store/sqlite/provider_instance.go`，定义 `ProviderInstance` 结构体（ID, Name, CatalogID, APIKey, BaseURL, CreatedAt, UpdatedAt）
- [x] 2.2 实现 `CreateProviderInstance(instance)` — 生成 `inst_` + UUID[:8] 的 ID，插入数据库
- [x] 2.3 实现 `GetProviderInstance(id)` — 按 ID 查询单个实例
- [x] 2.4 实现 `ListProviderInstances()` — 列出所有实例，按 created_at 排序
- [x] 2.5 实现 `UpdateProviderInstance(id, name, catalogID, apiKey, baseURL)` — 更新实例字段（允许改 catalog_id，不清空 api_key）
- [x] 2.6 实现 `DeleteProviderInstance(id)` — 按 ID 删除实例
- [x] 2.7 编写 `provider_instance_test.go` 覆盖 CRUD 场景，包括同 catalog_id 多实例、改类型保留 key、删除不存在返回错误

## 3. Store 层 — IngestSession 和 AppConfig 适配

- [x] 3.1 更新 `IngestSession` 结构体：`LLMProvider` 改为 `LLMInstanceID`（JSON tag 改为 `llm_instance_id`）
- [x] 3.2 更新 `scanIngestSession` 以适配新字段
- [x] 3.3 更新 `CreateIngestSession` 和 `UpdateIngestSessionLLM` 使用 `llm_instance_id`
- [x] 3.4 更新 `app_config` 读写：`last_provider` key 改为 `last_instance_id`

## 4. API 层 — Instance CRUD Endpoints

- [x] 4.1 在 `internal/api/` 新增或扩展文件实现 `POST /api/v1/provider-instances` 创建实例
- [x] 4.2 实现 `GET /api/v1/provider-instances` 列出实例
- [x] 4.3 实现 `GET /api/v1/provider-instances/{id}` 获取单个实例
- [x] 4.4 实现 `PUT /api/v1/provider-instances/{id}` 更新实例（验证 catalog_id 存在于 provider_info_cache）
- [x] 4.5 实现 `DELETE /api/v1/provider-instances/{id}` 删除实例（实例不存在返回 404）
- [x] 4.6 在 `server.go` 注册新路由
- [x] 4.7 编写 API 测试覆盖 CRUD 和边界情况

## 5. API 层 — LLM 客户端创建逻辑适配

- [x] 5.1 重构 `api.go` 中 `providerLLMClient()` 为 `instanceLLMClient(instanceID, model)`：从 provider_instances 查实例，再从 provider_info_cache 查 api_format
- [x] 5.2 移除 env fallback 逻辑（不再从环境变量读 API key）
- [x] 5.3 更新 `sessionLLMClient()` 使用 instance_id 替代 provider_id
- [x] 5.4 处理实例不存在时的错误返回

## 6. API 层 — Settings 和 Session endpoint 适配

- [x] 6.1 移除 `PUT /settings/provider-keys/{id}` endpoint
- [x] 6.2 更新 `PUT /settings/last-model` 使用 `instance_id` 替代 `provider`
- [x] 6.3 更新 `PATCH /ingest/sessions/{id}` 使用 `instance_id` 替代 `provider`
- [x] 6.4 更新 `GET /settings` 响应，移除 `provider_keys` 字段

## 7. 前端类型和 API 层

- [x] 7.1 在 `types.ts` 新增 `ProviderInstance` 接口（id, name, catalog_id, api_key_masked, base_url, created_at）
- [x] 7.2 更新 `Settings` 接口：`last_provider` → `last_instance_id`，移除 `provider_keys`
- [x] 7.3 更新 `SessionListItem` 和 `IngestSession` 接口：`llm_provider` → `llm_instance_id`
- [x] 7.4 在 `lib/api.ts` 新增 instance CRUD 函数（createInstance, listInstances, getInstance, updateInstance, deleteInstance）
- [x] 7.5 更新 `lib/api.ts` 中 `updateIngestSession` 和 `updateLastModel` 使用 instance_id

## 8. 前端状态管理 — AppContext

- [x] 8.1 在 `AppContext` 中新增 `instances: ProviderInstance[]` 状态
- [x] 8.2 新增 `loadInstances()` 方法调用 `listInstances` API
- [x] 8.3 新增 `createInstance()`, `updateInstance()`, `deleteInstance()` 方法
- [x] 8.4 更新 `loadModels` 接受 catalog_id（从 instance.catalog_id 获取）而非 provider_id
- [x] 8.5 更新 `updateSessionLLM` 使用 instance_id + model
- [x] 8.6 更新 `updateLastModel` 使用 instance_id
- [x] 8.7 更新 `switchSession` 从 session 的 `llm_instance_id` 加载模型列表
- [x] 8.8 更新 `ensureIngestSession` 和 `archiveSession` 中创建新 session 时使用 instance_id

## 9. 前端 UI — Settings 页面重构

- [x] 9.1 重写 SettingsPage 的 Provider 区域：实例列表卡片（显示名称、masked key、编辑/删除按钮）
- [x] 9.2 实现空状态展示（无实例时的引导文案）
- [x] 9.3 实现添加实例 inline 表单（Provider 类型下拉 + 名称 + Key + URL + 确认/取消）
- [x] 9.4 实现名称字段自动预填所选 provider 的 display name
- [x] 9.5 实现编辑实例表单（预填当前值，改类型时显示警告，不清空 key）
- [x] 9.6 实现删除确认

## 10. 前端 UI — Chat 模型选择器重构

- [x] 10.1 重写 IngestChat 顶部选择器：实例下拉替代 Provider 下拉
- [x] 10.2 实例下拉数据源改为 `instances`（已添加的实例列表）
- [x] 10.3 选中实例后通过 `instance.catalog_id` 加载模型列表
- [x] 10.4 处理无实例状态（禁用选择器，提示去 Settings 添加）
- [x] 10.5 处理模型失效（当前 model 不在新模型列表中时清空并提示重选）

## 11. 前端 UI — Sidebar 适配

- [x] 11.1 更新 ChatSidebar 中 session 列表项的 provider 显示：从 instance_id 解析显示实例名

## 12. 清理和测试

- [x] 12.1 移除 `internal/store/sqlite/provider_keys.go`（废弃）— 保留文件以兼容旧数据，生产代码已不再引用
- [x] 12.2 移除前端 `setProviderKey` 相关代码和 `ProviderKeyStatus` 类型
- [x] 12.3 更新相关测试确保通过
- [ ] 12.4 手动端到端验证：添加实例 → 选实例 → 选模型 → 发消息 → 归档 → 切换 session
