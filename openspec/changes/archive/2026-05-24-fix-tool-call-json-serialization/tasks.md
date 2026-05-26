## 1. ToolCall JSON 序列化

- [x] 1.1 在 `internal/llm/tools.go` 为 `ToolCall` 实现 `MarshalJSON`，输出 `{id, type:"function", function:{name, arguments}}` 格式
- [x] 1.2 在 `internal/llm/tools.go` 为 `ToolCall` 实现 `UnmarshalJSON`，解析 OpenAI 格式并填充 flat 字段（ID, Name, Arguments）
- [x] 1.3 确认 `Message` 结构体嵌入 `ToolCalls` 后整体序列化符合预期（无需改 Message 本身）

## 2. 单元测试

- [x] 2.1 新增 `internal/llm/toolcall_json_test.go`：验证 MarshalJSON 输出含 `type:"function"` 和嵌套 `function` 对象
- [x] 2.2 新增 round-trip 测试：Marshal → Unmarshal 后字段值一致
- [x] 2.3 更新 `internal/ingest/tool_loop_test.go` 中 `TestMessageToolCallsSerialization` 断言为 OpenAI 格式

## 3. Tool loop 集成测试

- [x] 3.1 在 `internal/ingest/tool_loop_test.go` 新增测试：Round 1 httptest server 解码请求体，断言 assistant 消息的 `tool_calls[0].type == "function"`
- [x] 3.2 验证现有 tool loop 测试（organize mode、required tool_choice、error recording）全部通过

## 4. 验证

- [x] 4.1 运行 `go test ./internal/llm/... ./internal/ingest/...` 确认无回归
- [ ] 4.2 手动验证（可选）：organize 模式 + GLM provider，确认 Round 1 不再返回 1214 错误
