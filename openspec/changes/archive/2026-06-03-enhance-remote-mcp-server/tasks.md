## 1. 服务配置与远程安全边界

- [x] 1.1 为 `llmwiki serve` 增加远程 MCP 安全校验：非 loopback bind 且 MCP enabled 时必须配置 token
- [x] 1.2 增加显式开启远程 MCP 写工具的配置入口，默认保持只读
- [x] 1.3 更新 `/api/v1/health` 或 capabilities 元信息，声明 MCP remote-rpc、认证要求和 readonly 默认策略
- [x] 1.4 覆盖 `--no-mcp`、local bind 无 token、remote bind 无 token、remote bind 有 token 的启动行为测试

## 2. MCP Server 协议与工具策略

- [x] 2.1 扩展 MCP Server policy 结构，支持 readonly 默认工具集与显式 mutating 工具集
- [x] 2.2 调整 `initialize` 响应 `_meta`，返回 transport、accessModel、auth 和 defaultToolPolicy
- [x] 2.3 调整 `tools/list`，默认仅返回 `guide/search/read/references/lint/ping` 等只读/诊断工具
- [x] 2.4 调整 `tools/call`，对未知或策略禁用工具返回 JSON-RPC policy/unknown-tool 错误且不执行 handler
- [x] 2.5 复用或收敛 `local_tools.go` 中的只读工具定义与执行逻辑，减少 MCP Server 与内部 tool loop 的重复
- [x] 2.6 增加 JSON-RPC 请求校验测试：invalid JSON、非 POST、缺省 arguments、禁用写工具调用

## 3. CLI MCP 配置输出

- [x] 3.1 扩展 `llmwiki mcp-config` 参数，支持输出远程 endpoint、transport、Authorization header 和 readonly 策略说明
- [x] 3.2 在生成非 loopback/远程配置时校验 token，缺失时返回阻断错误
- [x] 3.3 更新 `mcp-config` 单元测试，覆盖默认本地配置、带 token 远程配置、无 token 远程拒绝

## 4. 远程 MCP 审计日志

- [x] 4.1 为 MCP tool-call 记录结构化摘要：tool、来源摘要、client/agent 标识、耗时、状态和错误类型
- [x] 4.2 增加日志脱敏逻辑，确保 Authorization、Bearer token、完整 request body、完整 arguments 和完整 tool result 不落库
- [x] 4.3 覆盖成功、失败、策略拒绝和认证失败的活动日志测试

## 5. 帮助文档

- [x] 5.1 更新 `help.zh.md`，说明远程 MCP 启动、token、agent 配置、readonly 默认和 HTTPS/反代建议
- [x] 5.2 更新 `help.en.md`，保持与中文文档等价
- [x] 5.3 更新帮助文档相关测试或静态校验，确保 MCP 远程说明可被 Help 页面渲染

## 6. 端到端验证

- [x] 6.1 增加 HTTP handler 集成测试，使用 Bearer token 完成 `initialize`、`tools/list`、`tools/call`
- [x] 6.2 验证默认远程 `tools/list` 不包含 `write/delete`，显式开启后才出现写工具
- [x] 6.3 运行 Go 测试与前端相关测试，确认 MCP、CLI、日志和 Help 变更无回归
