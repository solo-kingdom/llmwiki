## 1. Settings: MCP 全局 JSON 配置

- [x] 1.1 扩展 `GET/PUT /api/v1/settings`，支持 `mcp_servers_json` 读写与返回
- [x] 1.2 新增后端配置校验：JSON 语法、必填字段、`transport` 枚举、超时与重试范围
- [x] 1.3 校验 `allowed_tools` 与 `readonly_only` 关系：默认仅允许 `search/read`
- [x] 1.4 错误信息返回可操作提示（指出具体 JSON 路径与字段）
- [x] 1.5 补充 `internal/api/settings_test.go` 覆盖合法/非法配置场景

## 2. MCP Client Runtime（Registry + Adapter + Router）

- [x] 2.1 在 `internal/mcp/` 新增 client 侧配置模型与 registry 加载逻辑
- [x] 2.2 实现 `sse` transport adapter（含超时、断线、错误归一化）
- [x] 2.3 实现 `streamable-http` transport adapter（请求/响应协议映射）
- [x] 2.4 预留 `stdio` adapter 接口（可先提供 no-op 或最小实现）
- [x] 2.5 实现统一 `tools/list` 与 `tools/call` 路由，支持重试和故障切换
- [x] 2.6 补充 transport/router 单测（成功、超时、鉴权失败、切换下一个 server）

## 3. Job 自动 Tool-Call Loop

- [x] 3.1 在 `internal/llm/` 增加工具循环执行器接口（模型请求工具 -> 调用工具 -> 回填）
- [x] 3.2 在 `internal/ingest/pipeline.go` 的 `analyze` 与 `generate` 接入工具循环
- [x] 3.3 增加循环保护参数：`max_rounds`、`max_tool_calls_per_round`
- [x] 3.4 对模型不支持工具调用或工具列表为空时，自动退回纯文本模式
- [x] 3.5 补充 pipeline 测试：工具成功路径、多轮循环、超限终止

## 4. 默认只读工具策略

- [x] 4.1 实现全局默认 `readonly_only=true`
- [x] 4.2 未配置 `allowed_tools` 时仅暴露 `search/read`
- [x] 4.3 显式声明写工具时需要开启额外开关（或明确白名单）
- [x] 4.4 补充权限测试：禁止写工具调用、允许只读工具调用

## 5. 自动降级与可观测性

- [x] 5.1 实现降级顺序：当前 server 重试 -> 切换 server -> `local_only`
- [x] 5.2 在 `ingest_job_events` 记录 MCP 调用与降级事件
- [x] 5.3 在 `activity_logs` 记录聚合级失败与降级结果（脱敏）
- [x] 5.4 补充测试：全部 MCP 失败后 Job 仍成功完成（纯文本降级）

## 6. 前端 Settings JSON 高级模式

- [x] 6.1 在 `SettingsPage` 增加 MCP JSON 编辑区（多行编辑 + 保存）
- [x] 6.2 新增 JSON 格式即时校验与错误提示
- [x] 6.3 保存后回显规范化 JSON（格式化输出）
- [x] 6.4 补充前端测试：编辑、校验失败、保存成功与回显

## 7. 端到端验证

- [x] 7.1 配置至少一个 SSE MCP server，验证 `tools/list` 与 `tools/call`
- [x] 7.2 验证 Job 中模型自动触发 `search/read` 工具调用并产出结果
- [x] 7.3 验证 MCP 不可用时自动降级，Job 不被阻断
- [x] 7.4 验证默认权限下写工具不可调用
- [x] 7.5 运行 Go/前端测试并记录结果
