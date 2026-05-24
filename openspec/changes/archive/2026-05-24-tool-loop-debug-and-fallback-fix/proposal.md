## Why

Chat Session 的 tool loop（多轮工具调用循环）在第二轮（Round 1）偶尔失败，触发 fallback 到 `streamSessionChatDirect`。Fallback 路径将包含 `role: "tool"` 消息和 `tool_calls` 字段的历史消息原封不动地发送给 `StreamChat`（不带 tools 参数），导致：

1. LLM 看到悬空的 tool 消息但没有 tools 定义，行为不可预测
2. 某些模型（如 GLM-4.7）在 system prompt 提到工具时，会在文本内容中写出伪工具调用（`tool_call(structure, {})`），直接显示在用户气泡中
3. 用户体验极差：看到 `tool_call(...)` 原文而非正常回复

同时，Round 1 失败的**根因**无法排查——`client.Chat()` 返回的 error 只被 `log.Printf` 写到 Go 标准日志（stderr），不在用户可见的结构化日志中，也不在 MessageDebugDialog 中。Debug Dialog 只记录到 `round_1/llm_request`，缺失 `llm_response`，无法判断是 API 错误、网络超时还是其他原因。

## What Changes

### 1. Tool loop 错误记录到 Debug 事件

在 `RunSessionChatToolLoop` 中，当 `client.Chat()` 返回 error 时，记录一个 `llm_error` 事件到 `session_message_events`，包含：
- 错误消息全文
- HTTP 状态码（如果是 API 错误）
- API 响应体前 500 字符

这样用户在 MessageDebugDialog 中就能看到 Round 1 为什么失败了，不需要去翻服务器日志。

### 2. Fallback 路径清洗 tool 消息

在 `streamSessionChatDirect` 被调用前，从 `msgs` 中移除：
- 所有 `role: "tool"` 的消息
- assistant 消息中的 `ToolCalls` 字段（保留 content）

清洗后，LLM 在 fallback 中看到的是一个正常的多轮对话（system + user + assistant），不会再产生伪工具调用文本。

### 3. Fallback 事件记录到 Debug

当前 fallback 路径 (`streamSessionChatDirect`) 没有记录任何 debug 事件。应该记录一个 `fallback` 事件，说明触发了 fallback 及原因（tool loop 的错误信息），让用户在 Debug Dialog 中能看到完整的事故链。

## Scope

### In Scope

- `RunSessionChatToolLoop` 中记录 `llm_error` 事件
- `streamAssistantReply` 中 fallback 前清洗 `msgs`（移除 tool 消息和 tool_calls）
- `streamSessionChatDirect` 记录 `fallback` 事件到 debug recorder
- 对应单元测试

### Out of Scope

- 修复 Round 1 失败的根因（需要先有错误日志才能诊断）
- 前端 UI 变更（MessageDebugDialog 已能展示任意事件）
- 新的 API endpoint

## Capabilities

### Modified Capabilities

- `ingest-pipeline`：tool loop 错误记录 + fallback 消息清洗 + fallback 事件记录

## Impact

- **Backend**：`internal/ingest/chat_wiki_executor.go`（llm_error 事件）、`internal/api/ingest_session.go`（fallback 清洗 + fallback 事件）
- **Data**：`session_message_events` 表新增 `llm_error` 和 `fallback` 两种事件类型（无 schema 变更）
- **Frontend**：无变更（MessageDebugDialog 已支持任意事件类型）

## Dependencies

- 无外部依赖
- 依赖已完成的 `add-chat-message-debug` change（Debug 事件系统 + MessageDebugDialog）
