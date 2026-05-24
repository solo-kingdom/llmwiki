## Why

Chat Session 中 AI 回复的内容依赖于复杂的 prompt 组装流程（system prompt 拼接 workspace 规则文件、历史消息截断、wiki context 注入、tool loop 多轮调用）。当 AI 回复不符合预期时（如声称 purpose.md "只有标题和占位符"，实际是因为 `maxWorkspaceRuleFileLen = 1500` 截断了内容），用户和开发者都没有任何手段排查"LLM 到底收到了什么"。

现有 Ingest Job 已有完善的调试能力（`ingest_job_events` 表 + `JobLogDialog` UI），但 Chat Session 完全没有等价的事件记录。

## What Changes

### 1. Chat Message Debug 事件系统

为每条 assistant 消息记录完整的 prompt 构建过程，包括：
- System prompt 组装结果（含各组成部分、截断状态）
- 每轮 LLM 请求的完整 messages 数组
- 每轮 LLM 响应（content + tool_calls）
- 每次工具调用的参数和返回结果

数据模型复用 `ingest_job_events` 的 (step, phase, message, payload) 模式，新建 `session_message_events` 表按 message_id 组织。

### 2. UI 调试弹窗

在每条 assistant 消息的 hover action bar 中添加 Debug 按钮（Bug 图标），点击后弹出 `MessageDebugDialog`：
- 左侧：事件列表（system_prompt / round_N llm_request / llm_response / tool_result）
- 右侧：选中事件的 payload JSON 展示
- UI 结构复用现有 `JobLogDialog`

### 3. 提升 Workspace 规则文件长度限制

将 `maxWorkspaceRuleFileLen` 从 1500 提升到 5000 字符，减少无意的截断。此修改独立于 debug 功能，但正是 debug 功能能帮助发现这类问题。

## Scope

### In Scope

- 新建 `session_message_events` 表 + CRUD 方法
- 在 `streamAssistantReply` 和 `RunSessionChatToolLoop` 中埋入事件记录
- 新增 API `GET /api/v1/ingest/sessions/{sid}/messages/{mid}/events`
- 新增 `MessageDebugDialog` 组件
- 修改 `MessageBubble` 添加 Debug 按钮
- 提升 `maxWorkspaceRuleFileLen` 从 1500 → 5000
- 新增配置项 `session_message_events_max_count`（默认 100）
- Settings API 支持新配置项的读写

### Out of Scope

- 前端 SSE 实时推送 debug 事件（用按需查询即可）
- User message 的 debug（只有 assistant 消息需要 debug）
- Export debug events 为文件
- Debug 事件的搜索/过滤功能
- 非 chat 模式的 debug（ingest job 已有 `JobLogDialog`）

## Capabilities

### Modified Capabilities

- `ingest-chat-ui`：MessageBubble 新增 Debug 按钮 + MessageDebugDialog 弹窗
- `ingest-pipeline`：prompt 组装和 tool loop 增加事件记录点
- `workspace-management`：提升 purpose.md / rules.md 的读取长度限制

## Impact

- **Backend**：`internal/store/sqlite/`（新表 + 迁移）、`internal/api/ingest_session.go`（埋点 + 新 API handler）、`internal/ingest/`（传入 recorder）
- **Frontend**：`web/src/components/`（新组件 + 修改 MessageBubble）、`web/src/lib/api.ts`（新 API）、`web/src/types.ts`（新类型）、`web/src/i18n/`（新文案）
- **Data**：新表 `session_message_events`，零迁移风险
- **API**：新增 1 个只读 GET endpoint

## Dependencies

- 无外部依赖
- 与 `parallel-job-execution` change 无交叉
