## Why

Session chat 的 tool loop 在 Round 0 成功调用工具后，Round 1 将 assistant 的 `tool_calls` 回传给 LLM API 时使用了错误的 JSON 格式（缺少 `type: "function"` 和嵌套 `function` 对象）。严格遵循 OpenAI 兼容协议的 provider（如智谱 GLM）会返回 HTTP 400 / error 1214「工具类型不能为空」，导致 organize 模式无法完成诊断后的建议生成，触发 fallback 降级。

## What Changes

- 为 `llm.ToolCall` 实现符合 OpenAI Chat Completions API 规范的 `MarshalJSON` / `UnmarshalJSON`
- 确保 tool loop 第二轮及后续请求中，assistant 消息的 `tool_calls` 字段序列化为 `{id, type: "function", function: {name, arguments}}` 格式
- 补充单元测试验证序列化格式与 Round 1 请求体合规性
- 不改动 tool loop 架构、fallback 逻辑或前端 UI

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `llm-integration`：新增 tool_calls 消息序列化格式要求，确保多轮 tool loop 回传消息符合 OpenAI 兼容 API 规范

## Impact

- **Backend**：`internal/llm/tools.go`（ToolCall JSON 序列化）、`internal/llm/client.go`（如有必要调整 Message 相关逻辑）
- **Tests**：`internal/llm/` 和 `internal/ingest/` 新增/更新序列化与 tool loop 测试
- **Frontend**：无变更
- **Provider 兼容性**：修复后 GLM 等严格 provider 的多轮 tool calling 应正常工作；对 OpenAI 等已有行为无破坏性影响
