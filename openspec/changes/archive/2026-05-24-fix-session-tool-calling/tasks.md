## Phase 1：止血 — OpenAI 兼容模式工具调用可靠性

### 1. ChatOptions 与 Chat 签名

- [x] 1.1 在 `internal/llm/tools.go` 新增 `ChatOptions` 结构体（`ToolChoice string`）
- [x] 1.2 修改 `Client.Chat()` 签名为 `opts ...ChatOptions` 可选参数，提取 `ToolChoice`
- [x] 1.3 修改 `llm/tools.go` 中 `RunToolLoop()` 的 `client.Chat()` 调用，传空 opts 保持兼容

### 2. buildChatBody 加 tool_choice

- [x] 2.1 `internal/llm/client.go` OpenAI default 分支的 `openaiReq` 结构体添加 `ToolChoice interface{}` JSON 字段
- [x] 2.2 `buildChatBody()` 签名接受 `toolChoice string` 参数
- [x] 2.3 当 `toolChoice != ""` 时设置 `req.ToolChoice`
- [x] 2.4 `Chat()` 方法将 `opts.ToolChoice` 传递给 `buildChatBody()`
- [x] 2.5 Anthropic/Ollama 分支的 `buildChatBody()` 忽略 toolChoice（Phase 3 处理）

### 3. 模式感知的 toolChoice 策略

- [x] 3.1 在 `internal/mcp/local_tools.go` 新增 `ToolChoiceForMode(mode string, round int) string`
- [x] 3.2 organize 模式 + round 0 返回 `"required"`，其余返回 `""`

### 4. Tool loop 重试机制

- [x] 4.1 修改 `internal/ingest/chat_wiki_executor.go` 的 `RunSessionChatToolLoop()` 签名，添加 `mode string` 参数
- [x] 4.2 在循环中调用 `mcp.ToolChoiceForMode(mode, round)` 获取 toolChoice
- [x] 4.3 将 toolChoice 传给 `client.Chat()` 的 `ChatOptions`
- [x] 4.4 organize 模式 round 0 无 tool_calls 时：追加 user 消息引导调用工具，重试 1 次
- [x] 4.5 `tool_choice="required"` 导致 API 400 时 fallback 不带 tool_choice 重试
- [x] 4.6 修改 `internal/api/ingest_session.go` 的 `streamAssistantReply()` 传入 `session.Mode`

### 5. organize prompt 强化

- [x] 5.1 修改 `internal/ingest/prompts.go` 中 `StepSessionOrganize` 的中英文 prompt
- [x] 5.2 将"使用 xxx 工具"改为明确的"必须先调用 xxx 工具"指令
- [x] 5.3 添加禁止在未调工具时直接回复的约束

### 6. workspace 日志

- [x] 6.1 在 `ComposeSystemPrompt()` 中添加 purpose.md 读取结果日志（`log.Printf`）
- [x] 6.2 workspace 为空时打印 WARNING 日志

### 7. Phase 1 测试

- [x] 7.1 单元测试：`ChatOptions{ToolChoice: "required"}` 正确序列化到 request body
- [x] 7.2 单元测试：`ToolChoiceForMode("organize", 0) == "required"`
- [x] 7.3 单元测试：`ToolChoiceForMode("organize", 1) == ""`
- [x] 7.4 单元测试：organize 模式 round 0 无 tool_calls 时触发重试
- [x] 7.5 运行 `go test ./internal/llm/... ./internal/ingest/... ./internal/mcp/...`

## Phase 2：加固 — 多轮对话健壮性

### 8. Message 结构体扩展

- [x] 8.1 `internal/llm/client.go` 的 `Message` 结构体添加 `ToolCalls []ToolCall` JSON 字段
- [x] 8.2 `RunSessionChatToolLoop()` 回传 assistant 消息时携带 `ToolCalls: result.ToolCalls`
- [x] 8.3 `llm/tools.go` 的 `RunToolLoop()` 同步携带 `ToolCalls`

### 9. Phase 2 测试

- [x] 9.1 单元测试：assistant 消息 JSON 序列化包含 `tool_calls` 数组
- [x] 9.2 运行 `go test ./internal/llm/... ./internal/ingest/...`

## Phase 3：扩展 — Anthropic/Ollama 工具支持

### 10. Anthropic buildChatBody 工具支持

- [x] 10.1 `anthropicReq` 结构体添加 `System string`、`Tools []anthropicTool`、`ToolChoice interface{}`
- [x] 10.2 从 messages 中提取 `role: "system"` 消息到顶层 `system` 字段
- [x] 10.3 将 `tools []ToolDefinition` 转换为 Anthropic 格式（`name`、`description`、`input_schema`）
- [x] 10.4 支持 `tool_choice: {type: "any"}` （对应 `tool_choice: "required"`）

### 11. Anthropic parseChatResponse 工具解析

- [x] 11.1 Anthropic 分支解析 `content` 数组中的 `tool_use` blocks
- [x] 11.2 将 `tool_use` 转换为 `ToolCall`（`id` → `ID`，`name` → `Name`，`input` JSON → `Arguments`）

### 12. Anthropic 多轮对话适配

- [x] 12.1 `role: "tool"` 消息转换为 Anthropic 格式：`role: "user"` + `content: [{type: "tool_result", tool_use_id, content}]`
- [x] 12.2 assistant 消息中 `ToolCalls` 转换为 Anthropic 格式：`content: [{type: "tool_use", id, name, input}]`

### 13. Ollama tool calling（可选）

- [x] 13.1 确认 Ollama `/api/chat` 是否支持 tools 参数
- [x] 13.2 如支持，添加 `ollamaReq` 的 `Tools` 字段和响应解析

### 14. Phase 3 测试

- [x] 14.1 单元测试：Anthropic `buildChatBody` 包含 tools 和 system
- [x] 14.2 单元测试：Anthropic `parseChatResponse` 正确解析 tool_use
- [x] 14.3 单元测试：Anthropic 多轮 tool 消息格式正确
- [x] 14.4 运行 `go test ./internal/llm/...`
