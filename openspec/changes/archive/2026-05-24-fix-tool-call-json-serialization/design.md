## Context

Session chat 的 tool loop（`RunSessionChatToolLoop`）在多轮调用中会将 assistant 的 `tool_calls` 和 `role: "tool"` 结果消息追加到 `msgs`，再发回 LLM API。

当前 `llm.ToolCall` 结构体：

```go
type ToolCall struct {
    ID        string
    Name      string
    Arguments string
}
```

无 `json` tag，也无自定义 `MarshalJSON`。Go 默认序列化产出：

```json
{"ID":"call_1","Name":"structure","Arguments":"{}"}
```

而 OpenAI Chat Completions API（及智谱 GLM 等兼容实现）要求：

```json
{"id":"call_1","type":"function","function":{"name":"structure","arguments":"{}"}}
```

**解析方向**（API → 代码）在 `parseChatResponse` 中已正确处理嵌套 `function` 结构；**回传方向**（代码 → API）缺失对称实现。

现有单元测试（`TestMessageToolCallsSerialization`）只验证 `tool_calls` 字段存在，未验证 OpenAI 格式合规性。Mock httptest server 不校验请求体，因此 bug 未在 CI 中暴露。

## Goals / Non-Goals

**Goals:**

- Round 1 及后续 tool loop 请求中，assistant 消息的 `tool_calls` 符合 OpenAI 兼容格式
- 保持 `parseChatResponse` 解析逻辑不变（已正确）
- 补充测试锁定序列化格式，防止回归

**Non-Goals:**

- 修改 tool loop 架构、round 策略或 fallback 路径
- 新增 provider 特化适配层（除非测试发现 Anthropic/Ollama 路径也受影响）
- 修改前端 UI 或 API 接口
- 修复 Round 1 之外的其他 provider 兼容问题（如 `tool_choice: required` 不支持——已有 400 fallback）

## Decisions

### Decision 1: 在 ToolCall 上实现 MarshalJSON / UnmarshalJSON

**选择**：为 `llm.ToolCall` 添加自定义 JSON 方法，输出/输入 OpenAI `tool_calls` 元素格式。

**理由**：改动面最小，只影响序列化层；`ToolCall` 内部仍保持 flat 字段（ID, Name, Arguments），业务代码无需改动。

**替代方案**：
- 改 `Message` 的 MarshalJSON — 改动更大，需处理 assistant/tool 多种 role
- 引入独立的 `OpenAIToolCall` 类型 — 过度抽象，增加转换层

### Decision 2: type 固定为 "function"

OpenAI 规范中 `tool_calls[].type` 当前唯一值为 `"function"`。MarshalJSON 硬编码 `type: "function"`；UnmarshalJSON 读取但不校验 type 值（兼容未来扩展）。

### Decision 3: json tag 使用小写字段名

在 MarshalJSON 实现中显式输出 `id`（小写），而非依赖 Go 默认的 `ID` → `"ID"` 行为。这与 OpenAI API 一致，也避免智谱等严格 provider 的字段名校验问题。

### Decision 4: 测试策略

1. **单元测试**（`internal/llm/`）：验证 MarshalJSON 输出含 `type`、`function` 嵌套结构；UnmarshalJSON round-trip
2. **集成测试**（`internal/ingest/tool_loop_test.go`）：httptest server 在 Round 1 解码请求体，断言 `messages[n].tool_calls[0].type == "function"`
3. **保留现有测试**：`TestMessageToolCallsSerialization` 更新断言为 OpenAI 格式

Anthropic 路径不受影响：`convertToAnthropicMessages` 手动构建 content blocks，不依赖 ToolCall 的 JSON 序列化。

## Risks / Trade-offs

- **[Risk] Arguments 为空字符串 vs 空对象** → MarshalJSON 保持原值透传（`"{}"` 或 `""`），与 parseChatResponse 行为一致
- **[Risk] 旧版 provider 接受非标准格式** → OpenAI 标准格式是超集，宽松 provider 应向后兼容；无 BREAKING 风险
- **[Risk] tool role 消息的 `name` 字段** → OpenAI 规范中 tool 消息可选 `name` 字段，当前已设置，不在本次改动范围

## Migration Plan

纯代码修复，无数据迁移。部署后 organize 模式在 GLM 等 provider 上应直接恢复多轮 tool calling。

回滚：revert commit 即可，无 schema 或配置变更。

## Open Questions

（无）
