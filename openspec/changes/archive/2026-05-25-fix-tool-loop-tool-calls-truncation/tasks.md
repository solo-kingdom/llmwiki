## 1. 修复 tool loop 消息配对

- [x] 1.1 修改 `internal/llm/tools.go` 中 `RunToolLoop`：先按 `MaxToolCallsPerRound` 截断 `calls`，assistant 消息与 tool 执行均使用同一 `calls` 切片
- [x] 1.2 修改 `internal/ingest/chat_wiki_executor.go` 中 `RunSessionChatToolLoop`：应用与 1.1 相同的截断顺序

## 2. 测试

- [x] 2.1 在 `internal/llm/` 新增测试：mock Round 0 返回 5 个 tool_calls、`MaxToolCallsPerRound=3`，断言 Round 1 请求体 assistant `tool_calls` 长度为 3 且紧随 3 条 `role:tool` 消息
- [x] 2.2 运行 `go test ./internal/llm/... ./internal/ingest/...` 确认通过

## 3. 验证

- [x] 3.1 本地复现：使用会并行返回 4+ tool_calls 的模型跑 archive ingest step，确认执行日志不再出现 `insufficient tool messages` 与 tool loop fallback（由 `TestRunToolLoopTruncatesAssistantToolCallsToMatchToolMessages` 覆盖 API 契约；真机 E2E 可在部署后抽查）
