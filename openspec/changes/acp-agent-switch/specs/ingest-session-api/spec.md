## MODIFIED Requirements

### Requirement: Session provider/model 字段
Ingest session 记录 SHALL 包含 `llm_instance_id`、`llm_model`、`agent_kind` 与 `acp_agent_id` 字段。`agent_kind` 的取值域 SHALL 为 `native` 与 `acp`，默认 `native`；`llm_instance_id` 与 `llm_model` 仅在 `agent_kind` 为 `native` 时参与请求执行，但在 `acp` 模式下 SHALL 被保留不清空。

#### Scenario: 创建 session 带 provider/model
- **WHEN** 客户端发送 `POST /api/v1/ingest/sessions` 且 body 包含 `instance_id` 和/或 `model`
- **THEN** 系统 SHALL 将这些值存入 session 记录的 `llm_instance_id` 和 `llm_model` 字段

#### Scenario: 创建 session 继承全局默认
- **WHEN** 客户端发送 `POST /api/v1/ingest/sessions` 且 body 不包含 `instance_id` 和 `model`
- **THEN** 系统 SHALL 从 `app_config` 表读取 `last_instance_id` 和 `last_model` 填入 session 记录

#### Scenario: 创建 session 无默认值
- **WHEN** `app_config` 中无 `last_instance_id` 且请求也未指定
- **THEN** 系统 SHALL 创建 session 但 `llm_instance_id` 和 `llm_model` 为空字符串

#### Scenario: 创建 session 带 agent runtime
- **WHEN** 客户端发送 `POST /api/v1/ingest/sessions` 且 body 包含 `agent_kind` 和/或 `acp_agent_id`
- **THEN** 系统 SHALL 将这些值存入 session 记录的 `agent_kind` 与 `acp_agent_id`
- **AND** `agent_kind` 为 `acp` 但 `acp_agent_id` 为空或未在 `acp_agents_json` 中定义时 SHALL 返回 HTTP 400

#### Scenario: 创建 session 继承默认 runtime
- **WHEN** 客户端发送 `POST /api/v1/ingest/sessions` 且 body 不包含 `agent_kind`
- **THEN** 系统 SHALL 从 `app_config` 读取 `default_agent_kind` 与 `default_acp_agent_id` 填入 session
- **AND** `default_agent_kind` 缺失或为空时 SHALL 使用 `native`

### Requirement: Session 列表 API
系统 SHALL 暴露 `GET /api/v1/ingest/sessions` 端点返回 session 列表。

#### Scenario: 返回 session 列表
- **WHEN** 客户端请求 `GET /api/v1/ingest/sessions`
- **THEN** 系统 SHALL 返回 `[{id, title, status, llm_instance_id, llm_model, mode, agent_kind, acp_agent_id, created_at, updated_at}, ...]`，按 `updated_at` 降序排列

#### Scenario: 历史 session 默认 native
- **WHEN** 列表中包含本变更前创建的 session
- **THEN** 这些 session 的 `agent_kind` SHALL 为 `native`，`acp_agent_id` SHALL 为空字符串

### Requirement: Session provider/model 更新 API
系统 SHALL 暴露 `PATCH /api/v1/ingest/sessions/{id}` 端点更新 session 的 provider/model 配置、标题、mode 与 agent runtime。

#### Scenario: 更新 provider/model
- **WHEN** 客户端发送 `PATCH /api/v1/ingest/sessions/{id}` 且 body 包含 `instance_id` 和/或 `model`
- **THEN** 系统 SHALL 更新 session 的 `llm_instance_id` 和/或 `llm_model` 字段

#### Scenario: 更新同时记录最近使用
- **WHEN** `instance_id` 或 `model` 被更新
- **THEN** 系统 SHALL 同时更新 `app_config` 表的 `last_instance_id` 和 `last_model` 为新值

#### Scenario: 更新标题
- **WHEN** body 包含 `title`
- **THEN** 系统 SHALL 更新 session 的标题

#### Scenario: Session 不存在
- **WHEN** 请求的 session id 不存在
- **THEN** 系统 SHALL 返回 HTTP 404

#### Scenario: 切换 agent runtime
- **WHEN** 客户端发送 `PATCH /api/v1/ingest/sessions/{id}` 且 body 包含 `agent_kind`
- **THEN** 系统 SHALL 更新 session 的 `agent_kind` 与 `acp_agent_id`
- **AND** SHALL 同时把新值写入 `app_config` 的 `default_agent_kind` 与 `default_acp_agent_id` 作为最近使用
- **AND** SHALL NOT 清空 `llm_instance_id` 与 `llm_model`

#### Scenario: 非法 agent_kind
- **WHEN** `agent_kind` 不是 `native` 或 `acp`
- **THEN** 系统 SHALL 返回 HTTP 400

#### Scenario: 切到 ACP 但 agent 无效
- **WHEN** `agent_kind` 为 `acp` 且 `acp_agent_id` 为空、未在配置中定义、或对应 agent `enabled` 为 false
- **THEN** 系统 SHALL 返回 HTTP 400 且 SHALL NOT 修改 session

#### Scenario: 流式进行中禁止切换
- **WHEN** 该 session 存在 `stream_status='streaming'` 的 assistant 消息且请求包含 `agent_kind`
- **THEN** 系统 SHALL 返回 HTTP 409

#### Scenario: 已归档 session 禁止切换
- **WHEN** 该 session 的 `status` 为 `archived` 且请求包含 `agent_kind`
- **THEN** 系统 SHALL 返回 HTTP 409

### Requirement: Session chat tool loop
The system SHALL run a readonly tool-call loop for session chat replies before returning the final assistant message when the session's agent runtime is `native`. When the runtime is `acp`, tool selection and execution SHALL be owned by the external agent and the system SHALL NOT assemble llmwiki tool definitions.

#### Scenario: Builtin tools always available
- **WHEN** streaming a chat reply for a `native` session and no external MCP chat servers are configured
- **THEN** the system SHALL still expose builtin `search`, `read`, and `references` tools to the model

#### Scenario: Optional external chat MCP
- **WHEN** MCP servers with `scope.chat=true` are enabled and the session runtime is `native`
- **THEN** the system SHALL merge their readonly allowed tools with builtin tools
- **AND** SHALL filter out write tools regardless of server `allow_write_tools`

#### Scenario: Tool loop limits
- **WHEN** a `native` session chat tool loop runs
- **THEN** the system SHALL enforce the configured `max_rounds` and `max_tool_calls_per_round`

#### Scenario: ACP session has no llmwiki tool loop
- **WHEN** streaming a chat reply for an `acp` session
- **THEN** the system SHALL NOT call `ingest.RunSessionChatToolLoop`
- **AND** SHALL NOT pass `mcpServers` to the agent in `session/new`
- **AND** the tool-loop round and call limits SHALL NOT apply

### Requirement: Session chat SSE tool events
The system SHALL emit SSE events for tool activity during session chat streaming, using the same event names and payload shape for both `native` and `acp` runtimes.

#### Scenario: Tool start event
- **WHEN** a tool call begins during session chat (model-requested in `native`, or reported via ACP `tool_call` update in `acp`)
- **THEN** the SSE stream SHALL emit `event: tool_start` with `{tool, detail}` where `detail` is truncated

#### Scenario: Tool done event
- **WHEN** tool execution completes (in `acp`, when a `tool_call_update` reports status `completed` or `failed`)
- **THEN** the SSE stream SHALL emit `event: tool_done` with `{tool, detail}` carrying a success or error summary

#### Scenario: Non-terminal ACP tool status not emitted as done
- **WHEN** an ACP `tool_call_update` reports a status other than `completed` or `failed`
- **THEN** the system SHALL NOT emit `tool_done`
- **AND** SHALL still persist the update as a session message event

## ADDED Requirements

### Requirement: ACP turn 流式事件契约
ACP session 的一次 turn SHALL 通过既有 SSE 端点 `POST /api/v1/ingest/sessions/{id}/messages?stream=1` 输出，事件词表在既有 `user_message`、`assistant_start`、`token`、`tool_start`、`tool_done`、`warning`、`error`、`done` 之上 SHALL 新增 `thought`、`plan`、`permission`。既有事件的名称与载荷字段 SHALL NOT 变更。

#### Scenario: 复用既有流式端点
- **WHEN** ACP session 发送消息
- **THEN** 系统 SHALL 使用现有 `POST /api/v1/ingest/sessions/{id}/messages` 端点与 SSE 协议
- **AND** SHALL NOT 新增专用于 ACP 的流式端点

#### Scenario: agent 正文映射为 token
- **WHEN** 收到 `session/update` 且 `sessionUpdate` 为 `agent_message_chunk` 且内容块类型为 `text`
- **THEN** 系统 SHALL 发出 `event: token` 且载荷为 `{content}`
- **AND** SHALL 按与 native 相同的节流规则把累积正文写入 `ingest_session_messages.content`

#### Scenario: agent 思考映射为 thought
- **WHEN** 收到 `agent_thought_chunk`
- **THEN** 系统 SHALL 发出 `event: thought`
- **AND** SHALL NOT 把该内容写入 `ingest_session_messages.content`

#### Scenario: plan 映射为 plan 事件
- **WHEN** 收到 `plan` 更新
- **THEN** 系统 SHALL 发出 `event: plan`，载荷含条目内容、优先级与状态

#### Scenario: 权限决策映射为 permission 事件
- **WHEN** 系统对 `session/request_permission` 作出决策
- **THEN** 系统 SHALL 发出 `event: permission`，载荷含工具类别、是否允许与理由，且 SHALL NOT 含凭据

#### Scenario: 不支持的内容块降级为 warning
- **WHEN** `agent_message_chunk` 的内容块类型不是 `text`
- **THEN** 系统 SHALL 发出 `event: warning` 且 `code` 为 `acp_unsupported_content`
- **AND** SHALL NOT 把该内容写入正文

#### Scenario: 旧前端兼容
- **WHEN** 未识别 `thought`、`plan`、`permission` 的客户端接收 ACP 流
- **THEN** 这些事件 SHALL 可被安全忽略
- **AND** 正文仍 SHALL 通过 `token` 与 `done` 完整送达

### Requirement: ACP turn 持久化与刷新可见性
ACP turn 的产出 SHALL 全部落入既有真相源：正文进 `ingest_session_messages`，其余进 `session_message_events`。系统 SHALL NOT 为 ACP 新建会话表或第二套会话真相源。

#### Scenario: 正文可在刷新后读取
- **WHEN** ACP turn 完成后客户端请求 `GET /api/v1/ingest/sessions/{id}/messages`
- **THEN** 响应 SHALL 包含完整的 assistant 正文与最终 `stream_status`

#### Scenario: 思考、工具、计划、权限可在刷新后读取
- **WHEN** 客户端请求 `GET /api/v1/ingest/sessions/{id}/messages/{messageId}/events`
- **THEN** 响应 SHALL 包含该 turn 的 thought、tool call、plan、权限决策与 stop reason 事件

#### Scenario: 不新建会话表
- **WHEN** 检查数据库 schema
- **THEN** 除 `ingest_sessions` 新增两列外 SHALL NOT 出现新的 ACP 会话或消息表

#### Scenario: 归档产物与 native 同构
- **WHEN** ACP session 被归档
- **THEN** 生成的 archive markdown SHALL 只包含 `ingest_session_messages` 中未被排除的消息
- **AND** SHALL NOT 包含 thought、tool call 或 plan 内容
- **AND** 后续 review、plan、apply 链路 SHALL 无需感知 agent runtime

### Requirement: ACP turn 的 stop reason 与流状态映射
系统 SHALL 把 ACP 的 `stopReason` 映射为 `ingest_session_messages.stream_status`，取值仍限于既有 `streaming`、`complete`、`incomplete`、`failed`。

#### Scenario: 正常结束
- **WHEN** `stopReason` 为 `end_turn`、`max_tokens` 或 `max_turn_requests` 且正文非空
- **THEN** `stream_status` SHALL 为 `complete`

#### Scenario: 被取消
- **WHEN** `stopReason` 为 `cancelled`
- **THEN** `stream_status` SHALL 为 `incomplete`
- **AND** 已产生的部分正文 SHALL 被保留

#### Scenario: 被拒绝
- **WHEN** `stopReason` 为 `refusal`
- **THEN** `stream_status` SHALL 为 `failed`

#### Scenario: 空正文视为失败
- **WHEN** turn 结束但正文为空
- **THEN** `stream_status` SHALL 为 `failed`
- **AND** 系统 SHALL 发出 `event: error` 说明未获得回复

#### Scenario: 失败消息可重试
- **WHEN** ACP turn 以 `failed` 或 `incomplete` 结束
- **THEN** `POST /api/v1/ingest/sessions/{id}/messages/{messageId}/retry` SHALL 可用
- **AND** 重试 SHALL 使用该 session 当前的 agent runtime

### Requirement: ACP 就绪性错误不复用 provider 文案
当 session 的 runtime 为 `acp` 且无法执行 turn 时，系统 SHALL 返回针对 ACP 的错误说明，SHALL NOT 返回与 provider 实例或 API Key 相关的文案。

#### Scenario: 未选择 ACP agent
- **WHEN** `agent_kind` 为 `acp` 但 `acp_agent_id` 为空
- **THEN** 系统 SHALL 返回 HTTP 400 且消息指引前往 Settings 配置并选择 ACP Agent

#### Scenario: agent 已禁用
- **WHEN** 选中的 agent 的 `enabled` 为 false
- **THEN** 系统 SHALL 返回 HTTP 400 且消息说明该 agent 已禁用

#### Scenario: CLI 未安装
- **WHEN** 选中 agent 的 `command` 在 PATH 中不存在
- **THEN** 系统 SHALL 返回 HTTP 400 且消息说明命令未找到并提示确认安装与 PATH

#### Scenario: 无 provider instance 也不影响 ACP
- **WHEN** 系统中不存在任何 provider instance，且 ACP session 发送消息
- **THEN** 错误响应（若有）SHALL NOT 提及 Provider 实例、Model 或 API Key
- **AND** agent 可用时该 turn SHALL 正常执行

#### Scenario: 配置非法
- **WHEN** `acp_agents_json` 无法解析
- **THEN** 系统 SHALL 返回 HTTP 400 且消息 SHALL 含出错字段的 JSON path
