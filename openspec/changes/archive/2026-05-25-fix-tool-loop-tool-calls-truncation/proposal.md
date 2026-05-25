## Why

ingest pipeline 与 session chat 的 tool loop 在模型单轮返回超过 `MaxToolCallsPerRound` 个 `tool_calls` 时，会将**完整** `tool_calls` 写入 assistant 消息，但只为前 N 个生成 `role: tool` 回复。下一轮 Chat API 请求违反 OpenAI 契约（每个 `tool_call_id` 必须有对应 tool 消息），返回 HTTP 400 `insufficient tool messages following tool_calls message`，触发 `tool loop failed, falling back to stream` 降级，丢失工具上下文。归档 ingest 默认每轮上限为 3，模型并行调用 4+ 工具时极易复现。

## What Changes

- 修正 `RunToolLoop` 与 `RunSessionChatToolLoop`：append 到历史的 assistant `tool_calls` 仅包含本轮回传且已执行的调用（与 `tool` 消息一一对应）
- 新增 `llm-integration` 规格要求：tool loop 多轮请求中 assistant `tool_calls` 数量 SHALL 等于紧随其后的 `tool` 消息数量
- 添加单元测试：mock 返回 5 个 tool_calls、`MaxToolCallsPerRound=3` 时第二轮请求体满足契约

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `llm-integration`：新增 tool loop 消息历史一致性要求（assistant `tool_calls` 与 tool 回复配对）

## Impact

- **Go**: `internal/llm/tools.go`（`RunToolLoop`）、`internal/ingest/chat_wiki_executor.go`（`RunSessionChatToolLoop`）
- **测试**: `internal/llm/` 与 `internal/ingest/tool_loop_test.go`
- **兼容性**: 被截断未执行的 tool_calls 不再进入历史；模型可在后续轮次重新请求（行为更符合 API 契约）
- **无关**: `reasoning_content`、wiki 路径规范化（见 `fix-archive-deepseek-and-wiki-paths`）
