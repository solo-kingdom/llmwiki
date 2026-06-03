## Why

当前 `/mcp` 已提供基础 JSON-RPC 工具入口，但远程 agent 使用时缺少明确的认证要求、只读/写入边界、远程连接配置、调用审计和文档说明。随着 llmwiki 作为长期运行的知识工作区服务暴露给外部 agent，MCP Server 需要从“可用的本地/基础入口”升级为“可安全远程调用的稳定接口”。

## What Changes

- 完善 `llmwiki serve` 暴露的 `/mcp` 远程访问契约，明确 HTTP JSON-RPC transport、初始化、工具发现、工具调用和错误语义。
- 为远程 MCP 调用建立默认安全边界：远程绑定或远程 MCP 启用时必须具备认证保护，默认只开放只读工具，写入/删除能力需要显式开启。
- 调整 MCP 工具清单，区分只读工具与写入工具，补齐远程 agent 常用的知识检索、读取、引用查询、lint/诊断能力。
- 扩展 `llmwiki mcp-config` 输出，生成适合远程 agent 使用的 endpoint、transport、认证 header 和只读能力说明。
- 增强 MCP tool-call 可观测性，记录调用摘要、agent/remote 元信息、耗时、结果状态和错误类型，同时避免记录敏感参数。
- 更新帮助文档，说明远程 MCP Server 的启动方式、认证要求、agent 配置示例和安全建议。
- Non-goal：本变更不新增外部 MCP Client 调用能力，不要求改造 stdio/local MCP 连接方式，不引入多租户用户系统。

## Capabilities

### New Capabilities

### Modified Capabilities
- `mcp-server`: 完善面向远程 agent 的 MCP Server 访问、安全、工具和错误契约。
- `cli-interface`: 扩展 `serve`/`mcp-config` 的远程 MCP 使用语义与配置输出。
- `activity-logs`: 增强 MCP 远程 tool-call 的审计日志要求。
- `help-page`: 更新用户文档中的远程 MCP 接入和安全说明。

## Impact

- 后端 MCP Server：`internal/mcp/server.go`、`internal/mcp/tools.go`、`internal/mcp/local_tools.go` 及相关测试。
- HTTP 服务与认证：`internal/server/server.go`、`cmd/llmwiki/serve.go`。
- CLI 配置输出：`cmd/llmwiki/mcp_config.go`。
- 活动日志：`internal/activity`、`internal/mcp` 调用记录路径。
- 帮助文档：`web/src/content/help.zh.md`、`web/src/content/help.en.md`。
- 测试：MCP JSON-RPC handler、认证/远程绑定策略、只读工具策略、CLI config 输出、日志脱敏与帮助文档覆盖。
