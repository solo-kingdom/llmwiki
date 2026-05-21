# ingest-session-api Specification

## Purpose
Define HTTP APIs for ingest session lifecycle, chat messaging, provider/model configuration, and wiki-aware session chat.

## Requirements

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
The system SHALL assemble ingest session chat messages with a composed system prompt including workspace rules, fidelity constraints, related wiki subset index, and wiki grounding instructions.

#### Scenario: Session system prompt composition
- **WHEN** the API streams a chat reply for an ingest session
- **THEN** the system message SHALL be built via `ComposeSystemPrompt(session_chat, ctx)` with Chinese defaults when `doc_language=zh`
- **AND** the prompt SHALL instruct the model that valid grounds include user messages, attachment summaries, user `@` wiki page full text, and pages read via tools
- **AND** the prompt SHALL instruct the model not to invent wiki content for pages it has not read

#### Scenario: Related subset appended
- **WHEN** ContextResolver returns a non-empty subset for the turn
- **THEN** the assembled system message SHALL include the related wiki subset index section

#### Scenario: Attachment summary prompt language
- **WHEN** the system generates an attachment summary message
- **THEN** the user prompt SHALL be in the session's `doc_language` (Chinese for `zh`)
- **AND** it SHALL instruct summarizing only extracted attachment text without adding external information

### Requirement: Session message wiki refs
The system SHALL accept optional wiki page references when posting a session chat message.

#### Scenario: Post message with wiki refs
- **WHEN** client sends `POST /api/v1/ingest/sessions/{id}/messages` with body `{ content, wiki_refs: [{ document_id, relative_path }] }`
- **THEN** the system SHALL validate each ref resolves to an existing wiki document
- **AND** SHALL read full page content for each ref and inject it into the assembled user message context

#### Scenario: Invalid wiki ref rejected
- **WHEN** `wiki_refs` contains a document that does not exist or is not a wiki page
- **THEN** the system SHALL return HTTP 400 without creating a user message

#### Scenario: Wiki refs limit
- **WHEN** client sends more than 5 entries in `wiki_refs`
- **THEN** the system SHALL return HTTP 400

### Requirement: Session references list API
The system SHALL expose session-scoped wiki reference history.

#### Scenario: List session references
- **WHEN** client requests `GET /api/v1/ingest/sessions/{id}/references`
- **THEN** the system SHALL return `[{ document_id, relative_path, title, source, first_seen_at }, ...]` ordered by `first_seen_at`

### Requirement: Session chat tool loop
The system SHALL run a readonly tool-call loop for session chat replies before returning the final assistant message.

#### Scenario: Builtin tools always available
- **WHEN** streaming a chat reply and no external MCP chat servers are configured
- **THEN** the system SHALL still expose builtin `search`, `read`, and `references` tools to the model

#### Scenario: Optional external chat MCP
- **WHEN** MCP servers with `scope.chat=true` are enabled
- **THEN** the system SHALL merge their readonly allowed tools with builtin tools
- **AND** SHALL filter out write tools regardless of server `allow_write_tools`

#### Scenario: Tool loop limits
- **WHEN** session chat tool loop runs
- **THEN** the system SHALL enforce `max_rounds=4` and `max_tool_calls_per_round=4`

### Requirement: Session chat SSE tool events
The system SHALL emit SSE events for tool activity during session chat streaming.

#### Scenario: Tool start event
- **WHEN** the model requests a tool call during session chat
- **THEN** the SSE stream SHALL emit `event: tool_start` with tool name and truncated arguments before execution

#### Scenario: Tool done event
- **WHEN** tool execution completes
- **THEN** the SSE stream SHALL emit `event: tool_done` with tool name and success or error summary

### Requirement: Session message exclude from archive
The system SHALL allow marking session messages as excluded from archive and SHALL omit them when building archive transcripts.

#### Scenario: Patch message exclude flag
- **WHEN** client sends `PATCH /api/v1/ingest/sessions/{id}/messages/{messageId}` with `{ exclude_from_archive: true }`
- **THEN** the system SHALL persist the flag on that message
- **AND** return the updated message representation

#### Scenario: Archive omits excluded messages
- **WHEN** client posts archive for a session containing messages with `exclude_from_archive=true`
- **THEN** those messages SHALL NOT appear in the generated archive markdown transcript

### Requirement: Session archive idempotency
The system SHALL expose `POST /api/v1/ingest/sessions/{id}/archive` to freeze a session transcript into an ingest review without creating duplicate reviews on retry.

#### Scenario: Archive requires persisted user messages
- **WHEN** client posts archive for a session with zero persisted `role=user` messages
- **THEN** the API SHALL return 400 with an error indicating no user messages to archive

#### Scenario: Duplicate archive returns existing review
- **WHEN** client posts archive for a session that is already `archived` or has an active ingest review (`planning`, `ready_for_review`, `revising`, `approved`, `applying`)
- **THEN** the API SHALL return the existing `review_id` (HTTP 200) and SHALL NOT create a second ingest review row

#### Scenario: Archive failure leaves no orphan review
- **WHEN** archive fails after writing the archive markdown file or creating a review row (e.g. plan job enqueue failure)
- **THEN** the API SHALL roll back the review row and remove the archive file before returning an error
