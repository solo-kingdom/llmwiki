## ADDED Requirements

### Requirement: Session provider/model 字段
Ingest session 记录 SHALL 包含 `llm_provider` 和 `llm_model` 字段，用于独立配置每个 session 使用的 LLM。

#### Scenario: 创建 session 带 provider/model
- **WHEN** 客户端发送 `POST /api/v1/ingest/sessions` 且 body 包含 `provider` 和/或 `model`
- **THEN** 系统 SHALL 将这些值存入 session 记录的 `llm_provider` 和 `llm_model` 字段

#### Scenario: 创建 session 继承全局默认
- **WHEN** 客户端发送 `POST /api/v1/ingest/sessions` 且 body 不包含 `provider` 和 `model`
- **THEN** 系统 SHALL 从 `app_config` 表读取 `last_provider` 和 `last_model` 填入 session 记录

#### Scenario: 创建 session 无默认值
- **WHEN** `app_config` 中无 `last_provider` 且请求也未指定
- **THEN** 系统 SHALL 创建 session 但 `llm_provider` 和 `llm_model` 为空字符串

### Requirement: Session 列表 API
系统 SHALL 暴露 `GET /api/v1/ingest/sessions` 端点返回 session 列表。

#### Scenario: 返回 session 列表
- **WHEN** 客户端请求 `GET /api/v1/ingest/sessions`
- **THEN** 系统 SHALL 返回 `[{id, title, status, llm_provider, llm_model, created_at, updated_at}, ...]`，按 `updated_at` 降序排列

### Requirement: Session provider/model 更新 API
系统 SHALL 暴露 `PATCH /api/v1/ingest/sessions/{id}` 端点更新 session 的 provider/model 配置。

#### Scenario: 更新 provider/model
- **WHEN** 客户端发送 `PATCH /api/v1/ingest/sessions/{id}` 且 body 包含 `provider` 和/或 `model`
- **THEN** 系统 SHALL 更新 session 的 `llm_provider` 和/或 `llm_model` 字段

#### Scenario: 更新同时记录最近使用
- **WHEN** provider 或 model 被更新
- **THEN** 系统 SHALL 同时更新 `app_config` 表的 `last_provider` 和 `last_model` 为新值

#### Scenario: 更新标题
- **WHEN** body 包含 `title`
- **THEN** 系统 SHALL 更新 session 的标题

#### Scenario: Session 不存在
- **WHEN** 请求的 session id 不存在
- **THEN** 系统 SHALL 返回 HTTP 404

### Requirement: Settings 持久化到 SQLite
系统 SHALL 将所有 Settings 数据持久化到 SQLite `app_config` 表，替代内存存储。

#### Scenario: 读取 Settings
- **WHEN** 客户端请求 `GET /api/v1/settings`
- **THEN** 系统 SHALL 从 `app_config` 表读取所有配置值，从 `provider_keys` 表读取所有 provider Key 状态

#### Scenario: 更新通用 Settings
- **WHEN** 客户端发送 `PUT /api/v1/settings` 且 body 包含通用配置（temperature, max_tokens, chunk_size 等）
- **THEN** 系统 SHALL 更新 `app_config` 表中对应的键值

#### Scenario: 更新最近使用
- **WHEN** 客户端发送 `PUT /api/v1/settings/last-model` 且 body 包含 `{provider, model}`
- **THEN** 系统 SHALL 更新 `app_config` 表的 `last_provider` 和 `last_model`

### Requirement: 旧配置迁移
系统 SHALL 在启动时检测并迁移 `.llmwiki/config.json` 中的旧配置到 SQLite。

#### Scenario: 自动迁移
- **WHEN** 服务启动时检测到 `.llmwiki/config.json` 存在且 `provider_keys` 表为空
- **THEN** 系统 SHALL 将 JSON 中的 provider/APIKey/model 迁移到对应的 SQLite 表，并在迁移成功后不删除原文件（但不再读取）

#### Scenario: 已迁移则跳过
- **WHEN** SQLite 中已有配置数据
- **THEN** 系统 SHALL 忽略 `.llmwiki/config.json` 文件

### Requirement: Session chat LLM assembly
The system SHALL assemble ingest session chat messages with a composed system prompt including workspace rules and fidelity constraints.

#### Scenario: Session system prompt composition
- **WHEN** the API streams a chat reply for an ingest session
- **THEN** the system message SHALL be built via `ComposeSystemPrompt(session_chat, ctx)` with Chinese defaults when `doc_language=zh`
- **AND** the prompt SHALL instruct the model not to invent facts beyond user messages and attachment summaries

#### Scenario: Attachment summary prompt language
- **WHEN** the system generates an attachment summary message
- **THEN** the user prompt SHALL be in the session's `doc_language` (Chinese for `zh`)
- **AND** it SHALL instruct summarizing only extracted attachment text without adding external information
