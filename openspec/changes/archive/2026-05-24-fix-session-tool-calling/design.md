## Context

Session chat tool loop 的调用链路：

```
API: streamAssistantReply()
  → AssembleIngestChatMessages()     // 构建 system + history + user messages
  → ChatWikiExecutor.ListTools()     // 获取模式对应的工具定义
  → RunSessionChatToolLoop()         // 工具循环
      → client.Chat(msgs, tools)     // 调用 LLM（非 streaming）
          → buildChatBody()          // 构建 HTTP request body
          → parseChatResponse()      // 解析 HTTP response
      → executor.Execute()           // 执行工具
      → 循环直到无 tool_calls
```

当前 `buildChatBody()` 对三种 provider 的处理：

| Provider | tools 传入 | tool_choice | system 消息 | tool_calls 解析 |
|----------|-----------|-------------|------------|----------------|
| OpenAI (default) | ✅ | ❌ 缺失 | ✅ messages 中 | ✅ |
| Anthropic | ❌ 丢弃 | ❌ 缺失 | ❌ 应为顶层 system | ❌ 不解析 |
| Ollama | ❌ 丢弃 | ❌ 缺失 | ✅ messages 中 | ❌ 不解析 |

当前 `Message` 结构体缺少 `ToolCalls` 字段，导致多轮 tool loop 回传 assistant 消息时丢失工具调用记录。

## Goals / Non-Goals

**Goals:**

- organize 模式下 LLM 必须在首轮调用至少一个诊断工具
- OpenAI 兼容 provider 的 `tool_choice` 参数可用
- Anthropic provider 完整支持 tool calling
- 多轮 tool loop 的 assistant 消息正确携带 ToolCalls
- 弱模型有重试机制确保工具被调用

**Non-Goals:**

- 流式 tool calling（当前 session chat 使用非流式 Chat + 模拟流式输出）
- 自动选择最优工具（仅强制"至少调用一个"）
- Ollama tool calling 完整验证（Ollama 的工具支持取决于模型和版本）

## Decisions

### Decision 1: ChatOptions 可选参数设计

使用 Go 可选参数模式，向后兼容现有调用方：

```go
// llm/tools.go
type ChatOptions struct {
    ToolChoice string // "" | "auto" | "required" | "none"
}

// Chat 签名保持兼容
func (c *Client) Chat(ctx context.Context, messages []Message,
    tools []ToolDefinition, temperature float64, maxTokens int,
    opts ...ChatOptions) (ChatResult, error)
```

所有现有调用方无需修改（`opts` 为可选）。新代码可传 `ChatOptions{ToolChoice: "required"}`。

### Decision 2: tool_choice 策略

```go
// mcp/local_tools.go
func ToolChoiceForMode(mode string, round int) string {
    switch {
    case mode == "organize" && round == 0:
        return "required"
    case mode == "qa" && round == 0:
        return "auto"  // QA 模式不强求，但 prompt 引导
    default:
        return "auto"
    }
}
```

organize 模式首轮强制 `required`，后续轮次 `auto`。如果 API 返回 400（不支持 tool_choice），fallback 到不带 tool_choice 重试。

### Decision 3: Tool loop 重试机制

```
Round 0 (organize):
  Chat(tools, tool_choice="required")
  → 有 tool_calls → 正常执行 → continue
  → 无 tool_calls → 追加 user 消息 "请先调用 structure 和 audit 工具"
                    → 重试 Round 0（无 tool_choice）
  → API 400 → fallback 不带 tool_choice 重试
```

最多重试 1 次，避免无限循环。

### Decision 4: Anthropic tool calling 适配

Anthropic Messages API 与 OpenAI 的关键差异：

| 方面 | OpenAI | Anthropic |
|------|--------|-----------|
| 系统消息 | `messages: [{role: "system"}]` | 顶层 `system` 字段 |
| 工具定义 | `tools: [{type: "function", function: {...}}]` | `tools: [{name, description, input_schema}]` |
| 工具选择 | `tool_choice: "required"` | `tool_choice: {type: "any"}` |
| 工具调用 | `tool_calls: [{id, function: {name, arguments}}]` | `content: [{type: "tool_use", id, name, input}]` |
| 工具结果 | `{role: "tool", tool_call_id, content}` | `{role: "user", content: [{type: "tool_result", tool_use_id, content}]}` |

需要在 `buildChatBody` 和 `parseChatResponse` 中完全适配这些差异。

### Decision 5: Message 结构体扩展

```go
type Message struct {
    Role       string     `json:"role"`
    Content    string     `json:"content,omitempty"`
    ToolCallID string     `json:"tool_call_id,omitempty"`
    Name       string     `json:"name,omitempty"`
    ToolCalls  []ToolCall `json:"tool_calls,omitempty"` // 新增
}
```

OpenAI 多轮对话规范要求 assistant 消息携带 `tool_calls` 数组，后跟 tool result 消息。缺少此字段时部分模型会混淆上下文。

### Decision 6: organize prompt 强化

将当前的"建议使用"改为"必须先使用"：

```
⚠️ 工作流程（必须遵守）：
1. 收到请求后，先调用 structure 工具获取 wiki 目录结构
2. 然后调用 audit 工具获取健康诊断
3. 用 read 工具深入阅读具体页面
4. 基于工具返回的数据给出具体、可操作的重组方案

禁止在未调用任何工具的情况下直接回复。
```

## Risks

| 风险 | 概率 | 缓解 |
|------|------|------|
| `tool_choice="required"` 某些 OpenAI 兼容 API 不支持 | 中 | 加 fallback：API 返回 400 时去掉 tool_choice 重试 |
| Chat() 签名改动影响下游 | 低 | 使用 `...ChatOptions` 可选参数，现有调用无需修改 |
| Anthropic tool calling 适配工作量大 | 中 | Phase 3 独立实施，有充分测试时间 |
| prompt 过强导致模型行为僵化 | 低 | 仅 organize 模式强化，其他模式不变 |
| `Message.ToolCalls` JSON 序列化对 Anthropic/Ollama 的影响 | 低 | Anthropic 需单独处理 messages 格式；Ollama 忽略未知字段 |
