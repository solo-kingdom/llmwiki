## Design

### 问题复现路径

```
User 发送消息 → streamAssistantReply → RunSessionChatToolLoop
                                         │
                                         ├─ Round 0: client.Chat() → tool_calls → 执行工具 ✅
                                         │
                                         ├─ Round 1: client.Chat() → error ❌
                                         │            （原因不明，无 debug 事件）
                                         │
                                         └─ return "", err → streamAssistantReply 捕获 error
                                              │
                                              ├─ log.Printf("[ingest-session] tool loop failed...")
                                              │   （写到 stderr，用户不可见）
                                              │
                                              └─ streamSessionChatDirect(msgs)
                                                   │
                                                   ├─ msgs 包含 role:"tool" 消息 ❌
                                                   ├─ StreamChat 不带 tools 参数 ❌
                                                   └─ LLM 可能在文本中写 tool_call(...)
```

### 修复方案

#### 改动 1：Tool loop 错误记录

**文件**: `internal/ingest/chat_wiki_executor.go`

在 `RunSessionChatToolLoop` 的 `client.Chat()` 错误处理分支中，增加 recorder 记录：

```go
// 当前代码（line 211-224）:
if err != nil {
    if toolChoice != "" && isBadRequestError(err) {
        // retry...
    } else {
        return "", err  // ← 直接返回，无 debug 事件
    }
}

// 修改后:
if err != nil {
    // 记录错误到 debug 事件
    if recorder != nil {
        recorder.Record(stepName, "llm_error", stepName+" LLM call failed", map[string]any{
            "error": err.Error(),
        })
    }
    if toolChoice != "" && isBadRequestError(err) {
        // retry...
    } else {
        return "", err
    }
}
```

关键点：
- 在 retry 逻辑**之前**记录，确保首次失败和 retry 失败都被记录
- payload 只包含 `error` 字符串，`classifyError` 已经包含了 HTTP status code 和 response body

#### 改动 2：Fallback 消息清洗

**文件**: `internal/api/ingest_session.go`

在 `streamAssistantReply` 中，调用 `streamSessionChatDirect` 之前，清洗 `msgs`：

```go
// 当前代码（line 502-509）:
finalText, err := ingest.RunSessionChatToolLoop(...)
if err != nil {
    log.Printf(...)
    a.streamSessionChatDirect(ctx, w, sendEvent, client, session, instanceID, model, msgs, assistantMsg)
    return
}

// 修改后:
finalText, err := ingest.RunSessionChatToolLoop(...)
if err != nil {
    log.Printf(...)
    cleaned := ingest.StripToolMessages(msgs)  // ← 新增
    a.streamSessionChatDirect(ctx, w, sendEvent, client, session, instanceID, model, cleaned, assistantMsg)
    return
}
```

**`StripToolMessages` 函数** 放在 `internal/ingest/chat_wiki_executor.go`：

```go
// StripToolMessages removes tool-role messages and tool_calls from assistant
// messages, producing a clean conversation history suitable for a plain
// (non-tool) LLM call.
func StripToolMessages(msgs []llm.Message) []llm.Message {
    var out []llm.Message
    for _, m := range msgs {
        switch m.Role {
        case "tool":
            // 跳过所有 tool 角色消息
            continue
        case "assistant":
            // 保留 content，移除 tool_calls
            if len(m.ToolCalls) > 0 {
                out = append(out, llm.Message{
                    Role:    m.Role,
                    Content: m.Content,
                })
            } else {
                out = append(out, m)
            }
        default:
            out = append(out, m)
        }
    }
    return out
}
```

清洗后的消息示例：
```
清洗前:                              清洗后:
─────────────────────                ─────────────────────
[0] system: "..."                    [0] system: "..."
[1] user: "我们重新整理..."           [1] user: "我们重新整理..."
[2] assistant: "收到..."             [2] assistant: "收到..."  ← 只保留 content
    + tool_calls                         （无 tool_calls）
[3] tool: structure 结果     ❌ 删除
[4] tool: audit 结果         ❌ 删除
```

#### 改动 3：Fallback 事件记录

**文件**: `internal/api/ingest_session.go`

在 fallback 路径中，使用 recorder 记录 fallback 事件：

```go
if err != nil {
    log.Printf(...)
    // 记录 fallback 事件
    recorder.Record("fallback", "tool_loop_failed", "Tool loop failed, falling back to direct stream", map[string]any{
        "error": err.Error(),
    })
    cleaned := ingest.StripToolMessages(msgs)
    a.streamSessionChatDirect(...)
    return
}
```

### 测试策略

1. **`StripToolMessages` 单元测试**：验证各种消息组合的清洗结果
2. **`RunSessionChatToolLoop` 错误记录测试**：mock server 返回 500，验证 `llm_error` 事件被记录
3. **不需要前端改动**：MessageDebugDialog 已能展示任意事件类型的 payload JSON
