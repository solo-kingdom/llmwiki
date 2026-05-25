## Context

`RunToolLoop`（`internal/llm/tools.go`）与 `RunSessionChatToolLoop`（`internal/ingest/chat_wiki_executor.go`）在模型返回 tool_calls 后：

1. 将 `result.ToolCalls` **完整** append 到 assistant 消息
2. 用 `calls[:cfg.MaxToolCallsPerRound]` 截断后执行工具并 append `tool` 消息

OpenAI Chat Completions 要求：每条带 `tool_calls` 的 assistant 消息后，必须有相同数量的 `tool` 消息，且 `tool_call_id` 一一对应。截断执行但未截断 assistant 声明时，Round 1+ 请求返回 HTTP 400。

```
模型返回 tool_calls: [A, B, C, D]     MaxToolCallsPerRound = 3
─────────────────────────────────────────────────────────────
当前（错误）:
  assistant.tool_calls = [A,B,C,D]
  tool 消息            = [A,B,C]     → API 400

修复后:
  assistant.tool_calls = [A,B,C]
  tool 消息            = [A,B,C]     → OK；D 可在下一轮由模型重试
```

归档 pipeline（`internal/ingest/pipeline.go`）analysis/plan/generation 默认 `MaxToolCallsPerRound: 3`，与并行 read/search 场景冲突概率高。

## Goals / Non-Goals

**Goals:**

- tool loop 多轮请求始终满足 OpenAI tool 消息配对契约
- `RunToolLoop` 与 `RunSessionChatToolLoop` 行为一致
- 回归测试覆盖「多 tool_call + 截断」场景

**Non-Goals:**

- 修改 `MaxToolCallsPerRound` 默认值或设置 UI
- 为被截断的 call 生成占位 tool 消息（避免污染模型上下文）
- `reasoning_content`、wiki 路径、零写入检测（其他 change）

## Decisions

### 1. 先截断再 append assistant

**选择**：在 append assistant 之前计算 `calls := result.ToolCalls`，若 `len(calls) > MaxToolCallsPerRound` 则 `calls = calls[:limit]`；assistant 的 `ToolCalls` 与后续 `tool` 循环均使用同一 `calls` 切片。

**备选 A**：保留完整 assistant，为未执行的 call 追加占位 tool 消息（如 `"skipped: round limit"`）。满足 API 但可能误导模型认为工具已执行。**否决**。

**备选 B**：提高 `MaxToolCallsPerRound` 至 8+。不解决根本不一致，仅降低触发频率。**否决**。

### 2. 抽取共享逻辑（可选、轻量）

两处 loop 代码重复。可在 `internal/llm` 增加 `TruncateToolCalls(calls []ToolCall, limit int) []ToolCall` 或在 loop 内内联相同三行（YAGNI：优先内联，若 apply 时发现第三处再抽）。

### 3. 测试策略

- **`internal/llm`**: httptest mock Round 0 返回 5 个 tool_calls，`MaxToolCallsPerRound=3`；解码 Round 1 请求体，断言 assistant `tool_calls` 长度 = 3，且其后有 3 条 `role:tool` 消息。
- **`internal/ingest`**: 在 `tool_loop_test.go` 增加 `RunSessionChatToolLoop` 同类断言（可选，与 llm 层测试二选一或都做）。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 模型依赖第 4+ 个并行 call 在同轮完成 | 模型可在下一轮再次发起；与 API 契约一致 |
| 与 `reasoning_content` 同轮共存 | 截断仅影响 `ToolCalls` 切片，不影响 `ReasoningContent` 字段 |
| 日志中 `tool_calls_count` 与历史不一致 | debug 事件可继续记录 `result.ToolCalls` 原始数量，历史仅记执行的 |

## Migration Plan

1. 部署后端即可，无 schema/配置变更
2. 无需数据迁移；失败 job 可重跑 ingest/archive

## Open Questions

（无 — 实现路径明确）
