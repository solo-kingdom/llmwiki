## Tasks

### Task 1: 新增 `StripToolMessages` 函数
- [x] 在 `internal/ingest/chat_wiki_executor.go` 新增 `StripToolMessages(msgs []llm.Message) []llm.Message`
- [x] 逻辑：跳过 `role: "tool"` 消息，从 `role: "assistant"` 消息中移除 `ToolCalls` 字段
- [x] 单元测试：空数组、纯对话、含 tool 消息、assistant 同时有 content + tool_calls、连续多条 tool 消息
- [x] 测试文件：`internal/ingest/chat_wiki_executor_test.go`

**Files:** `internal/ingest/chat_wiki_executor.go`, `internal/ingest/chat_wiki_executor_test.go`

### Task 2: Tool loop 错误记录到 Debug 事件
- [x] 在 `RunSessionChatToolLoop` 的 `client.Chat()` 错误处理分支（`err != nil`），增加 `recorder.Record(stepName, "llm_error", ...)` 调用
- [x] 位置：在 `if toolChoice != "" && isBadRequestError(err)` 判断之前，确保首次错误和 retry 错误都被记录
- [x] payload 包含 `error` 字段（`err.Error()`）
- [x] 更新 `tool_loop_test.go` 中的 mock server 测试：模拟 Round 1 返回 500，验证 `llm_error` 事件被记录（通过 stub recorder）

**Files:** `internal/ingest/chat_wiki_executor.go`, `internal/ingest/tool_loop_test.go`

### Task 3: Fallback 路径清洗 + 事件记录
- [x] 在 `streamAssistantReply`（`internal/api/ingest_session.go`）的 fallback 分支中：
  - 调用 `recorder.Record("fallback", "tool_loop_failed", ...)` 记录 fallback 事件
  - 调用 `ingest.StripToolMessages(msgs)` 清洗消息
  - 将清洗后的消息传给 `streamSessionChatDirect`
- [x] recorder 在 fallback 分支中仍然可用（同一个 `recorder` 变量）
- [x] 不需要修改 `streamSessionChatDirect` 的签名

**Files:** `internal/api/ingest_session.go`

### Task 4: 集成验证
- [x] Go build 通过
- [x] 单元测试通过：`StripToolMessages`、tool loop 错误记录
- [ ] 手动验证：在 organize 模式下复现 Round 1 失败场景，确认 Debug Dialog 中出现 `llm_error` 和 `fallback` 事件
- [ ] 手动验证：fallback 后气泡显示正常回复（无 `tool_call(...)` 文本）
