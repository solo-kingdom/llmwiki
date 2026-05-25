## Why

使用 DeepSeek thinking 模式模型（如 `deepseek-v4-flash`）进行会话归档时，ingest pipeline 的 tool loop 在第二轮请求因未回传 `reasoning_content` 而收到 HTTP 400，被迫降级为无工具的 stream。更严重的是，降级后 LLM 生成的 FILE 块路径使用 `entity/foo.md` 等简写，而 `ApplyWikiBlocks` 仅接受 `wiki/` 前缀，导致所有页面被静默跳过、apply job 仍标记为 succeeded（`applied 0 wiki page(s)`），用户看到归档成功但 wiki 与时间线无实质更新。

## What Changes

- 在 LLM 客户端与 tool loop 中支持 `reasoning_content` 字段的解析、存储与多轮回传（满足 DeepSeek thinking + tool calls 契约）
- 在 FILE 块解析/写入前规范化 LLM 输出的相对路径（`entity/` → `wiki/entities/` 等），与 typed wiki 组织一致
- 当解析到 FILE 块但写入 0 个 wiki 文件时，review apply 与 ingest pipeline SHALL 失败并记录明确错误，不得标记 succeeded
- 强化 plan/generation 提示词中的路径示例，要求 `wiki/entities/` 等完整前缀
- 归档审阅 UI 在「0 页写入」或 apply 失败时展示明确错误，而非成功摘要

## Capabilities

### New Capabilities

（无 — 本变更通过修改现有能力规格实现）

### Modified Capabilities

- `llm-integration`: 新增 reasoning/thinking 模型多轮消息契约（`reasoning_content` 解析与 tool loop 回传）
- `ingest-pipeline`: FILE 路径规范化、零写入失败语义、apply 事件记录
- `chat-archive-review`: 审阅成功摘要须反映实际写入页数；0 页写入视为失败态

## Impact

- **Go**: `internal/llm/client.go`（Message、parseChatResponse、buildChatBody）、`internal/llm/tools.go`（RunToolLoop）、`internal/ingest/fileblocks.go`（路径规范化）、`internal/ingest/review_processor.go`、`internal/ingest/pipeline.go`、`internal/ingest/prompts.go`
- **前端**: `ArchiveReviewCard` 成功/失败展示逻辑（`web/src` 相关组件）
- **测试**: LLM client、fileblocks、review apply、tool loop 单元测试
- **兼容性**: 路径规范化对已有正确 `wiki/` 前缀输出无影响；错误路径简写将被自动修正或在校验失败时明确报错
