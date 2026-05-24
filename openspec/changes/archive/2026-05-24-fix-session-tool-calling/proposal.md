## Why

Session chat 的 organize/QA 模式下，LLM 收到了工具定义（audit、structure、gaps、similar 等）但不调用它们，直接以文字回复向用户索要 wiki 信息。用户发出"重新整理下 wiki 文档"后得到的回复是"请提供 wiki 信息"，而不是自动运行诊断工具。

根因分析揭示三个层面的问题：

1. **无 `tool_choice` 参数**：OpenAI 兼容 API 的 `tool_choice` 字段完全未使用，模型默认 `auto` 模式下可自由选择不调工具。对于 organize 模式，第一轮应强制调用。
2. **Anthropic/Ollama 工具支持缺失**：`buildChatBody()` 对 Anthropic 和 Ollama 的请求体不包含 `tools` 字段，`parseChatResponse()` 也不解析 `tool_calls`。工具被静默丢弃。
3. **Prompt 指令强度不足**：organize 模式的 system prompt 仅"建议"使用工具，弱模型容易忽略。

此外还发现多轮 tool loop 中 assistant 消息缺少 `ToolCalls` 字段，影响上下文连贯性。

## What Changes

### Phase 1：止血（OpenAI 兼容立即能工作）

- `Chat()` 方法接受可选 `toolChoice` 参数
- `buildChatBody()` OpenAI 分支添加 `tool_choice` 字段
- organize 模式第一轮使用 `tool_choice: "required"` 强制调用工具
- tool loop 添加重试：organize 模式第一轮未调工具时追加提示重试
- organize 模式 prompt 强化，明确要求先调工具再回复

### Phase 2：加固（多轮对话健壮性）

- `Message` 结构体添加 `ToolCalls []ToolCall` 字段
- tool loop 回传 assistant 消息时携带 `ToolCalls`
- 同步修改 `llm/tools.go` 中的 `RunToolLoop`

### Phase 3：扩展（Anthropic/Ollama 工具支持）

- Anthropic `buildChatBody()` 添加 `system` 顶层字段、`tools`、`tool_choice`
- Anthropic `parseChatResponse()` 解析 `tool_use` content blocks
- Ollama tool calling 支持（如 Ollama 支持）

## Scope

### In Scope

- `internal/llm/client.go`：Message 结构体、Chat 签名、buildChatBody、parseChatResponse
- `internal/llm/tools.go`：ChatOptions、RunToolLoop 同步改
- `internal/ingest/chat_wiki_executor.go`：tool loop 策略
- `internal/ingest/prompts.go`：organize 模式 prompt 强化
- `internal/mcp/local_tools.go`：ToolChoiceForMode 函数

### Out of Scope

- Web UI 改动
- 新增工具定义
- MCP server tool calling（仅影响 session chat tool loop）
- purpose.md 读取路径调试（仅加日志排查）

## Capabilities

### Modified Capabilities

- `llm-integration`：Chat API 支持 tool_choice 参数、Anthropic/Ollama 工具支持
- `mcp-server`：session chat tool loop 策略优化

## Impact

- **Backend**：`internal/llm/`、`internal/ingest/`、`internal/mcp/`
- **Frontend**：无改动
- **Data**：无数据格式变化
- **API**：无外部 API 变化（内部 Chat 签名变化，使用可选参数向后兼容）

## Dependencies

- 无前置依赖，可独立实施
